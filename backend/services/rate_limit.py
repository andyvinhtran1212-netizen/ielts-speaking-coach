"""
services/rate_limit.py — per-user, per-exercise-type daily rate limiter.

Counts rows in `vocabulary_exercise_attempts` for the calling user since the
start of today (UTC).  Backend enforcement only — never trust the frontend.

Two ways to use this module:

1. Imperative (still supported, used by older code paths):

    from services.rate_limit import enforce_exercise_rate_limit

    auth_user = await get_supabase_user(authorization)
    enforce_exercise_rate_limit(user_id=auth_user["id"],
                                exercise_type="D3", daily_limit=3)

2. Declarative decorator (preferred for new routes — keeps the limit visible
   right above the handler signature):

    from services.rate_limit import rate_limit_exercise

    @router.post("/api/exercises/d1/{exercise_id}/attempt")
    @rate_limit_exercise(exercise_type="D1", daily_limit=50)
    async def submit_d1(exercise_id: str,
                        authorization: str | None = Header(default=None)):
        ...

The wrapped route MUST declare an `authorization` header parameter; the
decorator extracts the JWT, resolves user_id via routers.auth.get_supabase_user,
then calls enforce_exercise_rate_limit.  HTTP 429 with a machine-readable
detail (error, limit, used, reset_at) is raised when the limit is met.
"""

import inspect
import logging
from datetime import datetime, timedelta, timezone
from functools import wraps

from fastapi import HTTPException

from database import supabase_admin

logger = logging.getLogger(__name__)


def _utc_today_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _utc_tomorrow_start() -> datetime:
    return _utc_today_start() + timedelta(days=1)


def count_attempts_today(user_id: str, exercise_type: str) -> int:
    """
    Return the number of attempts this user has made for `exercise_type` since
    UTC midnight.  On DB error returns 0 — log loudly but never block legitimate
    users on a transient lookup failure (the worst case is one extra attempt
    before the next request also goes through, which is acceptable).
    """
    today_iso = _utc_today_start().isoformat()
    try:
        res = (
            supabase_admin.table("vocabulary_exercise_attempts")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .eq("exercise_type", exercise_type)
            .gte("attempted_at", today_iso)
            .execute()
        )
        return int(res.count or 0)
    except Exception as e:
        logger.warning(
            "[rate_limit] count lookup failed user=%s type=%s: %s",
            user_id, exercise_type, e,
        )
        return 0


def enforce_exercise_rate_limit(
    user_id: str,
    exercise_type: str,
    daily_limit: int,
) -> None:
    """
    Raise HTTPException(429) when the user has met or exceeded `daily_limit`
    attempts of `exercise_type` since UTC midnight.  No-op otherwise.

    Caller is responsible for inserting the attempt row AFTER its own work
    succeeds — that way a failed Whisper/Claude call doesn't burn a quota slot.
    """
    if daily_limit <= 0:
        # Treat non-positive limit as "feature disabled" rather than "unlimited",
        # so a misconfigured env var fails closed.
        raise HTTPException(
            status_code=503,
            detail={
                "error": "feature_disabled",
                "message": f"{exercise_type} exercises are not currently enabled.",
            },
        )

    used = count_attempts_today(user_id, exercise_type)
    if used >= daily_limit:
        reset_at = _utc_tomorrow_start().isoformat()
        logger.info(
            "[rate_limit] BLOCK user=%s type=%s used=%d limit=%d reset_at=%s",
            user_id, exercise_type, used, daily_limit, reset_at,
        )
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": f"Daily limit of {daily_limit} {exercise_type} attempts reached.",
                "exercise_type": exercise_type,
                "limit": daily_limit,
                "used": used,
                "reset_at": reset_at,
            },
        )


def rate_limit_exercise(exercise_type: str, daily_limit: int):
    """
    Async route decorator that enforces a per-user-per-day attempt limit
    BEFORE the wrapped handler runs.

    The wrapped route MUST declare an `authorization: str | None = Header(...)`
    parameter so the decorator can recover the JWT from kwargs and resolve
    user_id via the canonical auth dependency.

    Stack the route decorator OUTSIDE this one:

        @user_router.post("/d1/{exercise_id}/attempt")
        @rate_limit_exercise(exercise_type="D1", daily_limit=50)
        async def submit_d1_attempt(...):
            ...
    """
    def decorator(func):
        # Lazy-import auth here to avoid a circular dep at module load
        # (services.rate_limit ↔ routers.auth).
        @wraps(func)
        async def wrapper(*args, **kwargs):
            from routers.auth import get_supabase_user
            authorization = kwargs.get("authorization")
            auth_user = await get_supabase_user(authorization)
            enforce_exercise_rate_limit(
                user_id=auth_user["id"],
                exercise_type=exercise_type,
                daily_limit=daily_limit,
            )
            return await func(*args, **kwargs)

        # FastAPI introspects the *wrapper's* signature to discover the
        # route's path/header/body parameters.  Without this, the wrapper
        # would expose only (*args, **kwargs) and FastAPI would inject
        # nothing — breaking the route.
        wrapper.__signature__ = inspect.signature(func)
        return wrapper
    return decorator
