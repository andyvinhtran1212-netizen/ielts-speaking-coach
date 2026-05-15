"""Sprint 10.2 — pin the derive_mastery_status contract.

The function is the single derivation rule shared by the bank GET
endpoint, the `Mark as known` PATCH handler, and the
`backfill_mastery` script. Any drift here cascades into all three
surfaces — so the unit-test surface is the cheapest place to catch
boundary errors. Andy Q1 lock (2026-05-15):

    mastered := interval_days >= 21
            AND lapse_count   == 0
            AND review_count  >= 3

Cases below pin each clause independently so a regression on one
clause doesn't get masked by another clause's pass.
"""

from __future__ import annotations

from services.mastery import (
    MASTERED_MAX_LAPSE_COUNT,
    MASTERED_MIN_INTERVAL_DAYS,
    MASTERED_MIN_REVIEW_COUNT,
    derive_mastery_status,
)


def _srs(
    *,
    interval_days: int = 0,
    lapse_count: int = 0,
    review_count: int = 0,
    ease_factor: float = 2.5,
) -> dict:
    """Build a minimal SRS-row dict for tests. Extra fields the real
    table carries (timestamps, id, user_id) are irrelevant to the
    derivation contract — the function only reads the three counters."""
    return {
        "interval_days": interval_days,
        "lapse_count": lapse_count,
        "review_count": review_count,
        "ease_factor": ease_factor,
    }


def test_no_srs_row_defaults_to_learning():
    """A vocab item with no review history → 'learning'. This is the
    most common case at capture time (vocab row exists, no
    flashcard_reviews row yet)."""
    assert derive_mastery_status(None) == "learning"


def test_below_interval_threshold_is_learning():
    """interval_days=20 (one short of the threshold) must be learning
    even when the other two clauses pass. Pins the off-by-one."""
    assert (
        derive_mastery_status(
            _srs(interval_days=20, lapse_count=0, review_count=3),
        )
        == "learning"
    )


def test_exact_interval_threshold_is_mastered():
    """interval_days=21 (exact threshold, ≥) must qualify."""
    assert (
        derive_mastery_status(
            _srs(interval_days=21, lapse_count=0, review_count=3),
        )
        == "mastered"
    )


def test_any_lapse_disqualifies():
    """A single lapse demotes the item even with a long interval and
    many reviews. This is the whole point of unification — pre-10.2
    a card could be 'mastered' in the column AND have lapse_count=5
    in SRS. After 10.2, that's impossible at read time."""
    assert (
        derive_mastery_status(
            _srs(interval_days=100, lapse_count=1, review_count=10),
        )
        == "learning"
    )


def test_low_review_count_is_learning():
    """review_count=2 (one short of 3) must be learning. Prevents a
    lucky-guess SM-2 jump from declaring early mastery."""
    assert (
        derive_mastery_status(
            _srs(interval_days=30, lapse_count=0, review_count=2),
        )
        == "learning"
    )


def test_exact_review_count_threshold_is_mastered():
    assert (
        derive_mastery_status(
            _srs(interval_days=30, lapse_count=0, review_count=3),
        )
        == "mastered"
    )


def test_malformed_srs_row_treats_missing_fields_as_zero():
    """Defensive — a row missing one of the counters (shouldn't happen
    in prod, but a future SRS schema change could) must default to
    learning, not crash."""
    assert derive_mastery_status({}) == "learning"
    # Explicit None for any single counter must also be safe.
    assert (
        derive_mastery_status(
            {"interval_days": None, "lapse_count": 0, "review_count": 5},
        )
        == "learning"
    )


def test_threshold_constants_exposed_for_callers():
    """Pin that the constants are reachable — the PATCH handler uses
    them to construct the SRS upsert (interval_days=21 etc), so a
    rename here without updating the handler would silently break the
    Mark as known flow. This test would catch the import error
    upfront."""
    assert MASTERED_MIN_INTERVAL_DAYS == 21
    assert MASTERED_MAX_LAPSE_COUNT == 0
    assert MASTERED_MIN_REVIEW_COUNT == 3
