"""Exercise provider deserialization, bounded retries and actual ledger rows."""
import json

import anthropic
import httpx
import pytest

from services import ai_usage_logger as ledger
from services import d1_question_generator as d1
from services import listening_gist_grader as gist


def _valid_payload(flow):
    if flow == "d1":
        return json.dumps({
            "context_sentence": "I love the serendipity of meeting old friends in unexpected places.",
            "target_answer": "serendipity",
            "distractors": ["misfortune", "obligation", "routine"],
            "acceptable_variants": [], "hint": "happy coincidence",
        })
    return '{"score":95,"feedback":"Đúng ý chính.","keyword_matches":["library"]}'


def _run(monkeypatch, flow, responses):
    requests, rows = [], []

    def respond(request):
        requests.append(request)
        reason, text = responses[min(len(requests) - 1, len(responses) - 1)]
        return httpx.Response(200, json={
            "id": f"msg_{len(requests)}", "type": "message", "role": "assistant",
            "model": "claude-haiku-5-5", "content": [{"type": "text", "text": text}],
            "stop_reason": reason, "stop_sequence": None,
            "usage": {"input_tokens": 20, "output_tokens": 5},
        })

    with anthropic.Anthropic(api_key="test", http_client=httpx.Client(
        transport=httpx.MockTransport(respond),
    )) as client:
        monkeypatch.setattr(d1.anthropic, "Anthropic", lambda **kw: client)
        monkeypatch.setattr(gist, "_get_client", lambda: client)
        monkeypatch.setattr(d1.settings, "ANTHROPIC_API_KEY", "test")
        monkeypatch.setattr(d1.settings, "D1_QUESTION_MODEL", "claude-haiku-5-5")
        monkeypatch.setattr(gist.settings, "LISTENING_GIST_MODEL", "claude-haiku-5-5")
        monkeypatch.setattr(d1.time, "sleep", lambda seconds: None)
        monkeypatch.setattr(d1, "_try_gemini", lambda row: None)
        monkeypatch.setattr(ledger, "_insert", rows.append)
        if flow == "d1":
            out = d1.generate_d1_question({
                "id": "v1", "headword": "serendipity",
                "evidence_substring": "Pure serendipity led us here.",
            })
            success = out["generated_by"] == "haiku"
            if not success:
                assert out["generated_by"] == "fallback_evidence"
        else:
            out = gist.grade_gist_response(
                user_response="library", model_answer="library study hours",
                rubric_keywords=["library", "study"], usage_user_id="qa",
            )
            success = out["ai_used"]
            if not success:
                assert out["score"] == 30
    assert len(rows) == len(requests)
    for row in rows:
        assert row["model"] == "claude-haiku-5-5"
        assert row["input_tokens"] == 20 and row["output_tokens"] == 5
        assert row["cost_usd_est"] > 0
    return success, rows


@pytest.mark.parametrize("flow", ["d1", "gist"])
@pytest.mark.parametrize("reason,text,attempts,error_code", [
    ("max_tokens", '{}', 3, "claude_max_tokens"),
    ("refusal", '{}', 1, "claude_refusal"),
    ("model_context_window_exceeded", '{}', 1, "claude_model_context_window_exceeded"),
    ("end_turn", '{"broken":', 3, "JSONDecodeError"),
    ("end_turn", 'not JSON', 3, "JSONDecodeError"),
])
def test_rejected_attempts_preserve_cost_and_use_bounded_fallback(
    monkeypatch, flow, reason, text, attempts, error_code,
):
    success, rows = _run(monkeypatch, flow, [(reason, text)])
    assert not success
    assert len(rows) == attempts
    assert all(row["status"] == "error" and row["error_code"] == error_code for row in rows)


@pytest.mark.parametrize("flow", ["d1", "gist"])
@pytest.mark.parametrize("reason,text,error_code", [
    ("max_tokens", '{}', "claude_max_tokens"),
    ("end_turn", '{"broken":', "JSONDecodeError"),
])
def test_recovery_keeps_failed_attempt_and_logs_only_final_success(
    monkeypatch, flow, reason, text, error_code,
):
    success, rows = _run(monkeypatch, flow, [
        (reason, text), ("end_turn", _valid_payload(flow)),
    ])
    assert success and len(rows) == 2
    assert rows[0]["status"] == "error" and rows[0]["error_code"] == error_code
    assert rows[1]["status"] == "success" and not rows[1].get("error_code")


@pytest.mark.parametrize("flow,text,error_code", [
    ("d1", '[]', "invalid_response"),
    ("d1", '{}', "invalid_response"),
    ("gist", '{"score":"invalid"}', "ValueError"),
])
def test_schema_rejection_does_not_retry_or_log_success(monkeypatch, flow, text, error_code):
    success, rows = _run(monkeypatch, flow, [("end_turn", text)])
    assert not success and len(rows) == 1
    assert rows[0]["status"] == "error" and rows[0]["error_code"] == error_code
