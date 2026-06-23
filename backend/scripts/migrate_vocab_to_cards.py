"""M3 Slice-1 — MIGRATE-IN the 20 markdown vocab words into the vocab_cards table.

Reads every backend/content_vocab/**/*.md file, parses it through the SAME
importer the admin upload uses (services.vocab_import) and upserts-by-slug. The
content body's first paragraph becomes gloss_vi (stored, not re-derived).

Idempotent: upsert-by-slug means a re-run UPDATEs the existing row in place — no
duplicates, safe to run repeatedly. Run AFTER migration 110 has been applied:

    cd backend && python -m scripts.migrate_vocab_to_cards

Failure modes:
  * supabase_admin not configured (env missing) → aborts on first upsert with the
    underlying client error. Fix the env and re-run.
  * A single file fails to parse/validate → logged + skipped (action="error"); the
    loop continues so one bad file doesn't block the rest. Re-run after fixing it.
"""

from __future__ import annotations

import logging

from services.vocab_content import CONTENT_DIR, vocab_service
from services.vocab_import import import_vocab_markdown

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("migrate_vocab")


def main() -> None:
    if not CONTENT_DIR.exists():
        logger.error("content_vocab dir not found: %s", CONTENT_DIR)
        return

    valid_categories = vocab_service._valid_categories or None
    files = sorted(CONTENT_DIR.rglob("*.md"))
    logger.info("Found %d markdown vocab files under %s", len(files), CONTENT_DIR)

    created = updated = errors = 0
    for md in files:
        text = md.read_text(encoding="utf-8")
        result = import_vocab_markdown(
            text, dry_run=False, valid_categories=valid_categories,
        )
        errs = result.get("validation_errors") or []
        if errs:
            errors += 1
            logger.warning("  ✗ %s — %s", md.name,
                           "; ".join(f"{e['field']}: {e['message']}" for e in errs))
            continue
        action = result.get("action")
        if action == "created":
            created += 1
        elif action == "updated":
            updated += 1
        logger.info("  ✓ %s (%s) — %s", md.name, result.get("committed"), action)

    logger.info("Done. created=%d updated=%d errors=%d", created, updated, errors)


if __name__ == "__main__":
    main()
