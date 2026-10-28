"""Best-effort, model-aware AI usage ledger.

Each helper records one provider attempt. Logging must never break the learner
flow, but failures are warnings because a missing row makes spend and rollout
decisions untrustworthy.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Coroutine
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from database import get_supabase_async, supabase_admin
from services.ai_pricing import estimate_token_cost, estimate_unit_cost
from services.request_context import current_request_id

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
    # BL-09: every row is correlatable. Callers with a deterministic id (retry
    # dedupe, CallTelemetry) keep theirs; the rest get a fresh one per provider
    # call in the same feature:provider:uuid shape. request_id is the HTTP
    # request the call served (None for background work).
    if "request_id" not in row and (request_id := current_request_id()):
        row["request_id"] = request_id
    row.setdefault(
        "usage_event_id", f"{row.get('feature') or service}:{service}:{uuid.uuid4()}",
    )
    return row


def _insert(row: dict[str, Any]) -> None:
    if _write(row) and _affects_session_cost(row):
        _refresh_session_cost(row["session_id"])


async def _insert_async(row: dict[str, Any]) -> None:
    if await _write_async(row) and _affects_session_cost(row):
        await _refresh_session_cost_async(row["session_id"])


def _write(row: dict[str, Any]) -> bool:
    try:
        query = supabase_admin.table("ai_usage_logs")
        if row.get("usage_event_id"):
            query.upsert(row, on_conflict="usage_event_id", ignore_duplicates=True).execute()
        else:
            query.insert(row).execute()
        return True
    except Exception as exc:
        if is_legacy_schema_error(exc):
            if not _can_write_legacy_row(row):
                logger.warning(
                    "[ai_usage] skipped legacy fallback for %s row; apply migration 286",
                    row.get("status") or row.get("cost_source") or "unpriced",
                )
                return False
            try:
                supabase_admin.table("ai_usage_logs").insert(_legacy_row(row)).execute()
                logger.warning(
                    "[ai_usage] wrote legacy-compatible row; apply migration 286"
                )
                return True
            except Exception as fallback_exc:
                exc = fallback_exc
        logger.warning(
            "[ai_usage] ledger write failed service=%s model=%s event=%s: %s",
            row.get("service"), row.get("model"), row.get("usage_event_id"), exc,
        )
        return False


async def _write_async(row: dict[str, Any]) -> bool:
    try:
        client = await get_supabase_async()
        query = client.table("ai_usage_logs")
        if row.get("usage_event_id"):
            await query.upsert(
                row, on_conflict="usage_event_id", ignore_duplicates=True,
            ).execute()
        else:
            await query.insert(row).execute()
        return True
    except Exception as exc:
        if is_legacy_schema_error(exc):
            if not _can_write_legacy_row(row):
                logger.warning(
                    "[ai_usage] skipped legacy fallback for %s row; apply migration 286",
                    row.get("status") or row.get("cost_source") or "unpriced",
                )
                return False
            try:
                client = await get_supabase_async()
                await client.table("ai_usage_logs").insert(_legacy_row(row)).execute()
                logger.warning(
                    "[ai_usage] wrote legacy-compatible row; apply migration 286"
                )
                return True
            except Exception as fallback_exc:
                exc = fallback_exc
        logger.warning(
            "[ai_usage] ledger write failed service=%s model=%s event=%s: %s",
            row.get("service"), row.get("model"), row.get("usage_event_id"), exc,
        )
        return False


# sessions.estimated_cost_usd is NUMERIC(10,4) (migration 093).
_SESSION_COST_QUANTUM = Decimal("0.0001")
_SESSION_COST_PASSES = 3
# PostgREST caps a response at max-rows (1000); a session can exceed it.
_SESSION_COST_PAGE = 1000


def _affects_session_cost(row: dict[str, Any]) -> bool:
    return bool(row.get("session_id")) and row.get("cost_usd_est") is not None


def _session_cost_total(rows: list[dict[str, Any]] | None) -> Decimal:
    total = sum(
        (Decimal(str(r["cost_usd_est"])) for r in rows or ()
         if r.get("cost_usd_est") is not None),
        Decimal(0),
    )
    return total.quantize(_SESSION_COST_QUANTUM, rounding=ROUND_HALF_UP)


def _session_cost_page_query(client: Any, session_id: str, cursor: str | None) -> Any:
    query = (client.table("ai_usage_logs").select("id, cost_usd_est")
             .eq("session_id", session_id).order("id").limit(_SESSION_COST_PAGE))
    return query if cursor is None else query.gt("id", cursor)


def _session_cost_next_cursor(page: list[dict[str, Any]], cursor: str | None) -> str | None:
    """Keyset cursor for the next ledger page (routers/admin.py::_usage_paged),
    or None once a short page shows the session's rows are all read."""
    if len(page) < _SESSION_COST_PAGE:
        return None
    next_cursor = page[-1].get("id")
    if not isinstance(next_cursor, str) or not next_cursor or next_cursor == cursor:
        raise RuntimeError("session cost pagination requires a progressing id cursor")
    return next_cursor


