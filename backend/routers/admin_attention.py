"""Việc cần làm (ADMINIA-0074 FR-090…093, FR-104; plan 5.4; G09-T06). Read only.

* ``GET /admin/attention`` — admin. Every queue row, the week's classes,
  learners who need attention and the "Vận hành tuần này" numbers.
* ``GET /instructor/attention`` — a teacher's "Việc của tôi": the same
  service limited to their classes (``services.staff_scope``), without the
  admin rows (orders, incidents, feedback, exams today, unmetered classes)
  and without ``ops_week``. An admin on this door gets the teacher shape
  over every class, or, with ``?as_instructor=<teacher id>``, over that
  teacher's classes only (audited like every /instructor/* impersonation).

One failed source turns only its own row into ``error: true`` (or its block
into ``null`` plus a ``sources_failed`` name); the response is still 200.
"""

from __future__ import annotations

import asyncio
import functools
import logging
from typing import Optional

from fastapi import APIRouter, Header, Request

from models.admin_attention import AdminAttentionOut, InstructorAttentionOut, InstructorQueuesOut
from routers.admin import require_admin
from routers.instructor import _audit_impersonate
from services import ops_thresholds, staff_attention, test_data_visibility
from services.staff_scope import resolve_staff_scope, scope_as_instructor

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-attention"])


async def _thresholds() -> Optional[dict[str, Optional[int]]]:
    try:
        return await ops_thresholds.get()
    except ops_thresholds.ThresholdsUnavailable:
        return None


async def _build(**kw) -> dict:
    thresholds = await _thresholds()
    out = await asyncio.to_thread(functools.partial(staff_attention.build, thresholds=thresholds, **kw))
    logger.info("staff_attention admin=%s failed=%s", kw.get("cohort_ids") is None, out["sources_failed"])
    return out


@router.get("/admin/attention", response_model=AdminAttentionOut)
async def admin_attention(authorization: Optional[str] = Header(default=None)):
    admin = await require_admin(authorization)
    hide = await asyncio.to_thread(test_data_visibility.hide_for, email=admin.get("email"), is_admin=True)
    return await _build(cohort_ids=None, viewer_id=None, hide_test=hide)


@router.get("/instructor/attention", response_model=InstructorAttentionOut)
async def instructor_attention(request: Request, authorization: Optional[str] = Header(default=None)):
    scope = await resolve_staff_scope(authorization)
    caller = scope
    as_x = request.query_params.get("as_instructor")
    if as_x and scope.is_admin:
        # "Xem như giáo viên": only that teacher's classes. A bad target is
        # refused (403/503), never the admin's every-class list. A teacher's
        # ?as_instructor is ignored, as on every /instructor/* route.
        scope = await scope_as_instructor(scope, as_x)
        await asyncio.to_thread(_audit_impersonate, caller.user_id, scope.user_id, request.url.path)
    hide = await asyncio.to_thread(test_data_visibility.hide_for, user_id=caller.user_id, is_admin=caller.is_admin)
    out = await _build(cohort_ids=scope.cohort_ids, viewer_id=None if scope.is_admin else scope.user_id,
                       hide_test=hide)
    out.pop("ops_week", None)
    out["queues"] = {k: v for k, v in out["queues"].items() if k in InstructorQueuesOut.model_fields}
    return out
