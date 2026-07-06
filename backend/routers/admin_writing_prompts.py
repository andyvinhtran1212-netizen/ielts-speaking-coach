"""routers/admin_writing_prompts.py — Admin CRUD for the writing
prompts library (Phase 2.3a-1).

Endpoints (all admin-only — `await require_admin(authorization)` at
the top of every handler, matching the pattern in routers/admin.py
and routers/admin_writing.py):

  GET    /admin/writing/prompts            — list (filterable)
  POST   /admin/writing/prompts            — create
  GET    /admin/writing/prompts/{id}       — single
  PATCH  /admin/writing/prompts/{id}       — partial update
  DELETE /admin/writing/prompts/{id}       — soft delete (is_active=false)

Storage: `writing_prompts` table (migration 035). RLS is admin-only at
the DB layer too, but every endpoint enforces app-layer
require_admin() before touching `supabase_admin` (service-role
client) so the auth gate fails fast with a 401/403 rather than a
silent empty result on RLS denial.
"""

from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from fastapi import (
    APIRouter, BackgroundTasks, File, Header, HTTPException, Query, UploadFile, status,
)
from pydantic import BaseModel, Field

from database import supabase_admin
from models.writing_feedback import PromptImageAnalysis
from routers.admin import require_admin
from services import writing_prompt_analysis
from services.writing_prompt_image import (
    delete_prompt_image,
    upload_prompt_image,
)

logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/admin/writing/prompts",
    tags=["admin-writing-prompts"],
)


# ── Request bodies ────────────────────────────────────────────────────

_TASK_TYPE_PATTERN  = r"^(task1_academic|task1_general|task2)$"
_DIFFICULTY_PATTERN = r"^(beginner|intermediate|advanced)$"


class PromptCreate(BaseModel):
    """Required fields for creating a library prompt.  Bounds match
    the migration's CHECK constraints + writing_essays size caps.

    Phase 2.3c-1: `prompt_image_url` + `prompt_image_public_id`
    plumbed for Task 1 Academic charts/diagrams.  Both NULL on
    text-only prompts.  Admin UI hides the upload field unless
    `task_type == 'task1_academic'`; the schema doesn't enforce
    the pairing yet (intentional flexibility for content edge
    cases — see migration 038's comment)."""
    task_type:              str = Field(..., pattern=_TASK_TYPE_PATTERN)
    prompt_text:            str = Field(..., min_length=10, max_length=5000)
    title:                  str = Field(..., min_length=2, max_length=200)
    difficulty:             Optional[str] = Field(None, pattern=_DIFFICULTY_PATTERN)
    tags:                   list[str]     = Field(default_factory=list, max_length=20)
    prompt_image_url:       Optional[str] = Field(None, max_length=500)
    prompt_image_public_id: Optional[str] = Field(None, max_length=300)


class PromptUpdate(BaseModel):
    """Every field optional — only provided fields are PATCHed.
    `is_active` opens the door to admin un-soft-deleting a prompt
    (DELETE soft-deletes; PATCH with is_active=true restores)."""
    task_type:              Optional[str]       = Field(None, pattern=_TASK_TYPE_PATTERN)
    prompt_text:            Optional[str]       = Field(None, min_length=10, max_length=5000)
    title:                  Optional[str]       = Field(None, min_length=2, max_length=200)
    difficulty:             Optional[str]       = Field(None, pattern=_DIFFICULTY_PATTERN)
    tags:                   Optional[list[str]] = Field(None, max_length=20)
    is_active:              Optional[bool]      = None
    prompt_image_url:       Optional[str]       = Field(None, max_length=500)
    prompt_image_public_id: Optional[str]       = Field(None, max_length=300)


class UploadImageResponse(BaseModel):
    """Response shape for `POST .../upload-image`. `url` is the public
    Supabase Storage URL (persisted into `prompt_image_url`); `public_id`
    is the storage path (persisted into `prompt_image_public_id`, used to
    delete the object on prompt delete). `width`/`height` are null — we
    don't decode dimensions server-side (no Pillow dependency)."""
    url:       str
    public_id: str
    width:     Optional[int] = None
    height:    Optional[int] = None


# ── Endpoints ─────────────────────────────────────────────────────────


