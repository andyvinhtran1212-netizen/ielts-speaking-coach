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
  6. monthly_cost_usd    — SUM(ai_usage_logs.cost_usd_est) this CALENDAR month

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
  - ai_usage_logs (cost_usd_est real, created_at)           [ai_usage_logs]
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
        return _count("user_code_assignments", lambda q: q.eq("is_active", True))

    def _visitors():
        rows = (
            supabase_admin.table("analytics_events")
            .select("user_id")
            .eq("event_name", "page_view")
            .gte("created_at", visitors_since)
            .execute()
            .data
        ) or []
        # Anonymous hits (NULL user_id) excluded — authenticated viewers only.
        return len({r["user_id"] for r in rows if r.get("user_id")})

    def _practices():
        return _count("sessions", lambda q: q.eq("status", "completed"))

    def _grading_minutes():
        rows = (
            supabase_admin.table("responses").select("duration_seconds").execute().data
        ) or []
        total = sum((r.get("duration_seconds") or 0) for r in rows)
        return round(total / 60.0, 1)

    def _monthly_cost():
        rows = (
            supabase_admin.table("ai_usage_logs")
            .select("cost_usd_est")
            .gte("created_at", month_start)
            .execute()
            .data
        ) or []
        return round(sum((r.get("cost_usd_est") or 0) for r in rows), 4)

    return {
        "total_users": _metric("total_users", _users),
        "active_codes": _metric("active_codes", _codes),
        "distinct_visitors": {
            "count": _metric("distinct_visitors", _visitors),
            "window_days": visitors_window_days,
        },
        "total_practices": _metric("total_practices", _practices),
        "grading_minutes": _metric("grading_minutes", _grading_minutes),
        "monthly_cost_usd": _metric("monthly_cost_usd", _monthly_cost),
        "computed_at": now.isoformat(),
    }
