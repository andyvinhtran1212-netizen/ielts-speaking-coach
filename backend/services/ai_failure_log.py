"""Routing-layer failure/fallback log (AIOPS-0024 FR-007).

One ``ai_provider_failures`` row per failed provider attempt at the routing
layer: Claude attempts made through ``ai_router``, provider failures inside
``ai_router.with_fallback``, existing-provider failures that hand over to a
Claude fallback, and non-success attempts of the Speaking grading orchestrator.

A row carries enumerated operational fields only — never prompt, output,
provider message text, user or session identifiers. Writes are best-effort
background tasks: a failed or slow write never affects the provider call.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from database import supabase_admin
from services.ai_usage_logger import schedule_usage_log

logger = logging.getLogger(__name__)

TABLE = "ai_provider_failures"

ERROR_TYPES: tuple[str, ...] = (
    "timeout", "rate_limit", "overloaded", "server_error", "api_error",
    "network", "invalid_json", "empty_response", "missing_key",
    "not_configured", "unknown",
)
OUTCOMES: tuple[str, ...] = ("retry", "fallback", "final")
PROVIDERS: tuple[str, ...] = ("anthropic", "gemini", "openai", "unknown")

_SLOT_PROVIDERS = {
    "anthropic_primary": "anthropic",
    "claude_haiku": "anthropic",
    "claude_sonnet": "anthropic",
    "gemini": "gemini",
}

_NAMED_TYPES: dict[str, str] = {
    # ai_router / grading provider codes
    "timeout": "timeout",
    "total_timeout": "timeout",
    "timeouterror": "timeout",
    "deadlineexceeded": "timeout",
    "apitimeouterror": "timeout",
    "rate_limited": "rate_limit",
    "ratelimiterror": "rate_limit",
    "resourceexhausted": "rate_limit",
    "toomanyrequests": "rate_limit",
    "overloaded": "overloaded",
    "serviceunavailable": "overloaded",
    "internalservererror": "server_error",
    "internal": "server_error",
    "badgateway": "server_error",
    "gatewaytimeout": "timeout",
    "network": "network",
    "apiconnectionerror": "network",
    "connecterror": "network",
    "invalid_response": "invalid_json",
    "invalid_json": "invalid_json",
    "jsondecodeerror": "invalid_json",
    "validationerror": "invalid_json",
    "valueerror": "invalid_json",
    "missing_or_invalid_result": "invalid_json",
    "empty_body": "empty_response",
    "blocked_or_empty": "empty_response",
    "missing_api_key": "missing_key",
    "not_configured": "not_configured",
    "model_config": "not_configured",
    "providermissing": "not_configured",
    "api_status": "api_error",
    "invalidargument": "api_error",
    "badrequest": "api_error",
    "permissiondenied": "api_error",
    "unauthenticated": "api_error",
    "notfound": "api_error",
    "failedprecondition": "api_error",
    "authenticationerror": "api_error",
}


def normalize_error_type(*codes: Any) -> str:
    """Map provider/router error codes to the FR-007 error types.

    Accepts several candidate codes (e.g. a FallbackEvent's ``error_status``
    and ``error_type``); the first that classifies wins.
    """
    for raw in codes:
        if raw is None:
            continue
        code = str(raw).strip()
        if not code:
            continue
        lowered = code.lower()
        if lowered in _NAMED_TYPES:
            return _NAMED_TYPES[lowered]
        if lowered.isdigit():
            status = int(lowered)
            if status == 429:
                return "rate_limit"
            if status == 529:
                return "overloaded"
            if status in (408, 504):
                return "timeout"
            if status >= 500:
                return "server_error"
            if status >= 400:
                return "api_error"
        if lowered.startswith("claude_"):
            # Refusal / max_tokens / other stop reasons: unusable output.
            return "invalid_json"
        if "timeout" in lowered:
            return "timeout"
        if "json" in lowered or "parse" in lowered:
            return "invalid_json"
    return "unknown"


def provider_for(provider_or_slot: str | None, model: str | None = None) -> str:
    """Vendor for a provider name or orchestrator slot (``grading_primary``
    resolves by model prefix, as ``_build_grading_primary`` routes it)."""
    name = (provider_or_slot or "").strip().lower()
    if name in PROVIDERS:
        return name
    if name in _SLOT_PROVIDERS:
        return _SLOT_PROVIDERS[name]
    lowered = (model or "").lower()
    if lowered.startswith(("claude", "anthropic")):
        return "anthropic"
    if lowered.startswith("gemini"):
        return "gemini"
    if lowered.startswith(("gpt", "whisper", "tts", "o1", "o3", "o4")):
        return "openai"
    return "unknown"


def _client() -> Any:
    """Sync service-role client (test seam), used from a worker thread so the
    opt-in async client (USE_ASYNC_DB) is never initialised as a side effect."""
    return supabase_admin


_CODE_RE = re.compile(r"[^A-Za-z0-9_.:-]")


def _short(value: Any, limit: int) -> str | None:
    if value is None:
        return None
    text = _CODE_RE.sub("_", str(value).strip())[:limit]
    return text or None


def build_row(
    *,
    feature: str,
    provider: str,
    model: str | None,
    error_code: Any,
    outcome: str,
    error_type: str | None = None,
    route_slot: str | None = None,
    attempt: int | None = None,
) -> dict[str, Any]:
    """The complete row; every field is enumerated or a bounded short code."""
    return {
        "feature": (_short(feature, 64) or "unknown"),
        "provider": provider if provider in PROVIDERS else "unknown",
        "model": _short(model, 100),
        "route_slot": _short(route_slot, 64),
        "attempt": attempt if isinstance(attempt, int) and attempt >= 0 else None,
        "error_type": error_type if error_type in ERROR_TYPES else normalize_error_type(error_code),
        "error_code": _short(error_code, 64),
        "outcome": outcome if outcome in OUTCOMES else "final",
    }


def record(**kwargs: Any) -> None:
    """Schedule one best-effort row write; never raises.

    Outside a running event loop (offline scripts) the row is only logged.
    """
    try:
        row = build_row(**kwargs)
    except Exception as exc:  # defensive: logging must not break a call path
        logger.warning("[ai_failures] could not build row: %s", type(exc).__name__)
        return
    logger.info(
        "[ai_failures] feature=%s provider=%s model=%s error_type=%s outcome=%s",
        row["feature"], row["provider"], row["model"], row["error_type"], row["outcome"],
    )
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return
    schedule_usage_log(_insert(row))


async def _insert(row: dict[str, Any]) -> None:
    try:
        query = _client().table(TABLE).insert(row)
        await asyncio.wait_for(asyncio.to_thread(query.execute), timeout=10)
    except Exception as exc:
        logger.warning(
            "[ai_failures] write failed feature=%s provider=%s: %s",
            row.get("feature"), row.get("provider"), type(exc).__name__,
        )
