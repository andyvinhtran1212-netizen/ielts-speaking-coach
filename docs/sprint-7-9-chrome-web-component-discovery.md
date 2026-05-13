# Sprint 7.9 — Chrome Web Component Discovery

**Status:** Phase A complete. Phase B (Andy approval) pending.
**Production code modified:** none (pure discovery sprint).
**Pattern reference:** Sprint 7.1 vocab iframe → module discovery (DEBT-2026-05-09-B), which delivered on its 22h estimate with zero hotfixes.

---

## 1. Problem statement

18 canonical chrome pages currently copy-paste a ~40-line chrome block (`.topnav-wrap` + `.topnav` + brand + nav-links + theme toggle + user pill + dropdown) plus 4–6 supporting script tags. Drift recurs:

- Sprint 6.17 / 6.17.1 / 6.17.2 / 6.18 / 6.19 / 6.20 each shipped chrome-unification work
- Sprint 7.8-hotfix still had to close 3 bugs (logo size drift, user pill stuck "...", 1-letter vs 2-letter initials)
- Codex 9/9 GREEN audit verified *markup* contract but missed *CSS override* + *JS contract* drift
- Sprint 6.20 Gate 10 caught nav position drift; Sprint 7.7-hotfix caught embedded resource gap

Same class of recurrence will repeat at every sprint that touches chrome until the markup is literally single-sourced.

**Hypothesis (Andy approved direction):** convert chrome to a Web Component `<aver-chrome>`. Single source. Drift becomes physically impossible at the markup layer; CSS encapsulation prevents per-page override leakage.

---

## 2. Phase A inventory — 18 canonical chrome pages

### 2.1 Page roster + active tab

The `class="active"` marker on a `.nav-links` child determines which skill is highlighted. Profile + onboarding don't match any of the 5 skills directly — convention from chrome-unification-canonical Sprint 6.17 is "Trang chủ" active for those.

| # | Page | Path | Active tab |
|---|---|---|---|
| 1 | home | `frontend/pages/home.html` | Trang chủ |
| 2 | speaking | `frontend/pages/speaking.html` | Speaking |
| 3 | practice | `frontend/pages/practice.html` | Speaking |
| 4 | result | `frontend/pages/result.html` | Speaking |
| 5 | full-test-result | `frontend/pages/full-test-result.html` | Speaking |
| 6 | writing-dashboard | `frontend/pages/writing-dashboard.html` | Writing |
| 7 | writing-result | `frontend/pages/writing-result.html` | Writing |
| 8 | vocabulary | `frontend/pages/vocabulary.html` | Vocabulary |
| 9 | my-vocabulary | `frontend/pages/my-vocabulary.html` | Vocabulary |
| 10 | flashcards | `frontend/pages/flashcards.html` | Vocabulary |
| 11 | exercises | `frontend/pages/exercises.html` | Vocabulary |
| 12 | profile | `frontend/pages/profile.html` | Trang chủ |
| 13 | onboarding | `frontend/onboarding.html` | Trang chủ |
| 14 | grammar | `frontend/grammar.html` | Grammar |
| 15 | grammar-roadmap | `frontend/pages/grammar-roadmap.html` | Grammar |
| 16 | grammar-search | `frontend/pages/grammar-search.html` | Grammar |
| 17 | grammar-compare | `frontend/pages/grammar-compare.html` | Grammar |
| 18 | grammar-article | `frontend/pages/grammar-article.html` | Grammar |

