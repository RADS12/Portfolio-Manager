"""
app/core/seeder.py
──────────────────
Runs at API startup. Does three things in order:
  1. Import asset classifications from classification.json into DB
  2. Create local dev user + default portfolio if they don't exist
  3. Load the latest CSV from DATA_DIR into the portfolio

Re-enriches positions with classification data every startup so
adding new classifications to the JSON takes effect on next restart.
"""
import json
import logging
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

logger = logging.getLogger(__name__)


def _find_latest_csv() -> Path | None:
    data_dir = Path(settings.data_dir)
    if not data_dir.exists():
        logger.warning("Seeder: DATA_DIR %s does not exist", settings.data_dir)
        return None
    csvs = sorted(data_dir.glob("*.csv"), key=lambda p: p.stat().st_mtime, reverse=True)
    return csvs[0] if csvs else None


def _find_classification_json() -> Path | None:
    data_dir = Path(settings.data_dir)
    path = data_dir / "classification.json"
    return path if path.exists() else None


async def _seed_classifications(db: AsyncSession) -> dict:
    """
    Load classification.json into the asset_classifications table.
    Upserts every symbol — safe to run on every restart.
    Returns the classification dict for immediate use in position enrichment.
    """
    from app.models.user import AssetClassification

    json_path = _find_classification_json()
    if not json_path:
        logger.warning("Seeder: classification.json not found in %s", settings.data_dir)
        return {}

    raw: dict = json.loads(json_path.read_text(encoding="utf-8"))
    logger.info("Seeder: importing %d classifications from %s", len(raw), json_path.name)

    for symbol, meta in raw.items():
        symbol = symbol.upper().strip()
        # Check if exists
        result = await db.execute(
            select(AssetClassification).where(AssetClassification.symbol == symbol)
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.name       = meta.get("name", symbol)
            existing.asset_type = meta.get("assetType")
            existing.sector     = meta.get("sector")
            existing.industry   = meta.get("industry")
            existing.theme      = meta.get("theme")
            existing.region     = meta.get("region")
        else:
            db.add(AssetClassification(
                symbol      = symbol,
                name        = meta.get("name", symbol),
                asset_type  = meta.get("assetType"),
                sector      = meta.get("sector"),
                industry    = meta.get("industry"),
                theme       = meta.get("theme"),
                region      = meta.get("region"),
            ))

    await db.flush()
    logger.info("Seeder: classifications upserted")
    return {k.upper(): v for k, v in raw.items()}


def _risk_bucket(asset_type: str, theme: str) -> str:
    if (asset_type or "").lower() == "cash":
        return "Cash / Defensive"
    if "leveraged" in (asset_type or "").lower():
        return "Very High Risk"
    if theme in {"Speculative AI", "Space Economy", "Crypto Infrastructure"}:
        return "Very High Risk"
    if theme in {"AI Infrastructure", "AI Semiconductors", "Quantum / AI", "AI / Robotics"}:
        return "High Growth / High Volatility"
    if theme in {"Healthcare Diversifier", "Materials Diversifier",
                 "Value Diversifier", "Financials Diversifier"}:
        return "Diversifier"
    return "Core / Moderate Risk"


async def _reenrich_positions(db: AsyncSession, portfolio_id: str, classifications: dict) -> int:
    """
    Update all positions in a portfolio with classification data.
    Called after CSV load AND after classification import so data is always fresh.
    """
    from app.models.user import Position

    result = await db.execute(
        select(Position).where(Position.portfolio_id == portfolio_id)
    )
    positions = result.scalars().all()
    updated = 0

    for pos in positions:
        meta = classifications.get(pos.symbol.upper())
        if not meta:
            continue
        asset_type = meta.get("assetType", pos.asset_type or "Unknown")
        theme      = meta.get("theme",     pos.theme     or "Unclassified")
        pos.name       = meta.get("name", pos.symbol)
        pos.asset_type = asset_type
        pos.sector     = meta.get("sector",   "Unclassified")
        pos.industry   = meta.get("industry", "Unclassified")
        pos.theme      = theme
        pos.region     = meta.get("region",   "Unknown")
        pos.risk_bucket = _risk_bucket(asset_type, theme)
        updated += 1

    await db.flush()
    return updated


async def seed_default_portfolio(db: AsyncSession) -> None:
    from app.models.user import Portfolio, Position, User
    from app.services.portfolio_service import parse_and_store_csv

    # ── Step 1: Import classifications ───────────────────────────────────────
    classifications = await _seed_classifications(db)

    # ── Step 2: Find or create local dev user ─────────────────────────────────
    result = await db.execute(select(User).limit(1))
    user = result.scalar_one_or_none()

    if not user:
        user = User(
            email="admin@local.dev",
            hashed_password="no-auth-local-dev",
            plan="pro",
        )
        db.add(user)
        await db.flush()
        logger.info("Seeder: created local dev user id=%s", user.id)

    # ── Step 3: Find or create default portfolio ──────────────────────────────
    result = await db.execute(
        select(Portfolio).where(
            Portfolio.user_id == user.id,
            Portfolio.deleted_at.is_(None),
        ).limit(1)
    )
    portfolio = result.scalar_one_or_none()

    if not portfolio:
        portfolio = Portfolio(user_id=user.id, name="My Portfolio", currency="USD")
        db.add(portfolio)
        await db.flush()
        logger.info("Seeder: created portfolio id=%s", portfolio.id)

    # ── Step 4: Load CSV if no positions yet ──────────────────────────────────
    result = await db.execute(
        select(Position).where(Position.portfolio_id == portfolio.id).limit(1)
    )
    has_positions = result.scalar_one_or_none() is not None

    if not has_positions:
        csv_path = _find_latest_csv()
        if csv_path:
            csv_bytes = csv_path.read_bytes()
            count = await parse_and_store_csv(csv_bytes, portfolio.id, db)
            logger.info("Seeder: loaded %d positions from %s", count, csv_path.name)
        else:
            logger.warning("Seeder: no CSV found in %s", settings.data_dir)
            return

    # ── Step 5: Re-enrich all positions with classification data ──────────────
    # Runs every startup — picks up any new classifications added to the JSON
    if classifications:
        updated = await _reenrich_positions(db, portfolio.id, classifications)
        logger.info("Seeder: enriched %d positions with classification data", updated)

        # Invalidate any cached summary so fresh data is served
        from app.core.redis_client import cache_delete, key_portfolio_summary, key_portfolio_exposure
        await cache_delete(key_portfolio_summary(portfolio.id))
        await cache_delete(key_portfolio_exposure(portfolio.id))

        # Invalidate in-memory classification cache so next API call reloads from DB
        from app.services.portfolio_service import invalidate_classification_cache
        invalidate_classification_cache()
        logger.info("Seeder: classification cache cleared — fresh data ready")
