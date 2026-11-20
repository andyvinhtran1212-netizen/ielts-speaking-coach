"""Learner directory and summary (ADMINIA-0074 FR-09-020…022, FR-09-029,
FR-102; plan 5.4; G09-T03). Read only.

* ``GET /admin/learners`` — admin. One row per person, 25 per page.
* ``GET /admin/learners/{ref}`` — admin. ``{ref, canonical_ref, summary}``.
* ``GET /admin/learners/{ref}/summary`` — admin, or a teacher for a learner in
  one of their classes (``services.staff_scope``; anyone else 404).
* ``GET /instructor/learners/{ref}`` — the teacher's door to the same detail.

The service is synchronous (``services/admin_learner_directory.py``) and runs
in a worker thread. Filters that need G04 (course kind, course status,
credits) are refused with 422 ``filter_unavailable`` until G04 ships its read
API, rather than answered with a guess.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query

from models.admin_learners import LearnerDetail, LearnerDirectory, LearnerSummaryOut
from routers.admin import require_admin
from services import admin_learner_directory as directory, ops_thresholds, test_data_visibility
from services.staff_scope import StaffScope, resolve_staff_scope

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-learners"])

_ROLES = {"user", "student", "instructor", "admin"}


def _g04_unavailable(name: str) -> HTTPException:
    return HTTPException(422, {"code": "filter_unavailable", "field": name,
                               "message": "Bộ lọc này cần dữ liệu khoá học và lượt chấm, chưa có."})


def _unavailable() -> HTTPException:
    return HTTPException(503, {"code": "learners_unavailable",
                               "message": "Chưa tải được danh sách học viên. Thử tải lại sau ít phút."})


async def _thresholds() -> Optional[dict[str, Optional[int]]]:
    try:
        return await ops_thresholds.get()
    except ops_thresholds.ThresholdsUnavailable:
        return None


@router.get("/admin/learners", response_model=LearnerDirectory)
async def list_learners(
    q: Optional[str] = Query(default=None, max_length=128),
    cohort_id: Optional[UUID] = Query(default=None),
    kind: Optional[Literal["offline", "online", "both", "none"]] = Query(default=None),
    status: Optional[Literal["active", "expiring", "expired", "archived"]] = Query(default=None),
    attention: Optional[Literal["any", "late_streak", "inactive", "expiring", "low_credits"]] = Query(default=None),
    credits_max: Optional[int] = Query(default=None, ge=0),
    role: str = Query(default="user,student", max_length=64),
    page: int = Query(default=1, ge=1, le=10_000),
    page_size: int = Query(default=directory.PAGE_SIZE, ge=directory.PAGE_SIZE, le=directory.PAGE_SIZE),
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    roles = {r.strip() for r in role.split(",") if r.strip()}
    if not roles or not roles <= _ROLES:
        raise HTTPException(422, {"code": "invalid_role", "message": "Vai trò không hợp lệ."})
    if kind is not None:
        raise _g04_unavailable("kind")
    if status in ("active", "expiring", "expired"):
        raise _g04_unavailable("status")
    if attention in ("expiring", "low_credits"):
        raise _g04_unavailable("attention")
    if credits_max is not None:
        raise _g04_unavailable("credits_max")

    thresholds = await _thresholds()
    hide = await asyncio.to_thread(test_data_visibility.hide_for, email=admin.get("email"), is_admin=True)
    try:
        return await asyncio.to_thread(
            directory.directory, q=(q or "").strip() or None,
            cohort_id=str(cohort_id) if cohort_id else None, archived=status == "archived",
            attention=attention, roles=roles, page=page, hide_test=hide, thresholds=thresholds)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("admin learners: directory read failed")
        raise _unavailable() from exc


async def _person(ref: str) -> directory.Person:
    try:
        return await asyncio.to_thread(directory.resolve, ref)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("admin learners: learner read failed")
        raise _unavailable() from exc


async def _assert_in_scope(scope: StaffScope, person: directory.Person) -> None:
    if scope.is_admin:
        return
    try:
        ok = await asyncio.to_thread(directory.in_cohorts, person, scope.cohort_ids or frozenset())
    except Exception as exc:
        raise HTTPException(503, {"code": "staff_scope_unavailable",
                                  "message": "Chưa xác định được lớp bạn phụ trách. Thử tải lại sau ít phút."}) from exc
    if not ok:
        # 404, not 403: a teacher does not learn that the learner exists.
        raise HTTPException(404, "Không tìm thấy học viên")


async def _detail(ref: str, person: directory.Person) -> dict:
    thresholds = await _thresholds()
    summary, failed = await asyncio.to_thread(directory.summary, person, thresholds)
    return {"ref": ref, "canonical_ref": person.ref, "summary": summary, "sources_failed": failed}


@router.get("/admin/learners/{ref}", response_model=LearnerDetail)
async def get_learner(ref: str, authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    return await _detail(ref, await _person(ref))


@router.get("/admin/learners/{ref}/summary", response_model=LearnerSummaryOut)
async def get_learner_summary(ref: str, authorization: str | None = Header(default=None)):
    scope = await resolve_staff_scope(authorization)
    person = await _person(ref)
    await _assert_in_scope(scope, person)
    detail = await _detail(ref, person)
    return {**detail["summary"], "sources_failed": detail["sources_failed"]}


@router.get("/instructor/learners/{ref}", response_model=LearnerDetail)
async def get_instructor_learner(ref: str, authorization: str | None = Header(default=None)):
    scope = await resolve_staff_scope(authorization)
    person = await _person(ref)
    await _assert_in_scope(scope, person)
    return await _detail(ref, person)
