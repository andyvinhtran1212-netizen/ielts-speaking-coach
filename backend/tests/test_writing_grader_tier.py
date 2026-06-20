"""Tests for tier-aware GeminiWritingGrader (Sprint 2.7a foundation;
Quick removed Sprint 2.7a.1; Deep added Sprint 2.7b).

Covers:
  - GraderConfig defaults grading_tier to STANDARD (backward compat)
  - Standard tier behaviour bit-for-bit identical pre-2.7a
  - Quick tier raises ValueError ("removed in 2.7a.1") at the grader —
    defence-in-depth; the API layer rejects with 400 first
  - Deep tier 3-pass orchestration: full success, Pass 2 fail → degraded
    fallback to Pass 1, Pass 3 fail → degraded fallback to merged
    Pass 1+2; tier_metadata captures per-pass timing/tokens/cost
  - Deep merge semantics: band-score adjustments applied, added_mistakes
    appended, removed_mistake_indexes filtered out
  - Instructor raises NotImplementedError pointing at 2.7c
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
    WritingFeedbackDeep,
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

    async def fake_call(model_name, system_prompt, user_prompt, **_kw):
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


# ── Sprint 2.7d.1 — Instructor tier ───────────────────────────────────


@pytest.mark.asyncio
async def test_instructor_tier_runs_standard_pass1_with_pending_stamp(
    grader, monkeypatch, reset_loader_cache,
):
    """Instructor tier reuses _grade_standard for AI Pass 1 and
    stamps `-instructor-pending` so a SQL filter can split
    awaiting-review essays from delivered ones. The grader returns
    the Standard feedback unchanged; the queue/claim/deliver
    lifecycle lives in instructor_workflow.py."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_PROMPT_VERSION", "v2")

    captured_calls: list[str] = []
    async def fake_call(model_name, system_prompt, user_prompt, **_kw):
        captured_calls.append(model_name)
        return json.dumps(VALID_FEEDBACK_STANDARD), {"input_tokens": 100, "output_tokens": 100}

    cfg = _standard_config(grading_tier=GradingTier.INSTRUCTOR)
    with patch.object(grader, "_call_with_retry", side_effect=fake_call):
        result = await grader.grade_essay(cfg)

    # Single Gemini call — Instructor is AI Standard + queue, not multi-pass.
    assert len(captured_calls) == 1
    assert result.grading_tier == GradingTier.INSTRUCTOR
    # Stamp ends with -instructor-pending so the deliver action can
    # strip the suffix and replace with -instructor cleanly.
    assert result.prompt_version == "v2.1-instructor-pending", (
        f"Expected -instructor-pending stamp, got {result.prompt_version!r}"
    )
    # Feedback shape identical to Standard — Pass 1 IS Standard.
    assert isinstance(result.feedback, WritingFeedback)
    assert result.feedback.overallBandScore == VALID_FEEDBACK_STANDARD["overallBandScore"]


# ── Sprint 2.7b — Deep tier 3-pass flow ───────────────────────────────
#
# Pass 1 reuses _grade_standard, so we drive it via _call_with_retry
# returning the Standard JSON payload. Pass 2 + Pass 3 are private
# helpers; we mock them directly to keep tests focused on the
# orchestration contract (success, fallback, merge, telemetry) rather
# than re-asserting the full prompt-loader path that other tests cover.


VALID_PASS2_EMPTY = {
    "band_score_adjustments": {
        "overall": None, "mainCriterion": None, "coherenceCohesion": None,
        "lexicalResource": None, "grammaticalRange": None,
    },
    "added_mistakes": [],
    "removed_mistake_indexes": [],
    "rationale": "Pass 1 đã chính xác.",
}

VALID_PASS2_WITH_DELTAS = {
    "band_score_adjustments": {
        "overall": 7.0,
        "mainCriterion": 7,
        "coherenceCohesion": None,
        "lexicalResource": None,
        "grammaticalRange": None,
    },
    "added_mistakes": [
        {
            "original":    "she go to school",
            "mistakeType": "Grammar",
            "explanation": "Sai chia động từ ngôi thứ ba số ít",
            "suggestion":  "she goes to school",
            "criterion":   "Grammatical Range",
        }
    ],
    "removed_mistake_indexes": [0],   # drop Pass 1's only mistake
    "rationale": "Cần thêm lỗi chia động từ; gỡ lỗi không hợp lệ.",
}

VALID_PASS3_RESPONSE = {
    "sentence_rewrites": [
        {
            "original_sentence":  "I has been study English",
            "rewritten_sentence": "I have been studying English",
            "mistakes_addressed": [0],
            "rationale": "Sửa thì hiện tại hoàn thành tiếp diễn.",
        },
        {
            "original_sentence":  "she go to school",
            "rewritten_sentence": "She goes to school",
            "mistakes_addressed": [1],
            "rationale": "Chia động từ đúng ngôi thứ ba số ít.",
        },
    ],
}


