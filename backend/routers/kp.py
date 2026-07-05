"""routers/kp.py — Knowledge-Point learner endpoints (Phase 2).

Auth: get_supabase_user (Bearer JWT). All routes are per-user.

  POST /api/kp/microcheck-answers  — record stepper micro-check results (highest-
                                      weight explicit evidence) → kp_evidence.
  GET  /api/me/kp-mastery          — the caller's KP mastery profile.
  GET  /api/me/roadmap             — personal roadmap (weak KPs + prerequisites).

Recording is best-effort in the service layer (never raises); the routes surface
a recorded/skipped tally so the client knows what landed.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Header, Query
from pydantic import BaseModel, Field

from routers.auth import get_supabase_user
from services import kp_evidence, kp_roadmap

logger = logging.getLogger(__name__)

router = APIRouter(tags=["knowledge-points"])


class KpRef(BaseModel):
    type: str
    slug: str
    anchor: str | None = None


class MicrocheckAnswer(BaseModel):
    kp: KpRef
    correct: bool
    context: dict | None = None


class MicrocheckBody(BaseModel):
    answers: list[MicrocheckAnswer] = Field(default_factory=list)


@router.post("/api/kp/microcheck-answers")
async def submit_microcheck_answers(
    body: MicrocheckBody, authorization: str | None = Header(default=None)
):
    """Record one or more micro-check answers as source=microcheck evidence.
    Skips (does not error on) answers whose KP doesn't resolve."""
    user = await get_supabase_user(authorization)
    user_id = user["id"]
    recorded = 0
    for a in body.answers:
        kp_id = kp_evidence.record_microcheck(
            user_id, kp_type=a.kp.type, ref_slug=a.kp.slug,
            anchor=a.kp.anchor or "", correct=a.correct, context=a.context)
        if kp_id:
            recorded += 1
    return {"recorded": recorded, "skipped": len(body.answers) - recorded}


@router.get("/api/me/kp-mastery")
async def get_my_kp_mastery(
    status: str | None = Query(default=None, pattern="^(weak|learning|strong)$"),
    kp_type: str | None = Query(default=None, pattern="^(grammar|vocab|skill)$"),
    authorization: str | None = Header(default=None),
):
    """The caller's KP mastery profile, optionally filtered by status / kp_type."""
    user = await get_supabase_user(authorization)
    items = kp_evidence.get_user_mastery(user["id"], status=status, kp_type=kp_type)
    counts = {"weak": 0, "learning": 0, "strong": 0}
    for it in items:
        if it["status"] in counts:
            counts[it["status"]] += 1
    return {"counts": counts, "items": items}


@router.get("/api/me/roadmap")
async def get_my_roadmap(authorization: str | None = Header(default=None)):
    """Personal roadmap: weak KPs ∪ their not-yet-strong prerequisites, ordered
    so prerequisites come first (topo-sort). Falls back to the static pathways
    when the learner has no evidence yet."""
    user = await get_supabase_user(authorization)
    return kp_roadmap.build_roadmap(user["id"])
