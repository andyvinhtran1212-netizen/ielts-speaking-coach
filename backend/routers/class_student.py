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
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException

from database import supabase_admin
from routers.auth import get_supabase_user
from services.class_assignment_service import _ID_CHUNK, is_assignment_open

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

    # OUTSTANDING WORK IS NEVER CAPPED.
    #
    # Two earlier shapes both dropped work the student still owes. Capping item
    # rows first hid an older unsubmitted task behind 200 newer ones; capping
    # ASSIGNMENTS first (round 5) still did, because 200 newer *completed* gives
    # sort ahead of one old unsubmitted give.
    #
    # So the two are fetched separately: everything not yet submitted, in full,
    # plus a bounded slice of history. A student cannot be shown "you have
    # nothing to do" while an unanswered task exists — that is the one thing this
    # endpoint must never get wrong.
    now = datetime.now(timezone.utc)

    try:
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
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải bài tập: {exc}")

    items = outstanding + history
    if not items:
        return {"has_class": True, "assignments": []}

    a_ids = list({i["assignment_id"] for i in items})
    by_id: Dict[str, Dict[str, Any]] = {}
    try:
        for chunk in (a_ids[i:i + _ID_CHUNK] for i in range(0, len(a_ids), _ID_CHUNK)):
            for a in ((supabase_admin.table("class_assignments")
                       .select("*").in_("id", chunk).execute().data) or []):
                # Items are created eagerly at give time, so `publish_at` is the
                # only thing keeping a give scheduled for next week off the list;
                # `status` keeps draft and archived ones off it.
                if is_assignment_open(a, now=now):
                    by_id[a["id"]] = a
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải bài tập: {exc}")

    out = [_decorate(i, by_id[i["assignment_id"]], now)
           for i in items if i["assignment_id"] in by_id]
    # Nearest deadline first; a give with no deadline sorts last.
    out.sort(key=lambda r: (r["assignment"]["due_at"] or ""), reverse=True)
    return {"has_class": True, "assignments": out}


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

    if assignment.get("skill") != "speaking":
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
    return {
        "item_id":      item_id,
        "assignment_id": assignment["id"],
        "session_params": {
            "mode":  cfg.get("mode") or "practice",
            "part":  cfg.get("part") or 1,
            "topic": cfg.get("topic") or "",
            "class_assignment_item_id": item_id,
        },
    }
