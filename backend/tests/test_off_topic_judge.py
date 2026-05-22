"""
backend/tests/test_off_topic_judge.py — Sprint 14.7

Behavioural tests for :class:`services.off_topic_judge.OffTopicJudge`.

The judge is a thin layer on top of the Sprint 14.3 orchestrator: it
adds a prompt builder, a JSON parser, a 10s timeout (L13), and a
silent-skip contract (L11). These tests pin those four obligations
without touching the network.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grading_orchestrator import GradingOrchestrator           # noqa: E402
from services.grading_providers.errors import (                          # noqa: E402
    AllProvidersFailedError,
    FallbackEvent,
    NonRetryableError,
)
from services.off_topic_judge import (                                   # noqa: E402
    OffTopicJudge,
    OffTopicVerdict,
    build_judge_prompt,
    parse_judge_response,
)


# ── Helpers ────────────────────────────────────────────────────────────────────


def _make_orchestrator_with_invoke(invoke_mock: AsyncMock) -> GradingOrchestrator:
    """Build a GradingOrchestrator instance whose `.invoke` is replaced
    by the supplied AsyncMock. The judge only touches `.invoke`, so the
    rest of the orchestrator construction is irrelevant for these
    behaviour tests."""
    orch = GradingOrchestrator(providers={})
    orch.invoke = invoke_mock  # type: ignore[method-assign]
    return orch


# ── Prompt assembly (L1, L3, L10) ─────────────────────────────────────────────


def test_build_judge_prompt_returns_system_and_user_strings():
    system, user = build_judge_prompt(
        "Describe a place you have visited.",
        "Yesterday I went to the beach...",
        2,
    )
    # System message carries the rubric + JSON schema (L3).
    assert "on-topic" in system.lower()
    assert "off-topic" in system.lower()
    assert "is_on_topic" in system
    assert "reasoning" in system

def test_build_judge_prompt_marks_generosity_to_learners_L10():
    """L10 — generous interpretation: broken English trying to answer
    is still on-topic. The prompt must encode this so the judge
    doesn't false-positive on low-band candidates."""
    system, _ = build_judge_prompt("Q", "A", 1)
    # The rubric explicitly tells the judge to be lenient.
    assert "rộng lượng" in system.lower() or "lenient" in system.lower() \
        or "cố gắng" in system.lower()


def test_build_judge_prompt_user_includes_question_and_transcript():
    system, user = build_judge_prompt(
        "Q-PROMPT",
        "T-RESPONSE",
        3,
    )
    assert "Part 3" in user
    assert "Q-PROMPT" in user
    assert "T-RESPONSE" in user


# ── Output parser (L3, parse failure) ────────────────────────────────────────


def test_parse_judge_response_strict_json_path():
    raw = '{"is_on_topic": true, "reasoning": "Trả lời sát đề"}'
    v = parse_judge_response(raw)
    assert v.is_on_topic is True
    assert v.reasoning == "Trả lời sát đề"


def test_parse_judge_response_strips_markdown_fences():
    raw = '```json\n{"is_on_topic": false, "reasoning": "lệch chủ đề"}\n```'
    v = parse_judge_response(raw)
    assert v.is_on_topic is False
    assert v.reasoning == "lệch chủ đề"


def test_parse_judge_response_truncates_reasoning_to_50_words():
    """L3 — reasoning capped at 50 words. Verbose judges get trimmed
    rather than rejected so we still surface *something* in the banner."""
    long_reason = " ".join(["từ"] * 70)
    raw = '{"is_on_topic": false, "reasoning": "' + long_reason + '"}'
    v = parse_judge_response(raw)
    assert len(v.reasoning.split()) == 50


def test_parse_judge_response_raises_non_retryable_on_empty_string():
    with pytest.raises(NonRetryableError):
        parse_judge_response("")


def test_parse_judge_response_raises_non_retryable_on_bad_json():
    with pytest.raises(NonRetryableError):
        parse_judge_response("not json {{{")


def test_parse_judge_response_raises_non_retryable_when_is_on_topic_missing():
    # Schema violation — the orchestrator marks this non-retryable so
    # we don't re-burn provider quota on a model that ignored the
    # schema.
    with pytest.raises(NonRetryableError):
        parse_judge_response('{"reasoning": "missing flag"}')


def test_parse_judge_response_raises_non_retryable_when_is_on_topic_wrong_type():
    with pytest.raises(NonRetryableError):
        parse_judge_response('{"is_on_topic": "yes", "reasoning": "string not bool"}')


# ── Happy path: judge returns verdict ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_judge_returns_on_topic_verdict():
    invoke = AsyncMock(return_value=(
        '{"is_on_topic": true, "reasoning": "Sát đề"}',
        [FallbackEvent(provider="claude_haiku", attempt=0, outcome="success", latency_ms=120)],
    ))
    judge = OffTopicJudge(_make_orchestrator_with_invoke(invoke))

    verdict = await judge.judge(
        question="Describe your hometown.",
        transcript="My hometown is Hanoi, where I grew up...",
        part_num=1,
    )
    assert verdict is not None
    assert verdict.is_on_topic is True
    assert verdict.reasoning == "Sát đề"
    invoke.assert_awaited_once()


