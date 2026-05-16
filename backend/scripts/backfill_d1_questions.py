"""Sprint 10.5 — backfill user_d1_questions for existing alive confirmed vocab.

Sprint 10.5 hooks new captures into the personalized D1 pipeline via a
BackgroundTask on the confirm endpoints. Existing vocab confirmed
before Sprint 10.5 won't have user_d1_questions rows — this script
walks the alive bank and generates one question per item that doesn't
already have one.

Run after migration 052 lands:

    cd backend && python -m scripts.backfill_d1_questions

Idempotent: re-running skips any vocab that already has a question row.
The UNIQUE (user_id, vocabulary_id, context_sentence) constraint also
guards against double-inserts at the DB level if two operators run the
script concurrently.

Rate limiting: pauses 100ms between AI calls to stay clear of provider
burst limits (Anthropic, Gemini). Tunable via _SLEEP_MS.

Output: summary at the end with (processed, generated, skipped_existing,
errored). Exit code 0 unless the initial fetch itself fails.

Parallel pattern with backfill_lemma.py (Sprint 10.1) and
backfill_mastery.py (Sprint 10.2) so an operator who's seen one reads
the other at a glance.
"""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path

# Allow running as `python -m scripts.backfill_d1_questions` from backend/
# or directly — same path-stitch as backfill_mastery.py.
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("backfill_d1_questions")


# Sleep between AI calls. Lift to module-level so tests can monkeypatch
# it to 0 (otherwise a 50-item backfill test takes 5+ seconds).
_SLEEP_MS = 100


def main() -> int:
    from database import supabase_admin
    from services.d1_question_generator import generate_d1_question

    logger.info("Sprint 10.5 backfill — generate D1 questions for alive confirmed vocab")

    # Step 1: fetch every alive, confirmed vocab row across all users.
    # is_pending=false filter keeps us off Sprint 10.4 staging items
    # (they get their question on confirm). is_archived=false skips
    # soft-deleted rows.
    vocab_resp = (
        supabase_admin.table("user_vocabulary")
        .select(
            "id, user_id, headword, lemma, surface_form, "
            "definition_en, definition_vi, part_of_speech, "
            "context_sentence, evidence_substring"
        )
        .eq("is_archived", False)
        .eq("is_pending", False)
        .execute()
    )
    vocab_rows = vocab_resp.data or []

    if not vocab_rows:
        logger.info("no rows to backfill — 0 alive confirmed vocab")
        return 0

    # Step 2: fetch existing question rows in one shot so the skip
    # check is O(1) per vocab.
    existing_resp = (
        supabase_admin.table("user_d1_questions")
        .select("vocabulary_id")
        .execute()
    )
    existing_ids = {
        r["vocabulary_id"] for r in (existing_resp.data or [])
        if r.get("vocabulary_id")
    }

    logger.info(
        "alive vocab=%d, already-have-question=%d → todo=%d",
        len(vocab_rows), len(existing_ids), len(vocab_rows) - len(existing_ids),
    )

    processed = 0
    generated = 0
    skipped_existing = 0
    errored = 0

    for idx, vocab_row in enumerate(vocab_rows, start=1):
        processed += 1
        vocab_id = vocab_row.get("id")

        if vocab_id in existing_ids:
            skipped_existing += 1
            continue

        question = generate_d1_question(vocab_row)
        if not question:
            errored += 1
            logger.warning(
                "[%d/%d] vocab_id=%s headword=%r — generation produced no payload",
                idx, len(vocab_rows), vocab_id, vocab_row.get("headword"),
            )
        else:
            try:
                supabase_admin.table("user_d1_questions").insert({
                    "user_id":                   vocab_row["user_id"],
                    "vocabulary_id":             vocab_row["id"],
                    "context_sentence":          question["context_sentence"],
                    "blank_position_start":      question["blank_position_start"],
                    "blank_position_end":        question["blank_position_end"],
                    "target_answer":             question["target_answer"],
                    "acceptable_variants":       question["acceptable_variants"],
                    "hint":                      question["hint"],
                    "source_evidence_substring": question.get("source_evidence_substring"),
                    "generated_by":              question["generated_by"],
                }).execute()
                generated += 1
                logger.info(
                    "[%d/%d] vocab_id=%s headword=%r — generated (%s)",
                    idx, len(vocab_rows), vocab_id,
                    vocab_row.get("headword"), question["generated_by"],
                )
            except Exception as e:
                msg = str(e).lower()
                if "duplicate" in msg or "unique" in msg:
                    # Concurrent run dropped a row in between fetch +
                    # insert. Count it as skipped, not errored.
                    skipped_existing += 1
                    logger.debug(
                        "[%d/%d] vocab_id=%s — UNIQUE hit (concurrent insert?)",
                        idx, len(vocab_rows), vocab_id,
                    )
                else:
                    errored += 1
                    logger.error(
                        "[%d/%d] vocab_id=%s — insert failed: %s",
                        idx, len(vocab_rows), vocab_id, e,
                    )

        # Progress + rate-limit pause every iteration.
        if _SLEEP_MS > 0:
            time.sleep(_SLEEP_MS / 1000.0)

        if idx % 10 == 0:
            logger.info(
                "progress: processed=%d generated=%d skipped=%d errored=%d",
                processed, generated, skipped_existing, errored,
            )

    logger.info(
        "DONE: processed=%d generated=%d skipped_existing=%d errored=%d",
        processed, generated, skipped_existing, errored,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
