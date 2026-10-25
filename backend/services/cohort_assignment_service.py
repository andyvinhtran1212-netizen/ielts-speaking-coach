"""services/cohort_assignment_service.py — Sprint 19.2 cohort fan-out.

"Giao bài theo lớp": create one writing_assignments row per
(student × prompt) for a cohort from a single template. The canonical active
membership roster selects recipients, and every new row records its cohort.

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

from services.class_membership_service import active_students_for_cohort

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

    student_rows = active_students_for_cohort(db, cohort_str, "id, instructor_id")
    if not student_rows:
        # Rolling compatibility with a backend/test fixture that predates
        # migration 227. The migration backfill makes this branch dormant in
        # production after rollout.
        legacy = (db.table("students").select("id, instructor_id")
                  .eq("cohort_id", cohort_str).execute().data) or []
        student_rows = legacy if isinstance(legacy, list) else []
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
            "cohort_id":           cohort_str,
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


# Fields that make up a fan-out "template" — every row created by the same
# give (group × prompt) shares these, so copying them onto a late joiner
# reproduces the give faithfully. `status` is intentionally reset to the
# initial 'pending' state (a new student has not opened the assignment).
_BACKFILL_TEMPLATE_FIELDS = (
    "assignment_group_id", "name", "allow_soft_check", "assigned_by",
    "deadline", "instructions", "is_timed", "time_limit_minutes",
    "analysis_level", "grading_tier",
)


_PAGE = 1000


def _paged(query_factory, order_col: str = "id") -> list:
    """Read every row the query matches, one PostgREST page at a time.

    A single ``.execute()`` silently caps at the PostgREST row limit (~1000),
    and that limit counts per-student rows, not distinct gives: 25 students ×
    40 prompts already fill a page, so a bare read would drop open gives beyond
    it and a late joiner could receive no homework despite open gives existing
    (and the reconciliation script, sharing this helper, could not repair it).
    Stable ordering by ``order_col`` keeps the page boundary consistent so rows
    are neither skipped nor repeated across pages."""
    rows: list = []
    start = 0
    while True:
        page = (query_factory().order(order_col)
                .range(start, start + _PAGE - 1).execute().data) or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _deadline_is_open(deadline, now_iso: str) -> bool:
    """An assignment is still open to a late joiner when it has no deadline or
    the deadline has not passed. Compares ISO-8601 timestamps lexicographically
    after normalising to a comparable shape — both come from the same column so
    they share a format; on any parse ambiguity we fail OPEN (backfill it) so a
    joiner is never silently denied homework."""
    if not deadline:
        return True
    try:
        return str(deadline) >= now_iso
    except Exception:
        return True


def backfill_cohort_writing_assignments(
    db, *, student_id: str, cohort_id: str, now: Optional[datetime] = None,
) -> dict:
    """Give a newly-enrolled student the cohort's still-open writing gives.

    `fan_out_assignment` snapshots the active roster at give-time, so a student
    who joins a class LATER has no `writing_assignments` row for gives already
    fanned out to that cohort — they see "Chưa có bài giao nào" while classmates
    have the homework (bug E1). This reconciles that gap: for every distinct open
    (deadline NULL or in the future) give already fanned out to the cohort, it
    inserts one row for this student, copying the give's template and resetting
    status to 'pending'. Idempotent — a (group, prompt) the student already has
    is skipped, so re-running (or a double redemption) creates nothing new.

    Returns {"created_count": int, "assignment_ids": [...]}.
    """
    sid = str(student_id)
    cohort_str = str(cohort_id)
    now_iso = (now or datetime.now(timezone.utc)).isoformat()

    cohort_rows = _paged(lambda: (
        db.table("writing_assignments")
        .select("prompt_id, " + ", ".join(_BACKFILL_TEMPLATE_FIELDS))
        .eq("cohort_id", cohort_str)
    ))
    if not cohort_rows:
        return {"created_count": 0, "assignment_ids": []}

    mine = _paged(lambda: (
        db.table("writing_assignments")
        .select("prompt_id, assignment_group_id")
        .eq("student_id", sid)
        .eq("cohort_id", cohort_str)
    ))
    have = {(r.get("assignment_group_id"), r.get("prompt_id")) for r in mine}

    # Collapse the per-student cohort rows into one template per (group, prompt).
    templates: dict = {}
    for row in cohort_rows:
        key = (row.get("assignment_group_id"), row.get("prompt_id"))
        if key in templates or key in have:
            continue
        if not _deadline_is_open(row.get("deadline"), now_iso):
            continue
        templates[key] = row

    if not templates:
        return {"created_count": 0, "assignment_ids": []}

    payload = [
        {
            "prompt_id":  prompt_id,
            "student_id": sid,
            "cohort_id":  cohort_str,
            "status":     "pending",
            **{f: tmpl.get(f) for f in _BACKFILL_TEMPLATE_FIELDS},
        }
        for (_group, prompt_id), tmpl in templates.items()
    ]
    created = (db.table("writing_assignments").insert(payload).execute()).data or []

    logger.info(
        "[cohort-backfill] student=%s cohort=%s open_templates=%d created=%d at=%s",
        sid, cohort_str, len(templates), len(created), now_iso,
    )
    return {
        "created_count":  len(created),
        "assignment_ids": [row["id"] for row in created if row.get("id")],
    }