@router.get("")
async def list_prompts(
    task_type:    Optional[str]  = Query(default=None, pattern=_TASK_TYPE_PATTERN),
    difficulty:   Optional[str]  = Query(default=None, pattern=_DIFFICULTY_PATTERN),
    is_active:    Optional[bool] = Query(default=True),
    limit:        int            = Query(default=200, ge=1, le=500),
    authorization: str | None    = Header(None),
):
    """List prompts, newest first.  `is_active=true` by default so
    soft-deleted rows don't pollute the admin UI; pass
    `is_active=false` to inspect deactivated rows for restore."""
    await require_admin(authorization)

    q = (
        supabase_admin.table("writing_prompts")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
    )
    if task_type:
        q = q.eq("task_type", task_type)
    if difficulty:
        q = q.eq("difficulty", difficulty)
    if is_active is not None:
        q = q.eq("is_active", is_active)

    r = q.execute()
    return {"prompts": r.data or []}


def _maybe_trigger_analysis(prompt_row: dict, background_tasks: BackgroundTasks) -> None:
    """Kick off answer-key extraction when a task1_academic prompt's chart is new
    or replaced (image public_id != the one the analysis was derived from). Sets
    status='pending' synchronously so the UI reflects it immediately, then runs
    the vision extraction in the background."""
    if not writing_prompt_analysis.image_needs_analysis(prompt_row):
        return
    pid = prompt_row["id"]
    writing_prompt_analysis.mark_analysis_pending(pid)
    background_tasks.add_task(writing_prompt_analysis.run_and_store_analysis, pid)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_prompt(
    body: PromptCreate,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
):
    """Create a new library prompt.  `created_by` is auto-stamped to
    the calling admin's user_id. For a task1_academic prompt with an image,
    schedules answer-key extraction (docs/WRITING_TASK1_ANALYSIS_SPEC.md)."""
    admin = await require_admin(authorization)

    payload = body.model_dump()
    payload["created_by"] = admin["id"]

    r = supabase_admin.table("writing_prompts").insert(payload).execute()
    if not r.data:
        raise HTTPException(500, "Failed to create prompt")
    _maybe_trigger_analysis(r.data[0], background_tasks)
    return r.data[0]


