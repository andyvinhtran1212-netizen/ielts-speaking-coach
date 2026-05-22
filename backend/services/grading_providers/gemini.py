"""
services.grading_providers.gemini — Sprint 14.3

Gemini 2.5 Flash adapter (model name pinned to match
:mod:`services.gemini` which already uses ``gemini-2.5-flash`` for
question generation + writing grading).

Locks honored:
  - L1  middle of the fallback chain (Haiku → **Gemini** → Sonnet)
  - L2  retry on 429 / 5xx / DeadlineExceeded / ServiceUnavailable /
        connection errors
  - L3  do NOT retry on 400 (InvalidArgument) / 401 / 403 (PermissionDenied)
        / 404 (NotFound)
  - L10 reuses the Claude system prompt verbatim — Gemini ingests it
        as a leading user-context block (its API exposes
        ``system_instruction`` on GenerativeModel construction, but
        we want a single per-call call site so the orchestrator can
        stay provider-agnostic; concat is cheaper than re-constructing
        the model each call).

Note on output mode: Gemini supports ``response_mime_type="application/json"``
which forces JSON output. We enable it so the downstream
:func:`services.claude_grader._parse_and_validate` can consume Gemini's
output through the same validator that already eats Claude's output.
"""

from __future__ import annotations

import logging

import google.generativeai as genai

# google.api_core exceptions classify Gemini's HTTP errors into typed
# Python exceptions. The mapping below pins which ones cross which
# domain boundary (retryable vs non-retryable per L2/L3).
from google.api_core import exceptions as google_exceptions

from services import ai_usage_logger

from .base import AbstractGradingProvider
from .errors import NonRetryableError, RetryableError

logger = logging.getLogger(__name__)


_DEFAULT_MODEL = "gemini-2.5-flash"

# Andy 2026-05-22 — pinned right here so a future google-api-core
# rename surfaces in the diff next to the classification.
_RETRYABLE_EXCEPTIONS: tuple[type[BaseException], ...] = (
    google_exceptions.ResourceExhausted,        # 429
    google_exceptions.TooManyRequests,          # 429 alt
    google_exceptions.InternalServerError,      # 500
    google_exceptions.BadGateway,               # 502
    google_exceptions.ServiceUnavailable,       # 503
    google_exceptions.GatewayTimeout,           # 504
    google_exceptions.DeadlineExceeded,         # client/server timeout
    google_exceptions.RetryError,
    google_exceptions.Aborted,
    ConnectionError,
)

_NON_RETRYABLE_EXCEPTIONS: tuple[type[BaseException], ...] = (
    google_exceptions.InvalidArgument,          # 400
    google_exceptions.Unauthenticated,          # 401
    google_exceptions.PermissionDenied,         # 403
    google_exceptions.NotFound,                 # 404
    google_exceptions.FailedPrecondition,       # 400-equivalent
    google_exceptions.OutOfRange,
)


class GeminiProvider(AbstractGradingProvider):
    """Adapter for Gemini 2.5 Flash via the google-generativeai SDK."""

    provider_name = "gemini"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model_name: str = _DEFAULT_MODEL,
        model: object | None = None,  # injectable for tests
        max_output_tokens: int = 4096,
        temperature: float = 0.2,
    ):
        self.model_name = model_name
        if model is not None:
            self._model = model
            return
        if not api_key:
            raise RuntimeError(
                f"{self.provider_name}: GEMINI_API_KEY chưa được cấu hình."
            )
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(
            model_name=model_name,
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json",
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            ),
        )

    async def invoke(
        self,
        system_prompt: str,
        user_message: str,
        *,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> str:
        # The Gemini SDK exposes `system_instruction` only at model
        # construction time, which would force one model per call.
        # Concatenating with a clear divider matches what the Claude
        # adapter already sends (`system + messages`) and keeps the
        # token cost identical.
        prompt = (
            system_prompt.rstrip()
            + "\n\n— end of grading instructions —\n\n"
            + user_message
        )

        try:
            response = await self._model.generate_content_async(prompt)
        except _NON_RETRYABLE_EXCEPTIONS as exc:
            raise NonRetryableError(
                provider=self.provider_name,
                status=type(exc).__name__,
                original=exc,
            )
        except _RETRYABLE_EXCEPTIONS as exc:
            raise RetryableError(
                provider=self.provider_name,
                status=type(exc).__name__,
                original=exc,
            )
        except google_exceptions.GoogleAPIError as exc:
            # Unknown Google API error → treat as retryable; orchestrator
            # will exhaust its budget and fall through if truly broken.
            raise RetryableError(
                provider=self.provider_name,
                status=type(exc).__name__,
                original=exc,
            )

        self._log_usage(response, user_id=user_id, session_id=session_id)

        # Gemini sometimes blocks the response for safety; `.text`
        # raises in that case. Treat as a non-retryable per-provider
        # error so the orchestrator escalates (a different provider
        # may have different content policies — L3 spirit).
        try:
            text = response.text
        except Exception as exc:
            raise NonRetryableError(
                provider=self.provider_name,
                status="blocked_or_empty",
                original=exc,
            )

        if not text or not text.strip():
            raise NonRetryableError(
                provider=self.provider_name,
                status="empty_body",
                original=None,
            )
        return text

    def _log_usage(
        self,
        response: object,
        *,
        user_id: str | None,
        session_id: str | None,
    ) -> None:
        usage = getattr(response, "usage_metadata", None)
        if not usage:
            return
        in_tok  = getattr(usage, "prompt_token_count",     0) or 0
        out_tok = getattr(usage, "candidates_token_count", 0) or 0
        logger.debug(
            "[%s] tokens — prompt=%s candidates=%s",
            self.provider_name, in_tok, out_tok,
        )
        try:
            ai_usage_logger.log_gemini(
                user_id=user_id,
                session_id=session_id,
                model=self.model_name,
                input_tokens=in_tok,
                output_tokens=out_tok,
            )
        except Exception as exc:
            logger.warning("[%s] ai_usage_logger.log_gemini failed: %s",
                           self.provider_name, exc)