def _deep_config(**overrides) -> GraderConfig:
    base = dict(
        task_type="task2",
        prompt_text="Some prompt",
        essay_text="Some essay",
        analysis_level=3,
        grading_tier=GradingTier.DEEP,
    )
    base.update(overrides)
    return GraderConfig(**base)


def _patch_v2_loader(monkeypatch):
    """Pin the prompt version to v2 so Deep tier's load_deep_pass2/3
    paths don't raise the v1-rejection ValueError mid-test."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_PROMPT_VERSION", "v2")


@pytest.mark.asyncio
async def test_deep_tier_runs_3_passes_on_full_success(
    grader, monkeypatch, reset_loader_cache,
):
    """All 3 passes succeed. Pass 1 returns the Standard payload,
    Pass 2 returns an empty refinement, Pass 3 returns 1 rewrite.
    Result is WritingFeedbackDeep stamped 'v2.1-deep'."""
    _patch_v2_loader(monkeypatch)

    pass1_json = json.dumps(VALID_FEEDBACK_STANDARD)
    pass2_json = json.dumps(VALID_PASS2_EMPTY)
    pass3_json = json.dumps({
        "sentence_rewrites": [VALID_PASS3_RESPONSE["sentence_rewrites"][0]],
    })

    # _call_with_retry is invoked once per pass — Pass 1 (via
    # _grade_standard), Pass 2, Pass 3, in order.
    call_log: list[str] = []
    async def fake_call(model_name, system_prompt, user_prompt, **_kw):
        call_log.append(model_name)
        if len(call_log) == 1:
            return pass1_json, {"input_tokens": 3000, "output_tokens": 2000}
        if len(call_log) == 2:
            return pass2_json, {"input_tokens": 1500, "output_tokens": 500}
        return pass3_json, {"input_tokens": 1800, "output_tokens": 1200}

    cfg = _deep_config(selected_model="gemini-2.5-pro")
    with patch.object(grader, "_call_with_retry", side_effect=fake_call):
        result = await grader.grade_essay(cfg)

    assert len(call_log) == 3, "Deep tier must run exactly 3 Gemini calls"
    assert result.grading_tier == GradingTier.DEEP
    assert isinstance(result.feedback, WritingFeedbackDeep)
    assert result.prompt_version == "v2.1-deep"
    assert "degraded" not in result.prompt_version


@pytest.mark.asyncio
async def test_deep_tier_includes_sentence_rewrites_on_success(
    grader, monkeypatch, reset_loader_cache,
):
    """Pass 3 output flows through to feedback.sentenceRewrites verbatim."""
    _patch_v2_loader(monkeypatch)

    pass1_json = json.dumps(VALID_FEEDBACK_STANDARD)
    pass2_json = json.dumps(VALID_PASS2_EMPTY)
    pass3_json = json.dumps(VALID_PASS3_RESPONSE)

    responses = iter([
        (pass1_json, {"input_tokens": 100, "output_tokens": 100}),
        (pass2_json, {"input_tokens": 50,  "output_tokens": 50}),
        (pass3_json, {"input_tokens": 80,  "output_tokens": 80}),
    ])
    async def fake_call(model_name, system_prompt, user_prompt, **_kw):
        return next(responses)

    cfg = _deep_config()
    with patch.object(grader, "_call_with_retry", side_effect=fake_call):
        result = await grader.grade_essay(cfg)

    assert len(result.feedback.sentenceRewrites) == 2
    assert result.feedback.sentenceRewrites[0].original_sentence == "I has been study English"
    assert result.feedback.sentenceRewrites[0].rewritten_sentence == "I have been studying English"
    assert result.feedback.pass2_refinements is not None


@pytest.mark.asyncio
async def test_deep_tier_pass2_failure_falls_back_to_pass1(
    grader, monkeypatch, reset_loader_cache,
):
    """Pass 2 raises → Deep returns Pass 1's feedback, empty rewrites,
    no pass2_refinements, stamp ends with '-deep-degraded'."""
    _patch_v2_loader(monkeypatch)

    pass1_json = json.dumps(VALID_FEEDBACK_STANDARD)
    call_log: list[int] = []
    async def fake_call(model_name, system_prompt, user_prompt, **_kw):
        call_log.append(1)
        if len(call_log) == 1:
            return pass1_json, {"input_tokens": 100, "output_tokens": 100}
        # Pass 2 raises — Pass 3 must NOT be reached.
        raise RuntimeError("simulated Pass 2 API outage")

    cfg = _deep_config()
    with patch.object(grader, "_call_with_retry", side_effect=fake_call):
        result = await grader.grade_essay(cfg)

    # Exactly Pass 1 + Pass 2 attempted; Pass 3 skipped.
    assert len(call_log) == 2
    assert result.grading_tier == GradingTier.DEEP
    assert result.prompt_version == "v2.1-deep-degraded"
    assert isinstance(result.feedback, WritingFeedbackDeep)
    # Pass 1 feedback preserved bit-for-bit.
    assert result.feedback.overallBandScore == VALID_FEEDBACK_STANDARD["overallBandScore"]
    assert result.feedback.sentenceRewrites == []
    assert result.feedback.pass2_refinements is None
    assert result.tier_metadata.get("degraded_at") == "pass2"


@pytest.mark.asyncio
async def test_deep_tier_pass3_failure_falls_back_to_merged_pass1_pass2(
    grader, monkeypatch, reset_loader_cache,
):
    """Pass 3 raises → Deep returns merged Pass 1+2 feedback, empty
    rewrites, pass2_refinements preserved, stamp '-deep-degraded'."""
    _patch_v2_loader(monkeypatch)

    pass1_json = json.dumps(VALID_FEEDBACK_STANDARD)
    pass2_json = json.dumps(VALID_PASS2_EMPTY)
    call_log: list[int] = []
    async def fake_call(model_name, system_prompt, user_prompt, **_kw):
        call_log.append(1)
        if len(call_log) == 1:
            return pass1_json, {"input_tokens": 100, "output_tokens": 100}
        if len(call_log) == 2:
            return pass2_json, {"input_tokens": 50, "output_tokens": 50}
        raise RuntimeError("simulated Pass 3 API outage")

    cfg = _deep_config()
    with patch.object(grader, "_call_with_retry", side_effect=fake_call):
        result = await grader.grade_essay(cfg)

    assert len(call_log) == 3, "All 3 passes must be attempted"
    assert result.prompt_version == "v2.1-deep-degraded"
    assert isinstance(result.feedback, WritingFeedbackDeep)
    assert result.feedback.sentenceRewrites == []
    # Pass 2 result still flows through (refinement worked, only
    # rewrites were lost) — admin can still see the rationale.
    assert result.feedback.pass2_refinements is not None
    assert result.tier_metadata.get("degraded_at") == "pass3"


@pytest.mark.asyncio
async def test_deep_tier_metadata_tracks_per_pass_timing(
    grader, monkeypatch, reset_loader_cache,
):
    """tier_metadata captures pass1/pass2/pass3 entries with
    duration_ms + token counts. Persisted to writing_essays.
    grading_tier_metadata for cost telemetry / per-pass cost split."""
    _patch_v2_loader(monkeypatch)

    pass1_json = json.dumps(VALID_FEEDBACK_STANDARD)
    pass2_json = json.dumps(VALID_PASS2_EMPTY)
    pass3_json = json.dumps({"sentence_rewrites": []})

    responses = iter([
        (pass1_json, {"input_tokens": 3000, "output_tokens": 2000}),
        (pass2_json, {"input_tokens": 1500, "output_tokens": 500}),
        (pass3_json, {"input_tokens": 1800, "output_tokens": 1200}),
    ])
    async def fake_call(model_name, system_prompt, user_prompt, **_kw):
        return next(responses)

    cfg = _deep_config()
    with patch.object(grader, "_call_with_retry", side_effect=fake_call):
        result = await grader.grade_essay(cfg)

    md = result.tier_metadata
    for k in ("pass1", "pass2", "pass3"):
        assert k in md, f"tier_metadata missing {k}"
        assert "duration_ms" in md[k]

    assert md["pass1"]["tokens_input"] == 3000
    assert md["pass2"]["tokens_input"] == 1500
    assert md["pass3"]["tokens_input"] == 1800
    # Top-level token totals = sum across passes (used for cost
    # telemetry without summing on the consumer side).
    assert result.tokens_input == 3000 + 1500 + 1800
    assert result.tokens_output == 2000 + 500 + 1200


@pytest.mark.asyncio
async def test_deep_tier_band_adjustments_apply_to_merged_feedback(
    grader, monkeypatch, reset_loader_cache,
):
    """Pass 2 band_score_adjustments fields override Pass 1's
    overallBandScore and the corresponding criteriaFeedback bandScore.
    Non-None fields apply; None fields are no-ops."""
    _patch_v2_loader(monkeypatch)

    pass1_json = json.dumps(VALID_FEEDBACK_STANDARD)
    pass2_json = json.dumps(VALID_PASS2_WITH_DELTAS)
    pass3_json = json.dumps({"sentence_rewrites": []})

    responses = iter([
        (pass1_json, {"input_tokens": 100, "output_tokens": 100}),
        (pass2_json, {"input_tokens": 50,  "output_tokens": 50}),
        (pass3_json, {"input_tokens": 80,  "output_tokens": 80}),
    ])
    async def fake_call(model_name, system_prompt, user_prompt, **_kw):
        return next(responses)

    cfg = _deep_config()
    with patch.object(grader, "_call_with_retry", side_effect=fake_call):
        result = await grader.grade_essay(cfg)

    fb = result.feedback
    # Pass 2 set overall=7.0, mainCriterion=7. Both must apply.
    assert fb.overallBandScore == 7.0
    assert fb.criteriaFeedback.mainCriterion.bandScore == 7
    # Pass 2 left these as None — Pass 1's values must persist.
    assert fb.criteriaFeedback.coherenceCohesion.bandScore == 6
    assert fb.criteriaFeedback.lexicalResource.bandScore == 7
    assert fb.criteriaFeedback.grammaticalRange.bandScore == 6


@pytest.mark.asyncio
async def test_deep_tier_added_mistakes_appended_to_merged_feedback(
    grader, monkeypatch, reset_loader_cache,
):
    """added_mistakes from Pass 2 land in feedback.mistakeAnalysis
    (after the kept Pass 1 entries)."""
    _patch_v2_loader(monkeypatch)

    pass1_json = json.dumps(VALID_FEEDBACK_STANDARD)
    # Pass 2 adds 1 mistake but does NOT remove any from Pass 1.
    pass2_payload = {**VALID_PASS2_WITH_DELTAS, "removed_mistake_indexes": []}
    pass2_json = json.dumps(pass2_payload)
    pass3_json = json.dumps({"sentence_rewrites": []})

    responses = iter([
        (pass1_json, {"input_tokens": 100, "output_tokens": 100}),
        (pass2_json, {"input_tokens": 50,  "output_tokens": 50}),
        (pass3_json, {"input_tokens": 80,  "output_tokens": 80}),
    ])
    async def fake_call(model_name, system_prompt, user_prompt, **_kw):
        return next(responses)

    cfg = _deep_config()
    with patch.object(grader, "_call_with_retry", side_effect=fake_call):
        result = await grader.grade_essay(cfg)

    mistakes = result.feedback.mistakeAnalysis
    # Pass 1 had 1 mistake; Pass 2 added 1; none removed → 2 total,
    # additions appended after kept Pass 1 entries.
    assert len(mistakes) == 2
    assert mistakes[0].original == "I has been study"            # Pass 1 kept
    assert mistakes[1].original == "she go to school"            # Pass 2 added


@pytest.mark.asyncio
async def test_deep_tier_removed_mistakes_filtered_from_merged_feedback(
    grader, monkeypatch, reset_loader_cache,
):
    """removed_mistake_indexes from Pass 2 drops Pass 1 entries by
    index (defensive against out-of-range indexes — `_merge_pass1_pass2`
    guards on `0 <= i < len(...)`)."""
    _patch_v2_loader(monkeypatch)

    pass1_json = json.dumps(VALID_FEEDBACK_STANDARD)
    # Pass 2 removes Pass 1's only mistake (index 0) and adds nothing.
    pass2_payload = {
        **VALID_PASS2_EMPTY,
        "removed_mistake_indexes": [0, 99],   # 99 is out of range — must not crash
    }
    pass2_json = json.dumps(pass2_payload)
    pass3_json = json.dumps({"sentence_rewrites": []})

    responses = iter([
        (pass1_json, {"input_tokens": 100, "output_tokens": 100}),
        (pass2_json, {"input_tokens": 50,  "output_tokens": 50}),
        (pass3_json, {"input_tokens": 80,  "output_tokens": 80}),
    ])
    async def fake_call(model_name, system_prompt, user_prompt, **_kw):
        return next(responses)

    cfg = _deep_config()
    with patch.object(grader, "_call_with_retry", side_effect=fake_call):
        result = await grader.grade_essay(cfg)

    assert result.feedback.mistakeAnalysis == [], (
        "Pass 1's only mistake must be removed; out-of-range index 99 ignored"
    )


@pytest.mark.asyncio
async def test_deep_tier_pass1_failure_re_raises(
    grader, monkeypatch, reset_loader_cache,
):
    """Pass 1 is the baseline — if it fails there's no graceful
    fallback. The error must propagate so essay_service marks the
    job as failed (same behaviour as a pre-2.7b Standard failure)."""
    _patch_v2_loader(monkeypatch)

    async def fake_call(model_name, system_prompt, user_prompt, **_kw):
        raise RuntimeError("Pass 1 API outage")

    cfg = _deep_config()
    with patch.object(grader, "_call_with_retry", side_effect=fake_call):
        with pytest.raises(RuntimeError, match="Pass 1 API outage"):
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
