"""
app/schemas/schemas.py
──────────────────────
Pydantic v2 request/response shapes for all API endpoints.
"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field, field_validator


# ── Auth ──────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one number")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    email: str
    plan: str
    created_at: datetime


class TokenResponse(BaseModel):
    message: str
    user: UserResponse


# ── Portfolio ─────────────────────────────────────────────────────────────────

class PortfolioCreate(BaseModel):
    name: str = Field(default="My Portfolio", max_length=128)
    currency: str = Field(default="USD", max_length=8)


class PortfolioResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str
    currency: str
    created_at: datetime
    updated_at: datetime
    # These are computed in the API layer, not ORM fields
    position_count: int = 0
    total_value: float = 0.0


# ── Position ──────────────────────────────────────────────────────────────────

class PositionResponse(BaseModel):
    symbol: str
    name: str | None = None
    quantity: float | None = None
    last_price: float | None = None
    csv_price: float | None = None
    current_value: float | None = None
    csv_value: float | None = None
    asset_type: str | None = None
    sector: str | None = None
    industry: str | None = None
    theme: str | None = None
    region: str | None = None
    risk_bucket: str | None = None
    weight: float = 0.0
    price_source: str = "CSV snapshot"
    top_holdings: list[dict] = []
    top_holdings_source: str = ""


# ── Summary ───────────────────────────────────────────────────────────────────

class AllocationItem(BaseModel):
    name: str
    value: float
    weight: float
    count: int


class MarketDataInfo(BaseModel):
    pricing_mode: str
    live_priced_positions: int
    total_positions: int
    last_refresh_utc: datetime | None = None


class SummaryResponse(BaseModel):
    total_value: float
    position_count: int
    cash_value: float
    cash_weight: float
    top10_value: float
    top10_weight: float
    largest_holding: PositionResponse | None = None
    sector_allocation: list[AllocationItem]
    theme_allocation: list[AllocationItem]
    industry_allocation: list[AllocationItem]
    region_allocation: list[AllocationItem]
    asset_type_allocation: list[AllocationItem]
    risk_allocation: list[AllocationItem]
    market_data: MarketDataInfo


# ── Treemap ───────────────────────────────────────────────────────────────────

class TreemapChild(BaseModel):
    symbol: str
    name: str | None = None
    current_value: float
    weight: float
    asset_type: str | None = None
    sector: str | None = None
    theme: str | None = None
    risk_bucket: str | None = None


class TreemapGroup(BaseModel):
    name: str
    value: float
    weight: float
    children: list[TreemapChild] = []


# ── True Exposure ─────────────────────────────────────────────────────────────

class ExposureSource(BaseModel):
    fund: str
    fund_name: str | None = None
    fund_weight: float
    holding_weight: float
    value: float


class TrueExposureItem(BaseModel):
    symbol: str
    name: str
    value: float
    weight: float
    source_count: int
    is_major: bool
    sector: str | None = None
    industry: str | None = None
    theme: str | None = None
    region: str | None = None
    sources: list[ExposureSource] = []


class ExposureResponse(BaseModel):
    as_of_utc: datetime
    method: str
    exposures: list[TrueExposureItem]


# ── Job ───────────────────────────────────────────────────────────────────────

class JobStatusResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    job_type: str
    status: str
    stage: str | None = None
    progress: int
    message: str | None = None
    started_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


# ── Upload ────────────────────────────────────────────────────────────────────

class UploadResponse(BaseModel):
    message: str
    filename: str
    position_count: int
    job_id: str


# ── Health ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    version: str
    environment: str
    database: str
    redis: str
