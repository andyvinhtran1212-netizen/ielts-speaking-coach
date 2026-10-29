"""AIBUDGET-0033 T004 — budget refusals end every attempt chain (FR-008/FR-009).

Fake providers only, no network. For ``ai_router.with_fallback``, the Speaking
orchestrator, the ``claude_grader`` JSON-repair rerun and each custom chain:

- a budget refusal, or a provider spend-limit answer (Anthropic 402
  ``billing_error``, a Gemini spending cap), leads to zero further provider
  calls, with no other provider, model or retry;
- transient errors (429, 529, timeout) still fall back, and every attempt
  reserves its own line (FR-001, AC1, AC8);
- estimates follow FR-004: images add their decoded-size bound, audio uses
  the duration sent, and a request with no bound is refused before the send.
"""

from __future__ import annotations

import asyncio
import io
import json
import threading
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import anthropic
import httpx
import pytest
from google.api_core import exceptions as gexc

from config import settings
from services import ai_budget, ai_budget_config, ai_router, ai_usage_logger
from services.ai_budget import AIBudgetRefused

FIXTURES = Path(__file__).parent / "fixtures" / "provider_spend_limit"


# ── Helpers ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _enforce_and_quiet_ledger(monkeypatch):
    src = ai_budget_config._settings_source()
    monkeypatch.setattr(src, "AI_BUDGET_MODE", "enforce", raising=False)
    for scope in ai_budget_config.SCOPES:
        monkeypatch.setattr(src, ai_budget_config.env_var_for(scope), "", raising=False)
    monkeypatch.setattr(ai_usage_logger, "schedule_usage_log", lambda coro: coro.close())
    monkeypatch.setattr(ai_usage_logger, "_write", lambda row: True)


def _grant(params):
    return {"granted": True, "replay": False, "reservations": [
        {"id": "00000000-0000-4000-8000-%012d" % i, "line_no": line["line_no"],
         "provider": line["provider"], "estimate_usd": line["estimate_usd"]}
        for i, line in enumerate(params["p_lines"], start=1)
    ]}


def refuse_provider(rpc, provider, reason="monthly_cap"):
    """The database refuses every line of ``provider`` and grants the rest."""
    def handler(params):
        if any(line["provider"] == provider for line in params["p_lines"]):
            return {"granted": False, "replay": False, "reason": reason,
                    "scope": provider, "period_kind": "month"}
        return _grant(params)
    rpc.script["fn_ai_budget_reserve"] = handler


def _reserved_providers(rpc):
    return [line["provider"] for line in rpc.reserved()]


def _fixture_error(name):
    fx = json.loads((FIXTURES / f"{name}.json").read_text())
    request = httpx.Request("POST", fx["url"])
    response = httpx.Response(fx["http_status"], json=fx["body"], request=request)
    if fx["sdk"] == "anthropic":
        return anthropic.Anthropic(api_key="test")._make_status_error_from_response(response)
    raise AssertionError(fx["sdk"])


def _anthropic_status(cls, status):
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls("boom", response=httpx.Response(status, request=req), body=None)


def _gemini_spending_cap():
    return gexc.ResourceExhausted("Your project has exceeded its monthly spending cap.")


def _message(text="{}", in_tok=100, out_tok=50):
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)], stop_reason="end_turn",
        usage=SimpleNamespace(input_tokens=in_tok, output_tokens=out_tok,
                              cache_read_input_tokens=0, cache_creation_input_tokens=0),
    )


class FakeClaude:
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


class FakeGeminiModel:
    def __init__(self, *results):
        self.results = list(results)
        self.calls: list[tuple] = []

    def _next(self, args, kwargs):
        self.calls.append((args, kwargs))
        result = self.results.pop(0) if len(self.results) > 1 else self.results[0]
        if isinstance(result, BaseException):
            raise result
        return result

    async def generate_content_async(self, *args, **kwargs):
        return self._next(args, kwargs)

    def generate_content(self, *args, **kwargs):
        return self._next(args, kwargs)


