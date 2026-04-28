"""
Health check endpoints for monitoring + Railway/uptime probes.

Two endpoints:
  GET /health        — fast (<500ms), no DB.  Returns {"status": "ok", ...}.
                       Wire this into Railway healthcheck + uptime probe.
  GET /health/ready  — comprehensive readiness check: DB connectivity,
                       critical tables present (proxy for "migrations applied"),
                       Gemini API key configured, feature-flag visibility.
                       Used pre-deploy + during incident triage.

Both endpoints are unauthenticated by design — they expose no PII and need
to be reachable by external probes.  /health/ready does emit which feature
flags are ON, which is intentional (admin/dogfood signal) but means we
should NOT expose secrets here even if tempted.
"""
from datetime import datetime, timezone
import logging

from fastapi import APIRouter

from config import settings
from database import supabase_admin

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)


# Critical tables that prove the relevant migrations have applied.  If any
# of these are missing the deploy is wedged — readers (e.g. the dashboard)
# would surface confusing 500s otherwise.  Order doesn't matter; we probe
# each independently so the failure list is precise.
_CRITICAL_TABLES = (
    "user_vocabulary",         # migration 019
    "vocabulary_exercises",    # migration 021
    "d1_sessions",             # migration 023
    "flashcard_stacks",        # migration 025
    "flashcard_reviews",       # migration 027
)


@router.get("/health")
async def health_basic() -> dict:
    """Fast liveness probe.  Returns 200 + status="ok" unconditionally."""
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "phase-d-wave-2",
    }


@router.get("/health/ready")
async def health_ready() -> dict:
    """
    Comprehensive readiness probe.  Always returns HTTP 200; the per-check
    statuses + the overall `status` field carry the verdict so monitors can
    differentiate "down" from "degraded" without juggling 5xx codes.
    """
    checks: dict = {}
    overall_status = "ok"

    # 1) Database connectivity.  A trivial SELECT against `users` confirms
    # both the network path and that the service-role key still works.
    try:
        supabase_admin.table("users").select("id").limit(1).execute()
        checks["database"] = {"status": "ok"}
    except Exception as e:
        checks["database"] = {"status": "fail", "error": str(e)[:200]}
        overall_status = "degraded"

    # 2) Migrations applied — proxy by probing each critical table for
    # existence with a 0-row count call.  Missing tables surface as fail.
    missing: list[str] = []
    for table in _CRITICAL_TABLES:
        try:
            supabase_admin.table(table).select("id", count="exact").limit(0).execute()
        except Exception as e:
            missing.append(f"{table}: {str(e)[:80]}")
    if missing:
        checks["migrations"] = {"status": "fail", "missing": missing}
        overall_status = "degraded"
    else:
        checks["migrations"] = {
            "status": "ok",
            "verified": list(_CRITICAL_TABLES),
        }

    # 3) Gemini API key configured (Wave 2 vocab enrichment + D1 generation
    # both depend on it; missing key won't block /health but should flag
    # degraded so the deploy wizard can stop before promoting).
    if settings.GEMINI_API_KEY:
        checks["gemini_api"] = {"status": "ok"}
    else:
        checks["gemini_api"] = {"status": "missing_key"}
        overall_status = "degraded"

    # 4) Feature-flag visibility — useful when a dogfooder reports "X
    # doesn't work" and we want a single curl to confirm whether the env
    # has the flag flipped on.  Only booleans, no secrets.
    checks["feature_flags"] = {
        "status": "ok",
        "vocab_bank_enabled": settings.VOCAB_BANK_FEATURE_FLAG_ENABLED,
        "d1_enabled": settings.D1_ENABLED,
        "d3_enabled": settings.D3_ENABLED,
        "flashcard_enabled": settings.FLASHCARD_ENABLED,
    }

    return {
        "status": overall_status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
    }
