"""services/cohort_assignment_service.py — Sprint 19.2 cohort fan-out.

"Giao bài theo lớp": create one writing_assignments row per student in a
cohort from a single template. Cohort membership is derived from
students.cohort_id (Discovery D1 — no cohort_id on writing_assignments,
no new tables).

Idempotent by (student_id, prompt_id): a student who already has an
assignment for this prompt is skipped, so re-running the same fan-out
never double-assigns. The insert is a single bulk call (atomic — no
partial fan-out).

Pure-ish: takes the supabase client as `db` so it unit-tests with a
MagicMock, mirroring how the routers keep DB calls thin.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

logger = logging.getLogger(__name__)


def fan_out_assignment(
    db,
    *,
    prompt_id: UUID,
    cohort_id: UUID,
    assigned_by: str,
    deadline: Optional[datetime] = None,
    instructions: Optional[str] = None,
    is_timed: bool = False,
    time_limit_minutes: Optional[int] = None,
) -> dict:
    """Fan a prompt out to every student in `cohort_id`.

    Returns:
        {
          "student_count":  <total students in cohort>,
          "created_count":  <rows inserted>,
          "skipped_count":  <students who already had this prompt>,
          "assignment_ids": [<new row id>, ...],
        }
    """
    prompt_str = str(prompt_id)
    cohort_str = str(cohort_id)

    students = (
        db.table("students").select("id").eq("cohort_id", cohort_str).execute()
    )
    student_ids = [s["id"] for s in (students.data or [])]
    if not student_ids:
        return {"student_count": 0, "created_count": 0,
                "skipped_count": 0, "assignment_ids": []}

    # Idempotency: which students already have this prompt assigned?
    existing = (
        db.table("writing_assignments")
        .select("student_id")
        .eq("prompt_id", prompt_str)
        .in_("student_id", student_ids)
        .execute()
    )
    already = {row["student_id"] for row in (existing.data or []) if row.get("student_id")}
    new_ids = [sid for sid in student_ids if sid not in already]

    if not new_ids:
        return {"student_count": len(student_ids), "created_count": 0,
                "skipped_count": len(already), "assignment_ids": []}

    deadline_iso = deadline.isoformat() if deadline else None
    payload = [
        {
            "prompt_id":          prompt_str,
            "student_id":         sid,
            "assigned_by":        assigned_by,
            "deadline":           deadline_iso,
            "instructions":       instructions,
            "is_timed":           is_timed,
            "time_limit_minutes": time_limit_minutes,
        }
        for sid in new_ids
    ]

    # Single bulk insert = atomic (no partial fan-out).
    r = db.table("writing_assignments").insert(payload).execute()
    created = r.data or []

    logger.info(
        "[cohort-fanout] cohort=%s prompt=%s by=%s created=%d skipped=%d at=%s",
        cohort_str, prompt_str, assigned_by, len(created), len(already),
        datetime.now(timezone.utc).isoformat(),
    )

    return {
        "student_count":  len(student_ids),
        "created_count":  len(created),
        "skipped_count":  len(already),
        "assignment_ids": [row["id"] for row in created if row.get("id")],
    }
