"""routers/class_student.py — bài tập của lớp, phía học viên (GĐ 2).

Giai đoạn 2 của docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md.

  GET  /api/class/my-assignments            — bài của tôi, kèm trạng thái trễ hạn
  POST /api/class/assignments/{id}/start    — mở bài Speaking → tạo session

The student class PAGE is GĐ 3; these are the endpoints it will read, shipped
now so the loop admin-gives → student-submits → admin-sees closes in one phase.

Auth: standard Supabase JWT. The handlers run under supabase_admin
(service-role) because resolving auth.users → students → cohort spans tables a
JWT-scoped client cannot join under RLS — the same reason routers/student_home.py
gives. Every query carries an explicit student_id filter derived from the token,
never from the request body.

Lateness is computed here, not stored (migration 177): a flag written at submit
time disagrees with reality the moment an admin moves a deadline.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from urllib.parse import quote
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException

from database import supabase_admin
from routers.auth import get_supabase_user
from services.class_assignment_service import (
    _ID_CHUNK,
    is_assignment_open,
    reconcile_test_attempts,
)

logger = logging.getLogger(__name__)

# Caps HISTORY only. Outstanding work is never capped — see my_assignments().
_MAX_HISTORY = 200
_PAGE = 1000


def _paged_items(apply_filters) -> list:
    """Every matching item row, a page at a time (PostgREST caps un-ranged
    selects at ~1000). Ordered by id: an unordered range is not a stable window,
    and here a skipped row is homework the student is never shown."""
    rows: list = []
    start = 0
    while True:
        page = (
            apply_filters(supabase_admin.table("class_assignment_items").select("*"))
            .order("id").range(start, start + _PAGE - 1).execute().data
        ) or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE

router = APIRouter(prefix="/api/class", tags=["class-student"])


def _student_for_user(user_id: str) -> Optional[Dict[str, Any]]:
    rows = (
        supabase_admin.table("students")
        .select("id, full_name, student_code, cohort_id")
        .eq("user_id", user_id).limit(1).execute().data
    ) or []
    return rows[0] if rows else None


def _decorate(item: Dict[str, Any], assignment: Dict[str, Any], now: datetime) -> Dict[str, Any]:
    """Attach the two derived states the UI needs. Both come from timestamps, so
    they stay correct without any job keeping them so."""
    due_raw = assignment.get("due_at")
    due = datetime.fromisoformat(due_raw) if due_raw else None
    submitted_at = item.get("submitted_at")

    is_late = bool(submitted_at and due and datetime.fromisoformat(submitted_at) > due)
    is_missing = bool(not submitted_at and due and due < now)

    return {
        "item_id":      item["id"],
        "state":        item["state"],
        "submitted_at": submitted_at,
        "score":        item.get("score"),
        "is_late":      is_late,
        "is_missing":   is_missing,
        "assignment": {
            "id":             assignment["id"],
            "title":          assignment.get("title"),
            "skill":          assignment.get("skill"),
            "instructions":   assignment.get("instructions"),
            "due_at":         due_raw,
            "content_config": assignment.get("content_config") or {},
        },
    }


def _visible_assignments(student: Dict[str, Any], now: datetime) -> tuple[list, bool]:
    """This student's assignments — outstanding in full, history capped.

    Shared by /my-assignments and /me so the two can never disagree about what
    the student owes.

    OUTSTANDING WORK IS NEVER CAPPED. Two earlier shapes both dropped work still
    owed: capping item rows hid an older unsubmitted task behind 200 newer ones,
    and capping assignments did too because 200 newer *completed* gives sort
    ahead of one old unsubmitted one. A student must never be shown "nothing to
    do" while an unanswered task exists.
    """
    outstanding = _paged_items(
        lambda q: q.eq("student_id", student["id"]).is_("submitted_at", "null")
    )
    history = (
        supabase_admin.table("class_assignment_items")
        .select("*")
        .eq("student_id", student["id"])
        .not_.is_("submitted_at", "null")
        .order("submitted_at", desc=True)
        .limit(_MAX_HISTORY)
        .execute().data
    ) or []

    items = outstanding + history
    if not items:
        return [], False

    a_ids = list({i["assignment_id"] for i in items})
    by_id: Dict[str, Dict[str, Any]] = {}
    for chunk in (a_ids[i:i + _ID_CHUNK] for i in range(0, len(a_ids), _ID_CHUNK)):
        for a in ((supabase_admin.table("class_assignments")
                   .select("*")
                   .in_("id", chunk)
                   .eq("cohort_id", student["cohort_id"])   # CURRENT class only
                   .execute().data) or []):
            # Items are created eagerly at give time, so `publish_at` is the only
            # thing keeping a give scheduled for next week off the list;
            # `status` keeps draft and archived ones off it.
            #
            # The cohort filter matters because moving a student between classes
            # only rewrites students.cohort_id — their old class's item rows
            # stay. Without it, class A's homework vanishes while the student has
            # no class and REAPPEARS when they join class B.
            if is_assignment_open(a, now=now):
                by_id[a["id"]] = a

    # Record any Reading/Listening hand-in before deciding what this student
    # still owes: their test submission does not touch the class ledger, so
    # without this they would see work they have already done sitting under
    # "Cần nộp".
    #
    # Showing the list anyway when the repair fails is right — a broken repair
    # must not blank the page. Showing it WITHOUT SAYING SO is not: the one
    # thing that can go wrong here is a finished task still listed as owed, and
    # a student who trusts that list retakes work they have already handed in.
    stale = False
    try:
        reconcile_test_attempts(supabase_admin, list(by_id.values()))
        items = _reread_items(student["id"], [i["id"] for i in items]) or items
    except Exception as exc:
        stale = True
        logger.warning("[class] test reconcile skipped: %s", exc)

    out = [_decorate(i, by_id[i["assignment_id"]], now)
           for i in items if i["assignment_id"] in by_id]
    # Nearest deadline FIRST — this is a to-do list, so what is due today has to
    # be at the top. A give with no deadline is never urgent, so it sorts last
    # via its own key rather than by abusing the empty string.
    out.sort(key=lambda r: (r["assignment"]["due_at"] is None,
                            r["assignment"]["due_at"] or ""))
    return out, stale


@router.get("/my-assignments")
async def my_assignments(authorization: str | None = Header(default=None)):
    """Bài tập của học viên đang đăng nhập.

    A user with no linked student row, or a student in no class, gets an empty
    list and `has_class: false` — not a 404. Not being in a class is an ordinary
    state, and the home page needs to tell the two apart to decide whether to
    show the class card at all.
    """
    auth_user = await get_supabase_user(authorization)
    student = _student_for_user(auth_user["id"])

    if not student or not student.get("cohort_id"):
        return {"has_class": False, "assignments": []}

    now = datetime.now(timezone.utc)
    try:
        rows, stale = _visible_assignments(student, now)
        out: Dict[str, Any] = {"has_class": True, "assignments": rows}
        if stale:
            out["homework_stale"] = True
        return out
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải bài tập: {exc}")


@router.post("/assignments/{item_id}/start")
async def start_assignment(
    item_id: str,
    authorization: str | None = Header(default=None),
):
    """Mở một bài Speaking được giao — trả về tham số để tạo session.

    Deliberately does NOT create the session itself. POST /sessions owns quota,
    daily caps and permission checks; duplicating any of that here would mean two
    places to keep in step, and the one here would be the one nobody remembers to
    update. The client posts to /sessions with these values plus
    `class_assignment_item_id`, and the completion hook closes the loop.

    Marks the item `opened` on first use — a stored fact (it happened), unlike
    late/missed which are derived.
    """
    auth_user = await get_supabase_user(authorization)
    student = _student_for_user(auth_user["id"])
    if not student:
        raise HTTPException(404, "Không tìm thấy hồ sơ học viên")

    rows = (
        supabase_admin.table("class_assignment_items").select("*")
        .eq("id", item_id).eq("student_id", student["id"])   # ownership in the query
        .limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy bài tập của bạn")
    item = rows[0]

    a_rows = (
        supabase_admin.table("class_assignments").select("*")
        .eq("id", item["assignment_id"]).limit(1).execute().data
    ) or []
    if not a_rows or not is_assignment_open(a_rows[0]):
        raise HTTPException(404, "Bài tập không còn mở")
    assignment = a_rows[0]

    # Same cohort check as the list: a transferred student must not be able to
    # start their previous class's work just because the item row survived.
    if assignment.get("cohort_id") != student.get("cohort_id"):
        raise HTTPException(404, "Bài tập không thuộc lớp hiện tại của bạn")

    skill = assignment.get("skill")
    if skill not in ("speaking", "reading", "listening"):
        raise HTTPException(400, "Bài tập này chưa hỗ trợ mở trực tiếp.")

    if item.get("state") == "assigned":
        try:
            supabase_admin.table("class_assignment_items").update({
                "state": "opened",
                "opened_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", item_id).eq("state", "assigned").execute()
        except Exception as exc:
            # Cosmetic: never block the student from starting their work.
            logger.warning("[class] could not mark item opened item=%s: %s", item_id, exc)

    cfg = assignment.get("content_config") or {}

    if skill == "speaking":
        # The client posts these to /sessions — which owns quota, the daily cap
        # and permissions — then lands on the practice page by session_id.
        return {
            "item_id":       item_id,
            "assignment_id": assignment["id"],
            "skill":         skill,
            "session_params": {
                "mode":  cfg.get("mode") or "practice",
                "part":  cfg.get("part") or 1,
                "topic": cfg.get("topic") or "",
                "class_assignment_item_id": item_id,
            },
        }

    # Reading/Listening open their existing test pages directly. No attempt is
    # created here — those pages own their own attempt lifecycle, and a parallel
    # "start" path would mean two places deciding when an attempt begins.
    #
    # `class_item` is what ties the two together. The page passes it back when
    # it creates the attempt, so the attempt row records WHICH homework it was
    # done for. Without it the ledger would have to infer ownership from the
    # paper and the clock, which cannot be made right: the same paper can be
    # given twice, given and reopened, or practised freely on the side.
    test_uuid = assignment.get("content_id")
    if not test_uuid:
        raise HTTPException(400, "Bài tập này chưa gắn đề.")

    # The paper was checked when the task was given, but that was days ago: it
    # can since have been unpublished, reserved for a mock sitting, or had its
    # audio cleared. Sending the student to a page that answers 404/422 while
    # the ledger keeps counting the task as owed is the worst of both — say so
    # here instead.
    if skill == "listening":
        rows = (
            supabase_admin.table("listening_tests")
            .select("id, status, exam_only, full_audio_storage_path, "
                    "assembled_audio_storage_path")
            .eq("id", test_uuid).limit(1).execute().data
        ) or []
        if not rows or (rows[0].get("status") or "") != "published":
            raise HTTPException(409, "Đề nghe của bài tập này hiện không mở được.")
        if rows[0].get("exam_only"):
            raise HTTPException(409, "Đề nghe của bài tập này hiện không mở được.")
        if not (rows[0].get("assembled_audio_storage_path")
                or rows[0].get("full_audio_storage_path")):
            raise HTTPException(409, "Đề nghe này chưa có audio sẵn sàng.")
        # listening-test.html?id= is the row id, the same value the attempt row
        # carries — one identifier throughout.
        url = (f"/pages/listening-test.html?id={quote(test_uuid)}"
               f"&class_item={quote(item_id)}")
    else:
        # Reading needs BOTH ids and they are different columns. The reader page
        # resolves ?test_id= against reading_tests.test_id (the public code,
        # mig 086), while reading_test_attempts.test_id stores the row UUID. The
        # ledger keeps the UUID because that is what the hand-in is matched on;
        # the link has to carry the code or the paper opens to a 404.
        row = (
            supabase_admin.table("reading_tests").select("test_id, status, exam_only")
            .eq("id", test_uuid).limit(1).execute().data
        ) or []
        code = (row[0].get("test_id") if row else None)
        if not code:
            raise HTTPException(404, "Không tìm thấy đề đọc của bài tập này.")
        if (row[0].get("status") or "") != "published" or row[0].get("exam_only"):
            raise HTTPException(409, "Đề đọc của bài tập này hiện không mở được.")
        url = (f"/pages/reading-exam.html?test_id={quote(code)}"
               f"&class_item={quote(item_id)}")
    return {
        "item_id":       item_id,
        "assignment_id": assignment["id"],
        "skill":         skill,
        "open_url":      url,
    }


@router.get("/me")
async def my_class(
    summary: bool = False,
    authorization: str | None = Header(default=None),
):
    """Trang lớp của học viên — lớp, buổi học, bài tập, tiến độ, trong một lượt gọi.

    `summary=true` trả bản GỌN cho thẻ ở trang chủ: chỉ tên lớp, khoá, và các con
    số tiến độ. Thẻ đó chỉ đọc bấy nhiêu, nhưng bản đầy đủ kéo về MỌI buổi học đã
    đăng — kể cả `body_md` không giới hạn độ dài và danh sách tài liệu — nên mỗi
    lần mở trang chủ lại nặng thêm theo lượng nội dung giảng viên soạn. Bản gọn
    bỏ hẳn phần buổi học và không trả mảng bài tập, chỉ trả phần đếm.

    Shaped for the page rather than the tables: one round-trip, because the class
    page shows all four together and three sequential fetches would make it
    flash through three half-states.

    `has_class: false` is an ordinary answer, not a 404 — most learners are on a
    mass code and belong to no class. The page shows a plain explanation and the
    home card hides itself.

    Each block is built independently and a failure downgrades only that block
    (`degraded: [...]`), mirroring services/student_home_aggregator: a class page
    that 500s because the lessons query hiccuped would hide the homework too,
    which is the part the student actually needs.
    """
    auth_user = await get_supabase_user(authorization)
    student = _student_for_user(auth_user["id"])

    if not student or not student.get("cohort_id"):
        return {"has_class": False}

    now = datetime.now(timezone.utc)
    degraded: list[str] = []

    cohort: Dict[str, Any] = {}
    try:
        rows = (
            supabase_admin.table("cohorts")
            .select("id, name, description, course_id")
            .eq("id", student["cohort_id"]).limit(1).execute().data
        ) or []
        cohort = rows[0] if rows else {}
        if cohort.get("course_id"):
            crows = (
                supabase_admin.table("courses").select("code, name")
                .eq("id", cohort["course_id"]).limit(1).execute().data
            ) or []
            cohort["course"] = crows[0] if crows else None
    except Exception as exc:
        logger.warning("[class] cohort read failed: %s", exc)
        degraded.append("class")

    lessons: list = []
    # Skipped entirely for the home strip: this is the unbounded part of the
    # payload and the strip never reads it.
    if not summary:
      try:
        lessons = _paged_items_of(
            "class_lessons",
            lambda q: q.eq("cohort_id", student["cohort_id"]).eq("is_published", True),
        )
        # Same ordering the admin list uses (lesson_no NULLS LAST, then date), so
        # a student and their teacher are always looking at the same sequence.
        lessons.sort(key=lambda r: (
            r.get("lesson_no") is None, r.get("lesson_no") or 0,
            r.get("lesson_date") or "", r.get("created_at") or "",
        ))
      except Exception as exc:
        logger.warning("[class] lessons read failed: %s", exc)
        degraded.append("lessons")

    assignments: list = []
    try:
        assignments, homework_stale = _visible_assignments(student, now)
        if homework_stale:
            # Same word the admin Progress tab uses for the same condition:
            # the rows are real, they may just be missing the newest hand-in.
            degraded.append("homework_stale")
    except Exception as exc:
        logger.warning("[class] assignments read failed: %s", exc)
        degraded.append("assignments")

    # Counts come from the same list the page renders, so the summary can never
    # disagree with the rows underneath it.
    progress = _progress_summary(assignments) if "assignments" not in degraded else None

    result: Dict[str, Any] = {
        "has_class": True,
        "class":     cohort,
        "progress":  progress,
    }
    if not summary:
        result["student"] = {"full_name": student.get("full_name"),
                             "student_code": student.get("student_code")}
        result["lessons"] = lessons
        result["assignments"] = assignments
    if degraded:
        result["degraded"] = degraded
    return result


def _progress_summary(assignments: list) -> Dict[str, Any]:
    """Counts for the header strip.

    `missing` is work whose deadline has passed with nothing submitted — the
    number worth acting on. Everything not yet due is `todo`, deliberately kept
    apart: a learner who sees "5 quá hạn" when nothing is actually late stops
    believing the number.
    """
    total = len(assignments)
    submitted = sum(1 for a in assignments if a["submitted_at"])
    late = sum(1 for a in assignments if a["is_late"])
    missing = sum(1 for a in assignments if a["is_missing"])
    return {
        "total":     total,
        "submitted": submitted,
        "todo":      total - submitted - missing,
        "missing":   missing,
        "late":      late,
        # Punctuality over recorded hand-ins only: dividing by `total` would
        # drag the figure down for work that is not due yet.
        "on_time_pct": (round((submitted - late) / submitted * 100) if submitted else None),
    }


def _paged_items_of(table: str, apply_filters) -> list:
    """Every matching row of `table`, paged (PostgREST caps un-ranged reads)."""
    rows: list = []
    start = 0
    while True:
        page = (
            apply_filters(supabase_admin.table(table).select("*"))
            .order("id").range(start, start + _PAGE - 1).execute().data
        ) or []
        rows.extend(page)
        if len(page) < _PAGE:
            return rows
        start += _PAGE


def _reread_items(student_id: str, item_ids: list) -> list:
    """Re-read the student's items after a reconciliation wrote to them.

    Without this the page renders the rows fetched BEFORE the repair, so a
    hand-in just recorded still shows as outstanding until the next load —
    which is the very thing the repair exists to prevent.
    """
    if not item_ids:
        return []
    out: list = []
    for chunk in (item_ids[i:i + _ID_CHUNK] for i in range(0, len(item_ids), _ID_CHUNK)):
        out.extend((
            supabase_admin.table("class_assignment_items").select("*")
            .eq("student_id", student_id).in_("id", chunk).execute().data
        ) or [])
    return out
