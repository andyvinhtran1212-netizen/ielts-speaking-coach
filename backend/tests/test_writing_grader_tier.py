"""Tests for tier-aware GeminiWritingGrader (Sprint 2.7a foundation;
Quick removed Sprint 2.7a.1).

Covers:
  - GraderConfig defaults grading_tier to STANDARD (backward compat)
  - Standard tier behaviour bit-for-bit identical pre-2.7a
  - Quick tier raises ValueError ("removed in 2.7a.1") at the grader —
    defence-in-depth; the API layer rejects with 400 first
  - Deep / Instructor raise NotImplementedError pointing at 2.7b/c
  - Invalid tier strings rejected at the GraderConfig boundary
  - Removal verification: WritingFeedbackQuick gone; load_quick gone;
    quick/ prompt directory gone

All tests mock the Gemini SDK — no real network IO.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from models.writing_feedback import (
    GraderConfig,
    GradingTier,
    WritingFeedback,
)
from services.gemini_writing_grader import GeminiWritingGrader


# ── Fixture payload — Standard 12-section response ────────────────────

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


@pytest.fixture
def grader():
    """Grader with stubbed API key + genai.configure mocked."""
    with patch("services.gemini_writing_grader.settings") as mock_settings, \
         patch("services.gemini_writing_grader.genai.configure"):
        mock_settings.GEMINI_API_KEY = "test-key-fake"
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


# ── Standard tier — backward compat ───────────────────────────────────

@pytest.mark.asyncio
async def test_standard_tier_uses_pro_and_full_schema(
    grader, monkeypatch, reset_loader_cache,
):
    """Standard tier (the default) keeps pre-2.7a behaviour: Pro model
    (or whatever selected_model says), full WritingFeedback schema,
    stamp without any tier suffix."""
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
    assert result.feedback.improvedEssay == "Improved version…"  # full-schema field
    assert result.prompt_version == "v2.1"
    assert "-quick" not in result.prompt_version  # removed in 2.7a.1
    assert result.grading_tier == GradingTier.STANDARD


# ── Quick tier removal (Sprint 2.7a.1) ────────────────────────────────

@pytest.mark.asyncio
async def test_quick_tier_raises_value_error_with_removal_message(grader):
    """Quick tier reaching the grader is a code-path bypass — the API
    layer rejects with 400 first. The grader still raises ValueError
    with the orthogonality-conflict explanation as defence-in-depth."""
    cfg = _standard_config(grading_tier=GradingTier.QUICK)
    with pytest.raises(ValueError, match="Quick tier was removed"):
        await grader.grade_essay(cfg)


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


# ── Removal verification (Sprint 2.7a.1) ──────────────────────────────
#
# These tests pin that Quick tier code paths are GONE. A regression that
# silently re-adds load_quick / WritingFeedbackQuick / the quick/ prompt
# directory must surface here, not on a production grading attempt.


def test_writing_feedback_quick_model_removed():
    """WritingFeedbackQuick was removed in Sprint 2.7a.1."""
    from models import writing_feedback
    assert not hasattr(writing_feedback, "WritingFeedbackQuick"), (
        "WritingFeedbackQuick should be removed in 2.7a.1 — Quick tier "
        "is gone, the subset schema serves no live caller."
    )


def test_loader_no_load_quick_method():
    """load_quick() was removed from WritingPromptLoader in 2.7a.1."""
    from services.writing_prompt_loader import WritingPromptLoader
    loader = WritingPromptLoader(version="v2")
    assert not hasattr(loader, "load_quick"), (
        "load_quick() should be removed in 2.7a.1 — Quick tier is gone, "
        "the method has no live caller."
    )


def test_loader_no_quick_constants():
    """The QUICK_LEVEL_FILES + QUICK_SHARED_FILES class constants on
    WritingPromptLoader were removed in 2.7a.1."""
    from services.writing_prompt_loader import WritingPromptLoader
    assert not hasattr(WritingPromptLoader, "QUICK_LEVEL_FILES")
    assert not hasattr(WritingPromptLoader, "QUICK_SHARED_FILES")


def test_quick_prompt_directory_removed():
    """prompts/writing/v2/quick/ + the Quick output schema markdown
    file were deleted in 2.7a.1."""
    base = Path(__file__).parent.parent / "prompts" / "writing" / "v2"
    assert not (base / "quick").exists(), (
        "prompts/writing/v2/quick/ should be removed in 2.7a.1"
    )
    assert not (base / "shared" / "output_schema_instructions_quick.md").exists(), (
        "shared/output_schema_instructions_quick.md should be removed in 2.7a.1"
    )


def test_grading_tier_enum_still_has_quick_value():
    """We intentionally KEEP the QUICK enum value (and the Postgres enum
    grading_tier_enum keeps 'quick') so legacy rows + the database type
    don't need a destructive migration. The value just isn't reachable
    from any live caller — API rejects, grader raises ValueError.
    Pin this so a future cleanup that drops the value surfaces the
    trade-off explicitly."""
    assert GradingTier.QUICK.value == "quick"
    assert GradingTier.QUICK in set(GradingTier)
