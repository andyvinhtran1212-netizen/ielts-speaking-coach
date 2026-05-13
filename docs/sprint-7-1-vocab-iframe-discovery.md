# Sprint 7.1 — DEBT-2026-05-09-B Vocabulary Iframe → Module Discovery

**Sprint type:** Pure discovery — NO code changes, NO test changes.
**Deliverable:** This document. Sprint 7.2 = Andy approves architecture. Sprint 7.3+ = atomic refactor across multiple PRs.
**Date:** 2026-05-13.
**Audit hotfix count:** unchanged at 14.

---

## TL;DR

Today, `vocabulary.html` is an iframe shell loading three independent child pages (`my-vocabulary.html`, `flashcards.html`, `exercises.html`) with `?embedded=1`. The three children are also **linked standalone from `speaking.html`** without `?embedded=1`. Refactor must preserve dual usage. Recommended target: **Option B — JS module dynamic import**. Standalone HTML pages stay valid; `vocabulary.html` mounts the same modules into containers via dynamic `import()` instead of iframes. Effort ~22h across 4 follow-up PRs.

---

## 1. Current architecture

### 1.1 Parent shell — `frontend/pages/vocabulary.html`

- Four `<section class="tab-panel">` containers (lines 166–192); three carry `<iframe class="tab-frame">`. The 4th tab `topic-bank` ships content inline (not an iframe).
- `iframe loading="lazy"` on all three (lines 169, 175, 181).
- Tab handler: `activateTab(tabName, { updateHash })` in `frontend/js/vocab-landing.js:47-81`:
  - Toggles `.active` + `aria-selected` + `tabIndex` on the tab buttons.
  - Toggles `[hidden]` on the `.tab-panel` sections.
  - **Lazy iframe `src` injection**: tracks `_loaded` Set; first activation sets `iframe.src = TAB_SOURCES[tabName]` and adds to the Set. Subsequent activations skip.
  - `history.replaceState(null, '', '#' + tabName)` updates deep-link hash.
- **Cross-frame communication: NONE.** No `postMessage`, no shared `BroadcastChannel`, no parent-owned localStorage keys read by children except `av-theme`. Each iframe is an independent execution context.
- **Auth context:** parent passes nothing explicit. Children inherit the browser Supabase session (httpOnly cookie / sessionStorage owned by `@supabase/supabase-js`).

### 1.2 Three child pages — inventory

| Page | Lines of code | Inline JS lines | Page-specific module | Inline-JS ratio |
|---|---|---|---|---|
| `my-vocabulary.html` | 313 | 44 (4 IIFEs) | `js/my-vocabulary.js` (~350 LOC) | 14% |
| `flashcards.html` | 239 | 41 (4 IIFEs) | `js/flashcards.js` (~350 LOC) | 17% |
| `exercises.html` | 273 | 88 (4 IIFEs incl. ~56-line feature-flag async IIFE at 195–250) | inline-only (no external module) | 32% |

All three import the **same** five external resources:
- `/css/embedded-mode.css`
- `/css/aver-design/tokens.css`
- `/css/aver-design/components.css`
- `/css/ds.css`
- `/css/<page>.css` (page-specific)

JS deps (all three):
- `@supabase/supabase-js@2` (CDN)
- `/js/api.js` (window-global API client + Supabase wrapper)
- `/js/theme-toggle.js` (ES module — `bindToggleButton`)
- `/js/user-pill.js` (ES module — wires `#user-pill` dropdown + logout)
- `lucide@latest` (CDN, for icons)

### 1.3 Embedded-mode CSS contract — `frontend/css/embedded-mode.css`

51 LOC total. Active rules:

| Selector | Effect | Line |
|---|---|---|
| `html.embedded-mode > body > header` | `display:none !important` | 29 |
| `html.embedded-mode > body > .topnav-wrap` | `display:none !important` (Sprint 6.17.1) | 30 |
| `html.embedded-mode #vocab-moved-banner` | hide | 31 |
| `html.embedded-mode .vocab-moved-banner` | hide | 32 |
| `html.embedded-mode body` | `padding-top:0 !important` | 36–40 |

