"""Which classes a staff caller may see (ADMINIA-0074 FR-102, FR-108, FR-113;
plan 5.4 "Hàm phạm vi dùng chung"; G09-T24).

One teacher per class (00 mục 2 điểm 23, Q18 closed): a teacher's classes are
the cohorts whose ``cohorts.instructor_id`` is that teacher (migration 441).
This module is the ONLY backend code that reads ``cohorts.instructor_id`` to
decide access; G09 and GOI-11 routes call :func:`resolve_staff_scope` instead
of querying it themselves. A class with no teacher belongs to no teacher, so
only admins see it.

``resolve_staff_scope`` is a guard (listed in tests/test_staff_guard_inventory
GUARD_NAMES): its first statement awaits ``require_instructor``, which admits
an active instructor or an admin (with the admin second factor).

The Writing path keeps ``students.instructor_id`` (migration 106); setting a
class teacher does not change it.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Iterable, Optional
from uuid import UUID

from fastapi import HTTPException

from database import supabase_admin
from routers.admin import _staff_role_row, require_instructor


@dataclass(frozen=True)
class StaffScope:
    role: str                              # 'admin' | 'instructor'
    user_id: str
    # None: an admin, who sees every class. Otherwise the teacher's classes.
    cohort_ids: Optional[frozenset[str]]

    @property
    def is_admin(self) -> bool:
        return self.cohort_ids is None

    def covers(self, cohort_id: str) -> bool:
        return self.cohort_ids is None or str(cohort_id) in self.cohort_ids

    def assert_cohort(self, cohort_id: str) -> None:
        """404, not 403, so a teacher cannot learn that another class exists."""
        if not self.covers(cohort_id):
            raise HTTPException(404, "Không tìm thấy lớp")

    def filter_cohorts(self, cohort_ids: Iterable[str]) -> list[str]:
        return [c for c in cohort_ids if self.covers(c)]


def _unavailable() -> HTTPException:
    # Fail closed: an unreadable scope is never "every class" or "no class".
    return HTTPException(503, {"code": "staff_scope_unavailable",
                               "message": "Chưa xác định được lớp bạn phụ trách. Thử tải lại sau ít phút."})


async def resolve_staff_scope(authorization: str | None) -> StaffScope:
    auth_user = await require_instructor(authorization)
    user_id = str(auth_user["id"])
    try:
        role_rows = getattr(await _staff_role_row(user_id), "data", None) or []
    except Exception as exc:
        raise _unavailable() from exc
    role = (role_rows[0] or {}).get("role") if role_rows else None
    if role == "admin":
        return StaffScope(role="admin", user_id=user_id, cohort_ids=None)
    if role != "instructor":
        # require_instructor just admitted this caller; a role that changed
        # in between is refused rather than guessed.
        raise HTTPException(403, "Chỉ giáo viên hoặc quản trị viên mới xem được trang này.")
    return StaffScope(role="instructor", user_id=user_id, cohort_ids=await _teacher_cohorts(user_id))


async def _teacher_cohorts(user_id: str) -> frozenset[str]:
    try:
        res = await asyncio.to_thread(
            lambda: supabase_admin.table("cohorts").select("id").eq("instructor_id", user_id).execute())
    except Exception as exc:
        raise _unavailable() from exc
    return frozenset(str(r["id"]) for r in (getattr(res, "data", None) or []) if r.get("id"))


_NOT_A_TEACHER = "Không thể xem như: tài khoản không phải giảng viên."


async def scope_as_instructor(admin: StaffScope, target: str) -> StaffScope:
    """An admin's "xem như giáo viên" (``?as_instructor=``): the scope of
    ``target``'s classes, never every class.

    Only an admin scope may ask (anything else is a programming error). A
    target that is not a UUID, not a user, or not an instructor is refused
    with 403; an unreadable role or class list is 503. No path falls back to
    the admin's own every-class scope. The caller audits the impersonation
    before it returns any data (``routers.instructor._audit_impersonate``).
    """
    if not admin.is_admin:
        raise ValueError("scope_as_instructor needs an admin scope")
    try:
        target_id = str(UUID(str(target)))
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(403, _NOT_A_TEACHER)
    try:
        rows = getattr(await _staff_role_row(target_id), "data", None) or []
    except Exception as exc:
        raise _unavailable() from exc
    if not rows or (rows[0] or {}).get("role") != "instructor":
        raise HTTPException(403, _NOT_A_TEACHER)
    return StaffScope(role="instructor", user_id=target_id, cohort_ids=await _teacher_cohorts(target_id))