**Active-tab values (canonical 6):** `home` / `writing` / `speaking` / `grammar` / `vocabulary` / `none` (none for surfaces that shouldn't highlight any skill — e.g., admin pages if/when they join).

### 2.2 Chrome markup drift

Phase A confirmed: **all 18 pages use the canonical markup** with one trivial variation — the `class="active"` placement changes per page. No structural deltas (no extra `<div>` wrappers, no different ARIA roles, no missing nav links, no missing user-menu items). The earlier Sprint 6.17.x → 6.20 sweep flattened the variation surface fully.

### 2.3 Per-page chrome CSS override audit

Three CSS files contain `.topnav` / `.brand` / `.nav-links` / `.user-pill` rules outside `components.css`:

| File | Chrome rules | Status |
|---|---|---|
| `home.css` | `.topnav`, `.brand`, `.brand .dot`, `.nav-links` | Redundant — declares the canonical values byte-identical to `components.css`. Safe to delete after migration. |
| `vocabulary.css` | `.topnav`, `.nav-links`, `.nav-links a`, `.nav-links a:hover`, `.nav-links a.active`, `.nav-links .locked` | Mostly canonical duplicates. **The 1.35rem `.brand` override was the Sprint 7.8-hotfix bug; already removed.** Remaining rules are safe to delete after migration. |
| `grammar-wiki.css` | `body.av-page .topnav-wrap, .topnav, .brand, .nav-links, .topnav-right { font-family: var(--av-font-sans); }` | Sprint 7.8-hotfix scoped fix to block DM Sans body cascading into chrome. **Required** because grammar pages run a DM Sans body for editorial typography (§ 14.2). The Web Component's Shadow DOM resolves this automatically (see § 3.1). |

**Insight:** the grammar-wiki.css override exists *only because* chrome shares the cascade with page-body fonts. Shadow DOM encapsulation makes that override unnecessary — chrome lives in its own style scope.

### 2.4 Per-page chrome JS dependencies

Every canonical page ships this script set in `<head>` + `<body>` close:

```html
<!-- HEAD -->
<script>
  // Anti-flash theme bootstrap IIFE (~10 lines)
  // Reads localStorage['av-theme'], falls back to system, applies [data-theme] on <html>
</script>

<!-- BODY close (in roughly this order) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="../js/api.js"></script>
<script>
  initSupabase('https://nqhrtqspznepmveyurzm.supabase.co', '<anon-key>');
</script>

<script>
  // Lucide hydration + MutationObserver on data-theme
</script>
<script type="module">
  import { bindToggleButton } from '/js/theme-toggle.js';
  bindToggleButton(document.getElementById('theme-toggle'));
</script>
<script type="module" src="/js/user-pill.js"></script>
```

Additionally, some pages carry inline pill-bootstrap or auth-gate IIFEs. After Sprint 7.8-hotfix, the pill-bootstrap is consolidated inside `user-pill.js` (via `populateUserPill()` auto-binding); only auth-gate redirects remain inline (e.g., home.html, vocabulary.html).

### 2.5 User pill async flow

The pill displays three pieces from the Supabase session:

1. **Display name** — `user_metadata.display_name || .full_name || .name || email.split('@')[0] || 'bạn'`, truncated to 14 chars (then "…")
2. **Initials** — canonical 2-letter via `canonicalInitials(name)` (Sprint 7.8-hotfix)
3. **Dropdown menu** — static links (`/pages/profile.html`) + sign-out button wired to `window.getSupabase().auth.signOut()` then redirect to `/index.html`

The async flow is:

```
DOMContentLoaded
  → bindUserPill()           (dropdown toggle + outside-click + Escape + logout)
  → populateUserPill()       (async)
      → getSupabase().auth.getSession()
      → write #user-pill-name + #user-avatar (with placeholder-detection guard so pages
        with their own bootstrap — e.g., speaking.html renderUser — stay authoritative)
```

Placeholder-detection: the HTML defaults `…` (U+2026) and `·` (U+00B7) signal "untouched"; any other value means a page bootstrap has already written. The Web Component preserves this contract — pages can still emit their own user data via attribute/slot if they want override behavior (rare; only `speaking.html` uses it today and for permissions context, not pill text).

### 2.6 Eyebrow / context-bar placement

The canonical `<p class="eyebrow">` (Sprint 6.19 primitive) is **page-content**, not chrome. It sits inside the page's main hero or context bar, never inside `.topnav`. The Web Component must NOT include the eyebrow — that's per-page concern.

Same for secondary navs (`.main-tab-nav` on speaking, `.vocab-tabs` on vocabulary, `.gw-subnav` on grammar pages, `.practice-header` / `.result-header` / `.ftr-context-bar` on practice/result pages): all sit **below** the chrome, are **page-level**, and must NOT be absorbed into the Web Component.

---

## 3. Web Component API design

### 3.1 Shadow DOM vs Light DOM

**Recommendation: Shadow DOM with CSS variable passthrough.**

Trade-off:

| | Shadow DOM | Light DOM |
|---|---|---|
| Style encapsulation | ✅ chrome rules can't leak; page rules can't leak in | ❌ page CSS overrides chrome (the Sprint 7.8-hotfix vocabulary.css/grammar-wiki.css drift class) |
| Token inheritance | ✅ CSS custom properties (`--av-*`) cross the boundary natively | ✅ same |
| Easier debugging | ❌ DevTools requires expanding `#shadow-root` | ✅ everything visible in inspector |
| Tailwind utility access | ❌ Tailwind classes from page CSS can't reach inside chrome | ✅ direct access (but chrome shouldn't depend on Tailwind anyway) |
| Click events bubble | ✅ retargeted, but bubble through | ✅ direct |