Each child page ships an **identical synchronous IIFE in `<head>`** that reads `?embedded=1` and applies `html.embedded-mode` (my-vocab L14–22, flashcards L10–18, exercises L10–18). The IIFE runs before CSS loads to prevent flash-of-unhidden-chrome.

### 1.4 Backend API surface — 27 endpoints

Backend is stable and orthogonal to this refactor; **NO backend changes required.**

- **Vocab bank** (`backend/routers/vocabulary_bank.py`): 13 endpoints (`GET /api/vocabulary/bank/`, `GET /stats`, `GET /recent`, `GET /recent-updates`, `GET /export`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`, `POST /{id}/accept`, `POST /{id}/mark-fixed`, `POST /{id}/skip`, `POST /{id}/report`). All Bearer-JWT auth + RLS. Feature-flagged via `is_vocab_bank_enabled(user_id)`.
- **Flashcards / SRS** (`backend/routers/flashcards.py`): 13 endpoints (`/api/flashcards/stacks` GET/POST, `/preview`, `/{id}` GET/DELETE, `/{id}/cards` GET/POST, `/{id}/cards/{vocab_id}` DELETE, `/due`, `/due/count`, `/{vocab_id}/review`, `/stats`, `/vocab-topics`). All Bearer-JWT + flag-gated.
- **Exercises hub**: 1 endpoint (`GET /api/auth/me` for feature flags). The actual exercise flow lives on separate pages (`d1-exercise.html`, `flashcard-study.html`) and is out of scope.

### 1.5 State management today

| Aspect | Current behavior |
|---|---|
| **Per-page client state** | Each child owns its own top-level vars (`_token`, `_allItems`, `_currentFilter`, etc.). No shared state container. |
| **localStorage** | `av-theme` (shared across parent + 3 children + every other AverLearning page); Supabase session (managed by `supabase-js`). |
| **Fetch / invalidation** | Each page fetches on `init()`. Mutations re-fetch the affected list (my-vocab POST → `loadVocab()` refresh). No background polling, no visibility listener. |
| **Cross-page state** | None except theme. my-vocabulary's "add to flashcard stack" modal calls `/api/flashcards/stacks` directly (treats flashcards as remote service, not local state). |
| **Auth context** | Inherited via browser cookies; each iframe `initSupabase()` separately. |

### 1.6 Canonical chrome inside iframes — duplicate init cost

All three children ship the **canonical chrome** (Sprint 6.17.1): `<div class="topnav-wrap"><nav class="topnav">…</nav></div>` as a direct body child, including:
- Theme toggle button + `/js/theme-toggle.js` import + `bindToggleButton()` call.
- User-pill dropdown + `/js/user-pill.js` ES-module side-effect import.
- Brand wordmark + 5 skill tabs + Reading/Listening locked badges.

When embedded, `html.embedded-mode > body > .topnav-wrap { display:none }` hides the chrome visually. **But the JS still runs.** Cost: 3× theme-toggle init, 3× user-pill bind, 3× `supabase-js` UMD parse, 3× Lucide hydration. Order ~30ms per child. Total wasted ~90ms per landing — minor but real.

### 1.7 Standalone URL usage — CRITICAL

The three children are **dual-use**:

1. **Embedded** under `/pages/vocabulary.html#<tab>` (parent appends `?embedded=1` to the iframe `src`).
2. **Standalone** linked from `frontend/pages/speaking.html` lines 937 / 954 / 978 — `<a href="my-vocabulary.html|flashcards.html|exercises.html">` **without** `?embedded=1`. Also linked from `my-vocabulary.js:171` (vocab card → exercises), `d1-exercise.html:137`, `flashcard-study.js:457`, `flashcards.js:121` (empty-state CTA), and `my-vocabulary.html:254` (picker "create new stack" link).
3. No Vercel redirects on these paths (`frontend/vercel.json`). No SEO meta descriptions / og:* tags. Only basic `<title>` set per page.

**Verdict:** standalone usage is real and intentional. Any refactor that breaks `/pages/my-vocabulary.html` as a standalone URL will break in-app navigation from speaking.html + several deep links. **Refactor must preserve standalone URLs as a hard requirement.**

### 1.8 Tests pinning the current iframe contract

- `frontend/tests/chrome-unification-canonical.test.mjs:220-251` — embedded-mode contract suite: pins (a) `html.embedded-mode > body > .topnav-wrap` selector in `embedded-mode.css`; (b) byte-identical `classList.add('embedded-mode')` IIFE in `<head>` of all three children.
- Same file lines 33–48 — `CANONICAL_CHROME_PAGES` roster includes the three children for canonical chrome assertions (logo, skill tabs, locked badges, theme toggle, user-pill, ES-module `/js/user-pill.js` script tag).
- Same file lines 264–306 — Sprint 6.20 Gate 10 anchor sentinel: `.topnav-wrap` must be a direct body child (no `.shell` / `<main>` / `<section>` / `<article>` ancestor). All three children pass.
- `frontend/tests/flashcards-redesign.test.mjs` — pins `/css/embedded-mode.css` link presence.

Any refactor that retires `embedded-mode.css` or removes the IIFE must update these tests in lockstep.

### 1.9 Sprint history touching the trio

- **Sprint 6.0 / 6.0.1**: introduced parent `vocabulary.html` + iframe landing + embedded-mode IIFE.
- **Sprint 6.11a/b**: migrated `my-vocabulary.css` + `flashcards.css` to Aver Design System tokens (CSS-only; HTML preserved).
- **Sprint 6.17.1**: canonical chrome migration to all three children + `embedded-mode.css` selector extension for `.topnav-wrap`.
- **Sprint 6.18**: canonical chrome vertical spacing — all three children compliant.
- **Sprint 6.19**: canonical `.eyebrow` markup added (`Vocabulary` tier label) in each child's chrome.
- **Sprint 6.20**: Gate 10 nav-anchor sentinel — all three already compliant.

---

## 2. Architecture options

### Option A — Full inline into `vocabulary.html`

Merge the three child pages' DOM + inline JS + page-specific modules into the parent. Tab switching = show/hide DOM sections. No iframes. Optional Vercel redirect from `/pages/my-vocabulary.html` → `/pages/vocabulary.html#my-vocab`.

**Pros**
- Single JS context — shared state, no duplicate init.
- Lowest runtime overhead (no iframe boundary, no postMessage).
- Embedded-mode CSS contract can be retired entirely.

**Cons**
- Breaks standalone URLs unless redirected. Redirects work but lose the per-page "feels like its own page" UX (tab hash deep-linking helps, but the URL surface changes).
- Massive single HTML file (~825 LOC + 3 page modules inline-equivalent) — review burden, bug surface.
- The 4th `topic-bank` tab already inlined in vocabulary.html — extending the pattern grows the file unboundedly.

**Effort:** ~15h (extracting + de-duplicating DOM, JS interleaving, redirect setup, ~12 test updates).

### Option B — JS module dynamic `import()` (recommended)

Convert each child page module (`my-vocabulary.js`, `flashcards.js`, `exercises-inline-IIFE → exercises.js`) to an ES module exporting `mount(container, { embedded?: boolean }) → unmount()` lifecycle. The HTML body of each child becomes a **template emitted by the module** (innerHTML or template literal) into the supplied container.

- **Parent `vocabulary.html`**: tab click → `await import('/js/my-vocabulary.js')` (lazy) → `mount(panelEl, { embedded: true })`. Replaces iframe.
- **Standalone `my-vocabulary.html`**: shell page with chrome + a `<main>` mount container → import + `mount(container, { embedded: false })`. Module emits same content; chrome stays visible.
- `embedded-mode.css` retired (parent never renders child chrome; standalone pages own their chrome).
- Each module's `mount()` returns an `unmount()` function so future tab-aware behavior can clean up listeners on tab swap (not required day-one — tabs stay mounted after first activation, matching today's iframe lazy behavior).

