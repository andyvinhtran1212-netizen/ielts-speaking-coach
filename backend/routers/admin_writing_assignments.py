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
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator

from database import supabase_admin
from routers.admin import require_admin
from services.cohort_assignment_service import fan_out_assignment


router = APIRouter(
    prefix="/admin/writing/assignments",
    tags=["admin-writing-assignments"],
)


_STATUS_PATTERN = r"^(pending|in_progress|submitted|graded|delivered)$"


# Sprint 2.7 fix #2: explicit state-machine matrix for admin PATCH.
# Codex AMBER finding called out the pre-2.7 PATCH handler accepting
# any status value within the regex, including illegal jumps like
# `pending → graded` that skip the grader queue and orphan a row.
#
# Allowed transitions:
#   pending     → in_progress (admin nudges to "started" without a draft save)
#                 delivered   (admin override — student emailed essay manually)
#   in_progress → submitted   (admin advances after seeing draft progress)
#                 delivered   (admin override path same as above)
#   submitted   → graded      (Andy's normal grading workflow)
#                 delivered   (admin shortcuts grading on a flagged row)
#   graded      → delivered   (Andy delivers after editing AI output)
#   delivered   → ()          (terminal — no further transitions)
#
# Idempotent same-status writes are allowed (admin re-saves the row
# without changing status); the transition validator returns early
# when current == target.
_ALLOWED_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "pending":     {"in_progress", "delivered"},
    "in_progress": {"submitted",   "delivered"},
    "submitted":   {"graded",      "delivered"},
    "graded":      {"delivered"},
    "delivered":   set(),
}


def _validate_status_transition(current: str, target: str) -> None:
    """Raise HTTPException(409) when admin tries to move a row to
    a status not reachable from `current` per the matrix above.

    Same-status writes are no-ops so the admin UI can re-save
    deadline / instructions without re-validating the workflow."""
    if current == target:
        return
    allowed = _ALLOWED_STATUS_TRANSITIONS.get(current, set())
    if target not in allowed:
        allowed_str = ", ".join(sorted(allowed)) if allowed else "(terminal state)"
        raise HTTPException(
            409,
            f"Cannot transition from '{current}' to '{target}'. "
            f"Allowed: {allowed_str}.",
        )


# ── Helpers ───────────────────────────────────────────────────────────


def _now_iso() -> str:
    """ISO-8601 UTC timestamp.  We stamp these in Python rather than
    pushing the literal string `"now()"` to Supabase — the python
    client doesn't translate `now()` into a SQL function, it stores
    the literal string and breaks downstream queries."""
    return datetime.now(timezone.utc).isoformat()


# ── Request bodies ────────────────────────────────────────────────────


