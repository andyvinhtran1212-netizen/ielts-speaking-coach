"""
services.grading_providers.claude — Sprint 14.3

Claude (Anthropic) provider adapter. One class drives both Haiku 4.5
(primary) and Sonnet 5 (final fallback). Sonnet 5 needs a slightly different
request shape because adaptive thinking replaces temperature controls.

Locks honored:
  - L2  retry on  500 / 503 / 504 / 429 / 529 / timeout / connection
  - L3  do NOT retry on 400 / 401 / 403 / 404
  - L10 reuses the existing claude_grader system prompt verbatim (the
        adapter just passes whatever the orchestrator hands it through);
        prompt caching stays enabled for Haiku/Sonnet — Anthropic SDK
        handles cache key by system-prompt content.
"""

from __future__ import annotations

import asyncio
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
_SDK_TIMEOUT_SECONDS = 45.0


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
        usage_feature: str = "speaking_grading",
        usage_operation: str = "grade_response",
    ):
        if client is None:
            if not api_key:
                raise RuntimeError(
                    f"{self.provider_name}: ANTHROPIC_API_KEY chưa được cấu hình."
                )
            # The orchestrator owns retries/fallback; prevent hidden SDK retry
            # time from outliving the per-provider budget.
            client = anthropic.AsyncAnthropic(
                api_key=api_key, timeout=_SDK_TIMEOUT_SECONDS, max_retries=0,
            )
        self._client = client
        self._max_tokens = max_tokens
        self._temperature = temperature
        self._usage_feature = usage_feature
        self._usage_operation = usage_operation

    async def invoke(
        self,
        system_prompt: str,
        user_message: str,
        *,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> str:
        request = {
            "model": self.model,
            "max_tokens": self._max_tokens,
            "system": [
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            "messages": [{"role": "user", "content": user_message}],
        }
        if self.model.startswith("claude-sonnet-5"):
            # Sonnet 5 uses adaptive thinking by default and rejects sampling
            # controls. Disable thinking for this deterministic JSON fallback.
            # anthropic 0.39.0's prompt-caching beta method does not expose a
            # named `thinking` kwarg; extra_body safely forwards new API fields.
            request["extra_body"] = {"thinking": {"type": "disabled"}}
        else:
            request["temperature"] = self._temperature
        try:
            response = await self._client.beta.prompt_caching.messages.create(
                **request,
            )
        except asyncio.CancelledError:
            await self._log_failure(
                user_id=user_id, session_id=session_id, error_code="cancelled",
            )
            raise
        except anthropic.APIStatusError as exc:
            status = getattr(exc, "status_code", None)
            await self._log_failure(
                user_id=user_id, session_id=session_id,
                error_code=str(status or "api_status"),
            )
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
            await self._log_failure(
                user_id=user_id, session_id=session_id, error_code="timeout",
            )
            raise RetryableError(
                provider=self.provider_name, status="timeout", original=exc,
            )
        except anthropic.APIConnectionError as exc:
            await self._log_failure(
                user_id=user_id, session_id=session_id, error_code="network",
            )
            raise RetryableError(
                provider=self.provider_name, status="network", original=exc,
            )
        except Exception as exc:
            await self._log_failure(
                user_id=user_id, session_id=session_id,
                error_code=type(exc).__name__,
            )
            raise NonRetryableError(
                provider=self.provider_name,
                status=type(exc).__name__,
                original=exc,
            )

        text_blocks = [
            block for block in (response.content or [])
            if getattr(block, "type", "text") == "text"
            and isinstance(getattr(block, "text", None), str)
            and getattr(block, "text").strip()
        ]
        if not text_blocks:
            await self._log_usage(
                response, user_id=user_id, session_id=session_id,
                status="invalid_response",
            )
            # Empty body where one is expected is a permanent failure
            # for THIS request shape — a different provider may produce
            # output, so escalate (do not retry the same provider).
            raise NonRetryableError(
                provider=self.provider_name, status="empty_body", original=None,
            )
        await self._log_usage(
            response, user_id=user_id, session_id=session_id, status="success",
        )
        return text_blocks[0].text

    async def _log_usage(
        self,
        response: object,
        *,
        user_id: str | None,
        session_id: str | None,
        status: str,
    ) -> None:
        """Best-effort AI usage logging. Mirrors legacy `_call_claude`
        behavior so cost attribution stays intact under the new stack."""
        usage = getattr(response, "usage", None)
        if not usage:
            ai_usage_logger.schedule_usage_log(ai_usage_logger.log_unpriced_usage_async(
                service="claude",
                model=self.model,
                user_id=user_id,
                session_id=session_id,
                feature=self._usage_feature,
                operation=self._usage_operation,
                status=status,
                error_code=("missing_usage" if status != "success" else None),
                metadata={"provider": self.provider_name},
            ))
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
            ai_usage_logger.schedule_usage_log(ai_usage_logger.log_claude_async(
                user_id=user_id,
                session_id=session_id,
                model=self.model,
                input_tokens=in_tok,
                output_tokens=out_tok,
                cache_read_tokens=cr_tok,
                cache_write_tokens=cw_tok,
                feature=self._usage_feature,
                operation=self._usage_operation,
                status=status,
            ))
        except Exception as exc:
            logger.warning("[%s] ai_usage_logger.log_claude failed: %s",
                           self.provider_name, exc)

    async def _log_failure(
        self,
        *,
        user_id: str | None,
        session_id: str | None,
        error_code: str,
    ) -> None:
        ai_usage_logger.schedule_usage_log(ai_usage_logger.log_unpriced_usage_async(
            service="claude",
            model=self.model,
            user_id=user_id,
            session_id=session_id,
            feature=self._usage_feature,
            operation=self._usage_operation,
            status="error",
            error_code=error_code,
            metadata={"provider": self.provider_name},
        ))


class ClaudeHaikuProvider(ClaudeProvider):
    """Primary grader (L1). Claude Haiku 4.5 — the model Sprint 14.0
    Discovery confirmed as the current production grader."""

    provider_name = "claude_haiku"
    model = "claude-haiku-4-5-20251001"


class ClaudeSonnetProvider(ClaudeProvider):
    """Final fallback (L1). Claude Sonnet 5 — same Anthropic account,
    different model id. ~1.5–2× the Haiku latency, so positioned at the
    end of the chain where freshness has already been sacrificed."""

    provider_name = "claude_sonnet"
    model = "claude-sonnet-5"
