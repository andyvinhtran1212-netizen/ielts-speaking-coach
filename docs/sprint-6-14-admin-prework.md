# Sprint 6.14 — Admin cluster pre-work + scope proposal

**Status:** Pre-work only sprint. NO implementation. Andy decides scope below before Sprint 6.14a is drafted.
**Date:** 2026-05-11
**Foundation skill:** `frontend-design` (read before this doc)

---

## 1. Admin pages inventory matrix

| # | Page | Path | Lines | KB | Era / Font | Inline `<style>` | Inline `<script>` | Forms | Tables | Inputs | Textareas | Selects | IDs | data-attrs | Permission gate | `ds.css` linked | Precedent | Effort |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `admin.html` | `frontend/admin.html` | **3,667** | **183 KB** | Era A + legacy navy `#0a1628` + Inter + Tailwind | 1 block (433 lines, L25–L458) | 6 | 0 (uses inline JS handlers) | 8 | 39 | 3 | 7 | **186** | 4 | inline JS gate (own bootstrap, not WC) | **Yes** (only admin page that does) | **None** — 10-tab monolith, first-of-kind | **25–35h** |
| 2 | `admin-writing.html` | `frontend/pages/admin-writing.html` | 74 | 4 KB | Era A header `#0C2340` + legacy navy body + Inter | 1 (5 rules) | 5 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | `WC.bootstrap()` | No | `home.html` mini hub | **1–2h** |
| 3 | `admin-writing-new.html` | `frontend/pages/admin-writing-new.html` | 250 | 13 KB | Era A header + legacy navy + Inter | 1 | 5 | 1 | 0 | 7 | 2 | 4 | 14 | 0 | `WC.bootstrap()` | No | `profile.html` linear form | **3–4h** |
| 4 | `admin-writing-status.html` | `frontend/pages/admin-writing-status.html` | 183 | 9 KB | Era A header + legacy navy + Inter | 1 | 5 | 0 | 0 | 0 | 0 | 0 | 13 | 0 | `WC.bootstrap()` | No | `writing-result.html` (small status panel) | **2–3h** |
| 5 | `admin-writing-prompts.html` | `frontend/pages/admin-writing-prompts.html` | 465 | 22 KB | legacy navy + Inter | 1 | 4 | 0 (inline JS handlers) | 0 | 5 | 1 | 4 | 30 | 4 | `WC.bootstrap()` | No | `profile.html` form + list-edit pattern | **5–6h** |
| 6 | `admin-writing-assignments.html` | `frontend/pages/admin-writing-assignments.html` | 470 | 22 KB | legacy navy + Inter | 1 | 4 | 0 | 0 | 5 | 1 | 2 | 25 | 1 | `WC.bootstrap()` | No | `my-vocabulary.html` filter-list | **5–6h** |
| 7 | `admin-instructor-queue.html` | `frontend/pages/admin-instructor-queue.html` | 378 | 17 KB | Era A header + legacy navy + Inter | 1 | 5 | 0 | 1 | 0 | 0 | 0 | 8 | 7 | `WC.bootstrap()` | No | `writing-dashboard.html` (table + status pills) | **4–5h** |
| 8 | `admin-students.html` | `frontend/pages/admin-students.html` | 449 | 22 KB | Era A header + legacy navy + Inter | 1 | 5 | 1 | 1 | 7 | 1 | 0 | 36 | 10 | `WC.bootstrap()` | No | `my-vocabulary.html` + `profile.html` (list + edit) | **6–7h** |
| 9 | `admin-writing-grade.html` | `frontend/pages/admin-writing-grade.html` | **2,113** | **105 KB** | legacy navy + tier-* badges + Inter + 3-col shell | 1 block (massive, governs entire layout) | 5 | 0 | 0 | 0 | **15** | 0 | **72** | **98** | `WC.bootstrap()` + own state machine | No | **None** — instructor grading interface, 15 textareas, tier badges, instructor review panel | **18–25h** |

