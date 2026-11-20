"""Learner profile cards (ADMINIA-0074 FR-024, FR-030, FR-031; plan 5.4;
G09-T04).

* ``GET /admin/learners/{ref}/overview`` — admin. The Tổng quan tab: alerts,
  goal, continuity, assigned work, scores over time and the right column.
  Each block is read on its own; a failed block is ``null`` and named in
  ``sources_failed`` while the others still answer (200). Read only.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter, Header

from models.admin_learner_profile import LearnerOverview
from routers.admin import require_admin
from routers.admin_learners import _person, _thresholds
from services import admin_learner_profile as profile

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
    alerts, goal, continuity, assigned, scores = await asyncio.gather(
        _block("alerts", lambda: profile.alerts(person, thresholds, now=now), failed),
        _block("goal", lambda: profile.goal(person), failed),
        _block("continuity", lambda: profile.continuity(person, now=now), failed),
        _block("assigned", lambda: profile.assigned(person, now=now), failed),
        _block("scores", lambda: profile.scores(person), failed),
    )
    if assigned and assigned["undecided"]:
        failed.append("assignments")
    return {"alerts": alerts, "goal": goal, "continuity": continuity, "assigned": assigned,
            "scores": scores, "side": profile.side(), "sources_failed": sorted(failed)}
