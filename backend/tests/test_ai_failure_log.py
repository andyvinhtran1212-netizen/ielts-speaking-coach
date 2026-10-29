"""AIOPS-0024 FR-007 — routing-layer failure/fallback log, no network.

Rows come from ai_router (Claude attempts, with_fallback, Claude-after-Gemini
call sites) and the Speaking grading orchestrator; they hold enumerated
operational fields only and a failed write never touches the provider call.
"""

from __future__ import annotations

import asyncio
import json

import anthropic
import httpx
import pytest

from config import settings
from services import ai_failure_log, ai_model_overrides, ai_router, ai_usage_logger
from services.grading_orchestrator import GradingOrchestrator
from services.grading_providers.base import AbstractGradingProvider
from services.grading_providers.errors import (
    AllProvidersFailedError,
    NonRetryableError,
    RetryableError,
)

SECRET = "PROMPT-SECRET learner essay text 0912345678"
ROW_KEYS = {"feature", "provider", "model", "route_slot", "attempt",
            "error_type", "error_code", "outcome"}


@pytest.fixture
def failures(monkeypatch):
    """Capture failure rows synchronously instead of scheduling inserts."""
    rows: list[dict] = []
    monkeypatch.setattr(ai_failure_log, "schedule_usage_log",
                        lambda coro: (rows.append(coro.cr_frame.f_locals["row"]), coro.close()))
    monkeypatch.setattr(ai_usage_logger, "schedule_usage_log", lambda coro: coro.close())
    ai_model_overrides.reset()
    yield rows
    ai_model_overrides.reset()


def _assert_no_content(rows):
    for row in rows:
        assert set(row) == ROW_KEYS
        assert SECRET not in json.dumps(row)


# ── Normalization and row shape ────────────────────────────────────────────


@pytest.mark.parametrize("codes, expected", [
    (("rate_limited",), "rate_limit"),
    (("429",), "rate_limit"),
    ((429,), "rate_limit"),
    (("529",), "overloaded"),
    (("503", "ServiceUnavailable"), "server_error"),
    (("ServiceUnavailable",), "overloaded"),
    (("500",), "server_error"),
    (("400",), "api_error"),
    (("api_status",), "api_error"),
    (("timeout",), "timeout"),
    (("total_timeout", "TimeoutError"), "timeout"),
    (("DeadlineExceeded",), "timeout"),
    (("ResourceExhausted",), "rate_limit"),
    (("network",), "network"),
    (("invalid_response",), "invalid_json"),
    (("JSONDecodeError",), "invalid_json"),
    (("claude_max_tokens",), "invalid_json"),
    (("empty_body",), "empty_response"),
    (("blocked_or_empty",), "empty_response"),
    (("missing_api_key",), "missing_key"),
    (("not_configured", "ProviderMissing"), "not_configured"),
    ((None, "SomethingNew"), "unknown"),
    ((None, None), "unknown"),
])
def test_error_types_are_normalized(codes, expected):
    assert ai_failure_log.normalize_error_type(*codes) == expected


def test_error_code_of_looks_through_provider_wrappers():
    from services.gemini_writing_grader import APIRetryFailedError, InvalidJSONError

    class DeadlineExceeded(Exception):
        pass

    wrapped = RetryableError(provider="gemini", status="ResourceExhausted", original=ResourceExhausted())
    assert ai_failure_log.error_code_of(wrapped) == "ResourceExhausted"
    assert ai_failure_log.error_code_of(NonRetryableError(provider="gemini", status=400)) == "400"
    try:
        try:
            raise DeadlineExceeded(SECRET)
        except DeadlineExceeded as cause:
            raise APIRetryFailedError(f"All retries failed: {cause}") from cause
    except APIRetryFailedError as exc:
        assert ai_failure_log.error_code_of(exc) == "DeadlineExceeded"
    assert ai_failure_log.error_code_of(InvalidJSONError(SECRET)) == "InvalidJSONError"
    assert ai_failure_log.normalize_error_type("InvalidJSONError") == "invalid_json"
    assert ai_failure_log.error_code_of(ai_router.AnthropicAttemptError("rate_limited")) == "rate_limited"
    assert ai_failure_log.error_code_of(RuntimeError(SECRET)) == "RuntimeError"
    try:
        try:
            raise ResourceExhausted(SECRET)
        except ResourceExhausted as cause:
            raise ValueError("Gemini request failed") from cause
    except ValueError as exc:
        assert ai_failure_log.error_code_of(exc) == "ResourceExhausted"
    try:
        try:
            json.loads("{bad")
        except json.JSONDecodeError:
            raise ValueError("not json")  # implicit context still classifies
    except ValueError as exc:
        assert ai_failure_log.normalize_error_type(ai_failure_log.error_code_of(exc)) == "invalid_json"


