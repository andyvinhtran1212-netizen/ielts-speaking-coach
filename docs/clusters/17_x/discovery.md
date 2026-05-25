# Sprint 17.0 — ADMIN-PANEL-CONSOLIDATION Discovery

**Cluster:** 17.x ADMIN-PANEL-CONSOLIDATION
**Type:** Discovery (lightweight, 5-direction — no feature code)
**Date:** 2026-05-25
**Base:** `main` @ `49c5ee19` (cluster 16.x feature-complete, #283-#290 merged)
**Author:** Code (autonomous), commission treated as hypothesis (Pattern #42)

> **Read Section 11 first if you wrote the commission.** The biggest correction:
> the frontend is on **GitHub Pages, not Vercel** — so Vercel Analytics (Direction D)
> is not an option; a custom-telemetry path already exists and is the way.

Admin is a **multi-page** app: `frontend/pages/admin/<feature>/index.html` +
per-feature JS modules (`frontend/js/admin-*.js`) + a nav chrome
(`aver-admin-chrome.js`). There is also a legacy top-level `frontend/admin.html`.
Latest migration = `079`; **the first 17.x migration is `080`.**

---

## Section 1 — Empirical motivation

Andy (2026-05-25, post cluster-16.x): consolidate/finish the admin panel. Five directives:
A) activation-codes UI — code→account mapping + quota remaining + sort/filter/search;
B) finish the partial **usage log**; C) finish the partial **cohort/class** feature;
D) **foot-traffic** tracking site-wide; E) **code reassignment** (refill / cohort transfer)
without re-onboarding. Andy sequence: **A → B → C → D → E** (E "sau này").

---

## Section 2 — Direction A: Activation-codes UI

### Current state (file:line)
- **Schema** (`access_codes`): 16 columns — `id, code, is_used, used_by, used_at, is_revoked,
  is_active, created_at, permissions, session_limit, expires_at` (migration `009`),
  `code_type ('mass'|'direct'|'staff'), cohort_id, notes` (migration `062:20-23`).
  `user_code_assignments`: `id, user_id, code_id, assigned_at, is_active` (migration `009:14-20`).
  `is_used`/`used_by`/`used_at` are **immutable after activation** (`auth.py:321-325`).
- **Backend `GET /admin/access-codes`** (`admin.py:807-925`) **already returns** per code:
  all 16 cols + `assigned_user_count` + **`assigned_users[]` with `email`, `name`,
  `is_fallback_used_by`, `removable`** + `cohort_name`. Detail `GET /admin/access-codes/{id}`
  (`admin.py:1057-1138`) returns `assignments[]` (active + inactive). No query params (returns all,
  `created_at DESC`).
- **Frontend** (`frontend/js/admin-access-codes.js`, `pages/admin/access-codes/index.html`):
  renders code / type / cohort / status / session_limit / expires / notes. **Client-side filters:**
  type, status, cohort. **No search box, no sort, and crucially it does NOT render the
  `assigned_users`/email mapping the API already provides** (`admin-access-codes.js:86-105`).
- **Quota:** only a global `MAX_SESSIONS_PER_USER_PER_DAY=10` per-day cap (`config.py:40`,
  enforced `sessions.py:277-303`, admins bypass). `access_codes.session_limit` is stored + editable
  but **never enforced and never compared to usage** — **"remaining quota" is computed nowhere.**

### What 17.1 actually needs (refined)
1. **Render the account mapping** — the data is already in the API response; the UI just isn't
   showing `assigned_users[].email`. Low effort, high value.
2. **Search + sort** — add a code/email search box + sortable columns (created/expiry/status).
   Likely move filtering server-side (`GET /admin/access-codes?search=&sort=&page=`) for scale,
   mirroring the `GET /sessions` pagination pattern.
3. **Quota remaining (new compute)** — count a user's sessions vs the code's `session_limit`.
   Needs a new aggregation (no per-code session counter exists today; `sessions` has no `code_id`).
   Decision: count per-user lifetime sessions, or per-code? (no `sessions.code_id` link — see B3.)

---

## Section 3 — Direction B: Usage log

### Current state
- **UI is a pure placeholder:** `frontend/pages/admin/usage/index.html` — "Sắp ra mắt" banner,
  zero logic; nav-registered `phaseB:true` in `aver-admin-chrome.js`.
- **`admin-ai-usage.js` is complete but unrelated** — it's an AI **cost** dashboard
  (`GET /admin/ai-usage`, `admin.py:1690-1799`) over `ai_usage_logs`, not a per-user/per-code
  activity log.
