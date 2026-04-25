"""
services/rate_limit.py — per-user, per-exercise-type daily rate limiter.

Counts rows in `vocabulary_exercise_attempts` for the calling user since the
start of today (UTC).  Backend enforcement only — never trust the frontend.

Usage:
    from services.rate_limit import enforce_exercise_rate_limit

    @router.post("/api/exercises/d3/{ex_id}/attempt")
    async def attempt_d3(ex_id: str, authorization: str | None = Header(default=None)):
        auth_user = await get_supabase_user(authorization)
        enforce_exercise_rate_limit(
            user_id=auth_user["id"],
            exercise_type="D3",
            daily_limit=settings.D3_DAILY_LIMIT_FREE,
        )
        ...

The function raises HTTPException(429) when the limit is reached.  The detail
payload includes a machine-readable `error` field plus `reset_at` (next UTC
midnight) so the UI can show a clear countdown.
"""

import logging
from datetime import datetime, timedelta, timezone

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
