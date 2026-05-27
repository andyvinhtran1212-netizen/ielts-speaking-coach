"""routers/admin_writing_tips.py — Admin CRUD for the writing tips
library (Sprint 19.1B).

Endpoints (all admin-only — `await require_admin(authorization)` at the
top of every handler, matching routers/admin_writing_prompts.py):

  GET    /admin/writing/tips            — list (filterable, incl. drafts)
  POST   /admin/writing/tips            — create (auto-slug)
  GET    /admin/writing/tips/{id}       — single
  PATCH  /admin/writing/tips/{id}       — partial update
  DELETE /admin/writing/tips/{id}       — hard delete

Storage: `writing_tips` table (migration 082). The student-facing reads
(`GET /api/writing/tips[/{slug}]`, published-only) live in
routers/writing_student.py — admin writes here, students read there,
matching the existing admin_writing_prompts.py / writing_student.py split.

Slug: auto-generated from the title (Vietnamese-diacritic-aware, no
external dep) when the caller omits it; admin may override. UNIQUE in the
DB — a collision surfaces as 409 (no auto-resolution, per Sprint 19.1B
scope).
"""

from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, File, Header, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.admin import require_admin
from services.content_import_service import (
    FrontmatterError,
    build_db_payload,
    parse_markdown_with_frontmatter,
    slugify,
    validate_content,
)

logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/admin/writing/tips",
    tags=["admin-writing-tips"],
)

# Sprint 19.1C — second router for the import pipeline. Distinct prefix
# (/admin/writing/content) because the endpoint isn't tip-scoped; mounted
# alongside `router` in main.py.
content_router = APIRouter(
    prefix="/admin/writing/content",
    tags=["admin-writing-content"],
)


_TASK_TYPE_PATTERN = r"^(task_1|task_2|both)$"

# Canonical slugify lives in the import service (Sprint 19.1C de-dup); the
# alias keeps this module's existing create/update call sites unchanged.
_slugify = slugify


def _is_unique_violation(exc: Exception) -> bool:
    """Best-effort detection of a Postgres UNIQUE violation surfaced
    through supabase-py (it raises a generic APIError carrying the
    Postgres code 23505 / 'duplicate key' in its message)."""
    msg = str(exc).lower()
    return "23505" in msg or "duplicate key" in msg or "unique" in msg


# ── Request bodies ────────────────────────────────────────────────────


class TipCreate(BaseModel):
    title:         str           = Field(..., min_length=2, max_length=200)
    body_markdown: str           = Field(..., min_length=1, max_length=50_000)
    task_type:     str           = Field(..., pattern=_TASK_TYPE_PATTERN)
    category:      Optional[str] = Field(None, max_length=80)
    slug:          Optional[str] = Field(None, max_length=200)
    published:     bool          = False
    display_order: int           = Field(0, ge=0, le=100_000)


class TipUpdate(BaseModel):
    """Every field optional — only provided fields are PATCHed. `published`
    and `display_order` are explicitly nullable-aware in the handler so
    `False` / `0` aren't dropped as 'unset'."""
    title:         Optional[str]  = Field(None, min_length=2, max_length=200)
    body_markdown: Optional[str]  = Field(None, min_length=1, max_length=50_000)
    task_type:     Optional[str]  = Field(None, pattern=_TASK_TYPE_PATTERN)
    category:      Optional[str]  = Field(None, max_length=80)
    slug:          Optional[str]  = Field(None, max_length=200)
    published:     Optional[bool] = None
    display_order: Optional[int]  = Field(None, ge=0, le=100_000)


# ── Endpoints ─────────────────────────────────────────────────────────


@router.get("")
async def list_tips(
    task_type:     Optional[str]  = Query(default=None, pattern=_TASK_TYPE_PATTERN),
    published:     Optional[bool] = Query(default=None),
    limit:         int            = Query(default=300, ge=1, le=500),
    authorization: str | None     = Header(None),
):
    """List tips for the admin UI — both drafts and published, newest
    first within display_order. Optional task_type / published filters."""
    await require_admin(authorization)

    q = (
        supabase_admin.table("writing_tips")
        .select("*")
        .order("display_order")
        .order("created_at", desc=True)
        .limit(limit)
    )
    if task_type:
        q = q.eq("task_type", task_type)
    if published is not None:
        q = q.eq("published", published)

    r = q.execute()
    return {"tips": r.data or []}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_tip(
    body: TipCreate,
    authorization: str | None = Header(None),
):
    """Create a tip. `slug` auto-generates from the title when omitted;
    `created_by` is stamped to the calling admin. A slug collision
    returns 409 so the admin can pick a different slug."""
    admin = await require_admin(authorization)

    payload = body.model_dump()
    payload["slug"] = (payload.get("slug") or "").strip() or _slugify(body.title)
    payload["created_by"] = admin["id"]

    try:
        r = supabase_admin.table("writing_tips").insert(payload).execute()
    except Exception as exc:
        if _is_unique_violation(exc):
            raise HTTPException(
                409,
                f"Slug '{payload['slug']}' đã tồn tại. Vui lòng đổi slug.",
            )
        logger.error("create_tip insert failed: %s", exc)
        raise HTTPException(500, "Không tạo được mẹo viết.")
    if not r.data:
        raise HTTPException(500, "Không tạo được mẹo viết.")
    return r.data[0]


