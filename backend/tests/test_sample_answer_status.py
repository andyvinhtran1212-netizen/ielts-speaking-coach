"""Mục 21 (B3 follow-up) — when the grader drops an off-topic sample/improved
answer it must SIGNAL why (sample_answer_status / improved_response_status), not
remove it silently, so the frontend can explain instead of showing nothing.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services import claude_grader
from routers.grading import _build_response_payload


_OFF_TOPIC = "An essay about quantum entanglement and distant black holes."
_TRANSCRIPT = "I love playing football with my friends every weekend in the park"
_QUESTION = "Do you enjoy playing sports?"


def test_practice_removed_sample_sets_status(monkeypatch):
    async def _no_regen(*_a, **_k):
        return None  # regen can't ground it → sample dropped
    monkeypatch.setattr(claude_grader, "_regen_grounded_answer", _no_regen)

    result = {
        "grammar_issues": [], "corrections": [], "vocabulary_issues": [],
        "sample_answer": _OFF_TOPIC,
    }
    asyncio.run(claude_grader._post_process_practice_result(
        result, transcript=_TRANSCRIPT, question=_QUESTION, client=object(),
    ))
    assert "sample_answer" not in result
    assert result.get("sample_answer_status") == "removed_low_relevance"


def test_test_mode_removed_improved_sets_status(monkeypatch):
    async def _no_regen(*_a, **_k):
        return None
    monkeypatch.setattr(claude_grader, "_regen_grounded_answer", _no_regen)

    result = {"improved_response": _OFF_TOPIC}
    asyncio.run(claude_grader._post_process_test_result(
        result, transcript=_TRANSCRIPT, question=_QUESTION, client=object(),
    ))
    assert "improved_response" not in result
    assert result.get("improved_response_status") == "removed_low_relevance"


def test_payload_surfaces_sample_answer_status():
    common = dict(
        response_id="r1", partial=False, transcript="hi", duration_sec=12.0,
        confidence=0.9, assessment_confidence="high", score_confidence="high",
        signals={},
    )
    grading = {
        "overall_band": 6.0, "grammar_issues": [], "vocabulary_issues": [],
        "corrections": [], "strengths": [],
        # sample_answer absent; status explains why
        "sample_answer_status": "removed_low_relevance",
    }
    out = _build_response_payload(True, grading=grading, **common)
    assert out["sample_answer"] is None
    assert out["sample_answer_status"] == "removed_low_relevance"
