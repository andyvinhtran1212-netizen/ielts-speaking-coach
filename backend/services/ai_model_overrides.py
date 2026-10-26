"""Admin per-feature AI model overrides (AIOPS-0024 FR-004/FR-006).

``ai_model_overrides`` (migration 321) holds, per routed ``ai_router`` feature,
an optional preferred provider and Claude model. Request paths never wait on
the database: they read an in-process snapshot that a background task
refreshes every ``AI_MODEL_OVERRIDE_TTL_SECONDS`` (30–60 s, default 30) and
that the saving process replaces right after a write.

Failure semantics (never break grading):

* refresh error/timeout/missing table → empty snapshot, i.e. env/code defaults;
* a stored value outside the allowlist → that field is ignored;
* a snapshot older than three refresh windows (refresher stalled) → ignored.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any

from database import supabase_admin

logger = logging.getLogger(__name__)

TABLE = "ai_model_overrides"
AUDIT_TABLE = "ai_model_override_audit"

# Routed features (keys of ai_router.FEATURE_TIERS) → their existing provider,
# the one each call site passes to ai_router as ``legacy_provider``.
EXISTING_PROVIDERS: dict[str, str] = {
    "speaking_grading": "gemini",
    "writing_grading": "gemini",
    "course_writing": "gemini",
    "advanced_vocab_rewrite": "gemini",
    "question_generation": "gemini",
    "listening_audit": "gemini",
}

# Claude models an admin may select. Every entry must have an ai_pricing rate
# (tested) and is supported by claude_compat's request shape.
ANTHROPIC_MODEL_ALLOWLIST: tuple[str, ...] = ("claude-sonnet-5-5", "claude-haiku-5-5")

DEFAULT_TTL_SECONDS = 30.0
MIN_TTL_SECONDS = 30.0
MAX_TTL_SECONDS = 60.0
REFRESH_TIMEOUT_SECONDS = 5.0
STALE_AFTER_WINDOWS = 3


def allowed_providers(feature: str) -> tuple[str, ...]:
    existing = EXISTING_PROVIDERS.get(feature)
    return ("anthropic", existing) if existing else ()


class OverrideValidationError(ValueError):
    def __init__(self, field_name: str, message: str):
        self.field = field_name
        super().__init__(message)


class OverrideStoreUnavailable(RuntimeError):
    def __init__(self, status: str):
        self.status = status
        super().__init__(status)


@dataclass(frozen=True)
class Override:
    feature: str
    preferred_provider: str | None = None
    anthropic_model: str | None = None
    updated_at: str | None = None
    updated_by: str | None = None
    # Stored values the router ignores because they are outside the allowlist.
    invalid_fields: tuple[str, ...] = ()


@dataclass
class _State:
    overrides: dict[str, Override] = field(default_factory=dict)
    # not_loaded | ok | unavailable | not_migrated
    status: str = "not_loaded"
    refreshed_monotonic: float | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None


_state = _State()
_clock = time.monotonic


def _client() -> Any:
    """Sync service-role client (test seam). Calls run in a worker thread so
    request paths and the event loop never wait on the database, and the
    opt-in async client (USE_ASYNC_DB) is not initialised as a side effect."""
    return supabase_admin
_refresh_lock: asyncio.Lock | None = None


def ttl_seconds(settings_obj: Any | None = None) -> float:
    if settings_obj is None:
        from config import settings as settings_obj
    try:
        value = float(getattr(settings_obj, "AI_MODEL_OVERRIDE_TTL_SECONDS", DEFAULT_TTL_SECONDS))
    except (TypeError, ValueError):
        value = DEFAULT_TTL_SECONDS
    return min(MAX_TTL_SECONDS, max(MIN_TTL_SECONDS, value))


def reset() -> None:
    """Test hook: forget every override (env/code defaults)."""
    global _state, _refresh_lock
    _state = _State()
    _refresh_lock = None


def validate_row(row: dict[str, Any]) -> Override | None:
    """Parse one stored row; out-of-allowlist values are dropped and flagged."""
    feature = str(row.get("feature") or "")
    if feature not in EXISTING_PROVIDERS:
        return None
    invalid: list[str] = []
    provider = row.get("preferred_provider")
    if provider is not None and provider not in allowed_providers(feature):
        invalid.append("preferred_provider")
        provider = None
    model = row.get("anthropic_model")
    if model is not None and model not in ANTHROPIC_MODEL_ALLOWLIST:
        invalid.append("anthropic_model")
        model = None
    return Override(
        feature=feature,
        preferred_provider=provider,
        anthropic_model=model,
        updated_at=row.get("updated_at"),
        updated_by=row.get("updated_by"),
        invalid_fields=tuple(invalid),
    )


def validate_request(
    feature: str, preferred_provider: str | None, anthropic_model: str | None,
) -> None:
    """Reject anything outside the allowlist before a write (FR-004)."""
    if feature not in EXISTING_PROVIDERS:
        raise OverrideValidationError("feature", f"Tính năng '{feature}' không được định tuyến bởi ai_router.")
    if preferred_provider is not None and preferred_provider not in allowed_providers(feature):
        raise OverrideValidationError(
            "preferred_provider",
            f"Nhà cung cấp '{preferred_provider}' không hợp lệ cho {feature}; "
            f"chỉ cho phép: {', '.join(allowed_providers(feature))}.",
        )
    if anthropic_model is not None and anthropic_model not in ANTHROPIC_MODEL_ALLOWLIST:
        raise OverrideValidationError(
            "anthropic_model",
            f"Model '{anthropic_model}' không nằm trong danh sách cho phép: "
            f"{', '.join(ANTHROPIC_MODEL_ALLOWLIST)}.",
        )


def store_status(settings_obj: Any | None = None) -> str:
    """``ok``/``stale``/``unavailable``/``not_migrated``/``not_loaded``."""
    status = _state.status
    if status == "ok" and _state.refreshed_monotonic is not None:
        if _clock() - _state.refreshed_monotonic > STALE_AFTER_WINDOWS * ttl_seconds(settings_obj):
            return "stale"
    return status


def get_override(feature: str, settings_obj: Any | None = None) -> Override | None:
    """The valid override for ``feature`` from the snapshot. No I/O."""
    if store_status(settings_obj) != "ok":
        return None
    return _state.overrides.get(feature)


def all_overrides() -> dict[str, Override]:
    """Every parsed row, including flagged ones, regardless of freshness."""
    return dict(_state.overrides)


def snapshot_info(settings_obj: Any | None = None) -> dict[str, Any]:
    return {
        "status": store_status(settings_obj),
        "last_refreshed_at": (
            _state.last_success_at.isoformat() if _state.last_success_at else None
        ),
        "last_error": _state.last_error,
        "ttl_seconds": ttl_seconds(settings_obj),
    }


def is_missing_table_error(exc: BaseException) -> bool:
    code = str(getattr(exc, "code", "") or "").upper()
    message = str(exc).lower()
    return code in {"42P01", "PGRST205", "PGRST202"} or (
        ("does not exist" in message or "could not find" in message)
        and ("ai_model_override" in message or "ai_provider_failures" in message
             or "fn_admin_ai" in message)
    )


async def refresh(timeout: float = REFRESH_TIMEOUT_SECONDS) -> str:
    """Re-read every override row; returns the resulting store status."""
    global _refresh_lock
    if _refresh_lock is None:
        _refresh_lock = asyncio.Lock()
    async with _refresh_lock:
        try:
            query = (
                _client().table(TABLE)
                .select("feature, preferred_provider, anthropic_model, updated_at, updated_by")
            )
            res = await asyncio.wait_for(asyncio.to_thread(query.execute), timeout=timeout)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            status = "not_migrated" if is_missing_table_error(exc) else "unavailable"
            _state.overrides = {}
            _state.status = status
            _state.refreshed_monotonic = _clock()
            _state.last_error = type(exc).__name__
            logger.warning("[ai_overrides] refresh failed (%s): %s — using env/code defaults",
                           status, type(exc).__name__)
            return status

        overrides: dict[str, Override] = {}
        for row in res.data or []:
            parsed = validate_row(row)
            if parsed is None:
                logger.warning("[ai_overrides] ignoring override for unrouted feature %r",
                               row.get("feature"))
                continue
            if parsed.invalid_fields:
                logger.warning("[ai_overrides] feature=%s ignoring invalid fields %s",
                               parsed.feature, list(parsed.invalid_fields))
            overrides[parsed.feature] = parsed
        _state.overrides = overrides
        _state.status = "ok"
        _state.refreshed_monotonic = _clock()
        _state.last_success_at = datetime.now(timezone.utc)
        _state.last_error = None
        logger.debug("[ai_overrides] refresh ok features=%d", len(overrides))
        return "ok"


async def run_refresher(settings_obj: Any | None = None) -> None:
    """Background loop started from FastAPI startup; never exits on error."""
    while True:
        try:
            await refresh()
        except asyncio.CancelledError:
            raise
        except Exception:  # refresh() already swallows; keep the loop alive
            logger.exception("[ai_overrides] refresher iteration failed")
        await asyncio.sleep(ttl_seconds(settings_obj))


async def save(
    feature: str,
    *,
    preferred_provider: str | None,
    anthropic_model: str | None,
    actor_id: str | None,
) -> None:
    """Validate, upsert (the trigger writes the audit row), then refresh."""
    validate_request(feature, preferred_provider, anthropic_model)
    current = _state.overrides.get(feature)
    if (
        _state.status == "ok" and current is not None and not current.invalid_fields
        and current.preferred_provider == preferred_provider
        and current.anthropic_model == anthropic_model
    ):
        return  # unchanged: no write, no audit noise
    row = {
        "feature": feature,
        "preferred_provider": preferred_provider,
        "anthropic_model": anthropic_model,
        "updated_by": actor_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        query = _client().table(TABLE).upsert(row, on_conflict="feature")
        await asyncio.wait_for(asyncio.to_thread(query.execute), timeout=REFRESH_TIMEOUT_SECONDS * 2)
    except Exception as exc:
        status = "not_migrated" if is_missing_table_error(exc) else "unavailable"
        logger.warning("[ai_overrides] save failed feature=%s (%s): %s",
                       feature, status, type(exc).__name__)
        raise OverrideStoreUnavailable(status) from exc
    logger.info("[ai_overrides] feature=%s preferred_provider=%s anthropic_model=%s by=%s",
                feature, preferred_provider, anthropic_model, actor_id)
    await refresh()


def _set_for_tests(overrides: dict[str, Override], status: str = "ok") -> None:
    """Test hook: install a fresh snapshot."""
    _state.overrides = {k: replace(v) for k, v in overrides.items()}
    _state.status = status
    _state.refreshed_monotonic = _clock()
    _state.last_success_at = datetime.now(timezone.utc)
    _state.last_error = None
