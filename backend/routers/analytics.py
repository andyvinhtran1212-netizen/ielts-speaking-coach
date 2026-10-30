"""
routers/analytics.py — Analytics event ingestion

Decoupled from content APIs so tracking failures never block content rendering.

Endpoints
---------
POST /api/analytics/events   → record a named event with optional payload
"""

import asyncio
import json
import logging
import math
import threading
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Header
from pydantic import BaseModel, ConfigDict, Field, field_validator

from database import thread_supabase_admin
from routers.auth import get_supabase_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

# Incident 2026-10-30: the insert used to run the sync client ON the event loop,
# so every page_view beacon froze the whole (single-process) backend for one
# Supabase round-trip. It now runs in a worker thread on that thread's own
# service-role client (PC-J05 D1b pattern; the shared sync singleton is never
# handed to a thread). Each in-flight insert holds a default-executor worker for
# up to the sync client's timeout when Supabase hangs, so at most this many run
# at once and an event over the cap is dropped (best-effort telemetry) instead
# of queueing behind the executor the other to_thread sections share.
_MAX_IN_FLIGHT_INSERTS = 8
_insert_slots = threading.BoundedSemaphore(_MAX_IN_FLIGHT_INSERTS)
# Shielded insert tasks outlive a cancelled request; hold a strong reference
# until they finish so they are not garbage-collected mid-flight.
_pending_inserts: set[asyncio.Task] = set()


class AnalyticsEventPayload(BaseModel):
    """Small, non-sensitive telemetry envelope.

    This endpoint is intentionally anonymous, so validation is the primary
    protection before the service-role insert.  Keep the envelope bounded and
    reject unknown top-level fields instead of accepting arbitrary JSON.
    """

    model_config = ConfigDict(extra="forbid")

    event_name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_.:-]+$")
    event_data: dict = Field(default_factory=dict)
    session_id: str | None = Field(default=None, max_length=128)

    @field_validator("event_data")
    @classmethod
    def bounded_event_data(cls, value: dict) -> dict:
        nodes = 0

        def visit(item, depth=0):
            nonlocal nodes
            nodes += 1
            if depth > 5 or nodes > 128:
                raise ValueError("event_data exceeds structural limits")
            if isinstance(item, dict):
                clean = {}
                for key, child in item.items():
                    key = str(key)
                    if len(key) > 64:
                        raise ValueError("event_data key is too long")
                    clean[key] = visit(child, depth + 1)
                return clean
            if isinstance(item, list):
                return [visit(child, depth + 1) for child in item]
            if isinstance(item, str) and len(item) > 1024:
                raise ValueError("event_data string is too long")
            if isinstance(item, float) and not math.isfinite(item):
                raise ValueError("event_data number must be finite")
            if not isinstance(item, (str, int, float, bool, type(None))):
                raise ValueError("event_data contains an unsupported value")
            return item

        clean = visit(value)
        try:
            encoded_size = len(json.dumps(clean, ensure_ascii=False).encode("utf-8"))
        except (TypeError, UnicodeError) as exc:
            raise ValueError("event_data must be valid JSON") from exc
        if encoded_size > 8192:
            raise ValueError("event_data exceeds 8 KB")
        return clean


def _insert_event(row: dict) -> None:
    """Worker-thread body."""
    try:
        thread_supabase_admin().table("analytics_events").insert(row).execute()
    except Exception as exc:
        logger.warning("[analytics] failed to record event %s: %s", row["event_name"], exc)


def _insert_done(task: asyncio.Task) -> None:
    """The only place a slot is given back: runs exactly once, when the insert
    task really ends (ran, failed, could not be scheduled, or was cancelled)."""
    _pending_inserts.discard(task)
    _insert_slots.release()
    if not task.cancelled() and task.exception() is not None:
        # to_thread could not schedule (executor shut down): the worker never ran.
        logger.warning("[analytics] failed to record event: %s", task.exception())


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
    row = {
        "id":         str(uuid.uuid4()),
        "event_name": payload.event_name,
        "event_data": payload.event_data,
        "session_id": payload.session_id,
        "user_id":    user_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if not _insert_slots.acquire(blocking=False):
        logger.warning("[analytics] dropped event %s: %d inserts already in flight",
                       payload.event_name, _MAX_IN_FLIGHT_INSERTS)
        return {"ok": True}
    # Shielded: a request cancelled while its insert is still queued for a
    # worker must not cancel the insert, or the slot would never come back.
    task = asyncio.ensure_future(asyncio.to_thread(_insert_event, row))
    _pending_inserts.add(task)
    task.add_done_callback(_insert_done)
    try:
        await asyncio.shield(task)
    except RuntimeError:
        pass  # logged and released by _insert_done
    return {"ok": True}
