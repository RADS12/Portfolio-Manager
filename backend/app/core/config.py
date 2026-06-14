"""
app/core/config.py
──────────────────
Single source of truth for all configuration.
Reads from environment variables (or .env file via python-dotenv).
Import `settings` anywhere in the app — never read os.environ directly.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.example",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ─────────────────────────────────────────────────────────────────
    app_env: str = "development"
    secret_key: str = "change-me-to-a-long-random-string-min-32-chars"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # ── Database ─────────────────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://portfolioiq:devpassword@localhost:5432/portfolioiq"
    database_url_sync: str = "postgresql://portfolioiq:devpassword@localhost:5432/portfolioiq"

    # ── Redis ────────────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # ── S3 / MinIO ───────────────────────────────────────────────────────────
    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket_name: str = "portfolioiq-uploads"
    s3_region: str = "us-east-1"

    # ── OAuth ────────────────────────────────────────────────────────────────
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/auth/google/callback"

    # ── Stripe ───────────────────────────────────────────────────────────────
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_pro_price_id: str = ""

    # ── CORS ─────────────────────────────────────────────────────────────────
    allowed_origins: str = "http://localhost:4200,http://127.0.0.1:4200"

    # ── Local data folder (CSV files) ────────────────────────────────────────
    data_dir: str = "/data"

    # ── Market data ──────────────────────────────────────────────────────────
    price_cache_minutes: int = 15
    holdings_cache_hours: int = 24

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    """
    Cached settings instance — instantiated once at startup.
    Use as a FastAPI dependency: settings: Settings = Depends(get_settings)
    Or import directly: from app.core.config import settings
    """
    return Settings()


settings = get_settings()
