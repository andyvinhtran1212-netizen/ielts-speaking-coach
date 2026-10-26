import json
from types import SimpleNamespace

import pytest

from config import Settings
from services import ai_usage_logger, listening_gist_grader as gist, vocab_extractor as vocab


def test_auxiliary_upgrades_leave_primary_and_pinned_fallbacks_intact():
    from services.grading_providers.claude import ClaudeHaikuProvider, ClaudeSonnetProvider
    for name in ("VOCAB_ANALYSIS_MODEL", "D1_QUESTION_MODEL", "LISTENING_GIST_MODEL"):
        assert Settings.model_fields[name].default == "claude-haiku-5-5"
    assert Settings.model_fields["SPEAKING_GRADING_MODEL"].default == "gemini-3.8-flash"
    assert ClaudeHaikuProvider.model == "claude-haiku-4-5-20251001"
    assert ClaudeSonnetProvider.model == "claude-sonnet-5"


@pytest.mark.parametrize("model", ["claude-haiku-5-5", "claude-haiku-4-5-20251001"])
def test_gist_calls_and_logs_configured_model(monkeypatch, model):
    calls, logged = [], []
    def create(**kw):
        calls.append(kw)
        return SimpleNamespace(stop_reason="end_turn", content=[
            SimpleNamespace(type="thinking", thinking=""),
            SimpleNamespace(type="text", text=json.dumps({"score": 95, "feedback": "Đúng ý chính.", "keyword_matches": ["library"]})),
        ])
    monkeypatch.setattr(gist, "_get_client", lambda: SimpleNamespace(messages=SimpleNamespace(create=create)))
    monkeypatch.setattr(gist.settings, "ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(gist.settings, "LISTENING_GIST_MODEL", model)
    monkeypatch.setattr(ai_usage_logger, "log_claude_response", lambda _r, **kw: logged.append(kw))
    result = gist.grade_gist_response(user_response="The library opens later.", model_answer="Library hours are extended.")
    assert result["score"] == 95 and result["ai_used"]
    assert calls[0]["model"] == logged[0]["model"] == model
    if model == "claude-haiku-5-5":
        assert "temperature" not in calls[0]
        assert calls[0]["extra_body"] == {"thinking": {"type": "disabled"}}
    else:
        assert calls[0]["temperature"] == 0.3
        assert "extra_body" not in calls[0]


def test_gist_refusal_uses_existing_keyword_fallback(monkeypatch):
    response = SimpleNamespace(stop_reason="refusal", content=[SimpleNamespace(type="text", text='{"score":100}')])
    monkeypatch.setattr(gist, "_get_client", lambda: SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: response)))
    monkeypatch.setattr(gist.settings, "ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(gist, "_call_with_retry", lambda fn, **kw: fn())
    monkeypatch.setattr(ai_usage_logger, "log_claude_response", lambda *a, **kw: None)
    result = gist.grade_gist_response(user_response="library", model_answer="library study hours", rubric_keywords=["library", "study"])
    assert result["ai_used"] is False
    assert result["score"] == 30


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["claude-haiku-5-5", "claude-haiku-4-5-20251001"])
async def test_vocab_selects_text_block_and_preserves_rollback(monkeypatch, model):
    calls, logged = [], []
    def create(**kw):
        calls.append(kw)
        return SimpleNamespace(stop_reason="end_turn", content=[
            SimpleNamespace(type="thinking", thinking=""),
            SimpleNamespace(type="text", text='{"used_well":[],"needs_review":[],"upgrade_suggested":[]}'),
        ])
    async def log(_response, **kw):
        logged.append(kw)
    pending = []
    monkeypatch.setattr(vocab.anthropic, "Anthropic", lambda **kw: SimpleNamespace(messages=SimpleNamespace(create=create)))
    monkeypatch.setattr(vocab.settings, "VOCAB_ANALYSIS_MODEL", model)
    monkeypatch.setattr(ai_usage_logger, "log_claude_response_async", log)
    monkeypatch.setattr(ai_usage_logger, "schedule_usage_log", pending.append)
    result = await vocab.extract_vocab("I enjoy learning new words. " * 8, "response", "user", "session")
    for coro in pending:
        await coro
    assert result is not None and result.needs_review == []
    assert calls[0]["model"] == logged[0]["model"] == model
    assert logged[0]["status"] == "success"
    assert logged[0]["error_code"] is None
    assert ("extra_body" in calls[0]) == (model == "claude-haiku-5-5")


@pytest.mark.asyncio
@pytest.mark.parametrize("stop_reason,raw,error_code", [
    ("refusal", '{"used_well":[]}', "claude_refusal"),
    ("max_tokens", '{"used_well":[]}', "claude_max_tokens"),
    ("end_turn", '{"used_well":', "JSONDecodeError"),
    ("end_turn", '{"used_well":[{}]}', "ValidationError"),
])
async def test_vocab_rejected_output_still_logs_the_billable_response(monkeypatch, stop_reason, raw, error_code):
    response = SimpleNamespace(
        stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=raw)],
        usage=SimpleNamespace(input_tokens=20, output_tokens=5),
    )
    pending, logged = [], []
    async def insert(row):
        logged.append(row)
    monkeypatch.setattr(vocab.anthropic, "Anthropic", lambda **kw: SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: response)))
    monkeypatch.setattr(vocab.settings, "VOCAB_ANALYSIS_MODEL", "claude-haiku-5-5")
    monkeypatch.setattr(ai_usage_logger, "_insert_async", insert)
    monkeypatch.setattr(ai_usage_logger, "schedule_usage_log", pending.append)
    result = await vocab.extract_vocab("I enjoy learning new words. " * 8, "response", "user", "session")
    for coro in pending:
        await coro
    assert result is None
    assert len(logged) == 1
    assert logged[0]["model"] == "claude-haiku-5-5"
    assert logged[0]["resource_id"] == "response"
    assert logged[0]["status"] == "error"
    assert logged[0]["error_code"] == error_code
    assert logged[0]["input_tokens"] == 20
    assert logged[0]["output_tokens"] == 5
    assert logged[0]["cost_usd_est"] > 0
