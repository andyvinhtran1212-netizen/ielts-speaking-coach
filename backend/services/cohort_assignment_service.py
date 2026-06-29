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


def _verify_fanout_ownership(db, owner: str, prompt_strs: list[str], cohort_str: str) -> None:
    """W-3 — fail-closed ownership gate for instructor fan-out. Raises
    PermissionError unless the cohort AND every prompt are owned by `owner`.
    (Student-branch ownership is checked in fan_out_assignment, after the cohort
    membership query.) Admin path does NOT call this (owner_id stays None)."""
    crow = (db.table("cohorts").select("id, created_by")
            .eq("id", cohort_str).limit(1).execute().data or [None])[0]
    if not crow or crow.get("created_by") != owner:
        raise PermissionError(f"fan_out: cohort {cohort_str} không thuộc instructor {owner}")

    prows = (db.table("writing_prompts").select("id, created_by")
             .in_("id", prompt_strs).execute().data or [])
    found = {r["id"] for r in prows}
    missing = set(prompt_strs) - found
    if missing:
        raise PermissionError(f"fan_out: prompt(s) không tồn tại: {sorted(missing)}")
    bad = [r["id"] for r in prows if r.get("created_by") != owner]
    if bad:
        raise PermissionError(f"fan_out: prompt(s) không thuộc instructor {owner}: {sorted(bad)}")


def fan_out_assignment(
    db,
    *,
    prompt_ids: list[UUID],
    cohort_id: UUID,
    assigned_by: str,
    owner_id: Optional[str] = None,
    name: Optional[str] = None,
    allow_soft_check: bool = False,
    deadline: Optional[datetime] = None,
    instructions: Optional[str] = None,
    is_timed: bool = False,
    time_limit_minutes: Optional[int] = None,
    analysis_level: int = 3,
    grading_tier: str = "standard",
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

    # W-3 — instructor mode (owner_id set): fail-closed ownership enforcement.
    # owner_id None = admin/legacy path → unchanged (admin fans any prompt/cohort).
    if owner_id is not None:
        _verify_fanout_ownership(db, str(owner_id), prompt_strs, cohort_str)

    students = (
        db.table("students").select("id, instructor_id").eq("cohort_id", cohort_str).execute()
    )
    student_rows = students.data or []
    student_ids = [s["id"] for s in student_rows]

    # W-3 — student-branch gate. Cohort ownership (above) is the primary gate; here
    # we reject ONLY if a cohort member is owned by ANOTHER instructor
    # (instructor_id SET ≠ owner). NULL (unowned in my own cohort) is allowed —
    # claiming it (instructor_id = me) is an enroll/assign flow (W-5/W-6), not a
    # W-3 gate. Cross-tenant student in my cohort = anomaly → reject loud.
    if owner_id is not None:
        foreign = sorted(
            s["id"] for s in student_rows
            if s.get("instructor_id") not in (None, str(owner_id))
        )
        if foreign:
            raise PermissionError(
                f"fan_out: cohort {cohort_str} chứa học viên thuộc instructor khác: {foreign}"
            )

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
            "analysis_level":      analysis_level,
            "grading_tier":        grading_tier,
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
