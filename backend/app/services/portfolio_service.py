"""
app/services/portfolio_service.py
──────────────────────────────────
All portfolio business logic lives here — never in route handlers.
Route handlers are thin: validate input → call service → return response.
"""
import io
import math
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis_client import (
    cache_delete,
    cache_get,
    cache_set,
    key_holdings,
    key_portfolio_exposure,
    key_portfolio_summary,
    key_price,
)
from app.models.user import (
    AssetClassification,
    HoldingsCache,
    Portfolio,
    Position,
    PriceCache,
)
from app.schemas.schemas import (
    AllocationItem,
    ExposureResponse,
    PositionResponse,
    SummaryResponse,
    TreemapGroup,
    TrueExposureItem,
)

# ── Helpers ───────────────────────────────────────────────────────────────────

def _money_to_float(value) -> float:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return 0.0
    text = str(value).replace("$", "").replace(",", "").strip()
    try:
        return float(text or 0)
    except ValueError:
        return 0.0


def _risk_bucket(asset_type: str, theme: str) -> str:
    if (asset_type or "").lower() == "cash":
        return "Cash / Defensive"
    if "leveraged" in (asset_type or "").lower():
        return "Very High Risk"
    if theme in {"Speculative AI", "Space Economy", "Crypto Infrastructure"}:
        return "Very High Risk"
    if theme in {"AI Infrastructure", "AI Semiconductors", "Quantum / AI", "AI / Robotics"}:
        return "High Growth / High Volatility"
    if theme in {"Healthcare Diversifier", "Materials Diversifier", "Value Diversifier",
                 "Financials Diversifier"}:
        return "Diversifier"
    return "Core / Moderate Risk"


def _is_fund(asset_type: str | None) -> bool:
    t = (asset_type or "").lower()
    return "etf" in t or "fund" in t or "mutual" in t


def _is_cash(asset_type: str | None, symbol: str) -> bool:
    return (asset_type or "").lower() == "cash" or symbol.upper() in {"SPAXX", "CASH"}


# ── Classification loader (in-memory cache) ───────────────────────────────────

_classification_cache: dict[str, AssetClassification] = {}


async def load_classifications(db: AsyncSession) -> dict[str, AssetClassification]:
    """Load all classifications into memory once. Reset on app restart."""
    global _classification_cache
    if not _classification_cache:
        result = await db.execute(select(AssetClassification))
        _classification_cache = {row.symbol: row for row in result.scalars()}
    return _classification_cache


def invalidate_classification_cache() -> None:
    global _classification_cache
    _classification_cache = {}


# ── CSV parsing ───────────────────────────────────────────────────────────────

