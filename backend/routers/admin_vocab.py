"""routers/admin_vocab.py — Admin console for the Vocabulary module (M3 pipeline).

Endpoints (all require_admin; writes via supabase_admin → bypass the SELECT-public
RLS from mig 110):

  POST   /admin/vocabulary/import      — Markdown import, 1-or-many words/file.
  GET    /admin/vocabulary             — list (category filter + headword search + page).
  GET    /admin/vocabulary/{id}        — full row for the edit form.
  PATCH  /admin/vocabulary/{id}        — partial update by stable id.
  DELETE /admin/vocabulary/{id}        — hard delete one word.
  POST   /admin/vocabulary/bulk-delete — hard-delete many by ids (one reload).

Every WRITE (import commit / patch / delete / bulk-delete) calls vocab_service.reload() (G1) so
the public /vocabulary grid + article reflect it without a restart; the mig-110
BEFORE-UPDATE trigger bumps updated_at so the public cache key (G2 = MAX(updated_at))
invalidates. The importer (services/vocab_import.py) does the parse→validate→upsert.

Out of scope (V-eleven): ElevenLabs render trigger — this console only PREVIEWS
existing audio_url + shows audio_status; it never synthesizes.
"""

from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, File, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel

from database import supabase_admin
from routers.admin import require_admin
from services.vocab_content import vocab_service
from services.vocab_import import import_vocab_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/vocabulary", tags=["admin-vocabulary-content"])


def _reload_safe() -> None:
    """G1 — rebuild the in-memory grid after a write so the public /vocabulary
    grid + article reflect it without a restart. Never fail the write on a hiccup."""
    try:
        vocab_service.reload()
    except Exception as exc:  # noqa: BLE001
        logger.error("[vocab] reload after write failed: %s", exc)


class VocabUpdate(BaseModel):
    """Partial-update payload. EVERY field is a real vocab_cards column (mig 110) —
    the schema-aware col-match test pins this (#538 lesson). id/slug/created_at/
    updated_at/import_batch_id and the audio_* columns are intentionally absent
    (slug is the stable URL key; audio is owned by the pregen, V-eleven). updated_at
    auto-bumps via the BEFORE-UPDATE trigger, so the public cache key (G2) advances."""
    headword:       Optional[str]  = None
    category:       Optional[str]  = None
    level:          Optional[str]  = None
    part_of_speech: Optional[str]  = None
    pronunciation:  Optional[str]  = None
    syllables:      Optional[str]  = None   # Slice-2 orthographic specimen
    definition_en:  Optional[str]  = None
    gloss_vi:       Optional[str]  = None
    example:        Optional[str]  = None
    register:       Optional[str]  = None
    common_error:   Optional[str]  = None
    memory_hook:    Optional[str]  = None
    source:         Optional[str]  = None
    group:          Optional[str]  = None
    synonyms:       Optional[list] = None
    antonyms:       Optional[list] = None
    collocations:   Optional[list] = None
    related_words:  Optional[list] = None
    body_html:      Optional[str]  = None


class BulkDeleteRequest(BaseModel):
    """ids to hard-delete. Pydantic validates each is a UUID (bad id → 422)."""
    ids: list[UUID]


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
    # Category-runtime (Slice-A): no whitelist — the importer normalizes the
    # frontmatter category to a slug and accepts any topic; a new category
    # auto-surfaces via DISTINCT-from-DB after the reload() below.
    result = import_vocab_file(text, dry_run=dry_run)

    # G1 — after a real commit, rebuild the in-memory index so the words are live
    # immediately (no restart). reload() re-reads vocab_cards (the source of truth).
    if result["committed_ids"] and not result["dry_run"]:
        _reload_safe()

    return result


# ── CRUD console (V-admin) — mirrors admin_writing_tips ───────────────────────
# Writes use supabase_admin (bypasses RLS; mig110 RLS is SELECT-public only).
# After every write we reload() so the public grid/article reflect it (G1), and
# the BEFORE-UPDATE trigger bumps updated_at so the public cache invalidates (G2).