class AssignmentCreate(BaseModel):
    """N prompts → one or more students.  Every (prompt × student) pair
    becomes its own writing_assignments row (each prompt is graded
    separately — IELTS T1/T2 are distinct essays).  The rows created by
    one call share an `assignment_group_id` + `name` so the UIs can
    group them ("Buổi 5: Task 1 + Task 2").  Cap at 100 students.

    W-ASSIGN: `prompt_ids` (multi) is the new field; `prompt_id` (single)
    is accepted for back-compat with the pre-W-ASSIGN admin UI — exactly
    one of the two must be provided, and both normalize to `prompt_ids`.

    Phase 2.3c-3: `is_timed` + `time_limit_minutes` opt the assignment
    into IELTS-exam mode.  The pair is enforced together (one without
    the other is a 422) — the same invariant the migration's CHECK
    constraint enforces at the DB layer.
    """
    prompt_id:           Optional[UUID]       = None   # legacy single (back-compat)
    prompt_ids:          Optional[list[UUID]] = Field(None, max_length=20)
    student_ids:         list[UUID]         = Field(..., min_length=1, max_length=100)
    name:                Optional[str]      = Field(None, max_length=200)
    allow_soft_check:    bool               = False
    deadline:            Optional[datetime] = None
    instructions:        Optional[str]      = Field(None, max_length=2000)
    is_timed:            bool               = False
    time_limit_minutes:  Optional[int]      = Field(None, ge=1, le=180)
    # AI feedback depth L1–L5 (mig 104). Default 3 = the value the student-submit
    # path hardcoded before this feature → back-compat for callers that omit it
    # (incl. the Student-Hub deep-link create-modal reuse, #484).
    analysis_level:      int                = Field(3, ge=1, le=5)

    @model_validator(mode="after")
    def _coalesce_prompts(self):
        """Normalize `prompt_id` (legacy) + `prompt_ids` (new) into a
        single non-empty, de-duplicated `prompt_ids` list. Exactly one
        source must be provided."""
        ids = list(self.prompt_ids) if self.prompt_ids else []
        if self.prompt_id is not None:
            ids.append(self.prompt_id)
        # de-dup preserving order
        seen: set = set()
        deduped = [p for p in ids if not (p in seen or seen.add(p))]
        if not deduped:
            raise ValueError("provide prompt_id or prompt_ids (at least one prompt)")
        self.prompt_ids = deduped
        return self

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
    cohort_id:  Optional[UUID] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status_filter",
                                          pattern=_STATUS_PATTERN),
    limit: int = Query(default=200, ge=1, le=500),
    authorization: str | None = Header(None),
):
    """List assignments with optional filters, newest first.  The
    response embeds the joined prompt (id/title/task_type/difficulty)
    and student (id/student_code/full_name) so the admin list view
    doesn't need a second round-trip.

    Sprint 19.2: `cohort_id` filters to assignments whose student belongs
    to that cohort (derived via students.cohort_id — Discovery D1)."""
    await require_admin(authorization)

    # Resolve cohort → student_ids before querying assignments.
    cohort_student_ids: Optional[list[str]] = None
    if cohort_id:
        srows = (
            supabase_admin.table("students")
            .select("id")
            .eq("cohort_id", str(cohort_id))
            .execute()
        ).data or []
        cohort_student_ids = [s["id"] for s in srows]
        if not cohort_student_ids:
            return {"assignments": []}

    q = (
        supabase_admin.table("writing_assignments")
        .select(
            "id, status, deadline, instructions, created_at, "
            "submitted_at, graded_at, delivered_at, "
            "essay_id, prompt_id, student_id, "
            "assignment_group_id, name, allow_soft_check, "
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
    if cohort_student_ids is not None:
        q = q.in_("student_id", cohort_student_ids)
    if status_filter:
        q = q.eq("status", status_filter)

    r = q.execute()
    return {"assignments": r.data or []}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_assignments(
    body: AssignmentCreate,
    authorization: str | None = Header(None),
):
    """Create assignments for N prompts × M students as one group.

    Every (prompt × student) pair becomes its own row; all rows from
    this call share a fresh `assignment_group_id` + the given `name` +
    `allow_soft_check`.  Each prompt is still its own row/essay/feedback
    — grouping is only a label, the downstream pipeline is unchanged.

    Returns:
        {
            "created":             [<row>, ...],
            "count":               <int>,
            "group_id":            <uuid>,
            "duplicates_warning":  [<student_id>, ...],
        }

    `duplicates_warning` lists student_ids that ALREADY had at least one
    assignment for ANY of these prompts before this insert — rows are
    still created (allow + warn policy from 2026-05-06).
    """
    admin = await require_admin(authorization)

    student_id_strs = [str(s) for s in body.student_ids]
    prompt_id_strs = [str(p) for p in body.prompt_ids]

    # Detect existing duplicates (any of these prompts + student) for the
    # advisory warning. Best-effort — never blocks the insert.
    duplicate_student_ids: set[str] = set()
    try:
        existing = (
            supabase_admin.table("writing_assignments")
            .select("student_id")
            .in_("prompt_id", prompt_id_strs)
            .in_("student_id", student_id_strs)
            .execute()
        )
        duplicate_student_ids = {row["student_id"] for row in (existing.data or [])
                                  if row.get("student_id")}
    except Exception:
        duplicate_student_ids = set()

    # One group id for this give-action, shared across every row.
    group_id = str(uuid4())
    deadline_iso = body.deadline.isoformat() if body.deadline else None
    payload = [
        {
            "prompt_id":           pid,
            "student_id":          sid,
            "assignment_group_id": group_id,
            "name":                body.name,
            "allow_soft_check":    body.allow_soft_check,
            "assigned_by":         admin["id"],
            "deadline":            deadline_iso,
            "instructions":        body.instructions,
            "is_timed":            body.is_timed,
            "time_limit_minutes":  body.time_limit_minutes,
            "analysis_level":      body.analysis_level,
        }
        for sid in student_id_strs
        for pid in prompt_id_strs
    ]

    r = supabase_admin.table("writing_assignments").insert(payload).execute()
    if not r.data:
        raise HTTPException(500, "Failed to create assignments")

    return {
        "created":            r.data,
        "count":              len(r.data),
        "group_id":           group_id,
        "duplicates_warning": sorted(duplicate_student_ids),
    }


# ── Sprint 19.2 — cohort fan-out ("Giao bài theo lớp") ────────────────


class FanOutCreate(BaseModel):
    """N prompts → every student in a cohort. Cohort membership is
    derived from students.cohort_id (Discovery D1). W-ASSIGN: the rows
    share an `assignment_group_id` + `name`; the give is allow + warn
    (NOT skip) so re-giving a prompt in a new "Buổi" works as intended.

    `prompt_id` (single) is accepted for back-compat; both normalize to
    `prompt_ids`."""
    prompt_id:          Optional[UUID]       = None   # legacy single (back-compat)
    prompt_ids:         Optional[list[UUID]] = Field(None, max_length=20)
    cohort_id:          UUID
    name:               Optional[str]      = Field(None, max_length=200)
    allow_soft_check:   bool               = False
    deadline:           Optional[datetime] = None
    instructions:       Optional[str]      = Field(None, max_length=2000)
    is_timed:           bool               = False
    time_limit_minutes: Optional[int]      = Field(None, ge=1, le=180)
    analysis_level:     int                = Field(3, ge=1, le=5)   # AI depth L1–L5 (mig 104)

    @model_validator(mode="after")
    def _coalesce_prompts(self):
        ids = list(self.prompt_ids) if self.prompt_ids else []
        if self.prompt_id is not None:
            ids.append(self.prompt_id)
        seen: set = set()
        deduped = [p for p in ids if not (p in seen or seen.add(p))]
        if not deduped:
            raise ValueError("provide prompt_id or prompt_ids (at least one prompt)")
        self.prompt_ids = deduped
        return self

    @model_validator(mode="after")
    def _validate_timer_pairing(self):
        if self.is_timed and self.time_limit_minutes is None:
            raise ValueError("time_limit_minutes is required when is_timed=true")
        if not self.is_timed and self.time_limit_minutes is not None:
            raise ValueError("time_limit_minutes only allowed when is_timed=true")
        return self


# Declared BEFORE the `/{assignment_id}` parametric routes so the matcher
# doesn't read "fan-out" as a UUID (mirrors prompts/upload-image ordering).
@router.post("/fan-out", status_code=status.HTTP_201_CREATED)
async def fan_out_to_cohort(
    body: FanOutCreate,
    authorization: str | None = Header(None),
):
    """Create assignments for N prompts × every student in the cohort,
    as one group. Returns counts so the UI can confirm "Đã giao cho X
    học viên" + a duplicates_warning for students who already had any of
    these prompts (allow + warn — re-giving in a new Buổi is intended)."""
    admin = await require_admin(authorization)

    result = fan_out_assignment(
        supabase_admin,
        prompt_ids=body.prompt_ids,
        cohort_id=body.cohort_id,
        assigned_by=admin["id"],
        name=body.name,
        allow_soft_check=body.allow_soft_check,
        deadline=body.deadline,
        instructions=body.instructions,
        is_timed=body.is_timed,
        time_limit_minutes=body.time_limit_minutes,
        analysis_level=body.analysis_level,
    )
    if result["student_count"] == 0:
        raise HTTPException(400, "Lớp này chưa có học viên nào.")
    return result


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
        # Sprint 2.7 fix #2: validate the requested transition against
        # the explicit state-machine matrix. We fetch the current
        # status BEFORE building the patch so an illegal jump fails
        # fast (409) without an UPDATE round-trip.
        current_resp = (
            supabase_admin.table("writing_assignments")
            .select("status")
            .eq("id", str(assignment_id))
            .limit(1)
            .execute()
        )
        if not current_resp.data:
            raise HTTPException(404, "Assignment not found")
        current_status = current_resp.data[0]["status"]

        new_status = fields["status"]
        _validate_status_transition(current_status, new_status)

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
