"""Per-request kill-switch flags (ADR-010 / FE migration plan B37).

Every config.py flag is env-based and loads at process start, so turning one
off means a Railway variable change + restart. The FE migration plan's
mutation-pilot checklist requires a kill switch that takes effect WITHOUT a
redeploy: this module reads the ``runtime_flags`` table (migration 155)
through a short in-process cache, so an admin flip is live on every instance
within one cache window.

Semantics:
  * missing row  -> the caller's ``default`` (normally True = enabled)
  * lookup error -> the caller's ``on_error`` when given, else its ``default``,
    logged (fail-open by default: the switch must never become its own outage;
    if the DB is down the guarded mutation is failing anyway). A flag that
    gates a paid AI call passes ``on_error=False`` so an outage disables it
    (AIBUDGET-0033 FR-006); callers that omit ``on_error`` are unchanged.
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


def _flag_query(key: str):
    return lambda db: db.table("runtime_flags").select("enabled").eq("key", key).limit(1)


def _stored(res) -> bool | None:
    rows = res.data or []
    return bool(rows[0]["enabled"]) if rows else None


def _on_lookup_error(key: str, exc: Exception, default: bool, on_error: bool | None) -> bool:
    logger.warning("[runtime_flags] lookup failed for %r: %s", key, exc)
    return default if on_error is None else on_error


def is_enabled(key: str, default: bool = True, *, on_error: bool | None = None) -> bool:
    """Return the flag state, reading through the in-process cache.

    ``on_error`` is returned when the lookup fails (not cached); ``None`` keeps
    the fail-open ``default``.
    """
    now = time.monotonic()
    hit = _cache.get(key)
    if hit is not None and hit[1] > now:
        return default if hit[0] is None else hit[0]

    try:
        stored = _stored(_flag_query(key)(supabase_admin).execute())
    except Exception as exc:  # see module docstring
        return _on_lookup_error(key, exc, default, on_error)

    _cache[key] = (stored, now + _TTL_SECONDS)
    return default if stored is None else stored


async def ais_enabled(key: str, default: bool = True, *, run,
                     on_error: bool | None = None) -> bool:
    """:func:`is_enabled` (same cache, TTL and ``on_error``) with a cache miss
    awaited through ``run(build)``.

    PC-J05: ``run`` is the async-DB facade's ``aexecute``, handed in by /auth/me
    when ``USE_ASYNC_DB`` is on. This module never picks the client itself, so
    the facade allowlist (ASYNCAUTH-0036 FR-005) stays the routers that call it.
    """
    now = time.monotonic()
    hit = _cache.get(key)
    if hit is not None and hit[1] > now:
        return default if hit[0] is None else hit[0]

    try:
        stored = _stored(await run(_flag_query(key)))
    except Exception as exc:  # see module docstring
        return _on_lookup_error(key, exc, default, on_error)

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


def require_flag(key: str, default: bool = True, *, on_error: bool | None = None):
    """FastAPI dependency factory for mutation endpoints (adopted per-endpoint
    at mutation-pilot time — see the plan's mutation ledger).

        @router.post("/thing", dependencies=[Depends(require_flag("thing_write"))])

    A paid-AI route passes ``on_error=False`` (see :func:`is_enabled`).
    """
    def _guard() -> None:
        # Omitted on_error leaves the call exactly as before.
        extra = {} if on_error is None else {"on_error": on_error}
        if not is_enabled(key, default=default, **extra):
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
