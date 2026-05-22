"""
backend/tests/test_grading_orchestrator.py — Sprint 14.3

Behavioural tests for :class:`services.grading_orchestrator.GradingOrchestrator`.

Each test injects fake providers (no SDKs, no network) and asserts on
the resulting event list — the orchestrator's contract with the
telemetry layer. The fallback chain itself is a state machine; these
tests pin its transitions.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grading_orchestrator import (        # noqa: E402
    DEFAULT_PROVIDER_ORDER,
    GradingOrchestrator,
    INITIAL_BACKOFF_SECONDS,
    JITTER_RATIO,
    RETRY_ATTEMPTS_PER_PROVIDER,
)
from services.grading_providers.base import AbstractGradingProvider  # noqa: E402
from services.grading_providers.errors import (    # noqa: E402
    AllProvidersFailedError,
    NonRetryableError,
    RetryableError,
)


# ── Test fixtures ────────────────────────────────────────────────────────────


class _FakeProvider(AbstractGradingProvider):
    """Deterministic test stand-in. Pass a list of side-effects
    (returns or raises); each `invoke` consumes the next one."""

    def __init__(self, name: str, script: list):
        self.provider_name = name
        self._script = list(script)
        self._calls = 0

    async def invoke(self, system_prompt, user_message, **kwargs):
        if not self._script:
            raise AssertionError(
                f"{self.provider_name}: invoked more times than scripted"
            )
        outcome = self._script.pop(0)
        self._calls += 1
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


async def _noop_sleep(_delay):
    """Replaces asyncio.sleep so tests don't wait through backoff."""
    return None


def _build_orchestrator(**provider_scripts) -> GradingOrchestrator:
    """provider_scripts is {provider_name: [outcomes...]}."""
    return GradingOrchestrator({
        name: _FakeProvider(name, script)
        for name, script in provider_scripts.items()
    })


# ── L1: order pinned ─────────────────────────────────────────────────────────


def test_default_order_is_haiku_gemini_sonnet():
    """L1 — locked. The fallback chain order is part of the
    grading-quality contract; flipping it would change which model
    actually grades production responses."""
    assert DEFAULT_PROVIDER_ORDER == ("claude_haiku", "gemini", "claude_sonnet")


def test_retry_budget_is_one_per_provider():
    """L4 — locked. One retry = two attempts max per provider before
    escalation."""
    assert RETRY_ATTEMPTS_PER_PROVIDER == 1


def test_backoff_constants_match_lock_l4():
    """L4 — 1 s initial backoff, ±25 % jitter."""
    assert INITIAL_BACKOFF_SECONDS == 1.0
    assert JITTER_RATIO == 0.25


# ── Happy paths ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_success_first_provider_first_attempt():
    """The common case: Haiku returns on the first try, Gemini and
    Sonnet are never even instantiated."""
    orch = _build_orchestrator(
        claude_haiku=['{"band": 6.5}'],
        gemini=[],
        claude_sonnet=[],
    )
    raw, events = await orch.invoke("sys", "user", sleep=_noop_sleep)
    assert raw == '{"band": 6.5}'
    assert len(events) == 1
    assert events[0].provider == "claude_haiku"
    assert events[0].outcome == "success"
    assert events[0].attempt == 0


@pytest.mark.asyncio
async def test_success_after_one_retry_on_same_provider():
    """L4: first call hits 529, retry succeeds — no fallback fires."""
    orch = _build_orchestrator(
        claude_haiku=[
            RetryableError(provider="claude_haiku", status=529),
            '{"band": 6.0}',
        ],
        gemini=[],
        claude_sonnet=[],
    )
    raw, events = await orch.invoke("sys", "user", sleep=_noop_sleep)
    assert raw == '{"band": 6.0}'
    assert [e.outcome for e in events] == ["retryable_error", "success"]
    assert [e.provider for e in events] == ["claude_haiku", "claude_haiku"]


@pytest.mark.asyncio
async def test_falls_through_to_gemini_after_haiku_budget_exhausted():
    """L4 + L1: Haiku 529 + 529 → escalate to Gemini (next in order)."""
    orch = _build_orchestrator(
        claude_haiku=[
            RetryableError(provider="claude_haiku", status=529),
            RetryableError(provider="claude_haiku", status=529),
        ],
        gemini=['{"band": 7.0}'],
        claude_sonnet=[],
    )
    raw, events = await orch.invoke("sys", "user", sleep=_noop_sleep)
    assert raw == '{"band": 7.0}'
    providers = [e.provider for e in events]
    outcomes  = [e.outcome  for e in events]
    assert providers == ["claude_haiku", "claude_haiku", "gemini"]
    assert outcomes  == ["retryable_error", "retryable_error", "success"]


@pytest.mark.asyncio
async def test_falls_through_to_sonnet_when_haiku_and_gemini_both_die():
    orch = _build_orchestrator(
        claude_haiku=[
            RetryableError(provider="claude_haiku", status=503),
            RetryableError(provider="claude_haiku", status=503),
        ],
        gemini=[
            RetryableError(provider="gemini", status="ServiceUnavailable"),
            RetryableError(provider="gemini", status="ServiceUnavailable"),
        ],
        claude_sonnet=['{"band": 6.5}'],
    )
    raw, events = await orch.invoke("sys", "user", sleep=_noop_sleep)
    assert raw == '{"band": 6.5}'
    assert [e.provider for e in events] == [
        "claude_haiku", "claude_haiku",
        "gemini", "gemini",
        "claude_sonnet",
    ]