# Image upload — declared BEFORE the `{prompt_id}` parametric routes
# so FastAPI's path matcher doesn't try to read "upload-image" as a
# UUID and 422 the request.
@router.post(
    "/upload-image",
    response_model=UploadImageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_image(
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    """Upload one image to Supabase Storage, return its `url` +
    `public_id` (the storage path).

    The admin UI then stashes both values in hidden form fields and
    sends them through the next prompt create/PATCH — image upload
    and prompt write are intentionally decoupled so a re-typed title
    doesn't re-upload the file, and a failed upload doesn't leave
    a half-formed prompt row behind.

    Validation:
      • Content-Type must start with `image/` (rejects .txt / .pdf
        before reading the body).
      • Magic-byte sniff (PNG/JPG/WebP) + size cap (5MB) enforced
        server-side in `writing_prompt_image.upload_prompt_image`.

    Failure modes:
      • Oversize / empty / unsupported-format → 400 with the exact
        ValueError message.
      • Storage error (e.g. the `writing-images` bucket doesn't exist
        yet — a one-time Supabase dashboard step) → 500, with the REAL
        exception logged server-side (incl. traceback) for diagnosis.
    """
    await require_admin(authorization)

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            400,
            f"File must be an image (got Content-Type: {file.content_type!r}).",
        )

    file_bytes = await file.read()

    try:
        result = upload_prompt_image(file_bytes, filename_hint=file.filename)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        # Don't swallow the real cause — log it (with traceback) so an
        # operational failure (missing bucket, RLS, network) is
        # diagnosable, then return a friendly 500 to the user.
        logger.error("upload_image endpoint failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Upload failed. Please try again.")

    return result


@router.get("/{prompt_id}")
async def get_prompt(
    prompt_id: UUID,
    authorization: str | None = Header(None),
):
    """Fetch one prompt by id.  404 if missing or soft-deleted."""
    await require_admin(authorization)

    r = (
        supabase_admin.table("writing_prompts")
        .select("*")
        .eq("id", str(prompt_id))
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Prompt not found")
    return r.data[0]


@router.patch("/{prompt_id}")
async def update_prompt(
    prompt_id: UUID,
    body:      PromptUpdate,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
):
    """Partial update.  Only fields present in the request body are
    written; all others stay untouched. If the image changed, re-schedules
    answer-key extraction (and the prior analysis is re-reviewed)."""
    await require_admin(authorization)

    # Build the patch from non-None fields only — None means
    # "client didn't send this field", not "set to NULL".
    patch = {k: v for k, v in body.model_dump(exclude_unset=True).items()
             if v is not None}
    if not patch:
        raise HTTPException(400, "No fields to update")

    r = (
        supabase_admin.table("writing_prompts")
        .update(patch)
        .eq("id", str(prompt_id))
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Prompt not found")
    # The returned row carries all columns (incl. the analysis public_id), so the
    # image-changed check is exact — a title-only PATCH won't re-trigger.
    _maybe_trigger_analysis(r.data[0], background_tasks)
    return r.data[0]


class PromptAnalysisReview(BaseModel):
    """Admin approval of a Task 1 answer key. `analysis` is the (possibly
    hand-edited) facts, validated against the same schema the extractor emits."""
    analysis: PromptImageAnalysis
    reviewed: bool = True


@router.post("/{prompt_id}/reanalyze", status_code=status.HTTP_202_ACCEPTED)
async def reanalyze_prompt_image(
    prompt_id: UUID,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(None),
):
    """Manually (re)run answer-key extraction for a task1_academic prompt — the
    recovery path for a 'failed' analysis, or to refresh after a prompt edit.
    Un-reviews the current analysis until the new run is approved."""
    await require_admin(authorization)

    row = (
        supabase_admin.table("writing_prompts")
        .select("id, task_type, prompt_image_url")
        .eq("id", str(prompt_id)).limit(1).execute()
    ).data
    if not row:
        raise HTTPException(404, "Prompt not found")
    p = row[0]
    if p.get("task_type") != "task1_academic" or not p.get("prompt_image_url"):
        raise HTTPException(
            400, "Chỉ đề Task 1 Academic có hình mới phân tích được.",
        )

    writing_prompt_analysis.mark_analysis_pending(str(prompt_id))
    background_tasks.add_task(
        writing_prompt_analysis.run_and_store_analysis, str(prompt_id),
    )
    return {"status": "pending", "prompt_id": str(prompt_id)}


@router.patch("/{prompt_id}/analysis")
async def review_prompt_analysis(
    prompt_id: UUID,
    body: PromptAnalysisReview,
    authorization: str | None = Header(None),
):
    """Save the admin-reviewed answer key. Approving (`reviewed=true`) is the
    gate that lets these facts anchor grading — un-reviewed AI extraction never
    grades. Sets status='ready' since approved content is, by definition, ready."""
    await require_admin(authorization)

    r = (
        supabase_admin.table("writing_prompts")
        .update({
            "prompt_image_analysis":          body.analysis.model_dump(),
            "prompt_image_analysis_reviewed": body.reviewed,
            "prompt_image_analysis_status":   "ready",
            "prompt_image_analysis_error":    None,
        })
        .eq("id", str(prompt_id))
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Prompt not found")
    return r.data[0]


@router.delete("/{prompt_id}")
async def soft_delete_prompt(
    prompt_id: UUID,
    authorization: str | None = Header(None),
):
    """Soft delete — flips `is_active` to false rather than removing
    the row, so old assignments / submissions referencing this prompt
    keep their context.  PATCH with is_active=true to restore.

    Phase 2.3c-1: also deletes the Supabase Storage object and clears
    the image columns. Soft-deleted prompts are never re-shown to admins
    (filter dropdown was removed in Sprint 2.3a-1.1), so keeping orphan
    image objects "just in case" of restore would steadily accumulate
    storage. If a restore is ever needed, admin can re-upload the image
    alongside the PATCH `is_active=true`."""
    await require_admin(authorization)

    # Read the existing public_id BEFORE updating so we can clean up
    # the storage object even if the row is missing afterwards (race-safe).
    existing = (
        supabase_admin.table("writing_prompts")
        .select("prompt_image_public_id")
        .eq("id", str(prompt_id))
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Prompt not found")

    public_id = existing.data[0].get("prompt_image_public_id")

    r = (
        supabase_admin.table("writing_prompts")
        .update({
            "is_active":              False,
            "prompt_image_url":       None,
            "prompt_image_public_id": None,
        })
        .eq("id", str(prompt_id))
        .execute()
    )
    if not r.data:
        # Row vanished between the SELECT and UPDATE — extremely rare,
        # but treat it as "not found" rather than 500.
        raise HTTPException(404, "Prompt not found")

    # Best-effort storage cleanup — never blocks the soft-delete.
    if public_id:
        delete_prompt_image(public_id)

    return {"message": "Prompt deactivated", "prompt_id": str(prompt_id)}
