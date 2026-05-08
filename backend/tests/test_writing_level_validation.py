"""Tests for `validate_level_coverage` (Sprint 2.7c).

The validator mirrors `WritingPromptLoader.LEVEL_SECTIONS` on the
output side: after grading we check that the LLM actually produced
the sections the level required. It WARNS (does not raise) — a
near-complete grading is better UX than rejecting because Gemini
dropped one section.

These tests pin:
  - Empty `LEVEL_REQUIRED_FIELDS` for L1 (always-on fields are
    Pydantic-required, so nothing to validate at L1)
  - L2 requires `coherenceAnalysis`
  - L3 requires `coherenceAnalysis` + `ideaDevelopmentAnalysis` +
    `counterargumentAnalysis`, but T1 essays exclude
    `counterargumentAnalysis`
  - L4 + L5 require all of the L3 set + `lexicalAnalysis` +
    `sentenceStructureAnalysis`
  - Empty list / empty dict count as missing (Gemini emitted the key
    but didn't fill it)
  - The function NEVER raises — it returns the missing-list and logs
"""

from __future__ import annotations

import logging

import pytest

from models.writing_feedback import (
    AIContentAnalysis,
    CoherenceAnalysisItem,
    CounterargumentAnalysis,
    CriteriaFeedback,
    CriteriaFeedbackBundle,
    IdeaDevelopmentAnalysis,
    KeyTakeaways,
    LEVEL_REQUIRED_FIELDS,
    LexicalAnalysis,
    MistakeAnalysis,
    SuggestionInstructionExample,
    WordToUpgradeItem,
    WritingFeedback,
    validate_level_coverage,
)


# ── Builders ──────────────────────────────────────────────────────────


def _criteria(score: int = 6) -> CriteriaFeedback:
    return CriteriaFeedback(
        title="X", explanation="...", feedback="...", bandScore=score,
    )


def _build_feedback(**overrides) -> WritingFeedback:
    """Build a base L1-style WritingFeedback (always-on fields only).
    Overrides let each test add the optional fields it needs."""
    base = dict(
        overallBandScore=6.5,
        overallBandScoreSummary="...",
        keyTakeaways=KeyTakeaways(
            strengths=["s1"], areasForImprovement=["a1"],
        ),
        criteriaFeedback=CriteriaFeedbackBundle(
            mainCriterion=_criteria(),
            coherenceCohesion=_criteria(),
            lexicalResource=_criteria(7),
            grammaticalRange=_criteria(),
        ),
        mistakeAnalysis=[
            MistakeAnalysis(
                original="x", mistakeType="g", explanation="...",
                suggestion="y", criterion="GRA",
            )
        ],
        aiContentAnalysis=AIContentAnalysis(likelihood=10, explanation="..."),
        improvedEssay="rewrite",
    )
    base.update(overrides)
    return WritingFeedback(**base)


def _coherence_item() -> CoherenceAnalysisItem:
    return CoherenceAnalysisItem(
        location="P1, S2", issue="...", explanation="...",
        suggestion=SuggestionInstructionExample(instruction="x", example="y"),
    )


def _idea_item() -> IdeaDevelopmentAnalysis:
    return IdeaDevelopmentAnalysis(
        paragraph=2, originalIdea="x", issue="...", explanation="...",
        suggestion=SuggestionInstructionExample(instruction="x", example="y"),
    )


def _counter() -> CounterargumentAnalysis:
    return CounterargumentAnalysis(
        isPresent=False, feedback="...", suggestion="...",
    )


def _lex() -> LexicalAnalysis:
    return LexicalAnalysis(
        wordsToUpgrade=[
            WordToUpgradeItem(
                original="big", context="big city",
                suggestions=["substantial", "considerable", "vast"],
                category="Generic adjective",
            )
        ],
    )


# ── Constant shape ────────────────────────────────────────────────────


def test_level_required_fields_constant_shape():
    """Pin the constant. A new level (e.g., a future L6) must come
    with explicit required-field bookkeeping; an accidental drop of
    L4/L5 fields would silently disable monitoring."""
    assert set(LEVEL_REQUIRED_FIELDS.keys()) == {1, 2, 3, 4, 5}
    assert LEVEL_REQUIRED_FIELDS[1] == []
    assert LEVEL_REQUIRED_FIELDS[2] == ["coherenceAnalysis"]
    assert set(LEVEL_REQUIRED_FIELDS[3]) == {
        "coherenceAnalysis", "ideaDevelopmentAnalysis", "counterargumentAnalysis",
    }
    assert set(LEVEL_REQUIRED_FIELDS[4]) == {
        "coherenceAnalysis", "ideaDevelopmentAnalysis", "counterargumentAnalysis",
        "lexicalAnalysis", "sentenceStructureAnalysis",
    }
    # L5 has the same coverage as L4 — pedantic refinements live INSIDE
    # the existing fields, no new sections.
    assert set(LEVEL_REQUIRED_FIELDS[5]) == set(LEVEL_REQUIRED_FIELDS[4])


# ── L1 — nothing optional required ────────────────────────────────────


