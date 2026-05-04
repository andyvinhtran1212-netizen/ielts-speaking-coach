"""Tests for Pydantic WritingFeedback schema (Sprint W1 Phase 1)."""

import pytest
from pydantic import ValidationError

from models.writing_feedback import (
    CoherenceAnalysisItem,
    GraderConfig,
    SuggestionInstructionExample,
    WritingFeedback,
)


# Reusable Level-1-shaped payload (only required fields)
def _minimal_l1_payload() -> dict:
    return {
        "overallBandScore": 5.5,
        "overallBandScoreSummary": "Bài đạt mức Band 5.5 với một số lỗi cơ bản…",
        "keyTakeaways": {
            "strengths": ["Diễn đạt được ý chính"],
            "areasForImprovement": ["Cần chú ý chia thì"],
        },
        "criteriaFeedback": {
            "mainCriterion":      {"title": "Task Response",       "explanation": "...", "feedback": "...", "bandScore": 5},
            "coherenceCohesion":  {"title": "Coherence & Cohesion", "explanation": "...", "feedback": "...", "bandScore": 5},
            "lexicalResource":    {"title": "Lexical Resource",     "explanation": "...", "feedback": "...", "bandScore": 5},
            "grammaticalRange":   {"title": "Grammatical Range",    "explanation": "...", "feedback": "...", "bandScore": 5},
        },
        "mistakeAnalysis": [],
        "aiContentAnalysis": {"likelihood": 10, "explanation": "Bài tự nhiên"},
        "improvedEssay": "Improved version of the essay…",
    }


def test_minimal_level_1_feedback_validates():
    """Level 1: mistakeAnalysis only; conditional fields default to None."""
    feedback = WritingFeedback(**_minimal_l1_payload())
    assert feedback.overallBandScore == 5.5
    assert feedback.coherenceAnalysis is None
    assert feedback.lexicalAnalysis is None
    assert feedback.bandTrajectoryAnalysis is None  # Phase 1.5 forward-compat


def test_band_score_out_of_range_rejected():
    """overallBandScore > 9 should fail Pydantic validation."""
    bad = _minimal_l1_payload()
    bad["overallBandScore"] = 10.0
    with pytest.raises(ValidationError):
        WritingFeedback(**bad)


def test_grader_config_defaults():
    """GraderConfig defaults: form='em', model='gemini-2.5-pro'."""
    config = GraderConfig(
        task_type="task2",
        prompt_text="Some prompt",
        essay_text="Some essay",
        analysis_level=3,
    )
    assert config.form_of_address == "em"
    assert config.selected_model == "gemini-2.5-pro"


def test_grader_config_invalid_level():
    """analysis_level outside 1-5 should fail."""
    with pytest.raises(ValidationError):
        GraderConfig(task_type="task2", prompt_text="x", essay_text="y", analysis_level=0)
    with pytest.raises(ValidationError):
        GraderConfig(task_type="task2", prompt_text="x", essay_text="y", analysis_level=6)


def test_grader_config_invalid_form():
    """form_of_address must be in [bạn, em, anh, chị]."""
    with pytest.raises(ValidationError):
        GraderConfig(
            task_type="task2",
            prompt_text="x",
            essay_text="y",
            analysis_level=3,
            form_of_address="bro",
        )


def test_grader_config_invalid_model():
    """selected_model must be in [gemini-2.5-pro, gemini-2.5-flash]."""
    with pytest.raises(ValidationError):
        GraderConfig(
            task_type="task2",
            prompt_text="x",
            essay_text="y",
            analysis_level=3,
            selected_model="gpt-4",
        )


# ── W2.1 patch: tolerant suggestion coercion + missing-location default ──

def test_suggestion_accepts_string_input():
    """W2.1: Gemini sometimes returns suggestion as plain string. The
    validator coerces it to {instruction: <str>, example: ""}."""
    s = SuggestionInstructionExample.model_validate("Bỏ câu này đi.")
    assert s.instruction == "Bỏ câu này đi."
    assert s.example == ""


def test_suggestion_accepts_object_input():
    """W2.1: Object form passes through unchanged."""
    s = SuggestionInstructionExample.model_validate({
        "instruction": "Bỏ câu này",
        "example":     "Viết lại như sau: ...",
    })
    assert s.instruction == "Bỏ câu này"
    assert s.example == "Viết lại như sau: ..."


def test_coherence_item_missing_location_defaults():
    """W2.1: location is optional with empty-string default — Gemini's
    occasional omission no longer crashes validation."""
    item = CoherenceAnalysisItem.model_validate({
        # location intentionally absent
        "issue":       "Sudden topic shift",
        "explanation": "Đoạn 2 đột ngột chuyển chủ đề",
        "suggestion":  "Cần một câu chuyển ý",  # also string-form
    })
    assert item.location == ""
    assert item.suggestion.instruction == "Cần một câu chuyển ý"
    assert item.suggestion.example == ""
