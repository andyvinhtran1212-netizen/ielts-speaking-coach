"""routers/error_logs.py — Sprint 12.3 (DEBT-ADMIN-IA-REFACTOR 3/8).

Custom error-log capture surface. Three jobs:

  1. POST /api/error-logs — receive frontend exception reports
     (window.onerror, unhandledrejection, manual window.aver.reportError).
     Anonymous reporting is allowed; logged-in users get user_id populated.
  2. GET /admin/error-logs — admin list with filters (level, source,
     dismissed, user_id) + cursor-style limit/offset pagination.
  3. POST /admin/error-logs/{id}/dismiss + .../undismiss — admin triage.

Backend's OWN unhandled exceptions are captured by the global handler in
main.py — that path inserts directly via `supabase_admin` (fire-and-
forget, fail-soft) and does NOT go through this router.

Fail-soft contract — logging must NEVER escalate:
  - POST /api/error-logs: if validation fails, return 422 (no INSERT)
    but never return 500; if Supabase INSERT fails, log to stderr and
    return 503 — the frontend reporter silently swallows non-2xx.
  - Admin GET: standard 4xx/5xx; admin UI surfaces the failure.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.admin import require_admin
from routers.auth import get_supabase_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["error-logs"])


# ── Models ─────────────────────────────────────────────────────────────


class ErrorReportRequest(BaseModel):
    level: str = Field(default="error")
    source: str = Field(default="frontend")
    message: str = Field(min_length=1, max_length=2000)
    stack: str | None = Field(default=None, max_length=10000)
    url: str | None = Field(default=None, max_length=1000)
    user_agent: str | None = Field(default=None, max_length=500)
    request_id: str | None = Field(default=None, max_length=64)
    extra: dict | None = None


# ── Helpers ────────────────────────────────────────────────────────────


_ALLOWED_LEVELS = ("error", "warning", "info")


async def _get_user_optional(authorization: str | None) -> dict | None:
    """Resolve current user if a valid token is sent; return None otherwise.

    Anonymous reports are allowed — a broken token must not block the
    POST. `get_supabase_user` raises 401 on missing/invalid auth, so we
    swallow that here.
    """
    if not authorization:
        return None
    try:
        return await get_supabase_user(authorization)
    except HTTPException:
        return None
    except Exception as exc:  # network blip etc.
        logger.warning("[error_logs] optional auth lookup failed: %s", exc)
        return None


# ── POST /api/error-logs (frontend → backend) ────────────────────────


@router.post("/api/error-logs")
async def report_frontend_error(
    body: ErrorReportRequest,
    authorization: str | None = Header(default=None),
):
    """Validate + persist a frontend-reported error.

    Auth: optional. Anonymous reports get user_id=NULL.
    """
    if body.level not in _ALLOWED_LEVELS:
        raise HTTPException(422, f"level must be one of {_ALLOWED_LEVELS}")
    if body.source != "frontend":
        # /api/error-logs is the frontend ingress only — backend errors
        # land via the global exception handler in main.py.
        raise HTTPException(422, "source must be 'frontend' for this endpoint")

    user_id: str | None = None
    user = await _get_user_optional(authorization)
    if user:
        user_id = user.get("id")

    payload = {
        "level":      body.level,
        "source":     "frontend",
        "message":    body.message[:1000],
        "stack":      (body.stack or None) and body.stack[:5000],
        "user_id":    user_id,
        "url":        body.url[:500] if body.url else None,
        "user_agent": body.user_agent[:500] if body.user_agent else None,
        "request_id": body.request_id,
        "extra":      body.extra,
    }

    try:
        supabase_admin.table("error_logs").insert(payload).execute()
    except Exception as exc:
        logger.error("[error_logs] frontend INSERT failed: %s", exc)
        raise HTTPException(503, "Logging temporarily unavailable")

    return {"received": True}


# ── Admin endpoints ────────────────────────────────────────────────────


_admin_router = APIRouter(prefix="/admin/error-logs", tags=["admin", "error-logs"])


@_admin_router.get("")
async def list_error_logs(
    authorization: str | None = Header(default=None),
    level: str | None = None,
    source: str | None = None,
    dismissed: bool | None = None,
    user_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    """List error logs with filters. Admin only."""
    await require_admin(authorization)

    if limit < 1 or limit > 200:
        raise HTTPException(422, "limit must be between 1 and 200")
    if offset < 0:
        raise HTTPException(422, "offset must be ≥ 0")
    if level is not None and level not in _ALLOWED_LEVELS:
        raise HTTPException(422, f"level must be one of {_ALLOWED_LEVELS}")
    if source is not None and source not in ("frontend", "backend"):
        raise HTTPException(422, "source must be 'frontend' or 'backend'")

    q = supabase_admin.table("error_logs").select("*")
    if level:
        q = q.eq("level", level)
    if source:
        q = q.eq("source", source)
    if dismissed is True:
        q = q.not_.is_("dismissed_at", "null")
    elif dismissed is False:
        q = q.is_("dismissed_at", "null")
    if user_id:
        q = q.eq("user_id", user_id)

    try:
        r = q.order("occurred_at", desc=True).range(offset, offset + limit - 1).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải báo lỗi: {exc}")

    return {
        "items":  r.data or [],
        "limit":  limit,
        "offset": offset,
    }


@_admin_router.get("/migration-stats")
async def error_log_migration_stats(
    days: int = 7,
    authorization: str | None = Header(default=None),
):
    """ADR-012 cutover dashboard: error counts by (implementation, release).

    The FE-migration pilots run legacy and Next side by side; the Pilot Entry
    checklist requires a dashboard that can compare error rates per
    `implementation` tag (error-reporter rides them in `extra` — additive,
    no schema change). Rows without tags (reports from before the tagging
    change, or non-browser sources) group under "untagged".

    Pagination is explicit: a bare select is capped at 1000 rows by PostgREST
    (the admin-stats lesson, PR #688) — we page until exhausted with a hard
    safety ceiling and report truncation honestly instead of undercounting.
    """
    await require_admin(authorization)
    days = max(1, min(30, days))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    PAGE = 1000
    MAX_ROWS = 20_000  # safety ceiling ≫ current table size; never silent
    rows: list[dict] = []
    truncated = False
    try:
        offset = 0
        while True:
            r = (
                supabase_admin.table("error_logs")
                .select("level, extra, dismissed_at")
                .gte("occurred_at", cutoff)
                # Stable total order — offset pagination WITHOUT one lets
                # Postgres return pages in different physical orders between
                # reads (concurrent inserts / plan changes), double-counting
                # or skipping rows (review #746). id tie-breaks equal
                # timestamps.
                .order("occurred_at", desc=True)
                .order("id", desc=True)
                .range(offset, offset + PAGE - 1)
                .execute()
            )
            batch = r.data or []
            rows.extend(batch)
            if len(batch) < PAGE:
                break
            offset += PAGE
            if offset >= MAX_ROWS:
                truncated = True
                break
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tổng hợp migration-stats: {exc}")

    groups: dict[tuple[str, str], dict] = {}
    for row in rows:
        extra = row.get("extra") or {}
        if not isinstance(extra, dict):
            extra = {}
        key = (
            str(extra.get("implementation") or "untagged"),
            str(extra.get("release") or "untagged")[:12],
        )
        g = groups.setdefault(
            key,
            {"implementation": key[0], "release": key[1],
             "total": 0, "undismissed": 0, "by_level": {}},
        )
        g["total"] += 1
        if not row.get("dismissed_at"):
            g["undismissed"] += 1
        level = str(row.get("level") or "error")
        g["by_level"][level] = g["by_level"].get(level, 0) + 1

    ordered = sorted(
        groups.values(), key=lambda g: (g["implementation"], -g["total"])
    )
    return {
        "window_days": days,
        "rows": ordered,
        "scanned": len(rows),
        "truncated": truncated,
    }


# ── Rollback-trigger metrics (AUDIT F1, 2026-07-14) ────────────────────
# The Pilot Entry checklist §4 FREEZES two rollback triggers:
#   1. error-rate on a cutover route > 2× the legacy baseline for the SAME
#      route, over a 30-minute window;
#   2. LCP p75 on the route > 1.5× baseline, over 24h.
# migration-stats above only counts raw errors by (implementation, release) —
# it has no denominator (page views), no route filter, no windows shorter
# than a day, and no baseline delta, so NEITHER frozen trigger was actually
# computable from the dashboard. This endpoint computes them:
#   - denominator: `page_view` analytics_events (event_data.path +
#     .implementation — both stacks already beacon them);
#   - numerator: error_logs rows on the route (url = pathname; implementation
#     from extra);
#   - Web Vitals: `web_vitals` analytics_events (rum-vitals.js collector),
#     p75 by nearest-rank;
#   - verdicts against the FROZEN thresholds, with explicit sample-
#     sufficiency and baseline-availability statuses instead of a silent
#     number (a rate over 3 views must not look like a rate over 3000).

ROLLBACK_ERROR_RATE_MULT = 2.0     # frozen: > 2× legacy baseline = breach
ROLLBACK_LCP_MULT = 1.5            # frozen: LCP p75 > 1.5× baseline = breach
ROLLBACK_ABS_ERROR_RATE_MAX = 0.05  # no-baseline guard (pilot 1: legacy no
ROLLBACK_ABS_LCP_MAX_MS = 4000.0    # longer serves `/`): absolute ceilings —
#                                     5% of views erroring / LCP p75 at the
#                                     CWV "poor" boundary is a breach even
#                                     without a relative baseline.
ROLLBACK_MIN_VIEWS = 20    # below this the rate is noise, not a verdict
ROLLBACK_MIN_VITALS = 10   # below this p75 is noise, not a verdict


def _p75(values: list[float]) -> float | None:
    """Nearest-rank 75th percentile — deterministic, no interpolation."""
    if not values:
        return None
    ordered = sorted(values)
    idx = max(0, -(-3 * len(ordered) // 4) - 1)  # ceil(0.75*n) - 1
    return round(ordered[idx], 3)


def _rollback_error_verdict(next_views, next_errors, legacy_views, legacy_errors,
                            param_baseline_rate):
    """Verdict for the frozen error-rate trigger. Baseline preference:
    legacy traffic on the same route in the same window (needs enough views)
    → explicit query-param baseline (a pre-cutover measurement) → absolute
    ceiling. Never returns a bare number without its basis."""
    v = {
        "threshold_x": ROLLBACK_ERROR_RATE_MULT,
        "absolute_max": ROLLBACK_ABS_ERROR_RATE_MAX,
        "baseline_rate": None,
        "baseline_source": "none",
        "delta_x": None,
        "basis": None,
        "status": None,
    }
    if next_views < ROLLBACK_MIN_VIEWS:
        v["status"] = "insufficient-sample"
        return v
    next_rate = next_errors / next_views
    if legacy_views >= ROLLBACK_MIN_VIEWS:
        v["baseline_rate"] = round(legacy_errors / legacy_views, 4)
        v["baseline_source"] = "legacy-window"
    elif param_baseline_rate is not None:
        v["baseline_rate"] = param_baseline_rate
        v["baseline_source"] = "param"
    if v["baseline_rate"]:  # a zero baseline gives no meaningful multiplier
        v["basis"] = "relative"
        v["delta_x"] = round(next_rate / v["baseline_rate"], 2)
        v["status"] = "breach" if v["delta_x"] > ROLLBACK_ERROR_RATE_MULT else "ok"
    else:
        v["basis"] = "absolute"
        if next_rate > ROLLBACK_ABS_ERROR_RATE_MAX:
            v["status"] = "breach"
        else:
            v["status"] = "ok" if v["baseline_source"] != "none" else "no-baseline"
    return v


def _rollback_vitals_verdict(next_p75, next_samples, legacy_p75, legacy_samples,
                             param_baseline_lcp_ms):
    """Verdict for the frozen LCP trigger — same shape/preference as errors."""
    v = {
        "threshold_x": ROLLBACK_LCP_MULT,
        "absolute_max_ms": ROLLBACK_ABS_LCP_MAX_MS,
        "baseline_lcp_ms": None,
        "baseline_source": "none",
        "delta_x": None,
        "basis": None,
        "status": None,
    }
    if next_p75 is None or next_samples < ROLLBACK_MIN_VITALS:
        v["status"] = "insufficient-sample"
        return v
    if legacy_p75 is not None and legacy_samples >= ROLLBACK_MIN_VITALS:
        v["baseline_lcp_ms"] = legacy_p75
        v["baseline_source"] = "legacy-window"
    elif param_baseline_lcp_ms is not None:
        v["baseline_lcp_ms"] = param_baseline_lcp_ms
        v["baseline_source"] = "param"
    if v["baseline_lcp_ms"]:
        v["basis"] = "relative"
        v["delta_x"] = round(next_p75 / v["baseline_lcp_ms"], 2)
        v["status"] = "breach" if v["delta_x"] > ROLLBACK_LCP_MULT else "ok"
    else:
        v["basis"] = "absolute"
        if next_p75 > ROLLBACK_ABS_LCP_MAX_MS:
            v["status"] = "breach"
        else:
            v["status"] = "ok" if v["baseline_source"] != "none" else "no-baseline"
    return v


@_admin_router.get("/rollback-metrics")
async def error_log_rollback_metrics(
    route: str = "/",
    window_minutes: int = 30,
    baseline_error_rate: float | None = None,
    baseline_lcp_ms: float | None = None,
    authorization: str | None = Header(default=None),
):
    """Compute the FROZEN rollback triggers for one route (see block comment
    above). `window_minutes` defaults to the error-trigger window (30); pass
    1440 for the 24h vitals window. Filters ride in event_data/extra JSON, so
    matching happens in Python over the window's rows — same explicit
    pagination + stable ordering as migration-stats (PostgREST 1000-cap +
    review #746)."""
    await require_admin(authorization)
    window_minutes = max(5, min(1440, window_minutes))
    cutoff = (
        datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
    ).isoformat()

    PAGE = 1000
    MAX_ROWS = 50_000
    truncated = False

    def _fetch_all(table, select, ts_col):
        nonlocal truncated
        out: list[dict] = []
        offset = 0
        while True:
            r = (
                supabase_admin.table(table)
                .select(select)
                .gte(ts_col, cutoff)
                .order(ts_col, desc=True)
                .order("id", desc=True)
                .range(offset, offset + PAGE - 1)
                .execute()
            )
            batch = r.data or []
            out.extend(batch)
            if len(batch) < PAGE:
                return out
            offset += PAGE
            if offset >= MAX_ROWS:
                truncated = True
                return out

    try:
        analytics_rows = _fetch_all(
            "analytics_events", "event_name, event_data, created_at", "created_at"
        )
        error_rows = _fetch_all("error_logs", "url, extra, occurred_at", "occurred_at")
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tổng hợp rollback-metrics: {exc}")

    def _impl_bucket(tag) -> str:
        return tag if tag in ("next", "legacy") else "untagged"

    buckets = {
        impl: {"page_views": 0, "errors": 0, "vitals_raw": {"lcp": [], "cls": [], "inp": []}}
        for impl in ("next", "legacy", "untagged")
    }

    for row in analytics_rows:
        ed = row.get("event_data") or {}
        if not isinstance(ed, dict) or ed.get("path") != route:
            continue
        b = buckets[_impl_bucket(ed.get("implementation"))]
        name = row.get("event_name")
        if name == "page_view":
            b["page_views"] += 1
        elif name == "web_vitals":
            for metric in ("lcp", "cls", "inp"):
                val = ed.get(metric)
                if isinstance(val, (int, float)):
                    b["vitals_raw"][metric].append(float(val))

    for row in error_rows:
        if row.get("url") != route:
            continue
        extra = row.get("extra") or {}
        if not isinstance(extra, dict):
            extra = {}
        buckets[_impl_bucket(extra.get("implementation"))]["errors"] += 1

    implementations = {}
    for impl, b in buckets.items():
        views = b["page_views"]
        errors = b["errors"]
        lcp_vals = b["vitals_raw"]["lcp"]
        implementations[impl] = {
            "page_views": views,
            "errors": errors,
            "error_rate": round(errors / views, 4) if views else None,
            "vitals": {
                "lcp_p75": _p75(lcp_vals),
                "cls_p75": _p75(b["vitals_raw"]["cls"]),
                "inp_p75": _p75(b["vitals_raw"]["inp"]),
                "samples": len(lcp_vals),
            },
        }

    nxt, leg = buckets["next"], buckets["legacy"]
    error_verdict = _rollback_error_verdict(
        nxt["page_views"], nxt["errors"],
        leg["page_views"], leg["errors"],
        baseline_error_rate,
    )
    vitals_verdict = _rollback_vitals_verdict(
        _p75(nxt["vitals_raw"]["lcp"]), len(nxt["vitals_raw"]["lcp"]),
        _p75(leg["vitals_raw"]["lcp"]), len(leg["vitals_raw"]["lcp"]),
        baseline_lcp_ms,
    )

    return {
        "route": route,
        "window_minutes": window_minutes,
        "implementations": implementations,
        "error_verdict": error_verdict,
        "vitals_verdict": vitals_verdict,
        "min_sample": {"views": ROLLBACK_MIN_VIEWS, "vitals": ROLLBACK_MIN_VITALS},
        "scanned": {"analytics": len(analytics_rows), "errors": len(error_rows)},
        "truncated": truncated,
    }


@_admin_router.get("/stats")
async def error_log_stats(authorization: str | None = Header(default=None)):
    """Counts for the Tổng quan dashboard cards.

    Returns 4 numbers: total, undismissed, last 24h, last 7d.
    Single roundtrip per metric (cheap; error_logs is small).
    """
    await require_admin(authorization)

    now = datetime.now(timezone.utc)
    iso_24h = (now - timedelta(hours=24)).isoformat()
    iso_7d  = (now - timedelta(days=7)).isoformat()

    # Use PostgREST's exact count (Content-Range), NOT len(res.data): a bare
    # select is capped at 1000 rows by default, so len() silently maxed the
    # cards at 1000 once error_logs grew past that (prod showed "1000" for a
    # 1549-row table). head=True returns only the count, no row payload.
    def _count(q) -> int:
        try:
            res = q.execute()
            return res.count or 0
        except Exception:
            return 0

    total = _count(supabase_admin.table("error_logs").select("id", count="exact", head=True))
    undismissed = _count(
        supabase_admin.table("error_logs").select("id", count="exact", head=True).is_("dismissed_at", "null")
    )
    last_24h = _count(
        supabase_admin.table("error_logs").select("id", count="exact", head=True).gte("occurred_at", iso_24h)
    )
    last_7d = _count(
        supabase_admin.table("error_logs").select("id", count="exact", head=True).gte("occurred_at", iso_7d)
    )

    return {
        "total":        total,
        "undismissed":  undismissed,
        "last_24h":     last_24h,
        "last_7d":      last_7d,
    }


@_admin_router.post("/{log_id}/dismiss")
async def dismiss_error_log(
    log_id: str,
    authorization: str | None = Header(default=None),
):
    """Mark an error log dismissed. Idempotent (re-dismiss is a no-op)."""
    admin_user = await require_admin(authorization)
    update = {
        "dismissed_at": datetime.now(timezone.utc).isoformat(),
        "dismissed_by": admin_user["id"],
    }
    try:
        r = supabase_admin.table("error_logs").update(update).eq("id", log_id).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi xử lý báo lỗi: {exc}")
    if not r.data:
        raise HTTPException(404, "Không tìm thấy báo lỗi")
    return {"dismissed": True}


@_admin_router.post("/{log_id}/undismiss")
async def undismiss_error_log(
    log_id: str,
    authorization: str | None = Header(default=None),
):
    """Reset the dismissed state. Useful when an error returns."""
    await require_admin(authorization)
    try:
        r = (
            supabase_admin.table("error_logs")
            .update({"dismissed_at": None, "dismissed_by": None})
            .eq("id", log_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi reset báo lỗi: {exc}")
    if not r.data:
        raise HTTPException(404, "Không tìm thấy báo lỗi")
    return {"undismissed": True}


@_admin_router.post("/test")
async def generate_test_error(
    authorization: str | None = Header(default=None),
    error_type: str = "exception",
):
    """Dogfood helper — generate a test error for verifying the pipeline.

    error_type:
      - 'exception': raises ValueError so the global handler captures it
        (verifies the backend handler + middleware end-to-end).
      - 'warning' / 'info': direct INSERT, bypasses the exception path
        (verifies only the table + admin list, not the handler).
    """
    await require_admin(authorization)

    if error_type == "exception":
        raise ValueError("Test exception from /admin/error-logs/test endpoint")

    if error_type not in ("warning", "info"):
        raise HTTPException(422, "error_type phải là exception | warning | info")

    payload = {
        "level":   error_type,
        "source":  "backend",
        "message": f"Test {error_type} from /admin/error-logs/test",
        "url":     "/admin/error-logs/test",
    }
    try:
        supabase_admin.table("error_logs").insert(payload).execute()
    except Exception as exc:
        raise HTTPException(500, f"Không tạo được log test: {exc}")
    return {"generated": error_type}


router.include_router(_admin_router)