- **Candidate sources:** `ai_usage_logs` (migration `031`; `user_id`+`session_id`, actively
  written by claude/gemini/whisper/tts loggers) · `grading_events` (`073/074`; session-level
  telemetry, RLS service-only `076`) · `analytics_events` (`018`; `event_name/event_data/session_id`,
  **no `user_id`**, only 2 event types emitted) · `sessions` (the real activity record).
- **Gap:** there is **no per-user/per-code activity endpoint** and **no `code_id` on `sessions`**
  to attribute activity to the unlocking code. `admin_overview.py` aggregates cross-module activity
  but not keyed by user or code.

### What 17.2 needs
A per-user (and, via `user_code_assignments`, per-code) activity endpoint —
`GET /admin/users/{id}/usage` and/or `GET /admin/access-codes/{id}/usage` — aggregating
`sessions` (count, last active, bands) + `ai_usage_logs` (cost) + reusing `admin_overview`'s
`_safe_select` pattern; plus the UI to replace the placeholder. **Scope decision needed:** per-user
timeline vs per-code rollup vs both (the placeholder gives no hint — flag for Andy).

---

## Section 4 — Direction C: Cohort/class

### Current state
- **Schema complete:** `cohorts` (migration `060:13-21`: `id, name, code_prefix, description,
  is_active, created_by, created_at, updated_at`, RLS admin-only). `students.cohort_id` (`060:27-31`,
  NULL = mass flow). `access_codes.cohort_id` (`062:22-26`, required when `code_type='direct'`).
  **No `cohort_members` join — membership is direct via `students.cohort_id`.**
- **Backend `cohorts.py`:** `GET /admin/cohorts` (list, `?is_active=`), `POST` (create), `PATCH /{id}`
  (update). **No add/remove-member, no delete (soft-archive only via `is_active`).**
- **UI is a placeholder:** `frontend/pages/admin/cohorts/index.html` — "Sắp ra mắt", deferred Phase B.
  Cohorts only appear as read-only labels + a picker inside the access-codes UI.
- **Latent gap:** activation (`auth.py:230-387`) does **NOT** propagate `access_codes.cohort_id →
  students.cohort_id` — a user who activates a direct (cohort) code is **not enrolled in that cohort**.
  And there is **no endpoint to set a student's `cohort_id`** (`admin_students.py` `UpdateStudentRequest`
  has no `cohort_id`).

### What 17.3 needs
Cohort management UI (list/create/edit exist in backend; add member view) + a **student↔cohort
assignment endpoint** (`PATCH /admin/students/{id}` add `cohort_id`, or a dedicated assign route)
+ **fix activation** to enroll direct-code users into their code's cohort (or decide membership is
admin-assigned only). The student↔cohort primitive is exactly what Direction E's cohort-transfer needs.

---

## Section 5 — Direction D: Foot traffic — tool verdict

### Current state (the commission's Vercel assumption is wrong)
- **Frontend deploys to GitHub Pages**, not Vercel (`.github/workflows/deploy-frontend.yml` →
  `actions/deploy-pages@v4`). `frontend/vercel.json` is **legacy/unused** (rewrites only; a stale
  Vercel domain lingers in backend CORS `main.py`). → **Vercel Analytics / Speed Insights is not
  available.** Backend = Railway (nixpacks).
- **No third-party analytics anywhere** — grep for gtag/google-analytics/Vercel/Plausible/PostHog/
  Mixpanel across all `.html`/`.js` = zero hits.
- **Custom telemetry already exists and is production-ready:** `analytics_events` (migration `018`:
  `event_name, event_data jsonb, session_id, created_at` — **no `user_id`**) + `POST /api/analytics/events`
  (`analytics.py:31-44`, fire-and-forget, never blocks). But only **2 event types** are emitted today
  (`pronunciation_drilldown_view`, `vocab_wiki_viewed`). **No page-view, no session-init, no visit
  logging.** Existing admin "analytics" pages are feature-specific (grammar, listening), not site traffic.

