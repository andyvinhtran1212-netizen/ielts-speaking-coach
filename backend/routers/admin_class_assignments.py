"""routers/admin_class_assignments.py — giao bài cho lớp (GĐ 2).

Giai đoạn 2 của docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md.

GĐ 2 ships Speaking only — the daily task the centre actually runs, due 19:00 —
because it is the narrowest path that exercises the whole loop: admin gives →
student sees → student submits → admin sees who has not. The other skills reuse
the same tables in GĐ 5.

Mounted under the same `/admin/cohorts` prefix as routers/cohorts.py; FastAPI
matches on the full path and `/assignments` cannot collide with `/members`,
`/students` or `/lessons`.

DELETE is allowed only while nothing has been submitted. Past that, removing the
row would erase the record that work was asked for and done — the admin archives
the assignment instead.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from database import supabase_admin
from routers.admin import require_admin
from services.class_assignment_service import (
    create_class_assignment,
    progress_for_assignments,
)

router = APIRouter(prefix="/admin/cohorts", tags=["admin", "class-assignments"])

# The speaking session modes POST /sessions accepts (routers/sessions.py).
# Mirrored rather than imported to keep the routers decoupled; the test pins the
# two lists together so a new mode cannot drift in unnoticed.
_SPEAKING_MODES = ("practice", "test_part", "test_full")


class AssignmentCreate(BaseModel):
    """GĐ 2 — Speaking only. `skill` is explicit anyway so the payload does not
    have to change when Reading/Listening join in GĐ 5."""
    skill:        Literal["speaking"] = "speaking"
    title:        str = Field(min_length=1, max_length=300)
    topic:        str = Field(min_length=1, max_length=300)
    mode:         str = "practice"
    part:         int = Field(default=1, ge=1, le=3)
    due_date:     Optional[str] = None      # ISO date; 19:00 giờ VN added server-side
    instructions: Optional[str] = Field(default=None, max_length=2000)
    lesson_id:    Optional[str] = None

    @model_validator(mode="after")
    def _check_mode(self):
        if self.mode not in _SPEAKING_MODES:
            raise ValueError(f"mode phải là một trong: {sorted(_SPEAKING_MODES)}")
        return self

    @model_validator(mode="after")
    def _blank_date_is_none(self):
        # An emptied <input type=date> posts "" — that means "no deadline", not
        # an invalid date.
        if not self.due_date:
            self.due_date = None
        return self


def _require_cohort(cohort_id: str) -> None:
    rows = (
        supabase_admin.table("cohorts").select("id")
        .eq("id", cohort_id).limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy lớp")


@router.get("/{cohort_id}/assignments")
async def list_assignments(
    cohort_id: str,
    authorization: str | None = Header(default=None),
):
    """Assignments of one class, newest deadline first, each with its progress.

    `late` and `missing` are computed from timestamps at read time — there is no
    column for either, so they cannot go stale when a deadline moves.
    """
    await require_admin(authorization)
    _require_cohort(cohort_id)

    try:
        rows = (
            supabase_admin.table("class_assignments").select("*")
            .eq("cohort_id", cohort_id)
            .order("created_at", desc=True)
            .execute().data
        ) or []
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải bài giao: {exc}")

    try:
        progress = progress_for_assignments(supabase_admin, rows)
    except Exception as exc:
        # Say so rather than rendering zeros: "0 đã nộp" is a claim about the
        # class that a failed query has not earned.
        raise HTTPException(500, f"Lỗi khi tính tiến độ nộp bài: {exc}")

    return {"assignments": [{**a, "progress": progress.get(a["id"])} for a in rows]}


@router.post("/{cohort_id}/assignments", status_code=status.HTTP_201_CREATED)
async def create_assignment(
    cohort_id: str,
    body: AssignmentCreate,
    authorization: str | None = Header(default=None),
):
    """Give one task to every student on the roster.

    Returns `student_count` and `unactivated_count`. The UI must surface the
    second one: those students have no account, so nothing is ever shown to them
    and they will read as simply not having done the work.
    """
    admin = await require_admin(authorization)
    _require_cohort(cohort_id)

    try:
        result = create_class_assignment(
            supabase_admin,
            cohort_id=cohort_id,
            skill=body.skill,
            title=body.title,
            assigned_by=admin["id"],
            lesson_id=body.lesson_id,
            content_config={"topic": body.topic, "mode": body.mode, "part": body.part},
            due_date=body.due_date,
            instructions=body.instructions,
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi giao bài: {exc}")

    if result["student_count"] == 0:
        # The row exists but reaches nobody. Fail loudly — an admin who thinks
        # they gave homework and did not is the worst outcome here.
        raise HTTPException(400, "Lớp này chưa có học viên nào để giao bài.")

    return result


@router.delete("/{cohort_id}/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assignment(
    cohort_id: str,
    assignment_id: str,
    authorization: str | None = Header(default=None),
):
    """Delete a give — only while nothing has been handed in.

    Both ids are in the WHERE clause so a stale tab cannot delete an assignment
    that now belongs to another class.
    """
    await require_admin(authorization)

    rows = (
        supabase_admin.table("class_assignments").select("id")
        .eq("id", assignment_id).eq("cohort_id", cohort_id).limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy bài giao trong lớp này")

    submitted = (
        supabase_admin.table("class_assignment_items").select("id")
        .eq("assignment_id", assignment_id)
        .not_.is_("submitted_at", "null")
        .limit(1).execute().data
    ) or []
    if submitted:
        raise HTTPException(
            409,
            "Đã có học viên nộp bài này — không xoá được. Hãy lưu trữ bài giao thay vì xoá.",
        )

    try:
        # Items go with it via ON DELETE CASCADE (mig 177).
        supabase_admin.table("class_assignments").delete().eq("id", assignment_id).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi xoá bài giao: {exc}")
