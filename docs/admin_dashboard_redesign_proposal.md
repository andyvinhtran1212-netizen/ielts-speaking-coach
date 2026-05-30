# Admin Dashboard Redesign — D0 Discovery + Proposal

**Sprint:** admin-dashboard-redesign · **Phase:** D0 (proposal only, no app code)
**Target:** `/pages/admin/dashboard/index.html` (the **ops Dashboard**, not the `/admin/` Overview)
**Date:** 2026-05-30

---

## 1. Audit — what exists today

### Two distinct admin landings (intentional, Sprint 18.2)
The chrome nav has **two** entries — they are NOT duplicates:

| Nav | Page | Endpoint | Purpose |
|---|---|---|---|
| **Tổng quan** | `/pages/admin/index.html` (`admin-overview.js`) | `GET /admin/overview` | **Pedagogical** — students by cohort, per-skill activity, **20-row recent-activity feed**, errors, access-codes by type |
| **Dashboard** | `/pages/admin/dashboard/index.html` (`admin-dashboard.js`) | `GET /admin/dashboard/overview` | **Operational** — 6 ops metrics (users, active codes, distinct visitors, completed practices, grading minutes, monthly cost) |

Sprint 18.2 created the Dashboard as the **ops** view, consolidating Usage logs + Foot-traffic + System (AI cost). So the split is deliberate: Overview = "how are students doing", Dashboard = "how is the system running / what does it cost".

### Dashboard's 6 metrics (`services/admin_dashboard.py :: compute_dashboard_overview`)
| Metric | Source | Query shape |
|---|---|---|
| total_users | `users` | `count(*)` |
| active_codes | `user_code_assignments` (is_active) | `count(*)` |
| distinct_visitors (7/30/90) | `analytics_events` (page_view, windowed) | fetch user_id rows → dedupe in Python |
| total_practices | `sessions` (status=completed) | `count(*)` |
| grading_minutes (cumulative) | `responses.duration_seconds` | **fetch ALL rows → SUM in Python** |
| monthly_cost_usd | `ai_usage_logs.cost_usd_est` (this month) | fetch month rows → SUM in Python |

Cache-Control: none on this endpoint (the Overview endpoint sets 300s; Dashboard does not).

### Reusable infra already in the repo
- `backend/services/server_timing.py` — Server-Timing helper (perf visibility).
- `backend/services/public_cache.py` — caching helper (Perf-3 pattern).
- `admin_overview.py` — `Cache-Control: max-age=300` precedent + `_safe_select` graceful-degradation pattern.
- Design primitives (design-consistency cluster): `.adm-card`, `.adm-status-pill`, `.admin-card-link`, `.adm-btn-*`, `--av-*` tokens, theme-aware.

---

## 2. Data-gap analysis (vs the three redesign goals)

| Goal | Status | Detail |
|---|---|---|
| **Recent activity** | ✅ **Already exists** | `/admin/overview.recent_activity` = 20 normalized events (speaking/listening/writing, with email + score + link). The **Overview** page already renders it; the Dashboard does not. |
| **Breakdowns** | ✅ **Mostly exists** | `/admin/overview` has per-cohort, per-skill, and access-code-by-type. Ops-flavoured breakdowns (cost-by-day, visitors-by-day) would be new. |
| **Trends / sparklines** | ❌ **Genuine gap** | NO time-series anywhere. No daily rollup table. Derivable from `created_at` on `analytics_events` / `sessions` / `ai_usage_logs`, but not stored or aggregated. **This is the only real new-backend need.** |

> **This contradicts the commission's framing** ("trends/breakdowns/activity need backend data that may not exist"). Activity + breakdowns *do* exist (on the Overview endpoint). Only **trends** require new backend. This meaningfully shrinks the backend work.

### Perf liabilities found (Perf-Phase-2 "slow dashboard-init" root cause)
- 🔴 `grading_minutes` fetches **every** `responses` row's `duration_seconds` (cumulative, **unbounded** — grows forever). Biggest liability.
- 🟠 `distinct_visitors` fetches all `page_view` rows in the window (can be large) and dedupes in Python.
- No caching on `/admin/dashboard/overview`.

---

## 3. Proposed layout (frontend-design; reuses design-system primitives)

Keep the Dashboard **ops-focused**; make it polished + add trends + an actionable strip. No new tile/button styles — reuse `.adm-card` + tokens + `.admin-card-link` + `.adm-status-pill`.

