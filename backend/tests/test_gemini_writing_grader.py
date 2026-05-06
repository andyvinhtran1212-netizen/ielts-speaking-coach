"""Tests for GeminiWritingGrader (Sprint W1 Phase 3).

All tests mock the Gemini SDK — no real network IO. Smoke test against the
live API lives at tests/smoke/test_gemini_smoke.py and is opt-in via
`pytest -m smoke`.
"""

import json
from unittest.mock import patch

import pytest

from models.writing_feedback import GraderConfig
from services.gemini_writing_grader import (
    AISafetyBlockError,
    APIRetryFailedError,
    GeminiWritingGrader,
    InvalidJSONError,
    MODEL_PRICING,
)


# Reusable Gemini-shaped JSON payload that satisfies WritingFeedback
VALID_FEEDBACK = {
    "overallBandScore": 6.5,
    "overallBandScoreSummary": "Bài đạt mức Band 6.5",
    "keyTakeaways": {
        "strengths": ["Diễn đạt rõ ràng"],
        "areasForImprovement": ["Cần đa dạng cấu trúc câu"],
    },
    "criteriaFeedback": {
        "mainCriterion":     {"title": "Task Response",       "explanation": "...", "feedback": "...", "bandScore": 6},
        "coherenceCohesion": {"title": "Coherence & Cohesion", "explanation": "...", "feedback": "...", "bandScore": 6},
        "lexicalResource":   {"title": "Lexical Resource",     "explanation": "...", "feedback": "...", "bandScore": 7},
        "grammaticalRange":  {"title": "Grammatical Range",    "explanation": "...", "feedback": "...", "bandScore": 6},
    },
    "mistakeAnalysis": [
        {
            "original":    "I has been study",
            "mistakeType": "Grammar",
            "explanation": "Sai trợ động từ và thể của 'study'",
            "suggestion":  "I have been studying",
            "criterion":   "Grammatical Range",
        }
    ],
    "aiContentAnalysis": {"likelihood": 5, "explanation": "Bài tự nhiên"},
    "improvedEssay": "Improved version of the essay…",
}


@pytest.fixture
def grader():
    """Grader with stubbed API key + genai.configure mocked."""
    with patch("services.gemini_writing_grader.settings") as mock_settings, \
         patch("services.gemini_writing_grader.genai.configure"):
        mock_settings.GEMINI_API_KEY = "test-key-fake"
        yield GeminiWritingGrader()


# ── grade_essay happy path ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_grade_essay_returns_valid_result(grader):
    """Mocked Gemini call returns a parseable result."""
    json_payload = json.dumps(VALID_FEEDBACK)
    usage = {"input_tokens": 3000, "output_tokens": 2000}

    with patch.object(grader, "_call_with_retry", return_value=(json_payload, usage)):
        config = GraderConfig(
            task_type="task2",
            prompt_text="Some prompt",
            essay_text="Some essay",
            analysis_level=3,
        )
        result = await grader.grade_essay(config)

    assert result.feedback.overallBandScore == 6.5
    assert len(result.feedback.mistakeAnalysis) == 1
    assert result.model_used == "gemini-2.5-pro"
    assert result.tokens_input == 3000
    assert result.tokens_output == 2000
    assert result.cost_usd is not None
    assert result.grading_duration_ms >= 0
    assert result.prompt_version == "v1.0"


@pytest.mark.asyncio
async def test_grade_essay_safety_block_propagates(grader):
    """Safety block from inner call surfaces unchanged (no retry)."""
    with patch.object(
        grader, "_call_with_retry",
        side_effect=AISafetyBlockError("blocked"),
    ):
        config = GraderConfig(
            task_type="task2",
            prompt_text="x",
            essay_text="y",
            analysis_level=3,
        )
        with pytest.raises(AISafetyBlockError):
            await grader.grade_essay(config)


@pytest.mark.asyncio
async def test_grade_essay_retry_failure_propagates(grader):
    """APIRetryFailedError from inner call surfaces unchanged."""
    with patch.object(
        grader, "_call_with_retry",
        side_effect=APIRetryFailedError("3 retries failed"),
    ):
        config = GraderConfig(
            task_type="task2",
            prompt_text="x",
            essay_text="y",
            analysis_level=3,
        )
        with pytest.raises(APIRetryFailedError):
            await grader.grade_essay(config)


# ── _parse_response defensive JSON extraction ────────────────────────

def test_parse_response_valid_json(grader):
    text = json.dumps(VALID_FEEDBACK)
    feedback = grader._parse_response(text)
    assert feedback.overallBandScore == 6.5


def test_parse_response_with_extra_text(grader):
    """Spec: extract outermost { … } even when Gemini wraps with prose."""
    text = "Here's the analysis:\n" + json.dumps(VALID_FEEDBACK) + "\nLet me know."
    feedback = grader._parse_response(text)
    assert feedback.overallBandScore == 6.5


