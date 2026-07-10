"""Unit tests for backend/eval/metrics.py — pure math, no IO."""

import math

import pytest

from eval import metrics


# ── mae ──────────────────────────────────────────────────────────────────────

def test_mae_basic():
    # errors: 0.5, 0.0, 1.0 → mean 0.5
    assert metrics.mae([(6.5, 6.0), (7.0, 7.0), (5.0, 6.0)]) == pytest.approx(0.5)


def test_mae_empty_is_none():
    assert metrics.mae([]) is None


def test_mae_skips_none_sides():
    # the (None, 6.0) and (7.0, None) pairs are dropped; only (6.5, 6.0) counts
    assert metrics.mae([(None, 6.0), (7.0, None), (6.5, 6.0)]) == pytest.approx(0.5)


# ── bias (signed) ────────────────────────────────────────────────────────────

def test_bias_generous_is_positive():
    # grader always +0.5 over the human
    assert metrics.bias([(7.0, 6.5), (6.0, 5.5)]) == pytest.approx(0.5)


def test_bias_harsh_is_negative():
    assert metrics.bias([(6.0, 6.5), (5.5, 6.0)]) == pytest.approx(-0.5)


def test_bias_cancels_where_mae_does_not():
    # +1 and -1 → bias 0 but MAE 1.0 (bias hides symmetric error; MAE catches it)
    pairs = [(7.0, 6.0), (5.0, 6.0)]
    assert metrics.bias(pairs) == pytest.approx(0.0)
    assert metrics.mae(pairs) == pytest.approx(1.0)


# ── within_half_band ─────────────────────────────────────────────────────────

def test_within_half_band_inclusive_at_exactly_half():
    # exactly 0.5 off counts as agreement
    assert metrics.within_half_band([(6.5, 7.0), (6.0, 8.0)]) == pytest.approx(0.5)


def test_within_half_band_all_agree():
    assert metrics.within_half_band([(6.0, 6.0), (7.0, 6.5)]) == pytest.approx(1.0)


# ── quadratic_weighted_kappa ─────────────────────────────────────────────────

def test_qwk_perfect_agreement():
    assert metrics.quadratic_weighted_kappa(
        [(6.0, 6.0), (7.0, 7.0), (5.5, 5.5), (8.0, 8.0)]
    ) == pytest.approx(1.0)


def test_qwk_penalises_large_errors_more_than_small():
    # Same MAE-ish disagreement, but big swings tank kappa harder than half-band
    small = [(6.0, 6.5), (7.0, 6.5), (6.5, 6.0), (7.0, 7.5), (6.0, 5.5)]
    big = [(4.0, 8.0), (8.0, 4.0), (6.5, 6.0), (7.0, 7.5), (6.0, 5.5)]
    k_small = metrics.quadratic_weighted_kappa(small)
    k_big = metrics.quadratic_weighted_kappa(big)
    assert k_small > k_big


def test_qwk_degenerate_all_identical_and_matching_is_one():
    assert metrics.quadratic_weighted_kappa([(6.0, 6.0), (6.0, 6.0)]) == pytest.approx(1.0)


def test_qwk_empty_is_none():
    assert metrics.quadratic_weighted_kappa([]) is None


def test_qwk_in_valid_range():
    k = metrics.quadratic_weighted_kappa([(6.0, 6.5), (7.0, 6.5), (5.0, 6.0), (8.0, 7.0)])
    assert -1.0 - 1e-9 <= k <= 1.0 + 1e-9


# ── boundary_confusion (6/7 line) ────────────────────────────────────────────

def test_boundary_false_high_and_low():
    pairs = [
        (7.0, 6.0),  # grader promotes across 6.5 → false_high
        (6.0, 7.5),  # grader under-marks across 6.5 → false_low
        (7.0, 7.0),  # both above → no cross
        (6.0, 6.0),  # both below → no cross
    ]
    res = metrics.boundary_confusion(pairs, boundary=6.5)
    assert res["false_high"] == 1
    assert res["false_low"] == 1
    assert res["total"] == 4
    assert res["false_cross_rate"] == pytest.approx(0.5)


def test_boundary_exactly_on_line_counts_as_high():
    # band == boundary is treated as "≥ boundary" (the 7 side)
    res = metrics.boundary_confusion([(6.5, 6.0)], boundary=6.5)
    assert res["false_high"] == 1


def test_boundary_empty():
    res = metrics.boundary_confusion([], boundary=6.5)
    assert res["total"] == 0
    assert res["false_cross_rate"] is None


# ── summarize ────────────────────────────────────────────────────────────────

def test_summarize_bundles_all_metrics():
    s = metrics.summarize([(6.5, 6.0), (7.0, 7.0), (5.0, 6.0)])
    assert s["n"] == 3
    assert s["mae"] == pytest.approx(0.5)
    assert "qwk" in s and "bias" in s and "within_half_band" in s
    assert s["boundary"]["total"] == 3


def test_summarize_empty():
    s = metrics.summarize([])
    assert s["n"] == 0
    assert s["mae"] is None
    assert s["qwk"] is None
