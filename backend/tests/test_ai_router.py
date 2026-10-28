"""Anthropic-primary routing (services.ai_router) — no network.

Claude must serve first where configured, and every failure mode (API error,
timeout, rate limit, refusal, truncation, output the existing validator
rejects, missing key) must hand the request to the feature's existing
provider unchanged. Output shapes must be identical whichever provider served.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import anthropic
import httpx
import pytest

from config import settings
from services import ai_router, ai_usage_logger


# ── Fakes ──────────────────────────────────────────────────────────────────────


def _message(text: str, *, stop_reason: str = "end_turn", in_tok: int = 100, out_tok: int = 50):
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        stop_reason=stop_reason,
        usage=SimpleNamespace(
            input_tokens=in_tok, output_tokens=out_tok,
            cache_read_input_tokens=0, cache_creation_input_tokens=0,
        ),
    )


class _FakeClaude:
    """Mimics AsyncAnthropic().messages.create (and the prompt-caching beta
    path the Speaking provider still uses)."""

    def __init__(self, *results):
        self.results = list(results)
        self.requests: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)
        self.beta = SimpleNamespace(prompt_caching=SimpleNamespace(
            messages=SimpleNamespace(create=self._create)))

    async def _create(self, **request):
        self.requests.append(request)
        result = self.results.pop(0) if len(self.results) > 1 else self.results[0]
        if isinstance(result, BaseException):
            raise result
        return result


_REQ = httpx.Request("POST", "https://api.anthropic.com/v1/messages")


def _status_error(cls, status: int):
    return cls("boom", response=httpx.Response(status, request=_REQ), body=None)


@pytest.fixture
def usage_rows(monkeypatch):
    """Capture ledger writes instead of scheduling DB inserts."""
    rows: list[dict] = []

    def _capture(coro):
        frame = coro.cr_frame
        rows.append(dict(frame.f_locals.get("kwargs") or {}))
        coro.close()

    monkeypatch.setattr(ai_usage_logger, "schedule_usage_log", _capture)
    return rows


@pytest.fixture
def claude_on(monkeypatch):
    """Anthropic configured as primary with a fake client."""
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-anthropic-key")
    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER", "anthropic,openai,gemini")
    fake = _FakeClaude(_message("{}"))
    monkeypatch.setattr(ai_router, "_client", lambda *_a, **_k: fake)
    return fake


@pytest.fixture
def claude_off(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(ai_router, "_client",
                        lambda *_a, **_k: pytest.fail("Claude must not be called without a key"))


# ── Provider-order parsing ─────────────────────────────────────────────────────


def test_order_parsing_normalises_and_drops_unknown_and_duplicates():
    assert ai_router.parse_provider_order(" Anthropic , gemini,openai ") == (
        "anthropic", "gemini", "openai")
    assert ai_router.parse_provider_order("gemini,mystery,gemini,anthropic") == (
        "gemini", "anthropic")
    assert ai_router.parse_provider_order("") == ()
    assert ai_router.parse_provider_order(None) == ()


def test_safe_defaults_put_anthropic_first():
    s = SimpleNamespace(AI_PROVIDER_ORDER="")
    assert ai_router.provider_order("question_generation", s) == ("anthropic", "openai", "gemini")
    assert settings.AI_PROVIDER_ORDER == "anthropic,openai,gemini"


def test_per_feature_override_wins_and_empty_inherits_global():
    s = SimpleNamespace(
        AI_PROVIDER_ORDER="gemini,anthropic",
        AI_PROVIDER_ORDER_WRITING_GRADING="anthropic",
        AI_PROVIDER_ORDER_COURSE_WRITING="",
    )
    assert ai_router.provider_order("writing_grading", s) == ("anthropic",)
    assert ai_router.provider_order("course_writing", s) == ("gemini", "anthropic")


def test_speaking_grading_puts_claude_first_by_default():
    """AI-0004 FR-005 (revised 2026-10-26): Speaking inherits the global order,
    so Claude is first; "gemini" restores the Gemini-primary chain."""
    assert settings.AI_PROVIDER_ORDER_SPEAKING_GRADING == ""
    assert ai_router.anthropic_first(
        "speaking_grading", "gemini",
        SimpleNamespace(ANTHROPIC_API_KEY="k", AI_PROVIDER_ORDER="anthropic,openai,gemini",
                        AI_PROVIDER_ORDER_SPEAKING_GRADING=""))
    # A settings object without the attribute behaves like the config default.
    assert ai_router.anthropic_first(
        "speaking_grading", "gemini", SimpleNamespace(ANTHROPIC_API_KEY="k", AI_PROVIDER_ORDER=""))
    rolled_back = SimpleNamespace(ANTHROPIC_API_KEY="k", AI_PROVIDER_ORDER="",
                                  AI_PROVIDER_ORDER_SPEAKING_GRADING="gemini")
    assert ai_router.anthropic_position("speaking_grading", "gemini", rolled_back) is None
    # The global rollback also covers Speaking because it inherits.
    global_rollback = SimpleNamespace(ANTHROPIC_API_KEY="k", AI_PROVIDER_ORDER="gemini,openai",
                                      AI_PROVIDER_ORDER_SPEAKING_GRADING="")
    assert ai_router.anthropic_position("speaking_grading", "gemini", global_rollback) is None


def test_existing_provider_is_never_dropped_and_missing_key_skips_anthropic():
    s = SimpleNamespace(ANTHROPIC_API_KEY="k", AI_PROVIDER_ORDER="anthropic")
    assert ai_router.effective_order("course_writing", "gemini", s) == ("anthropic", "gemini")
    s.ANTHROPIC_API_KEY = ""
    assert ai_router.effective_order("course_writing", "gemini", s) == ("gemini",)
    s2 = SimpleNamespace(ANTHROPIC_API_KEY="k", AI_PROVIDER_ORDER="gemini,anthropic")
    assert ai_router.effective_order("course_writing", "gemini", s2) == ("gemini", "anthropic")


def test_model_tiers_and_per_feature_model_override():
    s = SimpleNamespace(ANTHROPIC_MODEL_GRADING="", ANTHROPIC_MODEL_FAST="")
    assert ai_router.anthropic_model("writing_grading", s) == "claude-sonnet-5-5"
    assert ai_router.anthropic_model("course_writing", s) == "claude-haiku-5-5"
    s.ANTHROPIC_MODEL_FAST = "claude-haiku-4-5-20251001"
    s.ANTHROPIC_MODEL_QUESTION_GENERATION = "claude-sonnet-5-5"
    assert ai_router.anthropic_model("course_writing", s) == "claude-haiku-4-5-20251001"
    assert ai_router.anthropic_model("question_generation", s) == "claude-sonnet-5-5"


# ── Request shape ──────────────────────────────────────────────────────────────


def test_request_caches_the_static_system_prompt_and_omits_rejected_controls():
    haiku = ai_router.build_request("claude-haiku-5-5", system="RUBRIC", user="essay", max_tokens=100)
    assert haiku["system"] == [{"type": "text", "text": "RUBRIC",
                                "cache_control": {"type": "ephemeral"}}]
    assert "temperature" not in haiku
    assert haiku["extra_body"] == {"thinking": {"type": "disabled"}}

    sonnet = ai_router.build_request("claude-sonnet-5-5", system="R", user="u", max_tokens=100)
    assert "temperature" not in sonnet
    assert sonnet["extra_body"] == {"thinking": {"type": "between_tools"}}
    assert sonnet["max_tokens"] == 100

    with_image = ai_router.build_request("claude-sonnet-5-5", system="R", user="u",
                                         max_tokens=10, images=[(b"\x89PNG", "image/png")])
    blocks = with_image["messages"][0]["content"]
    assert blocks[0]["type"] == "image" and blocks[0]["source"]["media_type"] == "image/png"
    assert blocks[-1] == {"type": "text", "text": "u"}


# ── One Claude attempt ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_success_returns_validated_output_and_logs_the_serving_provider(claude_on, usage_rows):
    claude_on.results = [_message('{"ok": true}')]
    result, parsed = await ai_router.call_anthropic(
        "course_writing", system="S", user="U", max_tokens=50,
        operation="grade_batch", validate=json.loads, user_id="u1",
    )
    assert parsed == {"ok": True}
    assert result.model == "claude-haiku-5-5"
    assert usage_rows[-1]["status"] == "success"
    assert usage_rows[-1]["feature"] == "course_writing"
    assert usage_rows[-1]["metadata"]["route"] == "anthropic_primary"
    assert usage_rows[-1]["input_tokens"] == 100
    assert "test-anthropic-key" not in json.dumps(usage_rows, default=str)


@pytest.mark.parametrize("failure, code", [
    (_status_error(anthropic.RateLimitError, 429), "rate_limited"),
    (_status_error(anthropic.InternalServerError, 529), "529"),
    (_status_error(anthropic.BadRequestError, 400), "400"),
    (anthropic.APITimeoutError(request=_REQ), "timeout"),
    (anthropic.APIConnectionError(request=_REQ), "network"),
])
@pytest.mark.asyncio
async def test_api_failures_become_fallback_signals(claude_on, usage_rows, failure, code):
    claude_on.results = [failure]
    with pytest.raises(ai_router.AnthropicAttemptError) as err:
        await ai_router.call_anthropic("course_writing", system="S", user="U",
                                       max_tokens=50, operation="op")
    assert err.value.error_code == code
    assert usage_rows[-1]["status"] == "error"


@pytest.mark.parametrize("message", [
    _message('{"ok": tru'),                         # malformed JSON
    _message('{"ok": true}', stop_reason="max_tokens"),
    _message("I can't help with that.", stop_reason="refusal"),
    _message(""),
])
@pytest.mark.asyncio
async def test_invalid_output_becomes_a_fallback_signal(claude_on, usage_rows, message):
    claude_on.results = [message]
    with pytest.raises(ai_router.AnthropicAttemptError):
        await ai_router.call_anthropic("course_writing", system="S", user="U",
                                       max_tokens=50, operation="op", validate=json.loads)
    assert usage_rows[-1]["status"] == "invalid_response"


@pytest.mark.asyncio
async def test_ungrounded_rejection_records_its_code_and_detail(claude_on, usage_rows, caplog):
    from services.writing_feedback_grounding import UngroundedWritingFeedbackError

    def reject(_text):
        raise UngroundedWritingFeedbackError(
            [("criteriaFeedback.lexicalResource.feedback", "invented subsidies")])

    claude_on.results = [_message('{"answer": "MODEL-ANSWER-SENTINEL"}', in_tok=700, out_tok=6000)]
    with caplog.at_level("WARNING", logger="services.ai_router"), \
            pytest.raises(ai_router.AnthropicAttemptError) as err:
        await ai_router.call_anthropic("writing_grading", system="S", user="U", max_tokens=50,
                                       operation="pass1", validate=reject)
    detail = "Unsupported essay citations at criteriaFeedback.lexicalResource.feedback"
    assert err.value.error_code == "ungrounded_feedback"
    assert isinstance(err.value.__cause__, UngroundedWritingFeedbackError)
    row = usage_rows[-1]
    assert (row["status"], row["error_code"]) == ("invalid_response", "ungrounded_feedback")
    assert row["metadata"] == {"route": "anthropic_primary", "error_detail": detail}
    assert row["output_tokens"] == 6000                 # billed attempt stays priced
    assert detail in caplog.text and "ungrounded_feedback" in caplog.text
    # Never the model's answer or the cited learner/model text.
    for leaked in ("invented subsidies", "MODEL-ANSWER-SENTINEL"):
        assert leaked not in json.dumps(usage_rows, default=str) and leaked not in caplog.text


@pytest.mark.parametrize("validate, code, detail", [
    (json.loads, "invalid_json", "Expecting value: line 1 column 8 (char 7)"),
    ("InvalidJSONError", "invalid_json", "No JSON object found in response"),
    ("ValueError", "invalid_response", "missing_or_invalid_result"),
])
@pytest.mark.asyncio
async def test_invalid_answers_keep_a_specific_code_and_reason(claude_on, usage_rows,
                                                               validate, code, detail):
    from services.gemini_writing_grader import InvalidJSONError

    errors = {"InvalidJSONError": InvalidJSONError, "ValueError": ValueError}
    if isinstance(validate, str):
        exc_type = errors[validate]

        def validate(_text, _exc=exc_type, _msg=detail):
            raise _exc(_msg)

    claude_on.results = [_message('{"ok": tru')]
    with pytest.raises(ai_router.AnthropicAttemptError) as err:
        await ai_router.call_anthropic("course_writing", system="S", user="U",
                                       max_tokens=50, operation="op", validate=validate)
    assert err.value.error_code == code and str(err.value) == detail
    assert usage_rows[-1]["error_code"] == code
    assert usage_rows[-1]["metadata"]["error_detail"] == detail


@pytest.mark.asyncio
async def test_rejection_detail_is_truncated_and_never_echoes_schema_input(claude_on, usage_rows):
    from pydantic import BaseModel

    def long_reason(_text):
        raise ValueError("x" * 2000)

    claude_on.results = [_message("{}")]
    with pytest.raises(ai_router.AnthropicAttemptError):
        await ai_router.call_anthropic("course_writing", system="S", user="U",
                                       max_tokens=50, operation="op", validate=long_reason)
    assert usage_rows[-1]["metadata"]["error_detail"] == "x" * ai_router.ERROR_DETAIL_MAX_CHARS == "x" * 500

    class Shape(BaseModel):
        band: int

    claude_on.results = [_message('{"band": "MODEL-WROTE-THIS"}')]
    with pytest.raises(ai_router.AnthropicAttemptError):
        await ai_router.call_anthropic("course_writing", system="S", user="U", max_tokens=50,
                                       operation="op", validate=lambda t: Shape(**json.loads(t)))
    assert usage_rows[-1]["metadata"]["error_detail"] == "schema: band: int_parsing"
    assert "MODEL-WROTE-THIS" not in json.dumps(usage_rows)


@pytest.mark.asyncio
async def test_missing_key_never_builds_a_client(claude_off):
    with pytest.raises(ai_router.AnthropicAttemptError) as err:
        await ai_router.call_anthropic("course_writing", system="S", user="U",
                                       max_tokens=5, operation="op")
    assert err.value.error_code == "missing_api_key"


# ── Fallback orchestration ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_with_fallback_prefers_claude_then_falls_back(claude_on):
    legacy = AsyncMock(return_value="gemini")
    assert await ai_router.with_fallback(
        "question_generation", legacy_provider="gemini",
        anthropic_call=AsyncMock(return_value="claude"), legacy_call=legacy,
    ) == "claude"
    legacy.assert_not_awaited()

    failing = AsyncMock(side_effect=ai_router.AnthropicAttemptError("timeout"))
    assert await ai_router.with_fallback(
        "question_generation", legacy_provider="gemini",
        anthropic_call=failing, legacy_call=legacy,
    ) == "gemini"
    legacy.assert_awaited_once()


@pytest.mark.asyncio
async def test_with_fallback_without_key_runs_only_the_existing_path(claude_off):
    claude = AsyncMock(return_value="claude")
    legacy = AsyncMock(side_effect=ValueError("Gemini request failed"))
    with pytest.raises(ValueError, match="Gemini request failed"):
        await ai_router.with_fallback(
            "question_generation", legacy_provider="gemini",
            anthropic_call=claude, legacy_call=legacy,
        )
    claude.assert_not_awaited()


@pytest.mark.asyncio
async def test_with_fallback_honours_an_existing_provider_first_order(claude_on, monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_QUESTION_GENERATION", "gemini,anthropic")
    calls = []
    async def legacy():
        calls.append("gemini"); raise ValueError("down")
    async def claude():
        calls.append("anthropic"); return "claude"
    assert await ai_router.with_fallback(
        "question_generation", legacy_provider="gemini",
        anthropic_call=claude, legacy_call=legacy,
    ) == "claude"
    assert calls == ["gemini", "anthropic"]


# ── Question generation ────────────────────────────────────────────────────────


@pytest.fixture
def no_question_cache(monkeypatch):
    from services import gemini
    monkeypatch.setattr(gemini, "_cache_get", lambda **_k: None)
    monkeypatch.setattr(gemini, "_cache_set", lambda **_k: None)
    return gemini


_PART1 = [{"question_text": "Do you like tea?", "question_type": "personal"},
          {"question_text": "Where do you drink it?", "question_type": "place"}]


@pytest.mark.asyncio
async def test_questions_are_served_by_claude_without_touching_gemini(
        claude_on, usage_rows, no_question_cache, monkeypatch):
    gemini = no_question_cache
    claude_on.results = [_message("```json\n" + json.dumps(_PART1) + "\n```")]
    monkeypatch.setattr(gemini, "_gemini_generate",
                        AsyncMock(side_effect=AssertionError("Gemini must not run")))
    assert await gemini.generate_part1_questions("Tea", count=2) == _PART1


@pytest.mark.asyncio
async def test_wrong_shape_from_claude_falls_back_to_gemini(
        claude_on, usage_rows, no_question_cache, monkeypatch):
    gemini = no_question_cache
    claude_on.results = [_message('{"question_text": "not a list"}')]
    legacy = AsyncMock(return_value=_PART1)
    monkeypatch.setattr(gemini, "_gemini_generate", legacy)
    assert await gemini.generate_part1_questions("Tea", count=2) == _PART1
    legacy.assert_awaited_once()


# ── Course writing (schema parity) ─────────────────────────────────────────────


_CW_ITEMS = [{"qid": "E1", "prompt": "p", "answer": "She go to school."}]
_CW_JSON = json.dumps({"results": [{
    "qid": "E1", "corrected": "She goes to school.", "ok": False,
    "issues": [{"type": "grammar", "before": "go", "after": "goes", "note": "chia động từ"}],
}]})


def _gemini_model(text: str):
    response = SimpleNamespace(text=text, usage_metadata=None)
    return type("M", (), {"generate_content_async": AsyncMock(return_value=response)})()


@pytest.mark.asyncio
async def test_course_writing_claude_and_gemini_results_have_identical_shape(
        claude_on, usage_rows, monkeypatch):
    from services import course_writing_grader as cw

    claude_on.results = [_message(_CW_JSON)]
    with patch.object(cw, "_model", side_effect=AssertionError("Gemini must not run")):
        claude_out, claude_model = await cw.grade(_CW_ITEMS)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    with patch.object(cw, "_model", return_value=("gemini-3.5-flash-lite", _gemini_model(_CW_JSON))):
        gemini_out, gemini_model = await cw.grade(_CW_ITEMS)

    assert claude_model == "claude-haiku-5-5" and gemini_model == "gemini-3.5-flash-lite"
    assert claude_out == gemini_out
    assert claude_out[0]["ok"] is False


@pytest.mark.asyncio
async def test_course_writing_incomplete_claude_answer_uses_the_gemini_path(claude_on, usage_rows):
    from services import course_writing_grader as cw

    claude_on.results = [_message('{"results": []}')]   # misses qid E1
    with patch.object(cw, "_model", return_value=("gemini-3.5-flash-lite", _gemini_model(_CW_JSON))):
        out, model = await cw.grade(_CW_ITEMS)
    assert model == "gemini-3.5-flash-lite"
    assert out[0]["corrected"] == "She goes to school."


# ── Advanced vocabulary rewrite ────────────────────────────────────────────────


_AV_ITEMS = [{"item_id": "rewrite-01", "prompt": "Use 'albeit'", "answer": "It was hard, albeit fun."}]
_AV_JSON = json.dumps({
    "results": [{"item_id": "rewrite-01", "corrected": "It was hard, albeit fun.",
                 "grammar_notes": [], "style_note": "Tự nhiên.",
                 "target_usage_note": "Dùng đúng.", "ok": True}],
    "overall": {"strengths": ["Rõ ràng"], "focus": []},
})


@pytest.mark.asyncio
async def test_vocab_rewrite_parity_and_fallback(claude_on, usage_rows, monkeypatch):
    from services import advanced_vocab_rewrite_grader as av

    claude_on.results = [_message(_AV_JSON)]
    with patch.object(av, "_model", side_effect=AssertionError("Gemini must not run")):
        claude_feedback, claude_model, claude_err = await av.grade_rewrites(_AV_ITEMS)

    claude_on.results = [_message('{"results": "nope"}')]
    with patch.object(av, "_model", return_value=("gemini-3.5-flash-lite", _gemini_model(_AV_JSON))):
        gemini_feedback, gemini_model, gemini_err = await av.grade_rewrites(_AV_ITEMS)

    assert claude_err is None and gemini_err is None
    assert claude_model == "claude-haiku-5-5" and gemini_model == "gemini-3.5-flash-lite"
    assert claude_feedback == gemini_feedback


# ── Writing grader ─────────────────────────────────────────────────────────────


def _writing_feedback_json() -> str:
    from tests.test_gemini_writing_grader import VALID_FEEDBACK  # noqa: WPS433
    return json.dumps(VALID_FEEDBACK)


@pytest.mark.asyncio
async def test_writing_grader_claude_attempt_is_validated_by_the_same_schema(claude_on, usage_rows):
    from models.writing_feedback import WritingFeedback
    from services.gemini_writing_grader import GeminiWritingGrader

    grader = GeminiWritingGrader(api_key="test-gemini")
    raw = _writing_feedback_json()
    claude_on.results = [_message(raw, in_tok=1000, out_tok=500)]
    with patch("services.gemini_writing_grader.genai.GenerativeModel",
               side_effect=AssertionError("Gemini must not run")):
        text, usage = await grader._call_with_retry(
            "gemini-3.8-flash", "SYSTEM", "USER", parse_schema=WritingFeedback,
            anthropic_feature="writing_grading",
        )
    assert text == raw
    assert usage["served_model"] == "claude-sonnet-5-5"
    assert usage["cost_usd"] == pytest.approx(1000 * 2 / 1e6 + 500 * 10 / 1e6)
    assert claude_on.requests[0]["model"] == "claude-sonnet-5-5"


@pytest.mark.asyncio
async def test_writing_grader_invalid_claude_output_runs_the_gemini_loop(claude_on, usage_rows):
    from models.writing_feedback import WritingFeedback
    from services.gemini_writing_grader import GeminiWritingGrader

    grader = GeminiWritingGrader(api_key="test-gemini")
    raw = _writing_feedback_json()
    claude_on.results = [_message('{"overallBandScore": 6.5}')]   # schema-invalid
    gemini_response = SimpleNamespace(
        text=raw, usage_metadata=None,
        candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="STOP"))],
    )
    fake_model = SimpleNamespace(generate_content=lambda *_a, **_k: gemini_response)
    with patch("services.gemini_writing_grader.genai.GenerativeModel", return_value=fake_model):
        text, usage = await grader._call_with_retry(
            "gemini-3.8-flash", "SYSTEM", "USER", parse_schema=WritingFeedback,
            anthropic_feature="writing_grading",
        )
    assert text == raw
    assert "served_model" not in usage


@pytest.mark.asyncio
async def test_writing_paths_without_anthropic_feature_never_call_claude(monkeypatch, usage_rows):
    """Chart analysis, Deep passes 2/3 and scripts keep their Gemini behaviour."""
    from services.gemini_writing_grader import GeminiWritingGrader

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-anthropic-key")
    monkeypatch.setattr(ai_router, "_client", lambda *_a, **_k: pytest.fail("no Claude here"))
    grader = GeminiWritingGrader(api_key="test-gemini")
    response = SimpleNamespace(
        text='{"ok": true}', usage_metadata=None,
        candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="STOP"))],
    )
    fake_model = SimpleNamespace(generate_content=lambda *_a, **_k: response)
    with patch("services.gemini_writing_grader.genai.GenerativeModel", return_value=fake_model):
        text, _ = await grader._call_with_retry("gemini-2.5-pro", "S", "U")
    assert text == '{"ok": true}'


# ── Speaking grader slot ───────────────────────────────────────────────────────


def test_speaking_slot_is_registered_first_by_default_and_absent_when_rolled_back():
    from services.grading_orchestrator import (
        ANTHROPIC_PRIMARY_SLOT, GRADING_PROVIDER_ORDER, build_default, grading_provider_order,
    )

    base = dict(ANTHROPIC_API_KEY="k", GEMINI_API_KEY="g", SPEAKING_GRADING_MODEL="gemini-3.8-flash",
                AI_PROVIDER_ORDER="anthropic,openai,gemini", ANTHROPIC_MODEL_GRADING="")
    default = SimpleNamespace(**base, AI_PROVIDER_ORDER_SPEAKING_GRADING="")
    assert grading_provider_order(default) == (ANTHROPIC_PRIMARY_SLOT, *GRADING_PROVIDER_ORDER)
    slot = build_default(default).providers[ANTHROPIC_PRIMARY_SLOT]
    assert slot.model == "claude-sonnet-5-5"

    explicit = SimpleNamespace(**base, AI_PROVIDER_ORDER_SPEAKING_GRADING="anthropic")
    assert grading_provider_order(explicit) == (ANTHROPIC_PRIMARY_SLOT, *GRADING_PROVIDER_ORDER)

    rolled_back = SimpleNamespace(**base, AI_PROVIDER_ORDER_SPEAKING_GRADING="gemini")
    assert grading_provider_order(rolled_back) == GRADING_PROVIDER_ORDER
    assert ANTHROPIC_PRIMARY_SLOT not in build_default(rolled_back).providers

    no_key = SimpleNamespace(**{**base, "ANTHROPIC_API_KEY": ""},
                             AI_PROVIDER_ORDER_SPEAKING_GRADING="")
    assert grading_provider_order(no_key) == GRADING_PROVIDER_ORDER


def _speaking_settings(monkeypatch, *, anthropic_key="test-anthropic-key"):
    """The real config defaults, with test keys so every provider is built."""
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", anthropic_key)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test-gemini-key")
    for name in ("AI_PROVIDER_ORDER", "AI_PROVIDER_ORDER_SPEAKING_GRADING",
                 "ANTHROPIC_MODEL_GRADING", "ANTHROPIC_MODEL_SPEAKING_GRADING",
                 "SPEAKING_GRADING_MODEL"):
        monkeypatch.setattr(settings, name, type(settings).model_fields[name].default)
    return settings


def test_speaking_default_chain_is_sonnet55_then_gemini38_haiku45_sonnet5(monkeypatch):
    """FR-005: the code defaults alone give the approved order and models."""
    from services.grading_orchestrator import build_default, grading_provider_order

    s = _speaking_settings(monkeypatch)
    order = grading_provider_order(s)
    assert order == ("anthropic_primary", "grading_primary", "claude_haiku", "claude_sonnet")
    providers = build_default(s).providers
    assert [getattr(providers[name], "model", None) or providers[name].model_name
            for name in order] == [
        "claude-sonnet-5-5", "gemini-3.8-flash", "claude-haiku-4-5-20251001", "claude-sonnet-5",
    ]


class _ChainProvider:
    def __init__(self, name, result, calls):
        self.provider_name, self.result, self.calls = name, result, calls
        self.retry_attempts = 0

    async def invoke(self, *_a, **_k):
        self.calls.append(self.provider_name)
        if isinstance(self.result, BaseException):
            raise self.result
        return self.result


@pytest.mark.asyncio
@pytest.mark.parametrize("serving_index", [0, 1, 2, 3])
async def test_speaking_falls_back_through_every_provider_in_order(serving_index):
    """Each rung serves once every rung before it has failed."""
    from services.grading_orchestrator import GradingOrchestrator
    from services.grading_providers.errors import NonRetryableError, RetryableError

    order = ("anthropic_primary", "grading_primary", "claude_haiku", "claude_sonnet")
    failures = [
        RetryableError(provider="anthropic_primary", status=429),
        RetryableError(provider="grading_primary", status=503),
        NonRetryableError(provider="claude_haiku", status="empty_body", original=None),
    ]
    calls: list[str] = []
    providers = {
        name: _ChainProvider(
            name, failures[i] if i < serving_index else f'{{"served_by": "{name}"}}', calls)
        for i, name in enumerate(order)
    }

    async def _no_sleep(_s):
        return None

    raw, events = await GradingOrchestrator(providers).invoke("S", "U", order=order, sleep=_no_sleep)
    assert json.loads(raw) == {"served_by": order[serving_index]}
    assert calls == list(order[: serving_index + 1])
    assert [e.provider for e in events] == list(order[: serving_index + 1])
    assert events[-1].outcome == "success"


def _valid_speaking(mode: str) -> dict:
    if mode == "practice":
        return {
            "grammar_issues": [], "vocabulary_issues": [], "pronunciation_issues": [],
            "corrections": [],
            "strengths": ["Ý rõ ràng"],
            "sample_answer": "I really love reading books because reading helps me relax after work.",
            "overall_band": 6.0,
        }
    return {
        "band_fc": 6, "band_lr": 6, "band_gra": 6, "overall_band": 6.0,
        "fc_feedback": "Nói khá trôi chảy.", "lr_feedback": "Từ vựng ổn.",
        "gra_feedback": "Ngữ pháp ổn.", "strengths": ["Phát triển ý tốt"],
        "improvements": ["Dùng từ đa dạng hơn"],
        "improved_response": "I really love reading books because reading helps me relax after work.",
        "rubric_version": "v3",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["test", "practice"])
@pytest.mark.parametrize("with_sink", [True, False])
async def test_malformed_claude_speaking_answer_is_retried_on_gemini(monkeypatch, mode, with_sink):
    """The corrective retry after a malformed Sonnet 5.5 answer goes to Gemini 3.8,
    never back to Claude, through the real grader and orchestrator."""
    from services import claude_grader as cg
    from services.grading_orchestrator import GradingOrchestrator

    _speaking_settings(monkeypatch)
    calls: list[str] = []
    valid = _valid_speaking(mode)
    providers = {
        "anthropic_primary": _ChainProvider("anthropic_primary", '{"overall_band": 6.0, "band_fc"', calls),
        "grading_primary": _ChainProvider("grading_primary", json.dumps(valid), calls),
        "claude_haiku": _ChainProvider("claude_haiku", "{}", calls),
        "claude_sonnet": _ChainProvider("claude_sonnet", "{}", calls),
    }
    monkeypatch.setattr(cg, "_get_orchestrator", lambda: GradingOrchestrator(providers))
    monkeypatch.setattr(cg, "_get_client", lambda: None)
    sink: list = [] if with_sink else None

    result = await cg.grade_response(
        question="What do you do after work?",
        transcript="I really love reading books because reading helps me relax after work.",
        part=1, mode=mode, fallback_events=sink,
    )
    assert calls == ["anthropic_primary", "grading_primary"]
    assert result["overall_band"] == 6.0
    if mode == "test":
        assert result["improved_response"] == valid["improved_response"]
    if with_sink:
        assert [(e.provider, e.outcome) for e in sink] == [
            ("anthropic_primary", "success"), ("grading_primary", "success")]


@pytest.mark.asyncio
async def test_missing_anthropic_key_grades_speaking_on_gemini(monkeypatch):
    """A blank ANTHROPIC_API_KEY drops every Claude slot; Gemini 3.8 grades."""
    from services.grading_orchestrator import (
        GRADING_PROVIDER_ORDER, build_default, grading_provider_order,
    )

    s = _speaking_settings(monkeypatch, anthropic_key="")
    order = grading_provider_order(s)
    assert order == GRADING_PROVIDER_ORDER
    orch = build_default(s)
    assert not {"anthropic_primary", "claude_haiku", "claude_sonnet"} & set(orch.providers)
    assert orch.providers["grading_primary"].model_name == "gemini-3.8-flash"

    async def gemini_invoke(*_a, **_k):
        return '{"from": "gemini"}'

    orch._providers["grading_primary"].invoke = gemini_invoke
    raw, events = await orch.invoke("S", "U", order=order)
    assert raw == '{"from": "gemini"}'
    assert [(e.provider, e.outcome) for e in events] == [("grading_primary", "success")]


@pytest.mark.asyncio
async def test_speaking_slot_request_shape_and_truncation_escalates(usage_rows):
    from services.grading_providers.claude import ClaudeProvider
    from services.grading_providers.errors import NonRetryableError

    fake = _FakeClaude(_message('{"overall_band": 6.0}'))
    provider = ClaudeProvider(client=fake, max_tokens=4096)
    provider.model = "claude-sonnet-5-5"
    provider.provider_name = "anthropic_primary"
    assert await provider.invoke("SYS", "USER") == '{"overall_band": 6.0}'
    request = fake.requests[0]
    assert "temperature" not in request
    assert request["extra_body"] == {"thinking": {"type": "between_tools"}}
    assert request["system"][0]["cache_control"] == {"type": "ephemeral"}

    fake.results = [_message('{"overall_band": 6', stop_reason="max_tokens")]
    with pytest.raises(NonRetryableError):
        await provider.invoke("SYS", "USER")


def test_speaking_retry_after_malformed_claude_answer_goes_to_gemini(monkeypatch):
    from services import claude_grader as cg
    from services.grading_providers.errors import FallbackEvent

    monkeypatch.setattr(cg.settings, "ANTHROPIC_API_KEY", "k")
    events = [FallbackEvent(provider="anthropic_primary", attempt=0, outcome="success", latency_ms=1)]
    assert cg._order_after(events)[0] == "grading_primary"


@pytest.mark.asyncio
async def test_speaking_orchestrator_falls_back_from_claude_slot_to_existing_chain():
    from services.grading_orchestrator import (
        ANTHROPIC_PRIMARY_SLOT, GRADING_PROVIDER_ORDER, GradingOrchestrator,
    )
    from services.grading_providers.errors import RetryableError

    class _P:
        def __init__(self, name, result):
            self.provider_name, self.result = name, result
        async def invoke(self, *_a, **_k):
            if isinstance(self.result, BaseException):
                raise self.result
            return self.result

    orch = GradingOrchestrator({
        ANTHROPIC_PRIMARY_SLOT: _P(ANTHROPIC_PRIMARY_SLOT,
                                   RetryableError(provider=ANTHROPIC_PRIMARY_SLOT, status=429)),
        "grading_primary": _P("grading_primary", '{"from": "gemini"}'),
    })

    async def _no_sleep(_s):
        return None

    raw, events = await orch.invoke(
        "S", "U", order=(ANTHROPIC_PRIMARY_SLOT, *GRADING_PROVIDER_ORDER), sleep=_no_sleep,
    )
    assert raw == '{"from": "gemini"}'
    assert [e.provider for e in events][-1] == "grading_primary"
    assert events[0].provider == ANTHROPIC_PRIMARY_SLOT


@pytest.mark.asyncio
async def test_speaking_claude_slot_gets_one_attempt_and_its_own_time(monkeypatch):
    """A Claude 429 must not spend the existing chain's retry/time budget."""
    from services.grading_orchestrator import (
        ANTHROPIC_PRIMARY_SLOT, GRADING_PROVIDER_ORDER, build_default,
    )
    from services.grading_providers.errors import RetryableError

    s = SimpleNamespace(ANTHROPIC_API_KEY="k", GEMINI_API_KEY="g",
                        SPEAKING_GRADING_MODEL="gemini-3.8-flash", AI_PROVIDER_ORDER="",
                        AI_PROVIDER_ORDER_SPEAKING_GRADING="anthropic", ANTHROPIC_MODEL_GRADING="")
    orch = build_default(s)
    calls = []

    async def claude_invoke(*_a, **_k):
        calls.append("claude")
        raise RetryableError(provider=ANTHROPIC_PRIMARY_SLOT, status=429)

    async def gemini_invoke(*_a, **_k):
        calls.append("gemini")
        return "{}"

    orch._providers[ANTHROPIC_PRIMARY_SLOT].invoke = claude_invoke
    orch._providers["grading_primary"].invoke = gemini_invoke

    async def _no_sleep(_s):
        return None

    raw, _ = await orch.invoke("S", "U", order=(ANTHROPIC_PRIMARY_SLOT, *GRADING_PROVIDER_ORDER),
                               sleep=_no_sleep, total_timeout_seconds=0.0001,
                               attempt_timeout_seconds=5)
    assert raw == "{}"
    assert calls == ["claude", "gemini"]


