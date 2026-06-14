"""
app/core/auth.py
────────────────
JWT creation/validation, password hashing, and FastAPI dependencies.
This file is the single place that touches security primitives.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.redis_client import cache_get, cache_set, key_session
from app.models.user import User

# ── Password hashing ──────────────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── JWT token creation ────────────────────────────────────────────────────────

def _create_token(data: dict, expires_delta: timedelta, token_type: str) -> str:
    """Internal token factory. Always includes jti (JWT ID) for revocation support."""
    now = datetime.now(timezone.utc)
    payload = {
        **data,
        "iat": now,
        "exp": now + expires_delta,
        "type": token_type,
        "jti": str(uuid.uuid4()),  # unique ID — stored in Redis for logout/revocation
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_access_token(user_id: str, email: str, plan: str) -> str:
    return _create_token(
        {"sub": user_id, "email": email, "plan": plan},
        timedelta(minutes=settings.access_token_expire_minutes),
        "access",
    )


def create_refresh_token(user_id: str) -> str:
    return _create_token(
        {"sub": user_id},
        timedelta(days=settings.refresh_token_expire_days),
        "refresh",
    )


# ── JWT validation ────────────────────────────────────────────────────────────

def _decode_token(token: str) -> dict:
    """Decode and validate a JWT. Raises HTTPException on any failure."""
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── FastAPI auth dependencies ─────────────────────────────────────────────────

async def get_current_user(
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Validate the access_token cookie and return the User model.
    Use this as a dependency on any protected route:

        async def my_route(user: User = Depends(get_current_user)):
    """
    if not access_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = _decode_token(access_token)

    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

    # Check if token has been revoked (logout sets this)
    jti = payload.get("jti")
    if jti and await cache_get(key_session(jti)) == "revoked":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user


async def get_current_user_refresh(
    refresh_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Dependency for the /auth/refresh endpoint — validates the refresh token."""
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")

    payload = _decode_token(refresh_token)

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user


# ── Plan enforcement dependency ───────────────────────────────────────────────

def require_plan(*plans: str):
    """
    Returns a dependency that enforces subscription plan access.
    Usage:
        @router.get("/exposure", dependencies=[Depends(require_plan("pro", "enterprise"))])
    """
    async def _check(user: User = Depends(get_current_user)) -> User:
        if user.plan not in plans:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This feature requires a {' or '.join(plans)} plan. "
                       f"Your current plan is '{user.plan}'.",
            )
        return user

    return _check


# ── Cookie helpers ────────────────────────────────────────────────────────────

def cookie_kwargs(name: str, value: str, max_age: int) -> dict:
    """Consistent cookie settings across all set-cookie calls."""
    return {
        "key": name,
        "value": value,
        "httponly": True,
        "secure": settings.is_production,   # HTTPS only in production
        "samesite": "strict",
        "max_age": max_age,
        "path": "/",
    }


ACCESS_COOKIE_MAX_AGE = settings.access_token_expire_minutes * 60
REFRESH_COOKIE_MAX_AGE = settings.refresh_token_expire_days * 86400