```
┌─ Dashboard ───────────────────────────────  [window 7/30/90 ▾] [↻ Làm mới] ─┐
│                                                                              │
│  ROW 1 — KPI tiles (6), each: label · big value · sparkline · Δ vs prior     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                          │
│  │ Người dùng   │ │ Người xem    │ │ Bài practice │   …codes / phút / cost   │
│  │  1,240       │ │   312        │ │   4,981      │                          │
│  │  ▁▂▃▅▇ +8%   │ │  ▂▃▅▃▇ +3%   │ │  ▃▅▆▇█ +12%  │                          │
│  │  Xem chi tiết→│ │ Xem chi tiết→│ │ Xem chi tiết→│                          │
│  └──────────────┘ └──────────────┘ └──────────────┘                          │
│                                                                              │
│  ROW 2 — Trends panel (one wider area chart, 30 days)                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Hoạt động & chi phí theo ngày    [practices ▇  cost ▁]                 │  │
│  │   inline SVG area/line chart (theme-aware via --av tokens)             │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ROW 3 — "Cần chú ý" (actionable ops strip, cheap counts)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                                      │
│  │ ⚠ 3 lỗi  │ │ ✎ 5 bài  │ │ … codes  │   each links to its admin page       │
│  │ chưa xử  │ │ chờ chấm │ │ sắp hết  │   (status pill colour-coded)         │
│  └──────────┘ └──────────┘ └──────────┘                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

**Chart approach (recommendation): hand-rolled inline SVG** — sparklines per tile + one small area/line chart. Rationale: zero-dependency (Pattern #15 lean), theme-aware via `--av-*` tokens / `currentColor` (a canvas lib like Chart.js can't read CSS tokens and adds bundle weight), and the data is small (≤90 daily points). No React (vanilla stack). A `js/charts/sparkline.js` helper (~40 LOC) renders both.

---

## 4. Data plan (perf-aware)

### New: `GET /admin/dashboard/trends?days=30`
Returns daily series for the headline ops metrics:
```json
{ "days": 30,
  "series": {
    "visitors":  [{ "date": "2026-05-01", "value": 41 }, …],
    "practices": [{ "date": "2026-05-01", "value": 12 }, …],
    "cost_usd":  [{ "date": "2026-05-01", "value": 2.13 }, …] },
  "computed_at": "…" }
```

**No migration needed (recommended).** All three series are **windowed** (`gte created_at, since`), so the fetched row set is bounded by the requested range — bucket by `date_trunc`-equivalent in Python (group by `created_at[:10]`). This avoids a DB function to deploy/maintain. Tables already have `created_at`. If a 30-day window ever gets large (e.g. page_view volume), promote that one series to a Postgres RPC `GROUP BY day` later — flagged, not now.

**Perf:**
- `Cache-Control: max-age=300` on the trends endpoint (matches Overview; admin has a manual refresh).
- Wrap the compute in `services/server_timing.py` so the dashboard's load cost is observable.
- **Optional (recommend yes):** fix `grading_minutes` — the unbounded `responses` scan. Cheapest correct fix: keep cumulative semantics but stop pulling every row into Python — note as a small perf PR (could window to "this month" + a stored running total later). I'll flag it; Andy decides whether to fold it in.

### Reuse (no new backend) for ROW 3 "Cần chú ý"
- errors undismissed → already in `/admin/overview.errors.undismissed` (or a cheap `count(*)`).
- writing feedback pending → already in `/admin/overview.skills.writing.feedback_pending`.
So ROW 3 can be populated **without new queries** (reuse Overview, or add cheap counts to the dashboard endpoint).

---

## 5. Recommendation + open decisions (Andy)

**Recommended:** keep the Sprint-18.2 IA split (Dashboard = ops). Scope = **trends endpoint + polished tiles with sparklines + a 30-day trends chart + a cheap "Cần chú ý" strip**, all on design-system primitives. This is smaller than the commission assumed because activity/breakdowns already exist on Overview — we should NOT duplicate the pedagogical activity feed onto the ops Dashboard.

**Decisions needed before building:**
1. **IA / scope** — (A) Dashboard stays ops-only + trends [recommended], or (B) merge Overview's activity+breakdowns into the Dashboard (bigger IA change; re-opens the 18.2 split). 
2. **`grading_minutes` perf fix** — fold the unbounded-scan fix into this sprint, or defer to a separate perf PR?
3. **Chart** — inline SVG (recommended) vs a vanilla chart lib.

### ✅ Approved direction (Andy, 2026-05-30)
1. **Ops-only + trends** — keep the 18.2 split; do NOT duplicate Overview's pedagogical activity feed.
2. **Fold in** the `grading_minutes` perf fix.
3. **Hand-rolled inline SVG** charts (zero-dep, token-themed).

Implemented as one cohesive PR (backend + frontend + this doc) with **graceful degradation** (Pattern #29): the new trends endpoint needs no migration (windowed Python); the only migration is a SUM RPC for grading-minutes, which the backend falls back from to the old path if unapplied — so the PR is mergeable regardless of deploy ordering.

### SPLIT plan (after direction approved)
- **PR1** — this proposal doc (D0).
- **PR2** — backend: `GET /admin/dashboard/trends` (+ optional grading-minutes fix), cached + Server-Timing. *deployed-only* (Lesson 11 §8 Railway verify).
- **PR3** — frontend: redesigned dashboard (tiles + sparklines + trends chart + Cần chú ý strip), theme-aware, sentinels.

(PR2+PR3 may combine if small.)
