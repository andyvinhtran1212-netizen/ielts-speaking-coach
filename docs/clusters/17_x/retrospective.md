# Cluster 17.x — Retrospective

**Cluster theme:** ADMIN-PANEL-CONSOLIDATION
**Date range:** 2026-05-25 → 2026-05-26 (~2 days real-time)
**Status:** Feature-complete pending observation period
**Total PRs:** 6 (#291-#296)
**Empirical motivation source:** Andy 2026-05-25 — 4 directives raised post cluster 16.x feature-complete

---

## I. Sprint inventory

| Sprint | PR | Type | Direction | LOC prod | Outcome |
|---|---|---|---|---|---|
| 17.0 | #291 | Discovery | — | 254 doc | 4 material + 1 latent errors caught |
| 17.1 | #292 | Feature | A — Codes UI | 144 | Email mapping + quota + search/sort |
| 17.2 | #293 | Feature | B — Usage log | 426 | Per-user + per-code rollup endpoints |
| 17.3 | #294 | Feature | C — Cohort UI | 398 | Code-derived membership pivot |
| 17.4 | #295 | Feature | D — Foot traffic | 362 | Custom telemetry $0 vendor |
| 17.5 | #296 | Feature | E — Reassignment | 378 | Audit migration 081 + cohort mutation |

**Total: ~1,962 LOC production across 6 sprints in ~2 days real-time.**

Average LOC/sprint: ~327. Lower than initial 1,650-2,550 estimate vì Discovery corrections shrank scope effectively.

---

## II. Empirical motivation → outcome

**Source signal (2026-05-25, Andy):**

> "mình muốn nâng cấp phần admin panel tập trung vào phần code... [5 directives]"

**Outcome (2026-05-26 feature-complete):**

| Direction | Andy directive | Shipped state |
|---|---|---|
| A — Codes UI | Hiện email + quota + sort/filter | ✅ `GET /admin/access-codes` enriched, frontend renders, search + sort working |
| B — Usage log | Hoàn tất feature đang dở | ✅ Per-user list + per-code rollup, drill-down from codes UI |
| C — Cohort mgmt | Hoàn tất feature đang dở + activation enrollment | ✅ Code-derived membership, no schema/auth drift |
| D — Foot traffic | Track traffic toàn web | ✅ Custom telemetry beacon + admin dashboard, $0 vendor |
| E — Reassignment | Refill / cohort transfer workflows | ✅ Migration 081 audit + reassign + refill 2 paths + cohort member mutation |

**Pattern #19 (dogfood-as-falsifier):** Andy's 5 empirical directives fully addressed. Each direction shipped with admin-facing UI accessible at production URL.

---

## III. Pattern #42 ledger (commission spec error tally)

| Sprint | Material errors | Minor errors | Highest impact |
|---|---|---|---|
| 17.0 Discovery | 4 material + 1 latent | 0 | Vercel→GitHub Pages inversion (Direction D) |
| 17.1 Codes UI | 1 material | 2 minor | Server-side search/sort speculation, actual load-all-by-design |
| 17.2 Usage log | 1 material recurring | 2 minor | `Depends()` FastAPI pseudocode wrong again |
| 17.3 Cohort UI | 1 CRITICAL architectural | 0 | `students` table = Writing-Coach roster, NOT general user table |
| 17.4 Foot traffic | 0 material | 3 minor + 1 micro | Migration counter drift (081 → actually 080) |
| 17.5 Reassignment | 0 material | 4 minor | Atomic transaction vs safe ordering (Code elevated) |

**Total cluster 17.x: ~20 spec errors honest-logged across 6 sprints. ~3.3/sprint vs cluster baseline ~1.5.**

**Higher error rate analysis:**
- Admin panel domain = unfamiliar territory (5 distinct directions)
- Multi-page architecture vs assumed single `admin.html`
- Latent gaps surfaced empirical (activation cohort-enroll, immutable codes)
- `students` table semantic mismatch (Writing-Coach vs general user) = Discovery scope gap

**Lessons reinforced cluster 17.x:**

1. **Architectural premise check** — Discovery PF should ask "what domain concept does each table model?" not just "what columns exist?" Sprint 17.3 students-table-confusion = highest-impact lesson.

2. **Auth pseudocode discontinued** — Mind kept writing FastAPI `Depends(require_admin)` despite empirical pattern being header-based. Sprint 17.5 commission applied lesson: prose description "per existing pattern reuse", no pseudo-decorator.

3. **Migration counter tracking** — Sprint 17.4 mind specified 081 while reality was 080 (Sprint 17.3 deferred its 080). Lesson: cumulative migration counter requires tracking deferrals.

4. **Frontend/backend concern separation** — Sprint 17.4 auth attribution: mind specified frontend-extraction, Code elevated to backend-side (cleaner). Pattern: separation of concerns wins over coupling.

5. **Sequential ordering > atomic transactions** — Sprint 17.5 Supabase SDK no-transaction reality. Code elevated safe ordering (activate first, deactivate second) over commission's atomic spec. Cleaner solution.

---

## IV. Convention evolution cluster 17.x

| Convention | State pre-17.x | State post-17.x |
|---|---|---|
| Auth pseudocode | Mind wrote `Depends(...)` pseudocode | **Discontinued** — prose only, Code authoritative |
| Migration counter | Single increment from latest shipped | **Deferral-aware** — track gaps, next = highest assigned + 1 |
| `analytics_events` `user_id` | NULL only | Optional attribution (Sprint 17.4) |
| Admin auth pattern | Mind blind | Empirical header-based, reuse across all admin endpoints |
| Beacon auth attribution | Frontend-side | **Backend-side** (token → `get_supabase_user`) cleaner |
| Membership model | Assumed `students.cohort_id` | **Code-derived** (assignments → cohort) — Sprint 17.3 pivot |
| Reassignment ordering | Assumed atomic transaction | **Safe sequential** (activate target first) per SDK reality |

---

## V. Cluster 17.x deliverables (admin-facing)

### Activation Codes page (Sprint 17.1):
- Email/account mapping per code (rendered từ existing API `assigned_users[].email`)
- Quota remaining per assigned user (lifetime sessions vs `access_codes.session_limit`)
- Client-side search (code + email)
- Sortable headers (created_at, expires_at, status)
- ⚠ lookup failed handling per CLAUDE.md

### Usage Log page (Sprint 17.2):
- Per-user list: sessions count, last active, AI cost, code assignments
- Per-code rollup: aggregate sessions + cost across assigned users
- Drill-down: from codes UI `?code_id=` query param
- Date range filter (client-side)
- Sort/filter consistent với codes UI design

### Cohort Management page (Sprint 17.3 + 17.5):
- Cohort list: name, code_prefix, member count, status
- Cohort detail: code-derived member roster (active assignees of cohort's codes)
- Add member (issue new direct-code with cohort_id)
- Remove member (deactivate user's assignments to cohort codes)
- Cohort archive/restore via existing PATCH

### Foot Traffic page (Sprint 17.4):
- Total page views / unique visitors / anonymous hits
- Top pages (sortable)
- Daily activity (pure-CSS bar chart, ds.css tokens)
- Date range filter
- Beacon installed on 3 core auth'd pages (home, speaking, result)
- Backend attribution via Bearer token

### Reassignment/Refill workflows (Sprint 17.5):
- Reassign code A→B with audit trail
- Refill bump (PATCH existing) + Refill new code (issue + assign)
- Cohort member mutation = reassignment workflow with cohort context
- Migration 081: `user_code_assignments.revoked_at`, `assigned_by`, `reason`
- Immutability preserved (`is_used`, `used_by`, `used_at` never touched)

### Infrastructure changes:
- Migration 080: `analytics_events.user_id` (Sprint 17.4)
- Migration 081: `user_code_assignments` audit cols (Sprint 17.5)
- Backend tests: 1908 → 1927 (+19)
- New frontend modules: `admin-codes-util.js`, `admin-usage-util.js`, `admin-usage.js`, `admin-cohorts.js`, `admin-foot-traffic.js`, `analytics-beacon.js`

---

## VI. Issues open at cluster close

### IS-17.1 — Anonymous landing-page beacon coverage
**Status:** Open follow-up
**Description:** Beacon installed on 3 core auth'd pages (home/speaking/result). Landing `index.html` không có `window.api` → anonymous-landing tracking absent.
**Trigger to address:** Andy decision on tracking landing traffic
**Estimate:** ~30-50 LOC (Sprint 17.4.1 or fold into cluster 18.x UI refactor)

### IS-17.2 — analytics_events retention policy
**Status:** Open future cluster decision
**Description:** Sprint 17.4 page-view tracking adds rows/day. Volume growth may trigger cleanup policy similar to cluster 16.x retention pattern.
**Trigger:** Andy observes volume + Supabase storage growth concern
**Owner:** Future cluster

### IS-17.3 — Writing-Coach roster cohort handling
**Status:** Deferred per Sprint 17.3 (m1) Andy decision
**Description:** `students.cohort_id` not automatically updated on direct-code activation. Affects ONLY Writing-Coach roster users (admin-created student records).
**Trigger:** If Writing-Coach cohort assignment becomes empirical concern
**Owner:** Future cluster

### IS-17.4 — F4 e2e for admin pages
**Status:** Deferred — admin auth-gated + DOM-coupled, repo convention no-headless-browser for admin
**Description:** Admin pages covered by source-scan + functional unit tests only. F4 e2e infrastructure exists for non-admin pages.
**Trigger:** Admin UI regression frequency justifies F4 investment
**Owner:** Future infra decision

### IS-17.5 — Cluster 17.x observation period
**Status:** Active observation 2026-05-26 → ~2026-06-02 (1 week)
**Description:** Admin uses new panel, Pattern #19 dogfood validates production behavior
**Trigger to close cluster:** Observation complete + no P0/P1 regressions
**Owner:** Andy empirical

---

## VII. Working style observations cluster 17.x

**Andy patterns observed:**
- "defaults" 1-word answer used consistently (6 times across cluster)
- Architectural pivots accepted mid-cluster (Sprint 17.3 students-table escalation → m1 code-derived)
- Empirical screenshots provided cho Sprint 18.x kickoff (showed actual admin panel state)
- Andy himself suggested Discovery format cho cluster 18.x ("có thể thực hiện discovery")

**Mind patterns observed:**
- Pattern #42 ledger maintained honest throughout (~20 errors logged)
- Pseudo-decorator habit recurring (Sprint 17.1/17.2/17.3) → discontinued Sprint 17.5
- Migration counter drift (Sprint 17.4)
- Self-consistency review applied increasingly (Sprint 17.5 lowest error count)
- Closure artifacts drafted parallel với feature work for context preservation

**Code patterns observed:**
- Architectural escalation discipline (Sprint 17.3 students-table didn't silently implement wrong premise)
- Code-side empirical elevation (auth backend-side, sequential reassign ordering, single-path cohort add)
- Memory writes maintained (`project_cluster17_admin` etc.)
- CI verification consistent (all sprints green pre-merge)

---

## VIII. Empirical metrics

| Metric | Cluster 16.x | Cluster 17.x |
|---|---|---|
| Sprints | 8 | 6 |
| PRs | 8 | 6 |
| Duration | ~48h | ~48h |
| LOC prod | ~1,100 | ~1,962 |
| LOC/sprint avg | ~137 | ~327 |
| Spec errors | ~12 | ~20 |
| Errors/sprint | ~1.5 | ~3.3 |
| Architectural pivots | 1 (v1→v2 retention) | 1 (Sprint 17.3 code-derived) |
| Mid-cluster Andy decisions | 3 (D1/D2/D3 audio/chip/Drive) | 4 (4 questions defaults batch) |
| Backend tests | 1872 → 1908 (+36) | 1908 → 1927 (+19) |
| CI runtime | 5 checks | 5 checks |

---

## IX. Pattern #43 validation (Discovery-first multi-direction)

**Cluster 16.x:** Discovery prevented 2 high-impact errors (PDF tech inversion, dashboard.html non-existence)
**Cluster 17.x:** Discovery prevented 4 material + 1 latent error (Vercel→GitHub Pages, email-already-in-API, immutable codes, multi-page architecture, students-cohort latent gap)

**Validation status:** Pattern #43 promoted from candidate to **active pattern** post cluster 17.x. Confirmed: multi-direction infrastructure/refactor themes benefit from Discovery-first format.

**Andy validation:** Cluster 18.x kickoff Andy himself suggested Discovery ("có thể thực hiện discovery để có diagnosis chính xác") — pattern adopted by product owner.

---

## X. Next steps post-closure

### Immediate (Andy):
1. Observation period 2026-05-26 → ~2026-06-02 production usage
2. Monitor P0/P1 regressions
3. Decide IS-17.1 (landing beacon) inclusion in cluster 18.x

### Cluster 18.x (active kickoff 2026-05-26):
1. Sprint 18.0 Discovery commission ready (defaults baked)
2. Cluster 18.x scope: IA restructure + dashboard consolidation + UI refactor
3. Refinement của cluster 17.x output

### Parallel concerns:
- Cluster 16.x retrospective pending (Sprint 16.4 went live 2026-05-26, observation 1-2 tuần)
- Logo asset Sprint 16.1 (non-blocking, Andy drop when ready)
- Railway plan optimization decision (post-cluster 16.x usage data)

---

**CLUSTER 17.x FEATURE-COMPLETE 2026-05-26.**
**Empirical motivation fully addressed. 5 directions A/B/C/D/E shipped.**
**Pattern #43 (Discovery-first) validated 2nd time, promoted to active.**

---

**END CLUSTER 17.x RETROSPECTIVE.**
