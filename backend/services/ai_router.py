"""Anthropic-primary routing for text/JSON LLM tasks.

One shared module decides, per feature, whether Claude is tried before the
feature's existing provider, which Claude model serves it, and how a Claude
attempt is made. Call sites keep their existing Gemini/OpenAI code as the
``legacy`` callable; it runs unchanged whenever the Claude attempt fails for any
reason (API error, timeout, rate limit, refusal, truncation, output the
caller's own parser/validator rejects) or ``ANTHROPIC_API_KEY`` is missing.

Configuration (``config.py``):

* ``AI_PROVIDER_ORDER`` — global comma list of ``anthropic``/``openai``/``gemini``.
* ``AI_PROVIDER_ORDER_<FEATURE>`` — per-feature override; empty inherits.
* ``ANTHROPIC_MODEL_GRADING`` / ``ANTHROPIC_MODEL_FAST`` — model per tier;
  ``ANTHROPIC_MODEL_<FEATURE>`` wins when non-empty.

The feature's existing provider is always kept as the last fallback, so a
misconfigured order can never remove the current behaviour. Every attempt is
written to the AI usage ledger and logged as ``[ai_router] feature=... provider=...``
(no prompt content, no credentials).
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Sequence, TypeVar

import anthropic

from services import ai_usage_logger
from services.claude_compat import json_request_kwargs, response_text

logger = logging.getLogger(__name__)

T = TypeVar("T")

KNOWN_PROVIDERS: tuple[str, ...] = ("anthropic", "openai", "gemini")
DEFAULT_PROVIDER_ORDER: tuple[str, ...] = ("anthropic", "openai", "gemini")

# Feature → model tier. Grading quality → Sonnet-class; short structured
# checks/generation → Haiku-class.
FEATURE_TIERS: dict[str, str] = {
    "speaking_grading": "grading",
    "writing_grading": "grading",
    "course_writing": "fast",
    "advanced_vocab_rewrite": "fast",
    "question_generation": "fast",
    "listening_audit": "fast",
}

DEFAULT_MODELS: dict[str, str] = {
    "grading": "claude-sonnet-5-5",
    "fast": "claude-haiku-5-5",
}


def _settings(settings_obj: Any | None) -> Any:
    if settings_obj is not None:
        return settings_obj
    from config import settings
    return settings


def parse_provider_order(raw: str | None) -> tuple[str, ...]:
    """Parse a comma list; unknown names are dropped, duplicates keep first."""
    order: list[str] = []
    for part in (raw or "").split(","):
        name = part.strip().lower()
        if not name:
            continue
        if name not in KNOWN_PROVIDERS:
            logger.warning("[ai_router] ignoring unknown provider %r in order", name)
            continue
        if name not in order:
            order.append(name)
    return tuple(order)


# Used when a settings object has no per-feature attribute at all; mirrors the
# config.py defaults. Every feature, including Speaking grading (AI-0004 FR-005
# revised 2026-10-26), currently inherits AI_PROVIDER_ORDER.
FEATURE_DEFAULT_ORDERS: dict[str, str] = {}


def provider_order(feature: str, settings_obj: Any | None = None) -> tuple[str, ...]:
    """Configured order for ``feature`` (per-feature override, then global)."""
    s = _settings(settings_obj)
    override = getattr(s, f"AI_PROVIDER_ORDER_{feature.upper()}", None)
    if override is None:
        override = FEATURE_DEFAULT_ORDERS.get(feature, "")
    order = parse_provider_order(override)
    if not order:
        order = parse_provider_order(getattr(s, "AI_PROVIDER_ORDER", "") or "")
    return order or DEFAULT_PROVIDER_ORDER


def effective_order(
    feature: str, legacy_provider: str, settings_obj: Any | None = None,
) -> tuple[str, ...]:
    """Providers this feature can actually use, in order.

    Only Anthropic and the feature's existing provider are candidates; the
    existing provider is appended when the configured order omits it, and
    Anthropic is dropped when no API key is configured.
    """
    s = _settings(settings_obj)
    candidates = {"anthropic", legacy_provider}
    order = [p for p in provider_order(feature, s) if p in candidates]
    if legacy_provider not in order:
        order.append(legacy_provider)
    if not (getattr(s, "ANTHROPIC_API_KEY", "") or ""):
        order = [p for p in order if p != "anthropic"]
    return tuple(order)


def anthropic_first(
    feature: str, legacy_provider: str, settings_obj: Any | None = None,
) -> bool:
    order = effective_order(feature, legacy_provider, settings_obj)
    return bool(order) and order[0] == "anthropic"


def anthropic_position(
    feature: str, legacy_provider: str, settings_obj: Any | None = None,
) -> str | None:
    """``"first"``, ``"after"`` (fallback for the existing provider) or None.

    For call sites whose existing path reports failure by return value rather
    than an exception, so they can honour both configured positions.
    """
    order = effective_order(feature, legacy_provider, settings_obj)
    if "anthropic" not in order:
        return None
    return "first" if order[0] == "anthropic" else "after"


def anthropic_model(feature: str, settings_obj: Any | None = None) -> str:
    s = _settings(settings_obj)
    specific = (getattr(s, f"ANTHROPIC_MODEL_{feature.upper()}", "") or "").strip()
    if specific:
        return specific
    tier = FEATURE_TIERS.get(feature, "fast")
    configured = (getattr(s, f"ANTHROPIC_MODEL_{tier.upper()}", "") or "").strip()
    return configured or DEFAULT_MODELS[tier]


# ── Claude attempt ─────────────────────────────────────────────────────────────


class AnthropicAttemptError(Exception):
    """A Claude attempt that produced no usable answer (always falls back)."""

    def __init__(self, code: str, message: str | None = None):
        self.error_code = code
        super().__init__(message or code)


# Validator exceptions that carry no ``error_code`` of their own, keyed by class
# name (anywhere in the MRO) so the router needs no import of the callers'
# modules. Anything else stays the generic ``invalid_response``.
VALIDATION_ERROR_CODES: dict[str, str] = {
    "UngroundedWritingFeedbackError": "ungrounded_feedback",
    "InvalidJSONError": "invalid_json",
    "JSONDecodeError": "invalid_json",
}
ERROR_DETAIL_MAX_CHARS = 500


def validation_error_code(exc: BaseException) -> str:
    code = getattr(exc, "error_code", None)
    if code:
        return code
    for cls in type(exc).__mro__:
        if cls.__name__ in VALIDATION_ERROR_CODES:
            return VALIDATION_ERROR_CODES[cls.__name__]
    return "invalid_response"


def rejection_detail(exc: BaseException) -> str:
    """Operational reason for a rejected answer, never the answer itself.

    Validators passed to :func:`call_anthropic` must keep model output out of
    their exception text. Pydantic's own message echoes ``input_value``, so it
    is reduced to field locations and error types here.
    """
    errors = getattr(exc, "errors", None)
    if type(exc).__name__ == "ValidationError" and callable(errors):
        try:
            text = "schema: " + "; ".join(
                f"{'.'.join(str(p) for p in e.get('loc', ()))}: {e.get('type')}"
                for e in errors()
            )
        except Exception:
            text = type(exc).__name__
    else:
        text = str(exc) or type(exc).__name__
    return text[:ERROR_DETAIL_MAX_CHARS]


@dataclass
class AnthropicResult:
    text: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)
    latency_ms: int = 0


_clients: dict[tuple[str, float], anthropic.AsyncAnthropic] = {}


def _client(api_key: str, timeout: float) -> anthropic.AsyncAnthropic:
    key = (api_key, timeout)
    client = _clients.get(key)
    if client is None:
        # No hidden SDK retries: a 429/5xx should reach the existing provider
        # quickly instead of spending the caller's latency budget here.
        client = anthropic.AsyncAnthropic(
            api_key=api_key, timeout=timeout, max_retries=0,
        )
        _clients[key] = client
    return client


def build_request(
    model: str,
    *,
    system: str,
    user: str,
    max_tokens: int,
    images: Sequence[tuple[bytes, str]] = (),
) -> dict[str, Any]:
    """Messages request with the static system prompt marked cacheable."""
    request = json_request_kwargs(model, max_tokens=max_tokens)
    content: Any = user
    if images:
        content = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime,
                    "data": base64.b64encode(data).decode("ascii"),
                },
            }
            for data, mime in images
        ] + [{"type": "text", "text": user}]
    request["system"] = [
        {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}},
    ]
    request["messages"] = [{"role": "user", "content": content}]
    return request


def _usage_tokens(response: Any) -> dict[str, int]:
    usage = getattr(response, "usage", None)
    return {
        "input_tokens": getattr(usage, "input_tokens", 0) or 0,
        "output_tokens": getattr(usage, "output_tokens", 0) or 0,
        "cache_read_tokens": getattr(usage, "cache_read_input_tokens", 0) or 0,
        "cache_write_tokens": getattr(usage, "cache_creation_input_tokens", 0) or 0,
    }


def _log_attempt(
    *,
    feature: str,
    operation: str,
    model: str,
    status: str,
    latency_ms: int,
    usage: dict[str, int] | None,
    error_code: str | None,
    user_id: str | None,
    session_id: str | None,
    usage_context: dict[str, Any] | None,
    error_detail: str | None = None,
) -> None:
    context = dict(usage_context or {})
    metadata = dict(context.pop("metadata", None) or {})
    metadata["route"] = "anthropic_primary"
    if error_detail:
        metadata["error_detail"] = error_detail
    common = dict(
        model=model, user_id=user_id, session_id=session_id,
        feature=feature, operation=operation, status=status,
        error_code=error_code, latency_ms=latency_ms, metadata=metadata,
        **context,
    )
    if usage and (usage.get("input_tokens") or usage.get("output_tokens")):
        ai_usage_logger.schedule_usage_log(
            ai_usage_logger.log_claude_async(**usage, **common)
        )
    else:
        ai_usage_logger.schedule_usage_log(
            ai_usage_logger.log_unpriced_usage_async(service="claude", **common)
        )


async def call_anthropic(
    feature: str,
    *,
    system: str,
    user: str,
    max_tokens: int,
    operation: str,
    validate: Callable[[str], Any] | None = None,
    images: Sequence[tuple[bytes, str]] = (),
    user_id: str | None = None,
    session_id: str | None = None,
    usage_context: dict[str, Any] | None = None,
    timeout_seconds: float | None = None,
    settings_obj: Any | None = None,
    client: Any | None = None,
) -> tuple[AnthropicResult, Any]:
    """One Claude attempt; returns ``(result, validate(text))``.

    ``validate`` is the caller's existing parser/validator; any exception it
    raises (or a ``None`` return) marks the attempt invalid. Raises
    :class:`AnthropicAttemptError` for every failure so callers fall back.
    """
    s = _settings(settings_obj)
    api_key = getattr(s, "ANTHROPIC_API_KEY", "") or ""
    model = anthropic_model(feature, s)
    if client is None:
        if not api_key:
            raise AnthropicAttemptError("missing_api_key")
        timeout = float(timeout_seconds or getattr(s, "ANTHROPIC_TIMEOUT_SECONDS", 60.0) or 60.0)
        client = _client(api_key, timeout)
    request = build_request(
        model, system=system, user=user, max_tokens=max_tokens, images=images,
    )
    started = time.monotonic()
    log = dict(
        feature=feature, operation=operation, model=model, user_id=user_id,
        session_id=session_id, usage_context=usage_context,
    )
    try:
        response = await client.messages.create(**request)
    except asyncio.CancelledError:
        _log_attempt(status="cancelled", latency_ms=_ms(started), usage=None,
                     error_code="cancelled", **log)
        raise
    except anthropic.RateLimitError as exc:
        code = "rate_limited"
        _log_attempt(status="error", latency_ms=_ms(started), usage=None, error_code=code, **log)
        raise AnthropicAttemptError(code, str(exc)) from exc
    except anthropic.APITimeoutError as exc:
        code = "timeout"
        _log_attempt(status="error", latency_ms=_ms(started), usage=None, error_code=code, **log)
        raise AnthropicAttemptError(code, str(exc)) from exc
    except anthropic.APIStatusError as exc:
        code = str(getattr(exc, "status_code", None) or "api_status")
        _log_attempt(status="error", latency_ms=_ms(started), usage=None, error_code=code, **log)
        raise AnthropicAttemptError(code, str(exc)) from exc
    except anthropic.APIConnectionError as exc:
        code = "network"
        _log_attempt(status="error", latency_ms=_ms(started), usage=None, error_code=code, **log)
        raise AnthropicAttemptError(code, str(exc)) from exc
    except Exception as exc:
        code = type(exc).__name__
        _log_attempt(status="error", latency_ms=_ms(started), usage=None, error_code=code, **log)
        raise AnthropicAttemptError(code, str(exc)) from exc

    usage = _usage_tokens(response)
    latency = _ms(started)
    try:
        text = response_text(response)
        if not text:
            raise AnthropicAttemptError("empty_body")
        parsed = validate(text) if validate is not None else text
        if parsed is None:
            raise AnthropicAttemptError("invalid_response")
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        code = validation_error_code(exc)
        detail = rejection_detail(exc)
        _log_attempt(status="invalid_response", latency_ms=latency, usage=usage,
                     error_code=code, error_detail=detail, **log)
        logger.warning(
            "[ai_router] feature=%s operation=%s model=%s rejected answer (%s): %s",
            feature, operation, model, code, detail,
        )
        if isinstance(exc, AnthropicAttemptError):
            raise
        raise AnthropicAttemptError(code, detail) from exc

    _log_attempt(status="success", latency_ms=latency, usage=usage, error_code=None, **log)
    return AnthropicResult(text=text, model=model, usage=usage, latency_ms=latency), parsed


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


async def with_fallback(
    feature: str,
    *,
    legacy_provider: str,
    anthropic_call: Callable[[], Awaitable[T]],
    legacy_call: Callable[[], Awaitable[T]],
    settings_obj: Any | None = None,
) -> T:
    """Run providers in the feature's effective order; first success wins.

    The legacy call is the feature's existing code path, unchanged. When it
    is the last provider its exception propagates exactly as before.
    """
    order = effective_order(feature, legacy_provider, settings_obj)
    last_exc: BaseException | None = None
    for index, provider in enumerate(order):
        call = anthropic_call if provider == "anthropic" else legacy_call
        try:
            result = await call()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            last_exc = exc
            if index == len(order) - 1:
                raise
            logger.warning(
                "[ai_router] feature=%s provider=%s failed (%s) — falling back to %s",
                feature, provider, getattr(exc, "error_code", type(exc).__name__),
                order[index + 1],
            )
            continue
        logger.info(
            "[ai_router] feature=%s served_by=%s%s", feature, provider,
            " (fallback)" if index else "",
        )
        return result
    raise last_exc or RuntimeError(f"no provider configured for {feature}")
