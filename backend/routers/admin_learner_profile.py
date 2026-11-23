"""Learner profile cards (ADMINIA-0074 FR-024, FR-030, FR-031; plan 5.4;
G09-T04).

* ``GET /admin/learners/{ref}/overview`` — admin. The Tổng quan tab: alerts,
  goal, continuity, assigned work, scores over time and the right column.
  Each block is read on its own; a failed block is ``null`` and named in
  ``sources_failed`` while the others still answer (200). Read only.
* ``POST /admin/learners/{ref}/goal/resolve`` — admin (G09-T04b, FR-030).
  ``{use: 'admin'|'learner'}`` copies that goal onto both the profile and the
  account and logs it (``fn_learner_goal_resolve``, mig 452), then answers the
  goal block read back. 409 ``no_conflict`` when there is nothing to resolve;
  503 ``goal_write_failed`` when the write did not happen (also before 452 is
  applied).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter, Header, HTTPException

from models.admin_learner_profile import GoalResolveIn, GoalResolveOut, LearnerOverview
from routers.admin import require_admin
from routers.admin_learners import _person, _thresholds
from services import admin_learner_profile as profile
from services import learner_care_notes as care_notes

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-learners"])


async def _block(name: str, fn: Callable[[], Any], failed: list[str]) -> Any:
    try:
        return await asyncio.to_thread(fn)
    except Exception as exc:
        logger.warning("learner overview: block %s failed (%s)", name, type(exc).__name__)
        failed.append(name)
        return None


@router.get("/admin/learners/{ref}/overview", response_model=LearnerOverview)
async def get_learner_overview(ref: str, authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    person = await _person(ref)
    thresholds = await _thresholds()
    now = datetime.now(timezone.utc)
    failed: list[str] = []
    alerts, goal, continuity, assigned, scores, due_notes = await asyncio.gather(
        _block("alerts", lambda: profile.alerts(person, thresholds, now=now), failed),
        _block("goal", lambda: profile.goal(person), failed),
        _block("continuity", lambda: profile.continuity(person, now=now), failed),
        _block("assigned", lambda: profile.assigned(person, now=now), failed),
        _block("scores", lambda: profile.scores(person), failed),
        _block("care_notes", lambda: care_notes.due(person), failed),
    )
    if (assigned and assigned["undecided"]) or (alerts and alerts["undecided"]):
        failed.append("assignments")
    return {"alerts": alerts, "goal": goal, "continuity": continuity, "assigned": assigned,
            "scores": scores, "side": profile.side(due_notes), "sources_failed": sorted(set(failed))}


@router.post("/admin/learners/{ref}/goal/resolve", response_model=GoalResolveOut)
async def resolve_learner_goal(ref: str, body: GoalResolveIn, authorization: str | None = Header(default=None)):
    admin = await require_admin(authorization)
    person = await _person(ref)
    try:
        await asyncio.to_thread(profile.resolve_goal, person, body.use,
                                body.seen.model_dump(mode="json"), str(admin.get("id") or "") or None)
    except profile.GoalChanged:
        raise HTTPException(409, {"code": "goal_changed",
                                  "message": "Mục tiêu vừa được sửa sau khi trang mở. Chưa ghi gì; tải lại trang rồi chọn lại."})
    except profile.GoalNotLinked:
        raise HTTPException(409, {"code": "learner_not_linked",
                                  "message": "Hồ sơ này không còn gắn với tài khoản đó. Chưa ghi gì; tải lại trang."})
    except profile.GoalNoConflict:
        raise HTTPException(409, {"code": "no_conflict",
                                  "message": "Hai nguồn mục tiêu đã khớp hoặc một nguồn còn trống. Tải lại trang."})
    except Exception as exc:
        logger.exception("learner goal: resolve failed")
        raise HTTPException(503, {"code": "goal_write_failed",
                                  "message": "Chưa lưu được mục tiêu. Không có thay đổi nào được ghi; thử lại."}) from exc
    # Canonical read-back: the goal as now stored, not the value sent. The
    # write is already committed, so any failure from here on says so.
    try:
        fresh = await _person(person.ref)
        goal = await asyncio.to_thread(profile.goal, fresh)
    except Exception as exc:
        logger.exception("learner goal: read-back failed")
        raise HTTPException(503, {"code": "goal_saved_unreadable",
                                  "message": "Đã lưu mục tiêu nhưng chưa đọc lại được. Tải lại trang."}) from exc
    return {"goal": goal}
