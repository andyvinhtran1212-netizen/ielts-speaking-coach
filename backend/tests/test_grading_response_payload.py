"""Mục 6 (B2) — the /responses success payload must tolerate a grading dict
whose `sample_answer` / `improved_response` were dropped by post-processing
(e.g. a regenerated sample answer judged irrelevant — claude_grader pops the
key). Before the fix a direct `grading[...]` access raised KeyError, so the
outer handler returned HTTP 500 and threw away the rest of the feedback the
user already earned.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers.grading import _build_response_payload


# A complete grading dict MINUS the post-processing-removable keys.
_PRACTICE_GRADING = {
    "overall_band": 6.5, "grammar_issues": [], "vocabulary_issues": [],
    "corrections": [], "strengths": [], "grammar_recommendations": [],
    # "sample_answer" intentionally absent (dropped by post-processing)
}
_TEST_GRADING = {
    "band_fc": 6.0, "band_lr": 6.5, "band_gra": 6.0, "band_p": 6.5,
    "overall_band": 6.0, "fc_feedback": "", "lr_feedback": "", "gra_feedback": "",
    "p_feedback": "", "strengths": [], "improvements": [],
    # "improved_response" intentionally absent
}

_COMMON = dict(
    response_id="r1", partial=False, transcript="hi", duration_sec=12.3,
    confidence=0.9, assessment_confidence="high", score_confidence="high",
    signals={},
)


def test_practice_payload_tolerates_missing_sample_answer():
    out = _build_response_payload(True, grading=_PRACTICE_GRADING, **_COMMON)
    assert out["sample_answer"] is None          # graceful null, NOT a KeyError/500
    assert out["overall_band"] == 6.5
    assert out["response_id"] == "r1"


def test_test_payload_tolerates_missing_improved_response():
    out = _build_response_payload(False, grading=_TEST_GRADING, **_COMMON)
    assert out["improved_response"] is None
    assert out["band_fc"] == 6.0


def test_full_practice_grading_still_passes_sample_answer_through():
    g = {**_PRACTICE_GRADING, "sample_answer": "A model answer."}
    out = _build_response_payload(True, grading=g, **_COMMON)
    assert out["sample_answer"] == "A model answer."