# ── L3: non-retryable skips remaining retries ────────────────────────────────


@pytest.mark.asyncio
async def test_non_retryable_skips_to_next_provider_immediately():
    """L3 / L5: a 401 (or schema validation fail) escalates instantly,
    no backoff, no retry."""
    orch = _build_orchestrator(
        claude_haiku=[NonRetryableError(provider="claude_haiku", status=401)],
        gemini=['{"band": 6.5}'],
        claude_sonnet=[],
    )
    raw, events = await orch.invoke("sys", "user", sleep=_noop_sleep)
    assert raw == '{"band": 6.5}'
    # Only TWO events: 1 haiku failure (no retry on 401), 1 gemini success.
    assert len(events) == 2
    assert events[0].outcome == "non_retryable"
    assert events[1].outcome == "success"


# ── L8: all providers fail ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_all_providers_fail_raises_with_full_event_log():
    """L8 — caller gets the full audit trail in the exception so the
    telemetry layer can persist every attempt before the user-facing
    stub UX kicks in."""
    orch = _build_orchestrator(
        claude_haiku=[
            RetryableError(provider="claude_haiku", status=529),
            RetryableError(provider="claude_haiku", status=529),
        ],
        gemini=[
            RetryableError(provider="gemini", status="503"),
            RetryableError(provider="gemini", status="503"),
        ],
        claude_sonnet=[
            RetryableError(provider="claude_sonnet", status=500),
            RetryableError(provider="claude_sonnet", status=500),
        ],
    )
    with pytest.raises(AllProvidersFailedError) as excinfo:
        await orch.invoke("sys", "user", sleep=_noop_sleep)
    events = excinfo.value.events
    # Three providers × two attempts each = 6 events.
    assert len(events) == 6
    assert {e.provider for e in events} == {
        "claude_haiku", "gemini", "claude_sonnet",
    }
    assert all(e.outcome == "retryable_error" for e in events)


# ── L9: missing provider degrades cleanly ────────────────────────────────────


@pytest.mark.asyncio
async def test_missing_provider_skipped_with_audit_event():
    """If Gemini key isn't configured (production cold-start case),
    the orchestrator must not blow up — it logs a synthetic event and
    falls through to the next provider. Verifies the L9 degraded path."""
    orch = _build_orchestrator(
        claude_haiku=[RetryableError(provider="claude_haiku", status=529),
                     RetryableError(provider="claude_haiku", status=529)],
        # gemini deliberately not registered
        claude_sonnet=['{"band": 6.0}'],
    )
    raw, events = await orch.invoke("sys", "user", sleep=_noop_sleep)
    assert raw == '{"band": 6.0}'
    # Synthetic gemini event must be recorded.
    gemini_events = [e for e in events if e.provider == "gemini"]
    assert len(gemini_events) == 1
    assert gemini_events[0].outcome == "non_retryable"
    assert gemini_events[0].error_status == "not_configured"


# ── Telemetry shape ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_events_carry_latency_ms():
    """L7 — latency_ms is one of the analytics columns; pin that it's
    populated even on the fast (success) path."""
    orch = _build_orchestrator(
        claude_haiku=['{"band": 6.5}'],
    )
    _, events = await orch.invoke("sys", "user", sleep=_noop_sleep)
    assert events[0].latency_ms >= 0


@pytest.mark.asyncio
async def test_custom_order_overrides_default():
    """An on-call operator running a one-off regrade might want to
    pin a specific provider; the order kwarg supports that without
    rebuilding the orchestrator."""
    orch = _build_orchestrator(
        claude_haiku=['SHOULD_NOT_BE_CALLED'],
        gemini=['{"band": 7.5}'],
        claude_sonnet=[],
    )
    raw, events = await orch.invoke(
        "sys", "user",
        order=("gemini", "claude_haiku"),
        sleep=_noop_sleep,
    )
    assert raw == '{"band": 7.5}'
    assert events[0].provider == "gemini"


# ── build_default factory ────────────────────────────────────────────────────


def test_build_default_degrades_when_gemini_key_missing():
    """L9 — Sprint 14.3 ships even if Gemini isn't provisioned.
    The factory must produce a working orchestrator with whichever
    providers ARE configured."""
    from services.grading_orchestrator import build_default

    class _Settings:
        ANTHROPIC_API_KEY = "sk-ant-fake"
        GEMINI_API_KEY = ""

    orch = build_default(_Settings())
    providers = orch.providers
    assert "claude_haiku"  in providers
    assert "claude_sonnet" in providers
    assert "gemini" not in providers


def test_build_default_includes_all_three_when_both_keys_present():
    from services.grading_orchestrator import build_default

    class _Settings:
        ANTHROPIC_API_KEY = "sk-ant-fake"
        GEMINI_API_KEY = "AI-fake"

    orch = build_default(_Settings())
    assert set(orch.providers.keys()) == {
        "claude_haiku", "gemini", "claude_sonnet",
    }
