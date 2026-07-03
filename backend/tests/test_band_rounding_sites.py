"""Audit round-2 C2 — pin the band-rounding SITES so they can't silently drift
back to banker's rounding.

The round-1 audit found _round_band used banker's rounding; the round-2 audit
found 4 MORE independent sites with the same bug. The reason L1 survived so long
was that no test pinned the site-level semantics — only the ielts_round helper
(test_band_rounding.py). This file locks each site to half-up.
"""
import pytest

from services.band_rounding import ielts_round
from services.pdf_generator import _round_half
from routers.grading import _round_band, _pron_band_from_scores


@pytest.mark.parametrize("raw, expected", [
    (6.25, 6.5),   # the boundary banker's rounding gets wrong (was 6.0)
    (7.25, 7.5),
    (8.25, 8.5),
    (6.0, 6.0),
    (6.5, 6.5),
])
def test_pdf_round_half_is_half_up(raw, expected):
    # PDF export must match the web (Sprint 16.1 parity) — was banker's.
    assert _round_half(raw) == expected


@pytest.mark.parametrize("raw, expected", [
    (6.25, 6.5),
    (7.25, 7.5),
    (8.25, 8.5),
])
def test_grading_round_band_is_half_up(raw, expected):
    # grading.py response-level band (round-1 L1) — pin so it can't regress.
    assert _round_band(raw) == expected


@pytest.mark.parametrize("pron, expected", [
    # Azure 0–100 → WHOLE integer band. band = 1 + pron/100*8.
    # pron=68.75 → band 6.5 → half-up → 7 (banker's round(6.5) gave 6).
    (68.75, 7.0),
    # pron=81.25 → band 7.5 → 8 (banker's already gave 8; symmetry check).
    (81.25, 8.0),
    (100.0, 9.0),
    (0.0, 1.0),
])
def test_pron_whole_band_is_half_up(pron, expected):
    assert _pron_band_from_scores(pron, None) == expected
