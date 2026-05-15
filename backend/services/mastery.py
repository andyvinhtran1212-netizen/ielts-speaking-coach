"""
services/mastery.py — Sprint 10.2 Mastery-SRS derivation.

Single source of truth: `flashcard_reviews` row per (user_id, vocab_id).
The `user_vocabulary.mastery_status` column is deprecated as of Sprint
10.2 (drop scheduled Sprint 10.6) — reads should derive on the fly via
this module; writes go to `flashcard_reviews` via routers/srs callers.

Why a separate module (not inlined in the router): the same rule needs
to fire from three places — the bank GET endpoint (per-row at read
time), the PATCH `Mark as known` handler (response shape), and the
`backfill_mastery` script (to keep the deprecated column in sync for
admin reads during the deprecation window). Centralising avoids drift.

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


def sync_mastery_column(sb, vocab_id: str, srs_state: Optional[dict]) -> str:
    """Sprint 10.3 — write the derived mastery_status back to the
    deprecated user_vocabulary column. Single source for the two
    callers that need to keep the column in sync on every SRS write:

      * routers/vocabulary_bank.py PATCH /{vocab_id} ("Đã thuộc" toggle)
      * routers/exercises.py D1 attempt handler (Sprint 10.3 wire-up)

    Extracted as a helper so a future refactor of the column-sync
    contract (e.g. moving the write to a DB trigger, or adding a
    second column to keep in sync) updates one place. Pre-10.3 this
    was inlined in vocabulary_bank.py — Sprint 10.2.1-hotfix added the
    column-sync logic; Sprint 10.3 lifts it into this module.

    Args:
        sb: Supabase client. Caller chooses user-scoped (RLS-enforced
            for owner writes) or admin (for backfill paths). The
            helper doesn't care — it just runs the UPDATE.
        vocab_id: target user_vocabulary.id.
        srs_state: the flashcard_reviews row dict (whatever was just
            upserted) — or None when no SRS row exists (rare for the
            sync path, since the caller is normally writing one).

    Returns:
        The derived mastery_status string, useful for the caller's
        analytics / response shape.

    Failure mode: any Supabase exception is logged as a WARNING and
    swallowed. The SRS write is the primary contract; the column sync
    is best-effort, with scripts/backfill_mastery.py as the catch-up.
    Raising here would propagate as a 500 from the PATCH/D1 handler
    even though the canonical state (flashcard_reviews) is already
    correct — that's the wrong UX.
    """
    derived = derive_mastery_status(srs_state)
    try:
        sb.table("user_vocabulary").update(
            {"mastery_status": derived}
        ).eq("id", vocab_id).execute()
    except Exception as e:
        logger.warning(
            "[mastery] column sync failed for vocab_id=%s "
            "(SRS state authoritative; backfill_mastery will reconcile): %s",
            vocab_id, e,
        )
    return derived
