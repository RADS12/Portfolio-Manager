"""
app/models/user.py  (also exports all models — import from here)
────────────────────────────────────────────────────────────────
SQLAlchemy ORM models — one class per database table.
All tables use UUID primary keys and timestamped rows.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, Numeric,
    String, Text, func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ── Users ─────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str | None] = mapped_column(Text, nullable=True)
    oauth_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    oauth_sub: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # Subscription
    plan: Mapped[str] = mapped_column(String(32), nullable=False, default="free")
    stripe_customer_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Metadata
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )

    # Relationships
    portfolios: Mapped[list["Portfolio"]] = relationship(
        "Portfolio", back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User {self.email} plan={self.plan}>"


# ── Portfolios ────────────────────────────────────────────────────────────────

class Portfolio(Base):
    __tablename__ = "portfolios"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False, default="My Portfolio")
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    csv_s3_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Soft delete — data is recoverable
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="portfolios")
    positions: Mapped[list["Position"]] = relationship(
        "Position", back_populates="portfolio", cascade="all, delete-orphan"
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    def __repr__(self) -> str:
        return f"<Portfolio {self.name} user={self.user_id}>"


# ── Positions ─────────────────────────────────────────────────────────────────

class Position(Base):
    """One row per symbol per portfolio upload. Replaced entirely on each CSV import."""
    __tablename__ = "positions"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    portfolio_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("portfolios.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    quantity: Mapped[float | None] = mapped_column(Numeric(20, 8), nullable=True)
    csv_price: Mapped[float | None] = mapped_column(Numeric(20, 4), nullable=True)
    csv_value: Mapped[float | None] = mapped_column(Numeric(20, 2), nullable=True)

    # Enriched from classification table
    name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    asset_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sector: Mapped[str | None] = mapped_column(String(128), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(128), nullable=True)
    theme: Mapped[str | None] = mapped_column(String(128), nullable=True)
    region: Mapped[str | None] = mapped_column(String(64), nullable=True)
    risk_bucket: Mapped[str | None] = mapped_column(String(64), nullable=True)

    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    # Relationships
    portfolio: Mapped["Portfolio"] = relationship("Portfolio", back_populates="positions")

    def __repr__(self) -> str:
        return f"<Position {self.symbol} portfolio={self.portfolio_id}>"


# ── Asset Classifications ─────────────────────────────────────────────────────

class AssetClassification(Base):
    """
    Shared lookup table — one row per ticker symbol.
    Loaded into memory at app startup for fast access (small table, rarely changes).
    Admin-editable; never exposed via public API.
    """
    __tablename__ = "asset_classifications"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    asset_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sector: Mapped[str | None] = mapped_column(String(128), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(128), nullable=True)
    theme: Mapped[str | None] = mapped_column(String(128), nullable=True)
    region: Mapped[str | None] = mapped_column(String(64), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


# ── Price Cache ───────────────────────────────────────────────────────────────

class PriceCache(Base):
    """
    Postgres-backed price cache — Redis is primary (fast), this is the durable fallback.
    If Redis is flushed, the API reads from here until Celery refreshes Redis.
    """
    __tablename__ = "price_cache"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    price: Mapped[float] = mapped_column(Numeric(20, 4), nullable=False)
    source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# ── Holdings Cache ────────────────────────────────────────────────────────────

class HoldingsCache(Base):
    """
    ETF/MF top-10 holdings stored as JSONB.
    [{"symbol": "NVDA", "name": "NVIDIA", "weight": 8.5, "source": "Yahoo Finance"}, ...]
    """
    __tablename__ = "holdings_cache"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    holdings: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# ── Refresh Jobs ──────────────────────────────────────────────────────────────

class RefreshJob(Base):
    """
    Audit log of background Celery jobs.
    The frontend polls /api/jobs/{job_id} to show progress bars.
    """
    __tablename__ = "refresh_jobs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    portfolio_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False), ForeignKey("portfolios.id", ondelete="SET NULL"), nullable=True
    )
    job_type: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    stage: Mapped[str | None] = mapped_column(String(128), nullable=True)
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
