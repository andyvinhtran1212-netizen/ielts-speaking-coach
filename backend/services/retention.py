"""
services/retention.py — Sprint 16.2.1 read-time retention policy (model v2).

Lazy, pure expiry computation for the storage-lifecycle feature. This sprint does
NO deletion and runs NO scheduled job — Sprint 16.4 owns the persistent sweep that
WRITES audio_purged_at/content_purged_at and scrubs audio + content. Until then
this module is the sole authority (Pattern #29 graceful degradation: the view
stays correct even if a future sweep lags or fails).

Retention model v2 (Andy 2026-05-25 pivot — decoupled audio vs content):
  - AUDIO retained 15 days   → recording deleted after 15d (storage cost driver)
  - CONTENT retained 60 days → feedback/transcript/scores-detail kept 60d, then
    scrubbed; the session also drops out of the history list at content purge.
  (v1 was a single 7d soft-hide → 30d purge — superseded by this decouple.)

  - clock anchor = the session's MOST RECENT activity:
        max(started_at, last_accessed_at)
    Opening a session keeps it within the window (the approved both-timer model
    from Sprint 16.0). Note: this also re-extends the audio clock on access; if a
    stricter recording-age audio policy is wanted, anchor audio on started_at only.

Note: the sessions table has no `created_at` column — `started_at` is the
session-age timestamp used throughout the codebase.
"""

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from config import settings

logger = logging.getLogger(__name__)

# COURSEACCESS-0055 FR-029 (plan 5.14): one audio value for every learner,
# read from configuration and never above 60 days. The code default stays 15.
RETENTION_AUDIO_DAYS_CEILING = 60


def audio_days_from(value) -> int:
    """``value`` clamped to 1..RETENTION_AUDIO_DAYS_CEILING; above the ceiling
    is clamped with one warning (never kept longer, for anyone)."""
    days = int(value)
    if days > RETENTION_AUDIO_DAYS_CEILING:
        logger.warning("[retention] RETENTION_AUDIO_DAYS=%d is above the %d-day ceiling; using %d",
                       days, RETENTION_AUDIO_DAYS_CEILING, RETENTION_AUDIO_DAYS_CEILING)
        return RETENTION_AUDIO_DAYS_CEILING
    return max(1, days)


# Computed once at import (other modules import the name); tests change it
# with monkeypatch on this module and on jobs.retention_sweep.
RETENTION_AUDIO_DAYS = audio_days_from(settings.RETENTION_AUDIO_DAYS)
RETENTION_CONTENT_DAYS = 60
_TOUCH_THROTTLE_MINUTES = 60


@dataclass(frozen=True)
class ContentWindow:
    """How long one learner's content stays visible (plan 5.14).

    ``default``: today's rule, RETENTION_CONTENT_DAYS by session age.
    ``open``: a live course right now, no cut-off.
    ``until``: no live course; visible until ``visible_until``.
    """
    mode: str
    visible_until: Optional[datetime] = None


DEFAULT_WINDOW = ContentWindow("default")
OPEN_WINDOW = ContentWindow("open")


@dataclass(frozen=True)
class RetentionPolicy:
    """Per-call retention values. ``None`` reads the module constant at call
    time, so a call without a policy is exactly the previous behaviour.
    ``window`` changes the content side only; audio never depends on it."""
    audio_days: Optional[int] = None
    content_days: Optional[int] = None
    window: Optional[ContentWindow] = None


DEFAULT_POLICY = RetentionPolicy()


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


def content_purge_cutoff(now=None, content_days=None) -> str:
    """ISO-Z timestamp; sessions whose anchor is < cutoff are content-purged
    (and therefore hidden from the history list).

    Returned with a trailing 'Z' (no '+00:00') so it embeds cleanly in PostgREST
    `or=` filter strings without '+' URL-encoding ambiguity.
    """
    now = now or datetime.now(timezone.utc)
    days = RETENTION_CONTENT_DAYS if content_days is None else content_days
    return (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _days_until(moment: datetime, now: datetime) -> int:
    return max(0, math.ceil((moment - now).total_seconds() / 86400))


def compute_expiry(session: dict, now=None, policy: RetentionPolicy = DEFAULT_POLICY) -> dict:
    """Pure read-time expiry fields for a session row (model v2, decoupled anchors).

    Sprint 16.4.1 (Andy D1): the AUDIO clock is strict recording-age — anchored on
    `started_at` ONLY. Opening a session does not create new audio, so it must not
    extend the 15-day audio window (tightens the storage-cost goal). The CONTENT
    clock stays activity-extended — `max(started_at, last_accessed_at)` — so
    engagement keeps feedback/scores around the full 60 days.

    A persisted audio_purged_at/content_purged_at (written by the Sprint 16.4
    sweep) is authoritative when present. A session with no usable timestamp is
    treated as NOT purged — we never purge data we cannot date (safe default).

    `is_hidden` == `is_content_purged`: the session leaves the history list only
    once its content is gone (audio purge alone keeps the session visible).
    """
    now = now or datetime.now(timezone.utc)
    audio_days = RETENTION_AUDIO_DAYS if policy.audio_days is None else policy.audio_days
    content_days = RETENTION_CONTENT_DAYS if policy.content_days is None else policy.content_days
    persisted_audio = bool(session.get("audio_purged_at"))
    persisted_content = bool(session.get("content_purged_at"))

    started = _parse_ts(session.get("started_at"))
    last = _parse_ts(session.get("last_accessed_at"))

    # Audio: strict started_at. Content: most-recent activity.
    audio_anchor = started
    content_candidates = [t for t in (started, last) if t is not None]
    content_anchor = max(content_candidates) if content_candidates else None

    audio_age = (now - audio_anchor).days if audio_anchor else None
    content_age = (now - content_anchor).days if content_anchor else None

    window = policy.window or DEFAULT_WINDOW
    if window.mode == "open":
        # A live course: no content cut-off (FR-048). Already scrubbed stays scrubbed.
        days_content, content_gone = None, persisted_content
    elif window.mode == "until" and window.visible_until is not None:
        # Last course ended: the window replaces the session-age rule.
        days_content = _days_until(window.visible_until, now)
        content_gone = persisted_content or now >= window.visible_until
    else:
        days_content = None if content_age is None else max(0, content_days - content_age)
        content_gone = persisted_content or (content_age is not None and content_age >= content_days)

    return {
        "days_until_audio_purge":   None if audio_age is None else max(0, audio_days - audio_age),
        "days_until_content_purge": days_content,
        "is_audio_purged":   persisted_audio or (audio_age is not None and audio_age >= audio_days),
        "is_content_purged": content_gone,
        "is_hidden":         content_gone,
    }


def is_hidden(session: dict, now=None, policy: RetentionPolicy = DEFAULT_POLICY) -> bool:
    return compute_expiry(session, now, policy)["is_hidden"]


def should_touch(last_accessed, now=None) -> bool:
    """True when last_accessed_at should be refreshed: NULL or older than the
    throttle window. Keeps the per-read write amplification bounded (one write
    per session per hour at most)."""
    now = now or datetime.now(timezone.utc)
    prev = _parse_ts(last_accessed)
    if prev is None:
        return True
    return (now - prev) >= timedelta(minutes=_TOUCH_THROTTLE_MINUTES)