**Total cluster:** 9 pages · ~8,050 lines · ~398 KB HTML.

**Era detection note:** No admin page uses Plus Jakarta Sans, Manrope, or Fraunces. All use Inter + Tailwind CDN. The "Era A header `#0C2340`" cells reflect a small Era A-style nav band sitting on top of a legacy `#0a1628` body — not full Era A adoption. None of the 9 pages have `body.av-page` or link `aver-design/` foundation.

**Sprint 6.8 finding (verified):** No admin page links `writing-renderers.css`. `admin-writing-grade.html` has its own 433+ lines of inline CSS for the grading-form chrome. **Implication:** During admin-writing-grade migration, the inline CSS goes into a new `frontend/css/admin-writing-grade.css` (or shared `frontend/css/admin-writing.css` covering 7 sub-pages). `writing-renderers.css` stays writing-result-only.

---

## 2. CRUD operation patterns per page

### `admin.html` (10-tab monolith)
Each of these 10 tabs is essentially its own admin page bundled into one route. Switching is handled by `switchTab(<key>)`:
- **Topics** — list + create + edit + delete + bulk-delete + generate questions + rotate questions + bulk-generate-questions + bulk-rotate-questions
- **Access Codes** — list + generate + revoke + extend + assign-users + remove-users
- **Users** — list + filter by role/status
- **Usage Stats** — read-only dashboard
- **AI Cost** — read-only aggregations (`/admin/ai-usage`)
- **Sessions** — list + open detail + regrade
- **Alerts** — list + dismiss
- **Vocab** — read + flag operations
- **Vocab Exercises** — admin views
- **Flashcards** — stats (via `admin-flashcard-stats.js`)

### `admin-writing.html` (hub)
- Read: `WC.bootstrap()` → `/auth/me` admin check
- No data display; routes to 4 child pages

### `admin-writing-new.html`
- Create: paste essay → POST `/admin/writing/essays` (AI grades)
- Read: prompt list for selection
- Workflow: select prompt → paste essay → submit → redirect to grade view

### `admin-writing-status.html`
- Read: list essays + statuses (`/admin/writing/essays`)
- No mutations on this page

### `admin-writing-prompts.html`
- Read: GET `/admin/writing/prompts`
- Create: POST `/admin/writing/prompts`
- Update: PATCH `/admin/writing/prompts/{id}` (versioning critical — Sprint 2.6.2 anti-fabrication tuning)
- Delete: DELETE `/admin/writing/prompts/{id}`
- Special: prompt-clone endpoint (lines 151–204 in admin_writing_prompts.py)

### `admin-writing-assignments.html`
- Read: GET `/admin/writing/assignments` (filterable)
- Create: POST `/admin/writing/assignments` (single OR bulk)
- Update: PATCH `/admin/writing/assignments/{id}`
- Delete: DELETE `/admin/writing/assignments/{id}` (only when status='pending')

### `admin-instructor-queue.html`
- Read: GET `/admin/instructor/queue`
- Update: POST `/admin/instructor/reviews/{id}/claim` (atomic, 409 on conflict)
- Update: POST `/admin/instructor/reviews/{id}/release` (only own claim, 403 on non-owner)
- Update: POST `/admin/instructor/reviews/{id}/deliver` (mark delivered + mirror note)

### `admin-students.html`
- Read: GET `/admin/students` + GET `/admin/students/{id}`
- Create: POST `/admin/students` (single) + POST `/admin/students/import` (bulk)
- Update: PATCH `/admin/students/{id}`
- Delete: DELETE `/admin/students/{id}` (returns 204)

### `admin-writing-grade.html`
- Read: GET `/admin/writing/essays/{id}` + render + export.docx
- Update: PATCH `/admin/writing/essays/{id}/feedback` (4-criterion + comments)
- Update: PATCH `/admin/writing/essays/{id}/instructor-note`
- Update: POST `/admin/writing/essays/{id}/regrade` (202 accepted)
- Update: POST `/admin/writing/essays/{id}/mark-delivered`
- Delete: DELETE `/admin/writing/essays/{id}` (204)
- Workflow: pick essay → 15-textarea grading form → submit → next essay (or deliver)