async def parse_and_store_csv(
    csv_bytes: bytes,
    portfolio_id: str,
    db: AsyncSession,
) -> int:
    """
    Parse a CSV upload and replace all positions for the portfolio.
    Returns the number of positions stored.
    Raises ValueError with a user-friendly message on bad CSV.
    """
    try:
        df = pd.read_csv(io.BytesIO(csv_bytes))
    except Exception as e:
        raise ValueError(f"Could not read CSV: {e}")

    required_cols = {"Symbol", "Current Value"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(f"CSV is missing required columns: {missing}")

    # Normalise
    df["Symbol"] = df["Symbol"].astype(str).str.replace("**", "", regex=False).str.upper().str.strip()
    df["csv_value"] = df["Current Value"].apply(_money_to_float)
    df["csv_price"] = df.get("Last Price", pd.Series(dtype=str)).apply(_money_to_float)
    df["quantity"] = df.get("Quantity", pd.Series(dtype=float)).fillna(0).apply(_money_to_float)

    # Aggregate duplicate symbols
    grouped = df.groupby("Symbol", as_index=False).agg({
        "quantity": "sum",
        "csv_value": "sum",
        "csv_price": "last",
    })

    # Remove blanks / cash-only rows with no symbol
    grouped = grouped[grouped["Symbol"].str.len() > 0]
    grouped = grouped[grouped["Symbol"] != "NAN"]

    classifications = await load_classifications(db)

    # Delete existing positions for this portfolio
    await db.execute(delete(Position).where(Position.portfolio_id == portfolio_id))

    positions = []
    for _, row in grouped.iterrows():
        symbol = row["Symbol"]
        cls = classifications.get(symbol)
        asset_type = cls.asset_type if cls else "Unknown"
        theme = cls.theme if cls else "Unclassified"

        positions.append(Position(
            portfolio_id=portfolio_id,
            symbol=symbol,
            quantity=float(row["quantity"]),
            csv_price=float(row["csv_price"]),
            csv_value=float(row["csv_value"]),
            name=cls.name if cls else symbol,
            asset_type=asset_type,
            sector=cls.sector if cls else "Unclassified",
            industry=cls.industry if cls else "Unclassified",
            theme=theme,
            region=cls.region if cls else "Unknown",
            risk_bucket=_risk_bucket(asset_type, theme),
        ))

    db.add_all(positions)

    # Invalidate any cached summary/exposure for this portfolio
    await cache_delete(key_portfolio_summary(portfolio_id))
    await cache_delete(key_portfolio_exposure(portfolio_id))

    return len(positions)


# ── Position enrichment ───────────────────────────────────────────────────────

async def _get_live_price(symbol: str, db: AsyncSession) -> float | None:
    """Redis first, then Postgres price_cache fallback."""
    cached = await cache_get(key_price(symbol))
    if cached:
        return float(cached.get("price", 0)) or None

    result = await db.execute(select(PriceCache).where(PriceCache.symbol == symbol))
    row = result.scalar_one_or_none()
    return float(row.price) if row else None


async def _get_holdings(symbol: str, db: AsyncSession) -> list[dict]:
    """Redis first, then Postgres holdings_cache fallback."""
    cached = await cache_get(key_holdings(symbol))
    if cached:
        return cached if isinstance(cached, list) else []

    result = await db.execute(select(HoldingsCache).where(HoldingsCache.symbol == symbol))
    row = result.scalar_one_or_none()
    if row and row.holdings:
        return row.holdings if isinstance(row.holdings, list) else []
    return []


async def get_positions(
    portfolio_id: str,
    db: AsyncSession,
    use_live_prices: bool = False,
    include_holdings: bool = False,
) -> list[PositionResponse]:
    """
    Load positions from DB, optionally enrich with live prices and holdings.
    Always fast — live data comes from cache, never from blocking HTTP calls.
    """
    result = await db.execute(
        select(Position).where(Position.portfolio_id == portfolio_id)
    )
    rows = result.scalars().all()
    if not rows:
        return []

    enriched = []
    for pos in rows:
        csv_value = float(pos.csv_value or 0)
        csv_price = float(pos.csv_price or 0)
        qty = float(pos.quantity or 0)

        live_price = None
        if use_live_prices and not _is_cash(pos.asset_type, pos.symbol):
            live_price = await _get_live_price(pos.symbol, db)

        if live_price and qty > 0:
            value = qty * live_price
            price = live_price
            price_source = "Yahoo Finance (cached)"
        else:
            value = csv_value
            price = csv_price
            price_source = "CSV snapshot"

        holdings: list[dict] = []
        holdings_source = ""
        if include_holdings and _is_fund(pos.asset_type):
            holdings = await _get_holdings(pos.symbol, db)
            holdings_source = "Cache" if holdings else "Not available"

        enriched.append(PositionResponse(
            symbol=pos.symbol,
            name=pos.name,
            quantity=qty,
            last_price=round(price, 4),
            csv_price=round(csv_price, 4),
            current_value=round(value, 2),
            csv_value=round(csv_value, 2),
            asset_type=pos.asset_type,
            sector=pos.sector,
            industry=pos.industry,
            theme=pos.theme,
            region=pos.region,
            risk_bucket=pos.risk_bucket,
            price_source=price_source,
            top_holdings=holdings[:10],
            top_holdings_source=holdings_source,
        ))

    # Compute portfolio weights
    total = sum(p.current_value or 0 for p in enriched)
    for p in enriched:
        p.weight = round((p.current_value or 0) / total * 100, 4) if total else 0.0

    return sorted(enriched, key=lambda x: x.current_value or 0, reverse=True)


# ── Aggregation helpers ───────────────────────────────────────────────────────

def _aggregate(positions: list[PositionResponse], key: str) -> list[AllocationItem]:
    total = sum(p.current_value or 0 for p in positions)
    buckets: dict[str, dict] = {}
    for p in positions:
        name = getattr(p, key, "Unclassified") or "Unclassified"
        b = buckets.setdefault(name, {"value": 0.0, "count": 0})
        b["value"] += p.current_value or 0
        b["count"] += 1
    return sorted(
        [AllocationItem(name=k, value=round(v["value"], 2),
                        weight=round(v["value"] / total * 100, 2) if total else 0,
                        count=v["count"])
         for k, v in buckets.items()],
        key=lambda x: x.value, reverse=True,
    )


async def get_summary(
    portfolio_id: str,
    db: AsyncSession,
    use_live_prices: bool = False,
) -> SummaryResponse:
    """Build portfolio summary with 2-minute Redis cache."""
    cache_key = key_portfolio_summary(portfolio_id)
    cached = await cache_get(cache_key)
    if cached and not use_live_prices:
        return SummaryResponse(**cached)

    positions = await get_positions(portfolio_id, db, use_live_prices=use_live_prices)
    if not positions:
        raise ValueError("No positions found for this portfolio")

    total = sum(p.current_value or 0 for p in positions)
    cash = sum(p.current_value or 0 for p in positions if _is_cash(p.asset_type, p.symbol))
    top10 = sum(p.current_value or 0 for p in positions[:10])
    live_count = sum(1 for p in positions if "Yahoo" in p.price_source)

    summary = SummaryResponse(
        total_value=round(total, 2),
        position_count=len(positions),
        cash_value=round(cash, 2),
        cash_weight=round(cash / total * 100, 2) if total else 0,
        top10_value=round(top10, 2),
        top10_weight=round(top10 / total * 100, 2) if total else 0,
        largest_holding=positions[0] if positions else None,
        sector_allocation=_aggregate(positions, "sector"),
        theme_allocation=_aggregate(positions, "theme"),
        industry_allocation=_aggregate(positions, "industry"),
        region_allocation=_aggregate(positions, "region"),
        asset_type_allocation=_aggregate(positions, "asset_type"),
        risk_allocation=_aggregate(positions, "risk_bucket"),
        market_data={
            "pricing_mode": "Live prices from cache + CSV fallback",
            "live_priced_positions": live_count,
            "total_positions": len(positions),
            "last_refresh_utc": datetime.now(timezone.utc),
        },
    )

    # Cache for 2 minutes
    from datetime import timedelta
    await cache_set(cache_key, summary.model_dump(mode="json"), ttl=timedelta(minutes=2))
    return summary


async def get_treemap(
    portfolio_id: str,
    db: AsyncSession,
    group_by: str = "sector",
) -> list[TreemapGroup]:
    """Build treemap data grouped by any position field."""
    allowed = {"sector", "theme", "industry", "region", "asset_type", "risk_bucket"}
    key = group_by if group_by in allowed else "sector"

    positions = await get_positions(portfolio_id, db)
    groups: dict[str, list] = {}
    for p in positions:
        name = getattr(p, key, "Unclassified") or "Unclassified"
        groups.setdefault(name, []).append(p)

    total = sum(p.current_value or 0 for p in positions)
    result = []
    for group_name, group_positions in groups.items():
        group_value = sum(p.current_value or 0 for p in group_positions)
        result.append(TreemapGroup(
            name=group_name,
            value=round(group_value, 2),
            weight=round(group_value / total * 100, 2) if total else 0,
            children=[],  # populated by client from position list
        ))
    return sorted(result, key=lambda x: x.value, reverse=True)


async def get_true_exposure(
    portfolio_id: str,
    db: AsyncSession,
    use_live_prices: bool = False,
) -> ExposureResponse:
    """
    Build look-through exposure. Funds are unwrapped using cached top holdings.
    Result cached for 5 minutes in Redis.
    """
    from datetime import timedelta
    cache_key = key_portfolio_exposure(portfolio_id)
    cached = await cache_get(cache_key)
    if cached and not use_live_prices:
        return ExposureResponse(**cached)

    positions = await get_positions(
        portfolio_id, db,
        use_live_prices=use_live_prices,
        include_holdings=True,
    )
    total = sum(p.current_value or 0 for p in positions)
    classifications_map = await load_classifications(db)
    exposure: dict[str, dict] = {}

    def _add(symbol: str, name: str, value: float, source: dict) -> None:
        symbol = symbol.upper().strip()
        if not symbol or _is_cash(None, symbol):
            return
        cls = classifications_map.get(symbol)
        if cls and _is_fund(cls.asset_type):
            return  # don't include fund wrappers in true exposure
        row = exposure.setdefault(symbol, {
            "symbol": symbol,
            "name": (cls.name if cls else name) or symbol,
            "value": 0.0,
            "sources": [],
            "sector": cls.sector if cls else "Unclassified",
            "industry": cls.industry if cls else "Unclassified",
            "theme": cls.theme if cls else "Unclassified",
            "region": cls.region if cls else "Unknown",
        })
        row["value"] += value
        row["sources"].append(source)

    for pos in positions:
        if _is_cash(pos.asset_type, pos.symbol):
            continue
        val = pos.current_value or 0
        if _is_fund(pos.asset_type) and pos.top_holdings:
            for h in pos.top_holdings[:10]:
                w = float(h.get("weight", 0) or 0)
                child_val = val * w / 100
                _add(
                    h.get("symbol") or h.get("name") or "UNKNOWN",
                    h.get("name", ""),
                    child_val,
                    {"fund": pos.symbol, "fund_name": pos.name, "fund_weight": pos.weight,
                     "holding_weight": w, "value": round(child_val, 2)},
                )
        elif not _is_fund(pos.asset_type):
            _add(pos.symbol, pos.name or pos.symbol, val,
                 {"fund": "Direct", "fund_name": pos.name, "fund_weight": pos.weight,
                  "holding_weight": 100.0, "value": round(val, 2)})

    items = []
    for row in exposure.values():
        row["value"] = round(row["value"], 2)
        row["weight"] = round(row["value"] / total * 100, 4) if total else 0
        row["source_count"] = len(row["sources"])
        row["is_major"] = row["weight"] >= 1.0
        items.append(TrueExposureItem(**row))

    result = ExposureResponse(
        as_of_utc=datetime.now(timezone.utc),
        method="Stock-only: direct positions + ETF/MF top-10 look-through. "
               "Fund wrappers and cash excluded.",
        exposures=sorted(items, key=lambda x: x.value, reverse=True),
    )
    await cache_set(cache_key, result.model_dump(mode="json"), ttl=timedelta(minutes=5))
    return result
