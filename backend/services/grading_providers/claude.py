"""
services.grading_providers.claude — Sprint 14.3

Claude (Anthropic) provider adapter. One class drives both Haiku 4.5
(primary) and Sonnet 4.6 (final fallback) — the only difference is
the model id, so factoring two classes would be churn.

Locks honored:
  - L2  retry on  500 / 503 / 504 / 429 / 529 / timeout / connection
  - L3  do NOT retry on 400 / 401 / 403 / 404
  - L10 reuses the existing claude_grader system prompt verbatim (the
        adapter just passes whatever the orchestrator hands it through);
        prompt caching stays enabled for Haiku/Sonnet — Anthropic SDK
        handles cache key by system-prompt content.
"""

from __future__ import annotations

import logging

import anthropic

from services import ai_usage_logger

from .base import AbstractGradingProvider
from .errors import NonRetryableError, RetryableError

logger = logging.getLogger(__name__)


# Andy 2026-05-22 — L2 + L3 explicit. Anchored here so a future SDK
# upgrade that renames a status code surfaces in the diff right next
# to the classification, not buried in adapter logic.
_RETRYABLE_STATUS_CODES: frozenset[int] = frozenset({429, 500, 502, 503, 504, 529})
_NON_RETRYABLE_STATUS_CODES: frozenset[int] = frozenset({400, 401, 403, 404, 422})


class ClaudeProvider(AbstractGradingProvider):
    """Adapter for any Claude model. Concrete subclasses (Haiku / Sonnet)
    just set :attr:`provider_name` + :attr:`model`.

    Constructor accepts an optional pre-built client so tests can
    inject a mock without touching `settings.ANTHROPIC_API_KEY`.
    """

    model: str = ""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        client: anthropic.AsyncAnthropic | None = None,
        max_tokens: int = 2048,
        temperature: float = 0.2,
    ):
        if client is None:
            if not api_key:
                raise RuntimeError(
                    f"{self.provider_name}: ANTHROPIC_API_KEY chưa được cấu hình."
                )
            client = anthropic.AsyncAnthropic(api_key=api_key)
        self._client = client
        self._max_tokens = max_tokens
        self._temperature = temperature

    async def invoke(
        self,
        system_prompt: str,
        user_message: str,
        *,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> str:
        try:
            response = await self._client.beta.prompt_caching.messages.create(
                model=self.model,
                max_tokens=self._max_tokens,
                system=[
                    {
                        "type":          "text",
                        "text":          system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_message}],
                temperature=self._temperature,
            )
        except anthropic.APIStatusError as exc:
            status = getattr(exc, "status_code", None)
            if status in _RETRYABLE_STATUS_CODES:
                raise RetryableError(
                    provider=self.provider_name, status=status, original=exc,
                )
            if status in _NON_RETRYABLE_STATUS_CODES:
                raise NonRetryableError(
                    provider=self.provider_name, status=status, original=exc,
                )
            # Unknown status codes default to retryable — the orchestrator
            # will exhaust its retry budget on a truly broken provider
            # and fall through to the next anyway.
            raise RetryableError(
                provider=self.provider_name, status=status, original=exc,
            )
        except anthropic.APITimeoutError as exc:
            raise RetryableError(
                provider=self.provider_name, status="timeout", original=exc,
            )
        except anthropic.APIConnectionError as exc:
            raise RetryableError(
                provider=self.provider_name, status="network", original=exc,
            )

        self._log_usage(
            response, user_id=user_id, session_id=session_id,
        )
        if not response.content:
            # Empty body where one is expected is a permanent failure
            # for THIS request shape — a different provider may produce
            # output, so escalate (do not retry the same provider).
            raise NonRetryableError(
                provider=self.provider_name, status="empty_body", original=None,
            )
        return response.content[0].text

    def _log_usage(
        self,
        response: object,
        *,
        user_id: str | None,
        session_id: str | None,
    ) -> None:
        """Best-effort AI usage logging. Mirrors legacy `_call_claude`
        behavior so cost attribution stays intact under the new stack."""
        usage = getattr(response, "usage", None)
        if not usage:
            return
        in_tok  = getattr(usage, "input_tokens",                0) or 0
        out_tok = getattr(usage, "output_tokens",               0) or 0
        cr_tok  = getattr(usage, "cache_read_input_tokens",     0) or 0
        cw_tok  = getattr(usage, "cache_creation_input_tokens", 0) or 0
        logger.debug(
            "[%s] usage — input=%s output=%s cache_read=%s cache_created=%s",
            self.provider_name, in_tok, out_tok, cr_tok, cw_tok,
        )
        try:
            ai_usage_logger.log_claude(
                user_id=user_id,
                session_id=session_id,
                model=self.model,
                input_tokens=in_tok,
                output_tokens=out_tok,
                cache_read_tokens=cr_tok,
                cache_write_tokens=cw_tok,
            )
        except Exception as exc:
            logger.warning("[%s] ai_usage_logger.log_claude failed: %s",
                           self.provider_name, exc)


class ClaudeHaikuProvider(ClaudeProvider):
    """Primary grader (L1). Claude Haiku 4.5 — the model Sprint 14.0
    Discovery confirmed as the current production grader."""

    provider_name = "claude_haiku"
    model = "claude-haiku-4-5-20251001"


class ClaudeSonnetProvider(ClaudeProvider):
    """Final fallback (L1). Claude Sonnet 4.6 — same Anthropic account,
    different model id. ~1.5–2× the Haiku latency, so positioned at the
    end of the chain where freshness has already been sacrificed."""

    provider_name = "claude_sonnet"
    model = "claude-sonnet-4-6"
