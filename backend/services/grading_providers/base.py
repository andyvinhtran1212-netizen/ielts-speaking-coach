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

from abc import ABC, abstractmethod


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
