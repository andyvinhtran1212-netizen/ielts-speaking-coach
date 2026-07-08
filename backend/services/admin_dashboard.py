"""services/admin_dashboard.py — Sprint 18.2 (Direction B).

6-metric system/ops overview for the new admin Dashboard. Distinct from
`routers/admin_overview.py` (which aggregates *content*: students, skills,
errors). This computes operational health:

  1. total_users        — COUNT(users)
  2. active_codes        — COUNT(user_code_assignments WHERE is_active)
  3. distinct_visitors   — COUNT(DISTINCT user_id) over page_view events in a
                           rolling window (anonymous hits excluded — matches
                           GET /admin/analytics/foot-traffic, Sprint 17.4)
  4. total_practices     — COUNT(sessions WHERE status='completed')
  5. grading_minutes     — SUM(responses.duration_seconds) / 60 (cumulative)
  6. tokens_called       — SUM(input_tokens + output_tokens) over the selector
                           window (dashboard-tweaks; replaced the calendar-month
                           cost sum — ai_usage_logs already logs tokens per call)

Fixed query count (one round trip per metric — no N+1). Pattern #29: each
metric is wrapped so a single sub-query failure yields `None` for that metric
while the rest still return; the endpoint never 500s on a partial outage.

Calendar-month + window boundaries are UTC, consistent with the rest of the
codebase (`datetime.now(timezone.utc)` throughout admin_overview/foot-traffic).

Schema (all confirmed against migrations, no new migration this sprint):
  - users (id)                                              [mig 001]
  - user_code_assignments (id, is_active)                   [mig 009]
  - analytics_events (user_id, event_name, created_at)      [mig 018/080]
  - sessions (id, status)                                   [mig 003: status]
  - responses (duration_seconds FLOAT)                      [mig 010/011]
  - ai_usage_logs (input_tokens, output_tokens, created_at) [mig 031]
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from database import supabase_admin

logger = logging.getLogger(__name__)

# Allowed rolling windows for the distinct-visitors metric (UI selector).
ALLOWED_VISITOR_WINDOWS = (7, 30, 90)
DEFAULT_VISITOR_WINDOW = 30


def _metric(name: str, fn):
    """Run one metric closure, degrading to None on failure (Pattern #29)."""
    try:
        return fn()
    except Exception as exc:  # pragma: no cover - exercised via stub in tests
        logger.warning("[admin_dashboard] metric %s failed: %s", name, exc)
        return None


def _count(table: str, apply=None) -> int:
    """Head COUNT(exact) — returns the count without pulling rows."""
    q = supabase_admin.table(table).select("id", count="exact").limit(0)
    if apply is not None:
        q = apply(q)
    res = q.execute()
    return int(res.count or 0)


def compute_dashboard_overview(visitors_window_days: int = DEFAULT_VISITOR_WINDOW) -> dict:
    """Compute the 6-metric ops overview. One query per metric, graceful on
    per-metric failure. Returns plain JSON-able dict."""
    if visitors_window_days not in ALLOWED_VISITOR_WINDOWS:
        visitors_window_days = DEFAULT_VISITOR_WINDOW

    now = datetime.now(timezone.utc)
    visitors_since = (now - timedelta(days=visitors_window_days)).isoformat()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    def _users():
        return _count("users")

    def _codes():
        # "Mã đã kích hoạt" = codes that have been ACTIVATED (redeemed by a user),
        # matching the admin codes page's assigned count.
        #
        # BUG (dashboard-counter-audit): the old query counted active
        # user_code_assignments rows only (23). But reassign / remove-user /
        # revoke flip a code's assignment row to is_active=false, while
        # access_codes.is_used + used_by persist (immutable after activation —
        # auth.py sets both atomically on redeem). So ~21 genuinely-activated
        # codes had no active assignment row and were dropped → 23 vs 44.
        #
        # access_codes.is_used is the canonical "this code was activated" flag
        # (a proven superset of the admin page's `active-assignment OR
        # is_used+used_by` union), so counting it matches ground truth (incl. the
        # 1 activated-then-revoked code).
        return _count("access_codes", lambda q: q.eq("is_used", True))

    def _visitors():
        # "Người xem" = authenticated distinct users + anonymous page-view HITS
        # (viewers-anonymous). Anonymous page_views carry NO dedup id — the beacon
        # sends no session_id and there's no IP/device id — so anonymous can only
        # be counted as hits (visits), NOT distinct viewers. Authenticated stays
        # distinct (by user_id). The breakdown labels the two units honestly.
        #
        # Exact server-side counts (mig 139) — the in-app path below fetches
        # page_view rows and is silently capped at PostgREST's 1000-row default
        # once the window has >1000 hits. Falls back to it if the RPC is absent
        # (pre-apply), so deploy ordering is safe.
        try:
            data = supabase_admin.rpc(
                "fn_dashboard_visitors", {"p_since": visitors_since}
            ).execute().data
            row = (data[0] if isinstance(data, list) and data
                   else (data if isinstance(data, dict) else None))
            if row is not None:
                return {"authenticated": int(row.get("authenticated") or 0),
                        "anonymous":     int(row.get("anonymous") or 0)}
        except Exception as exc:
            logger.warning("[admin_dashboard] visitors rpc fallback: %s", exc)
        rows = (
            supabase_admin.table("analytics_events")
            .select("user_id")
            .eq("event_name", "page_view")
            .gte("created_at", visitors_since)
            .execute()
            .data
        ) or []
        auth = len({r["user_id"] for r in rows if r.get("user_id")})
        anon = sum(1 for r in rows if not r.get("user_id"))
        return {"authenticated": auth, "anonymous": anon}

    def _practices():
        return _count("sessions", lambda q: q.eq("status", "completed"))

    def _grading_minutes():
        # Perf (mig 089): SUM server-side via RPC so no rows cross the wire
        # (the old path fetched EVERY responses row — unbounded). Falls back
        # to the in-app sum if the function isn't applied yet (Lesson 11 —
        # deploy ordering safe).
        try:
            val = supabase_admin.rpc("fn_total_grading_minutes", {}).execute().data
            if isinstance(val, list):
                val = val[0] if val else None
            if val is not None:
                return round(float(val), 1)
        except Exception as exc:
            logger.warning("[admin_dashboard] grading_minutes rpc fallback: %s", exc)
        rows = (
            supabase_admin.table("responses").select("duration_seconds").execute().data
        ) or []
        total = sum((r.get("duration_seconds") or 0) for r in rows)
        return round(total / 60.0, 1)

    def _tokens_called():
        # dashboard-tweaks Item 2 — total AI tokens called across all agents
        # (prompt + completion), WINDOWED by the selector (was a calendar-month
        # cost sum). ai_usage_logs (mig 031) already logs tokens per call, so no
        # new logging is needed. Cache read/write tokens are a caching detail —
        # excluded from the headline "tokens called" figure.
        # Exact server-side SUM (mig 139) — the in-app path below is capped at
        # 1000 ai_usage_logs rows. Falls back to it if the RPC is absent.
        try:
            val = supabase_admin.rpc(
                "fn_dashboard_tokens_called", {"p_since": visitors_since}
            ).execute().data
            if isinstance(val, list):
                val = val[0] if val else 0
            if isinstance(val, dict):
                val = next(iter(val.values()), 0)
            if val is not None:
                return int(val)
        except Exception as exc:
            logger.warning("[admin_dashboard] tokens rpc fallback: %s", exc)
        rows = (
            supabase_admin.table("ai_usage_logs")
            .select("input_tokens, output_tokens")
            .gte("created_at", visitors_since)
            .execute()
            .data
        ) or []
        return sum((r.get("input_tokens") or 0) + (r.get("output_tokens") or 0) for r in rows)

    # viewers-anonymous: total = authenticated distinct + anonymous hits, with
    # the auth/anon split surfaced for the inline tile breakdown.
    _vis = _metric("distinct_visitors", _visitors)
    if _vis:
        _vis_total = _vis["authenticated"] + _vis["anonymous"]
        _vis_auth, _vis_anon = _vis["authenticated"], _vis["anonymous"]
    else:
        _vis_total = _vis_auth = _vis_anon = None

    return {
        "total_users": _metric("total_users", _users),
        "active_codes": _metric("active_codes", _codes),
        "distinct_visitors": {
            "count":         _vis_total,   # total viewers (auth distinct + anon hits)
            "authenticated": _vis_auth,
            "anonymous":     _vis_anon,
            "window_days":   visitors_window_days,
        },
        "total_practices": _metric("total_practices", _practices),
        "grading_minutes": _metric("grading_minutes", _grading_minutes),
        # Windowed by the selector (dashboard-tweaks): replaced the old cost tile.
        "tokens_called": {
            "count": _metric("tokens_called", _tokens_called),
            "window_days": visitors_window_days,
        },
        # admin-dashboard-redesign — actionable "Cần chú ý" strip. Cheap
        # COUNT(exact) queries (no row transfer); reuses data the ops admin
        # cares about without duplicating Overview's pedagogical activity feed.
        "attention": {
            "errors_undismissed": _metric(
                "errors_undismissed",
                lambda: _count("error_logs", lambda q: q.is_("dismissed_at", "null")),
            ),
            "writing_pending": _metric(
                "writing_pending",
                lambda: _count(
                    "writing_essays",
                    lambda q: q.is_("delivered_at", "null").is_("deleted_at", "null"),
                ),
            ),
        },
        "computed_at": now.isoformat(),
    }


def compute_dashboard_trends(days: int = DEFAULT_VISITOR_WINDOW) -> dict:
    """Daily ops trend series for the Dashboard sparklines + trends chart
    (admin-dashboard-redesign).

    Three series over the last `days` (7/30/90): distinct visitors, completed
    practices, and AI tokens called. Every fetch is WINDOWED (`gte created_at/completed_at`)
    so the row set is bounded by the range — no unbounded scan, no migration
    (buckets by UTC date in Python). Gap days are filled with 0 so the series is
    contiguous (sparkline-safe). Pattern #29: a per-series failure degrades to a
    zero-filled series, never a 500.
    """
    if days not in ALLOWED_VISITOR_WINDOWS:
        days = DEFAULT_VISITOR_WINDOW

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days - 1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    since_iso = start.isoformat()
    axis = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]

    def _day(ts: str | None) -> str:
        return (ts or "")[:10]

    def _rpc_daily(fn_name: str) -> list[dict]:
        """Call a daily-bucket RPC (mig 139) → axis-filled [{date, value}].
        Raises if the RPC is absent so the caller falls back to the in-app
        aggregation (which is capped at PostgREST's 1000-row default)."""
        data = supabase_admin.rpc(fn_name, {"p_since": since_iso}).execute().data
        by_day = {_day(r.get("day")): int(r.get("value") or 0) for r in (data or [])}
        return [{"date": d, "value": by_day.get(d, 0)} for d in axis]

    def _visitors_series():
        try:
            return _rpc_daily("fn_dashboard_daily_visitors")
        except Exception as exc:
            logger.warning("[admin_dashboard] daily visitors rpc fallback: %s", exc)
        # Fallback — daily total viewers = authenticated distinct + anonymous hits,
        # matching the tile (viewers-anonymous). Capped at 1000 rows.
        auth: dict[str, set] = {d: set() for d in axis}
        anon: dict[str, int] = {d: 0 for d in axis}
        rows = (
            supabase_admin.table("analytics_events")
            .select("user_id, created_at")
            .eq("event_name", "page_view")
            .gte("created_at", since_iso)
            .execute()
            .data
        ) or []
        for r in rows:
            d = _day(r.get("created_at"))
            if d not in auth:
                continue
            if r.get("user_id"):
                auth[d].add(r["user_id"])
            else:
                anon[d] += 1
        return [{"date": d, "value": len(auth[d]) + anon[d]} for d in axis]

    def _practices_series():
        try:
            return _rpc_daily("fn_dashboard_daily_practices")
        except Exception as exc:
            logger.warning("[admin_dashboard] daily practices rpc fallback: %s", exc)
        buckets: dict[str, int] = {d: 0 for d in axis}
        rows = (
            supabase_admin.table("sessions")
            .select("completed_at")
            .eq("status", "completed")
            .gte("completed_at", since_iso)
            .execute()
            .data
        ) or []
        for r in rows:
            d = _day(r.get("completed_at"))
            if d in buckets:
                buckets[d] += 1
        return [{"date": d, "value": buckets[d]} for d in axis]

    def _tokens_series():
        # dashboard-tweaks — daily AI tokens called (prompt + completion),
        # replacing the cost series so the dashboard speaks tokens throughout.
        try:
            return _rpc_daily("fn_dashboard_daily_tokens")
        except Exception as exc:
            logger.warning("[admin_dashboard] daily tokens rpc fallback: %s", exc)
        buckets: dict[str, int] = {d: 0 for d in axis}
        rows = (
            supabase_admin.table("ai_usage_logs")
            .select("input_tokens, output_tokens, created_at")
            .gte("created_at", since_iso)
            .execute()
            .data
        ) or []
        for r in rows:
            d = _day(r.get("created_at"))
            if d in buckets:
                buckets[d] += (r.get("input_tokens") or 0) + (r.get("output_tokens") or 0)
        return [{"date": d, "value": buckets[d]} for d in axis]

    def _zero_series():
        return [{"date": d, "value": 0} for d in axis]

    def _safe_series(name, fn):
        try:
            return fn()
        except Exception as exc:  # pragma: no cover - exercised via stub in tests
            logger.warning("[admin_dashboard] trend series %s failed: %s", name, exc)
            return _zero_series()

    return {
        "days": days,
        "series": {
            "visitors":  _safe_series("visitors", _visitors_series),
            "practices": _safe_series("practices", _practices_series),
            "tokens":    _safe_series("tokens", _tokens_series),
        },
        "computed_at": now.isoformat(),
    }
