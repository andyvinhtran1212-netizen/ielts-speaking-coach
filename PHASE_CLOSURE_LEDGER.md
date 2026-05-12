# Phase Closure Ledger

Single source-of-truth tracking page redesigns + PR refs + closure status across Phases 1-4.

**Last updated:** Sprint 6.15.4-hotfix (2026-05-12)

**Verification:** Test pin `frontend/tests/phase-closure-ledger.test.mjs` cross-references this ledger against:

- `DESIGN_SYSTEM.md` § 14.1 / § 14.2 / § 14.5 row claims
- `UNIFIED_DESIGN_BRIEF.md` § 2 phase map + cumulative count line
- Per-page file existence (deleted pages verified absent)
- `frontend/vercel.json` redirect preservation
- `admin-writing.css` `--av-text-faint` cap (≤ 10 per § 17.6)

When this ledger drifts from docs, the test fails — closure truth requires audit before proceeding. This ledger + its test pin formalize **Gate 8** (DESIGN_SYSTEM.md § 17.7).

---

## Phase 1 — Speaking flow (COMPLETE)

| Page | Path | Status | PR | Sprint |
|---|---|---|---|---|
| home | `frontend/pages/home.html` | COMPLETE | #121 | 6.3 |
| speaking | `frontend/pages/speaking.html` | COMPLETE | #123 / #124 / #125 | 6.4 / 6.4.1 / 6.4.2 |
| practice | `frontend/pages/practice.html` | COMPLETE | #127 / #128 | 6.5 / 6.5.1 |
| result | `frontend/pages/result.html` | COMPLETE | #130 / #131 | 6.6 / 6.6.1 |

