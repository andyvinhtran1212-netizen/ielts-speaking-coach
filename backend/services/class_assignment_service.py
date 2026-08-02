"""services/class_assignment_service.py — giao bài cho lớp (GĐ 2).

Giai đoạn 2 của docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md. Writes the ledger
introduced by migration 177: one `class_assignments` row per give, one
`class_assignment_items` row per student on the roster.

NOT the same thing as services/cohort_assignment_service.py, despite the similar
name. That one fans a writing prompt out into `writing_assignments` and feeds the
Writing grading pipeline; this one writes the skill-agnostic ledger that sits
ABOVE the per-skill pipelines. GĐ 2 uses it for Speaking only.

── The two rules this module exists to enforce ──────────────────────────────

**Deadlines are wall-clock time in Vietnam.** The centre's rule is "nộp trước 7h
tối". `compose_due_at` builds that from a date via ZoneInfo("Asia/Ho_Chi_Minh"),
in one place, and every caller goes through it. Splitting a timezone rule across
SQL defaults and Python is how this repo already shipped a day-boundary bug that
CI — which runs at UTC — could not see.

**Lateness is derived, never stored.** There is no `is_late` column and no
`missed` state, on purpose (migration 177 header): a stored flag disagrees with
the timestamps the moment an admin extends a deadline, and "missed" would need a
cron job to stay true. `progress_for_assignments` computes both at read time:

    late   = submitted_at > due_at
    missed = submitted_at IS NULL AND due_at < now()

── Fan-out is a snapshot ────────────────────────────────────────────────────

Items are created eagerly, one per student on the roster at the moment of the
give — the whole point is knowing who has NOT submitted, and a row that does not
exist cannot represent absence. A student who joins next week does not
retroactively owe last week's homework; an admin who wants to catch them up
re-gives the task.

Students with `user_id IS NULL` still get an item (they are on the roster and the
teacher's list must be complete) but they have no account, so nothing is ever
shown to them. The count comes back as `unactivated_count` and the caller is
expected to surface it — assigning into silence without saying so is the exact
failure mode the project rules forbid.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

# The centre teaches in Vietnam and the deadline is a wall-clock rule ("7h tối"),
# so this is a property of the business, not of the server's locale.
CLASS_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
DEFAULT_DUE_TIME = time(19, 0)

_PAGE = 1000   # PostgREST's implicit ceiling — see services/class_service.py


def compose_due_at(due_date: Optional[str | date], due_time: time = DEFAULT_DUE_TIME) -> Optional[str]:
    """`due_date` + 19:00 giờ Việt Nam → an aware ISO-8601 string.

    Returns None for a missing date: an assignment with no deadline is legal and
    is never late and never missed.

    The admin picks a DATE; the time is the centre's rule. Doing this here rather
    than in SQL or in the browser keeps one definition of "7h tối" — the browser
    especially cannot be trusted for it, since an admin travelling abroad would
    otherwise set the deadline in their own timezone.
    """
    if not due_date:
        return None
    d = date.fromisoformat(due_date) if isinstance(due_date, str) else due_date
    return datetime.combine(d, due_time, tzinfo=CLASS_TZ).isoformat()


def _roster_student_ids(db, cohort_id: str) -> List[Dict[str, Any]]:
    """Every student on the class roster, paged.

    Ordered by id because an unordered range is not a stable window: two pages
    could repeat or skip rows, and here that means a student silently not
    receiving the homework.
    """
    rows: List[Dict[str, Any]] = []
    start = 0
    while True:
        page = (
            db.table("students")
            .select("id, user_id, full_name")
            .eq("cohort_id", cohort_id)
            .order("id")
            .range(start, start + _PAGE - 1)
            .execute()
            .data
        ) or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def create_class_assignment(
    db,
    *,
    cohort_id: str,
    skill: str,
    title: str,
    assigned_by: Optional[str] = None,
    lesson_id: Optional[str] = None,
    content_id: Optional[str] = None,
    content_config: Optional[Dict[str, Any]] = None,
    due_date: Optional[str] = None,
    instructions: Optional[str] = None,
    status: str = "published",
) -> Dict[str, Any]:
    """Create one give and its per-student rows.

    Returns the assignment plus `student_count` and `unactivated_count`. A cohort
    with no students returns student_count=0 and creates no items — the caller
    decides whether that is an error (it is, for the admin UI: giving homework to
    nobody is never intended).
    """
    students = _roster_student_ids(db, cohort_id)
    if not students:
        # Checked BEFORE the insert. Returning an error after creating the row
        # would leave a published 0/0 give that reaches nobody — the admin is
        # told "không giao được", reloads, and finds it sitting there anyway.
        raise EmptyRosterError("Lớp này chưa có học viên nào để giao bài.")
    unactivated = [s for s in students if not s.get("user_id")]

    assignment_id = str(uuid4())
    row = {
        "id":             assignment_id,
        "cohort_id":      cohort_id,
        "lesson_id":      lesson_id,
        "skill":          skill,
        "content_id":     content_id,
        "content_config": content_config or {},
        "title":          title,
        "instructions":   instructions,
        "due_at":         compose_due_at(due_date),
        "status":         status,
        "assigned_by":    assigned_by,
    }
    created = (db.table("class_assignments").insert(row).execute().data or [None])[0]
    if not created:
        raise RuntimeError("Không tạo được bài giao")

    # One bulk insert — a partial fan-out would leave some students holding
    # homework the class list does not know about.
    db.table("class_assignment_items").insert([
        {"assignment_id": assignment_id, "student_id": s["id"]}
        for s in students
    ]).execute()

    return {
        **created,
        "student_count":      len(students),
        "unactivated_count":  len(unactivated),
    }


def _items_for_assignments(db, assignment_ids: List[str]) -> List[Dict[str, Any]]:
    if not assignment_ids:
        return []
    rows: List[Dict[str, Any]] = []
    start = 0
    while True:
        page = (
            db.table("class_assignment_items")
            .select("id, assignment_id, student_id, state, submitted_at, score")
            .in_("assignment_id", assignment_ids)
            .order("id")
            .range(start, start + _PAGE - 1)
            .execute()
            .data
        ) or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def progress_for_assignments(
    db,
    assignments: List[Dict[str, Any]],
    *,
    now: Optional[datetime] = None,
) -> Dict[str, Dict[str, int]]:
    """assignment_id → {assigned, submitted, late, missing}.

    `late` and `missing` are computed here from timestamps, never read from a
    column — see the module docstring. `now` is injectable so the boundary
    behaviour is testable without freezing the clock globally.
    """
    now = now or datetime.now(timezone.utc)
    due_by_id: Dict[str, Optional[datetime]] = {}
    for a in assignments:
        raw = a.get("due_at")
        due_by_id[a["id"]] = datetime.fromisoformat(raw) if raw else None

    out: Dict[str, Dict[str, int]] = {
        a["id"]: {"assigned": 0, "submitted": 0, "late": 0, "missing": 0}
        for a in assignments
    }

    for item in _items_for_assignments(db, [a["id"] for a in assignments]):
        bucket = out.get(item["assignment_id"])
        if bucket is None:
            continue
        bucket["assigned"] += 1

        due = due_by_id.get(item["assignment_id"])
        submitted_at = item.get("submitted_at")
        if submitted_at:
            bucket["submitted"] += 1
            if due and datetime.fromisoformat(submitted_at) > due:
                bucket["late"] += 1
        elif due and due < now:
            # Past the deadline with nothing submitted. Not a stored state: it
            # becomes true on its own as the clock passes, with no job to run.
            bucket["missing"] += 1

    return out


def mark_item_submitted(
    db,
    *,
    item_id: str,
    artifact_kind: str,
    artifact_id: str,
    score: Optional[float] = None,
    now: Optional[datetime] = None,
) -> bool:
    """Record that the student handed this item in. True when a row was written.

    Idempotent by design: the update only fires while `submitted_at IS NULL`, so
    re-completing a session (or a retry) cannot move the submission time later
    and turn an on-time hand-in into a late one.
    """
    patch: Dict[str, Any] = {
        "state":         "graded" if score is not None else "submitted",
        "submitted_at":  (now or datetime.now(timezone.utc)).isoformat(),
        "artifact_kind": artifact_kind,
        "artifact_id":   artifact_id,
    }
    if score is not None:
        patch["score"] = score

    try:
        r = (
            db.table("class_assignment_items")
            .update(patch)
            .eq("id", item_id)
            .is_("submitted_at", "null")
            .execute()
        )
    except Exception as exc:
        # Never break the caller's own flow (a graded session must still
        # complete) — but say so, because a silently unrecorded hand-in shows up
        # as the student not having done the work.
        logger.warning("[class] mark_item_submitted failed item=%s: %s", item_id, exc)
        return False
    return bool(r.data)


class EmptyRosterError(Exception):
    """The class has no students, so the give would reach nobody."""


class ItemNotFoundError(Exception):
    """The item does not exist, or does not belong to this user."""


class TaskMismatchError(Exception):
    """The session does not answer the task that was assigned."""


def is_assignment_open(assignment: Dict[str, Any], *, now: Optional[datetime] = None) -> bool:
    """Published, and past its scheduled reveal.

    `publish_at` is the reveal gate from migration 177. Items are created eagerly
    at give time, so without this check a give scheduled for next Monday is
    visible the moment it is created.
    """
    if (assignment.get("status") or "") != "published":
        return False
    publish_at = assignment.get("publish_at")
    if not publish_at:
        return True
    return datetime.fromisoformat(publish_at) <= (now or datetime.now(timezone.utc))


def bind_session_to_class_item(
    db,
    session_id: str,
    user_id: str,
    item_id: str,
    *,
    session_mode: Optional[str] = None,
    session_part: Optional[int] = None,
    session_topic: Optional[str] = None,
) -> None:
    """Link a freshly-created speaking session to the class item it answers.

    Ownership is checked HERE, against the caller's own user_id, because
    `class_assignment_item_id` arrives in a request body. Without this check a
    student could point their session at a classmate's item and have their work
    recorded as that classmate's hand-in.

    Bound after creation rather than inside the create RPC, mirroring how
    sitting_id is attached — the RPC exists to make the daily-cap count-then-
    insert atomic, and widening its signature for every optional link would
    couple that guarantee to unrelated features.
    """
    student = (
        db.table("students").select("id").eq("user_id", user_id).limit(1).execute().data
    ) or []
    if not student:
        raise ItemNotFoundError("Tài khoản này chưa gắn với hồ sơ học viên nào")

    owned = (
        db.table("class_assignment_items").select("id, assignment_id")
        .eq("id", item_id).eq("student_id", student[0]["id"])
        .limit(1).execute().data
    ) or []
    if not owned:
        raise ItemNotFoundError("Bài tập không thuộc về học viên này")

    # Ownership alone is not enough. `class_assignment_item_id` arrives in a
    # request body alongside a topic/mode/part the caller also chose, so without
    # this check a student can point an easy Part 1 practice session at a Part 3
    # assignment and have it recorded as the homework. The ledger's entire value
    # is that it proves the ASSIGNED task was done.
    a_rows = (
        db.table("class_assignments").select("*")
        .eq("id", owned[0]["assignment_id"]).limit(1).execute().data
    ) or []
    if not a_rows:
        raise ItemNotFoundError("Không tìm thấy bài giao")
    assignment = a_rows[0]

    if not is_assignment_open(assignment):
        raise TaskMismatchError("Bài tập chưa mở hoặc đã đóng")

    cfg = assignment.get("content_config") or {}
    expected_mode = cfg.get("mode") or "practice"
    expected_part = cfg.get("part") or 1
    expected_topic = (cfg.get("topic") or "").strip().casefold()

    if session_mode != expected_mode or int(session_part or 0) != int(expected_part):
        raise TaskMismatchError(
            f"Phiên này không khớp bài được giao (cần {expected_mode}, part {expected_part})."
        )
    # Topic compared case/whitespace-insensitively: it round-trips through the
    # client, and a stray capital must not block a student from handing in.
    if expected_topic and (session_topic or "").strip().casefold() != expected_topic:
        raise TaskMismatchError("Chủ đề của phiên không khớp bài được giao.")

    db.table("sessions").update(
        {"class_assignment_item_id": item_id}
    ).eq("id", session_id).execute()
