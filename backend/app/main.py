"""
app/main.py
───────────
FastAPI application factory.
"""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import settings

logging.basicConfig(
    level=logging.DEBUG if not settings.is_production else logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    app = FastAPI(
        title="PortfolioIQ API",
        version="1.0.0",
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
    )

    limiter = Limiter(key_func=get_remote_address)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.api.auth import router as auth_router
    from app.api.portfolios import router as portfolios_router
    app.include_router(auth_router, prefix="/api")
    app.include_router(portfolios_router, prefix="/api")

    @app.on_event("startup")
    async def startup() -> None:
        logger.info(f"PortfolioIQ API starting (env={settings.app_env})")

        # Step 1 — create all DB tables directly from models (safe, idempotent)
        try:
            from app.core.database import engine, Base
            from app.models import user as _models  # noqa — registers all models with Base
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            logger.info("DB tables ready")
        except Exception as e:
            logger.error(f"DB table creation failed: {e}", exc_info=True)
            return

        # Step 2 — seed default portfolio from CSV in /data
        try:
            from app.core.database import AsyncSessionLocal
            from app.core.seeder import seed_default_portfolio
            async with AsyncSessionLocal() as db:
                await seed_default_portfolio(db)
                await db.commit()
        except Exception as e:
            logger.error(f"Seeder failed: {e}", exc_info=True)

    @app.get("/api/health", tags=["system"])
    async def health() -> dict:
        from app.core.database import engine
        from app.core.redis_client import redis_client
        import sqlalchemy

        db_status = "ok"
        try:
            async with engine.connect() as conn:
                await conn.execute(sqlalchemy.text("SELECT 1"))
        except Exception as e:
            db_status = f"error: {e}"

        redis_status = "ok"
        try:
            await redis_client.ping()
        except Exception as e:
            redis_status = f"error: {e}"

        return {
            "status": "ok" if db_status == "ok" and redis_status == "ok" else "degraded",
            "version": "1.0.0",
            "environment": settings.app_env,
            "database": db_status,
            "redis": redis_status,
        }

    return app


app = create_app()


# ── Debug endpoint (dev only) — remove before production ──────────────────────
@app.get("/api/debug", tags=["system"])
async def debug() -> dict:
    """Shows DB state — useful for diagnosing seeder issues."""
    if settings.is_production:
        from fastapi import HTTPException
        raise HTTPException(status_code=404)

    from app.core.database import AsyncSessionLocal
    from app.models.user import User, Portfolio, Position
    from sqlalchemy import select, func

    async with AsyncSessionLocal() as db:
        users = (await db.execute(select(func.count()).select_from(User))).scalar()
        portfolios_result = await db.execute(select(Portfolio))
        portfolios = portfolios_result.scalars().all()
        positions = (await db.execute(select(func.count()).select_from(Position))).scalar()

    return {
        "users": users,
        "portfolios": [{"id": p.id, "name": p.name} for p in portfolios],
        "positions": positions,
        "data_dir": settings.data_dir,
    }
