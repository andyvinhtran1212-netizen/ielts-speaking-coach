"""Mock-exam Speaking grading queue (ADMINIA-0074 FR-060, FR-065, FR-067,
FR-069; plan 5.4; G09-T38 backend). Read only.

* ``GET /admin/speaking/mock-queue`` — an admin sees every exam; a teacher
  sees only exams of their own classes (``services.staff_scope``). Optional
  ``exam_id`` narrows it to one exam; an exam outside the caller's reach
  answers an empty list, so a teacher does not learn that it exists.

What "waiting" means lives in ``services/speaking_mock_queue.py``. The page
``/admin/speaking/grading`` comes with the new admin frame (G09-T08).
"""

from __future__ import annotations

import asyncio
import functools
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query

from models.admin_speaking_mock_queue import MockQueue
from services import ops_thresholds, speaking_mock_queue, test_data_visibility
from services.staff_scope import resolve_staff_scope

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-speaking"])


@router.get("/admin/speaking/mock-queue", response_model=MockQueue)
async def mock_queue(
    exam_id: Optional[UUID] = Query(default=None),
    authorization: str | None = Header(default=None),
):
    scope = await resolve_staff_scope(authorization)
    try:
        overdue_hours = (await ops_thresholds.get()).get("speaking_mock_hours")
    except ops_thresholds.ThresholdsUnavailable:
        overdue_hours = None
    try:
        hide = await asyncio.to_thread(
            test_data_visibility.hide_for, user_id=scope.user_id, is_admin=scope.is_admin)
        hidden = frozenset(await asyncio.to_thread(test_data_visibility.test_user_ids)) if hide else frozenset()
        items = await asyncio.to_thread(functools.partial(
            speaking_mock_queue.pending_items,
            exam_id=str(exam_id) if exam_id else None,
            cohort_ids=scope.cohort_ids,
            hide_user_ids=hidden,
            overdue_hours=overdue_hours,
        ))
    except Exception as exc:
        logger.exception("speaking mock queue: read failed")
        raise HTTPException(503, {"code": "speaking_queue_unavailable",
                                  "message": "Chưa tải được hàng chờ Speaking. Thử tải lại sau ít phút."}) from exc
    return {"items": items, "overdue_hours": overdue_hours}