The whole point of this sprint is preventing per-page CSS override drift (Sprint 7.8-hotfix bug 1 root cause = vocabulary.css `.brand` override). Shadow DOM eliminates that class of bug at the platform level. Tokens (`--av-*`) cross the shadow boundary natively, so theming + the existing design system both keep working.

**Open option for Phase B:** Light DOM is acceptable if Andy prefers easier DevTools inspection — but then we'd need a sentinel test that fails on any per-page CSS rule that targets a chrome selector, and we lose the platform guarantee.

### 3.2 Component name + tag

```html
<aver-chrome></aver-chrome>
```

Web Component naming requires a hyphen. `aver-chrome` reads naturally + namespaces under the existing `av-*` / `aver-*` design system prefix.

### 3.3 Attribute / property API

```html
<!-- Default: nothing highlighted (e.g., admin pages, 404, login) -->
<aver-chrome></aver-chrome>

<!-- Skill-based active state -->
<aver-chrome active="home"></aver-chrome>
<aver-chrome active="writing"></aver-chrome>
<aver-chrome active="speaking"></aver-chrome>
<aver-chrome active="grammar"></aver-chrome>
<aver-chrome active="vocabulary"></aver-chrome>
```

| Attribute | Type | Default | Behavior |
|---|---|---|---|
| `active` | enum (`home` / `writing` / `speaking` / `grammar` / `vocabulary`) | unset | Adds `class="active"` to the matching `<a>` |

**No other attributes.** Reading user state, theme, etc. is auto-fetched (see § 3.4). Keeping the API surface minimal makes future refactors safer + the per-page migration trivially mechanical.

### 3.4 Auto-fetch vs prop-based user state

**Recommendation: auto-fetch.**

The Web Component reads `window.getSupabase()` and runs the same `populateUserPill()` logic that `/js/user-pill.js` ships today. Encapsulation principle — pages shouldn't have to know about Supabase to render chrome.

Pre-condition: the page must call `initSupabase(SUPABASE_URL, SUPABASE_ANON)` before the chrome connects. This is already the canonical pattern (every page loads `api.js` then `initSupabase()` inline). The Web Component handles the rest.

Defensive: if Supabase isn't initialized yet (race condition), the chrome retries on `window.api` ready event, OR shows the placeholder values silently and never overwrites them.

### 3.5 Slot API (escape hatches)

Three named slots for the rare page that needs a non-canonical fragment:

```html
<aver-chrome active="speaking">
  <!-- Insert pre-chrome content (e.g., grammar-article reading progress bar that
       sits above the topnav). Sprint 7.10 Phase B Andy decides if any current
       page actually needs this — if not, drop the slot. -->
  <div slot="above"></div>

  <!-- Insert post-chrome / context-bar content. Common today: secondary
       navs, breadcrumbs, eyebrows. Sprint 7.10 may decide to keep these
       at the page level instead (no slot needed). -->
  <div slot="below"></div>

  <!-- Override the user pill entirely (e.g., admin pages with elevated
       UI). Probably not needed for canonical 18 pages; document for
       future use. -->
  <div slot="user-pill"></div>
</aver-chrome>
```

**Open question for Phase B:** keep all 3 slots, or trim to zero (slots-free, force page-level placement)? Slots-free is cleaner for the migration; we can add slots later if any consumer needs them.

### 3.6 Inline style vs external CSS link

**Recommendation: inline `<style>` inside Shadow DOM.**