**Phase 1 closure audit hotfix:** Sprint 6.6.1 (PR #131) closed cumulative Phase 1 audit (Codex AMBER #1 canonical IIFE drift + AMBER #2 architecture-doc staleness).

---

## Phase 2 — Writing + aggregate (COMPLETE)

| Page | Path | Status | PR | Sprint |
|---|---|---|---|---|
| writing-dashboard | `frontend/pages/writing-dashboard.html` | COMPLETE | #132 / #133 / #134 | 6.7 / 6.7.1 |
| writing-result | `frontend/pages/writing-result.html` | COMPLETE | #135 | 6.8 |
| full-test-result | `frontend/pages/full-test-result.html` | COMPLETE | #136 | 6.9 |

**Phase 2 closure audit hotfix:** Sprint 6.9.1 (PR #137) closed cumulative Phase 2 audit (Codex AMBER brief/test drift + central architecture-insights placement; formalized Chart.js A.2 + pre-work patterns).

---

## Phase 3 — Vocabulary + Profile + Onboarding (COMPLETE)

| Page | Path | Status | PR | Sprint |
|---|---|---|---|---|
| vocabulary | `frontend/pages/vocabulary.html` | COMPLETE | #138 | 6.10 |
| theme-toggle icon normalization (shared) | components.css + 6 redesigned pages | COMPLETE | #139 | 6.10.1 |
| my-vocabulary | `frontend/pages/my-vocabulary.html` | COMPLETE | #140 | 6.11a |
| flashcards | `frontend/pages/flashcards.html` | COMPLETE | #141 | 6.11b |
| exercises | `frontend/pages/exercises.html` | COMPLETE | #141 | 6.11b |
| profile | `frontend/pages/profile.html` | COMPLETE | #142 | 6.12a |
| onboarding | `frontend/onboarding.html` (at root) | COMPLETE | #143 | 6.12b |

**Phase 3 closure audit hotfix:** Sprint 6.12c closed cumulative Phase 3 audit + **formalized § 17 audit checklist gates** (Gates 1-7).

---

## Phase 4 — Marketing + Admin + Grammar Wiki (✅ COMPLETE)

### Marketing (2 pages)

| Page | Path | Status | PR | Sprint |
|---|---|---|---|---|
| index | `frontend/index.html` | COMPLETE | #145 / #146 | 6.13a / 6.13a-ext |
| pricing | `frontend/pricing.html` | COMPLETE | #147 | 6.13b |

**Era B reconciliation:** `frontend/landing.html` DELETED atomically Sprint 6.13a (PR #145). Was orphan with no production refs; no Vercel redirect required.

### Admin sub-pages (8 fully migrated + 1 STRUCTURALLY COMPLETE)

| Page | Path | Status | PR | Sprint |
|---|---|---|---|---|
| admin-writing | `frontend/pages/admin-writing.html` | COMPLETE | #149 | 6.14a |
| admin-writing-new | `frontend/pages/admin-writing-new.html` | COMPLETE | #149 | 6.14a |
| admin-writing-status | `frontend/pages/admin-writing-status.html` | COMPLETE | #149 | 6.14a |
| admin-writing-prompts | `frontend/pages/admin-writing-prompts.html` | COMPLETE | #149 | 6.14a (Supabase outlier) |
| admin-writing-assignments | `frontend/pages/admin-writing-assignments.html` | COMPLETE | #150 | 6.14b (Supabase outlier) |
| admin-students | `frontend/pages/admin-students.html` | COMPLETE | #150 | 6.14b |
| admin-instructor-queue | `frontend/pages/admin-instructor-queue.html` | COMPLETE | #151 | 6.14c |
| admin-writing-grade | `frontend/pages/admin-writing-grade.html` | COMPLETE | #151 | 6.14c (own grading CSS) |
| **admin** | `frontend/admin.html` (at root) | **STRUCTURALLY COMPLETE** | #153 | 6.14d-α |

**admin.html status detail:** Chrome migrated (canonical IIFE + theme toggle + tokens + `body.av-page` + foundation order). Renderer-emitted JS template inline palette **deferred to Sprint 6.14d-β / 6.14d-γ** with triggers documented `DESIGN_SYSTEM.md` § 14.5.2 / § 14.5.3. Four deferred regions are marked with `SPRINT 6.14d-α DEFERRED` comments in `frontend/admin.html` (added Sprint 6.15.3-hotfix). Treatment: **"chrome-complete, renderer-deferred"**.

**Phase 4 admin closure audit hotfix:** Sprint 6.14c-hotfix (PR #152) formalized § 17.6 shared CSS cap monitoring + § 2.1 Sprint 6.14d strategy guidance.

### Grammar Wiki cluster (5 pages)

| Page | Path | Status | PR | Sprint |
|---|---|---|---|---|
| grammar (landing) | `frontend/grammar.html` (at root) | COMPLETE | #154 | 6.15 |
| grammar-roadmap | `frontend/pages/grammar-roadmap.html` | COMPLETE | #154 | 6.15 |
| grammar-article | `frontend/pages/grammar-article.html` | COMPLETE | #154 | 6.15 |
| grammar-search | `frontend/pages/grammar-search.html` | COMPLETE | #154 | 6.15 |
| grammar-compare | `frontend/pages/grammar-compare.html` | COMPLETE | #154 | 6.15 |

**Typography sub-system:** DM Sans (body) + Lora (display) preserved per `DESIGN_SYSTEM.md` § 14.2 — decision **RESOLVED** Sprint 6.15. Editorial cluster distinct from utilitarian Plus Jakarta Sans pages.

**Phase 4 closure events:**
- Sprint 6.15.2 (PR #155) — narrative correction (dashboard.html non-existence + zero `--ds-*` state)
- Sprint 6.15.3-hotfix (PR #156) — closure audit AMBER closures + Gate 8 formalization
- Sprint 6.15.4-hotfix (this PR) — **RED bug fix**: light-theme `text-white/XX` opacity-variant coverage gap (cascade-winning override blind spot, same class as Sprint 6.10.1)

---

## Deleted pages

| Page | Path (former) | Deletion Sprint | Replacement | Vercel Redirect |
|---|---|---|---|---|
| dashboard | `frontend/pages/dashboard.html` | Sprint 5.1 (commit `3f4ff14`) | `frontend/pages/home.html` | 301 → `/pages/speaking.html` (`vercel.json`) |
| landing | `frontend/landing.html` | Sprint 6.13a (PR #145) | `frontend/index.html` | None (was orphan, no production refs) |

---

## Cumulative metrics

- **29 pages redesigned** (4 Phase 1 + 3 Phase 2 + 6 Phase 3 + 16 Phase 4)
- **2 pages deleted** (`dashboard.html` + `landing.html`)
- **Zero pages on `--ds-*` tokens**
- **`ds.css` preserved** as Sprint 6.5.1 compatibility bridge (renderer-emitted `.ds-band-*` / `.ds-crit*` / `.ds-cue-*` on `practice.html` + `result.html`)
- **`admin-writing.css` at-cap** 10/10 `--av-text-faint` (frozen per § 17.6)
- **9 audit hotfixes** cumulative: 6.6.1 (Phase 1), 6.7.1 (writing-dashboard CTA), 6.9.1 (Phase 2), 6.10.1 (theme-toggle icon drift), 6.12c (Phase 3), 6.14c-hotfix (Phase 4 admin), 6.15.2 (narrative correction), 6.15.3-hotfix (Phase 4 closure Gate 8), 6.15.4-hotfix (Grammar Wiki light-theme RED — this PR)
- **5 cumulative audits closed**: Phase 1 (6.6.1), Phase 2 (6.9.1), Phase 3 (6.12c), Phase 4 admin (6.14c-hotfix), Phase 4 closure (6.15.3-hotfix)
- **Phase 4 closure audit:** 0 RED, 2 AMBER closed via 6.15.3-hotfix, 4 GREEN
- **Sprint 6.15.4-hotfix RED bug:** Grammar Wiki cluster light-theme rendering. Root cause: Sprint 6.15 cascade-winning override neutralized only plain `.text-white`, missed 15 Tailwind opacity variants (`text-white/15..90`) + 5 hover + 4 border + 5 bg. Fix: comprehensive opacity-variant override block in grammar-wiki.css mapped to `--av-text-*` / `--av-border-*` / `--av-surface-*` tokens. Same blind-spot class as Sprint 6.10.1 icon rendering miss — § 17 audit-gate methodology note added (visual rendering smoke required in both themes for any cascade-winning override).

---

## Phase 5+ deferred (with un-defer triggers)

| Item | Trigger Reference | Effort Estimate |
|---|---|---|
| Sprint 6.14d-β Tailwind utility-class refactor (admin.html) | DESIGN_SYSTEM.md § 14.5.2 | ~20-30h |
| Sprint 6.14d-γ Per-tab primitive adoption polish (admin.html) | DESIGN_SYSTEM.md § 14.5.3 | ~15-20h |
| admin.html renderer-emitted palette tokenization (4 marked regions) | § 14.5.2 / § 14.5.3 (subset of β/γ) | included in β/γ above |
| DEBT-2026-05-09-B vocabulary iframe → module extraction | No un-defer triggers fired | TBD |

---

## Phase 5+ pending decisions (separate planning sessions)

- Commercial launch readiness (Stripe + Email + SEO)
- Pre-launch redirect removal (`pricing.html` `window.location.replace('/')` at head)
- Typography pass sprint (if DM Sans + Lora ↔ Plus Jakarta Sans unification desired — currently sub-system intentional per § 14.2)
- Pricing content alignment with multi-skill landing (Sprint 6.13a-extension)
- Active DEBT closure (DEBT-2026-05-07/08/09 series)
- `ds.css` retirement (Phase 5+ decision — fires only when `.ds-*` class emissions are removed from `practice.html` + `result.html` JS renderers)
- Legacy `frontend/pages/dashboard` 301 redirect removal (low priority — preserves SEO cached links indefinitely; revisit when SEO infrastructure ships)

---

## When to update this ledger

- After every per-page redesign sprint ship
- After every audit closure
- After every page deletion
- After every Phase closure milestone
- After Phase 5+ planning decisions
- Sprint hotfix prompts include a ledger-update step

This ledger is canonical for closure truth. Other docs (`DESIGN_SYSTEM.md` § 14, `UNIFIED_DESIGN_BRIEF.md` § 2, `CLAUDE.md` file-structure table) reference this file. If you find a closure claim somewhere else that contradicts this ledger, the ledger wins and the other doc should be corrected.