def test_parse_response_no_json_raises(grader):
    with pytest.raises(InvalidJSONError):
        grader._parse_response("This is not JSON")


def test_parse_response_invalid_schema_raises(grader):
    """Valid JSON but missing required fields → InvalidJSONError."""
    text = json.dumps({"overallBandScore": 7.0})
    with pytest.raises(InvalidJSONError):
        grader._parse_response(text)


# ── _calculate_cost (planner-verified pricing) ───────────────────────

def test_calculate_cost_pro_model(grader):
    """gemini-2.5-pro: 3000 input @ $1.25/M + 2000 output @ $10/M."""
    cost = grader._calculate_cost("gemini-2.5-pro", tokens_in=3000, tokens_out=2000)
    expected = (3000 / 1_000_000) * 1.25 + (2000 / 1_000_000) * 10.00
    assert abs(cost - expected) < 1e-6


def test_calculate_cost_flash_model(grader):
    """gemini-2.5-flash: 3000 input @ $0.30/M + 2000 output @ $2.50/M."""
    cost = grader._calculate_cost("gemini-2.5-flash", tokens_in=3000, tokens_out=2000)
    expected = (3000 / 1_000_000) * 0.30 + (2000 / 1_000_000) * 2.50
    assert abs(cost - expected) < 1e-6


def test_calculate_cost_unknown_model_returns_none(grader):
    assert grader._calculate_cost("gpt-4", tokens_in=3000, tokens_out=2000) is None


def test_calculate_cost_missing_tokens_returns_none(grader):
    assert grader._calculate_cost("gemini-2.5-pro", tokens_in=None, tokens_out=2000) is None
    assert grader._calculate_cost("gemini-2.5-pro", tokens_in=3000, tokens_out=None) is None


def test_pricing_table_has_both_models(grader):
    """Pricing table must cover both allowed models."""
    assert "gemini-2.5-pro" in MODEL_PRICING
    assert "gemini-2.5-flash" in MODEL_PRICING
    for model, prices in MODEL_PRICING.items():
        assert "input" in prices and "output" in prices
        assert prices["input"] > 0 and prices["output"] > 0


# ── Phase 1.5a: history injection in user prompt ─────────────────────


def test_build_user_prompt_omits_history_when_none(grader):
    """No history → prompt has only essay sections, no Vietnamese
    history block. Pinning this protects the new-student path
    (<5 essays) from accidentally getting a polluted prompt."""
    config = GraderConfig(
        task_type="task2",
        prompt_text="P",
        essay_text="E",
        analysis_level=3,
        history=None,
    )
    prompt = grader._build_user_prompt(config)
    assert "Lịch sử lỗi" not in prompt
    assert "recurringPatterns" not in prompt


def test_build_user_prompt_injects_history_when_present(grader):
    """Patterns dict via config.history → prompt includes the
    Vietnamese block + the recurringPatterns output schema instruction
    so Gemini knows what shape to emit.

    Phase 1.5b: heading is now "Lịch sử của học viên này" (broader,
    covers both patterns + trajectory). The patterns block sits under
    the "### Lỗi LẶP LẠI" sub-heading.
    """
    config = GraderConfig(
        task_type="task2",
        prompt_text="P",
        essay_text="E",
        analysis_level=3,
        history={
            "essays_analyzed": 5,
            "patterns": [
                {"mistakeType": "Grammar - Article", "count": 7,
                 "examples": ["the others"], "criterion": "GRA"},
            ],
        },
    )
    prompt = grader._build_user_prompt(config)
    assert "Lịch sử của học viên" in prompt
    assert "Lỗi LẶP LẠI" in prompt
    assert "Grammar - Article" in prompt
    assert "(7x)" in prompt
    assert "recurringPatterns" in prompt
    # Essay sections still come AFTER the history block.
    assert prompt.index("Lịch sử của học viên") < prompt.index("Bài viết của học viên")


def test_build_user_prompt_injects_trajectory_when_present(grader):
    """Phase 1.5b: trajectory dict via config.trajectory → prompt
    includes the band-trajectory block + bandTrajectoryAnalysis output
    schema instruction. Patterns optional — this fixture exercises the
    trajectory-only path (e.g. a student with steady essays but no
    repeating mistake types)."""
    config = GraderConfig(
        task_type="task2",
        prompt_text="P",
        essay_text="E",
        analysis_level=3,
        history=None,
        trajectory={
            "essays_analyzed":    5,
            "average_last_5":     6.5,
            "trend":              "improving",
            "trend_delta":        0.4,
            "criteria_breakdown": [
                {"criterion": "Task Response", "average": 7.0, "trend": "improving"},
            ],
        },
    )
    prompt = grader._build_user_prompt(config)
    assert "Diễn biến band điểm"     in prompt
    assert "6.5"                     in prompt
    assert "improving"               in prompt
    assert "Task Response"           in prompt
    assert "bandTrajectoryAnalysis"  in prompt
    assert "current_band"            in prompt
