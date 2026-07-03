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
import os

from fastapi import APIRouter, Header

from config import settings
from database import supabase_admin
from services.grammar_content import grammar_service

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)

_REDACTED = "redacted (admin only)"


async def _is_admin(authorization: str | None) -> bool:
    """Soft admin check for health endpoints — returns bool, never raises.

    Health probes must stay reachable by anonymous external monitors, so we
    can't hard-gate the whole endpoint. Instead we redact fingerprinting detail
    (DB error strings, git SHA, deployment id) for non-admin callers while an
    authenticated admin still gets the full diagnostic.
    """
    if not authorization:
        return False
    # Imported lazily to avoid a health→admin import cycle at module load.
    from routers.admin import require_admin
    try:
        await require_admin(authorization)
        return True
    except Exception:
        return False

# Sprint 6.5 diagnostic constants — keep colocated so they update together
# when a new sprint adds mappings. EXPECTED_MAPPING_COUNT must equal the
# number of non-deferred entries in feedback-anchor-mapping.yaml on main.
# Sprint 7a Day 3 added 8 mappings + unfroze M030 → 40.
# Sprint 7b added M049 (missing-subjects) + M050 (missing-main-verbs) → 42.
# Sprint unfreeze (post-7c.3) dropped vestigial deferred_until: sprint-3
# from M016/M017/M025/M027/M028 (Sprint 3 shipped long ago, anchors
# already exist per drift gate) → 47.
_EXPECTED_MAPPING_COUNT  = 47
_SPRINT_6_SENTINEL_IDS   = ("M033", "M034", "M035")


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
async def health_ready(authorization: str | None = Header(default=None)) -> dict:
    """
    Comprehensive readiness probe.  Always returns HTTP 200; the per-check
    statuses + the overall `status` field carry the verdict so monitors can
    differentiate "down" from "degraded" without juggling 5xx codes.

    Anonymous callers see only pass/fail statuses; the raw DB error string
    (which can leak hostname/schema hints) is included only for admins.
    """
    is_admin = await _is_admin(authorization)
    checks: dict = {}
    overall_status = "ok"

    # 1) Database connectivity.  A trivial SELECT against `users` confirms
    # both the network path and that the service-role key still works.
    try:
        supabase_admin.table("users").select("id").limit(1).execute()
        checks["database"] = {"status": "ok"}
    except Exception as e:
        checks["database"] = {"status": "fail"}
        if is_admin:
            checks["database"]["error"] = str(e)[:200]
        overall_status = "degraded"

    # 2) Migrations applied — proxy by probing each critical table for
    # existence with a 0-row count call.  Missing tables surface as fail.
    missing: list[str] = []
    for table in _CRITICAL_TABLES:
        try:
            supabase_admin.table(table).select("id", count="exact").limit(0).execute()
        except Exception as e:
            # Table name is enough for a monitor to act; the error string (schema
            # hints) is admin-only.
            missing.append(f"{table}: {str(e)[:80]}" if is_admin else table)
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


@router.get("/health/runtime")
async def health_runtime(authorization: str | None = Header(default=None)) -> dict:
    """
    Sprint 6.5 runtime diagnostic.  Surfaces the deployed git SHA + the
    grammar-mapping inventory the running process actually loaded so we
    can prove whether prod Railway is on stale code (Scenario A) vs the
    matcher itself dropping anchors (B/C/D).

    Mapping inventory stays public (open-source ids, no PII). The Railway
    deployment identifiers (git SHA, deployment/service/env names) aid
    fingerprinting, so they're redacted for anonymous callers and returned
    only to admins (an admin curl with a Bearer token still gets them).
    """
    is_admin = await _is_admin(authorization)
    mappings_by_slug = grammar_service._load_mappings()  # cached on service
    all_mapping_ids: list[str] = []
    for slug_mappings in mappings_by_slug.values():
        for m in slug_mappings:
            mid = m.get("mapping_id")
            if mid:
                all_mapping_ids.append(mid)

    sentinel_present = {
        sid: (sid in all_mapping_ids) for sid in _SPRINT_6_SENTINEL_IDS
    }
    sprint_6_loaded = all(sentinel_present.values())
    active_count = len(all_mapping_ids)

    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "git_sha":          os.environ.get("RAILWAY_GIT_COMMIT_SHA", "unknown") if is_admin else _REDACTED,
        "deployment_id":    os.environ.get("RAILWAY_DEPLOYMENT_ID",  "unknown") if is_admin else _REDACTED,
        "service_name":     os.environ.get("RAILWAY_SERVICE_NAME",   "unknown") if is_admin else _REDACTED,
        "environment_name": os.environ.get("RAILWAY_ENVIRONMENT_NAME", "unknown") if is_admin else _REDACTED,
        "mappings": {
            "active_count":       active_count,
            "expected_count":     _EXPECTED_MAPPING_COUNT,
            "mappings_match":     active_count == _EXPECTED_MAPPING_COUNT,
            "sprint_6_loaded":    sprint_6_loaded,
            "sentinel_presence":  sentinel_present,
        },
    }


@router.get("/health/async-db")
async def health_async_db() -> dict:
    """
    P0-1 (C-1.1) async-DB scaffold status + event-loop-lag baseline.

    Reads the USE_ASYNC_DB flag, whether the async client has been initialised,
    and the rolling event-loop-lag stats from the monitor. With the flag OFF
    this is the "before" baseline: under real concurrency a blocking sync
    ``.execute()`` on the loop thread shows up as elevated lag_ms_p95/max here.
    Unauthenticated by design (no PII; booleans + timings).
    """
    from services import loop_monitor
    from database import async_client_initialised

    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "use_async_db": settings.USE_ASYNC_DB,
        "async_client_initialised": async_client_initialised(),
        "event_loop_lag": loop_monitor.snapshot(),
    }


@router.get("/health/grammar-check")
async def health_grammar_check() -> dict:
    """
    Sprint 14.9 (Codex F5) — grammar-checker runtime probe.

    Exercises the real LanguageTool/JRE backend (which the unit tests do NOT —
    they cover only the regex rules), so a broken Java runtime on the deployed
    image surfaces here instead of silently degrading to regex-only. Always
    returns HTTP 200; the ``status`` field (healthy | degraded | error) carries
    the verdict, matching /health/ready's convention (no 5xx juggling).
    """
    from services.grammar_check import grammar_check_health

    result = await grammar_check_health()
    return {
        "status": result["status"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "grammar_check": result,
    }


@router.get("/health/quiz-write")
async def health_quiz_write() -> dict:
    """Probe that quiz progress-saving works — i.e. PostgREST recognizes the ON
    CONFLICT unique constraints (migration 119) that log_progress upserts depend
    on. This catches the exact failure that silently broke vocab/grammar quiz
    progress (every POST .../progress → 500 "no unique constraint matching ON
    CONFLICT") after a manual migration without a PostgREST schema reload, while
    quiz_sessions inserts kept working. Always HTTP 200; the ``status`` field
    (healthy | error) carries the verdict.
    """
    from services.quiz_service import quiz_write_health

    result = quiz_write_health()
    return {
        "status": "healthy" if result["ok"] else "error",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "quiz_write": result,
    }
