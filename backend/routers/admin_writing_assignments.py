"""routers/admin_writing_assignments.py — Admin CRUD for writing
assignments (Phase 2.3a-2).

Maps prompts from the library (writing_prompts, migration 035) to
specific students with an optional deadline + status workflow:

    pending → in_progress → submitted → graded → delivered

Endpoints (all admin-only — `await require_admin(authorization)` at
the top of every handler):

  GET    /admin/writing/assignments              — list (filterable)
  POST   /admin/writing/assignments              — create (single OR bulk)
  GET    /admin/writing/assignments/{id}         — single (with prompt + student joined)
  PATCH  /admin/writing/assignments/{id}         — partial update
  DELETE /admin/writing/assignments/{id}         — hard delete (only when status='pending')

Duplicate policy: per the 2026-05-06 product decision, duplicate
(prompt_id, student_id) inserts are ALLOWED but the response carries
a `duplicates_warning` array so the admin UI can surface a
"this student was already assigned this prompt" notice.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator

from database import supabase_admin
from routers.admin import require_admin


router = APIRouter(
    prefix="/admin/writing/assignments",
    tags=["admin-writing-assignments"],
)


_STATUS_PATTERN = r"^(pending|in_progress|submitted|graded|delivered)$"


# ── Helpers ───────────────────────────────────────────────────────────


def _now_iso() -> str:
    """ISO-8601 UTC timestamp.  We stamp these in Python rather than
    pushing the literal string `"now()"` to Supabase — the python
    client doesn't translate `now()` into a SQL function, it stores
    the literal string and breaks downstream queries."""
    return datetime.now(timezone.utc).isoformat()


# ── Request bodies ────────────────────────────────────────────────────


class AssignmentCreate(BaseModel):
    """One prompt → one or more students.  When `student_ids` has a
    single entry this is a single-assignment create; multi-entry is
    bulk.  Cap at 100 to keep the insert payload bounded.

    Phase 2.3c-3: `is_timed` + `time_limit_minutes` opt the assignment
    into IELTS-exam mode.  The pair is enforced together (one without
    the other is a 422) — the same invariant the migration's CHECK
    constraint enforces at the DB layer.
    """
    prompt_id:           UUID
    student_ids:         list[UUID]         = Field(..., min_length=1, max_length=100)
    deadline:            Optional[datetime] = None
    instructions:        Optional[str]      = Field(None, max_length=2000)
    is_timed:            bool               = False
    time_limit_minutes:  Optional[int]      = Field(None, ge=1, le=180)

    @model_validator(mode="after")
    def _validate_timer_pairing(self):
        """`is_timed=true` requires `time_limit_minutes`; `is_timed=false`
        forbids it.  Done at model level (not on a single field) so the
        check fires even when `time_limit_minutes` is omitted from the
        request body — a `field_validator` on a missing field never
        runs in Pydantic v2.

        Without this branch Pydantic would happily accept
        `is_timed=true` alone, and the DB CHECK constraint would
        reject it later with a far less friendly error."""
        if self.is_timed and self.time_limit_minutes is None:
            raise ValueError(
                "time_limit_minutes is required when is_timed=true"
            )
        if not self.is_timed and self.time_limit_minutes is not None:
            raise ValueError(
                "time_limit_minutes only allowed when is_timed=true"
            )
        return self


class AssignmentUpdate(BaseModel):
    """All fields optional — only the provided ones are PATCHed.
    Status transitions auto-stamp the matching `*_at` column server
    side so the admin UI never has to compute timestamps.

    Timer fields here are intentionally lighter than AssignmentCreate
    — admins can edit only the deadline/instructions/status today.
    Toggling `is_timed` mid-flight on an in-progress assignment would
    let an admin reset a student's started_at, so we don't expose
    timer edits on PATCH (delete + recreate covers that flow)."""
    deadline:     Optional[datetime] = None
    instructions: Optional[str]      = Field(None, max_length=2000)
    status:       Optional[str]      = Field(None, pattern=_STATUS_PATTERN)


# ── Endpoints ─────────────────────────────────────────────────────────


@router.get("")
async def list_assignments(
    student_id: Optional[UUID] = Query(default=None),
    prompt_id:  Optional[UUID] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status_filter",
                                          pattern=_STATUS_PATTERN),
    limit: int = Query(default=200, ge=1, le=500),
    authorization: str | None = Header(None),
):
    """List assignments with optional filters, newest first.  The
    response embeds the joined prompt (id/title/task_type/difficulty)
    and student (id/student_code/full_name) so the admin list view
    doesn't need a second round-trip."""
    await require_admin(authorization)

    q = (
        supabase_admin.table("writing_assignments")
        .select(
            "id, status, deadline, instructions, created_at, "
            "submitted_at, graded_at, delivered_at, "
            "essay_id, prompt_id, student_id, "
            "is_timed, time_limit_minutes, started_at, auto_submitted, "
            "writing_prompts(id, title, task_type, difficulty), "
            "students(id, student_code, full_name)"
        )
        .order("created_at", desc=True)
        .limit(limit)
    )
    if student_id:
        q = q.eq("student_id", str(student_id))
    if prompt_id:
        q = q.eq("prompt_id", str(prompt_id))
    if status_filter:
        q = q.eq("status", status_filter)

    r = q.execute()
    return {"assignments": r.data or []}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_assignments(
    body: AssignmentCreate,
    authorization: str | None = Header(None),
):
    """Create one or more assignments.

    Returns:
        {
            "created":             [<row>, ...],
            "count":               <int>,
            "duplicates_warning":  [<student_id>, ...],
        }

    `duplicates_warning` lists the student_ids that ALREADY had at
    least one assignment for this prompt before this insert — those
    rows are still created (allow + warn policy from 2026-05-06).
    """
    admin = await require_admin(authorization)

    student_id_strs = [str(s) for s in body.student_ids]

    # Detect existing duplicates (same prompt + student) for warning.
    # We only need student_id back; one row per duplicate is enough.
    duplicate_student_ids: set[str] = set()
    try:
        existing = (
            supabase_admin.table("writing_assignments")
            .select("student_id")
            .eq("prompt_id", str(body.prompt_id))
            .in_("student_id", student_id_strs)
            .execute()
        )
        duplicate_student_ids = {row["student_id"] for row in (existing.data or [])
                                  if row.get("student_id")}
    except Exception:
        # Don't block create on a duplicate-check failure — the warning
        # is advisory; the bulk insert below is the source of truth.
        duplicate_student_ids = set()

    deadline_iso = body.deadline.isoformat() if body.deadline else None
    payload = [
        {
            "prompt_id":          str(body.prompt_id),
            "student_id":         sid,
            "assigned_by":        admin["id"],
            "deadline":           deadline_iso,
            "instructions":       body.instructions,
            "is_timed":           body.is_timed,
            "time_limit_minutes": body.time_limit_minutes,
        }
        for sid in student_id_strs
    ]

    r = supabase_admin.table("writing_assignments").insert(payload).execute()
    if not r.data:
        raise HTTPException(500, "Failed to create assignments")

    return {
        "created":            r.data,
        "count":              len(r.data),
        "duplicates_warning": sorted(duplicate_student_ids),
    }