- Single file (the JS module) is fully self-contained
- No FOUC (lesson from Sprint 6.10.1 — external CSS for chrome creates flash-of-unstyled-content even with `<link rel="preload">`)
- The chrome CSS is ~150 lines — small enough that inlining doesn't bloat the JS bundle materially
- Shared cache benefit of external CSS is negligible for ~150 lines × 1 component
- Token references (`--av-*`) work the same way regardless of where the CSS lives

The external `components.css` `.topnav` / `.brand` / `.user-pill` etc. block becomes deletable after the Web Component ships, reducing the legacy chrome surface from 4 files (markup × 18 pages + components.css block + user-pill.js + theme-toggle.js wiring) down to 1 file.

### 3.7 Theme integration

Anti-flash IIFE stays in `<head>` of each page (it MUST run before any stylesheet to prevent the dark → light flicker on first paint). The Web Component re-applies the theme on mount + delegates the toggle button to `bindToggleButton` from `theme-toggle.js`. No conceptual change from today — the toggle button moves from per-page markup into the shadow root.

The anti-flash IIFE is also the reason this Web Component cannot be the *only* source of chrome — the IIFE has to execute synchronously before any CSS loads, which means before the custom element is defined. So `<head>` IIFE stays; the Web Component picks up from there.

### 3.8 Accessibility

Same a11y surface as today (validated by `chrome-unification-canonical.test.mjs`):

- `<nav aria-label="Primary">` for the topnav
- `<button aria-haspopup="true" aria-expanded="false" aria-label="Menu hồ sơ">` for user-pill
- `<div role="menu" hidden>` for dropdown
- `<button role="menuitem">` for menu items
- Theme toggle: `<button aria-label="..." aria-pressed="...">` dynamic per `theme-toggle.js`
- Keyboard: Escape closes dropdown, focus management via `theme-toggle.js`

Shadow DOM doesn't break ARIA — labels + roles work across the boundary. Screen readers traverse shadow trees natively in all evergreen browsers.

### 3.9 Browser support

Web Components (Custom Elements v1 + Shadow DOM v1) supported natively in Chrome / Edge / Safari / Firefox since 2018. No polyfill needed. Project already targets evergreen browsers (no IE11 support, Tailwind CDN + ES modules are already in use across 25+ pages).

---

## 4. Per-page migration strategy

### 4.1 Per-page diff (mechanical)

For each of 18 pages:

**Remove (40+ lines deleted per page):**

```html
<!-- Remove the entire .topnav-wrap block -->
<div class="topnav-wrap">
  <nav class="topnav" aria-label="Primary">
    ...40 lines of brand + nav-links + theme toggle + user pill...
  </nav>
</div>

<!-- Remove the inline theme-toggle binding script -->
<script type="module">
  import { bindToggleButton } from '/js/theme-toggle.js';
  bindToggleButton(document.getElementById('theme-toggle'));
</script>

<!-- Remove the user-pill script tag -->
<script type="module" src="/js/user-pill.js"></script>

<!-- Remove the Lucide MutationObserver hydration (chrome owns its own lucide hydration) -->
<script>
  (function () {
    function hydrateIcons() { ... }
    ...
  })();
</script>
```

**Add (1 line per page):**

```html
<aver-chrome active="speaking"></aver-chrome>
```

**Keep (no change):**

```html
<!-- Anti-flash theme IIFE — stays in <head> for first-paint -->
<script>
  (function () {
    try {
      var stored = localStorage.getItem('av-theme');
      ...
    } catch (e) { ... }
  })();
</script>

<!-- Supabase + api.js bootstrap — chrome depends on initSupabase() being called first -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="../js/api.js"></script>
<script>
  initSupabase('https://nqhrtqspznepmveyurzm.supabase.co', '<anon-key>');
</script>

<!-- Inline auth-gate IIFE (some pages only) -->

<!-- ONE NEW SCRIPT TAG TO LOAD THE COMPONENT -->
<script type="module" src="/js/components/aver-chrome.js"></script>
```

