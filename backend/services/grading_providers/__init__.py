"""
services.grading_providers — Sprint 14.3

Provider abstraction for the IELTS Speaking grading pipeline. Each
provider wraps one LLM (Claude Haiku 4.5, Gemini 2.5 Flash, Claude
Sonnet 4.6) and presents a uniform `invoke(system_prompt, user_message)`
interface so the orchestrator can swap providers behind a fallback
chain (see :mod:`services.grading_orchestrator`).

Why per-provider classes (not a single dispatch table)?

  Error classification differs by SDK: Anthropic raises
  `anthropic.APIStatusError` with a `.status_code`; Google's
  `google.api_core.exceptions` raises typed exceptions. Each adapter
  owns the mapping from SDK errors to our domain error types
  (:class:`RetryableError` / :class:`NonRetryableError`), keeping the
  orchestrator pure.
"""

from .base import AbstractGradingProvider
from .errors import (
    AllProvidersFailedError,
    NonRetryableError,
    ProviderError,
    RetryableError,
)

__all__ = [
    "AbstractGradingProvider",
    "AllProvidersFailedError",
    "NonRetryableError",
    "ProviderError",
    "RetryableError",
]
