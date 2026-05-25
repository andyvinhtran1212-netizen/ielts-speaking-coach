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
from routers.admin import require_admin, _aggregate_usage_for_users

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


@router.get("/{cohort_id}/members")
async def cohort_members(cohort_id: str, authorization: str | None = Header(default=None)):
    """Members of a cohort = users with an ACTIVE assignment to one of the cohort's
    codes (access_codes.cohort_id == cohort_id). Sprint 17.3: this is CODE-DERIVED —
    it covers every such user and needs no schema change, rather than relying on the
    writing-roster `students.cohort_id` (which only exists for users matched by a
    student_code). Per-member activity reuses the Sprint 17.2 usage aggregation
    (one batched sessions + one ai_usage query — no N+1). A user assigned to two of
    the cohort's codes is listed once."""
    await require_admin(authorization)

    cohort_rows = (
        supabase_admin.table("cohorts").select("*").eq("id", cohort_id).limit(1).execute().data
    ) or []
    if not cohort_rows:
        raise HTTPException(404, "Không tìm thấy lớp")
    cohort = cohort_rows[0]

    try:
        code_rows = (
            supabase_admin.table("access_codes").select("id, code").eq("cohort_id", cohort_id).execute().data
        ) or []
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải mã của lớp: {exc}")
    code_ids = [c["id"] for c in code_rows]
    code_value_by_id = {c["id"]: c.get("code") for c in code_rows}

    uids: list[str] = []
    user_code: dict[str, str | None] = {}
    if code_ids:
        try:
            asgn = (
                supabase_admin.table("user_code_assignments")
                .select("user_id, code_id")
                .in_("code_id", code_ids)
                .eq("is_active", True)
                .execute()
                .data
            ) or []
        except Exception as exc:
            raise HTTPException(500, f"Lỗi khi tải thành viên: {exc}")
        for a in asgn:
            uid = a["user_id"]
            if uid not in user_code:
                user_code[uid] = code_value_by_id.get(a["code_id"])
                uids.append(uid)

    users: dict[str, dict] = {}
    if uids:
        for u in (
            supabase_admin.table("users").select("id, email, display_name").in_("id", uids).execute().data or []
        ):
            users[u["id"]] = u

    agg = _aggregate_usage_for_users(uids)
    members = [
        {
            "user_id": uid,
            "email": (users.get(uid) or {}).get("email") or "",
            "name": (users.get(uid) or {}).get("display_name") or "",
            "code": user_code.get(uid),
            **agg.get(uid, {"sessions": 0, "last_active": None, "ai_cost_usd": 0.0}),
        }
        for uid in uids
    ]
    return {"cohort": cohort, "member_count": len(members), "members": members}