@router.get("/{tip_id}")
async def get_tip(
    tip_id: UUID,
    authorization: str | None = Header(None),
):
    await require_admin(authorization)
    r = (
        supabase_admin.table("writing_tips")
        .select("*")
        .eq("id", str(tip_id))
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Không tìm thấy mẹo viết.")
    return r.data[0]


@router.patch("/{tip_id}")
async def update_tip(
    tip_id: UUID,
    body:   TipUpdate,
    authorization: str | None = Header(None),
):
    """Partial update. Only fields present in the request body are
    written. `published`/`display_order` keep their sent value even when
    falsy (False / 0) — only genuinely-unset fields are skipped."""
    await require_admin(authorization)

    patch = body.model_dump(exclude_unset=True)
    if "slug" in patch:
        patch["slug"] = (patch["slug"] or "").strip() or _slugify(patch.get("title") or "tip")
    if not patch:
        raise HTTPException(400, "No fields to update")

    try:
        r = (
            supabase_admin.table("writing_tips")
            .update(patch)
            .eq("id", str(tip_id))
            .execute()
        )
    except Exception as exc:
        if _is_unique_violation(exc):
            raise HTTPException(409, "Slug đã tồn tại. Vui lòng đổi slug.")
        logger.error("update_tip failed: %s", exc)
        raise HTTPException(500, "Không cập nhật được mẹo viết.")
    if not r.data:
        raise HTTPException(404, "Không tìm thấy mẹo viết.")
    return r.data[0]


@router.delete("/{tip_id}")
async def delete_tip(
    tip_id: UUID,
    authorization: str | None = Header(None),
):
    """Hard delete — tips have no downstream FK references (unlike
    prompts → assignments), so there's no audit trail to preserve."""
    await require_admin(authorization)
    r = (
        supabase_admin.table("writing_tips")
        .delete()
        .eq("id", str(tip_id))
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Không tìm thấy mẹo viết.")
    return {"message": "Đã xóa mẹo viết", "tip_id": str(tip_id)}


# ── Sprint 19.1C — content import (Markdown + YAML frontmatter) ────────


@content_router.post("/import")
async def import_content(
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
    authorization: str | None = Header(None),
):
    """Parse an uploaded `.md` file, validate it, and (when dry_run=false +
    no errors) upsert into writing_tips by slug.

    Contract: docs/clusters/19_x/content_format_v1.md. Idempotent by slug —
    a re-uploaded file with the same slug UPDATES the row in place
    (created_at + created_by preserved), so there's no slug-collision 409
    on this path (that's intentional: fixing content = re-upload).

    Response: { parsed_data, validation_errors, dry_run, committed_id,
    action }. dry_run (default true) and any validation error both
    short-circuit before touching the DB."""
    admin = await require_admin(authorization)

    raw = await file.read()
    text = raw.decode("utf-8", errors="replace")

    try:
        parsed = parse_markdown_with_frontmatter(text)
    except FrontmatterError as exc:
        return {
            "parsed_data": None,
            "validation_errors": [{"field": "frontmatter", "message": str(exc)}],
            "dry_run": dry_run,
            "committed_id": None,
            "action": None,
        }

    # Fill the effective slug for the preview + commit (only when omitted).
    if not parsed.slug:
        parsed.slug = slugify(parsed.title or "")

    errors = validate_content(parsed)
    result = {
        "parsed_data": parsed.as_preview(),
        "validation_errors": errors,
        "dry_run": dry_run,
        "committed_id": None,
        "action": None,
    }
    if dry_run or errors:
        return result

    # ── Commit: upsert by slug ──
    payload = build_db_payload(parsed, parsed.slug)
    try:
        existing = (
            supabase_admin.table("writing_tips")
            .select("id")
            .eq("slug", parsed.slug)
            .limit(1)
            .execute()
        )
        if existing.data:
            supabase_admin.table("writing_tips").update(payload).eq("slug", parsed.slug).execute()
            result["committed_id"] = existing.data[0]["id"]
            result["action"] = "updated"
        else:
            payload["created_by"] = admin["id"]
            r = supabase_admin.table("writing_tips").insert(payload).execute()
            if not r.data:
                raise HTTPException(500, "Không lưu được nội dung.")
            result["committed_id"] = r.data[0]["id"]
            result["action"] = "created"
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("import_content commit failed slug=%s: %s", parsed.slug, exc)
        raise HTTPException(500, "Không lưu được nội dung. Vui lòng thử lại.")

    return result