def _gemini_response(text="{}"):
    return SimpleNamespace(
        text=text, candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="STOP"))],
        usage_metadata=SimpleNamespace(prompt_token_count=100, candidates_token_count=50,
                                       total_token_count=150),
    )


def _png(width=800, height=600):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def claude(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER", "anthropic,openai,gemini")
    fake = FakeClaude(_message("{}"))
    monkeypatch.setattr(ai_router, "_client", lambda *_a, **_k: fake)
    return fake


def run(coro):
    return asyncio.run(coro)


# ── ai_router.with_fallback / call_anthropic ─────────────────────────────────


def _routed(legacy):
    async def claude_call():
        _, parsed = await ai_router.call_anthropic(
            "question_generation", system="S", user="U", max_tokens=100,
            operation="op", validate=json.loads)
        return parsed
    return ai_router.with_fallback("question_generation", legacy_provider="gemini",
                                   anthropic_call=claude_call, legacy_call=legacy)


def test_with_fallback_reraises_a_refusal_without_running_the_next_provider(claude):
    legacy = AsyncMock(return_value="legacy")

    async def refused():
        raise AIBudgetRefused("monthly_cap", scope="google")

    with pytest.raises(AIBudgetRefused):
        run(ai_router.with_fallback("question_generation", legacy_provider="gemini",
                                    anthropic_call=refused, legacy_call=legacy))
    legacy.assert_not_called()


def test_kill_switch_refuses_claude_before_any_request_and_skips_the_fallback(claude, ai_budget_rpc, monkeypatch):
    monkeypatch.setenv("AI_KILL_SWITCH", "on")
    legacy = AsyncMock(return_value="legacy")
    with pytest.raises(AIBudgetRefused) as err:
        run(_routed(legacy))
    assert err.value.reason == "kill_switch"
    assert claude.requests == [] and ai_budget_rpc.calls == []
    legacy.assert_not_called()


@pytest.mark.parametrize("fixture", ["anthropic_402_billing_error", "anthropic_400_console_spend_limit",
                                     "anthropic_429_tier_spend_cap"])
def test_an_anthropic_spend_limit_answer_ends_the_chain(claude, ai_budget_rpc, fixture):
    claude.results = [_fixture_error(fixture)]
    legacy = AsyncMock(return_value="legacy")
    with pytest.raises(AIBudgetRefused) as err:
        run(_routed(legacy))
    assert err.value.reason == "provider_spend_limit" and err.value.scope == "anthropic"
    assert len(claude.requests) == 1
    legacy.assert_not_called()
    names = [name for name, _ in ai_budget_rpc.calls]
    assert names == ["fn_ai_budget_reserve", "fn_ai_budget_settle", "fn_ai_budget_close_scope"]


@pytest.mark.parametrize("error", [
    _anthropic_status(anthropic.RateLimitError, 429),
    _anthropic_status(anthropic.InternalServerError, 529),
    anthropic.APITimeoutError(request=httpx.Request("POST", "https://api.anthropic.com")),
])
def test_transient_claude_errors_still_fall_back_after_a_reserved_attempt(claude, ai_budget_rpc, error):
    claude.results = [error]
    legacy = AsyncMock(return_value="legacy")
    assert run(_routed(legacy)) == "legacy"
    legacy.assert_awaited_once()
    assert _reserved_providers(ai_budget_rpc) == ["anthropic"]
    assert [n for n, _ in ai_budget_rpc.calls] == ["fn_ai_budget_reserve", "fn_ai_budget_settle"]


def test_a_successful_claude_attempt_settles_at_the_reported_cost(claude, ai_budget_rpc):
    claude.results = [_message("{}", in_tok=300, out_tok=60)]
    run(_routed(AsyncMock()))
    line = ai_budget_rpc.reserved()[0]
    settle = next(p for n, p in ai_budget_rpc.calls if n == "fn_ai_budget_settle")
    assert line["feature"] == "question_generation" and line["provider"] == "anthropic"
    assert 0 < settle["p_actual_usd"] < line["estimate_usd"]


def test_claude_images_add_their_decoded_size_bound(claude, ai_budget_rpc):
    async def call(images):
        await ai_router.call_anthropic("writing_grading", system="S", user="U", max_tokens=100,
                                       operation="op", images=images)
    run(call(()))
    run(call([(_png(1568, 1568), "image/png")]))
    plain, with_image = (line["estimate_usd"] for line in ai_budget_rpc.reserved())
    assert with_image > plain


def test_an_unreadable_image_is_refused_before_the_request(claude, ai_budget_rpc):
    with pytest.raises(AIBudgetRefused) as err:
        run(ai_router.call_anthropic("writing_grading", system="S", user="U", max_tokens=100,
                                     operation="op", images=[(b"not an image", "image/png")]))
    assert err.value.reason == "config_invalid"
    assert claude.requests == [] and ai_budget_rpc.calls == []


# ── Speaking orchestrator ─────────────────────────────────────────────────────


async def _no_sleep(_seconds):
    return None


def _orchestrator(claude_results, gemini_results):
    from services.grading_orchestrator import GradingOrchestrator
    from services.grading_providers.claude import ClaudeProvider
    from services.grading_providers.gemini import GeminiProvider

    class Sonnet(ClaudeProvider):
        provider_name = "anthropic_primary"
        model = "claude-sonnet-5-5"

    claude_client = FakeClaude(*claude_results)
    gemini_model = FakeGeminiModel(*gemini_results)
    orch = GradingOrchestrator({
        "anthropic_primary": Sonnet(client=claude_client),
        "grading_primary": GeminiProvider(model_name="gemini-3.8-flash", model=gemini_model),
    })
    return orch, claude_client, gemini_model


def _invoke(orch):
    return orch.invoke("S", "U", order=("anthropic_primary", "grading_primary"), sleep=_no_sleep)


def test_orchestrator_stops_on_an_anthropic_402(ai_budget_rpc):
    orch, claude_client, gemini_model = _orchestrator(
        [_fixture_error("anthropic_402_billing_error")], [_gemini_response()])
    with pytest.raises(AIBudgetRefused) as err:
        run(_invoke(orch))
    assert err.value.reason == "provider_spend_limit"
    assert len(claude_client.requests) == 1 and gemini_model.calls == []
    assert _reserved_providers(ai_budget_rpc) == ["anthropic"]


def test_orchestrator_stops_when_the_gemini_rung_is_refused(ai_budget_rpc):
    refuse_provider(ai_budget_rpc, "google")
    orch, claude_client, gemini_model = _orchestrator(
        [_anthropic_status(anthropic.InternalServerError, 500)], [_gemini_response()])
    with pytest.raises(AIBudgetRefused) as err:
        run(_invoke(orch))
    assert err.value.reason == "monthly_cap" and err.value.scope == "google"
    assert gemini_model.calls == []
    # Sonnet: first try + one retry, each its own reservation; then the
    # refused Gemini line, and nothing after it.
    assert _reserved_providers(ai_budget_rpc) == ["anthropic", "anthropic", "google"]


def test_orchestrator_stops_on_a_gemini_spending_cap_answer(ai_budget_rpc):
    orch, claude_client, gemini_model = _orchestrator(
        [_anthropic_status(anthropic.InternalServerError, 503)], [_gemini_spending_cap()])
    with pytest.raises(AIBudgetRefused) as err:
        run(_invoke(orch))
    assert err.value.reason == "provider_spend_limit" and err.value.scope == "google"
    assert len(gemini_model.calls) == 1        # no retry on the same rung
    assert ("fn_ai_budget_close_scope", {"p_scope": "google", "p_day": None,
                                         "p_reason": "provider_spend_limit"}) in ai_budget_rpc.calls


def test_orchestrator_transient_errors_reserve_each_attempt_and_fall_back(ai_budget_rpc):
    orch, claude_client, gemini_model = _orchestrator(
        [_anthropic_status(anthropic.RateLimitError, 429)], [_gemini_response('{"ok": 1}')])
    raw, _events = run(_invoke(orch))
    assert raw == '{"ok": 1}'
    assert len(claude_client.requests) == 2 and len(gemini_model.calls) == 1
    assert _reserved_providers(ai_budget_rpc) == ["anthropic", "anthropic", "google"]
    assert gemini_model.calls[0][1]["request_options"]["retry"] is None


# ── claude_grader JSON-repair rerun ──────────────────────────────────────────


class _ScriptedOrchestrator:
    """Stands in for the orchestrator: answers from a script, records calls."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = 0
        self.providers = {}
        self._feature = None

    async def invoke(self, *_a, **_k):
        self.calls += 1
        answer = self.answers.pop(0)
        if isinstance(answer, BaseException):
            raise answer
        return answer, []


@pytest.mark.parametrize("answers,calls", [
    ([AIBudgetRefused("kill_switch")], 1),
    (["not json", AIBudgetRefused("monthly_cap", scope="google")], 2),
])
def test_the_json_repair_rerun_reraises_a_refusal(monkeypatch, answers, calls):
    from services import claude_grader, provider_fixtures

    monkeypatch.setattr(provider_fixtures, "fixture_mode_enabled", lambda: False)
    monkeypatch.setattr(claude_grader, "_get_client", lambda: None)
    orch = _ScriptedOrchestrator(*answers)
    claude_grader.set_orchestrator(orch)
    try:
        with pytest.raises(AIBudgetRefused):
            run(claude_grader.grade_response("Q?", "an answer", 1))
    finally:
        claude_grader.set_orchestrator(None)
    assert orch.calls == calls


def test_grounded_sample_regeneration_is_skipped_on_a_refusal(ai_budget_rpc, monkeypatch):
    from services import claude_grader

    monkeypatch.setenv("AI_KILL_SWITCH", "on")
    client = FakeClaude(_message("x"))
    assert run(claude_grader._regen_grounded_answer(client, "t", "q")) is None
    assert client.requests == []


# ── Custom chains ─────────────────────────────────────────────────────────────


def test_course_writing_refused_gemini_does_not_fall_back_to_claude(claude, ai_budget_rpc, monkeypatch):
    from services import course_writing_grader as cwg

    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_COURSE_WRITING", "gemini,anthropic", raising=False)
    refuse_provider(ai_budget_rpc, "google")
    model = FakeGeminiModel(_gemini_response())
    monkeypatch.setattr(cwg, "_model", lambda: ("gemini-3.5-flash-lite", model))
    with pytest.raises(AIBudgetRefused):
        run(cwg.grade([{"qid": "1", "prompt": "p", "answer": "a"},
                       {"qid": "2", "prompt": "p", "answer": "b"}]))
    assert model.calls == [] and claude.requests == []
    assert _reserved_providers(ai_budget_rpc) == ["google"]       # no batch split either


def test_course_writing_claude_spend_limit_does_not_fall_back_to_gemini(claude, ai_budget_rpc, monkeypatch):
    from services import course_writing_grader as cwg

    claude.results = [_fixture_error("anthropic_402_billing_error")]
    model = FakeGeminiModel(_gemini_response())
    monkeypatch.setattr(cwg, "_model", lambda: ("gemini-3.5-flash-lite", model))
    with pytest.raises(AIBudgetRefused):
        run(cwg.grade([{"qid": "1", "prompt": "p", "answer": "a"}]))
    assert len(claude.requests) == 1 and model.calls == []


def test_advanced_vocab_refused_gemini_does_not_fall_back_to_claude(claude, ai_budget_rpc, monkeypatch):
    from services import advanced_vocab_rewrite_grader as avr

    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_ADVANCED_VOCAB_REWRITE", "gemini,anthropic",
                        raising=False)
    refuse_provider(ai_budget_rpc, "google", reason="daily_cap")
    model = FakeGeminiModel(_gemini_response())
    monkeypatch.setattr(avr, "_model", lambda: ("gemini-3.5-flash-lite", model))
    with pytest.raises(AIBudgetRefused):
        run(avr.grade_rewrites([{"item_id": "1", "prompt": "p", "answer": "a"}]))
    assert model.calls == [] and claude.requests == []


def test_question_generation_spend_limit_does_not_reach_gemini(claude, ai_budget_rpc, monkeypatch):
    from services import gemini as qgen

    claude.results = [_fixture_error("anthropic_402_billing_error")]
    model = FakeGeminiModel(_gemini_response("[]"))
    monkeypatch.setattr(qgen, "_model", model)
    with pytest.raises(AIBudgetRefused):
        run(qgen._call_gemini("prompt", expect=list))
    assert model.calls == []


def test_question_generation_gemini_refusal_is_not_normalised_to_value_error(ai_budget_rpc, monkeypatch):
    from services import gemini as qgen

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    refuse_provider(ai_budget_rpc, "google")
    model = FakeGeminiModel(_gemini_response("[]"))
    monkeypatch.setattr(qgen, "_model", model)
    with pytest.raises(AIBudgetRefused):
        run(qgen._call_gemini("prompt", expect=list))
    assert model.calls == []


def test_d1_question_generation_is_skipped_on_a_refusal(ai_budget_rpc, monkeypatch):
    from services import d1_question_generator as d1

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    sync_client = MagicMock()
    sync_client.messages.create.side_effect = _fixture_error("anthropic_402_billing_error")
    monkeypatch.setattr(d1.anthropic, "Anthropic", lambda **_k: sync_client)
    gemini_attempt = MagicMock()
    monkeypatch.setattr(d1, "_try_gemini", gemini_attempt)
    row = {"id": "v1", "headword": "resilient", "evidence_substring": "She is resilient."}
    assert d1.generate_d1_question(row) is None            # no evidence fallback either
    assert sync_client.messages.create.call_count == 1      # no retry
    gemini_attempt.assert_not_called()


def test_the_shared_retry_wrapper_never_retries_a_refusal():
    from services.d1_question_generator import _call_with_retry

    calls = []

    def call():
        calls.append(1)
        raise AIBudgetRefused("daily_cap", scope="google")

    with pytest.raises(AIBudgetRefused):
        _call_with_retry(call, provider="gemini", base_delay_ms=0)
    assert calls == [1]


def test_listening_gist_refusal_is_not_turned_into_a_keyword_score(ai_budget_rpc, monkeypatch):
    from services import listening_gist_grader as gist

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    client = MagicMock()
    client.messages.create.side_effect = _fixture_error("anthropic_402_billing_error")
    monkeypatch.setattr(gist, "_get_client", lambda: client)
    with pytest.raises(AIBudgetRefused):
        gist.grade_gist_response(user_response="an answer", model_answer="m", rubric_keywords=["a"])
    assert client.messages.create.call_count == 1


def _writing_grader():
    from services.gemini_writing_grader import GeminiWritingGrader
    with patch("services.gemini_writing_grader.settings") as s, \
         patch("services.gemini_writing_grader.genai.configure"):
        s.GEMINI_API_KEY = "test-key-fake"
        return GeminiWritingGrader()


def test_writing_gemini_loop_stops_at_a_refusal_and_skips_the_claude_fallback(claude, ai_budget_rpc, monkeypatch):
    from services import gemini_writing_grader as gwg

    monkeypatch.setattr(settings, "AI_PROVIDER_ORDER_WRITING_GRADING", "gemini,anthropic", raising=False)
    refuse_provider(ai_budget_rpc, "google")
    model = FakeGeminiModel(_gemini_response("{}"))
    monkeypatch.setattr(gwg.genai, "GenerativeModel", lambda **_k: model)
    grader = _writing_grader()
    with pytest.raises(AIBudgetRefused):
        run(grader._call_with_retry("gemini-3.8-flash", "S", "U", anthropic_feature="writing_grading"))
    assert model.calls == [] and claude.requests == []
    assert _reserved_providers(ai_budget_rpc) == ["google"]       # one attempt, not MAX_RETRIES


def test_writing_gemini_spending_cap_answer_is_not_retried(ai_budget_rpc, monkeypatch):
    from services import gemini_writing_grader as gwg

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    model = FakeGeminiModel(_gemini_spending_cap())
    monkeypatch.setattr(gwg.genai, "GenerativeModel", lambda **_k: model)
    monkeypatch.setattr(gwg.asyncio, "sleep", AsyncMock())
    with pytest.raises(AIBudgetRefused) as err:
        run(_writing_grader()._call_with_retry("gemini-3.8-flash", "S", "U"))
    assert err.value.reason == "provider_spend_limit"
    assert len(model.calls) == 1


def test_writing_chart_image_is_in_every_attempt_estimate(ai_budget_rpc, monkeypatch):
    from services import gemini_writing_grader as gwg

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    model = FakeGeminiModel(RuntimeError("transient"), _gemini_response("x" * 20))
    monkeypatch.setattr(gwg.genai, "GenerativeModel", lambda **_k: model)
    monkeypatch.setattr(gwg.asyncio, "sleep", AsyncMock())
    grader = _writing_grader()
    run(grader._call_with_retry("gemini-3.8-flash", "S", "U", image=(_png(2000, 1500), "image/png")))
    run(grader._call_with_retry("gemini-3.8-flash", "S", "U"))
    first, retry, text_only = (line["estimate_usd"] for line in ai_budget_rpc.reserved())
    assert first == retry > text_only


def test_writing_unreadable_chart_is_refused_before_the_request(ai_budget_rpc, monkeypatch):
    from services import gemini_writing_grader as gwg

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    model = FakeGeminiModel(_gemini_response("x" * 20))
    monkeypatch.setattr(gwg.genai, "GenerativeModel", lambda **_k: model)
    with pytest.raises(AIBudgetRefused) as err:
        run(_writing_grader()._call_with_retry("gemini-3.8-flash", "S", "U", image=(b"junk", "image/png")))
    assert err.value.reason == "config_invalid" and model.calls == []


@pytest.mark.parametrize("module,fn,error", [
    ("services.d1_content_gen", "generate_d1_exercises", "GeminiBatchError"),
    ("services.vocab_enrichment", "enrich_vocabulary_batch", "VocabEnrichmentError"),
])
def test_chunk_loops_stop_at_the_first_refusal(ai_budget_rpc, monkeypatch, module, fn, error):
    import importlib

    mod = importlib.import_module(module)
    refuse_provider(ai_budget_rpc, "google")
    model = FakeGeminiModel(_gemini_response("{}"))
    monkeypatch.setattr(mod.genai, "GenerativeModel", lambda **_k: model)
    words = [f"word{i}" for i in range(60)]                  # several chunks
    with pytest.raises(AIBudgetRefused):
        getattr(mod, fn)(words)
    assert model.calls == [] and _reserved_providers(ai_budget_rpc) == ["google"]


def test_operator_script_retry_loop_never_retries_a_refusal(ai_budget_rpc, monkeypatch):
    import importlib.util
    import sys

    path = Path(__file__).resolve().parents[1] / "scripts" / "backfill_quiz_why_wrong.py"
    spec = importlib.util.spec_from_file_location("backfill_quiz_why_wrong_t004", path)
    script = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = script
    spec.loader.exec_module(script)
    refuse_provider(ai_budget_rpc, "google")
    model = FakeGeminiModel(_gemini_response())
    genai = SimpleNamespace(GenerativeModel=lambda _name: model)
    monkeypatch.setattr(script.time, "sleep", lambda _s: pytest.fail("a refusal must not back off"))
    with pytest.raises(AIBudgetRefused):
        script._call(genai, "gemini-2.5-flash", "prompt")
    assert model.calls == []


# ── Kill switch across the remaining providers ───────────────────────────────


def test_kill_switch_stops_whisper_tts_elevenlabs_and_azure(ai_budget_rpc, monkeypatch):
    from services import azure_pronunciation, tts_audio, whisper

    monkeypatch.setenv("AI_KILL_SWITCH", "1")
    stt = MagicMock()
    stt.audio.transcriptions.create = AsyncMock()
    monkeypatch.setattr(whisper, "_get_client", lambda: stt)
    with pytest.raises(AIBudgetRefused):
        run(whisper.transcribe_from_bytes(b"x", audio_seconds=10))
    stt.audio.transcriptions.create.assert_not_called()

    monkeypatch.setattr(settings, "OPENAI_API_KEY", "k")
    with patch("openai.AsyncOpenAI") as client_cls:
        with pytest.raises(AIBudgetRefused):
            run(tts_audio.synthesize_mp3("hello"))
        client_cls.return_value.audio.speech.create.assert_not_called()

    monkeypatch.setattr(settings, "ELEVENLABS_API_KEY", "k")
    with patch("requests.post") as post:
        with pytest.raises(AIBudgetRefused):
            tts_audio._synth_elevenlabs_sync("hello")
        post.assert_not_called()

    monkeypatch.setattr(settings, "AZURE_SPEECH_KEY", "k")
    monkeypatch.setattr(settings, "AZURE_SPEECH_REGION", "r")
    monkeypatch.setattr(azure_pronunciation, "_convert_to_wav", lambda _b: None)
    with patch("httpx.AsyncClient") as http:
        with pytest.raises(AIBudgetRefused):
            run(azure_pronunciation.assess_pronunciation(audio_bytes=b"x", audio_seconds=5))
        http.assert_not_called()
    assert ai_budget_rpc.calls == []


# ── FR-004 sizing of audio and character lines ───────────────────────────────


def test_whisper_reserves_the_measured_duration_plus_one_second(ai_budget_rpc, monkeypatch):
    from services import ai_pricing, whisper

    stt = MagicMock()
    stt.audio.transcriptions.create = AsyncMock(return_value=SimpleNamespace(
        text="hi", duration=59.5, language="en", segments=[], words=[]))
    monkeypatch.setattr(whisper, "_get_client", lambda: stt)
    run(whisper.transcribe_from_bytes(b"audio", audio_seconds=60.0))
    line = ai_budget_rpc.reserved()[0]
    expected, _ = ai_pricing.estimate_unit_cost("openai", "whisper-1", "audio_second", 61)
    assert (line["provider"], line["feature"]) == ("openai", "speaking_stt")
    assert line["estimate_usd"] == pytest.approx(expected, abs=1e-6)
    settle = next(p for n, p in ai_budget_rpc.calls if n == "fn_ai_budget_settle")
    assert settle["p_actual_usd"] <= line["estimate_usd"]


def test_whisper_with_no_measurable_duration_is_refused_before_the_request(ai_budget_rpc, monkeypatch):
    from services import whisper

    stt = MagicMock()
    stt.audio.transcriptions.create = AsyncMock()
    monkeypatch.setattr(whisper, "_get_client", lambda: stt)
    monkeypatch.setattr(whisper, "_probe_duration_seconds", lambda **_k: 0.0)
    with pytest.raises(AIBudgetRefused) as err:
        run(whisper.transcribe_from_bytes(b"header-less webm"))
    assert err.value.reason == "config_invalid"
    stt.audio.transcriptions.create.assert_not_called()


def test_shadow_mode_lets_an_unmeasured_recording_through_unreserved(ai_budget_rpc, monkeypatch):
    from services import whisper

    monkeypatch.setattr(ai_budget_config._settings_source(), "AI_BUDGET_MODE", "shadow", raising=False)
    stt = MagicMock()
    stt.audio.transcriptions.create = AsyncMock(return_value=SimpleNamespace(
        text="hi", duration=3.0, language="en", segments=[], words=[]))
    monkeypatch.setattr(whisper, "_get_client", lambda: stt)
    monkeypatch.setattr(whisper, "_probe_duration_seconds", lambda **_k: 0.0)
    assert run(whisper.transcribe_from_bytes(b"x"))["transcript"] == "hi"
    assert ai_budget_rpc.calls == []


def _wav(seconds, rate=16000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(seconds * rate))
    return buf.getvalue()


def test_azure_reserves_the_duration_of_the_wav_it_sends(ai_budget_rpc, monkeypatch):
    from services import ai_pricing, azure_pronunciation

    monkeypatch.setattr(settings, "AZURE_SPEECH_KEY", "k")
    monkeypatch.setattr(settings, "AZURE_SPEECH_REGION", "r")
    monkeypatch.setattr(azure_pronunciation, "_convert_to_wav", lambda _b: _wav(12.2))
    response = httpx.Response(200, json={"RecognitionStatus": "Success", "NBest": []},
                              request=httpx.Request("POST", "https://r.stt.speech.microsoft.com"))
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.post = AsyncMock(return_value=response)
    with patch("httpx.AsyncClient", return_value=client):
        run(azure_pronunciation.assess_pronunciation(audio_bytes=b"webm", audio_seconds=300))
    line = ai_budget_rpc.reserved()[0]
    expected, _ = ai_pricing.estimate_unit_cost("azure", "pronunciation-assessment", "audio_second", 14)
    assert (line["provider"], line["feature"]) == ("azure", "pronunciation")
    assert line["estimate_usd"] == pytest.approx(expected, abs=1e-6)


def test_elevenlabs_quota_answer_is_a_spend_limit_refusal(ai_budget_rpc, monkeypatch):
    from services import listening_renderer

    monkeypatch.setattr(settings, "ELEVENLABS_API_KEY", "k")
    import requests

    fx = json.loads((FIXTURES / "elevenlabs_401_quota_exceeded.json").read_text())

    resp = requests.Response()
    resp.status_code = fx["http_status"]
    resp._content = json.dumps(fx["body"]).encode()
    resp.headers["Content-Type"] = "application/json"
    with patch("requests.post", return_value=resp) as post:
        with pytest.raises(AIBudgetRefused) as err:
            listening_renderer.render_via_elevenlabs(script_text="hello", voice_id="v",
                                                     model="eleven_multilingual_v2")
    assert err.value.reason == "provider_spend_limit" and post.call_count == 1
    line = ai_budget_rpc.reserved()[0]
    assert (line["provider"], line["feature"]) == ("elevenlabs", "listening_tts")


# ── guard_sync transport ──────────────────────────────────────────────────────


def test_guard_sync_runs_off_the_event_loop_on_its_own_transport(ai_budget_rpc, monkeypatch):
    seen = []

    async def recording(name, params):
        seen.append((threading.current_thread().name, ai_budget._SYNC_TRANSPORT.get()))
        return await ai_budget_rpc(name, params)

    monkeypatch.setattr(ai_budget, "_rpc", recording)

    def blocking_call():
        with ai_budget.guard_sync("google", "gemini-2.5-flash", "f", 0.01, request_key="k1") as lease:
            lease.settle(0.001)

    async def from_async_code():
        blocking_call()        # a sync helper called on a loop thread must not deadlock

    blocking_call()
    run(from_async_code())
    assert [flag for _, flag in seen] == [True] * 4
    assert any(name.startswith("ai-budget") for name, _ in seen)
    assert [n for n, _ in ai_budget_rpc.calls] == ["fn_ai_budget_reserve", "fn_ai_budget_settle"] * 2
