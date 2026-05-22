"""
services.grading_providers.errors — Sprint 14.3

Domain error types for the provider fallback chain.

  - :class:`RetryableError` — transient: server overloaded, rate
    limited, network hiccup. Orchestrator retries once on the same
    provider with exponential backoff before escalating.
  - :class:`NonRetryableError` — permanent for this provider:
    auth failure, bad request, malformed output. Orchestrator skips
    remaining retries and escalates to the next provider.
  - :class:`AllProvidersFailedError` — every provider in the chain
    exhausted its retry budget. Caller falls back to the existing
    "AI grading temporarily unavailable" UX (Sprint 14.3 L8).

Andy 2026-05-22 — these are the two classifications locked in L2/L3:
*we retry on 5xx/429/529/network/timeout; we do not retry on
4xx/auth/validation/refusal*. The classes themselves are mechanical;
the mapping from SDK errors lives in the adapter files.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class ProviderError(Exception):
    """Base class for all provider-domain errors."""

    def __init__(
        self,
        *,
        provider: str,
        status: str | int | None = None,
        original: BaseException | None = None,
        message: str | None = None,
    ):
        self.provider = provider
        self.status = status
        self.original = original
        super().__init__(message or f"{provider}: status={status}")


class RetryableError(ProviderError):
    """Transient failure — orchestrator may retry the same provider once."""


class NonRetryableError(ProviderError):
    """Permanent failure for this provider — orchestrator escalates immediately.

    Covers: 4xx (auth/bad request/not found), schema validation
    failures (malformed JSON from the LLM), and content-policy
    refusals. A different provider may handle the same request, so
    this is *non-retryable per-provider*, not non-retryable globally.
    """


@dataclass(frozen=True)
class FallbackEvent:
    """One row in the orchestrator's per-request audit log.

    Persisted to the `grading_events` table (migration 073) so we can
    answer: how often does Haiku fail? How often does Gemini save us?
    What's the latency budget when we fall through to Sonnet?
    """

    provider: str
    attempt: int
    outcome: str              # "success" | "retryable_error" | "non_retryable"
    latency_ms: int
    error_status: str | None = None
    error_type: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class AllProvidersFailedError(Exception):
    """Raised by the orchestrator when every provider in the chain has failed.

    Carries the full event list so the caller can persist the audit
    trail before showing the user the "temporarily unavailable" stub.
    """

    def __init__(self, *, events: list[FallbackEvent]):
        self.events = list(events)
        providers = ", ".join(sorted({e.provider for e in events})) or "(none)"
        super().__init__(
            f"All grading providers failed: {providers} "
            f"({len(events)} attempts logged)"
        )
