"""
services.grading_orchestrator — Sprint 14.3

The retry + fallback chain that sits between :mod:`services.claude_grader`
and the concrete LLM providers. Honors Andy's locks:

  L1  Order: Claude Haiku 4.5 → Gemini 2.5 → Claude Sonnet 4.6
  L2  Retry on transient: 5xx / 429 / 529 / network / timeout
  L3  Don't retry on permanent: 4xx / auth / validation / refusal
  L4  1 retry per provider with exponential backoff + ±25 % jitter
  L6  Silent to the user — orchestration is invisible until everything
      fails (then L8: existing "AI tạm thời không khả dụng" stub)
  L7  Telemetry: one :class:`FallbackEvent` per attempt, returned to
      the caller for persistence in `grading_events` (migration 073)

The orchestrator owns *transport-level* resilience. JSON parsing,
schema validation, and post-processing all stay in
:mod:`services.claude_grader` — that layer can retry the orchestrator
with a corrective prompt when the LLM's output doesn't parse, and the
orchestrator transparently does its full chain again.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Sequence

from .grading_providers import (
    AbstractGradingProvider,
    AllProvidersFailedError,
    NonRetryableError,
    RetryableError,
)
from .grading_providers.errors import FallbackEvent

logger = logging.getLogger(__name__)


# L1 — locked provider order. This stays Haiku-first and is used by the
# *off-topic judge* (a cheap binary task that must not incur grader-tier cost).
DEFAULT_PROVIDER_ORDER: tuple[str, ...] = (
    "claude_haiku",
    "gemini",
    "claude_sonnet",
)

# Audit 2026-07-02 — the *grader* uses a configurable primary model
# (settings.SPEAKING_GRADING_MODEL, registered under "grading_primary" by
# build_default) and falls back to the Anthropic chain. The judge keeps the
# DEFAULT order above, so upgrading the grader never touches judge cost.
# "grading_primary" is skipped gracefully (a FallbackEvent, then next provider)
# when it isn't configured — e.g. SPEAKING_GRADING_MODEL="" or the matching key
# is missing — so the chain degrades to Haiku → Sonnet.
GRADING_PROVIDER_ORDER: tuple[str, ...] = (
    "grading_primary",
    "claude_haiku",
    "claude_sonnet",
)

# L4 — retry policy. The +1 is the original attempt; we retry exactly
# once on transient errors before escalating to the next provider.
RETRY_ATTEMPTS_PER_PROVIDER = 1
INITIAL_BACKOFF_SECONDS = 1.0
JITTER_RATIO = 0.25


class GradingOrchestrator:
    """Holds a map of provider_name → provider instance and exposes
    :meth:`invoke` that walks the fallback chain.

    Construction is pure (no I/O); inject providers in tests via the
    `providers=` mapping. Production callers use :func:`build_default`
    which reads :mod:`config.settings` to construct adapters lazily.
    """

    def __init__(self, providers: dict[str, AbstractGradingProvider]):
        self._providers = dict(providers)

    @property
    def providers(self) -> dict[str, AbstractGradingProvider]:
        return dict(self._providers)

    async def invoke(
        self,
        system_prompt: str,
        user_message: str,
        *,
        user_id: str | None = None,
        session_id: str | None = None,
        order: Sequence[str] = DEFAULT_PROVIDER_ORDER,
        sleep: callable = asyncio.sleep,   # injectable for tests
    ) -> tuple[str, list[FallbackEvent]]:
        """Walk `order`; return ``(raw_text, events)`` on first success.

        Raises :class:`AllProvidersFailedError` (carrying the events
        list) if every provider in `order` exhausts its retries.
        """
        events: list[FallbackEvent] = []

        for provider_name in order:
            provider = self._providers.get(provider_name)
            if provider is None:
                logger.warning(
                    "[orchestrator] provider '%s' not configured — skipping",
                    provider_name,
                )
                events.append(FallbackEvent(
                    provider=provider_name,
                    attempt=0,
                    outcome="non_retryable",
                    latency_ms=0,
                    error_status="not_configured",
                    error_type="ProviderMissing",
                ))
                continue

            for attempt in range(RETRY_ATTEMPTS_PER_PROVIDER + 1):
                start = time.monotonic()
                try:
                    raw = await provider.invoke(
                        system_prompt,
                        user_message,
                        user_id=user_id,
                        session_id=session_id,
                    )
                except NonRetryableError as exc:
                    events.append(FallbackEvent(
                        provider=provider_name,
                        attempt=attempt,
                        outcome="non_retryable",
                        latency_ms=int((time.monotonic() - start) * 1000),
                        error_status=str(exc.status) if exc.status is not None else None,
                        error_type=type(exc.original).__name__ if exc.original else "NonRetryableError",
                    ))
                    logger.info(
                        "[orchestrator] %s NonRetryable status=%s — escalating",
                        provider_name, exc.status,
                    )
                    break  # skip remaining retries for this provider
                except RetryableError as exc:
                    events.append(FallbackEvent(
                        provider=provider_name,
                        attempt=attempt,
                        outcome="retryable_error",
                        latency_ms=int((time.monotonic() - start) * 1000),
                        error_status=str(exc.status) if exc.status is not None else None,
                        error_type=type(exc.original).__name__ if exc.original else "RetryableError",
                    ))
                    if attempt < RETRY_ATTEMPTS_PER_PROVIDER:
                        backoff = INITIAL_BACKOFF_SECONDS * (2 ** attempt)
                        jitter = backoff * JITTER_RATIO * (random.random() * 2 - 1)
                        delay = max(0.0, backoff + jitter)
                        logger.info(
                            "[orchestrator] %s Retryable status=%s — backoff %.2fs (attempt %d/%d)",
                            provider_name, exc.status, delay,
                            attempt + 1, RETRY_ATTEMPTS_PER_PROVIDER,
                        )
                        await sleep(delay)
                        continue
                    logger.info(
                        "[orchestrator] %s Retryable budget exhausted — escalating",
                        provider_name,
                    )
                    break
                else:
                    events.append(FallbackEvent(
                        provider=provider_name,
                        attempt=attempt,
                        outcome="success",
                        latency_ms=int((time.monotonic() - start) * 1000),
                    ))
                    return raw, events

        raise AllProvidersFailedError(events=events)


def build_default(settings_obj) -> GradingOrchestrator:
    """Construct the production orchestrator from a settings-like object.

    Tolerant of missing keys: if `GEMINI_API_KEY` is empty, the Gemini
    slot is skipped and the chain degrades to Haiku → Sonnet (Order C
    from the commission). The orchestrator logs every missing-provider
    skip as a FallbackEvent so the gap is auditable.
    """
    from .grading_providers.claude import (
        ClaudeHaikuProvider,
        ClaudeProvider,
        ClaudeSonnetProvider,
    )
    from .grading_providers.gemini import GeminiProvider

    providers: dict[str, AbstractGradingProvider] = {}
    anthropic_key = getattr(settings_obj, "ANTHROPIC_API_KEY", "") or ""
    gemini_key    = getattr(settings_obj, "GEMINI_API_KEY", "")    or ""

    if anthropic_key:
        providers["claude_haiku"]  = ClaudeHaikuProvider(api_key=anthropic_key)
        providers["claude_sonnet"] = ClaudeSonnetProvider(api_key=anthropic_key)
    if gemini_key:
        providers["gemini"] = GeminiProvider(api_key=gemini_key)

    # Audit 2026-07-02 — register the configurable grader primary. Routed by
    # model-id prefix so a single env knob (SPEAKING_GRADING_MODEL) can select a
    # Gemini or Claude model for the grader without touching provider wiring.
    grading_model = (getattr(settings_obj, "SPEAKING_GRADING_MODEL", "") or "").strip()
    primary = _build_grading_primary(grading_model, anthropic_key, gemini_key)
    if primary is not None:
        providers["grading_primary"] = primary

    return GradingOrchestrator(providers)


def _build_grading_primary(
    model_id: str,
    anthropic_key: str,
    gemini_key: str,
) -> AbstractGradingProvider | None:
    """Construct the grader's primary provider from a model id.

    Returns ``None`` when the model id is empty or its provider key is missing —
    the orchestrator then skips "grading_primary" (logging a FallbackEvent) and
    the grader degrades to the Haiku → Sonnet fallback chain. Kept module-level
    so the prefix routing is unit-testable without settings.
    """
    if not model_id:
        return None

    from .grading_providers.claude import ClaudeProvider
    from .grading_providers.gemini import GeminiProvider

    lowered = model_id.lower()
    if lowered.startswith(("claude", "anthropic")):
        if not anthropic_key:
            logger.warning(
                "[orchestrator] SPEAKING_GRADING_MODEL=%s needs ANTHROPIC_API_KEY "
                "— falling back to Haiku chain", model_id,
            )
            return None
        provider = ClaudeProvider(api_key=anthropic_key)
        provider.model = model_id
        provider.provider_name = "grading_primary"
        return provider

    if lowered.startswith("gemini"):
        if not gemini_key:
            logger.warning(
                "[orchestrator] SPEAKING_GRADING_MODEL=%s needs GEMINI_API_KEY "
                "— falling back to Haiku chain", model_id,
            )
            return None
        provider = GeminiProvider(api_key=gemini_key, model_name=model_id)
        provider.provider_name = "grading_primary"
        return provider

    logger.warning(
        "[orchestrator] SPEAKING_GRADING_MODEL=%s has an unrecognized prefix "
        "(expected claude-*/anthropic-*/gemini-*) — falling back to Haiku chain",
        model_id,
    )
    return None