Mechanical edit. Estimated **~5 min per page × 18 = ~90 min**. The cleanup deletion (removing redundant chrome rules from `home.css` + `vocabulary.css` + `grammar-wiki.css`'s chrome scoping) is another ~30 min.

### 4.2 Phased rollout

| Sprint | Scope | Effort | Risk |
|---|---|---|---|
| **7.10** | Andy approval — Phase B decisions (Shadow DOM y/n, slots, attribute names, batch vs all-atomic) | 30 min | none |
| **7.11** | Build the component: `frontend/js/components/aver-chrome.js` + sentinel test + smoke-test fixture | 3–4h | low (new code, no migrations yet — additive) |
| **7.12** | Migrate batch 1 (skill landing pages): home, speaking, writing-dashboard, vocabulary, grammar | 2h | medium (5 high-traffic pages; smoke per page) |
| **7.13** | Migrate batch 2 (sub-pages): practice, result, full-test-result, writing-result, my-vocabulary, flashcards, exercises, profile, onboarding, grammar-roadmap, grammar-search, grammar-compare, grammar-article (13 pages) | 2h | low (batch 1 already proved the pattern) |
| **7.14** | Cleanup — delete redundant `.brand`/`.topnav`/etc. rules from home.css + vocabulary.css + grammar-wiki.css; delete `components.css` chrome block; retire test pins that no longer apply | 1–2h | low (deletions only) |
| | **Total** | **~9–12h** | |

Estimate matches the Sprint 7.1 → 7.6 vocab refactor pattern (22h actual / 22h estimated, 0 hotfixes). If Andy prefers all-atomic, collapse 7.12 + 7.13 into one PR (~4h work, ~2h smoke).

### 4.3 Per-page smoke checklist (Sprint 7.12+)

For each migrated page:

- [ ] Chrome renders identically to pre-migration (visual diff)
- [ ] Active tab highlighted correctly
- [ ] Theme toggle flips light ↔ dark
- [ ] User pill populates name + 2-letter initials
- [ ] User pill dropdown opens / closes / Escape closes
- [ ] Logout button signs out + redirects to `/index.html`
- [ ] Mobile 375px responsive layout intact
- [ ] No console errors
- [ ] Page-specific JS (e.g., practice recording, vocab module mounts) still functional

---

## 5. Risks + edge cases

### 5.1 Anti-flash IIFE ordering

The anti-flash IIFE sets `[data-theme]` on `<html>` before any stylesheet parses. The Web Component's Shadow DOM `<style>` references token CSS custom properties that resolve from `<html data-theme>` regardless of shadow root nesting. So the IIFE-then-stylesheets ordering still works inside the shadow root.

**Verified:** CSS custom properties cross shadow DOM boundaries (specified in CSS Custom Properties Module Level 1). No code change needed.

### 5.2 Supabase init race

`initSupabase()` runs in an inline `<script>` before `</body>`. The Web Component connects (calls `connectedCallback()`) when parsed, which may be before the inline init runs. Mitigations:

1. Defer the populate fetch to `requestIdleCallback` or a microtask — by then init has run
2. OR poll `window.getSupabase` every 30ms for up to ~3 seconds before giving up (current `vocab-landing.js` bootstrap pattern; works fine)
3. OR retry on a custom `av-supabase-ready` event emitted by `api.js` after init (cleanest, requires a one-line addition to api.js)

**Phase B decision needed:** which retry strategy. Recommend #2 (matches existing bootstrap pattern, no api.js change).

### 5.3 Pages with their own user pill bootstrap

`speaking.html` `renderUser()` carries permissions context — it writes the pill name + initials as a side effect of fetching `/auth/me`. After Sprint 7.8-hotfix, `populateUserPill()` already uses placeholder-detection to defer. The Web Component must preserve this contract: if `#user-pill-name` text isn't the placeholder `…`, don't overwrite. Open question: does Shadow DOM make this harder? Yes — the pill name lives inside the shadow root, so `speaking.html` can't write to it via `getElementById('user-pill-name')`.

**Resolution options:**

- A) Expose a method on the custom element: `document.querySelector('aver-chrome').setUser({ name, initials })` and `speaking.html` calls it from `renderUser()`. Cleanest API.
- B) Slot override: `<aver-chrome><div slot="user-pill">...</div></aver-chrome>` — page can render its own pill in the slot. Heavier, requires duplicating the dropdown markup.
- C) Custom event listener: `document.dispatchEvent(new CustomEvent('av-set-user', { detail: { name, initials } }))`, chrome listens. Decoupled, no DOM coupling.

