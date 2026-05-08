"""Tests for tier-aware GeminiWritingGrader (Sprint 2.7a).

Covers:
  - Quick tier returns the 5-section subset (WritingFeedbackQuick)
  - Quick tier uses the Flash model regardless of selected_model
  - Quick tier stamp ends with `-quick` so A/B SQL can split rows
  - Standard tier behaviour is bit-for-bit identical pre-2.7a
  - Deep / Instructor raise NotImplementedError pointing at 2.7b/c
  - GraderConfig defaults grading_tier to STANDARD (backward compat)

All tests mock the Gemini SDK — no real network IO.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from models.writing_feedback import (
    GraderConfig,
    GradingTier,
    WritingFeedback,
    WritingFeedbackQuick,
)
from services.gemini_writing_grader import GeminiWritingGrader


# ── Fixtures ──────────────────────────────────────────────────────────

# Reusable Gemini-shaped Standard payload (12-section).
VALID_FEEDBACK_STANDARD = {
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
            "explanation": "Sai trợ động từ",
            "suggestion":  "I have been studying",
            "criterion":   "Grammatical Range",
        }
    ],
    "aiContentAnalysis": {"likelihood": 5, "explanation": "Bài tự nhiên"},
    "improvedEssay": "Improved version…",
}

# Quick-tier shape — strict subset (4 criteria + mistakes + summary).
VALID_FEEDBACK_QUICK = {
    "overallBandScore": 6.5,
    "overallBandScoreSummary": "Quick: Band 6.5",
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
            "explanation": "Sai trợ động từ",
            "suggestion":  "I have been studying",
            "criterion":   "Grammatical Range",
        }
    ],
}


@pytest.fixture
def grader():
    """Grader with stubbed API key + genai.configure mocked."""
    with patch("services.gemini_writing_grader.settings") as mock_settings, \
         patch("services.gemini_writing_grader.genai.configure"):
        mock_settings.GEMINI_API_KEY = "test-key-fake"
        # Quick-tier model selection reads these from settings — provide
        # stable values for the patched module.
        mock_settings.GEMINI_FLASH_MODEL = "gemini-2.5-flash"
        mock_settings.GEMINI_PRO_MODEL = "gemini-2.5-pro"
        yield GeminiWritingGrader()


@pytest.fixture
def reset_loader_cache():
    """Clear the per-version loader cache so a prior test's
    monkeypatched WRITING_PROMPT_VERSION can't leak in."""
    import services.writing_prompt_loader as wpl
    saved = dict(wpl._loader_instances)
    wpl._loader_instances.clear()
    yield
    wpl._loader_instances.clear()
    wpl._loader_instances.update(saved)


def _quick_config(**overrides) -> GraderConfig:
    base = dict(
        task_type="task2",
        prompt_text="Some prompt",
        essay_text="Some essay",
        analysis_level=1,
        grading_tier=GradingTier.QUICK,
    )
    base.update(overrides)
    return GraderConfig(**base)


def _standard_config(**overrides) -> GraderConfig:
    base = dict(
        task_type="task2",
        prompt_text="Some prompt",
        essay_text="Some essay",
        analysis_level=1,
    )
    base.update(overrides)
    return GraderConfig(**base)


# ── Default backward compat ───────────────────────────────────────────

def test_grader_config_defaults_to_standard():
    """A GraderConfig built without `grading_tier` defaults to STANDARD.
    Pin so a future enum reorder can't accidentally change the default."""
    cfg = GraderConfig(
        task_type="task2", prompt_text="p", essay_text="e", analysis_level=1,
    )
    assert cfg.grading_tier == GradingTier.STANDARD


