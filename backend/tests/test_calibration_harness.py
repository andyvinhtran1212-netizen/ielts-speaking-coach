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
from unittest.mock import MagicMock, patch

from scripts.calibration_harness import (
    aggregate,
    compare_gradings,
    fetch_essays_from_db,
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
    assert s["n_cost_pairs"] == 2


def test_aggregate_savings_only_over_matched_cost_pairs():
    """If a candidate cost is missing for some essays, savings must be computed
    over MATCHED pairs only — not by summing each side independently (which
    would compare different essay sets and fake the number)."""
    comps = [
        # matched pair: baseline 0.10, candidate 0.05 → 50% on this pair
        compare_gradings("a", _result(6.5, cost=0.10), _result(6.5, cost=0.05), level=1),
        # candidate cost unknown — must be EXCLUDED from cost stats entirely
        compare_gradings("b", _result(6.5, cost=0.10), _result(6.5, cost=None), level=1),
    ]
    s = aggregate(comps)
    assert s["n"] == 2
    assert s["n_cost_pairs"] == 1                 # only essay "a" has both costs
    assert s["mean_cost_baseline"] == 0.10        # over the matched pair, not both
    assert s["mean_cost_candidate"] == 0.05
    assert s["cost_savings_pct"] == 50.0          # not skewed by the unmatched essay


# ── format_report ─────────────────────────────────────────────────────


def test_format_report_empty():
    assert "0 essays" in format_report([], {"n": 0}, "b", "c")


def test_format_report_contains_gate_and_rows():
    comps = [compare_gradings("e1", _result(6.5), _result(6.5), level=1)]
    out = format_report(comps, aggregate(comps), "gemini-2.5-pro", "gemini-3.5-flash")
    assert "gemini-3.5-flash vs gemini-2.5-pro" in out
    assert "≥95%" in out          # gate target shown
    assert "| e1 |" in out        # per-essay row


# ── fetch_essays_from_db (mocked DB — no real IO) ─────────────────────


def test_fetch_essays_from_db_maps_and_filters():
    """Maps writing_essays rows to the harness essay shape and drops rows
    missing prompt/essay text (a partial row must not crash the run)."""
    rows = [
        {"id": "u1", "task_type": "task2", "prompt_text": "P", "essay_text": "E"},
        {"id": "u2", "task_type": "task2", "prompt_text": "P", "essay_text": ""},   # empty → dropped
        {"id": "u3", "task_type": "task1_academic", "prompt_text": "P2", "essay_text": "E2",
         "prompt_image_url": "https://x/chart.png"},
    ]
    chain = MagicMock()
    chain.select.return_value = chain
    chain.not_.is_.return_value = chain
    chain.order.return_value = chain
    chain.limit.return_value = chain
    chain.execute.return_value = MagicMock(data=rows)
    fake_admin = MagicMock()
    fake_admin.table.return_value = chain

    with patch("database.supabase_admin", fake_admin):
        essays = fetch_essays_from_db(10)

    assert [e["id"] for e in essays] == ["u1", "u3"]   # u2 dropped (no text)
    # prompt_image_url preserved (None when absent, the URL when present) so
    # Task 1 chart essays grade multimodally like production.
    assert essays[0]["prompt_image_url"] is None
    assert essays[1]["prompt_image_url"] == "https://x/chart.png"
