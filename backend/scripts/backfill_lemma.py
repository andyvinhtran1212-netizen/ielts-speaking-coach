"""Sprint 10.1 — backfill lemma + pos + surface_form on existing user_vocabulary rows.

Idempotent: only processes rows where `lemma IS NULL` OR `lemma_version`
is below the current `services.lemmatizer.lemma_version()`. A re-run
after a clean sweep does zero work (and prints "no rows to backfill"
so the operator can confirm).

Run after the migration 049 lands and the spaCy model is installed:

    cd backend && python -m scripts.backfill_lemma

Failure modes:

  * spaCy or en_core_web_sm not installed → script aborts on first
    `lemmatize()` call with the underlying ImportError. Fix: install
    via `python -m spacy download en_core_web_sm` and re-run.

  * Single-row lemmatize raises (e.g. spaCy tokenizer chokes on an
    edge-case unicode glyph) → row is skipped with a WARN log; the
    main loop continues so one bad row doesn't poison the run. The
    next backfill invocation will retry that row.

  * Supabase update fails → row is skipped with an ERROR log; the
    main loop continues; the operator should re-run after fixing the
    DB / auth issue.

Output: summary line at the end with (processed, updated, skipped,
errored). Exit code 0 unless the spaCy load itself fails (exit 1).
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

# Allow running as `python -m scripts.backfill_lemma` from backend/ or
# as a direct script — both stitch the backend root onto sys.path so
# the `database` / `services` imports resolve.
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

# Ensure logger output reaches stdout for Railway / local visibility.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("backfill_lemma")


def main() -> int:
    """Backfill loop. Returns process exit code."""
    from database import supabase_admin
    from services.lemmatizer import lemmatize, lemma_version

    current_version = lemma_version()
    logger.info("Sprint 10.1 backfill — current lemma_version=%d", current_version)

    # Fetch alive rows that need backfill. Sprint 10.1 spec keeps the
    # filter wide (no LIMIT) — the table is small (<10k rows across
    # all users in production today; backfill takes seconds). Future
    # scale would warrant pagination.
    rows = (
        supabase_admin.table("user_vocabulary")
        .select("id, headword, lemma, lemma_version")
        .eq("is_archived", False)
        .execute()
    )
    candidates = [
        r for r in (rows.data or [])
        if r.get("lemma") is None
        or (r.get("lemma_version") or 0) < current_version
    ]

    if not candidates:
        logger.info("no rows to backfill — all alive vocab already at lemma_version=%d", current_version)
        return 0

    logger.info("backfilling %d rows", len(candidates))

    processed = 0
    updated = 0
    skipped = 0
    errored = 0

    for row in candidates:
        processed += 1
        vocab_id = row["id"]
        headword = row.get("headword") or ""

        if not headword:
            logger.warning("[%s] empty headword — skipping", vocab_id)
            skipped += 1
            continue

        try:
            lemma, pos = lemmatize(headword)
        except Exception as e:
            logger.warning("[%s] lemmatize('%s') raised %s — skipping", vocab_id, headword, e)
            skipped += 1
            continue

        try:
            supabase_admin.table("user_vocabulary").update({
                # surface_form mirrors the verbatim headword. Use
                # COALESCE-style overwrite: even if the row already
                # has surface_form populated from a prior partial
                # backfill, re-setting it to the headword is a no-op
                # (capture pipeline always sets the two equal).
                "surface_form":  headword,
                "lemma":         lemma,
                "pos":           pos,
                "lemma_version": current_version,
            }).eq("id", vocab_id).execute()
            updated += 1
        except Exception as e:
            logger.error("[%s] update failed: %s", vocab_id, e)
            errored += 1

    logger.info(
        "backfill complete — processed=%d updated=%d skipped=%d errored=%d",
        processed, updated, skipped, errored,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
