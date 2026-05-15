"""Sprint 10.2 — backfill user_vocabulary.mastery_status from SRS state.

The column is DEPRECATED as of Sprint 10.2 (drop scheduled Sprint
10.6) but kept physically present during the deprecation window so
admin tools and direct Supabase Table Editor reads don't see stale
data. The bank GET endpoint already derives from flashcard_reviews
on-the-fly; this script keeps the column in sync so external readers
agree with what the API returns.

Idempotent: re-running after a clean sweep reports `updated=0`.

Run after migration 050 lands:

    cd backend && python -m scripts.backfill_mastery

Failure modes:

  * Supabase update fails on a single row → ERROR log; main loop
    continues so one bad row doesn't poison the run. Re-run after
    fixing the DB / auth issue.
  * Empty database → "no rows to backfill" log, exit 0.

Output: summary line at the end with (processed, updated, unchanged,
errored). Exit code 0 unless the initial fetch itself fails.

Parallel pattern with `scripts/backfill_lemma.py` (Sprint 10.1) so an
operator who's seen one can read the other at a glance.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

# Allow running as `python -m scripts.backfill_mastery` from backend/
# or as a direct script — both stitch the backend root onto sys.path
# so the `database` / `services` imports resolve.
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("backfill_mastery")


def main() -> int:
    """Backfill loop. Returns process exit code."""
    from database import supabase_admin
    from services.mastery import derive_mastery_status

    logger.info("Sprint 10.2 backfill — sync user_vocabulary.mastery_status from SRS")

    # Fetch alive vocab rows. Sprint 10.2 spec keeps the filter wide —
    # the table is small (<10k rows across all users today; backfill
    # takes seconds). Future scale would warrant pagination.
    vocab_resp = (
        supabase_admin.table("user_vocabulary")
        .select("id, user_id, mastery_status")
        .eq("is_archived", False)
        .execute()
    )
    vocab_rows = vocab_resp.data or []

    if not vocab_rows:
        logger.info("no rows to backfill — user_vocabulary has 0 alive rows")
        return 0

    # Fetch all SRS state in one shot, keyed by vocabulary_id. The
    # bank list endpoint uses the same pattern (services/mastery +
    # _fetch_srs_lookup in routers/vocabulary_bank.py); we replicate
    # the lookup here against the admin client so RLS doesn't gate.
    srs_resp = (
        supabase_admin.table("flashcard_reviews")
        .select("vocabulary_id, interval_days, lapse_count, review_count")
        .execute()
    )
    srs_lookup = {row["vocabulary_id"]: row for row in (srs_resp.data or [])}

    logger.info(
        "backfill candidates: %d vocab rows, %d SRS rows",
        len(vocab_rows), len(srs_lookup),
    )

    processed = 0
    updated = 0
    unchanged = 0
    errored = 0

    for row in vocab_rows:
        processed += 1
        vocab_id = row["id"]
        current = row.get("mastery_status") or "learning"

        derived = derive_mastery_status(srs_lookup.get(vocab_id))

        if derived == current:
            unchanged += 1
            continue

        try:
            supabase_admin.table("user_vocabulary").update(
                {"mastery_status": derived}
            ).eq("id", vocab_id).execute()
            updated += 1
            logger.info(
                "[%s] mastery '%s' → '%s'", vocab_id, current, derived,
            )
        except Exception as e:
            logger.error("[%s] update failed: %s", vocab_id, e)
            errored += 1

    logger.info(
        "backfill complete — processed=%d updated=%d unchanged=%d errored=%d",
        processed, updated, unchanged, errored,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
