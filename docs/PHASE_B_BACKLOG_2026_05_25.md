# Phase B Backlog — Updated post Cluster 15.x Closure (2026-05-25)

**Last update:** 2026-05-25 post-cluster-15.x closure
**Format:** Each item has trigger criteria for re-prioritization, owner, estimated scope

---

## I. Items resolved cluster 15.x

### ✅ F4 frontend half — RESOLVED Sprint 15.2 (#280)
**Original status:** Codex F4 finding cluster 14.x deferred P2
**Resolution:** Playwright frontend smoke tests shipped, 5 browser tests, advisory CI check 40-53s runtime
**Verification:** PR #280 + #281 + #282 all green CI including E2E advisory
**Conventions adopted:** Zero-dep break bounded `frontend/tests/e2e/` only

---

## II. New deferred items from cluster 15.x

### IS-15.1 — Smart default expansion threshold validation
**Priority:** P3
**Description:** Sprint 15.3 implemented `≤1 weak word expanded / ≥2 collapsed`. Production usage may reveal threshold mismatch with Andy's UX intent ("user vẫn xem được context")
**Scope:** 1-line flip in `pronunciation-accordion.js` if pivot needed (e.g., "expand-all with cap N")
**Trigger criteria:** Andy observation 2+ weak words feels buried OR user feedback
**Owner:** Andy empirical observation
**Estimate:** ~10 LOC + 1 sentinel update

### IS-15.2 — F4 advisory → required ramp
**Priority:** P3
**Description:** F4 frontend CI check currently advisory (does NOT block merge)
**Scope:** GitHub branch protection rule update + documentation
**Trigger criteria:** ≥95% pass rate on legitimate green PRs over 1-2 weeks
**Owner:** Andy decision post-empirical
**Estimate:** Configuration only, no code

### IS-15.3 — F4 backend half (Supabase-local CI)
**Priority:** P2 (escalated from P3 cluster 14.x baseline due to Sprint 15.1.1 cost evidence)
**Description:** Backend persistence integration test for Sprint 15.1.1 atomic upsert / partial unique index class
**Scope:** Supabase-local Docker CI service OR alternative (testcontainers-postgres). Code authoritative per PF.
**Trigger criteria** (any one):
  - (a) Persistence regression recurs (responses save silent fail, /complete 422)
  - (b) New persistence bug class surfaces (e.g., grading_events, sessions table)
  - (c) Andy decides pre-emptive infra investment justified (~3-6 hours Code work + Andy verify burden)
**Owner:** Andy decision
**Estimate:** Unknown empirical, Code PF needed

### IS-15.4 — Mobile viewport responsive accordion
**Priority:** P3
**Description:** Accordion desktop-first. Smart default + multiple sub-sections may cause excessive scroll on mobile
**Scope:** Media queries + sub-section collapse threshold mobile-specific + F4 mobile viewport test
**Trigger criteria:** Andy mobile usage feedback OR explicit mobile sprint commission
**Owner:** Future cluster
**Estimate:** ~150-250 LOC

### IS-15.5 — PDF report accordion rendering
**Priority:** P3
**Description:** If PDF generation uses result.html as template (Puppeteer-print or similar), accordion default expansion state for PDF static context
**Scope:** PDF-specific render override OR accordion always-expanded for print media query
**Trigger criteria:** PDF report regression after #282 merge OR explicit follow-up
**Owner:** Future cluster
**Estimate:** ~50-100 LOC

---

## III. Pre-existing Phase B items (cluster 14.x carryover)

### F1-F3 — Codex findings cluster 14.x
**Status:** Resolved cluster 14.x closure (per HANDOFF_PROJECT_FULL_2026-05-24.md Section IV)

### F4 — RESOLVED frontend half (cluster 15.x), backend half = IS-15.3

### F5-F7 — Codex findings cluster 14.x
**Status:** Resolved cluster 14.x closure

### 8 User Deficiencies — RESOLVED cluster 14.x

---

## IV. Cluster 16.x theme candidates (Sprint 15.x Direction backlog)

### Direction 2 — Drill exercises (per-phoneme practice clips)
**Priority:** TBD (Andy theme decision)
**Description:** User clicks weak phoneme → record short practice clip → Azure assesses isolated phoneme accuracy
**Trigger criteria:** Empirical motivation from production usage (users want practice modality beyond reading feedback)
**Estimate:** Multi-sprint (Discovery + 2-3 feature sprints)
**Cost concern:** Each practice = 1 Azure call → cost scales with usage

### Direction 3 — Cross-session phoneme trend tracking
**Priority:** TBD
**Description:** Track user's phoneme accuracy improvement over time across sessions, surface persistent weak phonemes
**Trigger criteria:** Andy empirical desire for longitudinal data view
**Estimate:** Multi-sprint (data aggregation + UI + telemetry)
**Cost concern:** $0 Azure (uses existing persisted data)

### Direction 4 — VN-learner specific phoneme guide
**Priority:** TBD
**Description:** VN-learner-specific tips for difficult English phonemes (e.g., /θ/ /ð/ /v/ /ʒ/ commonly confused by VN speakers)
**Trigger criteria:** Andy empirical observation OR corpus research available
**Estimate:** Discovery sprint + content creation + integration sprint
**Cost concern:** $0 Azure, content authoring effort

### Direction 5 — Cambridge IELTS band descriptor mapping
**Priority:** TBD (Risk #4 legal review pending)
**Description:** Map Azure scores to Cambridge IELTS pronunciation band descriptors
**Trigger criteria:** Legal review of Cambridge IP usage clear
**Estimate:** Legal review + mapping logic + UI integration
**Cost concern:** $0 Azure, legal cost variable

### TTS audio reference playback
**Priority:** TBD
**Description:** Play reference pronunciation of weak words/phonemes via Azure TTS
**Trigger criteria:** Andy empirical desire OR user feedback "muốn nghe phát âm chuẩn"
**Estimate:** ~300-400 LOC (audio player UI + TTS pipeline + caching)
**Cost concern:** **Yes** — Azure TTS billable per character synthesized. Cost trigger explicit.

### LLM-generated dynamic tips
**Priority:** TBD
**Description:** Sprint 15.1 ships static narrative VN tips. LLM upgrade = dynamic per-user tips based on error pattern
**Trigger criteria:** Static tip quality empirically insufficient OR Andy desires personalization
**Estimate:** ~400-500 LOC (LLM integration + prompt engineering + caching + fallback)
**Cost concern:** **Yes** — Azure OpenAI or external LLM billable per token. Cost trigger explicit.

---

## V. Re-prioritization criteria (when to act)

**Promote to active sprint (commission immediately):**
- (a) Production regression evidence (user-facing bug)
- (b) Andy explicit decision to prioritize
- (c) Blocking dependency for next-sprint scope

**Promote to backlog candidate (commission within 1-2 weeks):**
- (a) Empirical evidence 2+ data points (e.g., 2 dogfood sessions reveal same issue)
- (b) Cost concern realized (Azure cost spike)
- (c) Theme-cluster kickoff triggers candidate selection

**Maintain deferred status:**
- (a) Current state stable empirically
- (b) Speculative or pre-emptive investment without evidence
- (c) Andy explicit defer decision

---

**END PHASE B BACKLOG UPDATE 2026-05-25.**
