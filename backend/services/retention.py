"""
services/retention.py — Sprint 16.2 read-time soft-hide policy.

Lazy, pure expiry computation for the storage-lifecycle feature. This sprint does
NO deletion and runs NO scheduled job — Sprint 16.4 owns the persistent sweep that
WRITES hidden_at/purged_at and scrubs audio. Until then this module is the sole
authority (Pattern #29 graceful degradation: the view stays correct even if a
future sweep lags or fails).

Retention model (Andy 2026-05-25 defaults):
  - soft-hide at 7 days → hard-delete at 30 days (23-day recovery buffer)
  - clock anchor = the session's MOST RECENT activity:
        max(started_at, last_accessed_at)
    A session opened within the window stays visible even if first practiced
    earlier — matches "keep the last 7 days of activity" and the commission's own
    sentinel ("created 10d ago, accessed 1d ago → NOT hidden").

Note: the sessions table has no `created_at` column — `started_at` is the
session-age timestamp used throughout the codebase.
"""

from datetime import datetime, timedelta, timezone

RETENTION_HIDE_DAYS = 7
RETENTION_PURGE_DAYS = 30
_TOUCH_THROTTLE_MINUTES = 60


def _parse_ts(value):
    """Parse an ISO timestamp / datetime to an aware UTC datetime, or None."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _anchor(session: dict):
    """Most-recent activity timestamp: max(started_at, last_accessed_at)."""
    candidates = [
        t for t in (_parse_ts(session.get("started_at")),
                    _parse_ts(session.get("last_accessed_at")))
        if t is not None
    ]
    return max(candidates) if candidates else None


def hide_cutoff(now=None) -> str:
    """ISO-Z timestamp; sessions whose anchor is < cutoff are soft-hidden.

    Returned with a trailing 'Z' (no '+00:00') so it embeds cleanly in PostgREST
    `or=` filter strings without '+' URL-encoding ambiguity.
    """
    now = now or datetime.now(timezone.utc)
    return (now - timedelta(days=RETENTION_HIDE_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")


def compute_expiry(session: dict, now=None) -> dict:
    """Pure read-time expiry fields for a session row.

    A persisted hidden_at/purged_at (written by the Sprint 16.4 sweep) is
    authoritative when present; otherwise the value is computed from the activity
    anchor. A session with no usable timestamp is treated as NOT hidden — we never
    hide data we cannot date (safe default).
    """
    now = now or datetime.now(timezone.utc)
    persisted_hidden = bool(session.get("hidden_at"))
    persisted_purged = bool(session.get("purged_at"))
    anchor = _anchor(session)
    if anchor is None:
        return {
            "days_until_hide": None, "days_until_purge": None,
            "is_hidden": persisted_hidden, "is_purged": persisted_purged,
        }
    age_days = (now - anchor).days
    return {
        "days_until_hide":  max(0, RETENTION_HIDE_DAYS - age_days),
        "days_until_purge": max(0, RETENTION_PURGE_DAYS - age_days),
        "is_hidden":  persisted_hidden or age_days >= RETENTION_HIDE_DAYS,
        "is_purged":  persisted_purged or age_days >= RETENTION_PURGE_DAYS,
    }


def is_hidden(session: dict, now=None) -> bool:
    return compute_expiry(session, now)["is_hidden"]


def should_touch(last_accessed, now=None) -> bool:
    """True when last_accessed_at should be refreshed: NULL or older than the
    throttle window. Keeps the per-read write amplification bounded (one write
    per session per hour at most)."""
    now = now or datetime.now(timezone.utc)
    prev = _parse_ts(last_accessed)
    if prev is None:
        return True
    return (now - prev) >= timedelta(minutes=_TOUCH_THROTTLE_MINUTES)