@pytest.mark.asyncio
async def test_judge_returns_off_topic_verdict():
    invoke = AsyncMock(return_value=(
        '{"is_on_topic": false, "reasoning": "Nói về chủ đề khác"}',
        [FallbackEvent(provider="claude_haiku", attempt=0, outcome="success", latency_ms=130)],
    ))
    judge = OffTopicJudge(_make_orchestrator_with_invoke(invoke))

    verdict = await judge.judge(
        question="Describe your hometown.",
        transcript="The weather is hot today and I like ice cream.",
        part_num=1,
    )
    assert verdict is not None
    assert verdict.is_on_topic is False
    assert "khác" in verdict.reasoning


# ── L1 + L6: judge runs through the Sprint 14.3 orchestrator ─────────────────


@pytest.mark.asyncio
async def test_judge_invokes_orchestrator_with_system_user_split():
    """L1 + L6 — judge must use the Sprint 14.3 orchestrator. Pin the
    call signature so a future refactor can't accidentally swap in a
    direct provider call (losing the Haiku→Gemini→Sonnet chain)."""
    invoke = AsyncMock(return_value=(
        '{"is_on_topic": true, "reasoning": "ok"}',
        [],
    ))
    judge = OffTopicJudge(_make_orchestrator_with_invoke(invoke))

    await judge.judge(
        question="Describe a memorable trip.",
        transcript="I went to Da Nang last summer...",
        part_num=2,
        user_id="user-x",
        session_id="sess-y",
    )

    invoke.assert_awaited_once()
    args, kwargs = invoke.call_args
    # First positional = system prompt, second = user message.
    assert "is_on_topic" in args[0]            # system prompt carries schema
    assert "Da Nang" in args[1]                # user message carries transcript
    assert kwargs.get("user_id")    == "user-x"
    assert kwargs.get("session_id") == "sess-y"


# ── L11: silent skip on all-providers-fail ───────────────────────────────────


@pytest.mark.asyncio
async def test_judge_silent_skip_when_all_providers_fail():
    """L11 — when every provider in the chain fails, the judge returns
    None and grading proceeds. No exception bubbles up."""
    events = [
        FallbackEvent(provider="claude_haiku",  attempt=0, outcome="non_retryable", latency_ms=10, error_status="401"),
        FallbackEvent(provider="gemini",        attempt=0, outcome="non_retryable", latency_ms=12, error_status="403"),
        FallbackEvent(provider="claude_sonnet", attempt=0, outcome="non_retryable", latency_ms=11, error_status="401"),
    ]
    invoke = AsyncMock(side_effect=AllProvidersFailedError(events=events))
    judge = OffTopicJudge(_make_orchestrator_with_invoke(invoke))

    verdict = await judge.judge(
        question="Q",
        transcript="A long enough transcript to satisfy the input guards.",
        part_num=1,
    )
    assert verdict is None  # silent skip


# ── L13: silent skip on timeout ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_judge_silent_skip_on_timeout():
    """L13 — judge has a hard 10s timeout. Slow judge must not block
    grading throughput. We use a tiny timeout in the test to keep CI
    fast."""
    async def _slow_invoke(*_args, **_kwargs):
        await asyncio.sleep(5)
        return ('{"is_on_topic": true, "reasoning": ""}', [])
    invoke = AsyncMock(side_effect=_slow_invoke)

    judge = OffTopicJudge(
        _make_orchestrator_with_invoke(invoke),
        timeout_seconds=0.05,
    )
    verdict = await judge.judge(
        question="Q",
        transcript="Adequate transcript text.",
        part_num=1,
    )
    assert verdict is None  # silent skip on timeout


# ── Input guards ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_judge_short_circuits_on_empty_transcript():
    """Defensive — empty transcript should never burn a provider call."""
    invoke = AsyncMock()
    judge = OffTopicJudge(_make_orchestrator_with_invoke(invoke))

    verdict = await judge.judge(
        question="Q",
        transcript="   ",
        part_num=1,
    )
    assert verdict is None
    invoke.assert_not_awaited()


@pytest.mark.asyncio
async def test_judge_short_circuits_on_empty_question():
    invoke = AsyncMock()
    judge = OffTopicJudge(_make_orchestrator_with_invoke(invoke))

    verdict = await judge.judge(
        question="",
        transcript="A reasonable response.",
        part_num=1,
    )
    assert verdict is None
    invoke.assert_not_awaited()


# ── Telemetry: events tagged with kind='off_topic_judge' ─────────────────────


@pytest.mark.asyncio
async def test_judge_logs_telemetry_with_off_topic_judge_kind(monkeypatch):
    """L11 + Sprint 14.7 migration 074 — judge events must be persisted
    with event_kind='off_topic_judge' so analytics distinguish them
    from grading provider events."""
    captured: dict = {}

    def _spy_log(*, session_id, question_id, response_id, events, event_kind="grading"):
        captured["event_kind"] = event_kind
        captured["events_count"] = len(list(events))
        captured["session_id"] = session_id

    monkeypatch.setattr(
        "services.off_topic_judge.log_fallback_events",
        _spy_log,
    )

    # Trigger AllProvidersFailedError path so the judge logs events
    events = [FallbackEvent(provider="claude_haiku", attempt=0, outcome="non_retryable", latency_ms=10)]
    invoke = AsyncMock(side_effect=AllProvidersFailedError(events=events))
    judge = OffTopicJudge(_make_orchestrator_with_invoke(invoke))

    await judge.judge(
        question="Q",
        transcript="Long enough answer here.",
        part_num=1,
        session_id="sess-abc",
        question_id="q-xyz",
    )

    assert captured["event_kind"] == "off_topic_judge"
    assert captured["session_id"] == "sess-abc"
    assert captured["events_count"] >= 1
