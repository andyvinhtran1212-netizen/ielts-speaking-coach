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
from routers.admin import require_admin, _aggregate_usage_for_users, _issue_code_and_assign

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


_ZERO_USAGE = {"sessions": 0, "last_active": None, "ai_cost_usd": 0.0}


@router.get("/{cohort_id}/members")
async def cohort_members(cohort_id: str, authorization: str | None = Header(default=None)):
    """WF-1 — a cohort's CLASS ROSTER = students WHERE `students.cohort_id` =
    cohort_id. This is the single source of truth: the SAME column writing
    fan-out (`cohort_assignment_service`) and the grade-by-class matrix
    (`admin_writing_cohorts`) read, so what the admin sees here is exactly who
    gets writing assigned + graded (no split-brain).

    Each member carries `student_code` + `full_name`; per-member activity
    (sessions / last_active / ai_cost) is joined via `students.user_id` when the
    student has activated (one batched usage query — no N+1). Students without a
    linked user show zero usage. ENTITLEMENT (which access code a user holds) is
    a SEPARATE concern handled by POST/DELETE `/members` (code issue/revoke),
    which is unchanged."""
    await require_admin(authorization)

    cohort_rows = (
        supabase_admin.table("cohorts").select("*").eq("id", cohort_id).limit(1).execute().data
    ) or []
    if not cohort_rows:
        raise HTTPException(404, "Không tìm thấy lớp")
    cohort = cohort_rows[0]

    try:
        students = (
            supabase_admin.table("students")
            .select("id, student_code, full_name, user_id")
            .eq("cohort_id", cohort_id)
            .order("full_name")
            .execute()
            .data
        ) or []
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải thành viên: {exc}")

    user_ids = [s["user_id"] for s in students if s.get("user_id")]
    agg = _aggregate_usage_for_users(user_ids) if user_ids else {}
    members = [
        {
            "student_id":   s["id"],
            "student_code": s.get("student_code"),
            "name":         s.get("full_name") or "",
            "user_id":      s.get("user_id"),
            **(agg.get(s["user_id"], _ZERO_USAGE) if s.get("user_id") else _ZERO_USAGE),
        }
        for s in students
    ]
    return {"cohort": cohort, "member_count": len(members), "members": members}


class AddMemberRequest(BaseModel):
    user_id: str
    reason: str | None = None


@router.post("/{cohort_id}/members")
async def add_cohort_member(
    cohort_id: str,
    body: AddMemberRequest,
    authorization: str | None = Header(default=None),
):
    """Sprint 17.5 — add a member to a cohort. Under the code-derived membership
    model, this issues a NEW direct code bound to the cohort and assigns it to the
    user (who then appears in the code-derived roster). Returns the new code."""
    admin = await require_admin(authorization)
    admin_id = admin.get("id") if isinstance(admin, dict) else None

    cohort = (
        supabase_admin.table("cohorts").select("id").eq("id", cohort_id).limit(1).execute().data
    ) or []
    if not cohort:
        raise HTTPException(404, "Không tìm thấy lớp")

    new_code = _issue_code_and_assign(
        user_id=body.user_id, admin_id=admin_id, reason=body.reason or "cohort add",
        code_type="direct", cohort_id=cohort_id, permissions=["all"],
    )
    return {"ok": True, "user_id": body.user_id,
            "new_code": new_code.get("code"), "new_code_id": new_code.get("id")}


@router.delete("/{cohort_id}/members/{user_id}", status_code=204)
async def remove_cohort_member(
    cohort_id: str,
    user_id: str,
    authorization: str | None = Header(default=None),
):
    """Sprint 17.5 — remove a member from a cohort: deactivate the user's ACTIVE
    assignments to the cohort's codes (they drop out of the code-derived roster).
    Immutable redemption fields are never touched."""
    admin = await require_admin(authorization)
    admin_id = admin.get("id") if isinstance(admin, dict) else None

    code_rows = (
        supabase_admin.table("access_codes").select("id").eq("cohort_id", cohort_id).execute().data
    ) or []
    code_ids = [c["id"] for c in code_rows]
    if not code_ids:
        return   # no codes for this cohort → nothing to remove

    try:
        supabase_admin.table("user_code_assignments").update({
            "is_active": False,
            "revoked_at": datetime.now(timezone.utc).isoformat(),
            "assigned_by": admin_id,
            "reason": "cohort removal",
        }).in_("code_id", code_ids).eq("user_id", user_id).eq("is_active", True).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi gỡ thành viên: {exc}")


# ── WF-1 — CLASS ROSTER (students.cohort_id) ─────────────────────────────────
# Distinct from the code-issue /members endpoints above: these manage the
# canonical class roster (the column writing fan-out + grade-matrix read) by
# directly assigning EXISTING students, WITHOUT issuing any access code.
# Entitlement (who can log in / what they can do) stays in user_code_assignments.


class AssignStudentRequest(BaseModel):
    student_id: str


@router.post("/{cohort_id}/students")
async def assign_student_to_cohort(
    cohort_id: str,
    body: AssignStudentRequest,
    authorization: str | None = Header(default=None),
):
    """WF-1 — add an EXISTING student to this cohort's roster by setting
    `students.cohort_id`. Issues NO access code (entitlement is separate).
    Idempotent. The student then appears in GET /members and receives writing
    fan-out + shows in the grade-by-class matrix."""
    await require_admin(authorization)

    cohort = (
        supabase_admin.table("cohorts").select("id").eq("id", cohort_id).limit(1).execute().data
    ) or []
    if not cohort:
        raise HTTPException(404, "Không tìm thấy lớp")

    srow = (
        supabase_admin.table("students").select("id").eq("id", body.student_id).limit(1).execute().data
    ) or []
    if not srow:
        raise HTTPException(404, "Không tìm thấy học viên")

    try:
        supabase_admin.table("students").update(
            {"cohort_id": cohort_id}
        ).eq("id", body.student_id).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi gán học viên vào lớp: {exc}")

    return {"ok": True, "student_id": body.student_id, "cohort_id": cohort_id}


@router.delete("/{cohort_id}/students/{student_id}", status_code=204)
async def remove_student_from_cohort(
    cohort_id: str,
    student_id: str,
    authorization: str | None = Header(default=None),
):
    """WF-1 — remove a student from this cohort's roster (clear
    `students.cohort_id`). Only clears when the student is currently in THIS
    cohort (no-op otherwise, so a stale request can't yank a student out of a
    different class). Access codes / entitlement are NOT touched."""
    await require_admin(authorization)

    srow = (
        supabase_admin.table("students").select("id, cohort_id").eq("id", student_id).limit(1).execute().data
    ) or []
    if not srow or srow[0].get("cohort_id") != cohort_id:
        return   # not found or not in this cohort → nothing to clear

    try:
        supabase_admin.table("students").update(
            {"cohort_id": None}
        ).eq("id", student_id).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi gỡ học viên khỏi lớp: {exc}")
