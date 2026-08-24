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
# Review #761: the two triggers have DIFFERENT frozen windows — error-rate
# over 30 minutes, LCP p75 over 24h. Each verdict is always computed at its
# own window; `window_minutes` only scopes the per-implementation table.
ROLLBACK_ERROR_WINDOW_MIN = 30
ROLLBACK_VITALS_WINDOW_MIN = 1440
# DEBT-2026-07-22-F: the table half used to be clamped to 1440 as well, which
# was correct for the frozen verdicts (nothing above needs more than 24h) but
# silently wrong for the OTHER thing this endpoint is used for — the cumulative
# exposure count a cutover gate reads. A caller asking for 30 days got a 24-hour
# number under the same field name. Measured 2026-07-22: 2880 / 6833 / 11531 /
# 43200 all returned the identical "14 views", which reads as near-zero traffic
# across the whole window and nearly produced a false "exposure floor missed"
# conclusion; the real count over the same span was 108. The table half now
# reaches 90 days; the verdict windows above stay pinned exactly as they were.
ROLLBACK_TABLE_MAX_WINDOW_MIN = 129_600   # 90 days
ROLLBACK_TABLE_MIN_WINDOW_MIN = 5
LEGACY_RETIREMENT_EVENT_NAME = "legacy_retirement_page_view"

# Gate F stateful-player drain inventory. These tables are the canonical
# persistence sources for the core players that can keep an implementation-
# specific URL alive across deployments.
GATE_F_STATEFUL_PLAYER_TABLES = (
    ("speaking", "sessions"),
    ("reading_exam", "reading_test_attempts"),
    ("listening_test", "listening_test_attempts"),
    ("listening_dictation", "dictation_attempts"),
)

