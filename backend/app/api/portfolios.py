"""
app/api/portfolios.py
─────────────────────
Portfolio endpoints. Auth is bypassed for local dev — all routes
use the first user in the database until login is implemented.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import Portfolio, Position, RefreshJob, User
from app.schemas.schemas import (
    ExposureResponse,
    JobStatusResponse,
    PortfolioCreate,
    PortfolioResponse,
    PositionResponse,
    SummaryResponse,
    TreemapGroup,
    UploadResponse,
)
from app.services import portfolio_service

router = APIRouter(prefix="/portfolios", tags=["portfolios"])

TREEMAP_ALLOWED = {"sector", "theme", "industry", "region", "asset_type", "risk_bucket"}


async def _get_local_user(db: AsyncSession) -> User:
    """Return the first user (local dev — no auth required yet)."""
    result = await db.execute(select(User).limit(1))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=503, detail="No user found — restart the API to seed")
    return user


async def _get_portfolio_or_404(portfolio_id: str, user_id: str, db: AsyncSession) -> Portfolio:
    result = await db.execute(
        select(Portfolio).where(
            Portfolio.id == portfolio_id,
            Portfolio.user_id == user_id,
            Portfolio.deleted_at.is_(None),
        )
    )
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return p


# ── List / create ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[PortfolioResponse])
async def list_portfolios(db: AsyncSession = Depends(get_db)):
    user = await _get_local_user(db)
    result = await db.execute(
        select(Portfolio).where(
            Portfolio.user_id == user.id,
            Portfolio.deleted_at.is_(None),
        )
    )
    portfolios = result.scalars().all()

    out = []
    for p in portfolios:
        # Count positions
        pos_result = await db.execute(
            select(Position).where(Position.portfolio_id == p.id)
        )
        positions = pos_result.scalars().all()
        total = sum(float(pos.csv_value or 0) for pos in positions)
        pr = PortfolioResponse.model_validate(p)
        pr.position_count = len(positions)
        pr.total_value = round(total, 2)
        out.append(pr)
    return out


@router.post("", response_model=PortfolioResponse, status_code=status.HTTP_201_CREATED)
async def create_portfolio(body: PortfolioCreate, db: AsyncSession = Depends(get_db)):
    user = await _get_local_user(db)
    portfolio = Portfolio(user_id=user.id, name=body.name, currency=body.currency)
    db.add(portfolio)
    await db.flush()
    pr = PortfolioResponse.model_validate(portfolio)
    pr.position_count = 0
    pr.total_value = 0.0
    return pr


@router.delete("/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_portfolio(portfolio_id: str, db: AsyncSession = Depends(get_db)):
    user = await _get_local_user(db)
    p = await _get_portfolio_or_404(portfolio_id, user.id, db)
    p.deleted_at = datetime.now(timezone.utc)


# ── CSV upload ────────────────────────────────────────────────────────────────

@router.post("/{portfolio_id}/upload", response_model=UploadResponse)
async def upload_csv(
    portfolio_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_local_user(db)
    await _get_portfolio_or_404(portfolio_id, user.id, db)

    if not (file.filename or "").endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are accepted")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    try:
        count = await portfolio_service.parse_and_store_csv(content, portfolio_id, db)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return UploadResponse(
        message=f"Imported {count} positions.",
        filename=file.filename or "upload.csv",
        position_count=count,
        job_id=str(uuid.uuid4()),
    )


# ── Data endpoints ────────────────────────────────────────────────────────────

@router.get("/{portfolio_id}/positions", response_model=list[PositionResponse])
async def get_positions(
    portfolio_id: str,
    live: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_local_user(db)
    await _get_portfolio_or_404(portfolio_id, user.id, db)
    return await portfolio_service.get_positions(portfolio_id, db, use_live_prices=live)


@router.get("/{portfolio_id}/summary", response_model=SummaryResponse)
async def get_summary(
    portfolio_id: str,
    live: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_local_user(db)
    await _get_portfolio_or_404(portfolio_id, user.id, db)
    try:
        return await portfolio_service.get_summary(portfolio_id, db, use_live_prices=live)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{portfolio_id}/treemap/{group_by}", response_model=list[TreemapGroup])
async def get_treemap(
    portfolio_id: str,
    group_by: str = "sector",
    db: AsyncSession = Depends(get_db),
):
    user = await _get_local_user(db)
    await _get_portfolio_or_404(portfolio_id, user.id, db)
    safe = group_by if group_by in TREEMAP_ALLOWED else "sector"
    return await portfolio_service.get_treemap(portfolio_id, db, group_by=safe)


@router.get("/{portfolio_id}/exposure", response_model=ExposureResponse)
async def get_true_exposure(
    portfolio_id: str,
    live: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_local_user(db)
    await _get_portfolio_or_404(portfolio_id, user.id, db)
    return await portfolio_service.get_true_exposure(portfolio_id, db, use_live_prices=live)


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RefreshJob).where(RefreshJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatusResponse.model_validate(job)


@router.get("/{portfolio_id}/top-holdings/{symbol}")
async def get_top_holdings(
    portfolio_id: str,
    symbol: str,
    db: AsyncSession = Depends(get_db),
):
    """Fetch ETF/MF top-10 holdings from Yahoo Finance for a symbol."""
    import requests
    from datetime import datetime, timezone

    symbol = symbol.upper().strip()

    # Try Yahoo Finance quoteSummary API
    try:
        url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}"
        headers = {"User-Agent": "Mozilla/5.0 PortfolioIQ/1.0"}
        resp = requests.get(url, params={"modules": "topHoldings"}, headers=headers, timeout=10)
        resp.raise_for_status()
        result = resp.json().get("quoteSummary", {}).get("result") or []
        if result:
            holdings_raw = result[0].get("topHoldings", {}).get("holdings") or []
            holdings = []
            for h in holdings_raw[:10]:
                sym = str(h.get("symbol", "")).upper().strip()
                name = h.get("holdingName") or sym
                wr = h.get("holdingPercent", {})
                w = float(wr.get("raw", 0) if isinstance(wr, dict) else wr or 0)
                if w <= 1: w *= 100
                if sym:
                    holdings.append({"symbol": sym, "name": name, "weight": round(w, 4), "source": "Yahoo Finance"})
            if holdings:
                return {"symbol": symbol, "source": "Yahoo Finance", "holdings": holdings, "fetchedAt": datetime.now(timezone.utc).isoformat()}
    except Exception:
        pass

    # Fallback: check holdings_cache in DB
    from app.models.user import HoldingsCache
    from sqlalchemy import select
    result = await db.execute(select(HoldingsCache).where(HoldingsCache.symbol == symbol))
    row = result.scalar_one_or_none()
    if row and row.holdings:
        return {"symbol": symbol, "source": row.source or "Cache", "holdings": row.holdings, "fetchedAt": row.fetched_at.isoformat() if row.fetched_at else None}

    return {"symbol": symbol, "source": "Not available", "holdings": [], "fetchedAt": None}