### Verdict: **FEASIBLE via custom-telemetry reuse — recommended ($0, no vendor)**
Build page-view/visit tracking on the **existing** `analytics_events` infra:
1. add `user_id` column (non-breaking migration `080`);
2. emit a `page_view` event on each page load (a tiny shared snippet; GitHub Pages = static multi-page,
   so it's a per-page `DOMContentLoaded` beacon, not SPA-router hooks);
3. an admin traffic dashboard (daily active users, views per page, simple funnel) reading aggregates.
Scope: **(f1)→(f2) basic-to-intermediate.** Advanced funnels/real-time deferred. Third-party
(Plausible/PostHog) remains a later option but is unnecessary and adds cost/vendor — not recommended now.

---

## Section 6 — Direction E: Code reassignment / refill / transfer

### Current state
- **Exists:** `DELETE /admin/access-codes/{id}/users/{user_id}` (deactivate assignment, sets
  `is_active=false`, never clears `used_by` — `admin.py:1143-1171`); `DELETE /{id}` (soft-revoke
  code); `DELETE /{id}/remove` (hard delete, blocked if active assignments).
- **Missing:** no reassign (A→B), no refill/reset, no cohort transfer, no per-user quota change.
- **Audit gap:** `user_code_assignments` has `assigned_at` only — **no `revoked_at`, `assigned_by`,
  or `reason`.**
- **Hard constraint:** `is_used`/`used_by`/`used_at` immutable → **"refill" cannot mean reusing the
  same code** by clearing used flags.

### What 17.5 needs (semantics resolved)
- **Refill** = extend the code's quota: bump `session_limit` / `expires_at` (already PATCHable —
  `admin.py:953`), OR issue a **new** code to the same user (account + history preserved via
  `user_code_assignments`). Not "un-use" a code.
- **Reassign / cohort transfer** = a new active `user_code_assignment` (+ Direction C's
  `students.cohort_id` mutation), leaving the immutable activation history intact.
- **Audit:** migration to add `revoked_at` / `assigned_by` / `reason` to `user_code_assignments`.
- **Wire into A (codes UI action buttons) + C (cohort "transfer member")** — see Section 8.

---

## Section 7 — Sprint sequence + LOC (Andy A→B→C→D→E)

| Sprint | Direction | Scope | LOC (empirical) | Migration? |
|---|---|---|---|---|
| **17.1** | A — codes UI | render `assigned_users.email` (API has it) + search/sort (server-side) + **new** quota-remaining compute | **300-450** | maybe (none if reuse) |
| **17.2** | B — usage log | per-user/per-code activity endpoint (sessions+ai_usage rollup) + UI (replace placeholder) | **350-550** | optional (`sessions.code_id`?) |
| **17.3** | C — cohort | management UI + student↔cohort assign endpoint + activation cohort-enroll fix | **400-600** | maybe |
| **17.4** | D — foot traffic | `analytics_events.user_id` (mig `080`) + page_view beacon + admin traffic dashboard | **300-500** | yes (`080`) |
| **17.5** | E — reassignment | refill (quota bump / new code) + audit cols migration + wire A/C UIs | **300-450** | yes (audit cols) |

**Cluster total: ~1650-2550 LOC across 5 sprints** — close to the mind estimate (~1600-2800).

---

## Section 8 — Cross-direction dependencies

- **A ⇄ E:** the codes UI (A) is where E's reassign/refill action buttons live. A already shows
  `assigned_users[].removable`; E adds reassign/refill per row. Build A first (E extends it).
- **C → E:** E's cohort-transfer = C's "set student cohort_id" primitive. C must ship the
  student↔cohort mutation before E's transfer can work. (Andy's A→…→C→…→E order is compatible.)
- **B ← E (light):** if E adds an audit trail, the usage log (B) can surface reassignment events.
  Not blocking — independent build order.
- **D:** independent. Reuses the `analytics_events` infra (shared conceptual lineage with B's
  telemetry sources, but no code coupling).
- **Activation fix (C)** is a prerequisite for cohort-based features being meaningful across A/E.

---

## Section 9 — Risks per direction

- **A:** server-side search/sort + quota-remaining adds a session-count aggregation; verify it
  doesn't N+1 across codes. Quota semantics (per-user vs per-code) need a decision (no `sessions.code_id`).
- **B:** scope ambiguity (per-user vs per-code vs system-wide) — biggest unknown; flag for Andy before 17.2.
- **C:** the activation cohort-enroll fix changes onboarding behavior for existing direct codes —
  needs a backfill decision for already-activated users.
- **D:** GitHub Pages is multi-page static → page_view beacon per page (no SPA router); `analytics_events`
  lacks `user_id` (migration). Volume/retention of the events table (cost) — keep it lightweight.
- **E:** immutability constraint means refill ≠ code reuse; get Andy's confirmation on refill semantics
  (quota bump vs new code). Audit-column migration.
