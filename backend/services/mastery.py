"""
services/mastery.py — Mastery-SRS derivation.

Sprint 10.2 introduced the rule; Sprint 10.6 dropped the deprecated
`user_vocabulary.mastery_status` column (migration 055). The single
source of truth is now the `flashcard_reviews` row per (user_id,
vocab_id) — every read derives the mastery status on the fly via this
module; writes go to `flashcard_reviews` directly.

Why a separate module (not inlined in the router): the same rule
fires from the bank GET endpoint (per-row at read time) AND the PATCH
`Mark as known` response shape. Centralising avoids drift.

Threshold (Andy Q1 lock, 2026-05-15):

    mastered := interval_days >= 21
            AND lapse_count   == 0
            AND review_count  >= 3

Rationale: interval_days alone is fragile (a single lucky guess can
push SM-2 to a long interval after few reviews); the review_count
guard requires real engagement before "mastered" sticks, and the
lapse_count guard demotes anything the user has ever forgotten.

Edge cases:

  * `srs_state is None` → no flashcard_reviews row exists → 'learning'.
    Newly captured vocab always lands here until the first review.
  * Any required field missing or None on the SRS dict → treated as
    0 via `.get(field) or 0`. Defensive; the SRS service always
    populates the fields but we don't want a malformed row to crash
    a GET endpoint.
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


# Threshold constants — exposed for tests that pin the boundary cases.
MASTERED_MIN_INTERVAL_DAYS = 21
MASTERED_MIN_REVIEW_COUNT = 3
MASTERED_MAX_LAPSE_COUNT = 0


def derive_mastery_status(srs_state: Optional[dict]) -> str:
    """Compute mastery_status from a flashcard_reviews row.

    Args:
        srs_state: dict from `flashcard_reviews` row (or None when no
            review has happened yet for this vocab item).

    Returns:
        'mastered' iff all three thresholds are met.
        'learning' otherwise — the default for new vocab + any row
        the user has lapsed on or hasn't reviewed enough.
    """
    if srs_state is None:
        return "learning"

    interval = srs_state.get("interval_days") or 0
    lapses = srs_state.get("lapse_count") or 0
    reviews = srs_state.get("review_count") or 0

    if (
        interval >= MASTERED_MIN_INTERVAL_DAYS
        and lapses <= MASTERED_MAX_LAPSE_COUNT
        and reviews >= MASTERED_MIN_REVIEW_COUNT
    ):
        return "mastered"
    return "learning"
