"""services/cohort_assignment_service.py — Sprint 19.2 cohort fan-out.

"Giao bài theo lớp": create one writing_assignments row per
(student × prompt) for a cohort from a single template. Cohort
membership is derived from students.cohort_id (Discovery D1 — no
cohort_id on writing_assignments, no new tables).

W-ASSIGN: a single fan-out can carry N prompts and stamps every row it
creates with a shared `assignment_group_id` + `name` + `allow_soft_check`
so the UIs group them ("Buổi 5"). The give is ALLOW + WARN (NOT skip):
re-giving a prompt a student already has — e.g. in a new Buổi — is a
legitimate action, so we create the rows and report the overlap as
`duplicates_warning` instead of silently skipping. (Pre-W-ASSIGN this
was idempotent-skip; grouping made the skip wrong.)

The insert is a single bulk call (atomic — no partial fan-out).

Pure-ish: takes the supabase client as `db` so it unit-tests with a
MagicMock, mirroring how the routers keep DB calls thin.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

logger = logging.getLogger(__name__)


def fan_out_assignment(
    db,
    *,
    prompt_ids: list[UUID],
    cohort_id: UUID,
    assigned_by: str,
    name: Optional[str] = None,
    allow_soft_check: bool = False,
    deadline: Optional[datetime] = None,
    instructions: Optional[str] = None,
    is_timed: bool = False,
    time_limit_minutes: Optional[int] = None,
) -> dict:
    """Fan N prompts out to every student in `cohort_id` as one group.

    Returns:
        {
          "student_count":      <total students in cohort>,
          "created_count":      <rows inserted (= students × prompts)>,
          "group_id":           <uuid shared by every created row>,
          "duplicates_warning": [<student_id who already had a prompt>, ...],
          "assignment_ids":     [<new row id>, ...],
        }
    """
    prompt_strs = [str(p) for p in prompt_ids]
    cohort_str = str(cohort_id)

    students = (
        db.table("students").select("id").eq("cohort_id", cohort_str).execute()
    )
    student_ids = [s["id"] for s in (students.data or [])]
    if not student_ids:
        return {"student_count": 0, "created_count": 0,
                "group_id": None, "duplicates_warning": [], "assignment_ids": []}

    # Advisory overlap (allow + warn): students who already had any of
    # these prompts. We still create their new rows.
    try:
        existing = (
            db.table("writing_assignments")
            .select("student_id")
            .in_("prompt_id", prompt_strs)
            .in_("student_id", student_ids)
            .execute()
        )
        already = {row["student_id"] for row in (existing.data or []) if row.get("student_id")}
    except Exception:
        already = set()

    group_id = str(uuid4())
    deadline_iso = deadline.isoformat() if deadline else None
    payload = [
        {
            "prompt_id":           pid,
            "student_id":          sid,
            "assignment_group_id": group_id,
            "name":                name,
            "allow_soft_check":    allow_soft_check,
            "assigned_by":         assigned_by,
            "deadline":            deadline_iso,
            "instructions":        instructions,
            "is_timed":            is_timed,
            "time_limit_minutes":  time_limit_minutes,
        }
        for sid in student_ids
        for pid in prompt_strs
    ]

    # Single bulk insert = atomic (no partial fan-out).
    r = db.table("writing_assignments").insert(payload).execute()
    created = r.data or []

    logger.info(
        "[cohort-fanout] cohort=%s prompts=%d students=%d by=%s created=%d dup_warn=%d group=%s at=%s",
        cohort_str, len(prompt_strs), len(student_ids), assigned_by,
        len(created), len(already), group_id,
        datetime.now(timezone.utc).isoformat(),
    )

    return {
        "student_count":      len(student_ids),
        "created_count":      len(created),
        "group_id":           group_id,
        "duplicates_warning": sorted(already),
        "assignment_ids":     [row["id"] for row in created if row.get("id")],
    }