def test_l1_minimum_feedback_no_missing(caplog):
    """L1 has no optional-required fields. A bare-minimum feedback
    object must produce zero warnings + empty missing list."""
    fb = _build_feedback()
    with caplog.at_level(logging.WARNING):
        missing = validate_level_coverage(fb, level=1)
    assert missing == []
    assert not any("level-coverage" in r.message for r in caplog.records)


# ── L2 — coherenceAnalysis required ───────────────────────────────────


def test_l2_missing_coherence_logs_warning(caplog):
    fb = _build_feedback()  # coherenceAnalysis defaults to None
    with caplog.at_level(logging.WARNING):
        missing = validate_level_coverage(fb, level=2)
    assert missing == ["coherenceAnalysis"]
    assert any(
        "coherenceAnalysis" in r.message and "L2" in r.message
        for r in caplog.records
    )


def test_l2_with_coherence_no_warning(caplog):
    fb = _build_feedback(coherenceAnalysis=[_coherence_item()])
    with caplog.at_level(logging.WARNING):
        missing = validate_level_coverage(fb, level=2)
    assert missing == []


def test_l2_empty_list_counts_as_missing(caplog):
    """Gemini sometimes emits `[]` instead of `null` when it should
    have skipped (or actually populated) a section. Empty list at L2
    means coherenceAnalysis was nominally produced but empty —
    surface as missing for monitoring."""
    fb = _build_feedback(coherenceAnalysis=[])
    with caplog.at_level(logging.WARNING):
        missing = validate_level_coverage(fb, level=2)
    assert missing == ["coherenceAnalysis"]


# ── L3 — counterargument is T2-only ───────────────────────────────────


def test_l3_t2_essay_full_coverage_no_warning():
    fb = _build_feedback(
        coherenceAnalysis=[_coherence_item()],
        ideaDevelopmentAnalysis=[_idea_item()],
        counterargumentAnalysis=_counter(),
    )
    missing = validate_level_coverage(fb, level=3, task_type="task2")
    assert missing == []


def test_l3_t1_excludes_counterargument():
    """Task 1 essays at L3+ rightfully have counterargumentAnalysis
    None — there's no counterargument concept in data description.
    Validator must NOT flag this as missing."""
    fb = _build_feedback(
        coherenceAnalysis=[_coherence_item()],
        ideaDevelopmentAnalysis=[_idea_item()],
        # counterargumentAnalysis stays None (default)
    )
    missing = validate_level_coverage(fb, level=3, task_type="task1_academic")
    assert missing == []


def test_l3_t2_missing_counterargument_warns():
    """Same essay at L3 T2 — without counterargumentAnalysis, must warn."""
    fb = _build_feedback(
        coherenceAnalysis=[_coherence_item()],
        ideaDevelopmentAnalysis=[_idea_item()],
    )
    missing = validate_level_coverage(fb, level=3, task_type="task2")
    assert "counterargumentAnalysis" in missing


# ── L4 — full cumulative ──────────────────────────────────────────────


def test_l4_t2_full_coverage_no_warning():
    fb = _build_feedback(
        coherenceAnalysis=[_coherence_item()],
        ideaDevelopmentAnalysis=[_idea_item()],
        counterargumentAnalysis=_counter(),
        lexicalAnalysis=_lex(),
        sentenceStructureAnalysis={"sentenceUpgrades": [
            {"original": "x", "rewritten": "y", "explanation": "..."}]},
    )
    missing = validate_level_coverage(fb, level=4, task_type="task2")
    assert missing == []


def test_l4_missing_lexical_and_sentence_warns():
    """L4 baseline regression: dropping the two L4-specific sections
    must surface both."""
    fb = _build_feedback(
        coherenceAnalysis=[_coherence_item()],
        ideaDevelopmentAnalysis=[_idea_item()],
        counterargumentAnalysis=_counter(),
    )
    missing = validate_level_coverage(fb, level=4, task_type="task2")
    assert set(missing) == {"lexicalAnalysis", "sentenceStructureAnalysis"}


# ── L5 — same coverage as L4 ──────────────────────────────────────────


def test_l5_full_coverage_no_warning():
    fb = _build_feedback(
        coherenceAnalysis=[_coherence_item()],
        ideaDevelopmentAnalysis=[_idea_item()],
        counterargumentAnalysis=_counter(),
        lexicalAnalysis=_lex(),
        sentenceStructureAnalysis={"sentenceUpgrades": [
            {"original": "x", "rewritten": "y", "explanation": "..."}]},
    )
    missing = validate_level_coverage(fb, level=5, task_type="task2")
    assert missing == []


# ── Never raises ──────────────────────────────────────────────────────


def test_validator_never_raises_on_unknown_level():
    """Unknown levels return an empty missing-list, no exception. The
    validator is monitoring, not gating — never block a graded essay."""
    fb = _build_feedback()
    # 0 + 6 are out of the L1-L5 range.
    assert validate_level_coverage(fb, level=0) == []
    assert validate_level_coverage(fb, level=6) == []


def test_validator_returns_list_for_caller_to_act_on():
    """Return value is the missing-list — callers (e.g., admin
    dashboard counter, alerting) can act on it without re-running
    the check."""
    fb = _build_feedback()
    result = validate_level_coverage(fb, level=4, task_type="task2")
    assert isinstance(result, list)
    # 5 fields required at L4 (with T2), all missing on a bare feedback.
    assert len(result) == 5
