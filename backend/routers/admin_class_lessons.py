"""routers/admin_class_lessons.py — nội dung buổi học của lớp (migration 176).

Giai đoạn 1 của docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md.

This is the surface the admin types class content into, and the one the student
class page (GĐ 3) reads back. Mounted under the same `/admin/cohorts` prefix as
routers/cohorts.py — FastAPI matches on the full path, and `/lessons` cannot be
confused with `/members` or `/students`.

Ordering is (lesson_no NULLS LAST, lesson_date, created_at): some classes number
their sessions, some go purely by date, and a class created mid-course may know
the date before the number. Done here rather than in the client so every reader
agrees.

`is_published` is the student-visibility gate and defaults to false — a
half-typed lesson must never appear on a class page. DELETE is a hard delete:
a lesson carries no submissions of its own, and homework attached to it survives
because `class_assignments.lesson_id` is ON DELETE SET NULL (mig 177/178).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from database import supabase_admin
from routers.admin import require_admin

router = APIRouter(prefix="/admin/cohorts", tags=["admin", "class-lessons"])


class Attachment(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    url:   str = Field(min_length=1, max_length=2000)


class LessonCreate(BaseModel):
    title:        str = Field(min_length=1, max_length=300)
    lesson_no:    int | None = Field(default=None, gt=0)
    lesson_date:  str | None = None            # ISO date; Postgres validates
    body_md:      str | None = None
    attachments:  list[Attachment] = Field(default_factory=list, max_length=50)
    is_published: bool = False

    @field_validator("lesson_date")
    @classmethod
    def _blank_date_is_none(cls, v):
        """An empty <input type=date> posts "". Postgres rejects that as a date,
        so normalise it to NULL — the admin cleared the field, they did not enter
        an invalid one."""
        return v or None


class LessonPatch(BaseModel):
    title:        str | None = Field(default=None, min_length=1, max_length=300)
    lesson_no:    int | None = Field(default=None, gt=0)
    lesson_date:  str | None = None
    body_md:      str | None = None
    attachments:  list[Attachment] | None = Field(default=None, max_length=50)
    is_published: bool | None = None

    @field_validator("lesson_date")
    @classmethod
    def _blank_date_is_none(cls, v):
        return v or None


def _sort_key(row: dict) -> tuple:
    """lesson_no first (unnumbered last), then date, then insertion order."""
    no = row.get("lesson_no")
    return (
        0 if no is not None else 1,
        no if no is not None else 0,
        row.get("lesson_date") or "",
        row.get("created_at") or "",
    )


def _require_cohort(cohort_id: str) -> None:
    rows = (
        supabase_admin.table("cohorts").select("id")
        .eq("id", cohort_id).limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy lớp")


@router.get("/{cohort_id}/lessons")
async def list_lessons(cohort_id: str, authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    _require_cohort(cohort_id)

    try:
        rows = (
            supabase_admin.table("class_lessons").select("*")
            .eq("cohort_id", cohort_id).execute().data
        ) or []
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải buổi học: {exc}")

    return {"lessons": sorted(rows, key=_sort_key)}


@router.post("/{cohort_id}/lessons", status_code=status.HTTP_201_CREATED)
async def create_lesson(
    cohort_id: str,
    body: LessonCreate,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    _require_cohort(cohort_id)

    payload: dict[str, Any] = {
        "cohort_id":    cohort_id,
        "title":        body.title,
        "lesson_no":    body.lesson_no,
        "lesson_date":  body.lesson_date,
        "body_md":      body.body_md,
        "attachments":  [a.model_dump() for a in body.attachments],
        "is_published": body.is_published,
        "created_by":   admin["id"],
    }
    try:
        r = supabase_admin.table("class_lessons").insert(payload).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tạo buổi học: {exc}")
    if not r.data:
        raise HTTPException(500, "Không tạo được buổi học")
    return r.data[0]


@router.patch("/{cohort_id}/lessons/{lesson_id}")
async def update_lesson(
    cohort_id: str,
    lesson_id: str,
    body: LessonPatch,
    authorization: str | None = Header(default=None),
):
    """The cohort is in the path AND in the WHERE clause: a stale tab must not be
    able to edit a lesson that has since been read under a different class."""
    await require_admin(authorization)

    updates = body.model_dump(exclude_unset=True)
    if "attachments" in updates and updates["attachments"] is not None:
        updates["attachments"] = [dict(a) for a in updates["attachments"]]
    if not updates:
        raise HTTPException(400, "Không có trường nào để cập nhật")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        r = (
            supabase_admin.table("class_lessons").update(updates)
            .eq("id", lesson_id).eq("cohort_id", cohort_id).execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi cập nhật buổi học: {exc}")
    if not r.data:
        raise HTTPException(404, "Không tìm thấy buổi học trong lớp này")
    return r.data[0]


@router.delete("/{cohort_id}/lessons/{lesson_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lesson(
    cohort_id: str,
    lesson_id: str,
    authorization: str | None = Header(default=None),
):
    """Hard delete. Homework attached to this lesson survives with lesson_id
    cleared — the composite FK from mig 178 nulls only that column."""
    await require_admin(authorization)

    try:
        r = (
            supabase_admin.table("class_lessons").delete()
            .eq("id", lesson_id).eq("cohort_id", cohort_id).execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi xoá buổi học: {exc}")
    if not r.data:
        raise HTTPException(404, "Không tìm thấy buổi học trong lớp này")
