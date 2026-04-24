"""
services/analytics.py — Internal analytics event writes.

Uses the service-role Supabase client intentionally:
  - Analytics events are system-level audit records, not user content rows.
  - Writing with the service role avoids failure when a user's session expires
    between the request and the background fire.
  - The service-role key is never returned in any response; it stays in this layer.
"""

import logging

from database import supabase_admin

logger = logging.getLogger(__name__)


def fire_event(event_name: str, event_data: dict, user_id: str) -> None:
    """Insert an analytics event record. Non-fatal — logs and swallows on error."""
    try:
        supabase_admin.table("analytics_events").insert({
            "event_name": event_name,
            "event_data": event_data,
            "user_id": user_id,
        }).execute()
    except Exception as e:
        logger.debug("[analytics] event '%s' failed (non-fatal): %s", event_name, e)
