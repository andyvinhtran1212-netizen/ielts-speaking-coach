"""seed_exams.py — import every backend/content/exams/*.md into the exam tables.

Idempotent: exam_service.import_exam upserts exam_tests by `code` and replaces the
test's exam_questions, so a re-run is safe. Run AFTER migration 134 is applied:

    cd backend && python -m scripts.seed_exams

Each file is parsed + validated first; a file with validation errors is logged
and skipped (the loop continues), matching migrate_vocab_to_cards.
"""
from __future__ import annotations

import logging
from pathlib import Path

from services.exam_service import import_exam

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("seed_exams")

CONTENT_DIR = Path(__file__).resolve().parents[1] / "content" / "exams"


def main() -> None:
    if not CONTENT_DIR.exists():
        logger.error("exams content dir not found: %s", CONTENT_DIR)
        return
    files = sorted(CONTENT_DIR.glob("*.md"))
    logger.info("Found %d exam file(s) under %s", len(files), CONTENT_DIR)

    ok = errors = 0
    for md in files:
        res = import_exam(md.read_text(encoding="utf-8"), dry_run=False)
        if not res.get("ok"):
            errors += 1
            msgs = "; ".join(e.get("message", "") for e in res.get("validation_errors") or [])
            logger.warning("  ✗ %s — %s", md.name, msgs)
            continue
        ok += 1
        logger.info("  ✓ %s — test_id=%s, %d question(s)", md.name,
                    res.get("test_id"), res.get("questions"))

    logger.info("Done. imported=%d errors=%d", ok, errors)


if __name__ == "__main__":
    main()
