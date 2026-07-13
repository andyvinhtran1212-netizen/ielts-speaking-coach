"""Admin API for runtime kill-switch flags (ADR-010 / FE migration plan B37).

Flipping a flag here is live on every backend instance within one cache
window (15 s — services/runtime_flags._TTL_SECONDS) with NO redeploy. This is
the mutation kill switch the FE migration plan's pilot checklist requires.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Header
from fastapi import HTTPException
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.admin import require_admin
from services import runtime_flags

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


@router.put("/admin/runtime-flags/{key}")
async def put_flag(
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
