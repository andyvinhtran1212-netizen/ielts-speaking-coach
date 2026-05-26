# Phase B Backlog — Updated post Cluster 18.x Closure (2026-05-26)

**Last update:** 2026-05-26 post cluster 18.x closure (#306)
**Previous update:** 2026-05-26 post cluster 17.x closure
**Format:** Each item has trigger criteria, owner, estimated scope

---

## I. Items resolved cluster 18.x

### ✅ Cluster 18.x admin panel refinement — Closed
**Status:** Feature-complete (#297-#306), observation period 1-2 tuần active
**Resolution:** 3 directions A/B/C shipped + 4 hotfix sprints + 1 independent audit + structural fix
**Verification:** 10 PRs merged, 929 frontend tests passing, structural toolbar split resolves access-codes button overflow definitively

### ✅ IS-18.1 — Access-codes button overflow — RESOLVED
**Status:** Closed by Sprint 18.3.1.3 (#306)
**Resolution:** Structural shift — toolbar split into 2 intentional rows (filter row + actions row)
**Pattern lesson:** Anchored pattern-matching across 3 micro-fix sprints; Pattern #45 (independent AI audit) broke frame

---

## II. New deferred items from cluster 18.x

### IS-18.2 — Admin browser-runtime test coverage
**Priority:** P2 (Codex audit finding)
**Status:** Open Phase B
**Description:** Current admin test coverage dominated by source-scan sentinels. Browser-level workflow tests absent:
- Create modal open/close interaction
- Search debounce hook
- Summary modal open path
- Delete confirm flow
- CSV import workflow
**Trigger:** Andy decision OR admin UI regression frequency justifies investment
**Owner:** Future infra decision
**Estimate:** ~200-400 LOC, Playwright-style harness with admin auth handling

---

## III. Pre-existing items (cluster 14.x-17.x carryover)

### IS-15.1 — Smart default expansion threshold validation
**Priority:** P3
**Status:** Open observation
**Description:** Pronunciation accordion ≤1 expanded / ≥2 collapsed default
**Trigger:** Andy production feedback 2+ weak words feels buried
**Estimate:** ~10 LOC

### IS-15.2 — F4 advisory → required ramp
**Priority:** P3
**Status:** Open observation
**Description:** F4 frontend CI advisory currently
**Trigger:** ≥95% pass rate over 1-2 weeks empirical
**Owner:** Andy decision

### IS-15.3 — F4 backend half (Supabase-local CI)
**Priority:** P2
**Status:** Deferred pending re-trigger
**Description:** Backend persistence integration test cho Sprint 15.1.1 class
**Trigger:** Persistence regression recurs OR new class surfaces
**Owner:** Andy decision

### IS-15.4 — Mobile viewport responsive accordion
**Priority:** P3
**Status:** Folded partially via cluster 18.x C UI refactor (admin pages), but main app accordion still pending
**Description:** Main app responsive (speaking/result/dashboard)
**Trigger:** Andy mobile usage feedback
**Owner:** Future cluster

### IS-16.4 — Drive integration (Direction C cluster 16.x)
**Priority:** P3 (Andy D3=df defer)
**Description:** OAuth foundation exists, ~450-700 LOC, 2 sprints
**Trigger:** Andy theme decision future cluster
**Owner:** Future cluster

### IS-17.1 — Anonymous landing-page beacon coverage
**Priority:** P3
**Description:** Beacon installed on home/speaking/result only. Landing `index.html` lacks `window.api` → anonymous traffic untracked
**Scope:** ~30-50 LOC
**Trigger:** Andy explicit decision OR future cluster scope inclusion
**Owner:** Andy decision

### IS-17.2 — analytics_events retention policy
**Priority:** P3 (depends volume growth empirical)
**Description:** Page-view tracking accumulates rows. Cluster 16.x retention pattern precedent.
**Scope:** ~150-250 LOC similar cluster 16.x design
**Trigger:** Andy observes volume + Supabase storage growth concern
**Owner:** Future cluster

### IS-17.3 — Writing-Coach roster cohort handling
**Priority:** P3 (Andy decision m1=code-derived deferred Writing-Coach scope)
**Description:** `students.cohort_id` not auto-updated on direct-code activation. Affects ONLY admin-created Writing-Coach student records
**Trigger:** Empirical Writing-Coach cohort assignment concern
**Owner:** Future cluster

### IS-17.4 — F4 e2e admin pages
**Priority:** P3 (related IS-18.2 newer scope)
**Description:** Admin pages auth-gated + DOM-coupled
**Trigger:** Admin UI regression frequency justifies F4 investment OR fold into IS-18.2
**Owner:** Future infra decision

---

## IV. Cluster theme candidates (post observation period)

### Mobile responsive cluster
**Trigger:** Andy mobile usage decision OR student feedback
**Estimate:** Multi-sprint, main app accordion + grading UX

### Drive integration (IS-16.4)
**Trigger:** Andy theme decision OR Google Cloud setup
**Estimate:** Multi-sprint, ~450-700 LOC

### Persistence integration test infra (IS-15.3)
**Trigger:** Persistence regression recurrence
**Estimate:** Discovery-first, infra-heavy

### Analytics retention policy (IS-17.2)
**Trigger:** Volume growth empirical
**Estimate:** Cluster 16.x precedent pattern, ~150-250 LOC

### Writing-Coach cohort handling (IS-17.3)
**Trigger:** Writing-Coach feature scope demand
**Estimate:** Small follow-up scoped to writing students

### Admin browser-runtime tests (IS-18.2 — Codex P2)
**Trigger:** Admin UI regression frequency
**Estimate:** ~200-400 LOC Playwright harness

---

## V. Re-prioritization criteria

**Promote to active sprint:**
- Production regression evidence
- Andy explicit decision
- Blocking dependency for next-sprint scope

**Promote to backlog candidate:**
- Empirical evidence 2+ data points
- Cost concern realized
- Theme-cluster kickoff triggers candidate selection

**Maintain deferred status:**
- Current state stable empirically
- Speculative pre-emptive investment
- Andy explicit defer decision

---

**END PHASE B BACKLOG UPDATE 2026-05-26 (post cluster 18.x closure).**
