"""
services/dashboard_aggregator.py — Dashboard aggregate-payload builder.

Powers GET /api/dashboard/init.  Replaces three of the six fetches that the
dashboard makes on cold load:

    /sessions/stats?limit=20           → "summary" + "sessions"
    /api/vocabulary/bank/recent-updates → "recent_updates"
    /api/flashcards/due/count          → "flashcard_due_count"

Stays separate (not aggregated):

    /auth/me                       — provisions the user row + computes
                                     feature flags + updates last_seen_at
                                     (side effects belong to a dedicated
                                     endpoint).
    /sessions?limit=200            — the history list paginates and filters.
    /api/grammar/dashboard-data    — different concern, separate router.

Design rules:

    1. JWT-scoped only.  Caller passes a Supabase client built from the
       user's bearer token; RLS is the security layer.  We do NOT use
       supabase_admin in this module — that would replicate the HIGH-1
       legacy pattern we're trying to decouple from.

    2. Self-contained queries.  Logic is duplicated from the existing
       handlers (which use supabase_admin in the case of /sessions/stats)
       rather than refactoring them, so this module is fully independent
       of the HIGH-1 sprint timeline.

    3. Partial response.  Each sub-query is wrapped in its own try/except;
       a failure in one (e.g. flashcard_due_count timeout) does not blank
       the whole dashboard.  Failed sub-queries land their key in a
       `_errors` map; the frontend can render the rest and log the gap.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional


# ── Public ───────────────────────────────────────────────────────────────────


def get_dashboard_payload(sb, user_id: str, *, chart_limit: int = 20,
                          recent_updates_limit: int = 5) -> Dict[str, Any]:
    """
    Build the aggregate payload for the dashboard's first paint.

    Args:
        sb: a Supabase client bound to the caller's JWT (see _user_sb in
            routers/dashboard.py).  Service-role clients MUST NOT be passed.
        user_id: the authenticated user's UUID.  Used as a defense-in-depth
            ``eq("user_id", ...)`` filter on top of RLS — also keeps the
            queries on the existing (user_id, ...) composite indexes.

    Returns:
        Dict with the keys the dashboard renders (`summary`, `sessions`,
        `recent_updates`, `flashcard_due_count`).  If any sub-query fails
        the corresponding key holds None and an `_errors` map is added so
        the frontend can log which sections degraded.
    """
    payload: Dict[str, Any] = {
        "summary": None,
        "sessions": None,
        "recent_updates": None,
        "flashcard_due_count": None,
    }
    errors: Dict[str, str] = {}

    try:
        stats = _build_sessions_stats(sb, user_id, chart_limit=chart_limit)
        payload["summary"] = stats["summary"]
        payload["sessions"] = stats["sessions"]
    except Exception as e:
        errors["stats"] = _short_error(e)

    try:
        payload["recent_updates"] = _build_recent_vocab_updates(
            sb, user_id, limit=recent_updates_limit
        )
    except Exception as e:
        errors["recent_updates"] = _short_error(e)

    try:
        payload["flashcard_due_count"] = _build_flashcard_due_count(sb, user_id)
    except Exception as e:
        errors["flashcard_due_count"] = _short_error(e)

    if errors:
        payload["_errors"] = errors

    return payload


async def get_dashboard_payload_concurrent(
    make_sb: Callable[[], Any],
    user_id: str,
    *,
    chart_limit: int = 20,
    recent_updates_limit: int = 5,
) -> Dict[str, Any]:
    """Concurrent variant of :func:`get_dashboard_payload` for the hot
    ``/api/dashboard/init`` path.

    The three sections are independent, so running them in parallel turns the
    wall-time from *sum*-of-sections into *max*-of-sections — the win that
    matters while every query is a ~56ms cross-region hop (Railway SG ↔ Supabase
    ap-south-1). Measured ~731ms sequential → ~max(section) concurrently.

    Thread-safety: each section runs in its OWN thread with its OWN client built
    by ``make_sb()``. The sync supabase/httpx client + query builder are NOT
    thread-safe to share across threads, so two concurrent sections must never
    touch the same client (mirrors the db_async.py note on why the shared sync
    singleton is never handed to ``to_thread``). Error isolation matches the
    sequential builder: a section that raises lands its key in ``_errors`` and
    the rest of the dashboard still renders.
    """
    def _stats():
        return _build_sessions_stats(make_sb(), user_id, chart_limit=chart_limit)

    def _recent():
        return _build_recent_vocab_updates(make_sb(), user_id, limit=recent_updates_limit)

    def _flash():
        return _build_flashcard_due_count(make_sb(), user_id)

    stats_r, recent_r, flash_r = await asyncio.gather(
        asyncio.to_thread(_stats),
        asyncio.to_thread(_recent),
        asyncio.to_thread(_flash),
        return_exceptions=True,
    )

    payload: Dict[str, Any] = {
        "summary": None,
        "sessions": None,
        "recent_updates": None,
        "flashcard_due_count": None,
    }
    errors: Dict[str, str] = {}

    if isinstance(stats_r, Exception):
        errors["stats"] = _short_error(stats_r)
    else:
        payload["summary"] = stats_r["summary"]
        payload["sessions"] = stats_r["sessions"]

    if isinstance(recent_r, Exception):
        errors["recent_updates"] = _short_error(recent_r)
    else:
        payload["recent_updates"] = recent_r

    if isinstance(flash_r, Exception):
        errors["flashcard_due_count"] = _short_error(flash_r)
    else:
        payload["flashcard_due_count"] = flash_r

    if errors:
        payload["_errors"] = errors

    return payload


# ── Sub-builders ─────────────────────────────────────────────────────────────


# Mirrors GET /sessions/stats (routers/sessions.py:417-512) but JWT-scoped via
# the caller-provided client.  Kept self-contained; the legacy endpoint stays
# on supabase_admin until HIGH-1 sprint migrates it.
def _build_sessions_stats(sb, user_id: str, *, chart_limit: int) -> Dict[str, Any]:
    # Last N completed sessions — chart data + last-topic source.
    s_res = (
        sb.table("sessions")
        .select(
            "id, started_at, mode, part, topic, "
            "band_fc, band_lr, band_gra, band_p, overall_band, status"
        )
        .eq("user_id", user_id)
        .eq("status", "completed")
        .order("started_at", desc=True)
        .limit(chart_limit)
        .execute()
    )
    sessions: List[Dict[str, Any]] = s_res.data or []

    # Total sessions (any status).
    try:
        total_res = (
            sb.table("sessions")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .execute()
        )
        total_sessions = (
            total_res.count
            if total_res.count is not None
            else len(total_res.data or [])
        )
    except Exception:
        total_sessions = 0

    # 30-day average overall band, completed sessions only.
    avg_band_30d: Optional[float] = None
    try:
        thirty_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        band_res = (
            sb.table("sessions")
            .select("overall_band")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .gte("started_at", thirty_ago)
            .execute()
        )
        bands = [
            r["overall_band"]
            for r in (band_res.data or [])
            if r.get("overall_band") is not None
        ]
        if bands:
            avg_band_30d = round(sum(bands) / len(bands), 1)
    except Exception:
        pass

    # Streak: walk back from today through the date set of any-status sessions.
    current_streak = 0
    try:
        streak_res = (
            sb.table("sessions")
            .select("started_at")
            .eq("user_id", user_id)
            .order("started_at", desc=True)
            .limit(365)
            .execute()
        )
        day_set = {
            r["started_at"][:10]
            for r in (streak_res.data or [])
            if r.get("started_at")
        }
        # UTC, not date.today(): day_set keys are UTC date strings
        # (started_at[:10]), so the cursor must be UTC too — local date.today()
        # broke the streak for ~7h/day in UTC+ timezones (UTC+7 users saw
        # streak=0 between local midnight and 07:00). Mirrors the same fix in
        # student_home_aggregator._build_streak.
        cursor = datetime.now(timezone.utc).date()
        while cursor.isoformat() in day_set:
            current_streak += 1
            cursor -= timedelta(days=1)
    except Exception:
        pass

    last_session = sessions[0] if sessions else None
    summary = {
        "total_sessions":  total_sessions,
        "avg_band_30d":    avg_band_30d,
        "current_streak":  current_streak,
        "last_topic":      last_session.get("topic") if last_session else None,
        "last_part":       last_session.get("part") if last_session else None,
        "last_mode":       last_session.get("mode") if last_session else None,
        "last_session_at": last_session.get("started_at") if last_session else None,
    }

    return {"summary": summary, "sessions": sessions}


# Mirrors GET /api/vocabulary/bank/recent-updates
# (routers/vocabulary_bank.py:191-237).  That endpoint already uses _user_sb,
# so the query here is identical — duplicated locally rather than imported to
# keep the aggregator self-contained.
def _build_recent_vocab_updates(sb, user_id: str, *, limit: int) -> List[Dict[str, Any]]:
    fetch_n = max(limit * 5, 50)
    res = (
        sb.table("user_vocabulary")
        .select("id, headword, source_type, session_id, created_at")
        .eq("user_id", user_id)
        .eq("is_archived", False)
        .eq("is_skipped", False)
        .eq("is_pending", False)  # Sprint 10.4
        .order("created_at", desc=True)
        .limit(fetch_n)
        .execute()
    )
    rows = res.data or []

    groups: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        key = row.get("session_id") or "__manual__"
        groups.setdefault(key, []).append(row)

    events: List[Dict[str, Any]] = []
    for key, group in groups.items():
        events.append({
            "type": "extraction",
            "session_id": None if key == "__manual__" else key,
            "vocab_count": len(group),
            "vocab_preview": [
                v.get("headword") for v in group[:3] if v.get("headword")
            ],
            "timestamp": max(
                v.get("created_at") for v in group if v.get("created_at")
            ),
        })

    events.sort(key=lambda e: e["timestamp"] or "", reverse=True)
    return events[:limit]


# Mirrors GET /api/flashcards/due/count
# (routers/flashcards.py:1074-1095).  Already _user_sb-based; duplicated here
# for the same self-containment reason.
def _build_flashcard_due_count(sb, user_id: str) -> int:
    now_iso = datetime.now(timezone.utc).isoformat()
    res = (
        sb.table("flashcard_reviews")
        .select("id", count="exact")
        .lte("next_review_at", now_iso)
        .limit(1)
        .execute()
    )
    return int(res.count or 0)


# ── Util ─────────────────────────────────────────────────────────────────────


def _short_error(e: Exception) -> str:
    """Truncate exception messages so they're safe to inline in JSON responses
    (no full stack traces, no PII leak through long error strings)."""
    msg = str(e) or e.__class__.__name__
    return msg[:200]
