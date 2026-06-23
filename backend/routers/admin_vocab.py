"""routers/admin_vocab.py — Admin content import for the Vocabulary module
(M3 Slice-1, vocab content pipeline).

Ships ONE endpoint:

  POST /admin/vocabulary/import   — one-word Markdown + YAML frontmatter import
                                    into the vocab_cards table.

Mirrors the reading content import (admin_reading.py `/import-bundle`) — same
multipart UploadFile + dry-run-then-commit + upsert-by-slug contract, gated by
require_admin. The importer (services/vocab_import.py) reuses the proven
content_import_service validate→upsert pattern with the vocab field set.

On a real commit (dry_run=false, no validation errors) it calls
vocab_service.reload() so the new/updated word appears in the live grid WITHOUT
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
from services.vocab_import import import_vocab_markdown

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/vocabulary", tags=["admin-vocabulary-content"])


@router.post("/import")
async def import_vocab_word(
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
    authorization: str | None = Header(None),
):
    """Import ONE vocab word's markdown (frontmatter + body). dry_run=true
    (default) parses + validates without touching the DB so the admin preview can
    confirm "thêm / cập nhật / lỗi dòng" before committing.

    Returns {parsed_data, validation_errors, dry_run, committed_ids, action}."""
    await require_admin(authorization)

    text = (await file.read()).decode("utf-8", errors="replace")
    result = import_vocab_markdown(
        text,
        dry_run=dry_run,
        valid_categories=vocab_service._valid_categories or None,
    )

    # G1 — after a real commit, rebuild the in-memory index so the word is live
    # immediately (no restart). reload() re-reads vocab_cards (the source of truth).
    committed = result.get("committed")
    if committed and not result.get("dry_run"):
        try:
            vocab_service.reload()
        except Exception as exc:  # noqa: BLE001 — never fail the commit on a reload hiccup
            logger.error("[vocab] reload after import failed: %s", exc)

    # Normalise to the shared admin-import response shape (committed_ids[]).
    return {
        "parsed_data":       result.get("parsed_data"),
        "validation_errors": result.get("validation_errors", []),
        "dry_run":           result.get("dry_run", dry_run),
        "committed_ids":     [committed] if committed else [],
        "action":            result.get("action"),
    }