**Pros**
- Preserves standalone URLs cleanly. No Vercel redirects. No SEO impact.
- Single JS context inside parent: shared state easy, chrome init once.
- Lazy by design — `import()` is naturally code-split.
- Compatible with the design system (light DOM, all `--av-*` tokens cascade normally).
- Module-per-page boundary respected — each page can ship / test independently.

**Cons**
- Module API design needed (`mount`/`unmount` signature, lifecycle).
- HTML body of each child must move from `*.html` into JS templates inside `*.js`. Per-page module grows; HTML shrinks to a thin shell.
- Test pins for embedded-mode IIFE must be removed (or relaxed to "if shell-style page, IIFE optional"). Affects ~10 pins in `chrome-unification-canonical.test.mjs`.

**Effort:** ~22h total split across follow-up PRs (see §3).

### Option C — Web Components (`<vocab-my-bank>`, etc.)

Define custom elements per page. Parent composes via element instantiation. Standalone pages render a single element.

**Pros**
- Strong encapsulation; clear API surface (element attributes).
- Reusable across other dashboards if vocab content embedded elsewhere.

**Cons**
- **Shadow DOM is hostile to the Aver Design System**: tokens (`--av-*`) cascade through shadow boundaries (CSS custom properties pierce shadow), but `class`-based component CSS files (`my-vocabulary.css`, `flashcards.css`) do NOT — they'd need to be `@imported` inside each shadow root or refactored to constructable stylesheets. Big lift.
- Light DOM avoids that, but then there's no encapsulation benefit over Option B.
- Web Component lifecycle learning curve for the team.