def test_row_is_bounded_and_enumerated():
    row = ai_failure_log.build_row(
        feature="course_writing", provider="mistral", model="m" * 300,
        error_code=f"weird code {SECRET}" * 5, outcome="served",
    )
    assert set(row) == ROW_KEYS
    assert row["provider"] == "unknown" and row["outcome"] == "final"
    assert len(row["model"]) == 100 and len(row["error_code"]) <= 64
    assert " " not in row["error_code"]


@pytest.mark.asyncio
async def test_write_failure_never_raises(monkeypatch):
    def _broken():
        raise RuntimeError("db down")

    monkeypatch.setattr(ai_failure_log, "_client", _broken)
    await ai_failure_log._insert(ai_failure_log.build_row(
        feature="course_writing", provider="anthropic", model="claude-haiku-5-5",
        error_code="timeout", outcome="fallback"))


def test_record_outside_an_event_loop_is_a_noop():
    ai_failure_log.record(feature="course_writing", provider="anthropic", model=None,
                          error_code="timeout", outcome="final")


# ── ai_router.call_anthropic ───────────────────────────────────────────────


class _FakeClaude:
    def __init__(self, result):
        self.result = result
        self.messages = self

    async def create(self, **_request):
        if isinstance(self.result, BaseException):
            raise self.result
        return self.result


_REQ = httpx.Request("POST", "https://api.anthropic.com/v1/messages")