# ── Listening audit ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_listening_audit_routes_to_claude_and_records_the_served_model(claude_on, usage_rows):
    from routers.listening import _RoutedAuditProvider

    claude_on.results = [_message('[{"q_num":1,"code":"prompt_clarity","severity":"warning","message":"x"}]')]
    legacy = SimpleNamespace(invoke=AsyncMock(side_effect=AssertionError("Gemini must not run")))
    provider = _RoutedAuditProvider(legacy)
    raw = await provider.invoke("SYS", "USER")
    assert json.loads(raw)[0]["q_num"] == 1
    assert provider.served_model == "claude-haiku-5-5"

    claude_on.results = [_message("Everything looks fine.")]          # no JSON array
    legacy = SimpleNamespace(invoke=AsyncMock(return_value="[]"))
    provider = _RoutedAuditProvider(legacy)
    assert await provider.invoke("SYS", "USER") == "[]"
    assert provider.served_model == settings.LISTENING_AUDIT_MODEL


@pytest.mark.asyncio
async def test_pinned_sdk_sends_cache_control_and_model_thinking_on_the_wire(usage_rows):
    """Real anthropic client + mock transport: the body the API receives."""
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        seen["beta"] = request.headers.get("anthropic-beta")
        return httpx.Response(200, json={
            "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-5-5",
            "content": [{"type": "text", "text": '{"ok": true}'}],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 3,
                      "cache_read_input_tokens": 7, "cache_creation_input_tokens": 0},
        })

    client = anthropic.AsyncAnthropic(
        api_key="test", max_retries=0,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    s = SimpleNamespace(ANTHROPIC_API_KEY="test", ANTHROPIC_MODEL_GRADING="",
                        ANTHROPIC_MODEL_WRITING_GRADING="")
    result, parsed = await ai_router.call_anthropic(
        "writing_grading", system="RUBRIC", user="ESSAY", max_tokens=64,
        operation="pass1", validate=json.loads, settings_obj=s, client=client,
    )
    body = seen["body"]
    assert body["model"] == "claude-sonnet-5-5"
    assert body["system"] == [{"type": "text", "text": "RUBRIC",
                               "cache_control": {"type": "ephemeral"}}]
    assert body["thinking"] == {"type": "between_tools"}
    assert "temperature" not in body
    assert seen["beta"] is None
    assert parsed == {"ok": True}
    assert result.usage["cache_read_tokens"] == 7


# ── Review round 1 (Codex) regressions ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_claude_cue_card_missing_fields_falls_back_before_caching(
        claude_on, usage_rows, monkeypatch):
    from services import gemini

    cached = []
    monkeypatch.setattr(gemini, "_cache_get", lambda **_k: None)
    monkeypatch.setattr(gemini, "_cache_set", lambda **k: cached.append(k["questions"]))
    good = {"question_text": "Describe a trip.", "cue_card_bullets": ["Where", "Who", "What"],
            "cue_card_reflection": "and explain why."}
    claude_on.results = [_message("{}")]
    legacy = AsyncMock(return_value=dict(good))
    monkeypatch.setattr(gemini, "_gemini_generate", legacy)
    card = await gemini.generate_part2_cuecard("Trips")
    assert card["question_text"] == "Describe a trip."
    assert cached == [card]
    legacy.assert_awaited_once()


