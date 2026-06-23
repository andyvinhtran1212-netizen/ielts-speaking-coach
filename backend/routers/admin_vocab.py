"""routers/admin_vocab.py — Admin content import for the Vocabulary module
(M3 vocab content pipeline).

Ships ONE endpoint:

  POST /admin/vocabulary/import   — Markdown + YAML frontmatter import into the
                                    vocab_cards table. ONE word, or MANY words
                                    in one file (one lesson per upload).

Mirrors the reading content import (admin_reading.py `/import-bundle`) — same
multipart UploadFile + dry-run-then-commit + upsert-by-slug contract, gated by
require_admin. The importer (services/vocab_import.py) reuses the proven
content_import_service validate→upsert pattern with the vocab field set, and
splits a multi-word file into per-word blocks (each validated independently;
commit is all-or-nothing so a lesson is never half-imported).

On a real commit (dry_run=false, no validation errors) it calls
vocab_service.reload() so the new/updated words appear in the live grid WITHOUT
a server restart (acceptance gate G1). Railway's filesystem is ephemeral, so the
words live in the table — vocab_content.py serves from vocab_cards (G3 markdown
fallback for one release).

Out of scope (Slice-2): audio pregen / bucket / TTS — audio stays speechSynthesis.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, Header, Query, UploadFile

from routers.admin import require_admin
from services.vocab_content import vocab_service
from services.vocab_import import import_vocab_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/vocabulary", tags=["admin-vocabulary-content"])


@router.post("/import")
async def import_vocab_word(
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
    authorization: str | None = Header(None),
):
    """Import a vocab file of ONE-OR-MANY word blocks (frontmatter + body each).
    dry_run=true (default) parses + validates every block without touching the DB
    so the admin preview can show "thêm X / cập nhật Y / lỗi Z (block + dòng)"
    before committing. Commit is all-or-nothing: any block error → nothing writes.

    Returns {dry_run, blocks[], validation_errors[], committed_ids[], summary,
    duplicate_slugs, parsed_data, action} (the last two mirror the single block
    when the file holds exactly one word)."""
    await require_admin(authorization)

    text = (await file.read()).decode("utf-8", errors="replace")
    result = import_vocab_file(
        text,
        dry_run=dry_run,
        valid_categories=vocab_service._valid_categories or None,
    )

    # G1 — after a real commit, rebuild the in-memory index so the words are live
    # immediately (no restart). reload() re-reads vocab_cards (the source of truth).
    if result["committed_ids"] and not result["dry_run"]:
        try:
            vocab_service.reload()
        except Exception as exc:  # noqa: BLE001 — never fail the commit on a reload hiccup
            logger.error("[vocab] reload after import failed: %s", exc)

    return result