# Writing claims its renderer before ``/start`` so a failed start can leave a
# still-pending assignment pinned to Legacy. Count the canonical affinity
# directly instead of inferring renderer ownership from ``started_at``.
GATE_F_AFFINITY_PLAYER_TABLES = (
    ("writing_assignment", "writing_assignments"),
)


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
    # Review #761: verdict math runs on the RAW baseline — rounding first
    # can hide a real regression (legacy 1/30000 rounds to 0.0 → the true 3×
    # delta silently falls through to the absolute guard) or flip a
    # just-over-threshold delta to ok. Rounding is display-only.
    baseline_raw = None
    if legacy_views >= ROLLBACK_MIN_VIEWS:
        baseline_raw = legacy_errors / legacy_views
        v["baseline_rate"] = round(baseline_raw, 6)
        v["baseline_source"] = "legacy-window"
    elif param_baseline_rate is not None:
        baseline_raw = param_baseline_rate
        v["baseline_rate"] = param_baseline_rate
        v["baseline_source"] = "param"
    if baseline_raw:  # a zero baseline gives no meaningful multiplier
        v["basis"] = "relative"
        delta_raw = next_rate / baseline_raw
        v["delta_x"] = round(delta_raw, 2)
        v["status"] = "breach" if delta_raw > ROLLBACK_ERROR_RATE_MULT else "ok"
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
    match: str = "exact",
    baseline_error_rate: float | None = None,
    baseline_lcp_ms: float | None = None,
    authorization: str | None = Header(default=None),
):
    """Compute the FROZEN rollback triggers for one route (see block comment
    above). The verdicts ALWAYS use their frozen windows — error-rate over
    30 minutes, LCP p75 over 24h (review #761: one shared cutoff meant the
    displayed verdicts were not the frozen triggers unless the admin happened
    to pick the matching window). `window_minutes` scopes only the
    per-implementation table. Filters ride in event_data/extra JSON, so
    matching happens in Python over the window's rows — same explicit
    pagination + stable ordering as migration-stats (PostgREST 1000-cap +
    review #746)."""
    await require_admin(authorization)
    # DEBT-2026-07-29-L — `route` matched the recorded path EXACTLY, which made
    # every parameterised route unmeasurable: asking for `/grammar` during the
    # pilot-2 observation window returned 0 views / 0 errors because the paths
    # actually recorded are `/grammar/:category/:slug`. A panel that answers
    # "zero" for a live route is worse than one that refuses — it reads as "no
    # traffic, nothing to see". `match=prefix` counts the route AND everything
    # below it (`/grammar` + `/grammar/...`), which is the unit a cutover gate
    # actually owns. Default stays `exact` so every number measured before this
    # change is still reproducible; the mode is echoed in the response so a
    # logged measurement says which rule produced it.
    match = match if match in ("exact", "prefix") else "exact"
    # Review #879 — `/` is the one route where the prefix rule degenerates:
    # `"/".rstrip("/") + "/"` is `/`, which every pathname on the site starts
    # with, so a PER-ROUTE trigger would quietly become a site-wide one and the
    # verdict would be attributed to the landing page. Coerce to exact rather
    # than 4xx (the panel would just say "không tải được") and SAY SO in the
    # response — a coercion the caller cannot see is the same silent-wrong-
    # number failure as DEBT-F.
    match_coerced_from = None
    if match == "prefix" and route.rstrip("/") == "":
        match, match_coerced_from = "exact", "prefix"
    route_prefix = (route.rstrip("/") + "/") if match == "prefix" else None

    def _route_matches(path) -> bool:
        if not isinstance(path, str):
            return False
        if path == route:
            return True
        return route_prefix is not None and path.startswith(route_prefix)

    # DEBT-2026-07-22-F — clamp the table half to a documented ceiling and TELL
    # the caller when it bit. Silently returning a 24h number for a 30-day
    # request is what made the volume half of the §12.3 exposure floor
    # unmeasurable for five days of the Pilot-1 soak.
    requested_window_minutes = window_minutes
    window_minutes = max(
        ROLLBACK_TABLE_MIN_WINDOW_MIN,
        min(ROLLBACK_TABLE_MAX_WINDOW_MIN, window_minutes),
    )
    window_clamped = window_minutes != requested_window_minutes
    now = datetime.now(timezone.utc)
    # One fetch covers the widest window needed; narrower windows filter by
    # row timestamp in Python.
    fetch_minutes = max(window_minutes, ROLLBACK_VITALS_WINDOW_MIN)
    cutoff = (now - timedelta(minutes=fetch_minutes)).isoformat()

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

    def _within(row_ts, window_cutoff: datetime) -> bool:
        """Row-level window filter. Missing/unparseable timestamps count as
        IN-window — inclusive is the safe direction for the error numerator,
        and rows the DB already filtered by the fetch cutoff can't be older
        than the widest window anyway."""
        if not row_ts:
            return True
        try:
            ts = datetime.fromisoformat(str(row_ts).replace("Z", "+00:00"))
        except ValueError:
            return True
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts >= window_cutoff

    def _bucketize(minutes: int) -> dict:
        window_cutoff = now - timedelta(minutes=minutes)
        buckets = {
            impl: {"page_views": 0, "errors": 0,
                   "vitals_raw": {"lcp": [], "cls": [], "inp": []}}
            for impl in ("next", "legacy", "untagged")
        }
        for row in analytics_rows:
            ed = row.get("event_data") or {}
            if not isinstance(ed, dict) or not _route_matches(ed.get("path")):
                continue
            if not _within(row.get("created_at"), window_cutoff):
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
            if not _route_matches(row.get("url")):
                continue
            if not _within(row.get("occurred_at"), window_cutoff):
                continue
            extra = row.get("extra") or {}
            if not isinstance(extra, dict):
                extra = {}
            buckets[_impl_bucket(extra.get("implementation"))]["errors"] += 1
        return buckets

    # Three windows: the table shows what the admin asked for; each verdict
    # is pinned to ITS frozen trigger window (review #761).
    table_buckets = _bucketize(window_minutes)
    error_buckets = (
        table_buckets if window_minutes == ROLLBACK_ERROR_WINDOW_MIN
        else _bucketize(ROLLBACK_ERROR_WINDOW_MIN)
    )
    vitals_buckets = (
        table_buckets if window_minutes == ROLLBACK_VITALS_WINDOW_MIN
        else _bucketize(ROLLBACK_VITALS_WINDOW_MIN)
    )

    implementations = {}
    for impl, b in table_buckets.items():
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

    nxt, leg = error_buckets["next"], error_buckets["legacy"]
    error_verdict = _rollback_error_verdict(
        nxt["page_views"], nxt["errors"],
        leg["page_views"], leg["errors"],
        baseline_error_rate,
    )
    error_verdict["window_minutes"] = ROLLBACK_ERROR_WINDOW_MIN
    vn, vl = vitals_buckets["next"], vitals_buckets["legacy"]
    vitals_verdict = _rollback_vitals_verdict(
        _p75(vn["vitals_raw"]["lcp"]), len(vn["vitals_raw"]["lcp"]),
        _p75(vl["vitals_raw"]["lcp"]), len(vl["vitals_raw"]["lcp"]),
        baseline_lcp_ms,
    )
    vitals_verdict["window_minutes"] = ROLLBACK_VITALS_WINDOW_MIN

    # ── Exposure (the §12.3 volume half) ────────────────────────────────
    # Review #823 raised two defects in the first cut of this number, both of
    # which made it a plausible-looking value with the wrong meaning — exactly
    # the class DEBT-F exists to kill:
    #
    #   1. It summed next + legacy + untagged. A window that spans a cutover
    #      therefore let traffic the OLD implementation served satisfy the
    #      exposure floor of the code being evaluated.
    #   2. It was summed over `analytics_rows`, which `_fetch_all` caps at
    #      MAX_ROWS across EVERY route and event type (no route/event filter on
    #      that fetch). Raising the table window to 90 days made that cap far
    #      easier to reach — 20,179 rows already sit in the last 90 days against
    #      a 50,000 ceiling — and past it, older qualifying page views are
    #      dropped while the total still presents itself as cumulative.
    #
    # So the count is taken with scoped EXACT-count queries instead: filtered at
    # the database on event_name + route + window (+ implementation), which is
    # immune to the scan ceiling and is per-cohort by construction. Verified
    # against production that PostgREST filters the JSON path — the `_Query`
    # test stub answers any chain, so it cannot prove this syntax works.
    exposure_cutoff = (now - timedelta(minutes=window_minutes)).isoformat()

    def _exposure_count_one(
        impl: str | None,
        *,
        prefix: bool,
        event_name: str = "page_view",
    ) -> int | None:
        q = (
            supabase_admin.table("analytics_events")
            .select("id", count="exact")
            .eq("event_name", event_name)
            .gte("created_at", exposure_cutoff)
        )
        # DEBT-2026-07-29-L — two scoped exact counts (route itself, then the
        # subtree) instead of one `or_` over a JSON path: `or_` filter strings
        # are parsed by PostgREST and the `->>` operator inside them is exactly
        # the kind of syntax the `_Query` test stub answers happily while
        # production rejects it. Two `.eq`/`.like` calls use the same operators
        # this endpoint already proved against production.
        q = (q.like("event_data->>path", route_prefix + "%") if prefix
             else q.eq("event_data->>path", route))
        if impl is not None:
            q = q.eq("event_data->>implementation", impl)
        return q.limit(1).execute().count

    def _exposure_count(
        impl: str | None,
        *,
        event_name: str = "page_view",
    ) -> int | None:
        if route_prefix is None:
            return _exposure_count_one(impl, prefix=False, event_name=event_name)
        # Review #879 — `%` and `_` are LIKE wildcards. They are also legal path
        # characters, and `_route_matches()` (which produces the TABLE numbers)
        # treats them literally. PostgREST exposes no ESCAPE clause, so a route
        # carrying either would make the exposure count include siblings the
        # table excludes — two numbers on one screen disagreeing, which is the
        # failure mode this whole block exists to prevent. Refuse the exact
        # count instead: returning None drops to the scanned fallback, which is
        # labelled a LOWER BOUND in the response and the panel.
        if any(ch in route_prefix for ch in ("%", "_")):
            return None
        # Review #879 — `LIKE 'x/%'` also matches `x/` itself (`%` matches zero
        # characters), so for a route that ALREADY ends in `/` the subtree query
        # covers the route too. Adding an exact count on top double-counted it
        # against a table that counts it once.
        if route == route_prefix:
            return _exposure_count_one(impl, prefix=True, event_name=event_name)
        own = _exposure_count_one(impl, prefix=False, event_name=event_name)
        if own is None:
            return None
        below = _exposure_count_one(impl, prefix=True, event_name=event_name)
        return None if below is None else own + below

    try:
        exp_total = _exposure_count(None)
        exp_next = _exposure_count("next")
        exp_legacy = _exposure_count("legacy")
        exposure_exact = None not in (exp_total, exp_next, exp_legacy)
    except Exception as exc:
        logger.warning("rollback-metrics: exact exposure count failed: %s", exc)
        exposure_exact = False
        exp_total = exp_next = exp_legacy = None

    if not exposure_exact:
        # Fall back to the scanned table, but say plainly that the number is a
        # LOWER BOUND. A capped scan reported as a cumulative total is the
        # second defect above; degrading to "at least N" keeps it honest.
        exp_next = table_buckets["next"]["page_views"]
        exp_legacy = table_buckets["legacy"]["page_views"]
        exp_total = sum(b["page_views"] for b in table_buckets.values())

    exposure = {
        # `evaluated` is the number a cutover gate reads: the cohort under test.
        "evaluated_implementation": "next",
        "evaluated_views": exp_next,
        "by_implementation": {
            "next": exp_next,
            "legacy": exp_legacy,
            "untagged": (max(0, exp_total - exp_next - exp_legacy)
                         if exposure_exact else table_buckets["untagged"]["page_views"]),
        },
        "all_views": exp_total,
        # False → treat every number above as "at least this many".
        "exact": bool(exposure_exact),
        "window_minutes": window_minutes,
    }

    # Gate F retirement uses its own event namespace. It must never increase
    # product foot-traffic, error-rate denominators or their legacy baseline.
    # Keep the count exact and fail closed: unlike the operational rollback
    # table, a lower bound cannot prove zero legitimate fallback traffic.
    try:
        retirement_legacy_views = _exposure_count(
            "legacy",
            event_name=LEGACY_RETIREMENT_EVENT_NAME,
        )
        retirement_exact = retirement_legacy_views is not None
    except Exception as exc:
        logger.warning("rollback-metrics: exact retirement count failed: %s", exc)
        retirement_legacy_views = None
        retirement_exact = False
    retirement_exposure = {
        "event_name": LEGACY_RETIREMENT_EVENT_NAME,
        "legacy_views": retirement_legacy_views,
        "exact": retirement_exact,
        "window_minutes": window_minutes,
    }

    return {
        "route": route,
        # DEBT-2026-07-29-L — say which matching rule produced these numbers, so
        # a logged measurement is reproducible after the default ever changes.
        # `match_coerced_from` is set when the requested mode could not be
        # honoured (review #879: prefix on `/` would match the whole site).
        "match": match,
        "match_coerced_from": match_coerced_from,
        "window_minutes": window_minutes,
        # DEBT-2026-07-22-F — `window_minutes` alone is ambiguous: it is the
        # EFFECTIVE window, so a caller cannot tell a granted request from a
        # clamped one without remembering what it sent. These two make it
        # unmistakable at the point the number is read.
        "window_minutes_requested": requested_window_minutes,
        "window_clamped": window_clamped,
        "windows": {
            "table": window_minutes,
            "table_max": ROLLBACK_TABLE_MAX_WINDOW_MIN,
            "error_trigger": ROLLBACK_ERROR_WINDOW_MIN,
            "vitals_trigger": ROLLBACK_VITALS_WINDOW_MIN,
        },
        # DEBT-2026-07-22-F — the "≥N interactions" half of the §12.3 gate. No
        # field used to carry it, so the soak day-log tracked the elapsed-days
        # half and never this one. See _exposure() for why it is NOT a sum over
        # the scanned table.
        "exposure": exposure,
        "legacy_retirement_exposure": retirement_exposure,
        "implementations": implementations,
        "error_verdict": error_verdict,
        "vitals_verdict": vitals_verdict,
        "min_sample": {"views": ROLLBACK_MIN_VIEWS, "vitals": ROLLBACK_MIN_VITALS},
        "scanned": {"analytics": len(analytics_rows), "errors": len(error_rows)},
        "truncated": truncated,
    }


