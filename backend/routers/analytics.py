"""
routers/analytics.py — Analytics event ingestion

Decoupled from content APIs so tracking failures never block content rendering.

Endpoints
---------
POST /api/analytics/events   → record a named event with optional payload
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Header
from pydantic import BaseModel

from database import supabase_admin
from routers.auth import get_supabase_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class AnalyticsEventPayload(BaseModel):
    event_name: str
    event_data: dict = {}
    session_id: str | None = None


async def _attribute_user(authorization: str | None) -> str | None:
    """Sprint 17.4 — best-effort user attribution for foot-traffic. Returns the
    user id when a valid Bearer token is present, else None (anonymous). NEVER
    raises: tracking must never fail on auth (the page already rendered)."""
    if not authorization:
        return None
    try:
        user = await get_supabase_user(authorization)
        return user.get("id") if isinstance(user, dict) else None
    except Exception:
        return None


@router.post("/events")
async def record_event(
    payload: AnalyticsEventPayload,
    authorization: str | None = Header(default=None),
):
    """Record a named analytics event. Returns {ok: true} regardless of DB outcome.
    Sprint 17.4: attributes user_id from the (optional) Bearer token; anonymous
    visitors record user_id=NULL."""
    user_id = await _attribute_user(authorization)
    try:
        supabase_admin.table("analytics_events").insert({
            "id":         str(uuid.uuid4()),
            "event_name": payload.event_name,
            "event_data": payload.event_data,
            "session_id": payload.session_id,
            "user_id":    user_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as exc:
        logger.warning("[analytics] failed to record event %s: %s", payload.event_name, exc)
    return {"ok": True}