@pytest.mark.parametrize("payload", [
    "[]", '[{"question_text": "Q?"}]', '[{"question_text": "", "question_type": "opinion"}]',
])
def test_question_list_requires_every_field(payload):
    from services import gemini
    with pytest.raises(ValueError):
        gemini._parse_question_json(payload, list)


def test_anthropic_position_reports_first_after_or_absent():
    s = SimpleNamespace(ANTHROPIC_API_KEY="k", AI_PROVIDER_ORDER="anthropic")
    assert ai_router.anthropic_position("course_writing", "gemini", s) == "first"
    s.AI_PROVIDER_ORDER = "gemini,anthropic"
    assert ai_router.anthropic_position("course_writing", "gemini", s) == "after"
    s.AI_PROVIDER_ORDER = "gemini"
    assert ai_router.anthropic_position("course_writing", "gemini", s) is None
    s.AI_PROVIDER_ORDER, s.ANTHROPIC_API_KEY = "gemini,anthropic", ""
    assert ai_router.anthropic_position("course_writing", "gemini", s) is None


@pytest.mark.asyncio
async def test_writing_claude_after_gemini_serves_when_the_gemini_loop_fails(
        claude_on, usage_rows, monkeypatch):
    from models.writing_feedback import WritingFeedback
    from services import gemini_writing_grader as gwg

    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_WRITING_GRADING", "gemini,anthropic")
    monkeypatch.setattr(gwg, "INITIAL_RETRY_DELAY_S", 0)
    grader = gwg.GeminiWritingGrader(api_key="test-gemini")
    raw = _writing_feedback_json()
    claude_on.results = [_message(raw)]
    calls = []

    def _boom(*_a, **_k):
        calls.append("gemini")
        raise RuntimeError("gemini down")

    with patch("services.gemini_writing_grader.genai.GenerativeModel",
               return_value=SimpleNamespace(generate_content=_boom)):
        text, usage = await grader._call_with_retry(
            "gemini-3.8-flash", "S", "U", parse_schema=WritingFeedback,
            anthropic_feature="writing_grading",
        )
    assert calls == ["gemini"] * gwg.MAX_RETRIES       # Gemini loop ran first, in full
    assert text == raw and usage["served_model"] == "claude-sonnet-5-5"