def _gate_f_cutover_at(value: str) -> datetime:
    """Parse a reproducible, timezone-aware Gate F admission cutoff."""
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        raise HTTPException(422, "cutover_at phải là ISO-8601 có múi giờ") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise HTTPException(422, "cutover_at phải là ISO-8601 có múi giờ")
    normalized = parsed.astimezone(timezone.utc)
    if normalized > datetime.now(timezone.utc):
        raise HTTPException(422, "cutover_at không được nằm trong tương lai")
    return normalized


def _gate_f_exact_active_count(
    table: str,
    *,
    affinity: str | None | object = ...,
    resume_after: str | None = None,
    missing_resume_expiry: bool = False,
) -> int:
    """Return one exact active-player count; never use a scanned lower bound."""
    query = (
        supabase_admin.table(table)
        .select("id", count="exact")
        .eq("status", "in_progress")
    )
    if affinity is not ...:
        query = (
            query.is_("renderer_affinity", "null")
            if affinity is None else query.eq("renderer_affinity", affinity)
        )
    if resume_after is not None:
        query = query.gt("resume_expires_at", resume_after)
    if missing_resume_expiry:
        query = query.is_("resume_expires_at", "null")
    result = query.limit(1).execute()
    if result.count is None:
        raise RuntimeError(f"{table}: exact count unavailable")
    return int(result.count)


