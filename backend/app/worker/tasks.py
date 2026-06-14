"""
app/worker/tasks.py
────────────────────
All Celery background tasks.
Tasks are short functions that delegate to service modules.
They never import FastAPI or the async SQLAlchemy session —
they use synchronous SQLAlchemy (psycopg2) instead.
"""
import logging
from datetime import datetime, timedelta, timezone

import requests
from celery import Celery
from celery.schedules import crontab
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Celery app ────────────────────────────────────────────────────────────────

celery_app = Celery(
    "portfolioiq",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,           # re-queue if worker dies mid-task
    worker_prefetch_multiplier=1,  # fair task distribution
    # Scheduled tasks (Celery Beat)
    beat_schedule={
        "daily-cache-warmup": {
            "task": "app.worker.tasks.daily_cache_warmup",
            "schedule": crontab(hour=9, minute=30, day_of_week="1-5"),  # 9:30 AM UTC weekdays
        },
    },
)

# ── Synchronous DB session for Celery tasks ───────────────────────────────────
# Celery workers are sync processes — use psycopg2 (not asyncpg)

_sync_engine = create_engine(settings.database_url_sync, pool_pre_ping=True)


def _get_sync_session() -> Session:
    return Session(_sync_engine)


# ── Synchronous Redis client for Celery tasks ─────────────────────────────────
import redis as sync_redis

_redis = sync_redis.from_url(settings.redis_url, decode_responses=True)


def _cache_set_sync(key: str, value, ttl_seconds: int) -> None:
    import json
    _redis.setex(key, ttl_seconds, json.dumps(value, default=str))


def _cache_get_sync(key: str):
    import json
    raw = _redis.get(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return raw


# ── Market data fetchers ──────────────────────────────────────────────────────

def _fetch_prices_yfinance(symbols: list[str]) -> dict[str, float]:
    """Fetch latest close prices for a list of symbols via yfinance."""
    try:
        import yfinance as yf
        if not symbols:
            return {}
        data = yf.download(
            tickers=" ".join(symbols),
            period="2d",
            interval="1d",
            progress=False,
            threads=True,
            auto_adjust=False,
            group_by="ticker",
        )
        prices = {}
        for symbol in symbols:
            try:
                if len(symbols) == 1:
                    series = data["Close"].dropna()
                else:
                    series = data[symbol]["Close"].dropna()
                if len(series):
                    prices[symbol] = round(float(series.iloc[-1]), 4)
            except Exception:
                pass
        return prices
    except Exception as e:
        logger.error(f"yfinance price fetch failed: {e}")
        return {}


def _fetch_holdings_yahoo(symbol: str) -> list[dict]:
    """Fetch ETF/MF top holdings from Yahoo Finance quoteSummary API."""
    try:
        url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}"
        headers = {"User-Agent": "Mozilla/5.0 PortfolioIQ/1.0"}
        resp = requests.get(url, params={"modules": "topHoldings"}, headers=headers, timeout=8)
        resp.raise_for_status()
        result = resp.json().get("quoteSummary", {}).get("result") or []
        if not result:
            return []
        holdings = result[0].get("topHoldings", {}).get("holdings") or []
        output = []
        for h in holdings[:10]:
            sym = str(h.get("symbol", "")).upper().strip()
            name = h.get("holdingName") or sym
            weight_raw = h.get("holdingPercent", {})
            weight = weight_raw.get("raw", 0) if isinstance(weight_raw, dict) else weight_raw
            weight = float(weight or 0)
            if weight <= 1:
                weight *= 100
            if sym:
                output.append({"symbol": sym, "name": name, "weight": round(weight, 4),
                                "source": "Yahoo Finance"})
        return output
    except Exception as e:
        logger.warning(f"Yahoo holdings fetch failed for {symbol}: {e}")
        return []


# ── Tasks ─────────────────────────────────────────────────────────────────────