---

## 3. Backend admin endpoint inventory (DO NOT TOUCH)

| Router file | Lines | Endpoints | URL prefix | Auth pattern |
|---|---|---|---|---|
| `admin.py` | 2,858 | **36** (users, codes, topics × full CRUD, sessions, alerts, regrade, vocab, flashcards) | `/admin/*` | inline `await require_admin(authorization)` |
| `admin_writing.py` | 677 | **13** (essays CRUD + grading + delivery + regrade + render + export.docx + stats + students summary) | `/admin/writing/*` | inline `await require_admin(authorization)` |
| `admin_writing_assignments.py` | 396 | **5** (list / create-single-or-bulk / get / patch / delete) | `/admin/writing/assignments/*` | inline `await require_admin(authorization)` |
| `admin_writing_prompts.py` | 306 | **7** (list / create / clone-version / get / patch / delete) | `/admin/writing/prompts/*` | inline `await require_admin(authorization)` |
| `admin_students.py` | 123 | **6** (create / import / list / get / patch / delete) | `/admin/students/*` | inline `await require_admin(authorization)` |
| `admin_instructor.py` | 148 | **4** (queue / claim / release / deliver) | `/admin/instructor/*` | inline `await require_admin(authorization)` |

**Total: 71 admin endpoints across 6 routers (4,508 lines of backend code).**

**Auth pattern is uniform:** every endpoint imports `require_admin` from `routers.admin` and calls it inline at function entry. **Migration must not touch any of this.**

`require_admin` is defined in `routers/admin.py` and gates on `users.role === 'admin'` (the same `me.role` check that `WC.bootstrap()` mirrors in the frontend).

---

## 4. Frontend permission gating pattern

**Two distinct frontend gate patterns coexist:**

### Pattern A — `WC.bootstrap()` (7 of 9 admin pages)
Used by: `admin-writing.html`, `admin-writing-new.html`, `admin-writing-status.html`, `admin-writing-prompts.html`, `admin-writing-assignments.html`, `admin-instructor-queue.html`, `admin-students.html`, `admin-writing-grade.html`.

Defined in `frontend/js/writing-admin.js` (100 lines). Surface:
```js
window.WC = {
  bootstrap: bootstrap,             // init Supabase + verify admin + reveal #state-ready
  requestNotifyPermission,
  notify,
  escapeHtml,
  debounce,
};
```

Markup contract every page must preserve byte-identical:
- `<div id="state-loading">` — initial spinner
- `<div id="state-denied" class="hidden">` — non-admin landed
- `<div id="state-ready" class="hidden">` — admin verified, app renders
- `<span id="header-email">` — populated with `me.email` after bootstrap

**JS preservation rule for Sprint 6.14a/b/c:** All four IDs above stay byte-identical. `WC.bootstrap()` call stays. Migration changes only the visual chrome around them.

### Pattern B — own inline bootstrap (`admin.html`)
The 3,667-line monolith has its own auth bootstrap (does not call `WC.bootstrap()`). Lives inside the inline `<script>` block. **Migration must not refactor this bootstrap** — `admin.html` is its own world.

### Backend gate (unchanged)
All admin endpoints call `await require_admin(authorization)` inline. Migration never touches this.

---

## 5. Shared infrastructure (the WC.bootstrap cluster)

7 sub-pages share:
- `https://cdn.tailwindcss.com` (Tailwind CDN)
- `Inter` font from Google Fonts
- `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`
- `/js/api.js`
- `/js/writing-admin.js` (100 lines, exports `window.WC`)

None link:
- `frontend/css/ds.css`
- `frontend/css/aver-design/tokens.css` or `components.css`
- `body.av-page` opt-in