def _gate_f_exact_affinity_count(
    table: str,
    *,
    status: str,
    affinity: str | None,
    lease_after: str | None = None,
    missing_lease_expiry: bool = False,
) -> int:
    """Return an exact affinity-pinned count for one active workflow state."""
    query = (
        supabase_admin.table(table)
        .select("id", count="exact")
        .eq("status", status)
    )
    if affinity is None:
        query = query.is_("renderer_affinity", "null")
    else:
        query = query.eq("renderer_affinity", affinity)
    if lease_after is not None:
        query = query.gt("renderer_affinity_expires_at", lease_after)
    if missing_lease_expiry:
        query = query.is_("renderer_affinity_expires_at", "null")
    result = query.limit(1).execute()
    if result.count is None:
        raise RuntimeError(f"{table}: exact affinity count unavailable")
    return int(result.count)


@_admin_router.get("/legacy-active-session-drain")
async def gate_f_legacy_active_session_drain(
    cutover_at: str,
    authorization: str | None = Header(default=None),
):
    """Gate F exact inventory of still-resumable Legacy player state.

    Renderer affinity is canonical after migrations 215–221. Migration 224
    adds a hard resume/lease deadline, so an ancient audit row is not mistaken
    for a live browser dependency. A Legacy or unclaimed row blocks only while
    its canonical deadline is still in the future. Missing deadlines fail
    closed. The cutoff remains the versioned release timestamp, but post-cutover
    Legacy admissions also block — silently allowing one would hide a routing
    regression.

    The result deliberately does not claim that Gate F passed. Zero stateful
    rows is only one retirement prerequisite; the 14-day/full-cycle telemetry,
    rollback health and deletion audit remain separate evidence.
    """
    await require_admin(authorization)
    cutoff = _gate_f_cutover_at(cutover_at)
    cutoff_iso = cutoff.isoformat()
    observed_at = datetime.now(timezone.utc).isoformat()

    surfaces: dict[str, dict] = {}
    try:
        for surface, table in GATE_F_STATEFUL_PLAYER_TABLES:
            active_total = _gate_f_exact_active_count(table)
            legacy_live = _gate_f_exact_active_count(
                table, affinity="legacy", resume_after=observed_at,
            )
            unclaimed_live = _gate_f_exact_active_count(
                table, affinity=None, resume_after=observed_at,
            )
            next_live = _gate_f_exact_active_count(
                table, affinity="next", resume_after=observed_at,
            )
            missing_expiry = _gate_f_exact_active_count(
                table, missing_resume_expiry=True,
            )
            blockers = legacy_live + unclaimed_live + missing_expiry
            expired_audit_rows = active_total - (
                legacy_live + unclaimed_live + next_live + missing_expiry
            )
            if expired_audit_rows < 0:
                raise RuntimeError(f"{table}: inconsistent exact counts")
            surfaces[surface] = {
                "table": table,
                "active_status": "in_progress",
                "active_total": active_total,
                "legacy_unexpired": legacy_live,
                "unclaimed_unexpired": unclaimed_live,
                "next_unexpired": next_live,
                "missing_resume_expires_at": missing_expiry,
                "expired_audit_rows": expired_audit_rows,
                "legacy_blocking": blockers,
                "exact": True,
            }
        for surface, table in GATE_F_AFFINITY_PLAYER_TABLES:
            legacy_pending = _gate_f_exact_affinity_count(
                table,
                status="pending",
                affinity="legacy",
                lease_after=observed_at,
            )
            legacy_in_progress = _gate_f_exact_affinity_count(
                table,
                status="in_progress",
                affinity="legacy",
                lease_after=observed_at,
            )
            unclaimed_in_progress = _gate_f_exact_affinity_count(
                table,
                status="in_progress",
                affinity=None,
                lease_after=observed_at,
            )
            missing_lease = sum(
                _gate_f_exact_affinity_count(
                    table,
                    status=status,
                    affinity=affinity,
                    missing_lease_expiry=True,
                )
                for status, affinity in (
                    ("pending", "legacy"),
                    ("in_progress", "legacy"),
                    ("in_progress", None),
                    ("pending", "next"),
                    ("in_progress", "next"),
                )
            )
            blockers = (
                legacy_pending + legacy_in_progress
                + unclaimed_in_progress + missing_lease
            )
            surfaces[surface] = {
                "table": table,
                "blocking_renderer_affinities": ["legacy", None],
                "active_statuses": ["pending", "in_progress"],
                "legacy_pending": legacy_pending,
                "legacy_in_progress": legacy_in_progress,
                "unclaimed_in_progress": unclaimed_in_progress,
                "missing_renderer_lease": missing_lease,
                "legacy_blocking": blockers,
                "exact": True,
            }
    except Exception as exc:
        logger.warning("Gate F active-session drain query failed: %s", exc)
        raise HTTPException(
            500,
            "Không thể xác minh exact active-session drain cho Gate F",
        ) from exc

    legacy_blocking_total = sum(row["legacy_blocking"] for row in surfaces.values())
    return {
        "schema_version": 4,
        "cutover_at": cutoff_iso,
        "observed_at": observed_at,
        "exact": True,
        "stateful_legacy_drain_zero": legacy_blocking_total == 0,
        "legacy_blocking_total": legacy_blocking_total,
        "surfaces": surfaces,
        "retirement_decision": "pending-additional-gate-f-evidence",
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