@router.get("/{assignment_id}")
async def get_assignment(
    assignment_id: UUID,
    authorization: str | None = Header(None),
):
    """Fetch one assignment with the full joined prompt + student.
    404 when missing."""
    await require_admin(authorization)

    r = (
        supabase_admin.table("writing_assignments")
        .select(
            "*, "
            "writing_prompts(*), "
            "students(id, student_code, full_name)"
        )
        .eq("id", str(assignment_id))
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Assignment not found")
    return r.data[0]


@router.patch("/{assignment_id}")
async def update_assignment(
    assignment_id: UUID,
    body:          AssignmentUpdate,
    authorization: str | None = Header(None),
):
    """Partial update.  Only the fields explicitly present in the
    request body are written.

    Status transitions auto-stamp the matching `*_at` column:
        submitted → submitted_at = now()
        graded    → graded_at    = now()
        delivered → delivered_at = now()

    Other status values (pending / in_progress) leave the timestamps
    untouched."""
    await require_admin(authorization)

    fields = body.model_dump(exclude_unset=True)
    patch: dict = {}

    if "deadline" in fields:
        # `None` is a meaningful value here — clears the deadline.
        deadline = fields["deadline"]
        patch["deadline"] = deadline.isoformat() if isinstance(deadline, datetime) else None

    if "instructions" in fields and fields["instructions"] is not None:
        patch["instructions"] = fields["instructions"]

    if "status" in fields and fields["status"] is not None:
        new_status = fields["status"]
        patch["status"] = new_status
        if new_status == "submitted":
            patch["submitted_at"] = _now_iso()
        elif new_status == "graded":
            patch["graded_at"]    = _now_iso()
        elif new_status == "delivered":
            patch["delivered_at"] = _now_iso()

    if not patch:
        raise HTTPException(400, "No fields to update")

    r = (
        supabase_admin.table("writing_assignments")
        .update(patch)
        .eq("id", str(assignment_id))
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Assignment not found")
    return r.data[0]


@router.delete("/{assignment_id}")
async def delete_assignment(
    assignment_id: UUID,
    authorization: str | None = Header(None),
):
    """Hard delete — only allowed when the assignment is still
    `pending`.  Anything past pending implies real student/grader
    work has touched the row and silently dropping it would lose
    audit context."""
    await require_admin(authorization)

    check = (
        supabase_admin.table("writing_assignments")
        .select("status")
        .eq("id", str(assignment_id))
        .limit(1)
        .execute()
    )
    if not check.data:
        raise HTTPException(404, "Assignment not found")

    current = check.data[0].get("status")
    if current != "pending":
        raise HTTPException(
            409,
            f"Cannot delete assignment in status '{current}'. "
            f"Only pending assignments can be deleted.",
        )

    (
        supabase_admin.table("writing_assignments")
        .delete()
        .eq("id", str(assignment_id))
        .execute()
    )
    return {"message": "Assignment deleted", "assignment_id": str(assignment_id)}