@pytest.mark.asyncio
async def test_course_writing_and_rewrite_claude_after_gemini_failure(
        claude_on, usage_rows, monkeypatch):
    from services import advanced_vocab_rewrite_grader as av
    from services import course_writing_grader as cw

    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_COURSE_WRITING", "gemini,anthropic")
    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_ADVANCED_VOCAB_REWRITE", "gemini,anthropic")

    broken = type("M", (), {"generate_content_async": AsyncMock(side_effect=RuntimeError("down"))})()
    claude_on.results = [_message(_CW_JSON)]
    with patch.object(cw, "_model", return_value=("gemini-3.5-flash-lite", broken)):
        out, model = await cw.grade(_CW_ITEMS)
    assert model == "claude-haiku-5-5" and out[0]["corrected"] == "She goes to school."

    claude_on.results = [_message(_AV_JSON)]
    with patch.object(av, "_model", return_value=("gemini-3.5-flash-lite", broken)):
        feedback, model, err = await av.grade_rewrites(_AV_ITEMS)
    assert (model, err) == ("claude-haiku-5-5", None)

    # A healthy Gemini answer is used without calling Claude.
    monkeypatch.setattr(ai_router, "_client", lambda *_a, **_k: pytest.fail("Claude not needed"))
    with patch.object(cw, "_model", return_value=("gemini-3.5-flash-lite", _gemini_model(_CW_JSON))):
        _, model = await cw.grade(_CW_ITEMS)
    assert model == "gemini-3.5-flash-lite"


