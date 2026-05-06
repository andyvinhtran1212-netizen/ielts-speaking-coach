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

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.admin import require_admin


router = APIRouter(
    prefix="/admin/writing/prompts",
    tags=["admin-writing-prompts"],
)


# ── Request bodies ────────────────────────────────────────────────────

_TASK_TYPE_PATTERN  = r"^(task1_academic|task1_general|task2)$"
_DIFFICULTY_PATTERN = r"^(beginner|intermediate|advanced)$"


class PromptCreate(BaseModel):
    """Required fields for creating a library prompt.  Bounds match
    the migration's CHECK constraints + writing_essays size caps."""
    task_type:   str = Field(..., pattern=_TASK_TYPE_PATTERN)
    prompt_text: str = Field(..., min_length=10, max_length=5000)
    title:       str = Field(..., min_length=2, max_length=200)
    difficulty:  Optional[str] = Field(None, pattern=_DIFFICULTY_PATTERN)
    tags:        list[str] = Field(default_factory=list, max_length=20)


class PromptUpdate(BaseModel):
    """Every field optional — only provided fields are PATCHed.
    `is_active` opens the door to admin un-soft-deleting a prompt
    (DELETE soft-deletes; PATCH with is_active=true restores)."""
    task_type:   Optional[str]      = Field(None, pattern=_TASK_TYPE_PATTERN)
    prompt_text: Optional[str]      = Field(None, min_length=10, max_length=5000)
    title:       Optional[str]      = Field(None, min_length=2, max_length=200)
    difficulty:  Optional[str]      = Field(None, pattern=_DIFFICULTY_PATTERN)
    tags:        Optional[list[str]] = Field(None, max_length=20)
    is_active:   Optional[bool]      = None


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


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_prompt(
    body: PromptCreate,
    authorization: str | None = Header(None),
):
    """Create a new library prompt.  `created_by` is auto-stamped to
    the calling admin's user_id."""
    admin = await require_admin(authorization)

    payload = body.model_dump()
    payload["created_by"] = admin["id"]

    r = supabase_admin.table("writing_prompts").insert(payload).execute()
    if not r.data:
        raise HTTPException(500, "Failed to create prompt")
    return r.data[0]


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
    authorization: str | None = Header(None),
):
    """Partial update.  Only fields present in the request body are
    written; all others stay untouched."""
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
    return r.data[0]


@router.delete("/{prompt_id}")
async def soft_delete_prompt(
    prompt_id: UUID,
    authorization: str | None = Header(None),
):
    """Soft delete — flips `is_active` to false rather than removing
    the row, so old assignments / submissions referencing this prompt
    keep their context.  PATCH with is_active=true to restore."""
    await require_admin(authorization)

    r = (
        supabase_admin.table("writing_prompts")
        .update({"is_active": False})
        .eq("id", str(prompt_id))
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Prompt not found")
    return {"message": "Prompt deactivated", "prompt_id": str(prompt_id)}
