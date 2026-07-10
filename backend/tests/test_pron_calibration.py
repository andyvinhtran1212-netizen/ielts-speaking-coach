"""Unit tests for services/pron_calibration — the #2 pluggable P mapping."""

import pytest

from services import pron_calibration as pc


# ── PARITY: table=None must reproduce the old inline _pron_band_from_scores ────

def _old_formula(pron, fluency):
    """Verbatim copy of the historical grading.py _pron_band_from_scores body."""
    if pron is None:
        return None
    band = 1.0 + (float(pron) / 100.0) * 8.0
    if fluency is not None:
        band = 0.5 * band + 0.5 * (1.0 + (float(fluency) / 100.0) * 8.0)
    return float(max(1, min(9, int(band + 0.5))))


@pytest.mark.parametrize("pron,fluency", [
    (None, None), (0, None), (50, None), (80, None), (100, None),
    (80, 90), (85, 70), (95, 92), (40, 60), (100, 100), (10, None), (55, 55),
])
def test_default_matches_old_formula(pron, fluency):
    assert pc.pron_band(pron, fluency, table=None) == _old_formula(pron, fluency)


def test_none_pron_is_none():
    assert pc.pron_band(None, 90) is None


def test_band_clamped_1_to_9():
    assert pc.pron_band(0, 0) == 1.0
    assert pc.pron_band(100, 100) == 9.0


# ── isotonic fit ──────────────────────────────────────────────────────────────

def test_fit_isotonic_already_monotonic_unchanged():
    tbl = pc.fit_isotonic([(60, 4.0), (75, 6.0), (90, 8.0)])
    assert tbl == [(60, 4.0), (75, 6.0), (90, 8.0)]


def test_fit_isotonic_pools_violators():
    # 7 then 6 at increasing score violates monotonicity → pooled to 6.5
    tbl = pc.fit_isotonic([(80, 7.0), (85, 6.0), (90, 8.0)])
    assert tbl == [(80, 6.5), (85, 6.5), (90, 8.0)]


def test_fit_isotonic_output_is_nondecreasing():
    tbl = pc.fit_isotonic([(50, 5), (55, 4), (60, 7), (65, 6), (70, 9)])
    ys = [y for _, y in tbl]
    assert all(a <= b + 1e-9 for a, b in zip(ys, ys[1:]))


def test_fit_isotonic_empty():
    assert pc.fit_isotonic([]) == []


# ── interpolation ─────────────────────────────────────────────────────────────

def test_interp_midpoint():
    assert pc.interp([(80, 6.5), (90, 8.0)], 85) == pytest.approx(7.25)


def test_interp_clamps_at_ends():
    tbl = [(80, 6.5), (90, 8.0)]
    assert pc.interp(tbl, 70) == 6.5   # below first breakpoint
    assert pc.interp(tbl, 95) == 8.0   # above last breakpoint


def test_interp_empty_table_falls_back_to_linear():
    # empty table → historical linear (1 + s/100*8)
    assert pc.interp([], 50) == pytest.approx(5.0)


# ── calibrated mapping through a table ────────────────────────────────────────

def test_pron_band_with_table():
    tbl = [(80, 6.0), (90, 8.0)]
    # pron 85 → interp 7.0; no fluency → half-up int(7.5)=7
    assert pc.pron_band(85, None, table=tbl) == 7.0


def test_table_compresses_top_vs_linear():
    # a realistic table where 100 maps to band 8 (native ceiling), unlike linear's 9
    tbl = pc.fit_isotonic([(70, 6), (85, 7), (95, 8), (100, 8)])
    assert pc.pron_band(100, None, table=tbl) == 8.0
    assert pc.pron_band(100, None, table=None) == 9.0  # linear over-reaches
