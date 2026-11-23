"""Recent learner sign-ins (COURSEACCESS-0055 T014 / G04-T16, plan 5.13b, FR-049).

``services.session_gate`` calls :func:`record` at six points, only while
runtime flag ``single_session_learners`` is on and only for learner roles.
``record`` never raises: a failed write is logged as
``[session] login_event_failed`` and the sign-in, claim or exam goes on.

Privacy (Q18): nothing here reads, stores or logs an IP address, a location
or the raw User-Agent. Only the derived ``device_kind`` / ``device_label``
and the sign-in method from the token's ``amr`` claim are kept.
``approx_location`` is always null.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from database import supabase_admin

logger = logging.getLogger(__name__)

TABLE = "learner_login_events"
OUTCOMES = frozenset({"signed_in", "pending", "claimed", "claim_refused_timed", "displaced", "signed_out_all"})
CURRENT_OUTCOMES = frozenset({"signed_in", "claimed"})
READ_WINDOW = 30
MAX_LIMIT = 10

_TABLET = re.compile(r"\biPad\b")
_ANDROID = re.compile(r"\bAndroid\b")
_MOBILE = re.compile(r"\bMobile\b")
_PHONE = re.compile(r"\bMobi|\biPhone\b")
_DESKTOP = re.compile(r"\bWindows NT\b|\bMacintosh\b|\bX11\b|\bCrOS\b")


def device_kind_from(user_agent: Optional[str]) -> str:
    """``tablet`` | ``phone`` | ``desktop`` | ``unknown`` (plan 5.13b)."""
    if not user_agent or not isinstance(user_agent, str):
        return "unknown"
    ua = user_agent[:512]
    if _TABLET.search(ua) or (_ANDROID.search(ua) and not _MOBILE.search(ua)):
        return "tablet"
    if _PHONE.search(ua):
        return "phone"
    if _DESKTOP.search(ua):
        return "desktop"
    return "unknown"


def method_from_amr(claims: dict) -> str:
    """``google`` when the token's ``amr`` has ``oauth`` (Google is the only
    OAuth provider), ``email_code`` when it has ``otp``, else ``unknown``.
    The real staging values still need checking (spec 5.13b CHƯA KIỂM)."""
    amr = (claims or {}).get("amr")
    methods = {entry.get("method") for entry in amr if isinstance(entry, dict)} if isinstance(amr, list) else set()
    if "oauth" in methods:
        return "google"
    if "otp" in methods:
        return "email_code"
    return "unknown"


def record(user_id: str, session_id: Optional[str], outcome: str, *,
           user_agent: Optional[str] = None, device_label: Optional[str] = None,
           device_kind: Optional[str] = None, method: Optional[str] = None) -> bool:
    """Write one event, once per (user, session, outcome). Never raises;
    returns whether the write went through."""
    try:
        if outcome not in OUTCOMES or not session_id:
            raise ValueError(f"bad login event {outcome!r}")
        if device_label is None and user_agent is not None:
            from services.session_gate import device_label_from  # local — session_gate imports this module
            device_label = device_label_from(user_agent)
        row = {
            "user_id": str(user_id), "session_id": str(session_id), "outcome": outcome,
            "device_kind": device_kind or device_kind_from(user_agent),
            "device_label": device_label,
            "method": method if method in ("google", "email_code") else "unknown",
        }
        (supabase_admin.table(TABLE)
         .upsert(row, on_conflict="user_id,session_id,outcome", ignore_duplicates=True, default_to_null=False)
         .execute())
    except Exception as exc:
        logger.warning("[session] login_event_failed outcome=%s user=%s: %r", outcome, user_id, exc)
        return False
    logger.info("[session] login_event outcome=%s", outcome)
    return True


def last_session_fields(user_id: str, session_id: str) -> dict:
    """``method`` and ``device_kind`` of the newest ``signed_in`` / ``claimed``
    event of a session, copied onto its ``displaced`` event (that device sends
    no request any more). ``unknown`` when there is none. Never raises."""
    fallback = {"method": "unknown", "device_kind": "unknown"}
    try:
        rows = (supabase_admin.table(TABLE).select("method, device_kind")
                .eq("user_id", str(user_id)).eq("session_id", str(session_id))
                .in_("outcome", sorted(CURRENT_OUTCOMES))
                .order("occurred_at", desc=True).limit(1).execute().data or [])
    except Exception as exc:
        logger.warning("[session] login_event_lookup_failed user=%s: %r", user_id, exc)
        return fallback
    if not rows:
        return fallback
    return {"method": rows[0].get("method") or "unknown", "device_kind": rows[0].get("device_kind") or "unknown"}


def recent(user_id: str, current_session_id: Optional[str], limit: int = 3) -> list[dict]:
    """The newest event of each session, newest first, at most ``limit``
    (1..10). Raises on a read error (the route answers 503)."""
    limit = max(1, min(int(limit), MAX_LIMIT))
    rows = (supabase_admin.table(TABLE)
            .select("session_id, occurred_at, device_kind, device_label, method, outcome")
            .eq("user_id", str(user_id)).order("occurred_at", desc=True).order("id", desc=True)
            .limit(READ_WINDOW).execute().data or [])
    items: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        session = str(row.get("session_id"))
        if session in seen:
            continue
        seen.add(session)
        items.append({
            "at": row.get("occurred_at"),
            "device_kind": row.get("device_kind") or "unknown",
            "device_label": row.get("device_label"),
            "method": row.get("method") or "unknown",
            "outcome": row.get("outcome"),
            "is_current": bool(current_session_id) and session == current_session_id
                          and row.get("outcome") in CURRENT_OUTCOMES,
            "approx_location": None,
        })
        if len(items) >= limit:
            break
    return items


def purge_expired(keep_days: int, *, db: Any = None, now: Optional[datetime] = None) -> int:
    """Delete events older than ``keep_days`` (FR-049). For the enrollment
    sweep (G04-T04, step 6). Raises on error; the sweep logs and goes on."""
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=int(keep_days))
    rows = ((db or supabase_admin).table(TABLE).delete()
            .lt("occurred_at", cutoff.isoformat()).execute().data or [])
    return len(rows)
