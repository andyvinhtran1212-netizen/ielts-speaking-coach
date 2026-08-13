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

_PATCH_NULLABLE_FIELDS = {
    "difficulty",
    "prompt_image_url",
    "prompt_image_public_id",
}
_ANALYSIS_CLEAR_PATCH = {
    "prompt_image_analysis": None,
    "prompt_image_analysis_status": None,
    "prompt_image_analysis_reviewed": False,
    "prompt_image_analysis_model": None,
    "prompt_image_analysis_public_id": None,
    "prompt_image_analysis_error": None,
    "prompt_image_analysis_at": None,
}


class PromptCreate(BaseModel):
    """Required fields for creating a library prompt.  Bounds match
    the migration's CHECK constraints + writing_essays size caps.

    Phase 2.3c-1: `prompt_image_url` + `prompt_image_public_id`
    plumbed for Task 1 Academic charts/diagrams. Both are NULL on
    text-only prompts and the route validates them as one storage pair."""
    task_type:              str = Field(..., pattern=_TASK_TYPE_PATTERN)
    prompt_text:            str = Field(..., min_length=10, max_length=5000)
    title:                  str = Field(..., min_length=2, max_length=200)
    difficulty:             Optional[str] = Field(None, pattern=_DIFFICULTY_PATTERN)
    tags:                   list[str]     = Field(default_factory=list, max_length=20)
    # NOT Optional here, unlike PromptUpdate: create_prompt() serialises the WHOLE
    # model, so a None would be written as an explicit NULL into a NOT NULL column
    # (mig 170) and EVERY prompt creation would fail — including from the current
    # admin page, which does not send this field at all (Codex review, PR #862).
    exam_only:              bool          = Field(
        False,
        description="Dành riêng cho kỳ thi thử — ẩn khỏi ngân hàng đề của học viên (mig 170)",
    )
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
    exam_only:              Optional[bool]      = Field(
        None,
        description="Dành riêng cho kỳ thi thử — ẩn khỏi ngân hàng đề của học viên (mig 170)",
    )


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


class DiscardImageRequest(BaseModel):
    public_id: str = Field(..., min_length=9, max_length=300)


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
    pending_token = writing_prompt_analysis.mark_analysis_pending(
        pid, prompt_row["prompt_image_public_id"],
    )
    if pending_token is None:
        return
    background_tasks.add_task(
        writing_prompt_analysis.run_and_store_analysis, pid, pending_token,
    )


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
    image_url = payload.get("prompt_image_url")
    public_id = payload.get("prompt_image_public_id")
    if bool(image_url) != bool(public_id):
        raise HTTPException(
            422,
            "prompt_image_url and prompt_image_public_id must both be set or both be null",
        )
    if body.task_type != "task1_academic" and (image_url or public_id):
        raise HTTPException(422, "Only Task 1 Academic prompts can have an image")
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


@router.post("/discard-image")
async def discard_unattached_image(
    body: DiscardImageRequest,
    authorization: str | None = Header(None),
):
    """Best-effort cleanup for an upload whose following prompt write failed.

    Only paths minted by ``upload_prompt_image`` are accepted. This endpoint is
    deliberately not a general-purpose storage delete surface.
    """
    await require_admin(authorization)
    if not body.public_id.startswith("prompts/"):
        raise HTTPException(400, "Invalid prompt image path")
    referenced = (
        supabase_admin.table("writing_prompts")
        .select("id")
        .eq("prompt_image_public_id", body.public_id)
        .limit(1)
        .execute()
    )
    if referenced.data:
        raise HTTPException(409, "Prompt image is still referenced")
    deleted = delete_prompt_image(body.public_id)
    return {"discarded": deleted, "public_id": body.public_id}


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

    # `exclude_unset=True` distinguishes an omitted field from an explicit
    # JSON null. Difficulty and image columns are nullable by contract; all
    # other fields reject null rather than silently pretending no change was
    # requested.
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(400, "No fields to update")
    invalid_nulls = sorted(
        key for key, value in patch.items()
        if value is None and key not in _PATCH_NULLABLE_FIELDS
    )
    if invalid_nulls:
        raise HTTPException(
            422,
            f"Fields cannot be null: {', '.join(invalid_nulls)}",
        )
    if patch.get("exam_only") is False:
        from services import mock_exam_service
        try:
            mock_exam_service.assert_can_unreserve("writing", prompt_id)
        except mock_exam_service.SittingConflictError as e:
            raise HTTPException(409, str(e))
        except mock_exam_service.MockExamError as e:
            raise HTTPException(503, str(e))

    old_public_id = None
    image_changed = False
    image_contract_touched = bool({
        "task_type", "prompt_image_url", "prompt_image_public_id",
    } & patch.keys())
    if image_contract_touched:
        existing = (
            supabase_admin.table("writing_prompts")
            .select(
                "id, task_type, prompt_image_url, prompt_image_public_id, "
                "prompt_image_analysis_public_id"
            )
            .eq("id", str(prompt_id))
            .limit(1)
            .execute()
        )
        if not existing.data:
            raise HTTPException(404, "Prompt not found")
        current = existing.data[0]
        old_public_id = current.get("prompt_image_public_id")
        next_task_type = patch.get("task_type", current.get("task_type"))
        next_image_url = patch.get("prompt_image_url", current.get("prompt_image_url"))
        next_public_id = patch.get(
            "prompt_image_public_id", current.get("prompt_image_public_id")
        )

        # Images are meaningful only for Task 1 Academic and the URL/storage
        # path must move as one pair. Switching task type intentionally clears
        # the old asset instead of retaining a hidden chart.
        if next_task_type != "task1_academic":
            next_image_url = None
            next_public_id = None
            patch["prompt_image_url"] = None
            patch["prompt_image_public_id"] = None
        elif bool(next_image_url) != bool(next_public_id):
            raise HTTPException(
                422,
                "prompt_image_url and prompt_image_public_id must both be set or both be null",
            )

        image_changed = (
            next_image_url != current.get("prompt_image_url")
            or next_public_id != old_public_id
            or next_task_type != current.get("task_type")
        )
        if image_changed:
            patch.update(_ANALYSIS_CLEAR_PATCH)

    update_query = (
        supabase_admin.table("writing_prompts")
        .update(patch)
        .eq("id", str(prompt_id))
    )
    if image_contract_touched:
        update_query = update_query.eq("task_type", current.get("task_type"))
        update_query = (
            update_query.is_("prompt_image_public_id", "null")
            if old_public_id is None
            else update_query.eq("prompt_image_public_id", old_public_id)
        )
    r = update_query.execute()
    if not r.data:
        if image_contract_touched:
            raise HTTPException(409, "Prompt changed; reload before saving")
        raise HTTPException(404, "Prompt not found")
    new_public_id = r.data[0].get("prompt_image_public_id")
    if old_public_id and old_public_id != new_public_id:
        delete_prompt_image(old_public_id)
    # Only a chart identity change auto-triggers extraction. A title/tag edit
    # while an analysis is pending must not start a duplicate model call.
    if image_changed:
        _maybe_trigger_analysis(r.data[0], background_tasks)
    return r.data[0]