**Effort:** ~18h. Highest risk because design system was built for global cascade.

### Option D — Hybrid: keep iframe, optimize

Preload all 3 iframes eagerly; add `postMessage` for theme sync; share JWT via cookies (already done).

**Pros**
- Lowest effort (~3–5h).
- No HTML restructure, no module API design.

**Cons**
- Doesn't solve the structural costs: 3 JS contexts persist, 3 DOM trees, 3× chrome init, 3× supabase-js parse.
- Eager preload makes initial paint slower (3× iframes loading concurrently on landing).
- This is a band-aid; doesn't satisfy the Phase 5+ architectural priority.

**Effort:** ~4h. Not recommended — defeats the purpose of filing DEBT-2026-05-09-B.

---

## 3. Recommendation

**Option B — JS module dynamic `import()`.**

### Rationale

1. **Preserves dual usage natively.** Standalone HTML pages remain valid URLs; the same module mounts into the parent's tab container. No Vercel redirects, no SEO impact, no breakage of speaking.html → my-vocab in-app navigation.
2. **Eliminates iframe overhead.** Single JS context, single DOM tree, one chrome init. The ~90ms duplicate-init cost vanishes.
3. **Compatible with the Aver Design System.** Light DOM means tokens cascade as designed; no shadow-DOM token plumbing.
4. **Test migration is bounded and mechanical.** ~10–12 pins change (mostly retiring embedded-mode IIFE assertions on children that become shells). Backend tests untouched.
5. **Modular and incremental.** Each page can be converted one PR at a time — Phase 3a/b/c — without breaking the others. Parent keeps using iframes for the unconverted tabs during migration.
6. **Lazy by default.** `import()` gives natural code-splitting — same as the current iframe lazy `src`-set pattern.

### Trade-offs accepted

- Module API design effort (one design pass at the start of Sprint 7.3).
- HTML bodies move into JS template literals / `innerHTML` strings — slight DX regression for visual diffing (can be mitigated by extracting to `*.html.js` template files or by keeping the standalone shell pages as the canonical HTML source and having the module `fetch` and parse them, though that adds a runtime cost).

### Architectural sketch

```
frontend/pages/vocabulary.html  (parent shell)
├── on tab click → await import('/js/vocab-modules/my-vocab.js') → mount(panelEl, { embedded: true })

frontend/pages/my-vocabulary.html  (standalone shell — preserves URL)
├── canonical chrome (visible)
├── <main id="mount"></main>
└── inline: import('/js/vocab-modules/my-vocab.js').then(m => m.mount(document.getElementById('mount'), { embedded: false }))

frontend/js/vocab-modules/my-vocab.js  (ES module)
├── export function mount(el, opts) { ... renders HTML, wires handlers ... return unmount }
└── export function unmount() { ... cleanup listeners ... }
```