**Recommendation: A (method on custom element)** — explicit API, type-checkable, easy to verify via test pin.

### 5.4 Grammar pages DM Sans font cascade

Currently fixed by `grammar-wiki.css` scoping `body.av-page .topnav-wrap { font-family: var(--av-font-sans) }` (Sprint 7.8-hotfix). With Shadow DOM, chrome lives in its own style scope; `body.av-page` selectors don't reach inside. **The grammar-wiki.css override becomes unnecessary** and should be deleted in the 7.14 cleanup phase.

### 5.5 Vercel rewrite paths

Sprint 6.15.8-hotfix moved all stylesheet hrefs to absolute paths because Vercel rewrites (e.g., `/grammar/:category/:slug`) resolve relative paths against the served URL. The Web Component must use absolute paths internally for any nested resource (e.g., theme-toggle.js import). Recommendation: import `theme-toggle.js` and `user-pill.js` *into* the component module via absolute paths (`/js/theme-toggle.js`), then re-export the populate logic. Net effect: 18 pages all stop linking those modules; the chrome module handles everything.

### 5.6 ES module side effects

`user-pill.js` currently has top-level side effects (auto-binds on DOMContentLoaded). If the Web Component imports it, those side effects fire even when no `<aver-chrome>` is on the page (rare but possible). Two cleanup options:

- A) Refactor `user-pill.js` to export pure functions only; the Web Component calls `bindUserPill()` + `populateUserPill()` from inside `connectedCallback()`. Removes the auto-bind side effect.
- B) Add a guard: `if (!customElements.get('aver-chrome'))` before auto-binding. Hacky.

**Recommendation: A.** Same approach for `theme-toggle.js` (the auto-init lines 254–260).

### 5.7 Testing strategy

Frontend test gate currently runs `node --test` on contract-pin .mjs files (no JSDOM). For a Web Component we need either:

- A) Pin the source (JS module content) the same way other contracts are pinned — works for ~80% of coverage but can't test render output
- B) Add JSDOM + a per-component fixture: `node --test frontend/tests/aver-chrome.test.js` mounts the component into a fake DOM and asserts the rendered shadow tree
- C) Playwright integration tests against the dev server

**Recommendation: A + B.** Source pin for the contract (exports, ARIA attributes, slot names); JSDOM fixture for the render output (the `aver-chrome.test.js` mounts the component, asserts shadow tree shape, simulates click on toggle / dropdown, verifies populate). Playwright is overkill for this scope.

### 5.8 Print stylesheets

No chrome-specific print rules exist today. The Web Component's `:host` could declare `@media print { :host { display: none } }` if Andy wants chrome hidden when printing. Open question for Phase B — recommend leaving chrome visible (matches current behavior).

### 5.9 SSR

None. Project is pure static HTML + client-side JS. Not a concern.

---

## 6. Effort estimate summary

| Sprint | Scope | Estimate | Risk |
|---|---|---|---|
| 7.9 (this PR) | Discovery + design doc | ~2–3h | none |
| 7.10 | Andy Phase B approval | 30 min | none |
| 7.11 | Build `<aver-chrome>` + sentinel + JSDOM test | 3–4h | low |
| 7.12 | Migrate batch 1 (5 skill landings) | 2h | medium |
| 7.13 | Migrate batch 2 (13 sub-pages) | 2h | low |
| 7.14 | Cleanup + Gate 11 candidacy doc | 1–2h | low |
| **Total (7.9 → 7.14)** | | **~10–13h** | — |

Estimate band matches Sprint 7.1 → 7.6 vocab refactor (22h actual / 22h estimated — this is roughly half the scope because chrome is a tighter surface than 3 separate vocab modules).

---

## 7. Recommendation

**Proceed with `<aver-chrome>` Web Component, Shadow DOM, slots-free, auto-fetch user state, batch-phased migration (Sprint 7.11 build → 7.12 batch 1 → 7.13 batch 2 → 7.14 cleanup).**

Rationale:

1. **Drift becomes physically impossible.** 18 markup copies → 1 source file. The Sprint 7.8-hotfix Bug 1 (CSS override) + Bug 2 (missing populate) + Bug 3 (initials inconsistency) classes cannot recur — they were all symptoms of "chrome is copy-pasted, anyone can override anything." Shadow DOM closes both attack surfaces (markup duplication + CSS leakage).