def _session_cost_raise_filter(total: Decimal) -> str:
    # PostgREST or=(): the UPDATE only ever raises the column.
    return f"estimated_cost_usd.is.null,estimated_cost_usd.lt.{total:f}"


def _refresh_session_cost(session_id: str) -> None:
    """Set sessions.estimated_cost_usd to the sum of the session's ledger rows.

    The total is recomputed, never incremented, so a duplicate upsert cannot
    double-count. Sibling rows (STT, judge, Azure, grader) land concurrently, so
    a pass may read the sum before a sibling's insert and reach its UPDATE after
    that sibling's refresh. Ledger rows are only ever added and priced >= 0, so
    the true total only grows and a stale total is always lower. The UPDATE
    therefore only raises the column (WHERE it IS NULL OR < total). PostgreSQL
    re-checks that WHERE against the newest row version, so a stale total can
    never overwrite a newer one. The refresh for the last insert reads every
    row, so the column ends at the full sum. The re-read repeats a pass for a
    sibling row whose own refresh failed. Each read pages through the ledger
    by id, because one PostgREST response stops at max-rows (1000).
    """
    def read() -> Decimal:
        rows: list[dict[str, Any]] = []
        cursor: str | None = None
        while True:
            page = _session_cost_page_query(supabase_admin, session_id, cursor).execute().data or []
            rows.extend(page)
            cursor = _session_cost_next_cursor(page, cursor)
            if cursor is None:
                return _session_cost_total(rows)

    try:
        total = read()
        for _ in range(_SESSION_COST_PASSES):
            (supabase_admin.table("sessions")
             .update({"estimated_cost_usd": float(total)})
             .eq("id", session_id).or_(_session_cost_raise_filter(total)).execute())
            settled, total = total, read()
            if total == settled:
                return
    except Exception as exc:
        logger.warning("[ai_usage] session cost refresh failed session=%s: %s", session_id, exc)


async def _refresh_session_cost_async(session_id: str) -> None:
    """Async-client twin of :func:`_refresh_session_cost`."""
    async def read() -> Decimal:
        client = await get_supabase_async()
        rows: list[dict[str, Any]] = []
        cursor: str | None = None
        while True:
            page = (await _session_cost_page_query(client, session_id, cursor).execute()).data or []
            rows.extend(page)
            cursor = _session_cost_next_cursor(page, cursor)
            if cursor is None:
                return _session_cost_total(rows)

    try:
        total = await read()
        for _ in range(_SESSION_COST_PASSES):
            client = await get_supabase_async()
            await (client.table("sessions")
                   .update({"estimated_cost_usd": float(total)})
                   .eq("id", session_id).or_(_session_cost_raise_filter(total))
                   .execute())
            settled, total = total, await read()
            if total == settled:
                return
    except Exception as exc:
        logger.warning("[ai_usage] session cost refresh failed session=%s: %s", session_id, exc)


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
