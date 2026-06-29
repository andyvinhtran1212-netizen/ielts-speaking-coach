"""Unit tests for the offline 2-pass router's PURE merge (no API / no IO)."""

from __future__ import annotations

from models.writing_feedback import (
    AIContentAnalysis,
    CriteriaFeedback,
    CriteriaFeedbackBundle,
    KeyTakeaways,
    MistakeAnalysis,
    WritingFeedback,
)
from scripts.multimodel_router import merge_passes


def _fb(*, band, summary, improved, mistakes, ai_likelihood) -> WritingFeedback:
    return WritingFeedback(
        overallBandScore=band,
        overallBandScoreSummary=summary,
        keyTakeaways=KeyTakeaways(strengths=[f"s{band}"], areasForImprovement=["a"]),
        criteriaFeedback=CriteriaFeedbackBundle(
            mainCriterion=CriteriaFeedback(title="TR", explanation="x", feedback="y", bandScore=int(band)),
            coherenceCohesion=CriteriaFeedback(title="CC", explanation="x", feedback="y", bandScore=int(band)),
            lexicalResource=CriteriaFeedback(title="LR", explanation="x", feedback="y", bandScore=int(band)),
            grammaticalRange=CriteriaFeedback(title="GRA", explanation="x", feedback="y", bandScore=int(band)),
        ),
        mistakeAnalysis=mistakes,
        aiContentAnalysis=AIContentAnalysis(likelihood=ai_likelihood, explanation="x"),
        improvedEssay=improved,
    )


def test_merge_takes_judgment_and_mechanical_from_right_passes():
    judgment = _fb(band=7.0, summary="REAL-JUDGMENT", improved="placeholder", mistakes=[], ai_likelihood=0)
    mechanical = _fb(
        band=4.0, summary="mech-placeholder", improved="REAL-REWRITE",
        mistakes=[MistakeAnalysis(original="x", mistakeType="g", explanation="e",
                                  suggestion="s", criterion="GRA")],
        ai_likelihood=42,
    )

    merged = merge_passes(judgment, mechanical)

    # Judgment pass owns the band + summary + criteria.
    assert merged.overallBandScore == 7.0
    assert merged.overallBandScoreSummary == "REAL-JUDGMENT"
    assert merged.criteriaFeedback.mainCriterion.bandScore == 7
    # Mechanical pass owns the rewrite + mistakes + aiContent.
    assert merged.improvedEssay == "REAL-REWRITE"
    assert len(merged.mistakeAnalysis) == 1
    assert merged.aiContentAnalysis.likelihood == 42
    # Result is a valid full WritingFeedback.
    assert isinstance(merged, WritingFeedback)
