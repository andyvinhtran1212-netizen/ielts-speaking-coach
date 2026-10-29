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
from services.ai_budget import AIBudgetRefused

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


def enforce_exercise_session_capacity(
    user_id: str,
    exercise_type: str,
    daily_limit: int,
    requested: int,
) -> None:
    """Reject a session that cannot fit in today's remaining attempt quota.

    Attempt-level enforcement remains authoritative for races and other tabs;
    this preflight prevents the normal 49/50 case from creating a 10-item
    session the learner cannot finish.
    """
    if requested <= 0:
        return
    if daily_limit <= 0:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "feature_disabled",
                "message": f"{exercise_type} exercises are not currently enabled.",
            },
        )
    used = count_attempts_today(user_id, exercise_type)
    remaining = max(0, daily_limit - used)
    if requested > remaining:
        reset_at = _utc_tomorrow_start().isoformat()
        logger.info(
            "[rate_limit] BLOCK session user=%s type=%s used=%d requested=%d "
            "limit=%d reset_at=%s",
            user_id, exercise_type, used, requested, daily_limit, reset_at,
        )
        raise HTTPException(
            status_code=429,
            detail={
                "error": "insufficient_session_quota",
                "message": "Not enough daily attempts remain to finish this session.",
                "exercise_type": exercise_type,
                "limit": daily_limit,
                "used": used,
                "remaining": remaining,
                "requested": requested,
                "reset_at": reset_at,
            },
        )

def count_flashcard_reviews_today(user_id: str) -> int:
    """
    Number of flashcard reviews this user has logged since UTC midnight.

    Counts rows in flashcard_review_log (migration 027) — flashcards can't
    reuse vocabulary_exercise_attempts because that table CHECKs
    exercise_type IN ('D1','D3') and FKs to vocabulary_exercises, neither
    of which fits a per-(user, vocabulary) review.

    Returns 0 on DB error (same fail-open posture as count_attempts_today)
    so a transient lookup blip doesn't block legitimate users.
    """
    today_iso = _utc_today_start().isoformat()
    try:
        res = (
            supabase_admin.table("flashcard_review_log")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .gte("reviewed_at", today_iso)
            .execute()
        )
        return int(res.count or 0)
    except Exception as e:
        logger.warning("[rate_limit] flashcard count lookup failed user=%s: %s", user_id, e)
        return 0


def enforce_flashcard_rate_limit(user_id: str, daily_limit: int) -> None:
    """
    Raise HTTPException(429) when the user has met or exceeded daily_limit
    flashcard reviews since UTC midnight.  Mirrors enforce_exercise_rate_limit
    in shape so the 429 detail is consistent across exercise types.
    """
    if daily_limit <= 0:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "feature_disabled",
                "message": "Flashcard reviews are not currently enabled.",
            },
        )
    used = count_flashcard_reviews_today(user_id)
    if used >= daily_limit:
        reset_at = _utc_tomorrow_start().isoformat()
        logger.info(
            "[rate_limit] BLOCK user=%s type=FLASHCARD used=%d limit=%d reset_at=%s",
            user_id, used, daily_limit, reset_at,
        )
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": f"Daily limit of {daily_limit} flashcard reviews reached.",
                "exercise_type": "FLASHCARD",
                "limit": daily_limit,
                "used": used,
                "reset_at": reset_at,
            },
        )


# ── Paid-AI quotas fail closed (AIBUDGET-0033 FR-006) ─────────────────────────
# The grading, TTS and Listening gist quotas each gate a paid provider call.
# They keep their configured values, but a count lookup error now refuses the
# call (`budget_unavailable`) instead of counting 0, and a cap of zero or less
# refuses it (`config_invalid`) instead of meaning "no cap". The exercise and
# flashcard limiters above make no paid call and keep their behaviour.

# ui-states.md P2: the refuse-before-accept text for an AI feature (FR-020).
PAID_AI_PAUSED_MESSAGE = "Tính năng AI đang tạm dừng."


class PaidAIQuotaRefused(HTTPException):
    """A paid-AI quota that cannot be enforced (FR-006), answered as the FR-010
    503 of a refuse-before-accept route: nothing was saved and no quota row was
    written, so ``work_saved`` is false.

    Learners never see the internal reason (FR-010), so the detail says
    ``paused``; the real reason is on ``refusal`` (an ``AIBudgetRefused`` whose
    ``detail`` names the quota variable) and in the log. It is an
    ``HTTPException`` so every route that re-raises those (the grading
    pipeline's outer handler, the TTS 502 wrapper) answers it unchanged, and
    ``error_code`` lets it through the 5xx sanitizer (services/errors.py).
    """

    def __init__(self, refusal: AIBudgetRefused, *, feature: str) -> None:
        self.refusal = refusal
        self.feature = feature
        super().__init__(
            status_code=503,
            detail={
                "error_code": "ai_budget_exhausted",
                "reason": "paused",
                "work_saved": False,
                "resource": {},
                "message": PAID_AI_PAUSED_MESSAGE,
            },
        )


