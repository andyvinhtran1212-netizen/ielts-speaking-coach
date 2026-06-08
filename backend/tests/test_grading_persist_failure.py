"""P0-2 — grading response persistence must FAIL LOUD, never silently 200/null.

Before this fix, a DB save that failed on both the full row AND the core-row
fallback only logged and returned 200 with response_id=None — the grade was
silently lost and PATCH /complete then found 0 responses → 422. These pin the
three branches of _persist_response_with_fallback with real values.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers.grading import _persist_response_with_fallback

_CORE = {"session_id", "question_id", "audio_url", "transcript",
         "feedback", "overall_band", "stt_status", "grading_status"}
# a row with a NON-core column (transcript_model) that the core-row retry must drop
_ROW = {
    "session_id": "s1", "question_id": "q1", "transcript": "hello",
    "feedback": "{}", "overall_band": 6.0, "stt_status": "completed",
    "grading_status": "completed", "transcript_model": "whisper-1",
}


def test_full_row_saves_and_is_not_partial():
    calls = []
    def upsert(row): calls.append(row); return "rid-full"
    rid, partial = _persist_response_with_fallback(
        _ROW, _CORE, upsert, session_id="s1", question_id="q1")
    assert rid == "rid-full"
    assert partial is False
    assert len(calls) == 1


def test_core_row_fallback_returns_partial_true():
    calls = []
    def upsert(row):
        calls.append(row)
        if len(calls) == 1:
            raise Exception("column \"transcript_model\" does not exist")  # full-row fails
        return "rid-core"
    rid, partial = _persist_response_with_fallback(
        _ROW, _CORE, upsert, session_id="s1", question_id="q1")
    assert rid == "rid-core"
    assert partial is True                       # ← real value the FE reads
    assert len(calls) == 2
    assert "transcript_model" not in calls[1]    # core-row retry dropped the non-core column


def test_both_inserts_fail_raises_500_response_persist_failed():
    def upsert(row): raise Exception("db unreachable")
    with pytest.raises(HTTPException) as ei:
        _persist_response_with_fallback(
            _ROW, _CORE, upsert, session_id="s1", question_id="q1")
    assert ei.value.status_code == 500
    assert ei.value.detail["error_code"] == "response_persist_failed"
    assert "thử lại" in ei.value.detail["message"].lower()
    # consequence (the whole point): the endpoint raises instead of returning a
    # null response_id, so a session can never reach /complete with 0 responses
    # off the back of a "successful" 200.
