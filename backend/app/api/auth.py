"""
app/api/auth.py
───────────────
Authentication routes: register, login, refresh, logout, me.
All tokens travel in httpOnly cookies — never in response bodies.
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import (
    ACCESS_COOKIE_MAX_AGE,
    REFRESH_COOKIE_MAX_AGE,
    cookie_kwargs,
    create_access_token,
    create_refresh_token,
    get_current_user,
    get_current_user_refresh,
    hash_password,
    verify_password,
)
from app.core.database import get_db
from app.models.user import User
from app.schemas.schemas import LoginRequest, RegisterRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_auth_cookies(response: Response, user: User) -> None:
    """Set both access and refresh token cookies on a response object."""
    access_token = create_access_token(user.id, user.email, user.plan)
    refresh_token = create_refresh_token(user.id)
    response.set_cookie(**cookie_kwargs("access_token", access_token, ACCESS_COOKIE_MAX_AGE))
    response.set_cookie(**cookie_kwargs("refresh_token", refresh_token, REFRESH_COOKIE_MAX_AGE))


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Create a new account. Returns user info; sets auth cookies."""
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.flush()   # get the generated ID before commit

    _set_auth_cookies(response, user)
    return TokenResponse(message="Account created", user=UserResponse.model_validate(user))


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Validate credentials. Sets auth cookies on success."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    _set_auth_cookies(response, user)
    return TokenResponse(message="Logged in", user=UserResponse.model_validate(user))


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    user: User = Depends(get_current_user_refresh),
) -> TokenResponse:
    """
    Exchange a valid refresh token for fresh access + refresh tokens.
    Angular AuthInterceptor calls this silently when a 401 is received.
    """
    _set_auth_cookies(response, user)
    return TokenResponse(message="Tokens refreshed", user=UserResponse.model_validate(user))


@router.post("/logout")
async def logout(response: Response) -> dict:
    """Clear auth cookies. The next request will be unauthenticated."""
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)) -> UserResponse:
    """Return the current authenticated user's profile."""
    return UserResponse.model_validate(user)
