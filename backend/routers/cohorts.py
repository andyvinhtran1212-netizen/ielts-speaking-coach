"""routers/cohorts.py — Admin cohort management (Sprint 12.2).

Stub CRUD for the cohorts table introduced in Migration 060. Sprint 12.2
ships these endpoints so the access-codes UI can populate a cohort picker
dropdown without a backend gap; the dedicated cohort-management UI is
deferred to Phase B per Sprint 12.0 Discovery pre-lock 3.

No DELETE endpoint — cohorts are soft-archived via `is_active=false` per
the Sprint 10.6 vocab archive pattern. The FK on `students.cohort_id` is
ON DELETE SET NULL so even if a row is hard-deleted later, students
survive.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.admin import require_admin

router = APIRouter(prefix="/admin/cohorts", tags=["admin", "cohorts"])


class CohortCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code_prefix: str | None = Field(default=None, max_length=20)
    description: str | None = None


class CohortPatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    code_prefix: str | None = Field(default=None, max_length=20)
    description: str | None = None
    is_active: bool | None = None


@router.get("")
async def list_cohorts(
    is_active: bool | None = None,
    authorization: str | None = Header(default=None),
):
    """List cohorts. Default: only active. Pass is_active=false to see archived."""
    admin = await require_admin(authorization)

    q = supabase_admin.table("cohorts").select("*")
    if is_active is True:
        q = q.eq("is_active", True)
    elif is_active is False:
        q = q.eq("is_active", False)
    # is_active is None → no filter (admin wants to see everything)

    try:
        r = q.order("created_at", desc=True).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải danh sách lớp: {exc}")

    return {"cohorts": r.data or []}


@router.post("")
async def create_cohort(
    body: CohortCreateRequest,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    now_iso = datetime.now(timezone.utc).isoformat()
    payload = {
        "name": body.name,
        "code_prefix": body.code_prefix,
        "description": body.description,
        "is_active": True,
        "created_by": admin["id"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    try:
        r = supabase_admin.table("cohorts").insert(payload).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tạo lớp: {exc}")
    if not r.data:
        raise HTTPException(500, "Không tạo được lớp")
    return r.data[0]


@router.patch("/{cohort_id}")
async def update_cohort(
    cohort_id: str,
    body: CohortPatchRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.code_prefix is not None:
        updates["code_prefix"] = body.code_prefix
    if body.description is not None:
        updates["description"] = body.description
    if body.is_active is not None:
        updates["is_active"] = body.is_active

    if not updates:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        r = (
            supabase_admin.table("cohorts")
            .update(updates)
            .eq("id", cohort_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi cập nhật lớp: {exc}")

    if not r.data:
        raise HTTPException(404, "Không tìm thấy lớp")
    return r.data[0]