@pytest.fixture
def claude_first(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-anthropic-key")
    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER", "anthropic,openai,gemini")
    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_COURSE_WRITING", "")


@pytest.mark.parametrize("error, error_type", [
    (anthropic.RateLimitError("slow down", response=httpx.Response(429, request=_REQ), body=None), "rate_limit"),
    (anthropic.APITimeoutError(request=_REQ), "timeout"),
    (anthropic.InternalServerError("boom", response=httpx.Response(529, request=_REQ), body=None), "overloaded"),
])
@pytest.mark.asyncio
async def test_claude_failure_is_recorded_as_a_fallback(failures, claude_first, monkeypatch, error, error_type):
    monkeypatch.setattr(ai_router, "_client", lambda *_a, **_k: _FakeClaude(error))
    with pytest.raises(ai_router.AnthropicAttemptError):
        await ai_router.call_anthropic("course_writing", system=SECRET, user=SECRET,
                                       max_tokens=10, operation="grade_batch", user_id="u-1",
                                       session_id="s-1")
    assert [(r["feature"], r["provider"], r["model"], r["error_type"], r["outcome"]) for r in failures] == [
        ("course_writing", "anthropic", "claude-haiku-5-5", error_type, "fallback"),
    ]
    _assert_no_content(failures)


@pytest.mark.asyncio
async def test_invalid_output_and_last_position_are_final(failures, claude_first, monkeypatch):
    from types import SimpleNamespace

    message = SimpleNamespace(content=[SimpleNamespace(type="text", text='{"ok": tru')],
                              stop_reason="end_turn",
                              usage=SimpleNamespace(input_tokens=5, output_tokens=5,
                                                    cache_read_input_tokens=0,
                                                    cache_creation_input_tokens=0))
    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_COURSE_WRITING", "gemini,anthropic")
    monkeypatch.setattr(ai_router, "_client", lambda *_a, **_k: _FakeClaude(message))
    with pytest.raises(ai_router.AnthropicAttemptError):
        await ai_router.call_anthropic("course_writing", system="S", user=SECRET,
                                       max_tokens=10, operation="op", validate=json.loads)
    assert [(r["error_type"], r["outcome"]) for r in failures] == [("invalid_json", "final")]
    _assert_no_content(failures)


@pytest.mark.asyncio
async def test_cancellation_is_not_a_provider_failure(failures, claude_first, monkeypatch):
    monkeypatch.setattr(ai_router, "_client", lambda *_a, **_k: _FakeClaude(asyncio.CancelledError()))
    with pytest.raises(asyncio.CancelledError):
        await ai_router.call_anthropic("course_writing", system="S", user="U",
                                       max_tokens=10, operation="op")
    assert failures == []


# ── ai_router.with_fallback ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_with_fallback_records_existing_provider_failures_once(failures, claude_first, monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_QUESTION_GENERATION", "gemini,anthropic")

    async def gemini_fails():
        raise TimeoutError(SECRET)

    async def claude_serves():
        return "ok"

    assert await ai_router.with_fallback(
        "question_generation", legacy_provider="gemini",
        anthropic_call=claude_serves, legacy_call=gemini_fails) == "ok"
    assert [(r["provider"], r["model"], r["error_type"], r["outcome"]) for r in failures] == [
        ("gemini", "gemini-2.5-flash", "timeout", "fallback"),
    ]

    failures.clear()

    async def claude_fails():
        raise ai_router.AnthropicAttemptError("rate_limited")  # recorded by call_anthropic

    with pytest.raises(ai_router.AnthropicAttemptError):
        await ai_router.with_fallback(
            "question_generation", legacy_provider="gemini",
            anthropic_call=claude_fails, legacy_call=gemini_fails)
    assert [(r["provider"], r["outcome"]) for r in failures] == [("gemini", "fallback")]
    _assert_no_content(failures)


@pytest.mark.asyncio
async def test_with_fallback_final_existing_failure(failures, claude_first):
    async def claude_fails():
        raise ai_router.AnthropicAttemptError("timeout")

    async def gemini_fails():
        raise RuntimeError(SECRET)

    with pytest.raises(RuntimeError):
        await ai_router.with_fallback(
            "listening_audit", legacy_provider="gemini",
            anthropic_call=claude_fails, legacy_call=gemini_fails)
    assert [(r["feature"], r["provider"], r["error_code"], r["outcome"]) for r in failures] == [
        ("listening_audit", "gemini", "RuntimeError", "final"),
    ]
    _assert_no_content(failures)


# ── Claude-after-Gemini call site ──────────────────────────────────────────


class ResourceExhausted(Exception):
    """Stand-in with the google.api_core class name (429)."""


class _FakeGemini:
    def __init__(self, outcome):
        self.outcome = outcome

    async def generate_content_async(self, _prompt, **_kwargs):
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        from types import SimpleNamespace
        return SimpleNamespace(text=self.outcome, usage_metadata=None)


@pytest.mark.parametrize("outcome, error_type, error_code", [
    (asyncio.TimeoutError(), "timeout", "timeout"),
    (ResourceExhausted(SECRET), "rate_limit", "ResourceExhausted"),
    ("not json " + SECRET, "invalid_json", "invalid_json"),
    ('{"results": []}', "invalid_json", "missing_or_invalid_result"),
])
@pytest.mark.asyncio
async def test_course_writing_records_the_real_gemini_error_before_claude(
    failures, claude_first, monkeypatch, outcome, error_type, error_code,
):
    from services import course_writing_grader as cw

    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_COURSE_WRITING", "gemini,anthropic")
    monkeypatch.setattr(cw, "_model", lambda: ("gemini-3.5-flash-lite", _FakeGemini(outcome)))

    async def claude(batch, payload_json, **_kw):
        return ["served"], "claude-haiku-5-5", None

    monkeypatch.setattr(cw, "_grade_batch_claude", claude)
    result = await cw._grade_batch([{"qid": 1, "prompt": SECRET, "answer": SECRET}])
    assert result[1] == "claude-haiku-5-5"
    assert [(r["feature"], r["provider"], r["model"], r["error_type"], r["error_code"], r["outcome"])
            for r in failures] == [
        ("course_writing", "gemini", "gemini-3.5-flash-lite", error_type, error_code, "fallback"),
    ]
    _assert_no_content(failures)


@pytest.mark.asyncio
async def test_gemini_failure_is_not_logged_when_no_claude_follows(failures, claude_first, monkeypatch):
    from services import course_writing_grader as cw

    # Claude first: a Gemini failure is the final answer, outside FR-007's hand-over.
    monkeypatch.setattr(cw, "_model", lambda: ("gemini-3.5-flash-lite", _FakeGemini(asyncio.TimeoutError())))
    await cw._grade_batch_gemini([{"qid": 1, "prompt": "p", "answer": "a"}], "prompt")
    assert failures == []


@pytest.mark.asyncio
async def test_vocab_rewrite_records_the_real_gemini_error_before_claude(failures, claude_first, monkeypatch):
    from services import advanced_vocab_rewrite_grader as vr

    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_ADVANCED_VOCAB_REWRITE", "gemini,anthropic")
    monkeypatch.setattr(vr, "_model", lambda: ("gemini-3.5-flash-lite", _FakeGemini(ResourceExhausted())))
    await vr._grade_gemini([{"item_id": "i1", "prompt": "p", "answer": SECRET}], "[]", user_id="u-1")
    assert [(r["feature"], r["error_type"], r["error_code"], r["outcome"]) for r in failures] == [
        ("advanced_vocab_rewrite", "rate_limit", "ResourceExhausted", "fallback"),
    ]
    _assert_no_content(failures)


@pytest.mark.parametrize("status, error_type", [
    ("ResourceExhausted", "rate_limit"),
    ("DeadlineExceeded", "timeout"),
])
@pytest.mark.asyncio
async def test_listening_audit_records_wrapped_gemini_errors(failures, claude_first, monkeypatch, status, error_type):
    from types import SimpleNamespace

    from routers import listening

    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_LISTENING_AUDIT", "gemini,anthropic")
    monkeypatch.setattr(settings, "LISTENING_AUDIT_MODEL", "gemini-3.8-flash")

    class _Legacy:
        async def invoke(self, system_prompt, user_message, **_kw):
            raise RetryableError(provider="grading_primary", status=status, original=None)

    answer = SimpleNamespace(content=[SimpleNamespace(type="text", text="[]")], stop_reason="end_turn",
                             usage=SimpleNamespace(input_tokens=5, output_tokens=2,
                                                   cache_read_input_tokens=0, cache_creation_input_tokens=0))
    monkeypatch.setattr(ai_router, "_client", lambda *_a, **_k: _FakeClaude(answer))
    text = await listening._RoutedAuditProvider(_Legacy()).invoke(SECRET, SECRET)
    assert text == "[]"
    assert [(r["feature"], r["provider"], r["model"], r["error_type"], r["error_code"], r["outcome"])
            for r in failures] == [
        ("listening_audit", "gemini", "gemini-3.8-flash", error_type, status, "fallback"),
    ]
    _assert_no_content(failures)


@pytest.mark.parametrize("raised, error_type, error_code", [
    (asyncio.TimeoutError(), "timeout", "TimeoutError"),
    (ResourceExhausted(SECRET), "rate_limit", "ResourceExhausted"),
])
@pytest.mark.asyncio
async def test_question_generation_sees_through_the_value_error_wrapper(
    failures, claude_first, monkeypatch, raised, error_type, error_code,
):
    from types import SimpleNamespace

    from services import gemini

    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_QUESTION_GENERATION", "gemini,anthropic")
    monkeypatch.setattr(gemini, "_model", _FakeGemini(raised))
    answer = SimpleNamespace(
        content=[SimpleNamespace(type="text", text='[{"question_text": "Q?", "question_type": "part1"}]')],
        stop_reason="end_turn",
        usage=SimpleNamespace(input_tokens=5, output_tokens=2,
                              cache_read_input_tokens=0, cache_creation_input_tokens=0))
    monkeypatch.setattr(ai_router, "_client", lambda *_a, **_k: _FakeClaude(answer))
    parsed = await gemini._call_gemini(SECRET, expect=list)
    assert parsed[0]["question_text"] == "Q?"
    assert [(r["feature"], r["provider"], r["error_type"], r["error_code"], r["outcome"]) for r in failures] == [
        ("question_generation", "gemini", error_type, error_code, "fallback"),
    ]
    _assert_no_content(failures)


# ── Speaking grading orchestrator ──────────────────────────────────────────


class _Provider(AbstractGradingProvider):
    def __init__(self, name, model, script):
        self.provider_name, self.model, self._script = name, model, list(script)

    async def invoke(self, system_prompt, user_message, **kwargs):
        outcome = self._script.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


async def _no_sleep(_seconds):
    return None


@pytest.mark.asyncio
async def test_orchestrator_records_retry_fallback_and_not_configured(failures):
    orchestrator = GradingOrchestrator({
        "grading_primary": _Provider("grading_primary", "gemini-3.8-flash", [
            RetryableError(provider="grading_primary", status="ResourceExhausted"),
            RetryableError(provider="grading_primary", status="DeadlineExceeded"),
        ]),
        "claude_sonnet": _Provider("claude_sonnet", "claude-sonnet-5", ["{}"]),
    }, feature="speaking_grading")
    raw, events = await orchestrator.invoke(
        SECRET, SECRET, user_id="u-1", session_id="s-1",
        order=("grading_primary", "claude_haiku", "claude_sonnet"), sleep=_no_sleep)
    assert raw == "{}"
    assert [(r["route_slot"], r["provider"], r["model"], r["attempt"], r["error_type"], r["outcome"])
            for r in failures] == [
        ("grading_primary", "gemini", "gemini-3.8-flash", 0, "rate_limit", "retry"),
        ("grading_primary", "gemini", "gemini-3.8-flash", 1, "timeout", "fallback"),
        ("claude_haiku", "anthropic", None, 0, "not_configured", "fallback"),
    ]
    assert all(r["feature"] == "speaking_grading" for r in failures)
    _assert_no_content(failures)


@pytest.mark.asyncio
async def test_orchestrator_final_failure_and_untagged_chain(failures):
    def _chain(feature):
        return GradingOrchestrator({
            "claude_sonnet": _Provider("claude_sonnet", "claude-sonnet-5", [
                NonRetryableError(provider="claude_sonnet", status=400)]),
        }, feature=feature)

    with pytest.raises(AllProvidersFailedError):
        await _chain("speaking_grading").invoke("S", "U", order=("claude_sonnet",), sleep=_no_sleep)
    assert [(r["error_type"], r["outcome"]) for r in failures] == [("api_error", "final")]

    failures.clear()
    with pytest.raises(AllProvidersFailedError):
        await _chain(None).invoke("S", "U", order=("claude_sonnet",), sleep=_no_sleep)
    assert failures == []


def test_only_the_speaking_grading_chain_is_logged():
    from types import SimpleNamespace

    from services.grading_orchestrator import build_default

    s = SimpleNamespace(ANTHROPIC_API_KEY="", GEMINI_API_KEY="", SPEAKING_GRADING_MODEL="",
                        AI_PROVIDER_ORDER="", AI_PROVIDER_ORDER_SPEAKING_GRADING="gemini")
    assert build_default(s)._feature == "speaking_grading"
    assert build_default(s, feature="off_topic_judge", operation="judge")._feature is None


@pytest.mark.parametrize("answers, expected", [
    # First answer malformed, second valid: one rejected answer, then a fallback.
    (["not json " + SECRET, "VALID"], [("grading_primary", "gemini", "fallback")]),
    # Both malformed: the second rejection is final.
    (["not json", "still not json"], [("grading_primary", "gemini", "fallback"),
                                      ("claude_haiku", "anthropic", "final")]),
])
def test_speaking_answer_rejected_by_json_validation_is_logged(failures, monkeypatch, answers, expected):
    """A slot can succeed at transport level yet return an unusable grade; the
    grader then retries on another slot. That rejection is a failed attempt."""
    import json as _json

    from services import claude_grader

    valid = _json.dumps({
        "band_fc": 6, "band_lr": 6, "band_gra": 6, "overall_band": 6.0,
        "fc_feedback": "Nói khá trôi chảy.", "lr_feedback": "Từ vựng ổn.",
        "gra_feedback": "Ngữ pháp ổn.", "strengths": ["Phát triển ý tốt"],
        "improvements": ["Dùng từ đa dạng hơn"],
        "improved_response": "I really love reading books because reading relaxes me after a long day.",
        "rubric_version": "v3",
    })
    replies = [valid if a == "VALID" else a for a in answers]
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "", raising=False)
    monkeypatch.setattr(claude_grader, "_client", None, raising=False)
    monkeypatch.setattr(claude_grader, "grading_provider_order",
                        lambda _s=None: ("grading_primary", "claude_haiku"))
    orchestrator = GradingOrchestrator({
        "grading_primary": _Provider("grading_primary", "gemini-3.8-flash", [replies[0]]),
        "claude_haiku": _Provider("claude_haiku", "claude-haiku-4-5-20251001", [replies[1]]),
    }, feature="speaking_grading")
    claude_grader.set_orchestrator(orchestrator)
    try:
        call = claude_grader.grade_response(
            question="What do you like to do in your free time?",
            transcript="I really love reading books because reading relaxes me after work.",
            part=1, mode="test",
        )
        if answers[1] == "VALID":
            assert asyncio.run(call)["overall_band"] == 6.0
        else:
            with pytest.raises(ValueError):
                asyncio.run(call)
    finally:
        claude_grader.set_orchestrator(None)
    assert [(r["route_slot"], r["provider"], r["outcome"]) for r in failures] == expected
    assert all(r["error_type"] == "invalid_json" and r["feature"] == "speaking_grading" for r in failures)
    _assert_no_content(failures)
