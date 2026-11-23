"""Admin API for runtime kill-switch flags (ADR-010 / FE migration plan B37).

Flipping a flag here is live on every backend instance within one cache
window (15 s — services/runtime_flags._TTL_SECONDS) with NO redeploy. This is
the mutation kill switch the FE migration plan's pilot checklist requires.

PATCH (not PUT) on purpose: the CORS hardening in main.py (C-4.2) allows
GET/POST/PATCH/DELETE only, and every other update endpoint in the app is
PATCH — a PUT here would fail the browser preflight from the admin frontend.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid

from fastapi import APIRouter, Header
from fastapi import HTTPException
from pydantic import BaseModel, Field

from sqlalchemy import text

from config import settings
from database import supabase_admin
from routers.admin import require_admin
from services import runtime_flags
from services.async_pg_engine import create_asyncpg_engine

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-flags"])

_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")


class FlagUpdate(BaseModel):
    enabled: bool
    note: str | None = Field(default=None, max_length=500)


@router.get("/admin/runtime-flags")
async def list_flags(authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    res = (
        supabase_admin.table("runtime_flags")
        .select("key, enabled, note, updated_at, updated_by")
        .order("key")
        .execute()
    )
    return {"flags": res.data or [], "cache_ttl_seconds": 15}


@router.patch("/admin/runtime-flags/{key}")
async def patch_flag(
    key: str,
    body: FlagUpdate,
    authorization: str | None = Header(default=None),
):
    admin = await require_admin(authorization)
    if not _KEY_RE.match(key):
        raise HTTPException(422, "Flag key phải khớp ^[a-z0-9][a-z0-9_.-]{0,63}$")
    stored = runtime_flags.set_flag(
        key, body.enabled, note=body.note, updated_by=admin.get("id"),
    )
    return {"flag": stored, "effective_within_seconds": 15}


# ── POST /admin/users/{user_id}/learner-v2-flag ───────────────────────────────
#
# LEARNERCORE-0063 FR-074: per-learner opt-in for the new learner UI. Writes
# only users.feature_flags.learner_v2 (one jsonb_set UPDATE) and answers with
# the value RETURNING gives after the write, so the admin sees stored truth.
# The opt-in takes effect only while runtime_flags('learner_v2') is on
# (FR-072); this route never touches runtime_flags. Lives here, next to the
# runtime switches it pairs with, rather than in routers/admin.py.

class LearnerV2FlagPayload(BaseModel):
    enabled: bool


class LearnerV2FlagResponse(BaseModel):
    user_id: str
    learner_v2: bool


_db_engine = (
    create_asyncpg_engine(settings.ASYNC_DATABASE_URL)
    if settings.ASYNC_DATABASE_URL
    else None
)

# One statement: only the learner_v2 key of feature_flags changes, so a
# concurrent write of another key (fn_set_vocab_curated_cohort, the vocab-flag
# route) is never overwritten by a stale read-modify-write (Codex P2, #2524).
# RETURNING gives the stored value after the write.
_SET_LEARNER_V2_SQL = text(
    """
    UPDATE public.users
       SET feature_flags = jsonb_set(COALESCE(feature_flags, '{}'::jsonb),
                                     '{learner_v2}', to_jsonb(CAST(:enabled AS boolean)), true)
     WHERE id = CAST(:user_id AS uuid)
 RETURNING feature_flags
    """
)


async def _set_learner_v2(user_id: str, enabled: bool) -> dict | None:
    """Set the key and return the stored feature_flags, or None if no such user."""
    if _db_engine is None:
        raise RuntimeError("DATABASE_URL is not configured")
    async with _db_engine.begin() as conn:
        row = (await conn.execute(_SET_LEARNER_V2_SQL,
                                  {"enabled": enabled, "user_id": user_id})).first()
    if row is None:
        return None
    flags = row[0]
    if isinstance(flags, str):
        flags = json.loads(flags)
    return flags if isinstance(flags, dict) else {}


@router.post("/admin/users/{user_id}/learner-v2-flag", response_model=LearnerV2FlagResponse)
async def admin_set_learner_v2_flag(
    user_id: str,
    payload: LearnerV2FlagPayload,
    authorization: str | None = Header(default=None),
):
    """Turn the new learner UI on or off for one learner (LEARNERCORE-0063 FR-074)."""
    await require_admin(authorization)
    try:
        uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(404, "User not found")

    try:
        stored = await _set_learner_v2(user_id, payload.enabled)
    except Exception as exc:
        logger.warning("[admin] learner_v2 flag write failed: %s", exc.__class__.__name__)
        raise HTTPException(503, "Chưa lưu được cờ, thử lại sau.")
    if stored is None:
        raise HTTPException(404, "User not found")

    learner_v2 = stored.get("learner_v2") is True
    logger.info("[admin] learner_v2 flag %s for user %s",
                "enabled" if learner_v2 else "disabled", user_id)
    return {"user_id": user_id, "learner_v2": learner_v2}
