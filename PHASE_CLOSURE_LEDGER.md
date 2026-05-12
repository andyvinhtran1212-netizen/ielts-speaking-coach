# Phase Closure Ledger

Single source-of-truth tracking page redesigns + PR refs + closure status across Phases 1-4.

**Last updated:** Sprint 6.17.1 (2026-05-12)

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
- Sprint 6.15.4-hotfix (PR #157) — **RED bug fix**: light-theme `text-white/XX` opacity-variant coverage gap (cascade-winning override blind spot, same class as Sprint 6.10.1)
- Sprint 6.16 (PR #158) — **fix sprint** (not audit hotfix): cross-page navigation label drift ("Dashboard" → "Trang chủ" / "Quay lại") + Speaking page IA cleanup
- Sprint 6.15.5-hotfix (PR #159) — **2nd RED bug fix on grammar-article.html**: Sprint 6.15.4 covered class-bearing elements but markdown emits class-less `<p>` / `<h2>` / `<li>` / `<td>` etc. that inherited Tailwind's raw `text-white` from the body element (descendant override couldn't match body itself). Fix: drop `text-white` from grammar-article body + defensive token-driven overrides in grammar-wiki.css.
- Sprint 6.15.6-hotfix (PR #160) — **3rd RED bug fix, comprehensive component pass**: cards (Học tiếp theo / Bài liên quan / category cards) invisible on all 5 grammar pages in light theme despite Sprint 6.15.4 covering every emitted `text-white/X` variant. Phase A audit surfaced multi-mechanism root cause. Fix bundles **6 items**: (1) `text-white` dropped from body on remaining 4 grammar pages (mirror Sprint 6.15.5); (2) 3 JS inline-color sites in grammar.js refactored to class hooks (`.gw-status-dot--planned`, `.gw-status-badge--planned`, `.gw-save-btn`, `.gw-progress-track`); (3) `.cat-card` / `.article-card` / `.group-card` / `.group-article-row` component class hooks gain explicit `--av-text-*` color rules; (4) card surfaces switch from invisible `bg-white/[0.03]` to `--av-surface-card`; (5) `body.av-page.text-white` compound-selector defensive guard; (6) Sprint 6.15.6-hotfix marker + 31-pin regression test file. **Strategy change vs prior 3 hotfixes:** comprehensive Phase A audit before fix (4th iteration warranted broader scope than L3 single-root-cause discipline).
- Sprint 6.15.7-hotfix (PR #161) — **theme toggle structural placement fix on 4 grammar sub-pages**: Andy reported toggle visible top-left + both icons stacked + no click response on grammar-article.html. Phase A bisect of 5 stacked PRs (#156-160) confirmed **none touched components.css, theme-toggle.js, or toggle markup**. True culprit traced to **Sprint 6.15 (PR #154)** — the malformed nav layout has existed since the original Grammar Wiki ship. Surgical 3-item fix: (1) restructure 4 grammar sub-page navs so the "Trang chủ" link + theme toggle share a single `<div class="flex items-center gap-2|3">` chrome wrapper (grammar-article moves the button INSIDE the existing right-side wrapper; roadmap/search/compare wrap their previously-standalone link+button in a new flex div); (2) new `theme-toggle-layout-context.test.mjs` (68 pins) — structural sentinel that walks tag-depth and asserts the toggle's immediate parent is a flex container; coverage extends to all 29 pages carrying the toggle (catches the same drift class on any future page); (3) switch all 5 grammar pages to absolute `/js/theme-toggle.js` import path so Vercel `/grammar/:category/:slug` rewrites don't break relative module resolution. **Audit gap closed:** Sprint 6.10.1 Gate 3 checked markup presence but not DOM structural correctness. Filing § 17.8 Gate 9.7 (per-component verification + structural-context sentinel) as the formal lesson.
- Sprint 6.15.8-hotfix (PR #162) — **CSS path absolutization, Vercel-rewrite 404 fix**: Andy's DevTools surfaced `tokens.css` + `components.css` returning **404** when grammar-article.html is served under the `/grammar/:category/:slug` rewrite. Root cause: every redesigned page used relative stylesheet paths (`../css/...` for `/pages/*` files, `css/...` for root files), and the browser resolves them against the served URL — not the rewritten target — so `/grammar/foo/bar` makes `../css/tokens.css` 404 at `/grammar/css/tokens.css`. Same class of bug Sprint 6.15.7-hotfix Item 3 fixed for `theme-toggle.js`; now generalized to CSS. Same rewrite class also affects `/writing/dashboard`, `/admin/writing/prompts`, `/admin/writing/assignments`, `/home`, `/speaking` — so the fix is repo-wide, not grammar-only. **Atomic 3-item fix:** (1) convert 106 `<link rel="stylesheet">` hrefs to absolute paths across 29 redesigned pages (24 subfolder files: `../css/X` → `/css/X`; 5 root files: `css/X` → `/css/X`); (2) new `css-paths-absolute.test.mjs` (35 pins) — sentinel asserts every stylesheet href on redesigned pages starts with `/` or is a full URL; dedicated pins on all 5 grammar pages for the canonical 4-import set; (3) ledger + ledger-test count bump. **Audit gap closed:** the `/js/theme-toggle.js` fix in 6.15.7-hotfix Item 3 was per-asset; this hotfix generalizes the principle (all rewrite-served pages need absolute relative-resource paths). Gate 9.7 lesson reinforced: per-asset fixes must trigger systematic same-class audits.
- Sprint 6.16.1 (PR #163) — **audit methodology formalization, Gate 9.5 + 9.6 + 9.7 triple bundle**: pure docs sprint. The 5 cumulative audit blind spots (Sprint 6.10.1 + 6.15.4 + 6.15.5 + 6.15.6 + 6.15.7) had been recognized inline in their respective hotfix bodies but not consolidated into formal § 17 audit gates. Sprint 6.16.1 formalizes the three lessons each filed against a hotfix that surfaced them: **§ 17.9 Gate 9.5** (Runtime-render inheritance — filed Sprint 6.15.5: body utilities inherit into class-less markdown / template-literal output; descendant overrides can't match the body element itself), **§ 17.10 Gate 9.6** (Structural layout context — filed Sprint 6.15.7: sentinel tests that verify markup existence must also verify DOM-tree parent-child layout context, especially for chrome controls), **§ 17.11 Gate 9.7** (Per-component theme verification — filed Sprint 6.15.6: page-level "readable" smoke missed 5 mechanisms across multi-component pages; per-component DevTools inspection × both themes is mandatory). Plus **§ 17.12** records the 5-instance blind-spot evolution pattern + 6 pre-empt questions for future audit reviewers, and **§ 17.13** consolidates the cumulative 12-gate table. New `gate-9-5-9-6-9-7-formalization.test.mjs` pins each new section's presence + Sprint origin. **No production code changes.** Audit gate count 9 → 12; audit hotfix count unchanged at 13 (Sprint 6.16.1 is methodology, not hotfix).
- Sprint 6.17 Phase C1 (PR #164) — **chrome unification foundation + 3-page canonical migration**: Andy reported 4+ chrome variants across redesigned pages (full nav / minimal / breadcrumb / skill-module). Phase A audit (29 pages) surfaced 5 chrome categories. Andy approved Phase B scope: Cat 1+2 only (11 pages migrate, Cat 3 grammar / 4 marketing / 5 admin explicitly excluded as legitimate separate IA tiers). Phase C scope subdivided into C1 (foundation + 3 pages) shipped this PR and C2 (8 remaining pages, Sprint 6.17.1) deferred for per-page JS-contract preservation work. **C1 ships:** (1) canonical chrome rules moved into `components.css` so all Cat 2 adopters pick up the foundation from a single source (`.shell` + `.topnav-wrap` lightweight wrapper + `.topnav` + `.brand` + `.nav-links` + `.topnav-right` + `.user-pill` + `.user-menu` dropdown family + mobile breakpoint @media 720px); (2) NEW `/js/user-pill.js` shared ES module — idempotent `bindUserPill()` wires the toggle + outside-click + Escape + Đăng xuất via `window.getSupabase().auth.signOut()`; (3) `home.html` + `vocabulary.html` canonical references updated to dropdown user-pill (vocabulary gains avatar; previously absent); (4) `profile.html` migrated to canonical full nav (Trang chủ active; previous `pf-header` chrome retired); (5) NEW `chrome-unification-canonical.test.mjs` (47 pins) — pins foundation rules in components.css + user-pill.js module contract + canonical chrome on 3 migrated pages + deferred roster tracking. **Decisions captured:** logo wordmark canonicalized to `Aver<span class="dot">.</span>Learning` form across Cat 2; `Đăng xuất` integrated into user-pill dropdown (single canonical pill behavior across all pages); active-tab mapping documented per page (Trang chủ / Writing / Speaking / Vocabulary). **Atomic spirit preserved:** foundation is the shippable closed concern; bulk migration is mechanical follow-up per Sprint 6.10.1 precedent. Audit hotfix count unchanged at 13 (Sprint 6.17 is a fix sprint, not audit hotfix).
- Sprint 6.17.1 (this PR) — **chrome unification Phase C2: 10 remaining Cat 2 pages migrated to canonical full nav**. Completes the chrome-unification sprint started in PR #164 (Phase C1). Phase A per-page JS-contract audit produced migration plans; Andy Phase B approved 4 decisions: (Q1) extend `embedded-mode.css` selector to include canonical `.topnav-wrap`; (Q2) canonicalize all logout flows on `/index.html` redirect; (Q3) drop emoji from onboarding chrome (canonical brand only); (Q4) preserve practice session-context info via new `<div class="practice-context-bar">` below canonical nav. **Pages migrated in this PR (10 in low → high risk order):** `result.html` + `writing-result.html` + `practice.html` + `full-test-result.html` (Speaking/Writing active; theme-toggle migrated to `/js/theme-toggle.js` module; Lucide re-render via MutationObserver on `data-theme` for chevron stroke updates + full-test-result Chart.js radar refresh); `onboarding.html` (Trang chủ active; 🎙️ emoji dropped from wordmark per Q3); `my-vocabulary.html` + `flashcards.html` + `exercises.html` (Vocabulary active; embedded-mode contract preserved — `embedded-mode.css` extended with `html.embedded-mode > body > .topnav-wrap` selector to hide canonical chrome when iframe-mounted via `?embedded=1`); `writing-dashboard.html` (Writing active; legacy `#logout-btn` removed, logout integrated into canonical user-pill dropdown); `speaking.html` (Speaking active; entire custom `#avatar-menu` dropdown replaced by canonical pill — 8 legacy IDs retired: `#avatar-wrap`/`#avatar-menu`/`#avatar-img`/`#avatar-initials`/`#btn-logout`/`#user-name`/`#user-name-skeleton`/`#avatar-dropdown-wrap`; inline JS rewired to populate `#user-pill-name` + `#user-avatar`; outside-click and logout handlers deleted as `/js/user-pill.js` owns both). **Tests:** `chrome-unification-canonical.test.mjs` extended from 3 to 13 canonical pages + new embedded-mode contract sentinel suite (3 pages × IIFE preservation pin + `embedded-mode.css` selector pin); 10 per-page redesign test files refreshed (toggle pin pattern updated from `querySelector('.av-theme-toggle')` to canonical module import; legacy chrome IDs replaced by canonical pill IDs; back-link/emoji pins replaced by canonical-chrome pins where applicable); `cross-page-navigation-canonical.test.mjs` href pins updated to absolute `/pages/speaking.html` form on result/practice/full-test-result. **Audit hotfix count unchanged at 13** (Sprint 6.17.1 is a fix sprint completing Sprint 6.17 — not audit hotfix).

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
- **13 audit hotfixes** cumulative (unchanged by Sprint 6.16.1 — pure methodology sprint): 6.6.1 (Phase 1), 6.7.1 (writing-dashboard CTA), 6.9.1 (Phase 2), 6.10.1 (theme-toggle icon drift), 6.12c (Phase 3), 6.14c-hotfix (Phase 4 admin), 6.15.2 (narrative correction), 6.15.3-hotfix (Phase 4 closure Gate 8), 6.15.4-hotfix (Grammar Wiki light-theme RED), 6.15.5-hotfix (grammar-article inherited-white RED), 6.15.6-hotfix (Grammar Wiki comprehensive component pass), 6.15.7-hotfix (theme toggle structural drift on grammar sub-pages), 6.15.8-hotfix (CSS path absolutization for Vercel rewrites)
- **12 § 17 audit gates** cumulative (Gate 9.5 + 9.6 + 9.7 added Sprint 6.16.1): Gates 1-9 (per § 17.8) + Gate 9.5 (runtime-render inheritance, § 17.9) + Gate 9.6 (structural layout context, § 17.10) + Gate 9.7 (per-component theme verification, § 17.11)
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
