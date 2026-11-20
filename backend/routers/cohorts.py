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

import asyncio
import logging
import re
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from database import supabase_admin
from models.cohorts import AdminCohortListOut, CohortArchivePreviewOut
from routers.admin import (
    require_admin, _aggregate_usage_for_users, _issue_code_and_assign, _activate_with_issued_code,
)
from services import class_archive_service, student_service, test_data_visibility
from services.class_service import list_cohorts_basic, list_cohorts_with_rollup
from services.cohort_progress_aggregator import cohort_progress
from services.errors import GENERIC_MESSAGE, new_ref
from services.class_membership_service import (
    active_students_for_cohort,
    add_student,
    add_students,
    remove_student,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/cohorts", tags=["admin", "cohorts"])


class CohortCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code_prefix: str | None = Field(default=None, max_length=20)
    description: str | None = None
    course_id: str | None = None          # mig 175 — NULL = chưa gán khoá


class CohortPatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    code_prefix: str | None = Field(default=None, max_length=20)
    description: str | None = None
    # CLASSARCHIVE-0030: a change goes through fn_archive_cohort /
    # fn_restore_cohort (migration 337), never a plain flag write.
    is_active: bool | None = None
    # Optional (D5), trimmed, empty → NULL, at most 500 characters. Only
    # meaningful together with `is_active`.
    archive_reason: str | None = None
    # mig 175. Explicit null is meaningful here — it un-assigns the course — so
    # this field is read via `exclude_unset` below, not by an is-not-None check
    # like its neighbours.
    course_id: str | None = None
    # G09-T24 (mig 441). Explicit null clears each of these, so they are read
    # from model_fields_set too. One teacher per class: instructor_id must be an
    # active instructor or admin; the change is logged in class_action_log.
    instructor_id: uuid.UUID | None = None
    weekly_schedule: list["ScheduleSlot"] | None = Field(default=None, max_length=14)
    start_date: date | None = None


_START_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class ScheduleSlot(BaseModel):
    # ISO weekday: 1 = Thứ Hai … 7 = Chủ nhật.
    dow: int = Field(ge=1, le=7, strict=True)
    start: str

    @field_validator("start")
    @classmethod
    def _hh_mm(cls, value: str) -> str:
        if not _START_RE.match(value):
            raise ValueError("Giờ bắt đầu theo dạng HH:MM, ví dụ 19:30.")
        return value


CohortPatchRequest.model_rebuild()


@router.get(
    "",
    response_model=AdminCohortListOut,
    response_model_exclude_unset=True,
)
async def list_cohorts(
    is_active: bool | None = None,
    course_id: str | None = None,
    with_rollup: bool = False,
    authorization: str | None = Header(default=None),
):
    """List cohorts. Plain rows by default; `with_rollup=true` adds course +
    roster counts.

    The rollup is OPT-IN because five other admin screens (access-codes, users,
    writing-queue, mock-exams, exam-content) call this endpoint purely to fill a
    cohort picker. Running the roster scan for them would make those unrelated
    pages pay a full paginated pass over every student in every class, growing
    with the school, for data they never render. Only the merged Lớp & Học viên
    page asks for it.

    With the rollup on, `unactivated_count` is the number of students on the
    roster with no account — they receive nothing that is assigned to them, so
    that page shows it on every class row rather than behind a click. Both counts
    come back `null`, plus a top-level `rollup_failed: true`, when the roster
    scan errors: "0 học viên" is a claim a failed query has not earned.

    Pass `is_active=false` to see archived classes; omit it for everything.
    """
    admin = await require_admin(authorization)

    try:
        if with_rollup:
            result = list_cohorts_with_rollup(
                supabase_admin, is_active=is_active, course_id=course_id
            )
        else:
            result = list_cohorts_basic(
                supabase_admin, is_active=is_active, course_id=course_id
            )
    except Exception as exc:
        logger.error("[cohorts] list failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải danh sách lớp. Vui lòng thử lại.") from None
    if test_data_visibility.hide_for(email=admin.get("email"), is_admin=True):
        result["cohorts"] = [
            c for c in result["cohorts"] if not test_data_visibility.is_test_label(c.get("name"))
        ]
    names, failed = await asyncio.to_thread(
        _teacher_names, [c.get("instructor_id") for c in result["cohorts"]])
    for c in result["cohorts"]:
        c["instructor"] = _teacher_of(c, names)
    if failed:
        result["instructor_lookup_failed"] = True
    return result


def _teacher_names(ids) -> tuple[dict[str, str], bool]:
    """{user_id: name} for class teachers (G09-T24), and whether the lookup
    failed. Rows read before migration 441 carry no instructor_id."""
    wanted = sorted({str(i) for i in ids if i})
    if not wanted:
        return {}, False
    try:
        rows = (
            supabase_admin.table("users").select("id, display_name, email")
            .in_("id", wanted).execute().data
        ) or []
    except Exception:
        logger.error("[cohorts] teacher names lookup failed", exc_info=True)
        return {}, True
    return {r["id"]: (r.get("display_name") or r.get("email") or "") for r in rows}, False


def _teacher_of(cohort: dict, names: dict[str, str]) -> dict | None:
    teacher_id = cohort.get("instructor_id")
    if not teacher_id:
        return None
    return {"id": str(teacher_id), "name": names.get(str(teacher_id))}


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
        "course_id": body.course_id,
        "is_active": True,
        "created_by": admin["id"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    try:
        r = supabase_admin.table("cohorts").insert(payload).execute()
    except Exception as exc:
        logger.error("[cohorts] create failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tạo lớp. Vui lòng thử lại.") from None
    if not r.data:
        raise HTTPException(500, "Không tạo được lớp")
    return r.data[0]


@router.patch("/{cohort_id}")
async def update_cohort(
    cohort_id: str,
    body: CohortPatchRequest,
    authorization: str | None = Header(default=None),
):
    """Edit a class; archive or restore it when `is_active` is sent.

    An `is_active` change runs `fn_archive_cohort` / `fn_restore_cohort` FIRST
    (research.md §4.2 W14): the flag, `archived_at/by/reason` and one
    `class_lifecycle_audit` row commit together, and a repeat writes no audit
    row. If the RPC fails nothing else is written. Name, prefix, description
    and course are then saved by a plain UPDATE. The response is the cohort row;
    with `is_active` it also carries `archive_receipt` (the RPC result).
    """
    admin = await require_admin(authorization)

    updates: dict = {}
    # `name` cannot be cleared (a class must have one), so is-not-None is the
    # right test for it. Every other field here is optional and clearable, so
    # they are read from `model_fields_set`: an explicit `null` means "xoá giá
    # trị này". An is-not-None check drops that null, the UPDATE still succeeds
    # because other fields are present, and the admin watches the old value
    # reappear after a save that reported success — a silent no-op, which is the
    # failure mode this project's rules single out. (GĐ 1: latent until the new
    # class-edit form began sending all four fields on every save.)
    if body.name is not None:
        updates["name"] = body.name
    for field in ("code_prefix", "description", "course_id"):
        if field in body.model_fields_set:
            updates[field] = getattr(body, field)
    if "weekly_schedule" in body.model_fields_set:
        updates["weekly_schedule"] = (None if body.weekly_schedule is None
                                      else [slot.model_dump() for slot in body.weekly_schedule])
    if "start_date" in body.model_fields_set:
        updates["start_date"] = body.start_date.isoformat() if body.start_date else None
    teacher_change = "instructor_id" in body.model_fields_set
    teacher_id = str(body.instructor_id) if body.instructor_id else None

    if not updates and body.is_active is None and not teacher_change:
        raise HTTPException(400, "Không có trường nào để cập nhật")
    if body.is_active is None and body.archive_reason is not None:
        raise HTTPException(400, "Lý do chỉ dùng khi lưu trữ hoặc khôi phục lớp")
    try:
        reason = class_archive_service.normalize_reason(body.archive_reason)
    except ValueError:
        raise HTTPException(422, "Lý do lưu trữ tối đa 500 ký tự") from None

    actor_id = admin.get("id") if isinstance(admin, dict) else None
    if teacher_change and teacher_id is not None:
        await asyncio.to_thread(_require_teacher_candidate, teacher_id)
    teacher = None
    if teacher_change:
        teacher = {"instructor_id": teacher_id,
                   "actor_email": admin.get("email") if isinstance(admin, dict) else None}
    return await asyncio.to_thread(
        _update_cohort_sync, cohort_id, updates, body.is_active, reason, actor_id, teacher)


def _require_teacher_candidate(user_id: str) -> None:
    """422 invalid_instructor unless ``user_id`` is an active instructor or
    admin (plan 5.4). A learner can never be made a class teacher."""
    try:
        rows = (
            supabase_admin.table("users").select("id, role, is_active")
            .eq("id", user_id).limit(1).execute().data
        ) or []
    except Exception:
        logger.error("[cohorts] teacher lookup failed", exc_info=True)
        raise HTTPException(500, "Lỗi khi kiểm tra giáo viên. Vui lòng thử lại.") from None
    row = rows[0] if rows else {}
    if row.get("role") not in ("instructor", "admin") or row.get("is_active") is False:
        raise HTTPException(422, {
            "code": "invalid_instructor",
            "message": "Người được chọn không phải giáo viên hoặc quản trị viên đang hoạt động.",
        })


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


def _lifecycle_failed(cohort_id: str, *, context: str) -> HTTPException:
    ref = new_ref()
    logger.error("[cohorts] %s failed ref=%s cohort=%s", context, ref, cohort_id, exc_info=True)
    return HTTPException(500, {
        "error_code": "cohort_lifecycle_failed", "message": GENERIC_MESSAGE, "ref": ref,
    })


def _update_cohort_sync(
    cohort_id: str,
    updates: dict,
    is_active: bool | None,
    reason: str | None,
    actor_id: str | None,
    teacher: dict | None = None,
):
    receipt = None
    if is_active is not None:
        if not _is_uuid(cohort_id):
            raise HTTPException(404, "Không tìm thấy lớp")
        lifecycle = (class_archive_service.restore_class if is_active
                     else class_archive_service.archive_class)
        try:
            receipt = lifecycle(
                supabase_admin, cohort_id=cohort_id, actor_id=actor_id, reason=reason)
        except Exception as exc:
            if class_archive_service.is_reason_too_long_error(exc):
                raise HTTPException(422, "Lý do lưu trữ tối đa 500 ký tự") from None
            raise _lifecycle_failed(
                cohort_id, context="restore" if is_active else "archive") from None
        if receipt is None:
            raise HTTPException(404, "Không tìm thấy lớp")

    teacher_receipt = None
    if teacher is not None:
        if not _is_uuid(cohort_id):
            raise HTTPException(404, "Không tìm thấy lớp")
        try:
            teacher_receipt = supabase_admin.rpc("fn_set_cohort_teacher", {
                "p_cohort_id": cohort_id, "p_instructor_id": teacher["instructor_id"],
                "p_actor_id": actor_id, "p_actor_email": teacher.get("actor_email"),
            }).execute().data
        except Exception:
            if receipt is not None and receipt.get("status") in ("archived", "restored"):
                raise _lifecycle_failed(cohort_id, context="teacher after lifecycle") from None
            raise _lifecycle_failed(cohort_id, context="teacher") from None
        if teacher_receipt is None:
            raise HTTPException(404, "Không tìm thấy lớp")

    # The class state changed in this request; a later failure must say so.
    changed = (receipt is not None and receipt.get("status") in ("archived", "restored")) or (
        isinstance(teacher_receipt, dict) and teacher_receipt.get("status") == "changed")

    def _partial(context: str) -> HTTPException:
        ref = new_ref()
        status = receipt.get("status") if receipt is not None else "teacher_change"
        logger.error("[cohorts] %s failed after %s ref=%s cohort=%s",
                     context, status, ref, cohort_id, exc_info=True)
        if receipt is None:
            return HTTPException(500, {
                "error_code": "cohort_update_partial",
                "message": "Đã đổi giáo viên của lớp nhưng chưa lưu được thay đổi khác. "
                           "Vui lòng tải lại trang rồi thử lại.",
                "ref": ref,
            })
        done = "khôi phục" if is_active else "lưu trữ"
        return HTTPException(500, {
            "error_code": "cohort_update_partial",
            "message": f"Đã {done} lớp nhưng chưa lưu được thay đổi khác. "
                       "Vui lòng tải lại trang rồi thử lại.",
            "ref": ref,
        })

    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        try:
            r = (
                supabase_admin.table("cohorts")
                .update(updates)
                .eq("id", cohort_id)
                .execute()
            )
        except Exception as exc:
            if changed:
                raise _partial("update") from None
            logger.error("[cohorts] update failed: %s", exc, exc_info=True)
            raise HTTPException(500, "Lỗi khi cập nhật lớp. Vui lòng thử lại.") from None
        rows = r.data
    else:
        try:
            rows = (
                supabase_admin.table("cohorts").select("*").eq("id", cohort_id)
                .limit(1).execute()
            ).data
        except Exception:
            if changed:
                raise _partial("reload") from None
            raise _lifecycle_failed(cohort_id, context="reload") from None

    if not rows:
        raise HTTPException(404, "Không tìm thấy lớp")
    row = rows[0]
    if teacher_receipt is not None:
        row = {**row, "teacher_receipt": teacher_receipt}
    if receipt is None:
        return row
    return {**row, "archive_receipt": receipt}


@router.get("/{cohort_id}/archive-preview", response_model=CohortArchivePreviewOut)
async def cohort_archive_preview(cohort_id: str, authorization: str | None = Header(default=None)):
    """Counts for the archive confirm dialog (`fn_cohort_archive_counts`):
    active members, open Writing gives, open class items, unused class codes.
    Plain reads; nothing is locked or written."""
    await require_admin(authorization)
    return await asyncio.to_thread(_archive_preview_sync, cohort_id)


def _archive_preview_sync(cohort_id: str) -> dict:
    if not _is_uuid(cohort_id):
        raise HTTPException(404, "Không tìm thấy lớp")
    try:
        counts = class_archive_service.archive_preview(supabase_admin, cohort_id)
    except Exception:
        raise _lifecycle_failed(cohort_id, context="archive preview") from None
    if counts is None:
        raise HTTPException(404, "Không tìm thấy lớp")
    return {"cohort_id": cohort_id, "counts": counts}


_ZERO_USAGE = {"sessions": 0, "last_active": None, "ai_cost_usd": 0.0}


@router.get("/{cohort_id}/members")
async def cohort_members(cohort_id: str, authorization: str | None = Header(default=None)):
    """Canonical active roster from ``student_cohort_memberships``.

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
        students = active_students_for_cohort(
            supabase_admin, cohort_id, "id, student_code, full_name, user_id")
        students.sort(key=lambda row: (row.get("full_name") or "").casefold())
    except Exception as exc:
        logger.error("[cohorts] members lookup failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải thành viên. Vui lòng thử lại.") from None

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
    names, failed = await asyncio.to_thread(_teacher_names, [cohort.get("instructor_id")])
    cohort = {**cohort, "instructor": _teacher_of(cohort, names)}
    if failed:
        cohort["instructor_lookup_failed"] = True
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
        supabase_admin.table("cohorts").select("*").eq("id", cohort_id).limit(1).execute().data
    ) or []
    if not cohort:
        raise HTTPException(404, "Không tìm thấy lớp")
    # CLASSARCHIVE-0030 W5: refused before any code is issued.
    if class_archive_service.is_cohort_archived(cohort[0]):
        raise class_archive_service.cohort_archived_error()

    # W-03 — mirror generate-and-assign: the target must be a real user, and the
    # admin-granted code activates the account (compensated on failure), so the
    # learner can sign in and pass the activation gate without a code of their own.
    target = (
        supabase_admin.table("users").select("id").eq("id", body.user_id).limit(1).execute().data
    ) or []
    if not target:
        raise HTTPException(404, "Không tìm thấy người dùng")

    new_code = _issue_code_and_assign(
        user_id=body.user_id, admin_id=admin_id, reason=body.reason or "cohort add",
        code_type="direct", cohort_id=cohort_id, permissions=["all"],
    )
    _activate_with_issued_code(body.user_id, new_code)
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
        logger.error("[cohorts] member removal failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi gỡ thành viên. Vui lòng thử lại.") from None


# ── CANONICAL MULTI-CLASS ROSTER ─────────────────────────────────────────────
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
    """Add an existing student without removing their other classes."""
    admin = await require_admin(authorization)

    cohort = (
        supabase_admin.table("cohorts").select("*").eq("id", cohort_id).limit(1).execute().data
    ) or []
    if not cohort:
        raise HTTPException(404, "Không tìm thấy lớp")

    srow = (
        supabase_admin.table("students").select("*").eq("id", body.student_id).limit(1).execute().data
    ) or []
    if not srow:
        raise HTTPException(404, "Không tìm thấy học viên")
    # CLASSARCHIVE-0030 W3. Precedence (research.md §4.1): an archived learner
    # gets student_archived first, as the 326 guard would answer.
    if class_archive_service.is_cohort_archived(cohort[0]):
        if srow[0].get("archived_at"):
            raise student_service.student_archived_error([body.student_id])
        raise class_archive_service.cohort_archived_error()

    try:
        add_student(
            supabase_admin, student_id=body.student_id, cohort_id=cohort_id,
            added_by=admin.get("id") if isinstance(admin, dict) else None,
        )
    except Exception as exc:
        # Migration 326 guard: an archived learner cannot rejoin a class.
        if student_service.is_student_archived_error(exc):
            raise student_service.student_archived_error([body.student_id]) from exc
        # Migration 337 guard: the class was archived after the pre-check.
        class_archive_service.raise_if_cohort_archived(exc)
        logger.error("[cohorts] student assignment failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi gán học viên vào lớp. Vui lòng thử lại.") from None

    return {"ok": True, "student_id": body.student_id, "cohort_id": cohort_id}


class BulkAssignStudentsRequest(BaseModel):
    student_ids: list[str] = Field(..., min_length=1, max_length=500)


@router.post("/{cohort_id}/students/bulk")
async def bulk_assign_students_to_cohort(
    cohort_id: str,
    body: BulkAssignStudentsRequest,
    authorization: str | None = Header(default=None),
):
    """Add many existing students atomically without moving them."""
    admin = await require_admin(authorization)

    cohort = (
        supabase_admin.table("cohorts").select("*").eq("id", cohort_id).limit(1).execute().data
    ) or []
    if not cohort:
        raise HTTPException(404, "Không tìm thấy lớp")
    # CLASSARCHIVE-0030 W4: the whole batch is refused. An archived learner in
    # the batch gets student_archived first (research.md §4.1 precedence); if
    # that lookup fails the batch is still refused, as cohort_archived.
    if class_archive_service.is_cohort_archived(cohort[0]):
        try:
            archived = await asyncio.to_thread(
                student_service.archived_student_ids, supabase_admin, body.student_ids)
        except Exception:
            archived = []
        if archived:
            raise student_service.student_archived_error(archived)
        raise class_archive_service.cohort_archived_error()

    try:
        assigned = add_students(
            supabase_admin, student_ids=body.student_ids, cohort_id=cohort_id,
            added_by=admin.get("id") if isinstance(admin, dict) else None,
        )
    except Exception as exc:
        # Migration 326 guard refuses the whole batch: nobody was added.
        if student_service.is_student_archived_error(exc):
            try:
                archived = student_service.archived_student_ids(
                    supabase_admin, body.student_ids)
            except Exception:
                archived = []
            raise student_service.student_archived_error(archived) from exc
        class_archive_service.raise_if_cohort_archived(exc)
        logger.error("[cohorts] bulk student assignment failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi gán học viên vào lớp. Vui lòng thử lại.") from None

    return {"ok": True, "cohort_id": cohort_id, "assigned": assigned}


@router.delete("/{cohort_id}/students/{student_id}", status_code=204)
async def remove_student_from_cohort(
    cohort_id: str,
    student_id: str,
    authorization: str | None = Header(default=None),
):
    """Remove only this membership; other classes and entitlement stay intact."""
    await require_admin(authorization)

    try:
        remove_student(supabase_admin, student_id=student_id, cohort_id=cohort_id)
    except Exception as exc:
        logger.error("[cohorts] student removal failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi gỡ học viên khỏi lớp. Vui lòng thử lại.") from None


@router.get("/{cohort_id}/progress")
async def cohort_progress_matrix(
    cohort_id: str,
    authorization: str | None = Header(default=None),
):
    """Tiến độ 4 kỹ năng của cả lớp — mỗi học viên một dòng.

    One query per skill over the whole roster, not per student: a class of 30
    asked skill-by-skill is 120 round-trips and it grows with the roster.

    Skills whose query failed come back as `null` on every row and are named in
    `degraded`. "0 lượt Reading" is a claim about a student that an errored query
    has not earned, and unlike a slow page a wrong zero is invisible.
    """
    await require_admin(authorization)

    rows = (
        supabase_admin.table("cohorts").select("id").eq("id", cohort_id)
        .limit(1).execute().data
    ) or []
    if not rows:
        raise HTTPException(404, "Không tìm thấy lớp")

    try:
        return cohort_progress(supabase_admin, cohort_id)
    except Exception as exc:
        logger.error("[cohorts] progress calculation failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tính tiến độ lớp. Vui lòng thử lại.") from None