def test_speaking_claude_after_gemini_is_appended_to_the_chain():
    from services.grading_orchestrator import (
        ANTHROPIC_PRIMARY_SLOT, GRADING_PROVIDER_ORDER, build_default, grading_provider_order,
    )
    s = SimpleNamespace(ANTHROPIC_API_KEY="k", GEMINI_API_KEY="g",
                        SPEAKING_GRADING_MODEL="gemini-3.8-flash", AI_PROVIDER_ORDER="",
                        AI_PROVIDER_ORDER_SPEAKING_GRADING="gemini,anthropic",
                        ANTHROPIC_MODEL_GRADING="")
    assert grading_provider_order(s) == (*GRADING_PROVIDER_ORDER, ANTHROPIC_PRIMARY_SLOT)
    assert ANTHROPIC_PRIMARY_SLOT in build_default(s).providers


@pytest.mark.asyncio
async def test_degraded_deep_result_is_attributed_to_the_pass1_model(monkeypatch):
    from models.writing_feedback import GradingResult, GradingTier, WritingFeedback
    from services.gemini_writing_grader import GeminiWritingGrader

    grader = GeminiWritingGrader(api_key="test-gemini")
    pass1 = GradingResult(
        feedback=WritingFeedback(**json.loads(_writing_feedback_json())),
        model_used="claude-sonnet-5-5", tokens_input=10, tokens_output=5, cost_usd=0.01,
        grading_duration_ms=5, prompt_version="v2", grading_tier=GradingTier.STANDARD,
    )
    monkeypatch.setattr(grader, "_grade_standard", AsyncMock(return_value=pass1))
    monkeypatch.setattr(grader, "_run_deep_pass2", AsyncMock(side_effect=RuntimeError("pass2 down")))
    result = await grader._grade_deep(SimpleNamespace(), SimpleNamespace(PROMPT_VERSION="v2"))
    assert result.prompt_version.endswith("-degraded")
    assert result.model_used == "claude-sonnet-5-5"
    assert result.tier_metadata["pass1"]["model"] == "claude-sonnet-5-5"


@pytest.mark.asyncio
async def test_success_metadata_is_added_to_the_success_row_only(claude_on, usage_rows):
    claude_on.results = [_message('{"ok": true}')]
    _, parsed = await ai_router.call_anthropic(
        "writing_grading", system="S", user="U", max_tokens=50, operation="pass1",
        validate=json.loads, success_metadata=lambda value: {"grounding_dropped_count": 1},
        usage_context={"metadata": {"essay_id": "e-1"}},
    )
    assert parsed == {"ok": True}
    row = usage_rows[-1]
    assert row["status"] == "success"
    assert row["metadata"] == {"essay_id": "e-1", "route": "anthropic_primary",
                               "grounding_dropped_count": 1}
