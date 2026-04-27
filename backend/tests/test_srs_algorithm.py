"""
Tests for the SRS (spaced-repetition) algorithm in services/srs.py.

Pure unit tests — no DB, no auth, no network.  Inputs are deterministic so
the assertions in this file are the contract: any change to update_srs()
that breaks them must be a deliberate algorithm decision, not a drive-by.

Filled in step 2 of Phase D Wave 2 once services/srs.py exists.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


# Filled by step 2 — the import lives inside each test so the skeleton runs
# clean (collected but skipped) before services/srs.py is created.
def _import_update_srs():
    try:
        from services.srs import update_srs  # type: ignore
        return update_srs
    except Exception:
        pytest.skip("services.srs.update_srs not yet implemented (step 2)")


class _Review:
    """Minimal stand-in for a review row passed into update_srs()."""

    def __init__(self, ease_factor=2.5, interval_days=1, review_count=0, lapse_count=0):
        self.ease_factor = ease_factor
        self.interval_days = interval_days
        self.review_count = review_count
        self.lapse_count = lapse_count


# ── Floor / cap on ease_factor ───────────────────────────────────────────────


def test_again_decreases_ease_factor_floor_1_3():
    update_srs = _import_update_srs()
    r = _Review(ease_factor=1.5)
    for _ in range(20):
        out = update_srs(r, "again")
        r = _Review(
            ease_factor=out["ease_factor"],
            interval_days=out["interval_days"],
            review_count=out["review_count"],
            lapse_count=out["lapse_count"],
        )
    assert r.ease_factor >= 1.3 - 1e-6
    assert r.ease_factor <= 1.3 + 1e-6


def test_easy_increases_ease_factor_cap_3_0():
    update_srs = _import_update_srs()
    r = _Review(ease_factor=2.5)
    for _ in range(20):
        out = update_srs(r, "easy")
        r = _Review(
            ease_factor=out["ease_factor"],
            interval_days=out["interval_days"],
            review_count=out["review_count"],
            lapse_count=out["lapse_count"],
        )
    assert r.ease_factor <= 3.0 + 1e-6
    assert r.ease_factor >= 3.0 - 1e-6


# ── next_review_at correctness ───────────────────────────────────────────────


def test_next_review_at_calculation_utc():
    """next_review_at must equal now (UTC) + interval_days, ISO-formatted."""
    from datetime import datetime, timezone

    update_srs = _import_update_srs()
    r = _Review(ease_factor=2.5, interval_days=2)
    before = datetime.now(timezone.utc)
    out = update_srs(r, "good")
    after = datetime.now(timezone.utc)

    next_dt = datetime.fromisoformat(out["next_review_at"])
    last_dt = datetime.fromisoformat(out["last_reviewed_at"])

    assert next_dt.tzinfo is not None, "next_review_at must be timezone-aware (UTC)"
    assert last_dt.tzinfo is not None, "last_reviewed_at must be timezone-aware (UTC)"
    delta_days = (next_dt - last_dt).total_seconds() / 86400.0
    assert abs(delta_days - out["interval_days"]) < 1e-6
    assert before <= last_dt <= after


# ── 'again' resets schedule ──────────────────────────────────────────────────


def test_again_resets_interval_to_zero():
    update_srs = _import_update_srs()
    r = _Review(ease_factor=2.5, interval_days=10)
    out = update_srs(r, "again")
    assert out["interval_days"] == 0
    assert out["lapse_count"] == 1


# ── 'good' multiplies by ease factor ────────────────────────────────────────


def test_good_uses_ease_factor():
    update_srs = _import_update_srs()
    r = _Review(ease_factor=2.5, interval_days=4)
    out = update_srs(r, "good")
    # 4 * 2.5 = 10
    assert out["interval_days"] == 10


# ── Invalid rating ───────────────────────────────────────────────────────────


def test_invalid_rating_raises():
    update_srs = _import_update_srs()
    r = _Review()
    with pytest.raises(ValueError):
        update_srs(r, "perfect")


# ── Sequential deterministic walk ────────────────────────────────────────────


def test_sequential_review_walk_is_deterministic():
    """
    again → hard → good → good → easy starting from defaults.
    Locks down the deterministic interval progression so a future tweak
    can't silently change every user's schedule.
    """
    update_srs = _import_update_srs()
    r = _Review(ease_factor=2.5, interval_days=1)

    out = update_srs(r, "again")
    assert out["interval_days"] == 0
    assert abs(out["ease_factor"] - 2.3) < 1e-6
    r = _Review(**{k: out[k] for k in ("ease_factor", "interval_days", "review_count", "lapse_count")})

    out = update_srs(r, "hard")
    # max(1, int(0 * 1.2)) == 1
    assert out["interval_days"] == 1
    assert abs(out["ease_factor"] - 2.15) < 1e-6
    r = _Review(**{k: out[k] for k in ("ease_factor", "interval_days", "review_count", "lapse_count")})

    out = update_srs(r, "good")
    # int(1 * 2.15) == 2
    assert out["interval_days"] == 2
    assert abs(out["ease_factor"] - 2.15) < 1e-6
    r = _Review(**{k: out[k] for k in ("ease_factor", "interval_days", "review_count", "lapse_count")})

    out = update_srs(r, "good")
    # int(2 * 2.15) == 4
    assert out["interval_days"] == 4
    r = _Review(**{k: out[k] for k in ("ease_factor", "interval_days", "review_count", "lapse_count")})

    out = update_srs(r, "easy")
    # int(4 * 2.15 * 1.3) == int(11.18) == 11
    assert out["interval_days"] == 11
    # ease_factor capped or bumped by 0.15 (still under 3.0): 2.15 + 0.15 = 2.30
    assert abs(out["ease_factor"] - 2.30) < 1e-6
    assert out["review_count"] == 5
    assert out["lapse_count"] == 1