_LIST_COLS = (
    "id,slug,headword,category,level,part_of_speech,pronunciation,gloss_vi,"
    "audio_headword,audio_example,audio_status,updated_at"
)


@router.get("")
async def list_vocab(
    category:      Optional[str] = Query(default=None),
    q:             Optional[str] = Query(default=None, description="headword search"),
    limit:         int           = Query(default=50, ge=1, le=200),
    offset:        int           = Query(default=0, ge=0),
    authorization: str | None    = Header(None),
):
    """List words for the admin console — newest-updated first, with optional
    category filter + headword search + pagination (the table can hold >30
    topics, so we never load everything at once)."""
    await require_admin(authorization)

    query = supabase_admin.table("vocab_cards").select(_LIST_COLS, count="exact")
    if category:
        query = query.eq("category", category)
    if q:
        query = query.ilike("headword", f"%{q}%")
    res = query.order("updated_at", desc=True).range(offset, offset + limit - 1).execute()
    return {
        "words":  res.data or [],
        "total":  getattr(res, "count", None),
        "limit":  limit,
        "offset": offset,
    }


@router.get("/{vocab_id}")
async def get_vocab(vocab_id: UUID, authorization: str | None = Header(None)):
    """Full row for the edit form."""
    await require_admin(authorization)
    res = supabase_admin.table("vocab_cards").select("*").eq("id", str(vocab_id)).limit(1).execute()
    if not res.data:
        raise HTTPException(404, "Không tìm thấy từ vựng.")
    return res.data[0]


@router.patch("/{vocab_id}")
async def update_vocab(
    vocab_id: UUID,
    body:     VocabUpdate,
    authorization: str | None = Header(None),
):
    """Partial update by stable id (editing the headword does NOT move the slug —
    the article URL stays valid). Only fields present in the body are written."""
    await require_admin(authorization)

    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(400, "Không có trường nào để cập nhật.")
    try:
        res = supabase_admin.table("vocab_cards").update(patch).eq("id", str(vocab_id)).execute()
    except Exception as exc:  # noqa: BLE001
        logger.error("update_vocab failed id=%s: %s", vocab_id, exc)
        raise HTTPException(500, "Không cập nhật được từ vựng.")
    if not res.data:
        raise HTTPException(404, "Không tìm thấy từ vựng.")
    _reload_safe()   # G1 — public grid/article reflect the edit without a restart
    return res.data[0]


@router.delete("/{vocab_id}")
async def delete_vocab(vocab_id: UUID, authorization: str | None = Header(None)):
    """Hard delete one word. NOTE: a seed word that still exists in content_vocab/**
    will reappear if the migrate-in script is re-run — flagged for the operator."""
    await require_admin(authorization)
    res = supabase_admin.table("vocab_cards").delete().eq("id", str(vocab_id)).execute()
    if not res.data:
        raise HTTPException(404, "Không tìm thấy từ vựng.")
    _reload_safe()
    return {"message": "Đã xóa từ vựng", "id": str(vocab_id)}


@router.post("/bulk-delete")
async def bulk_delete_vocab(body: BulkDeleteRequest, authorization: str | None = Header(None)):
    """Hard-delete many words by id in ONE query → ONE reload (G1). Returns the
    deleted count + any ids that weren't found (idempotent-ish; never 500s on a
    stale id). The FE shows the selected words + a counted confirm before calling,
    so this is a by-ids delete, never a blind delete-by-category."""
    await require_admin(authorization)
    ids = [str(i) for i in body.ids]
    if not ids:
        raise HTTPException(400, "Không có từ nào để xóa.")
    res = supabase_admin.table("vocab_cards").delete().in_("id", ids).execute()
    deleted = res.data or []
    deleted_ids = {str(r.get("id")) for r in deleted}
    not_found = [i for i in ids if i not in deleted_ids]
    _reload_safe()                       # G1 — public grid/article reflect the removals
    return {"deleted_count": len(deleted_ids), "not_found": not_found}