**Implication:** Migration adds the Aver Design System foundation to all 7 sub-pages in one shot per page. No ds.css override pattern needed (no Phase 1 ds.css coupling on these pages — green-field token adoption).

---

## 6. Tab structure: `admin.html` (10 tabs in one file)

```
Topics    Access Codes    Users    Usage Stats    AI Cost
Sessions    Alerts    Vocab    Vocab Exercises    Flashcards
```

Each tab is essentially a sub-page with its own data fetching, render, and mutation handlers — bundled into a single HTML via `switchTab(<key>)`. Tab buttons emit `onclick="switchTab('<key>')"` (11 occurrences).

**Migration risk:** Refactoring this into 10 separate pages is out of scope for a visual migration. Sprint 6.14d must migrate `admin.html` **in place** (preserving the 10-tab single-page structure) OR enter its own pre-work mini-sprint to scope a decomposition.

---

## 7. Existing test coverage

```
$ grep -rln admin frontend/tests/
frontend/tests/sprint-6-12c-audit-closure.test.mjs   # only matches "admin" as substring
frontend/tests/typography-tier1.test.js              # not admin-specific
```

**There are no admin-page-specific test files in the suite.** Migration sprints must establish baseline test pins (Phase 1-3 pattern: ~80–150 pins per page).

---

## 8. Phase 1–3 / Phase 4 precedent mapping

| Pattern from earlier sprint | Admin pages that match this pattern |
|---|---|
| `home.html` mini hub (Sprint 6.3) | `admin-writing.html` |
| `profile.html` linear form (Sprint 6.12a) | `admin-writing-new.html`, `admin-writing-prompts.html` |
| `writing-dashboard.html` table + filters + status pills (Sprint 6.7) | `admin-instructor-queue.html`, `admin-writing-status.html` |
| `my-vocabulary.html` filter list + export (Sprint 6.11a) | `admin-writing-assignments.html`, `admin-students.html` |
| **No precedent — first of its kind** | `admin-writing-grade.html` (instructor grading interface), `admin.html` (10-tab monolith) |

The 7 sub-pages all sit within a 100–500-line band that maps cleanly to existing precedents. **Migration is mostly pattern reuse for the cluster except for the two outliers.**

---

## 9. Spec deviations (vs sprint prompt)

