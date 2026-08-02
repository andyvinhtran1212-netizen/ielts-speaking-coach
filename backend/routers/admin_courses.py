"""routers/admin_courses.py — CRUD khoá học (migration 175).

Giai đoạn 1 của docs/CLASS_MANAGEMENT_PLAN_2026-08-02.md.

A course is the syllabus; a cohort is one run of it. The five the centre teaches
are seeded by migration 175, so in practice this router is used to rename them,
add a sixth, or archive one — not to bootstrap.

No DELETE. A retired course must keep its past classes readable, and
`cohorts.course_id` is ON DELETE SET NULL precisely so a hard delete cannot
orphan them. Archive with `is_active=false`, matching cohorts and the vocab
archive pattern.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.admin import require_admin

router = APIRouter(prefix="/admin/courses", tags=["admin", "courses"])


class CourseCreate(BaseModel):
    code:        str = Field(min_length=1, max_length=32)
    name:        str = Field(min_length=1, max_length=200)
    description: str | None = None
    sort_order:  int = 0


class CoursePatch(BaseModel):
    code:        str | None = Field(default=None, min_length=1, max_length=32)
    name:        str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    sort_order:  int | None = None
    is_active:   bool | None = None


@router.get("")
async def list_courses(
    is_active: bool | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    """Courses in ladder order. `is_active` omitted → everything, so the admin
    can find an archived course to restore."""
    await require_admin(authorization)

    q = supabase_admin.table("courses").select("*")
    if is_active is True:
        q = q.eq("is_active", True)
    elif is_active is False:
        q = q.eq("is_active", False)

    try:
        r = q.order("sort_order").execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải danh sách khoá học: {exc}")
    return {"courses": r.data or []}


@router.post("")
async def create_course(
    body: CourseCreate,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    try:
        r = supabase_admin.table("courses").insert({
            "code":        body.code,
            "name":        body.name,
            "description": body.description,
            "sort_order":  body.sort_order,
            "is_active":   True,
            "created_by":  admin["id"],
        }).execute()
    except Exception as exc:
        # `code` is UNIQUE — the collision is the likely failure and the admin
        # can act on it, so say which one it is instead of dumping the driver error.
        if "duplicate key" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(409, f"Mã khoá '{body.code}' đã tồn tại.")
        raise HTTPException(500, f"Lỗi khi tạo khoá học: {exc}")
    if not r.data:
        raise HTTPException(500, "Không tạo được khoá học")
    return r.data[0]


@router.patch("/{course_id}")
async def update_course(
    course_id: str,
    body: CoursePatch,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    updates = body.model_dump(exclude_unset=True)
    # `description` may legitimately be set to null; every other unset field is
    # simply absent, so exclude_unset (not exclude_none) is the right filter.
    if not updates:
        raise HTTPException(400, "Không có trường nào để cập nhật")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        r = (
            supabase_admin.table("courses")
            .update(updates)
            .eq("id", course_id)
            .execute()
        )
    except Exception as exc:
        if "duplicate key" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(409, f"Mã khoá '{updates.get('code')}' đã tồn tại.")
        raise HTTPException(500, f"Lỗi khi cập nhật khoá học: {exc}")

    if not r.data:
        raise HTTPException(404, "Không tìm thấy khoá học")
    return r.data[0]