# ── Quick tier ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_quick_tier_uses_flash_model_regardless_of_selected_model(
    grader, monkeypatch, reset_loader_cache,
):
    """Quick tier always grades on Flash even when an admin set
    selected_model='gemini-2.5-pro' on the request — the cost/latency
    profile of Flash is the whole point of Quick."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_PROMPT_VERSION", "v2")

    # Capture which model `_call_with_retry` is invoked with.
    captured: dict = {}

    async def fake_call(model_name, system_prompt, user_prompt):
        captured["model_name"] = model_name
        return json.dumps(VALID_FEEDBACK_QUICK), {"input_tokens": 1, "output_tokens": 1}

    cfg = _quick_config(selected_model="gemini-2.5-pro")
    with patch.object(grader, "_call_with_retry", side_effect=fake_call):
        result = await grader.grade_essay(cfg)

    # Flash forced regardless of cfg.selected_model.
    assert "flash" in captured["model_name"].lower(), (
        f"Quick tier must use Flash, got {captured['model_name']!r}"
    )
    assert result.model_used == "gemini-2.5-flash"


@pytest.mark.asyncio
async def test_quick_tier_returns_5_section_subset(
    grader, monkeypatch, reset_loader_cache,
):
    """Quick tier feedback parses as WritingFeedbackQuick (subset).
    The Standard-only fields (improvedEssay, keyTakeaways,
    aiContentAnalysis) must not be present on the result.feedback."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_PROMPT_VERSION", "v2")

    json_payload = json.dumps(VALID_FEEDBACK_QUICK)
    usage = {"input_tokens": 1, "output_tokens": 1}

    cfg = _quick_config()
    with patch.object(grader, "_call_with_retry", return_value=(json_payload, usage)):
        result = await grader.grade_essay(cfg)

    assert isinstance(result.feedback, WritingFeedbackQuick)
    # Subset shape — no improvedEssay / keyTakeaways / aiContentAnalysis
    assert not hasattr(result.feedback, "improvedEssay") or result.feedback.__class__ is WritingFeedbackQuick
    # Required Quick fields are populated.
    assert result.feedback.overallBandScore == 6.5
    assert len(result.feedback.mistakeAnalysis) == 1
    # The 4 criteria scores survive — essay_service persistence depends on this.
    assert result.feedback.criteriaFeedback.mainCriterion.bandScore == 6


@pytest.mark.asyncio
async def test_quick_tier_stamp_includes_quick_suffix(
    grader, monkeypatch, reset_loader_cache,
):
    """Quick stamp must end with '-quick' so A/B SQL can split rows
    via `split_part(prompt_version, '-', 2)`."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_PROMPT_VERSION", "v2")

    json_payload = json.dumps(VALID_FEEDBACK_QUICK)
    usage = {"input_tokens": 1, "output_tokens": 1}

    cfg = _quick_config()
    with patch.object(grader, "_call_with_retry", return_value=(json_payload, usage)):
        result = await grader.grade_essay(cfg)

    assert result.prompt_version.endswith("-quick"), (
        f"Quick stamp must end with -quick, got {result.prompt_version!r}"
    )
    # Concretely v2.1-quick at time of writing — pin so a stamp drift
    # surfaces.
    assert result.prompt_version == "v2.1-quick"
    assert result.grading_tier == GradingTier.QUICK


# ── Standard tier — backward-compat ───────────────────────────────────

@pytest.mark.asyncio
async def test_standard_tier_uses_pro_and_full_schema(
    grader, monkeypatch, reset_loader_cache,
):
    """Standard tier (the default) must keep pre-2.7a behaviour:
    Pro model (or whatever selected_model says), full WritingFeedback
    schema, stamp without `-quick` suffix."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_PROMPT_VERSION", "v2")

    captured: dict = {}

    async def fake_call(model_name, system_prompt, user_prompt):
        captured["model_name"] = model_name
        return json.dumps(VALID_FEEDBACK_STANDARD), {"input_tokens": 1, "output_tokens": 1}

    cfg = _standard_config(selected_model="gemini-2.5-pro")
    with patch.object(grader, "_call_with_retry", side_effect=fake_call):
        result = await grader.grade_essay(cfg)

    assert captured["model_name"] == "gemini-2.5-pro"
    assert isinstance(result.feedback, WritingFeedback)
    assert result.feedback.improvedEssay == "Improved version…"  # full schema field
    assert result.prompt_version == "v2.1"  # no -quick suffix
    assert "-quick" not in result.prompt_version
    assert result.grading_tier == GradingTier.STANDARD


# ── Deep / Instructor — reserved tiers ────────────────────────────────

@pytest.mark.asyncio
async def test_deep_tier_raises_not_implemented_with_sprint_pointer(grader):
    """Deep tier is reserved for Sprint 2.7b. The error must name the
    sprint so a developer hitting this knows when to expect support."""
    cfg = _standard_config(grading_tier=GradingTier.DEEP)
    with pytest.raises(NotImplementedError, match="2.7b"):
        await grader.grade_essay(cfg)


@pytest.mark.asyncio
async def test_instructor_tier_raises_not_implemented_with_sprint_pointer(grader):
    """Instructor tier is reserved for Sprint 2.7c."""
    cfg = _standard_config(grading_tier=GradingTier.INSTRUCTOR)
    with pytest.raises(NotImplementedError, match="2.7c"):
        await grader.grade_essay(cfg)


# ── Validation at the GraderConfig boundary ───────────────────────────

def test_invalid_tier_string_rejected_at_config_layer():
    """GraderConfig + GradingTier reject unknown tier values at the
    Pydantic boundary so the grader never sees a bad value."""
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        GraderConfig(
            task_type="task2",
            prompt_text="p",
            essay_text="e",
            analysis_level=1,
            grading_tier="not-a-tier",  # invalid
        )
