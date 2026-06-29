"""Unit tests for the calibration harness's PURE logic (no API / no IO).

The runner (`run_harness` / `main`) hits the real Gemini API and is exercised
manually, never in CI. These tests pin the comparison + aggregation + report
math that decides go/no-go, using hand-built GradingResults.
"""

from __future__ import annotations

from models.writing_feedback import (
    AIContentAnalysis,
    CriteriaFeedback,
    CriteriaFeedbackBundle,
    GradingResult,
    KeyTakeaways,
    WritingFeedback,
)
from scripts.calibration_harness import (
    aggregate,
    compare_gradings,
    format_report,
)


def _feedback(band: float, crit: int = 6) -> WritingFeedback:
    return WritingFeedback(
        overallBandScore=band,
        overallBandScoreSummary="...",
        keyTakeaways=KeyTakeaways(strengths=["s"], areasForImprovement=["a"]),
        criteriaFeedback=CriteriaFeedbackBundle(
            mainCriterion=CriteriaFeedback(title="TR", explanation="x", feedback="y", bandScore=crit),
            coherenceCohesion=CriteriaFeedback(title="CC", explanation="x", feedback="y", bandScore=crit),
            lexicalResource=CriteriaFeedback(title="LR", explanation="x", feedback="y", bandScore=crit),
            grammaticalRange=CriteriaFeedback(title="GRA", explanation="x", feedback="y", bandScore=crit),
        ),
        mistakeAnalysis=[],
        aiContentAnalysis=AIContentAnalysis(likelihood=5, explanation="x"),
        improvedEssay="rewrite",
    )


def _result(band: float, *, crit: int = 6, cost: float | None = 0.05,
            latency: int = 1000, model: str = "m") -> GradingResult:
    return GradingResult(
        feedback=_feedback(band, crit),
        model_used=model,
        tokens_input=3000, tokens_output=2000,
        cost_usd=cost, grading_duration_ms=latency, prompt_version="v1",
    )


# ── compare_gradings ──────────────────────────────────────────────────


def test_compare_within_threshold():
    c = compare_gradings("e1", _result(6.5, cost=0.05), _result(6.5, cost=0.027), level=1)
    assert c.band_delta == 0.0
    assert c.within_threshold is True
    assert c.cost_ratio == round(0.027 / 0.05, 3)
    assert c.missing_candidate == []   # L1 has no optional-required sections


def test_compare_band_disagreement_flagged():
    c = compare_gradings("e2", _result(7.0), _result(6.0), level=1)
    assert c.band_delta == 1.0
    assert c.within_threshold is False


def test_compare_half_band_is_within():
    c = compare_gradings("e3", _result(7.0), _result(6.5), level=1)
    assert c.band_delta == 0.5
    assert c.within_threshold is True   # boundary inclusive


def test_compare_criteria_delta():
    c = compare_gradings("e4", _result(6.5, crit=7), _result(6.5, crit=5), level=1)
    assert c.criteria_delta["mainCriterion"] == 2


def test_compare_cost_ratio_none_when_baseline_missing():
    c = compare_gradings("e5", _result(6.5, cost=None), _result(6.5, cost=0.02), level=1)
    assert c.cost_ratio is None


# ── aggregate ─────────────────────────────────────────────────────────


def test_aggregate_empty():
    assert aggregate([]) == {"n": 0}


def test_aggregate_pct_and_savings():
    comps = [
        compare_gradings("a", _result(6.5, cost=0.10, latency=2000), _result(6.5, cost=0.05, latency=800), level=1),
        compare_gradings("b", _result(7.0, cost=0.10, latency=2000), _result(6.0, cost=0.05, latency=800), level=1),  # disagree
    ]
    s = aggregate(comps)
    assert s["n"] == 2
    assert s["pct_within_half_band"] == 50.0
    assert s["mean_cost_baseline"] == 0.10
    assert s["mean_cost_candidate"] == 0.05
    assert s["cost_savings_pct"] == 50.0
    assert s["max_abs_band_delta"] == 1.0


# ── format_report ─────────────────────────────────────────────────────


def test_format_report_empty():
    assert "0 essays" in format_report([], {"n": 0}, "b", "c")


def test_format_report_contains_gate_and_rows():
    comps = [compare_gradings("e1", _result(6.5), _result(6.5), level=1)]
    out = format_report(comps, aggregate(comps), "gemini-2.5-pro", "gemini-3.5-flash")
    assert "gemini-3.5-flash vs gemini-2.5-pro" in out
    assert "≥95%" in out          # gate target shown
    assert "| e1 |" in out        # per-essay row