- **Auth:** all admin endpoints must keep the existing admin-scope guard (mind blind to exact guard —
  17.1 must verify `require_admin`/role check pattern in `admin.py`).
- **Sprint 16.4 go-live runs in parallel** — attention split; 17.0 is Discovery only, no deploys.

---

## Section 10 — Sprint 17.1 commission preview (Activation-codes UI — first feature sprint)

**Goal:** make the codes admin show *who holds each code* and *how much quota is left*, with search/sort.

**Likely files:** `frontend/js/admin-access-codes.js` + `pages/admin/access-codes/index.html`
(render `assigned_users[].email`, add search box + sortable headers); `backend/routers/admin.py`
(`GET /admin/access-codes` → add `search`/`sort`/pagination params like `GET /sessions`; add a
quota-remaining field per assigned user). Possibly a small aggregation in a service.

**Acceptance:**
1. Each code row lists its assigned account(s) by email (data already in the API — render it).
2. Search by code or email + sort by created/expiry/status (server-side; keep `association_lookup_failed`
   → "⚠ lookup failed" per CLAUDE.md, never `—`).
3. Quota remaining shown per assigned user (sessions used vs `session_limit`, or vs the daily cap if
   `session_limit` is NULL) — **resolve per-user vs per-code counting with Andy** (no `sessions.code_id`).
4. Verify the admin-scope auth guard is applied; no regression to the canonical-ownership transform
   (`detailToTableShape`, fallback synthesis on no-active-rows — CLAUDE.md).
5. No change to the immutable `used_by`/`used_at`/`is_used` fields.

**LOC:** 300-450. **Out of scope:** reassignment (17.5), usage log (17.2).

---

## Section 11 — Pattern #42 spec-error ledger

**4 material corrections + 1 latent-gap discovery.** Commissions are AI-drafted hypotheses; code is authoritative.

| # | Impact | Commission assumption | Empirical reality |
|---|---|---|---|
| 1 | **HIGH** | Dir D: "Vercel Analytics likely suffices"; check `vercel.json` | Frontend is on **GitHub Pages** (`deploy-frontend.yml`), NOT Vercel. `vercel.json` is legacy/unused → **Vercel Analytics N/A.** Use the existing custom `analytics_events` + `/api/analytics/events` infra. |
| 2 | **MEDIUM** | Dir A: code→account mapping is missing, needs building | `GET /admin/access-codes` **already returns `assigned_users[]` with email** (`admin.py:884-901`). The gap is the **frontend not rendering it**. Quota-remaining IS genuinely missing (new compute). |
| 3 | **MEDIUM** | Dir E: "refill" = reset a code for reuse (implied) | `is_used`/`used_by`/`used_at` are **immutable** (`auth.py:321-325`, enforced). Refill must be a **quota bump or new code**, never clearing used flags. |
| 4 | LOW | PF-2: `frontend/pages/admin*.html` (single admin page) | Admin is **multi-page** (`pages/admin/<feature>/index.html` + `admin-*.js` + `aver-admin-chrome.js`); legacy `admin.html` also exists. |
| 5 | discovery | Dir C: "complete the partial cohort feature" | Beyond the missing UI: **activation does not enroll direct-code users into their code's cohort** (`auth.py` never writes `students.cohort_id`) — a latent correctness gap 17.3 must address, plus there's no student↔cohort mutation endpoint at all. |

**Non-error notes:** Dir B's "partial" = a pure placeholder UI + a complete-but-unrelated AI-cost dashboard; no per-code activity endpoint and no `sessions.code_id` link exist. `analytics_events` lacks a `user_id` column (Dir B + D).

---

## Appendix — acceptance self-check (commission §VI)
✅ 5 directions empirically scoped w/ file:line · ✅ access_codes schema documented · ✅ B+C "partial"
gaps identified · ✅ D existing-tools inventory + verdict (custom telemetry, not Vercel) · ✅ E schema
impact + immutability constraint · ✅ cross-direction deps mapped · ✅ sprint sequence + LOC ·
✅ 17.1 preview · ✅ Pattern #42 ledger · ✅ doc ≤ 800 LOC.

**Escalations for Andy:** (1) Dir B usage-log scope — per-user vs per-code vs system-wide? (2) Dir A
quota counting — per-user lifetime vs per-code (no `sessions.code_id` today)? (3) Dir C — backfill
cohort enrollment for already-activated direct-code users? (4) Dir E — confirm refill = quota-bump /
new-code (codes can't be "un-used").
