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

from fastapi import APIRouter
from pydantic import BaseModel

from database import supabase_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class AnalyticsEventPayload(BaseModel):
    event_name: str
    event_data: dict = {}
    session_id: str | None = None


@router.post("/events")
async def record_event(payload: AnalyticsEventPayload):
    """Record a named analytics event. Returns {ok: true} regardless of DB outcome."""
    try:
        supabase_admin.table("analytics_events").insert({
            "id":         str(uuid.uuid4()),
            "event_name": payload.event_name,
            "event_data": payload.event_data,
            "session_id": payload.session_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as exc:
        logger.warning("[analytics] failed to record event %s: %s", payload.event_name, exc)
    return {"ok": True}