| Sprint prompt assumed | Pre-work found | Resolution |
|---|---|---|
| `admin-dashboard.html` exists | No such file. `admin.html` is the root admin hub instead. | Use `admin.html` as the admin-home. |
| `admin-codes.html` exists | No such file. Access-code management lives inside `admin.html`'s "Access Codes" tab. | Roll into `admin.html` migration sprint (6.14d). |
| `admin-prompts.html` exists | File is named `admin-writing-prompts.html`. | Use actual file name. |
| `admin-assignments.html` exists | File is named `admin-writing-assignments.html`. | Use actual file name. |
| Pre-launch redirects might exist (Risk #10) | `grep` shows `window.location.replace` / `.href =` in 5 pages but they are post-load redirects (e.g., redirect-after-submit or denied-state redirect to home), not pre-launch hide redirects like pricing.html. | No pricing-style pre-launch redirect — no need for the Sprint 6.13b redirect-preserve pattern. |
| URL-prefix routing (Risk #6) | All admin frontend is file-based. `/admin/*` is backend-only. Cross-links use `/admin.html` + `/pages/admin-*.html`. | Migration preserves file-based routing byte-identical. |
| `admin-writing-grade.html` parallels `writing-result.html` (Sprint 6.8 finding) | Grade page does NOT link `writing-renderers.css`. It has its own 433+ lines of inline CSS governing a 3-column shell + 15-textarea grading form + instructor review panel + tier badges. | `writing-renderers.css` stays writing-result-only. Grade page gets its own new CSS file (or merges into a shared `admin-writing.css` covering 7 sub-pages). |

---

## 10. Scope proposal — three options

### Option A — Single batch (one giant PR)

**Effort:** ~75–100h (all 9 pages in one PR).

❌ **Not recommended.** Single review session is impossible. Single-regression blast radius covers all admin functionality. Cumulative-lesson "don't ship a 50-line diff with a vague summary" rule says no.

---

### Option B — Serial (1 page per sprint)

**Effort:** ~65–90h spread across 9 sprints.

Pros: Smallest per-PR risk, mature audit cycle per page.
Cons: Cluster closure spans months; admin-writing.html (1–2h) doesn't warrant its own sprint overhead.

---

### Option C — Logical grouping (RECOMMENDED, 4 sprints)

Group by shared infrastructure (`WC.bootstrap()` contract) and complexity tier.

| Sprint | Pages | Total effort | Rationale |
|---|---|---|---|
| **6.14a** — Writing admin small cluster | `admin-writing.html` + `admin-writing-new.html` + `admin-writing-status.html` + `admin-writing-prompts.html` | **11–15h** | All share `WC.bootstrap()`. Form-flavored work (1 hub + 1 paste-essay form + 1 status panel + 1 prompts CRUD). Establishes the `admin-writing.css` shared stylesheet that the rest of 6.14b/c reuse. |
| **6.14b** — Writing admin tables | `admin-writing-assignments.html` + `admin-students.html` | **11–13h** | Both share my-vocabulary precedent (table + filters + form). Pattern reuse within group. |
| **6.14c** — Instructor queue + grading | `admin-instructor-queue.html` + `admin-writing-grade.html` | **22–30h** | Queue is writing-dashboard pattern (4–5h, easy). Grading page is **first-of-kind**; recommend a 30-minute pre-work mini-sprint **inside 6.14c** before touching admin-writing-grade.html to plan the 3-col shell + 15-textarea form + instructor panel + tier-badge mapping. |
| **6.14d** — admin.html monolith | `admin.html` | **25–35h** OR **defer** | 3,667 lines, 10 tabs, 186 IDs, 8 tables. Recommend **its own pre-work mini-sprint** before scope decision: in-place visual migration vs tab-decomposition into 10 child pages. Andy may choose to defer 6.14d to Phase 6+ if monolith risk profile is too high for current bandwidth. |

**Total Option C: 69–93h across 4 sprints.** Each sprint produces a reviewable PR (~10–25h work, ~80–150 test pins per page). Andy gets 4 decision points to pause or re-scope.

---

## 11. Code's recommendation

**Option C, with these specifics:**

1. **Sprint 6.14a first** — opens the WC.bootstrap() cluster, establishes shared CSS, validates the migration pattern on the lowest-risk pages.
2. **Sprint 6.14b second** — table pages with mature precedent (my-vocabulary). Pattern reuse keeps cognitive load low.
3. **Sprint 6.14c third** — `admin-instructor-queue.html` first (warmup), then `admin-writing-grade.html`. Inside 6.14c, before touching grade page, do a 30-minute mini pre-work to decompose the 3-col shell, the 15-textarea form, the instructor review panel (Sprint 2.7d.2), and the tier badges into named CSS regions.
4. **Sprint 6.14d** — Andy decides between (a) ship as 25–35h sprint with full audit, or (b) defer to Phase 6+. Either way, do a dedicated pre-work mini-sprint **before** 6.14d implementation; the 10-tab monolith is too large to plan inline.

**Rationale:**
- `WC.bootstrap()` shared contract = natural grouping boundary (Sprints 6.14a/b/c).
- `admin-writing-grade.html` (2,113 lines, 72 IDs, 98 data-attrs, 15 textareas) deserves a dedicated half-sprint pre-work.
- `admin.html` (3,667 lines, 186 IDs, 10 tabs) is in a class of its own — defer the decomposition-vs-in-place decision to its own pre-work.
- Andy gets 4 decision points; if Sprint 6.14a reveals pattern breakage, plan re-scopes before 6.14b lands.

---

## 12. What gets implemented in Sprint 6.14a (post-Andy-decision)

If Andy approves Option C → Sprint 6.14a:

**Scope:**
- `admin-writing.html` (hub, 74 lines)
- `admin-writing-new.html` (paste-essay form, 250 lines)
- `admin-writing-status.html` (status panel, 183 lines)
- `admin-writing-prompts.html` (prompts CRUD, 465 lines)

**Deliverables:**
- New `frontend/css/admin-writing.css` (shared rules: nav band, auth states `#state-loading`/`#state-denied`/`#state-ready`, card grid, status pills, form chrome, table chrome — provisional for 6.14b/c reuse)
- 4 migrated HTML files (Inter → Plus Jakarta Sans + JetBrains Mono; legacy navy → `--av-*` tokens; `ds.css` not linked anywhere in the cluster)
- 4 test files (`admin-writing-redesign.test.mjs`, `admin-writing-new-redesign.test.mjs`, `admin-writing-status-redesign.test.mjs`, `admin-writing-prompts-redesign.test.mjs`)
- `anti-flash-iife-canonical.test.mjs` REDESIGNED_PAGES extended
- `theme-toggle-icon-canonical.test.mjs` REDESIGNED_PAGES extended
- `DESIGN_SYSTEM.md` § 14.1 + § 14.2 updates

**JS contract preserved byte-identical:**
- All 4 pages keep calling `WC.bootstrap()` exactly as today
- `#state-loading`, `#state-denied`, `#state-ready`, `#header-email` IDs unchanged
- Per-page extra IDs (14 / 13 / 30 / 4) unchanged
- All onclick handlers and inline JS unchanged

**Not in scope for 6.14a:** `admin-writing-assignments.html`, `admin-students.html`, `admin-instructor-queue.html`, `admin-writing-grade.html`, `admin.html`.

---

## 13. Pre-work acceptance criteria (this sprint)

- [x] All admin pages enumerated with file paths + sizes (9 pages, ~8,050 lines)
- [x] Era detection per page documented (all Inter + legacy navy + Era A header band, none migrated)
- [x] CRUD operation patterns per page documented (§ 2)
- [x] Form patterns inventoried (counts in matrix § 1)
- [x] Table patterns inventoried (counts in matrix § 1)
- [x] Bulk action patterns documented (admin.html: topics bulk-delete + bulk-generate-questions + bulk-rotate-questions; admin_writing_assignments: bulk create; admin_students: bulk import)
- [x] Admin permission gating patterns documented (§ 4 — two distinct patterns: WC.bootstrap vs own inline bootstrap)
- [x] Backend admin endpoints inventoried (§ 3 — 71 endpoints, 6 routers, 4,508 lines)
- [x] JS-coupled selectors documented per page (IDs + data-attrs in § 1 matrix; shared `#state-*` contract in § 4)
- [x] `writing-renderers.css` coupling for admin-writing-grade verified (§ 9 — does NOT link it; Sprint 6.8 finding confirmed)
- [x] Phase 1-3 precedent matching documented (§ 8)
- [x] Scope proposal generated (Options A/B/C with rationale, § 10)
- [x] Code recommendation stated with supporting evidence (§ 11 — Option C)

---

## 14. Anti-patterns avoided

- ✅ **Pre-work first, decision after** — no scope pre-commitment; recommendation surfaced with evidence, Andy decides.
- ✅ **No production code touched** — only this markdown added.
- ✅ **No test changes** — admin pages have no test coverage today; new pins land per implementation sprint.
- ✅ **No backend changes** — admin routers documented as untouched.
- ✅ **Spec deviations documented** (§ 9) — false admin-dashboard / admin-codes / admin-prompts assumptions corrected; pricing-style pre-launch redirect risk falsified; URL-prefix routing risk falsified.
- ✅ **L3 / L4 cumulative lessons applied** — single root cause documented per finding; spec deviations called out explicitly.