2. **Reusable pattern.** Once `<aver-chrome>` exists, footer / sidebar / shared eyebrow primitives could follow the same template. The component infrastructure (build pattern, test pattern, theme-IIFE-coexistence pattern) becomes a reusable methodology.

3. **Predictable budget.** Discovery → approval → phased → cleanup methodology delivered DEBT-09-B on its 22h budget with 0 hotfixes. Same methodology applied here; expect similar predictability.

4. **No platform risk.** Web Components are W3C standard, all evergreen browsers since 2018, no polyfill, no framework. Same risk class as Sprint 7.3 ES module migration (i.e., none).

5. **Cumulative LOC reduction.** ~40 lines × 18 pages = ~720 lines deleted. Plus ~80 lines of redundant CSS in home.css / vocabulary.css. Plus ~40 lines of per-page inline scripts. Net reduction: ~850 lines. Single chrome module: ~250 lines (markup + style + JS). Net delete: ~600 lines.

6. **Audit hotfix trend reverses.** Codex 9/9 was a markup contract — it caught the surface, not the semantics. The Web Component formalizes "chrome is one thing." Gate 11 candidacy (filed in Sprint 7.7-hotfix + 7.8-hotfix ledger entries) becomes naturally enforceable: "verify chrome by mounting the component once," not "verify chrome by grepping 18 pages."

---

## 8. Phase B questions for Andy

Before Sprint 7.11 build:

1. **Shadow DOM vs Light DOM?** Recommend Shadow DOM (§ 3.1). Trade-off is DevTools inspection ergonomics vs preventing the per-page CSS override drift class.
2. **Attribute name?** Recommend `active` with enum values matching the 5 skills + "none" implicit (§ 3.3). Alternatives: `current`, `page`, `section`.
3. **Slots?** Recommend slots-free for the canonical 18 pages (§ 3.5). Slots can be added later if any future consumer needs override.
4. **User state passthrough method?** Recommend `setUser(...)` method on the custom element (§ 5.3 option A) for the speaking.html / renderUser pattern. Alternatives: slot override, custom event.
5. **Supabase init retry strategy?** Recommend polling `window.getSupabase` (§ 5.2 option 2). Matches existing bootstrap pattern.
6. **Migration order?** Recommend batched (Sprint 7.12 skill landings → 7.13 sub-pages → 7.14 cleanup). Alternative: all 18 atomic in one PR (~4h work + ~2h smoke).
7. **Anything explicitly out of scope?** Recommend: footer/sidebar (separate sprint), eyebrow primitive (already shipped Sprint 6.19), admin pages (separate cluster).

---

## Appendix A — file-tree impact preview

```
frontend/
├── js/
│   └── components/
│       └── aver-chrome.js          # NEW ~250 LOC (Sprint 7.11)
├── tests/
│   └── aver-chrome.test.js          # NEW JSDOM render fixture (Sprint 7.11)
├── css/
│   └── aver-design/
│       └── components.css          # ~150 lines deleted (chrome block) in Sprint 7.14
├── css/
│   ├── home.css                    # ~30 lines deleted (chrome duplicates) in Sprint 7.14
│   ├── vocabulary.css              # ~40 lines deleted (chrome duplicates) in Sprint 7.14
│   └── grammar-wiki.css            # 8 lines deleted (font-family scoping override) in Sprint 7.14
├── pages/
│   ├── home.html                   # ~40 lines deleted, 1 line added (Sprint 7.12)
│   ├── speaking.html               # ~40 lines deleted, 1 line added (Sprint 7.12)
│   ├── practice.html               # ~40 lines deleted, 1 line added (Sprint 7.13)
│   ├── ...                         # 14 more pages, all ~40 lines deleted
└── grammar.html                    # ~40 lines deleted, 1 line added (Sprint 7.12)
```

**Net production-code delta after 7.14:** ~−600 LOC. Test delta: ~+80 LOC (new JSDOM fixture, minus retired chrome pins).

---

*End of Sprint 7.9 discovery. Sprint 7.10 = Andy approval. Sprint 7.11+ = implementation.*
