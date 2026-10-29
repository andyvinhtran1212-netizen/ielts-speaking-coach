"""
services.grading_providers.base — Sprint 14.3

The abstract grading-provider contract. Concrete adapters live in
sibling modules (`claude.py`, `gemini.py`); the orchestrator depends
only on :class:`AbstractGradingProvider`.

Design notes
------------

* The provider returns **raw text** (the LLM's response body), not a
  parsed dict. Parsing + schema validation live one layer up
  (:mod:`services.claude_grader._parse_and_validate`) because they
  depend on grading mode (practice vs test) which the provider doesn't
  need to know about. This also lets the orchestrator hand the SAME
  prompt to a different provider on fallback without re-stringifying.

* `user_id` / `session_id` are forwarded so each adapter can persist
  AI usage rows to `ai_usage_logs` — preserving the cost-attribution
  audit trail that the legacy `_call_claude` already populated.
"""

from __future__ import annotations

import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass

from services.request_context import current_request_id


@dataclass(frozen=True)
class CallTelemetry:
    """BL-09 — ledger fields for ONE provider call.

    Each call (retry or fallback rung included) gets its own usage_event_id —
    the ledger dedupes on it, so attempts must never share one. latency_ms
    covers the provider call up to the moment its row is logged; request_id is
    the HTTP request the call served (None for background work).
    """

    usage_event_id: str
    started: float
    request_id: str | None

    @classmethod
    def start(cls, feature: str, provider_name: str) -> "CallTelemetry":
        return cls(
            usage_event_id=f"{feature}:{provider_name}:{uuid.uuid4()}",
            started=time.monotonic(),
            request_id=current_request_id(),
        )

    def fields(self) -> dict:
        return {
            "usage_event_id": self.usage_event_id,
            "request_id":     self.request_id,
            "latency_ms":     int((time.monotonic() - self.started) * 1000),
        }


class AbstractGradingProvider(ABC):
    """One LLM behind the grading orchestrator.

    Subclasses must set :attr:`provider_name` to one of the canonical
    strings the orchestrator's order tuple references
    (e.g. ``"claude_haiku"``, ``"gemini"``, ``"claude_sonnet"``).
    """

    provider_name: str = ""

    @abstractmethod
    async def invoke(
        self,
        system_prompt: str,
        user_message: str,
        *,
        user_id: str | None = None,
        session_id: str | None = None,
    ) -> str:
        """Send the prompt; return raw response text.

        Must raise :class:`~services.grading_providers.errors.RetryableError`
        for transient failures (5xx, 429, 529, network, timeout) and
        :class:`~services.grading_providers.errors.NonRetryableError`
        for permanent failures (4xx, auth, content-policy refusal,
        empty body where one was expected).
        """
        raise NotImplementedError
