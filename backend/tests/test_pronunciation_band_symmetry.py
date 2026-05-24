"""
Sprint 14.6.5 — pronunciation band adjustment is SYMMETRIC.

Andy's production session aacf39f6 showed a per-question card band of 5.5
(raw holistic AI grade) alongside a session overall of 6.0 (pronunciation-
adjusted). The decision to display the adjusted 6.0 everywhere (Sprint 14.6.5
Option 1) rests on one property: the pronunciation delta is *two-directional* —
good pronunciation raises the band, poor pronunciation lowers it. If it were an
up-only boost it would be unfair inflation and we'd show the raw 5.5 instead.

These tests pin that property at the source, plus the round-half-up convention
the band aggregation depends on. They are pure-function tests — no Supabase.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import pronunciation as pron


# ── round-half-up to nearest 0.5 (Sprint 14.6.5 L6) ────────────────────────────

def test_round_band_half_up_to_nearest_half():
    assert pron._round_band(5.25) == 5.5   # half rounds UP
    assert pron._round_band(5.75) == 6.0   # half rounds UP
    assert pron._round_band(5.5) == 5.5    # exact stays
    assert pron._round_band(5.74) == 5.5   # below midpoint rounds down
    assert pron._round_band(5.76) == 6.0   # above midpoint rounds up


def test_round_band_clamps_to_ielts_range():
    assert pron._round_band(0.0) == 1.0
    assert pron._round_band(12.0) == 9.0


# ── _compute_adjusted_band_p is symmetric (the basis for Option 1) ─────────────

def test_adjusted_band_p_boosts_up_for_strong_pronunciation():
    # Azure 90/100 ≈ band 8.2; well above a 5.0 raw P grade → adjust UP.
    adjusted = pron._compute_adjusted_band_p(5.0, 90.0, 90.0, "high")
    assert adjusted > 5.0


def test_adjusted_band_p_pulls_down_for_weak_pronunciation():
    # Azure 30/100 ≈ band 3.4; well below a 6.0 raw P grade → adjust DOWN.
    # This is the proof of symmetry: a weak score must NOT be a no-op.
    adjusted = pron._compute_adjusted_band_p(6.0, 30.0, 30.0, "high")
    assert adjusted < 6.0


def test_adjusted_band_p_clamp_grows_with_reliability():
    # Same large positive delta; the cap is ±0.5 (low) | ±0.75 (med) | ±1.0 (high).
    low  = pron._compute_adjusted_band_p(5.0, 100.0, 100.0, "low")
    high = pron._compute_adjusted_band_p(5.0, 100.0, 100.0, "high")
    assert (low - 5.0) <= 0.5 + 1e-9
    assert (high - 5.0) > (low - 5.0)   # higher reliability trusts the signal more


# ── _compute_final_overall_band = average of 4 criteria, rounded ───────────────

def test_final_overall_band_is_rounded_average_of_four():
    assert pron._compute_final_overall_band(6.0, 6.0, 6.0, 6.0) == 6.0
    assert pron._compute_final_overall_band(5.0, 5.0, 5.0, 6.0) == 5.5   # 5.25 → 5.5
    assert pron._compute_final_overall_band(6.0, 6.0, 6.0, 5.0) == 6.0   # 5.75 → 6.0


def test_andy_case_strong_pron_lifts_practice_overall_to_six():
    """Sprint 14.6.5 — session aacf39f6: holistic 5.5 + strong pronunciation.

    Mirrors the practice-mode tweak (pronunciation.py): P≈25% weight, 40%
    dampening, clamped by reliability. A clearly-strong pronunciation pushes
    a 5.5 holistic band up to 6.0 after round-half-up — which is why the card
    should display 6.0 (Option 1), not the raw 5.5.
    """
    overall_orig = 5.5
    pron_band_equiv = 1.0 + (90.0 / 100.0) * 8.0          # ≈ 8.2
    delta = (pron_band_equiv - overall_orig) * 0.25 * 0.4  # practice net effect
    max_delta = 0.5                                        # high reliability
    adjustment = max(-max_delta, min(max_delta, delta))
    final = pron._round_band(overall_orig + adjustment)
    assert final == 6.0
