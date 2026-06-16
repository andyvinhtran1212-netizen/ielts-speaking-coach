"""test_band_rounding.py — P-1 IELTS overall-band rounding.

Pins the asymmetric round-half-up-to-0.5 rule (.25→up half, .75→up whole) and
the deterministic overall-from-criteria helper.
"""
import pytest

from services.band_rounding import ielts_round, overall_from_criteria


@pytest.mark.parametrize("raw, expected", [
    # the IELTS boundaries that "nearest 0.5" gets wrong
    (6.0, 6.0),
    (6.25, 6.5),    # .25 → up half
    (6.5, 6.5),
    (6.75, 7.0),    # .75 → up whole
    (5.75, 6.0),
    (5.25, 5.5),
    (8.75, 9.0),
    # exact half-bands unchanged
    (4.5, 4.5),
    (7.0, 7.0),
    (0.0, 0.0),
    (9.0, 9.0),
    # clamp to [0, 9]
    (9.5, 9.0),
    (-1.0, 0.0),
    # nearest-0.5 for non-quarter inputs (defensive — sub-scores are ints)
    (6.1, 6.0),
    (6.4, 6.5),
])
def test_ielts_round(raw, expected):
    assert ielts_round(raw) == expected


@pytest.mark.parametrize("crit, expected", [
    ((6, 6, 7, 6), 6.5),    # mean 6.25 → 6.5
    ((6, 7, 7, 7), 7.0),    # mean 6.75 → 7.0
    ((6, 6, 6, 6), 6.0),
    ((5, 6, 6, 6), 6.0),    # mean 5.75 → 6.0
    ((8, 9, 9, 9), 9.0),    # mean 8.75 → 9.0
    ((7, 7, 7, 7), 7.0),
])
def test_overall_from_criteria(crit, expected):
    assert overall_from_criteria(*crit) == expected