Same shape for `flashcards.js` and `exercises.js`.

`embedded-mode.css` retired. Embedded-mode IIFE removed from standalone shells. Tests in `chrome-unification-canonical.test.mjs` lose the embedded-mode-IIFE-on-child pins; gain new pins for module-mount lifecycle (e.g., "tab activation imports and mounts module").

---

## 4. Effort estimate (Sprint 7.x roadmap)

| Sprint | Scope | Effort |
|---|---|---|
| **7.2** | Andy approves architecture choice (Option B), standalone URL preservation requirement, embedded-mode retirement timing, atomic vs phased split | 30 min |
| **7.3** | **Phase 1 — module API + my-vocabulary migration.** Design `mount/unmount` contract. Convert `my-vocabulary.js` to module export. Update `my-vocabulary.html` to be a thin shell that mounts the module. Update parent `vocab-landing.js` to dynamic-import + mount instead of iframe-src for my-vocab tab. Keep flashcards + exercises tabs on iframe path during this PR. Tests: update my-vocabulary canonical-chrome + embedded-mode pins. | ~7h |
| **7.4** | **Phase 2 — flashcards migration.** Same pattern. | ~6h |
| **7.5** | **Phase 3 — exercises migration.** Same pattern; the ~56-line inline async IIFE for feature flags lifts into the module. | ~5h |
| **7.6** | **Cleanup.** Retire `embedded-mode.css`. Remove last embedded-mode IIFE from children (they're shells now). Update remaining tests. Vercel redirects audit (none needed). | ~4h |
| | **Total post-approval** | **~22h** |

Phased over 4 PRs keeps each PR reviewable and lets us catch regressions one page at a time. The parent's iframe path stays functional during the migration so each PR is independently shippable.

---

## 5. Open questions for Phase B (Andy)

1. **Standalone URL preservation is a hard requirement, confirm?** Code recommends YES based on speaking.html linkage + deep links from study/d1 pages.
2. **HTML body source-of-truth**: should each module's HTML live inside the JS (template literal) or in the standalone HTML shell (module `fetch()`es the shell, extracts `<main>` body)? Recommendation: **template literal** inside the JS module — single source of truth, no runtime fetch cost, easier testing.
3. **`embedded-mode.css` retirement timing**: retire at Sprint 7.6 (after all 3 modules migrated), or earlier (per-module as each child becomes a shell)? Recommendation: **per-module** — each migration retires its child's IIFE; embedded-mode.css selector list shrinks until empty at 7.6.
4. **Atomic single PR vs phased 4 PRs?** Phased is safer (one tab at a time, parent still has working iframes for unconverted tabs). Atomic is theoretically cleaner but high blast-radius — 22h of work landing in one PR is hard to review and rollback.

---

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Module HTML diverges from standalone HTML shell (drift between two sources) | Canonical chrome lives only in standalone shells; module owns only the **content body** template. Tests pin shell chrome separately. |
| Lazy `import()` fails on flaky network | Show a tab-level error state + retry button. Same UX as current iframe load failure (which today silently fails too). |
| Multiple users open same vocab page in two tabs (e.g., my-vocab standalone in tab A, my-vocab embedded in tab B) | State already lives server-side (Supabase). No client-side sync needed beyond what today's iframe does (which is: nothing). |
| Theme drift between modules if chrome init runs differently | Theme is set on `<html data-theme>` before any module loads (canonical anti-flash IIFE). Modules inherit; no per-module theme init needed. |
| Test pin churn | Mechanical updates concentrated in `chrome-unification-canonical.test.mjs`. ~10–12 pins. Each phase PR updates its own page's pins. |

---

## 7. What this sprint did NOT change

- No production code modified.
- No tests modified.
- No backend changes.
- No frontend gate impact (test count stays at 2752).
- No PHASE_CLOSURE_LEDGER row beyond a single discovery line.
- No PR title implementation — just the docs PR title shown in spec.

End of Sprint 7.1 deliverable.
