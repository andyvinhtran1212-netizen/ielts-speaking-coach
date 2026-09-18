"""Best-effort, model-aware AI usage ledger.

Each helper records one provider attempt. Logging must never break the learner
flow, but failures are warnings because a missing row makes spend and rollout
decisions untrustworthy.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

from database import get_supabase_async, supabase_admin
from services.ai_pricing import estimate_token_cost, estimate_unit_cost

logger = logging.getLogger(__name__)
_PENDING_USAGE_TASKS: set[asyncio.Task[Any]] = set()


def schedule_usage_log(coro: Coroutine[Any, Any, None]) -> asyncio.Task[Any]:
    """Retain a best-effort ledger write outside the caller's timeout budget."""
    task = asyncio.create_task(coro)
    _PENDING_USAGE_TASKS.add(task)

    def _finished(done: asyncio.Task[Any]) -> None:
        _PENDING_USAGE_TASKS.discard(done)
        if done.cancelled():
            return
        try:
            done.result()
        except Exception as exc:  # logger helpers should swallow; keep guardrail.
            logger.warning("[ai_usage] background ledger task failed: %s", exc)

    task.add_done_callback(_finished)
    return task


def _token_count(value: Any) -> int:
    """Return a real non-negative SDK token count, never a mock/proxy value."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return max(0, int(value))


def gemini_usage_tokens(usage: object | None) -> dict[str, int]:
    """Normalize Gemini usage across old and new google-generativeai SDKs.

    google-generativeai 0.8.3 does not expose ``thoughts_token_count`` even
    when the wire response contains it. Its ``total_token_count`` does include
    thinking tokens, so derive the missing split without double-counting.
    ``output_tokens`` is candidate output only; callers add thinking separately
    when their historical contract expects total billed output.
    """
    if usage is None:
        return {"input_tokens": 0, "output_tokens": 0, "thinking_tokens": 0}
    prompt = _token_count(getattr(usage, "prompt_token_count", None))
    candidates = _token_count(getattr(usage, "candidates_token_count", None))
    explicit_thoughts = getattr(usage, "thoughts_token_count", None)
    if isinstance(explicit_thoughts, (int, float)) and not isinstance(explicit_thoughts, bool):
        thoughts = _token_count(explicit_thoughts)
    else:
        total = _token_count(getattr(usage, "total_token_count", None))
        thoughts = max(0, total - prompt - candidates)
    return {
        "input_tokens": prompt,
        "output_tokens": candidates,
        "thinking_tokens": thoughts,
    }


def log_claude(
    *,
    user_id: str | None,
    session_id: str | None,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    **context: Any,
) -> None:
    _insert(_claude_row(
        user_id=user_id, session_id=session_id, model=model,
        input_tokens=input_tokens, output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens, **context,
    ))


def _claude_row(
    *, user_id: str | None, session_id: str | None, model: str,
    input_tokens: int, output_tokens: int, cache_read_tokens: int = 0,
    cache_write_tokens: int = 0, **context: Any,
) -> dict[str, Any]:
    cost, pricing_version = estimate_token_cost(
        "anthropic", model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
    )
    return _row(
        user_id=user_id,
        session_id=session_id,
        service="claude",
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
        cost_usd_est=cost,
        pricing_version=pricing_version,
        **context,
    )


def log_gemini(
    *,
    user_id: str | None,
    session_id: str | None,
    model: str,
    input_tokens: int,
    output_tokens: int,
    thinking_tokens: int = 0,
    **context: Any,
) -> None:
    _insert(_gemini_row(
        user_id=user_id, session_id=session_id, model=model,
        input_tokens=input_tokens, output_tokens=output_tokens,
        thinking_tokens=thinking_tokens, **context,
    ))


def _gemini_row(
    *, user_id: str | None, session_id: str | None, model: str,
    input_tokens: int, output_tokens: int, thinking_tokens: int = 0,
    **context: Any,
) -> dict[str, Any]:
    cost, pricing_version = estimate_token_cost(
        "google", model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        thinking_tokens=thinking_tokens,
    )
    return _row(
        user_id=user_id,
        session_id=session_id,
        service="gemini",
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        thinking_tokens=thinking_tokens,
        cost_usd_est=cost,
        pricing_version=pricing_version,
        **context,
    )


def log_whisper(
    *,
    user_id: str | None,
    session_id: str | None,
    model: str,
    audio_seconds: float,
    **context: Any,
) -> None:
    _insert(_whisper_row(
        user_id=user_id, session_id=session_id, model=model,
        audio_seconds=audio_seconds, **context,
    ))


def _whisper_row(
    *, user_id: str | None, session_id: str | None, model: str,
    audio_seconds: float, **context: Any,
) -> dict[str, Any]:
    cost, pricing_version = estimate_unit_cost(
        "openai", model, "audio_second", audio_seconds,
    )
    return _row(
        user_id=user_id,
        session_id=session_id,
        service="whisper",
        model=model,
        audio_seconds=round(max(0.0, audio_seconds), 2),
        cost_usd_est=cost,
        pricing_version=pricing_version,
        **context,
    )


def log_tts(
    *,
    user_id: str | None,
    session_id: str | None,
    model: str,
    text_chars: int,
    service: str = "tts",
    **context: Any,
) -> None:
    _insert(_tts_row(
        user_id=user_id, session_id=session_id, model=model,
        text_chars=text_chars, service=service, **context,
    ))


def _tts_row(
    *, user_id: str | None, session_id: str | None, model: str,
    text_chars: int, service: str = "tts", **context: Any,
) -> dict[str, Any]:
    provider = "elevenlabs" if service == "elevenlabs" else "openai"
    cost, pricing_version = estimate_unit_cost(
        provider, model, "text_character", text_chars,
    )
    return _row(
        user_id=user_id,
        session_id=session_id,
        service=service,
        model=model,
        text_chars=max(0, text_chars),
        cost_usd_est=cost,
        pricing_version=pricing_version,
        **context,
    )


def log_unpriced_usage(
    *,
    service: str,
    model: str,
    user_id: str | None = None,
    session_id: str | None = None,
    **context: Any,
) -> None:
    """Record usage whose account/region-specific USD price is external."""
    _insert(_unpriced_row(
        service=service, model=model, user_id=user_id,
        session_id=session_id, **context,
    ))


def _unpriced_row(
    *, service: str, model: str, user_id: str | None = None,
    session_id: str | None = None, **context: Any,
) -> dict[str, Any]:
    return _row(
        user_id=user_id,
        session_id=session_id,
        service=service,
        model=model,
        cost_usd_est=None,
        pricing_version=None,
        cost_source="unpriced",
        **context,
    )


async def log_claude_async(**kwargs: Any) -> None:
    """Async-client variant for request paths; never blocks the event loop."""
    await _insert_async(_claude_row(**kwargs))


async def log_gemini_async(**kwargs: Any) -> None:
    await _insert_async(_gemini_row(**kwargs))


async def log_whisper_async(**kwargs: Any) -> None:
    await _insert_async(_whisper_row(**kwargs))


async def log_tts_async(**kwargs: Any) -> None:
    await _insert_async(_tts_row(**kwargs))


async def log_unpriced_usage_async(**kwargs: Any) -> None:
    await _insert_async(_unpriced_row(**kwargs))


def log_gemini_response(
    response: object,
    *,
    model: str,
    user_id: str | None = None,
    session_id: str | None = None,
    **context: Any,
) -> None:
    """Extract the legacy Gemini SDK usage shape and log one call."""
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        logger.warning("[ai_usage] Gemini response has no usage metadata model=%s", model)
        return
    tokens = gemini_usage_tokens(usage)
    log_gemini(
        user_id=user_id,
        session_id=session_id,
        model=model,
        **tokens,
        **context,
    )


def log_claude_response(
    response: object,
    *,
    model: str,
    user_id: str | None = None,
    session_id: str | None = None,
    **context: Any,
) -> None:
    """Extract the Anthropic Message usage shape and log one call."""
    usage = getattr(response, "usage", None)
    if usage is None:
        logger.warning("[ai_usage] Claude response has no usage metadata model=%s", model)
        return
    log_claude(
        user_id=user_id,
        session_id=session_id,
        model=model,
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
        cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
        **context,
    )


async def log_gemini_response_async(
    response: object,
    *,
    model: str,
    user_id: str | None = None,
    session_id: str | None = None,
    **context: Any,
) -> None:
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        logger.warning("[ai_usage] Gemini response has no usage metadata model=%s", model)
        return
    tokens = gemini_usage_tokens(usage)
    await log_gemini_async(
        user_id=user_id,
        session_id=session_id,
        model=model,
        **tokens,
        **context,
    )


async def log_claude_response_async(
    response: object,
    *,
    model: str,
    user_id: str | None = None,
    session_id: str | None = None,
    **context: Any,
) -> None:
    usage = getattr(response, "usage", None)
    if usage is None:
        logger.warning("[ai_usage] Claude response has no usage metadata model=%s", model)
        return
    await log_claude_async(
        user_id=user_id,
        session_id=session_id,
        model=model,
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
        cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
        **context,
    )


_CONTEXT_FIELDS = {
    "feature", "operation", "status", "latency_ms", "request_id",
    "provider_request_id", "resource_type", "resource_id", "usage_event_id",
    "metadata", "thinking_tokens", "audio_seconds", "text_chars",
    "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
    "cost_source", "error_code",
}


def _row(
    *,
    user_id: str | None,
    session_id: str | None,
    service: str,
    model: str,
    cost_usd_est: float | None,
    pricing_version: str | None,
    **context: Any,
) -> dict[str, Any]:
    unknown = set(context) - _CONTEXT_FIELDS
    if unknown:
        logger.warning(
            "[ai_usage] ignored unsupported context fields service=%s model=%s fields=%s",
            service, model, sorted(unknown),
        )
        for key in unknown:
            context.pop(key, None)

    row: dict[str, Any] = {
        "user_id": user_id,
        "session_id": session_id,
        "service": service,
        "model": model,
        "cost_usd_est": cost_usd_est,
        "pricing_version": pricing_version,
        "currency": "USD",
        "cost_source": context.pop(
            "cost_source", "catalog_estimate" if cost_usd_est is not None else "unpriced"
        ),
    }
    for key, value in context.items():
        if value is not None:
            row[key] = value
    return row


def _insert(row: dict[str, Any]) -> None:
    try:
        query = supabase_admin.table("ai_usage_logs")
        if row.get("usage_event_id"):
            query.upsert(row, on_conflict="usage_event_id", ignore_duplicates=True).execute()
        else:
            query.insert(row).execute()
    except Exception as exc:
        if is_legacy_schema_error(exc):
            if not _can_write_legacy_row(row):
                logger.warning(
                    "[ai_usage] skipped legacy fallback for %s row; apply migration 284",
                    row.get("status") or row.get("cost_source") or "unpriced",
                )
                return
            try:
                supabase_admin.table("ai_usage_logs").insert(_legacy_row(row)).execute()
                logger.warning(
                    "[ai_usage] wrote legacy-compatible row; apply migration 284"
                )
                return
            except Exception as fallback_exc:
                exc = fallback_exc
        logger.warning(
            "[ai_usage] ledger write failed service=%s model=%s event=%s: %s",
            row.get("service"), row.get("model"), row.get("usage_event_id"), exc,
        )


async def _insert_async(row: dict[str, Any]) -> None:
    try:
        client = await get_supabase_async()
        query = client.table("ai_usage_logs")
        if row.get("usage_event_id"):
            await query.upsert(
                row, on_conflict="usage_event_id", ignore_duplicates=True,
            ).execute()
        else:
            await query.insert(row).execute()
    except Exception as exc:
        if is_legacy_schema_error(exc):
            if not _can_write_legacy_row(row):
                logger.warning(
                    "[ai_usage] skipped legacy fallback for %s row; apply migration 284",
                    row.get("status") or row.get("cost_source") or "unpriced",
                )
                return
            try:
                client = await get_supabase_async()
                await client.table("ai_usage_logs").insert(_legacy_row(row)).execute()
                logger.warning(
                    "[ai_usage] wrote legacy-compatible row; apply migration 284"
                )
                return
            except Exception as fallback_exc:
                exc = fallback_exc
        logger.warning(
            "[ai_usage] ledger write failed service=%s model=%s event=%s: %s",
            row.get("service"), row.get("model"), row.get("usage_event_id"), exc,
        )


_LEGACY_COLUMNS = {
    "user_id", "session_id", "service", "model", "input_tokens",
    "output_tokens", "cache_read_tokens", "cache_write_tokens",
    "audio_seconds", "text_chars", "cost_usd_est",
}


def _can_write_legacy_row(row: dict[str, Any]) -> bool:
    """Avoid turning failed/unpriced events into apparent $0 successes."""
    return (
        row.get("status") in (None, "success")
        and row.get("cost_source") != "unpriced"
        # Historical Writing spend is already merged from writing_feedback.
        # A legacy row loses feature/usage_event_id, so it cannot be deduped.
        and row.get("feature") != "writing_grading"
    )


def _legacy_row(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if key in _LEGACY_COLUMNS}


def is_legacy_schema_error(exc: Exception) -> bool:
    code = str(getattr(exc, "code", "") or "").upper()
    message = str(exc).lower()
    return code in {"PGRST204", "42703"} or (
        ("column" in message or "schema cache" in message)
        and any(field in message for field in (
            "thinking_tokens", "usage_event_id", "provider_request_id",
            "operation", "feature", "resource_type", "resource_id",
            "status", "error_code", "pricing_version", "currency",
            "cost_source", "metadata",
        ))
    )