class PromptAnalysisReview(BaseModel):
    """Admin approval of a Task 1 answer key. `analysis` is the (possibly
    hand-edited) facts, validated against the same schema the extractor emits."""
    analysis: PromptImageAnalysis
    reviewed: bool = True
    expected_image_public_id: str = Field(
        ...,
        min_length=1,
        max_length=300,
        description="Optimistic-concurrency fingerprint for the chart being reviewed.",
    )


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
        .select("id, task_type, prompt_image_url, prompt_image_public_id")
        .eq("id", str(prompt_id)).limit(1).execute()
    ).data
    if not row:
        raise HTTPException(404, "Prompt not found")
    p = row[0]
    if p.get("task_type") != "task1_academic" or not p.get("prompt_image_url"):
        raise HTTPException(
            400, "Chỉ đề Task 1 Academic có hình mới phân tích được.",
        )

    pending_token = writing_prompt_analysis.mark_analysis_pending(
        str(prompt_id), p["prompt_image_public_id"],
    )
    if pending_token is None:
        raise HTTPException(409, "Prompt image changed; reload before re-analyzing")
    background_tasks.add_task(
        writing_prompt_analysis.run_and_store_analysis, str(prompt_id), pending_token,
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

    existing = (
        supabase_admin.table("writing_prompts")
        .select("id, task_type, prompt_image_url, prompt_image_public_id")
        .eq("id", str(prompt_id))
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Prompt not found")
    prompt = existing.data[0]
    if prompt.get("task_type") != "task1_academic" or not prompt.get("prompt_image_url"):
        raise HTTPException(409, "Prompt no longer has a Task 1 Academic image")
    if body.expected_image_public_id != prompt.get("prompt_image_public_id"):
        raise HTTPException(409, "Prompt image changed; reload the answer key before saving")

    update_query = (
        supabase_admin.table("writing_prompts")
        .update({
            "prompt_image_analysis":          body.analysis.model_dump(),
            "prompt_image_analysis_reviewed": body.reviewed,
            "prompt_image_analysis_status":   "ready",
            "prompt_image_analysis_error":    None,
        })
        .eq("id", str(prompt_id))
    )
    update_query = update_query.eq(
        "prompt_image_public_id", body.expected_image_public_id
    )
    r = update_query.execute()
    if not r.data:
        raise HTTPException(409, "Prompt image changed; reload the answer key before saving")
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

    update_query = (
        supabase_admin.table("writing_prompts")
        .update({
            "is_active":              False,
            "prompt_image_url":       None,
            "prompt_image_public_id": None,
            **_ANALYSIS_CLEAR_PATCH,
        })
        .eq("id", str(prompt_id))
    )
    update_query = (
        update_query.is_("prompt_image_public_id", "null")
        if public_id is None
        else update_query.eq("prompt_image_public_id", public_id)
    )
    r = update_query.execute()
    if not r.data:
        raise HTTPException(409, "Prompt changed; reload before archiving")

    # Best-effort storage cleanup — never blocks the soft-delete.
    if public_id:
        delete_prompt_image(public_id)

    return {"message": "Prompt deactivated", "prompt_id": str(prompt_id)}
