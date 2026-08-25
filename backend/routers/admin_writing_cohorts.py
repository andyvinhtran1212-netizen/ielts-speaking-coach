"""routers/admin_writing_cohorts.py — Sprint 19.2 cohort admin views.

Cohort-level writing overview from active memberships and the stamped origin
on new cohort fan-outs. Legacy rows without provenance remain visible through
the historical membership fallback. All admin-only.

  GET /admin/writing/cohorts                                   — list + activity summary
  GET /admin/writing/cohorts/{cohort_id}                       — student × assignment matrix
  GET /admin/writing/cohorts/{cohort_id}/students/{sid}/essays — drill: one student's essays

Cell status is the ADMIN operational view — full backend states surface
here (Pattern #11: the 4-state student-facing collapse from 19.1A does NOT
apply to admin chrome). Queries are separate indexed selects + a Python
join (no PostgREST embed naming dependency, no N+1): memberships,
writing_assignments(student_id), writing_prompts(id), writing_essays(id).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException

from database import supabase_admin
from routers.admin import require_admin
from services.class_membership_service import (
    active_memberships_for_cohorts,
    active_students_for_cohort,
    student_is_active_in_cohort,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/admin/writing/cohorts",
    tags=["admin-writing-cohorts"],
)

# Cell status considered "in-flight" (submitted, awaiting delivery).
_PENDING_CELL = {"pending", "submitted", "grading", "graded", "reviewed", "not_submitted"}


def _cell_status(assignment: dict, essay: dict | None) -> str:
    """Derive the admin matrix cell status.

    essay present  → its backend status (flagged wins, since a flagged
                     essay carries status='delivered' with no feedback).
    no essay        → 'delivered' if the admin force-delivered the
                     assignment, else 'not_submitted'."""
    if essay:
        if essay.get("is_flagged"):
            return "flagged"
        return essay.get("status") or "pending"
    if (assignment.get("status") or "") == "delivered":
        return "delivered"
    return "not_submitted"


def _column_key(assignment: dict) -> str:
    """Return the identity of one real give × prompt column.

    A prompt can be assigned repeatedly in different lessons.  Using only
    ``prompt_id`` silently collapsed those gives and made whichever row was
    iterated last win.  New writes always carry ``assignment_group_id``; old
    standalone rows fall back to their immutable assignment id so no history
    is hidden.
    """
    group_id = assignment.get("assignment_group_id")
    prompt_id = assignment.get("prompt_id") or "missing-prompt"
    if group_id:
        return f"group:{group_id}:prompt:{prompt_id}"
    return f"legacy:{assignment['id']}"


def _is_overdue(deadline: str | None, now: datetime | None = None) -> bool:
    """Compare deadlines as instants instead of lexicographic ISO strings."""
    if not deadline:
        return False
    try:
        parsed = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError):
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return parsed < current


def _fetch_bands_by_essay_ids(essay_ids: list[str]) -> dict[str, float | None]:
    """overall_band_score lives on writing_feedback (one row per essay —
    essay_id is UNIQUE there), NOT on writing_essays. Fetch the bands
    separately so cohort views can show them without selecting a column the
    essays table never had (that mismatch 500-ed the class-list endpoints)."""
    if not essay_ids:
        return {}
    rows = (
        # GV-1a: current version per essay (via the writing_feedback_current view)
        supabase_admin.table("writing_feedback_current")
        .select("essay_id, overall_band_score")
        .in_("essay_id", essay_ids)
        .execute()
    ).data or []
    return {r["essay_id"]: r.get("overall_band_score") for r in rows}


def _fetch_essays_by_ids(essay_ids: list[str]) -> dict[str, dict]:
    if not essay_ids:
        return {}
    rows = (
        supabase_admin.table("writing_essays")
        .select("id, status, is_flagged")
        .in_("id", essay_ids)
        .is_("deleted_at", "null")          # exclude soft-deleted from cohort stats
        .execute()
    ).data or []
    # Merge the band from writing_feedback (its canonical home) under the
    # same key callers already read.
    bands = _fetch_bands_by_essay_ids([e["id"] for e in rows])
    for e in rows:
        e["overall_band_score"] = bands.get(e["id"])
    return {e["id"]: e for e in rows}


@router.get("")
async def list_cohorts(authorization: str | None = Header(None)):
    """Active cohorts with a writing-activity summary, busiest first."""
    await require_admin(authorization)

    cohorts = (
        supabase_admin.table("cohorts")
        .select("id, name, description")
        .eq("is_active", True)
        .order("name")
        .execute()
    ).data or []
    if not cohorts:
        return {"cohorts": []}

    cohort_ids = [c["id"] for c in cohorts]
    memberships = active_memberships_for_cohorts(supabase_admin, cohort_ids)
    student_cohorts: dict[str, set[str]] = {}
    for membership in memberships:
        student_cohorts.setdefault(membership["student_id"], set()).add(
            membership["cohort_id"])
    student_ids = list(student_cohorts)

    assignments = []
    if student_ids:
        assignments = (
            supabase_admin.table("writing_assignments")
            .select("student_id, cohort_id, essay_id, status")
            .in_("student_id", student_ids)
            .execute()
        ).data or []
    essays = _fetch_essays_by_ids([a["essay_id"] for a in assignments if a.get("essay_id")])

    summary = {cid: {"student_count": 0, "active_assignments": 0,
                     "essays_pending": 0, "essays_delivered": 0} for cid in cohort_ids}
    for memberships_for_student in student_cohorts.values():
        for cid in memberships_for_student:
            summary[cid]["student_count"] += 1
    for a in assignments:
        origin = a.get("cohort_id")
        cids = ({origin} if origin else student_cohorts.get(a["student_id"], set()))
        if not cids:
            continue
        cell = _cell_status(a, essays.get(a.get("essay_id")))
        for cid in cids:
            # A learner may retain Writing history stamped to a cohort that is
            # now archived while belonging to another active cohort.  This
            # endpoint summarizes active cohorts only; historical origins must
            # not be re-attributed to the learner's current class or index a
            # non-existent summary bucket.
            if cid not in summary:
                continue
            st = summary[cid]
            if cell not in ("delivered", "failed"):
                st["active_assignments"] += 1
            if cell in _PENDING_CELL and cell != "not_submitted":
                st["essays_pending"] += 1
            elif cell == "delivered":
                st["essays_delivered"] += 1

    out = [{**c, **summary[c["id"]]} for c in cohorts]
    out.sort(key=lambda c: (c["active_assignments"], c["student_count"]), reverse=True)
    return {"cohorts": out}


@router.get("/{cohort_id}")
async def cohort_detail(cohort_id: UUID, authorization: str | None = Header(None)):
    """Student × assignment matrix for one cohort.

    matrix[student_id][column_id] = {assignment_id, status, essay_id,
    deadline, band}. Columns are distinct give/group × prompt identities,
    ordered by earliest assignment. Sparse: a missing (student, give × prompt)
    pair simply has no key (the UI renders '—')."""
    await require_admin(authorization)

    cohort_rows = (
        supabase_admin.table("cohorts")
        .select("id, name, description")
        .eq("id", str(cohort_id))
        .limit(1)
        .execute()
    ).data or []
    if not cohort_rows:
        raise HTTPException(404, "Không tìm thấy lớp.")
    cohort = cohort_rows[0]

    students = active_students_for_cohort(
        supabase_admin, str(cohort_id), "id, full_name, student_code")
    students.sort(key=lambda row: (row.get("full_name") or "").casefold())
    student_ids = [s["id"] for s in students]

    assignments = []
    if student_ids:
        assignments = (
            supabase_admin.table("writing_assignments")
            .select("id, student_id, cohort_id, prompt_id, essay_id, status, deadline, created_at, updated_at, assignment_group_id, name")
            .in_("student_id", student_ids)
            .or_(f"cohort_id.eq.{cohort_id},cohort_id.is.null")
            .order("created_at")
            .execute()
        ).data or []
        # Defense in depth for non-PostgREST callers/test doubles. NULL means
        # legacy data whose original cohort was never persisted.
        assignments = [a for a in assignments
                       if not a.get("cohort_id") or str(a["cohort_id"]) == str(cohort_id)]

    prompt_ids = sorted({a["prompt_id"] for a in assignments if a.get("prompt_id")})
    prompts = {}
    if prompt_ids:
        prows = (
            supabase_admin.table("writing_prompts")
            .select("id, title, task_type")
            .in_("id", prompt_ids)
            .execute()
        ).data or []
        prompts = {p["id"]: p for p in prows}
    essays = _fetch_essays_by_ids([a["essay_id"] for a in assignments if a.get("essay_id")])

    # Columns represent a real give × prompt, not merely a prompt.  Re-giving
    # the same prompt in another lesson must remain a separate column.
    columns_by_id: dict[str, dict] = {}
    for a in assignments:
        pid = a.get("prompt_id")
        if not pid:
            continue
        column_id = _column_key(a)
        if column_id not in columns_by_id:
            prompt = prompts.get(pid, {})
            columns_by_id[column_id] = {
                "id": column_id,
                "prompt_id": pid,
                "group_id": a.get("assignment_group_id"),
                "name": a.get("name"),
                "title": prompt.get("title") or "(Đề đã xóa)",
                "task_type": prompt.get("task_type"),
                "assigned_at": a.get("created_at"),
            }
    assignment_cols = list(columns_by_id.values())

    matrix: dict[str, dict] = {sid: {} for sid in student_ids}
    stats = {"students": len(students), "assignments": len(assignments),
             "essays_pending": 0, "essays_delivered": 0, "overdue": 0}
    now = datetime.now(timezone.utc)
    for a in assignments:
        sid, pid = a.get("student_id"), a.get("prompt_id")
        if sid not in matrix or not pid:
            continue
        column_id = _column_key(a)
        essay = essays.get(a.get("essay_id"))
        cell = _cell_status(a, essay)
        matrix[sid][column_id] = {
            "assignment_id": a["id"],
            "status":        cell,
            "essay_id":      a.get("essay_id"),
            "deadline":      a.get("deadline"),
            "updated_at":    a.get("updated_at"),
            "band":          (essay or {}).get("overall_band_score"),
        }
        if cell in _PENDING_CELL and cell != "not_submitted":
            stats["essays_pending"] += 1
        elif cell == "delivered":
            stats["essays_delivered"] += 1
        # Overdue = deadline passed and not delivered.
        dl = a.get("deadline")
        # A flagged essay carries canonical essay status=delivered; the flag is
        # an operational issue, not an overdue submission.
        if _is_overdue(dl, now) and cell not in ("delivered", "flagged"):
            stats["overdue"] += 1

    return {
        "cohort":      {**cohort, "student_count": len(students)},
        "students":    students,
        "assignments": assignment_cols,
        "matrix":      matrix,
        "stats":       stats,
    }


@router.get("/{cohort_id}/students/{student_id}/essays")
async def cohort_student_essays(
    cohort_id: UUID,
    student_id: UUID,
    authorization: str | None = Header(None),
):
    """Drill into one student's essays within a cohort (admin cell click).
    Verifies the student belongs to the cohort before returning."""
    await require_admin(authorization)

    if not student_is_active_in_cohort(
        supabase_admin, str(student_id), str(cohort_id)
    ):
        raise HTTPException(404, "Học viên không thuộc lớp này.")

    essays = (
        supabase_admin.table("writing_essays")
        .select("id, task_type, status, is_flagged, created_at")
        .eq("student_id", str(student_id))
        .order("created_at", desc=True)
        .execute()
    ).data or []
    # Band lives on writing_feedback, not writing_essays — merge it in.
    bands = _fetch_bands_by_essay_ids([e["id"] for e in essays])
    for e in essays:
        e["overall_band_score"] = bands.get(e["id"])
    return {"essays": essays}