def refuse_paid_ai(reason: str, *, feature: str, quota: str) -> PaidAIQuotaRefused:
    """Log and build the FR-006 refusal. Reasons and names only; no user id."""
    logger.warning(
        "[ai_budget] decision=refuse feature=%s reason=%s quota=%s",
        feature, reason, quota,
    )
    return PaidAIQuotaRefused(AIBudgetRefused(reason, detail=quota), feature=feature)


def require_paid_ai_cap(value: object, *, quota: str, feature: str) -> int:
    """Return a positive configured cap, or raise ``config_invalid``."""
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise refuse_paid_ai("config_invalid", feature=feature, quota=quota)
    return value


def counted_rows(res, *, quota: str, feature: str) -> int:
    """The exact count of a ``count="exact"`` read. A missing or malformed
    count is a lookup failure, never 0."""
    count = getattr(res, "count", None)
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        raise refuse_paid_ai("budget_unavailable", feature=feature, quota=quota)
    return count


# ── Grading pipeline (B5 / Mục 5) ─────────────────────────────────────────────
# The speaking-grading endpoint runs Whisper + Claude on every submission.
# Counts rows in `grading_attempts` (migration 114) since UTC midnight. The
# count and the cap fail closed (FR-006, above); recording the attempt stays
# best-effort, because the budget reservation (FR-002) bounds the cost.

_GRADING_QUOTA = "MAX_GRADINGS_PER_USER_PER_DAY"
_GRADING_FEATURE = "speaking_grading"


def count_gradings_today(user_id: str) -> int:
    today_iso = _utc_today_start().isoformat()
    try:
        res = (
            supabase_admin.table("grading_attempts")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .gte("attempted_at", today_iso)
            .execute()
        )
    except Exception as e:
        logger.warning("[rate_limit] grading count lookup failed user=%s: %s", user_id, e)
        raise refuse_paid_ai("budget_unavailable", feature=_GRADING_FEATURE,
                             quota=_GRADING_QUOTA) from e
    return counted_rows(res, quota=_GRADING_QUOTA, feature=_GRADING_FEATURE)


def enforce_grading_rate_limit(user_id: str, daily_limit: int) -> None:
    """Raise HTTPException(429) when the user has met/exceeded the daily grading
    cap. A cap of zero or less, or a count lookup error, raises
    ``PaidAIQuotaRefused`` (503) before any provider call (FR-006)."""
    daily_limit = require_paid_ai_cap(daily_limit, quota=_GRADING_QUOTA,
                                      feature=_GRADING_FEATURE)
    used = count_gradings_today(user_id)
    if used >= daily_limit:
        reset_at = _utc_tomorrow_start().isoformat()
        logger.info(
            "[rate_limit] BLOCK grading user=%s used=%d limit=%d reset_at=%s",
            user_id, used, daily_limit, reset_at,
        )
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": f"Đã đạt giới hạn {daily_limit} lượt chấm trong ngày. Vui lòng thử lại sau.",
                "exercise_type": "GRADING",
                "limit": daily_limit,
                "used": used,
                "reset_at": reset_at,
            },
        )


def record_grading_attempt(user_id: str) -> None:
    """Best-effort: log one grading attempt for the daily counter."""
    try:
        supabase_admin.table("grading_attempts").insert({"user_id": user_id}).execute()
    except Exception as e:
        logger.warning("[rate_limit] record grading attempt failed user=%s (non-fatal): %s", user_id, e)


def rate_limit_flashcard(daily_limit: int):
    """
    Async decorator twin of rate_limit_exercise — counts flashcard_review_log
    rows instead of vocabulary_exercise_attempts.  Wrapped route MUST declare
    `authorization: str | None = Header(default=None)`.
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            from routers.auth import get_supabase_user
            authorization = kwargs.get("authorization")
            auth_user = await get_supabase_user(authorization)
            enforce_flashcard_rate_limit(
                user_id=auth_user["id"],
                daily_limit=daily_limit,
            )
            return await func(*args, **kwargs)

        wrapper.__signature__ = inspect.signature(func)
        return wrapper
    return decorator


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