@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def refresh_portfolio_prices(self, portfolio_id: str, job_id: str) -> dict:
    """
    Fetch live prices for all symbols in a portfolio.
    Called automatically after every CSV upload.
    Also triggered by the user clicking "Refresh Prices".
    """
    from app.models.user import PriceCache, Position, RefreshJob

    with _get_sync_session() as db:
        # Update job: running
        db.execute(
            update(RefreshJob).where(RefreshJob.id == job_id).values(
                status="running", stage="Loading positions", progress=5,
                message="Fetching live prices from Yahoo Finance..."
            )
        )
        db.commit()

        # Get all symbols for this portfolio (exclude cash)
        positions = db.execute(
            select(Position).where(Position.portfolio_id == portfolio_id)
        ).scalars().all()

        symbols = [
            p.symbol for p in positions
            if (p.asset_type or "").lower() != "cash"
            and p.symbol not in {"SPAXX"}
        ]

        if not symbols:
            db.execute(update(RefreshJob).where(RefreshJob.id == job_id).values(
                status="complete", progress=100, stage="Done",
                message="No non-cash symbols to refresh.", completed_at=datetime.now(timezone.utc)
            ))
            db.commit()
            return {"refreshed": 0}

        db.execute(update(RefreshJob).where(RefreshJob.id == job_id).values(
            progress=20, stage="Fetching prices",
            message=f"Fetching prices for {len(symbols)} symbols..."
        ))
        db.commit()

        prices = _fetch_prices_yfinance(symbols)

        now = datetime.now(timezone.utc)
        for symbol, price in prices.items():
            # Write to Redis
            _cache_set_sync(f"price:{symbol}", {"price": price, "fetched_at": now.isoformat()},
                            ttl_seconds=settings.price_cache_minutes * 60)

            # Write to Postgres price_cache (durable fallback)
            existing = db.execute(select(PriceCache).where(PriceCache.symbol == symbol)).scalar_one_or_none()
            if existing:
                existing.price = price
                existing.fetched_at = now
                existing.source = "Yahoo Finance"
            else:
                db.add(PriceCache(symbol=symbol, price=price, fetched_at=now, source="Yahoo Finance"))

        db.execute(update(RefreshJob).where(RefreshJob.id == job_id).values(
            status="complete", progress=100, stage="Complete",
            message=f"Prices refreshed for {len(prices)} of {len(symbols)} symbols.",
            completed_at=now,
        ))
        db.commit()

    return {"refreshed": len(prices), "total": len(symbols)}


@celery_app.task(bind=True, max_retries=2, default_retry_delay=120)
def refresh_etf_holdings(self, symbol: str) -> dict:
    """
    Fetch top-10 holdings for one ETF/MF symbol.
    Tries Yahoo Finance first; could add MSN fallback here.
    """
    from app.models.user import HoldingsCache

    holdings = _fetch_holdings_yahoo(symbol)
    if not holdings:
        logger.warning(f"No holdings found for {symbol}")
        return {"symbol": symbol, "count": 0}

    now = datetime.now(timezone.utc)
    _cache_set_sync(f"holdings:{symbol}", holdings,
                    ttl_seconds=settings.holdings_cache_hours * 3600)

    with _get_sync_session() as db:
        existing = db.execute(
            select(HoldingsCache).where(HoldingsCache.symbol == symbol)
        ).scalar_one_or_none()
        if existing:
            existing.holdings = holdings
            existing.fetched_at = now
            existing.source = "Yahoo Finance"
        else:
            db.add(HoldingsCache(
                symbol=symbol, holdings=holdings,
                source="Yahoo Finance", fetched_at=now,
            ))
        db.commit()

    return {"symbol": symbol, "count": len(holdings)}


@celery_app.task
def daily_cache_warmup() -> dict:
    """
    Scheduled task — runs at market open (9:30 AM UTC weekdays).
    Pre-warms price and holdings cache for all active portfolios.
    """
    from app.models.user import Portfolio, Position

    with _get_sync_session() as db:
        # Get all active portfolios
        portfolios = db.execute(
            select(Portfolio).where(Portfolio.deleted_at.is_(None))
        ).scalars().all()

        all_symbols: set[str] = set()
        etf_symbols: set[str] = set()

        for portfolio in portfolios:
            positions = db.execute(
                select(Position).where(Position.portfolio_id == portfolio.id)
            ).scalars().all()
            for pos in positions:
                if (pos.asset_type or "").lower() != "cash":
                    all_symbols.add(pos.symbol)
                t = (pos.asset_type or "").lower()
                if "etf" in t or "fund" in t or "mutual" in t:
                    etf_symbols.add(pos.symbol)

    # Enqueue individual tasks (parallel execution)
    for symbol in etf_symbols:
        refresh_etf_holdings.delay(symbol)

    # Price refresh as a single batch
    prices = _fetch_prices_yfinance(list(all_symbols))
    now = datetime.now(timezone.utc)
    for symbol, price in prices.items():
        _cache_set_sync(f"price:{symbol}", {"price": price, "fetched_at": now.isoformat()},
                        ttl_seconds=settings.price_cache_minutes * 60)

    logger.info(f"Daily warmup: {len(prices)} prices, {len(etf_symbols)} ETF holdings queued")
    return {
        "portfolios": len(portfolios),
        "prices_refreshed": len(prices),
        "etf_jobs_queued": len(etf_symbols),
    }
