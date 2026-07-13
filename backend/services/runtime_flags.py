"""Per-request kill-switch flags (ADR-010 / FE migration plan B37).

Every config.py flag is env-based and loads at process start, so turning one
off means a Railway variable change + restart. The FE migration plan's
mutation-pilot checklist requires a kill switch that takes effect WITHOUT a
redeploy: this module reads the ``runtime_flags`` table (migration 155)
through a short in-process cache, so an admin flip is live on every instance
within one cache window.

Semantics:
  * missing row  -> the caller's ``default`` (normally True = enabled)
  * lookup error -> the caller's ``default``, logged (fail-open: the switch
    must never become its own outage; if the DB is down the guarded mutation
    is failing anyway)
  * flag row     -> its ``enabled`` value, cached for ``_TTL_SECONDS``

Worst-case flip latency = one TTL window (15 s) — measured against the plan's
kill-switch drill instead of the minutes-long env+restart path, which stays
documented in docs/adr/ADR-010-mutation-kill-switch.md as the fallback.
"""

from __future__ import annotations

import logging
import time

from fastapi import HTTPException

from database import supabase_admin

logger = logging.getLogger(__name__)

_TTL_SECONDS = 15.0

# key -> (stored_value_or_None, expires_at_monotonic). None = "no row" — the
# absence itself is cached and each caller's ``default`` is resolved at read
# time, so two call sites with different defaults never poison each other.
_cache: dict[str, tuple[bool | None, float]] = {}


def clear_cache() -> None:
    """Test hook + post-write invalidation."""
    _cache.clear()


def is_enabled(key: str, default: bool = True) -> bool:
    """Return the flag state, reading through the in-process cache."""
    now = time.monotonic()
    hit = _cache.get(key)
    if hit is not None and hit[1] > now:
        return default if hit[0] is None else hit[0]

    try:
        res = (
            supabase_admin.table("runtime_flags")
            .select("enabled")
            .eq("key", key)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        stored: bool | None = bool(rows[0]["enabled"]) if rows else None
    except Exception as exc:  # fail-open — see module docstring
        logger.warning("[runtime_flags] lookup failed for %r: %s", key, exc)
        return default

    _cache[key] = (stored, now + _TTL_SECONDS)
    return default if stored is None else stored


def set_flag(key: str, enabled: bool, note: str | None = None,
             updated_by: str | None = None) -> dict:
    """Upsert a flag and invalidate its cache entry. Returns the stored row."""
    row = {
        "key": key,
        "enabled": enabled,
        "note": note,
        "updated_by": updated_by,
    }
    res = supabase_admin.table("runtime_flags").upsert(row).execute()
    _cache.pop(key, None)
    stored = (res.data or [row])[0]
    return stored


def require_flag(key: str, default: bool = True):
    """FastAPI dependency factory for mutation endpoints (adopted per-endpoint
    at mutation-pilot time — see the plan's mutation ledger).

        @router.post("/thing", dependencies=[Depends(require_flag("thing_write"))])
    """
    def _guard() -> None:
        if not is_enabled(key, default=default):
            # `error_code` (not `code`): the central 5xx sanitizer
            # (services/errors.py safe_detail, P0-5) only passes through a
            # dict detail carrying `error_code` — any other 5xx detail is
            # REPLACED with the generic internal-error body. Proven live on
            # staging 2026-07-13: with `code` the kill-switch contract never
            # reached clients.
            raise HTTPException(
                status_code=503,
                detail={
                    "error_code": "feature_disabled",
                    "flag": key,
                    "message": "Tính năng này đang tạm khóa để bảo trì. Vui lòng thử lại sau.",
                },
            )
    return _guard
