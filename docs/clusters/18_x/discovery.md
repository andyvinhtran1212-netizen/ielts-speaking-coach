# Sprint 18.0 — ADMIN-PANEL-REFINEMENT Discovery

**Cluster:** 18.x ADMIN-PANEL-REFINEMENT
**Type:** Discovery (lightweight, 3-direction — no feature code)
**Date:** 2026-05-26
**Base:** `main` @ `23fc9199` (cluster 17.x feature-complete, #291-#296 merged; latest migration 081)
**Author:** Code (autonomous), commission as hypothesis (Pattern #42), Pattern #43 active

> **Read Section 9 first if you wrote the commission.** Headlines: (A) the 17.3
> students-roster fault line recurs — "convert user→student" + "student dropdown"
> conflate two distinct concepts; (B) "Phút chấm" exists (`responses.duration_seconds`)
> but NO 6-metric dashboard endpoint exists today, so B builds new (it doesn't merge);
> (C) verdict = **medium refactor (r2)** — four duplicated per-page table/modal/button
> style sets, no shared admin component CSS.

Admin = multi-page (`frontend/pages/admin/<feature>/index.html` + `frontend/js/admin-*.js`
+ nav `aver-admin-chrome.js`). All 13 admin pages link **`aver-design/tokens.css`** (av-* tokens);
**zero** link `ds.css` (that's the student-pages system). Latest migration 081 → next is **082**.

---

## Section 1 — Empirical motivation

Andy (2026-05-26, post cluster-17.x, with screenshots). 7 directives → 3 directions:
**A (IA):** merge "Học viên" into a tabbed "Lớp/Cohort" area (tabs: Học viên + Quản lý lớp học);
add "Convert thành học viên" on the "Tất cả người dùng" page; replace the UUID-input add-to-class
with a **dropdown**. **B (Dashboard):** merge "Hệ thống"(AI usage) + "Usage log" + "Lưu lượng" into
one dashboard with 6 metrics. **C (UI):** audit + refactor the 6 admin pages. Sequence A→B→C, Code-
authoritative UI (u1).

---

## Section 2 — Direction A: Information-Architecture restructure

### Current state (file:line)
- **Nav** (`aver-admin-chrome.js`): "Người dùng" group = `students` (Học viên, L403), `users` (Tất cả
  người dùng, L404), `cohorts` (Lớp/Cohort, L405). "Truy cập" = access-codes/usage/foot-traffic
  (L411-413). No Phase-B placeholders (`PHASE_B_SECTIONS = new Set([])`, L55).
- **Học viên** (`pages/admin/students/index.html`): flat list, **no tabs**, JS **inline** (no
  `admin-students.js`). Cols: Code / Name / Target / Current / Date / Actions (Tổng quan, New Essay,
  Edit, Delete). Endpoints `GET/POST/PATCH/DELETE /admin/students` (`admin_students.py`).
- **Tất cả người dùng** (`pages/admin/users/index.html` + `admin-users.js`): list + inline role
  dropdown only. `GET /admin/users` (admin.py:643), `PATCH /admin/users/{id}/role`. **No convert-to-student.**
- **Lớp/Cohort** (`pages/admin/cohorts/index.html` + `admin-cohorts.js`): list view + detail
  (`?cohort_id`), **no tabs**. **Add-member = UUID text input** (`#am-user`, cohorts/index.html). Member
  roster is **code-derived** (`cohorts.py:124` `GET /{id}/members`; add `POST /{id}/members` issues a
  code + assigns, 17.5).
- **`students` schema:** writing-coach roster (migration 033). `user_id` is populated **only at
  activation** (`auth.py` Step 6, when an activation code == `students.student_code`). **`POST /admin/students`
  takes NO `user_id`** (`admin_students.py`). `GET /admin/students?search=` exists (dropdown source).

### ⚠️ Architectural finding (escalation A — the 17.3 lesson recurs)
There are **two distinct "student" concepts** the directives conflate:
- **Writing-roster `students`** (the "Học viên" page) — admin-created profiles; `user_id` NULL until
  the person activates a matching code.
- **Cohort members** — **code-derived** users (have a `user_id`, hold an active cohort code).

Consequences:
1. **"Convert user→student"** has **no endpoint**, and `POST /admin/students` can't set `user_id`. A
   convert = create a `students` row with `user_id` = the user's id (skip the activation-link path).
   → 18.1 must **extend `POST /admin/students` to accept `user_id`** (small, no migration —
   `students.user_id` column exists). Edge cases: user already has a students row (409/idempotent);
   user is not student-role.
2. **"Add student to class via dropdown"** — cohort-add needs a `user_id` (to issue/assign a code). A
   writing-roster student **without `user_id`** (not yet activated) **cannot** be code-added. → The
   dropdown should list **users** (or **students that have a `user_id`**) and pass `user_id` to the
   existing code-derived `POST /admin/cohorts/{id}/members`. Recommend: dropdown of users (email +
   name), client-searched, replacing the raw UUID input — no model change.
3. `students.cohort_id` FK exists (migration 060) but is **unused** (membership is code-derived). Do
   NOT activate a second, direct membership path without an explicit decision — it would split the
   source of truth (17.3/17.5 rationale).

### Proposed A architecture (recommended — no schema change, keep code-derived)
A single **"Lớp/Cohort"** page with **tabs**:
- **Quản lý lớp học** = today's cohort list/create/archive + member roster (17.3/17.5, unchanged).
- **Học viên** = the `students` roster (move the current students page in as a tab; keep CRUD).
"Tất cả người dùng" keeps its own nav entry + gains a **"Convert thành học viên"** action (→ extended
`POST /admin/students` with `user_id`). Cohort add-member input → **user dropdown** (`GET /admin/users`,
client-searched), passing `user_id`. Nav: fold `students` into the `cohorts` page (drop the standalone
"Học viên" entry, or keep as a deep-link to the tab).

**Deliverable size:** new endpoint param + 1 tabbed page (merging 2 controllers) + 1 dropdown + 1 convert
button + nav. ~450-700 LOC. **Decision for Andy (18.1):** keep code-derived (recommended) vs activate
`students.cohort_id` (heavier, splits truth).

---

## Section 3 — Direction B: Dashboard consolidation

### Current state
Three separate surfaces, none of which is a 6-metric dashboard:
- **"Hệ thống"** (`pages/admin/system/index.html`) = a nav **hub** (links to AI Usage + Alerts); shows
  no metrics. `system/ai-usage.html` + `admin-ai-usage.js` → **`GET /admin/ai-usage`** which returns
  `{overall:{calls, cost_usd, by_service}, per_user:[…]}` (admin.py:2063, 2151) — **cost only, no
  grading-minutes / user-count / session-count.**
- **"Usage log"** (`usage/index.html` + `admin-usage.js`) → `GET /admin/usage/users` (per-user
  sessions/last_active/ai_cost) + `GET /admin/access-codes/{id}/usage`.
- **"Lưu lượng"** (`foot-traffic/index.html` + `admin-foot-traffic.js`) → `GET /admin/analytics/foot-traffic`
  (total_views / unique_visitors / anonymous_hits / top_pages / daily).

### The 6 metrics — data sources (all confirmed; no missing column)
| Metric | Source (file:line / migration) | Aggregation |
|---|---|---|
| Tổng người dùng | `users` | `count` |
| Mã đã kích hoạt | `user_code_assignments` `is_active=true` | `count` |
| Người xem N ngày | `analytics_events` `event_name='page_view'`, `user_id` (mig 018 + 080) | `count(distinct user_id)` |
| Bài practice | `sessions` | `count` |
| **Phút chấm** | **`responses.duration_seconds`** (mig 010, FLOAT per 011; written `grading.py:360` from Whisper) — also `ai_usage_logs.audio_seconds` (031:30) | `sum(duration_seconds)/60` |
| Chi phí tháng | `ai_usage_logs.cost_usd_est` (031) | `sum` where `created_at` in current calendar month |

**Resolved (escalation B): "Phút chấm" is `responses.duration_seconds`** — exists + populated. Use it
(more complete than `ai_usage_logs.audio_seconds`, which is Whisper-only). **Monthly cost** = calendar
month (`>= start-of-month`), distinct from `/admin/ai-usage`'s all-time/`?days` rolling sum.

### Strategy
A **new** `GET /admin/dashboard/overview` returning all 6 (each a batched single count/sum → ~6 light
queries, no N+1; mirror the 17.2/17.4 batched-aggregation pattern). The existing endpoints don't cover
the set (ai-usage = cost only), so reuse-as-is is insufficient — build the overview. Detail pages
(usage, foot-traffic, ai-usage) **kept** as drill-downs; nav consolidates the 3 entries into one
**"Tổng quan"/Dashboard**. ~300-500 LOC. No migration.

---

## Section 4 — Direction C: UI refactor — verdict **r2 (medium)**

### Evidence (file:line)
Every admin page carries its **own `<style>` block** redefining the same patterns:
access-codes `30-212` (~182 lines), usage `30-70`, foot-traffic `30-83`, cohorts `30-93`, system
`30-67` (students has inline JS+style). Duplicated component classes across pages: **`.ac-table`×7,
`.us-table`×6, `.ft-table`×6, `.co-table`×6** (four near-identical table style sets), `.btn-primary`×4 /
`.btn-secondary`×4 redefined per page, `.ac-modal`/`.co-modal` modal styles duplicated. Tokens are
consistent (`aver-design/tokens.css` av-* on all 13 pages, Pattern #25 themed) — the gap is **component
duplication**, not tokens.

### Verdict: **(r2) medium — extract shared admin components**
Not r1 (tokens are fine) and not r3 (no design-system overhaul needed). Create a shared
**`frontend/css/aver-design/admin-components.css`** with `.adm-table`, `.adm-modal`, `.adm-btn-*`,
`.adm-chip`, `.adm-card`, `.adm-toolbar` (token-driven, both themes, Pattern #26), then migrate the 6
pages to it — collapsing the per-page `<style>` blocks from ~40-180 lines to a thin page-specific
remainder. Pure styling consolidation; behavior unchanged. ~500-800 LOC (net likely flat/negative as
duplication is removed). **Must run AFTER A+B** so it refactors the final page set, not stale pages.

---

## Section 5 — Sprint sequence + LOC

| Sprint | Direction | Scope | LOC (empirical) | Migration |
|---|---|---|---|---|
| **18.1** | A — IA | tabbed Lớp area (Học viên + Quản lý lớp) + `POST /admin/students` accepts `user_id` (convert) + user dropdown for cohort-add + nav merge | **450-700** | none |
| **18.2** | B — Dashboard | new `GET /admin/dashboard/overview` (6 metrics, batched) + new dashboard page + nav consolidation (3 entries → 1) | **300-500** | none |
| **18.3** | C — UI refactor (r2) | shared `aver-design/admin-components.css` + migrate the 6 pages off their per-page `<style>` blocks | **500-800** | none |

**Cluster total: ~1,250-2,000 LOC, 3 sprints, no migrations** (all needed columns exist). Matches the
mind estimate. A split 18.3→18.3.1 only if the migration of 6 pages warrants it.

---

## Section 6 — Cross-direction dependencies
- **A → B:** A changes the "Người dùng" group; B removes 3 "Truy cập"/"Hệ thống" entries — both touch
  `aver-admin-chrome.js`. Sequence A then B to avoid nav merge conflicts.
- **A + B → C:** C's component extraction must consume the **post-A/B** page set (tabbed Lớp page +
  new dashboard), not the current pages — else C re-does work. Hence A→B→C.
- A's cohort-add dropdown reuses `GET /admin/users` (17 era); B's overview reuses the 17.2/17.4 batched
  aggregation patterns. No backend coupling between A and B.

---

## Section 7 — Risks
- **A (architectural):** student-vs-user conflation (Section 2). Mitigation: keep code-derived, extend
  `POST /admin/students` with `user_id`, dropdown lists users. Andy confirms model in 18.1.
- **A convert edge cases:** user already a student (idempotent/409); student without `user_id` not
  code-addable (dropdown gates to users-with-account). Flag.
- **A dropdown scale:** many users → client search needed (mirror 17.1 client filter); paginate if huge.
- **B monthly-cost semantic:** calendar-month vs rolling-30d — Discovery picks **calendar month**
  (confirm). Distinct visitors window (7d/30d) — default 30d, surface a selector.
- **B nav removal:** dropping 3 entries disrupts muscle memory. Mitigation: keep detail pages as
  drill-downs under the new Dashboard; clear labels.
- **C scope creep:** r2 (component extraction) could drift to r3. Mitigation: tokens already fine —
  consolidate components only, no visual redesign; behavior unchanged.
- **Parallel observation:** clusters 16.x (sweep dry-run) + 17.x observation run 2026-05-26→~06-02.
  18.0 is Discovery only; 18.1+ may await observation (Andy decision).

---

## Section 8 — Sprint 18.1 commission preview (A — IA restructure, first feature sprint)
**Goal:** one tabbed "Lớp/Cohort" area (Quản lý lớp học + Học viên tabs), a "Convert thành học viên"
action on the users page, and a user **dropdown** (not UUID) for adding cohort members.
**Likely work:** `backend/routers/admin_students.py` — `POST /admin/students` accepts optional `user_id`
(sets it directly; 409 if the user already has a students row); `frontend/pages/admin/cohorts/index.html`
+ `admin-cohorts.js` — add a tab bar hosting the students roster (fold in `students/index.html`'s inline
logic) + replace `#am-user` UUID input with a searchable user `<select>` fed by `GET /admin/users`;
`frontend/pages/admin/users/index.html` + `admin-users.js` — per-row "Convert thành học viên" → modal →
`POST /admin/students {user_id, student_code, full_name}`; `aver-admin-chrome.js` — fold the `students`
nav entry into `cohorts`.
**Acceptance:** convert creates a `students` row linked to the user (idempotent on re-convert); cohort
add-member uses a user dropdown (no raw UUID); membership stays **code-derived** (no `students.cohort_id`
write); admin-guard reused; no regression to 17.x cohort/member flows. No migration.
**Decision for Andy:** confirm code-derived membership (recommended) vs activating `students.cohort_id`.

---

## Section 9 — Pattern #42 spec-error ledger
| # | Impact | Commission assumption | Empirical reality |
|---|---|---|---|
| 1 | **HIGH (escalation A)** | merge Học viên/convert-user→student/student-dropdown are straightforward IA | The 17.3 fault line recurs: `students` = writing roster (`user_id` set only at activation; `POST /admin/students` takes no `user_id`); cohort membership is **code-derived** (needs `user_id`). Convert needs an endpoint change; the add-to-class dropdown must list **users** (or students-with-user_id), not raw students. Two "student" concepts conflated — clarified in §2. |
| 2 | **MEDIUM** | B = "consolidate" 3 existing dashboards; ai-usage already shows the metrics | `GET /admin/ai-usage` returns **cost + per-user only** (admin.py:2063/2151) — **no 6-metric dashboard exists.** "Hệ thống" is a nav hub, not a metrics page. → B **builds** a new `GET /admin/dashboard/overview`, not a merge. |
| 3 | resolved (escalation B) | "Phút chấm" column unknown / maybe missing | **Exists:** `responses.duration_seconds` (mig 010, FLOAT per 011, written `grading.py:360`); also `ai_usage_logs.audio_seconds` (031). Use `responses.duration_seconds` (`/60`). NOT missing. |
| 4 | LOW | PF-2: "view `admin-students.js`" | No such file — the students page's JS is **inline** in `students/index.html`. (18.1 folds it into the tabbed page.) |
| 5 | LOW | Refactor against `ds.css` design system | Admin pages use **`aver-design/tokens.css`** (av-*), zero use `ds.css` (that's the student pages). C standardizes on aver-design + a new shared `admin-components.css`. |

**Non-error discovery:** the C refactor is clearly **r2** (four duplicated table style sets + per-page
button/modal redefinition; tokens already consistent) — component extraction, not a design overhaul.

---

## Appendix — acceptance self-check (commission §VI)
✅ 3 directions empirically scoped w/ file:line · ✅ A IA proposal (+ architectural finding) · ✅ B
consolidation strategy + 6-metric sources (Phút chấm resolved) · ✅ C scope verdict **r2** per evidence ·
✅ sprint sequence + LOC · ✅ cross-direction deps · ✅ 18.1 preview · ✅ Pattern #42 ledger · ✅ doc ≤ 800 LOC.

**Escalations for Andy:** (1) **A** — confirm cohort membership stays **code-derived** (dropdown lists
users) vs activating `students.cohort_id`; confirm "convert" extends `POST /admin/students` with `user_id`.
(2) **B** — monthly cost = **calendar month** ok? distinct-visitors window default 30d ok? (3) **C** —
r2 component extraction (no visual redesign) ok, or do you want a visual pass too?
