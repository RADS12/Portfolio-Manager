"""
app/core/redis_client.py
────────────────────────
Shared Redis connection pool.
Import `redis_client` anywhere; it's a single connection pool shared by all requests.
"""
import json
from datetime import timedelta
from typing import Any

import redis.asyncio as aioredis

from app.core.config import settings

# Single pool — created once at module import, reused for the lifetime of the app
redis_client: aioredis.Redis = aioredis.from_url(
    settings.redis_url,
    encoding="utf-8",
    decode_responses=True,
)


# ── Typed helper wrappers ─────────────────────────────────────────────────────

async def cache_get(key: str) -> Any | None:
    """Return parsed JSON value or None if key doesn't exist."""
    raw = await redis_client.get(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


async def cache_set(key: str, value: Any, ttl: timedelta | int | None = None) -> None:
    """Store JSON-serialised value. ttl can be timedelta or seconds integer."""
    serialised = json.dumps(value, default=str)
    if ttl is None:
        await redis_client.set(key, serialised)
    elif isinstance(ttl, timedelta):
        await redis_client.setex(key, int(ttl.total_seconds()), serialised)
    else:
        await redis_client.setex(key, ttl, serialised)


async def cache_delete(key: str) -> None:
    await redis_client.delete(key)


async def cache_delete_pattern(pattern: str) -> None:
    """Delete all keys matching a glob pattern. Use sparingly — scans full keyspace."""
    keys = await redis_client.keys(pattern)
    if keys:
        await redis_client.delete(*keys)


# ── Cache key builders ────────────────────────────────────────────────────────
# Centralised here so key naming is consistent across the app.

def key_price(symbol: str) -> str:
    return f"price:{symbol.upper()}"


def key_holdings(symbol: str) -> str:
    return f"holdings:{symbol.upper()}"


def key_portfolio_summary(portfolio_id: str) -> str:
    return f"summary:{portfolio_id}"


def key_portfolio_exposure(portfolio_id: str) -> str:
    return f"exposure:{portfolio_id}"


def key_session(token_jti: str) -> str:
    return f"session:{token_jti}"


def key_rate_limit(user_id: str, action: str) -> str:
    return f"ratelimit:{action}:{user_id}"
