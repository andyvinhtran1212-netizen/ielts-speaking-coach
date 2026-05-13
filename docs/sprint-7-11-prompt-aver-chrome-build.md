# Sprint 7.11 — Build `<aver-chrome>` Web Component

**Sprint type:** Build sprint (additive only — no page migrations).
**Effort estimate:** 3–4h.
**Prerequisites:** Sprint 7.9 discovery doc (`docs/sprint-7-9-chrome-web-component-discovery.md`) + Sprint 7.10 approval ledger (PHASE_CLOSURE_LEDGER.md Sprint 7.10 row).
**Pattern reference:** Sprint 7.3 my-vocab module build (the first DEBT-09-B implementation sprint — 4 hours actual, on budget).

---

## 1. Scope

**In-scope:**
- NEW `frontend/js/components/aver-chrome.js` (~250 LOC, ES module, Shadow DOM custom element)
- NEW `frontend/tests/aver-chrome.test.js` (JSDOM render fixture, ~80 LOC)
- NEW sentinel pins in `chrome-unification-canonical.test.mjs` for the component contract (source-pin layer)
- CI workflow allowlist update if needed

**Out-of-scope (Sprint 7.12+):**
- Migrating any of the 18 chrome pages
- Modifying `user-pill.js` / `theme-toggle.js` (Sprint 7.12 will refactor those to remove top-level auto-bind; Sprint 7.11 leaves them as-is)
- Deleting `components.css` chrome rules (Sprint 7.14)
- Deleting redundant chrome CSS from `home.css` / `vocabulary.css` / `grammar-wiki.css` (Sprint 7.14)

---

## 2. Phase B approvals (locked, Sprint 7.10)

| # | Decision | Resolution |
|---|---|---|
| Q1 | Shadow DOM vs Light DOM | **Shadow DOM** |
| Q2 | Attribute name | **`active`** with enum `home / writing / speaking / grammar / vocabulary` (none implicit when unset) |
| Q3 | Slots | **Slots-free** (add later if any page actually needs override) |
| Q4 | User state passthrough | **`setUser(data)` method** on the custom element for the `speaking.html` `renderUser` override pattern |
| Q5 | Supabase init retry | **Polling `window.getSupabase`** (defensive against race; matches existing bootstrap pattern) |
| Q6 | Migration order | **Batched** — 7.11 build → 7.12 skill landings (5) → 7.13 sub-pages (13) → 7.14 cleanup |
| Q7 | Out of scope | Footer + sidebar (separate sprint); eyebrow primitive (page-level, Sprint 6.19 shipped); admin pages; marketing index/pricing; anti-flash IIFE stays in `<head>` per page |

---

## 3. Component contract

### 3.1 File layout

```
frontend/
├── js/
│   └── components/
│       └── aver-chrome.js          # NEW (this sprint)
└── tests/
    └── aver-chrome.test.js          # NEW (this sprint, JSDOM fixture)
```

### 3.2 Public API

```js
// frontend/js/components/aver-chrome.js

/**
 * <aver-chrome active="speaking"></aver-chrome>
 *
 * Custom element rendering the canonical Aver Learning chrome
 * (top nav + brand + skill tabs + theme toggle + user pill +
 * logout dropdown) into its Shadow DOM. Single source of truth —
 * replaces the ~40-line chrome block previously copy-pasted across
 * 18 pages.
 *
 * Page contract:
 *   - <head> must run the anti-flash IIFE (sets [data-theme] on <html>
 *     before any stylesheet loads)
 *   - <body> must include <script src=".../supabase-js"> + api.js +
 *     initSupabase(...) BEFORE this component connects (component
 *     polls window.getSupabase for up to ~3s)
 *
 * Attributes:
 *   active="home" | "writing" | "speaking" | "grammar" | "vocabulary"
 *     Highlights the matching skill tab. Unset = no highlight (admin /
 *     auth surfaces). Reactive — observed via attributeChangedCallback.
 *
 * Methods (imperative API for page-level override):
 *   setUser({ name?, initials?, email? })
 *     Overwrites the pill name + avatar. Used by speaking.html
 *     renderUser() which fetches /auth/me for permissions context.
 *     If called BEFORE the auto-fetch completes, marks the pill as
 *     page-authoritative and skips the auto-fetch.
 *
 * Custom events:
 *   av-chrome-signed-out
 *     Dispatched (bubbles, composed) right before the redirect to
 *     /index.html. Pages can listen for cleanup (cancel polls, etc).
 *
 * Anti-flash + theme:
 *   The anti-flash IIFE in <head> sets [data-theme] synchronously.
 *   This component's Shadow DOM <style> uses `var(--av-*)` tokens
 *   that resolve from <html data-theme>, so the chrome paints with
 *   the correct theme on first frame. The theme toggle button inside
 *   the shadow root delegates to /js/theme-toggle.js's
 *   bindToggleButton() — same module that already powers the 18
 *   per-page bindings; no change to that module this sprint.
 */
export class AverChrome extends HTMLElement {
  static get observedAttributes() { return ['active']; }
  constructor() { ... }
  connectedCallback() { ... }
  disconnectedCallback() { ... }
  attributeChangedCallback(name, prev, next) { ... }
  setUser(data) { ... }
}

customElements.define('aver-chrome', AverChrome);
```

### 3.3 Shadow tree structure

The shadow root MUST render byte-equivalent markup to the canonical chrome (`chrome-unification-canonical.test.mjs` reference). Verbatim structure inside `shadowRoot`:

```html
<style>/* Inline stylesheet — see § 3.4 */</style>

<div class="topnav-wrap">
  <nav class="topnav" aria-label="Primary">
    <a href="/pages/home.html" class="brand">Aver<span class="dot">.</span>Learning</a>

    <div class="nav-links">
      <a href="/pages/home.html" data-tab="home">Trang chủ</a>
      <a href="/pages/writing-dashboard.html" data-tab="writing">Writing</a>
      <a href="/pages/speaking.html" data-tab="speaking">Speaking</a>
      <a href="/grammar.html" data-tab="grammar">Grammar</a>
      <a href="/pages/vocabulary.html" data-tab="vocabulary">Vocabulary</a>
      <span class="locked" aria-disabled="true">Reading</span>
      <span class="locked" aria-disabled="true">Listening</span>
    </div>

    <div class="topnav-right">
      <button class="av-theme-toggle" id="theme-toggle" type="button" aria-label="Chuyển giao diện sáng/tối">
        <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
        </svg>
        <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      </button>

      <div class="user-menu">
        <button class="user-pill" id="user-pill" type="button"
                aria-haspopup="true" aria-expanded="false" aria-label="Menu hồ sơ">
          <span class="avatar" id="user-avatar">·</span>
          <span id="user-pill-name">…</span>
        </button>
        <div class="user-menu-dropdown" role="menu" hidden>
          <a href="/pages/profile.html" class="user-menu-item" role="menuitem">Hồ sơ</a>
          <button type="button" class="user-menu-item user-menu-item--danger"
                  id="user-menu-logout" role="menuitem">Đăng xuất</button>
        </div>
      </div>
    </div>
  </nav>
</div>
```

The `active` attribute reactively sets `class="active"` on the `<a>` whose `data-tab` matches (clearing it from all others). When unset, no link carries the class.

### 3.4 Inline stylesheet

Copy verbatim from `frontend/css/aver-design/components.css` lines 741–923 (the `.topnav-wrap` / `.topnav` / `.brand` / `.nav-links` / `.av-theme-toggle` / `.user-pill` / `.user-menu` / `.user-menu-dropdown` / `.user-menu-item` block + the `@media (max-width: 720px)` mobile breakpoint) PLUS the `.av-theme-toggle .icon-sun` / `.icon-moon` swap rules from lines 116–122.

Wrap the whole block in a `:host { display: block; }` rule at the top so the custom element behaves as a block-level container (it's a top-of-page chrome — needs to take full width).

Token references (`--av-*`) resolve from `<html data-theme>` and cross the shadow root boundary natively per CSS Custom Properties Module Level 1. **No change to `tokens.css` needed.**

> **Don't remove the rules from `components.css` this sprint** — pages still use them until Sprint 7.12+ migrations. Sprint 7.14 deletes the duplication.

### 3.5 Behavior — `connectedCallback()`

1. Attach shadow root (`{ mode: 'open' }`).
2. Render the template (markup + inline `<style>`).
3. Apply the `active` attribute (highlight matching tab).
4. `bindToggleButton(this.shadowRoot.getElementById('theme-toggle'))` — delegate to `theme-toggle.js`. The shadow-tree element is a regular `<button>` from the binding API's perspective; theme-toggle.js doesn't care about the shadow boundary.
5. Bind dropdown — same logic as `user-pill.js bindUserPill()` but operating on `this.shadowRoot.getElementById('user-pill')` instead of `document.getElementById('user-pill')`.
6. Bind logout — call `window.getSupabase().auth.signOut()`, dispatch `av-chrome-signed-out` event, redirect.
7. Schedule `_populateFromSupabase()`:
   - If `_userOverride === true` (someone called `setUser()` before `connectedCallback` settled), skip.
   - Else poll `window.getSupabase` every 50ms for up to 60 tries (~3s).
   - On first hit: `getSupabase().auth.getSession()` → write pill name + avatar with canonical 2-letter initials.
   - On timeout: silently leave placeholders. Log warning. Don't break.

### 3.6 Behavior — `setUser(data)` method

```js
setUser({ name, initials, email } = {}) {
  // Marks the pill as page-authoritative — auto-fetch will skip on its
  // first tick if this runs before connectedCallback settles, OR will
  // be overridden if this runs after.
  this._userOverride = true;

  const resolvedName = name || (email && email.split('@')[0]) || 'bạn';
  const resolvedInitials = initials || canonicalInitials(resolvedName);

  const pillEl = this.shadowRoot.getElementById('user-pill-name');
  const avatarEl = this.shadowRoot.getElementById('user-avatar');
  if (pillEl) pillEl.textContent = resolvedName.length > 14
    ? resolvedName.slice(0, 13) + '…' : resolvedName;
  if (avatarEl) avatarEl.textContent = resolvedInitials;
}
```

`canonicalInitials()` is imported from `/js/user-pill.js` (already exports it post Sprint 7.8-hotfix).

### 3.7 Behavior — `attributeChangedCallback(name, prev, next)`

Only `active` is observed. On change:
1. Find the `<a data-tab="...">` in `this.shadowRoot` whose `data-tab` matches `next` (case-sensitive).
2. Remove `class="active"` from any link that has it.
3. Add `class="active"` to the matching link (if any).
4. If `next` is invalid (not in the 5-skill enum) or unset, no link carries `active` — safe default for admin / auth surfaces.

### 3.8 Behavior — `disconnectedCallback()`

1. Run the teardown returned by `bindToggleButton()` (it returns a teardown function per `theme-toggle.js` § ── Button binding ──).
2. Remove the dropdown click listener (use `AbortController` pattern to avoid leaking).
3. Clear any pending Supabase polling timer.

---

## 4. Test strategy

### 4.1 Source-pin layer — extend `chrome-unification-canonical.test.mjs`

Add a new describe block "Sprint 7.11 — `<aver-chrome>` component contract" with these pins:

- `frontend/js/components/aver-chrome.js` exists
- Exports `AverChrome` class extending `HTMLElement`
- `static get observedAttributes() { return ['active']; }` — attribute name matches Phase B Q2 approval
- Defines element via `customElements.define('aver-chrome', AverChrome)`
- Imports `bindToggleButton` from `/js/theme-toggle.js`
- Imports `canonicalInitials` from `/js/user-pill.js`
- Shadow tree HTML (template literal) contains the canonical chrome markup — assert presence of: brand wordmark with `<span class="dot">.</span>`, all 5 nav-links with `data-tab` attrs, both locked spans, theme-toggle button with both SVG icons, user-pill button + dropdown + 2 menu items (Hồ sơ link + Đăng xuất button)
- Inline `<style>` block contains the canonical token references (`var(--av-fs-lg)`, `var(--av-primary)`, `var(--av-text-primary)`, etc.)
- `setUser` method exists on the prototype
- No `window.*` globals leaked
- ARIA attributes preserved (`aria-label="Primary"`, `role="menu"`, `aria-haspopup="true"`, etc.)

### 4.2 Render-fixture layer — NEW `frontend/tests/aver-chrome.test.js`

JSDOM-based. Mount the component into a fake DOM, assert behavior:

```js
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('<aver-chrome> render + interaction', () => {
  let dom, window, document, customElements;

  before(async () => {
    dom = new JSDOM('<!DOCTYPE html><html data-theme="light"><body></body></html>', {
      url: 'https://example.com/pages/speaking.html',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
    });
    ({ window } = dom);
    ({ document, customElements } = window);

    // Mock window.getSupabase for the auto-fetch path
    window.getSupabase = () => ({
      auth: {
        getSession: async () => ({
          data: { session: { user: { email: 'vinh@test.com', user_metadata: { display_name: 'Vinh Tran' } } } },
        }),
        signOut: async () => {},
      },
    });

    // Load the component into the JSDOM window
    const src = readFileSync('frontend/js/components/aver-chrome.js', 'utf8');
    // Adjust import paths for JSDOM — replace /js/theme-toggle.js with mocks
    // ...
  });

  test('renders canonical chrome into shadow root', () => {
    const el = document.createElement('aver-chrome');
    el.setAttribute('active', 'speaking');
    document.body.appendChild(el);

    const shadow = el.shadowRoot;
    assert.ok(shadow);
    assert.ok(shadow.querySelector('.topnav-wrap'));
    assert.ok(shadow.querySelector('a.brand'));
    assert.equal(shadow.querySelectorAll('.nav-links > a').length, 5);
    assert.equal(shadow.querySelectorAll('.nav-links > span.locked').length, 2);
  });

  test('active attribute highlights matching tab', () => {
    const el = document.createElement('aver-chrome');
    el.setAttribute('active', 'speaking');
    document.body.appendChild(el);

    const active = el.shadowRoot.querySelector('a.active');
    assert.ok(active);
    assert.equal(active.dataset.tab, 'speaking');
  });

  test('attribute change reactively re-highlights', () => {
    const el = document.createElement('aver-chrome');
    el.setAttribute('active', 'speaking');
    document.body.appendChild(el);
    el.setAttribute('active', 'writing');

    const active = el.shadowRoot.querySelector('a.active');
    assert.equal(active.dataset.tab, 'writing');
  });

  test('setUser({ name }) writes pill text + canonical 2-letter initials', () => {
    const el = document.createElement('aver-chrome');
    document.body.appendChild(el);
    el.setUser({ name: 'Vinh Tran' });

    const pill = el.shadowRoot.getElementById('user-pill-name');
    const avatar = el.shadowRoot.getElementById('user-avatar');
    assert.equal(pill.textContent, 'Vinh Tran');
    assert.equal(avatar.textContent, 'VT');
  });

  test('setUser truncates long names at 14 chars', () => {
    const el = document.createElement('aver-chrome');
    document.body.appendChild(el);
    el.setUser({ name: 'A very long display name that overflows' });

    const pill = el.shadowRoot.getElementById('user-pill-name');
    assert.ok(pill.textContent.endsWith('…'));
    assert.equal(pill.textContent.length, 14);
  });

  test('auto-fetch from Supabase populates pill when no override', async () => {
    const el = document.createElement('aver-chrome');
    document.body.appendChild(el);
    // wait for poll to settle
    await new Promise((r) => setTimeout(r, 100));

    const pill = el.shadowRoot.getElementById('user-pill-name');
    const avatar = el.shadowRoot.getElementById('user-avatar');
    assert.equal(pill.textContent, 'Vinh Tran');
    assert.equal(avatar.textContent, 'VT');
  });

  test('setUser before connect marks page-authoritative — auto-fetch skipped', async () => {
    const el = document.createElement('aver-chrome');
    el.setUser({ name: 'Manual Override' }); // before append
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 100));

    const pill = el.shadowRoot.getElementById('user-pill-name');
    assert.equal(pill.textContent, 'Manual Over…' /* or 'Manual Override' if ≤14 */);
  });

  test('theme toggle click flips data-theme', () => {
    const el = document.createElement('aver-chrome');
    document.body.appendChild(el);
    const toggle = el.shadowRoot.getElementById('theme-toggle');
    toggle.click();
    assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
  });

  test('user-pill click toggles dropdown hidden state', () => {
    const el = document.createElement('aver-chrome');
    document.body.appendChild(el);
    const pill = el.shadowRoot.getElementById('user-pill');
    const dropdown = el.shadowRoot.querySelector('.user-menu-dropdown');

    assert.ok(dropdown.hasAttribute('hidden'));
    pill.click();
    assert.ok(!dropdown.hasAttribute('hidden'));
    pill.click();
    assert.ok(dropdown.hasAttribute('hidden'));
  });

  test('Escape key closes open dropdown', () => {
    const el = document.createElement('aver-chrome');
    document.body.appendChild(el);
    const pill = el.shadowRoot.getElementById('user-pill');
    pill.click();

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    const dropdown = el.shadowRoot.querySelector('.user-menu-dropdown');
    assert.ok(dropdown.hasAttribute('hidden'));
  });

  test('disconnectedCallback cleans up listeners + timers', () => {
    const el = document.createElement('aver-chrome');
    document.body.appendChild(el);
    document.body.removeChild(el);
    // No assertion needed if cleanup is correct — if leaks, subsequent tests
    // fail. Run smoke: dispatch another click, assert no error.
    assert.doesNotThrow(() => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    });
  });
});
```

**JSDOM dependency:** project doesn't currently bundle JSDOM. Sprint 7.11 must add it as a dev dependency or vendor a minimal shim. **Decision deferred to Sprint 7.11 Phase A audit** — check if Node 20+'s `node:test` runner has any built-in DOM shim (it doesn't, but verify). If JSDOM addition is too heavy, fall back to source-pin layer only + manual smoke (Sprint 7.12 will catch render issues during page migration).

### 4.3 CI workflow

Add `frontend/tests/aver-chrome.test.js` to `.github/workflows/backend-tests.yml` allowlist alongside the existing test files.

---

## 5. Phase breakdown

| Phase | Scope | Effort |
|---|---|---|
| **A** | Audit JSDOM addition (vendor vs npm-install vs source-pin-only fallback) | 30 min |
| **B** | Code synthesis — write `aver-chrome.js` (extract CSS from components.css, mirror template structure, port bind-logic from user-pill.js + theme-toggle.js) | 1.5–2h |
| **C** | Tests — write source-pin extensions + JSDOM fixture (or source-pin-only if Phase A defers JSDOM) | 1–1.5h |
| **D** | Smoke — load a test fixture HTML page in browser, verify mount + active state + theme toggle + populate (no migration of real pages yet) | 30 min |
| | **Total** | **3–4h** |

---

## 6. Acceptance criteria

- [ ] `frontend/js/components/aver-chrome.js` exists with `AverChrome` class + `customElements.define('aver-chrome', ...)` registration
- [ ] Shadow root renders byte-equivalent canonical chrome markup
- [ ] `active` attribute reactively highlights matching tab
- [ ] `setUser(data)` method writes pill + avatar via canonical 2-letter initials
- [ ] Auto-fetch populates from Supabase session when no override
- [ ] Theme toggle works (delegates to `theme-toggle.js`)
- [ ] Dropdown opens / closes / Escape closes / outside-click closes
- [ ] Logout fires `av-chrome-signed-out` event + Supabase signOut + redirect
- [ ] All chrome ARIA attributes preserved
- [ ] Source-pin sentinels added to `chrome-unification-canonical.test.mjs`
- [ ] JSDOM render fixture added (or source-pin-only fallback documented in PR)
- [ ] Frontend gate green (full CI allowlist + new fixture)
- [ ] **Zero page migrations** — 18 chrome pages unchanged this sprint
- [ ] PHASE_CLOSURE_LEDGER.md Sprint 7.11 row + audit count unchanged at 16
- [ ] Smoke fixture: `frontend/tests/fixtures/aver-chrome-smoke.html` proves the component mounts standalone

---

## 7. NO scope creep

- ❌ Don't migrate any of the 18 chrome pages
- ❌ Don't delete chrome rules from `components.css`
- ❌ Don't refactor `user-pill.js` (auto-bind removal) — Sprint 7.12+ scope
- ❌ Don't refactor `theme-toggle.js` (auto-init removal) — Sprint 7.12+ scope
- ❌ Don't add slots (Phase B Q3 = slots-free)
- ❌ Don't add Light DOM variant (Phase B Q1 = Shadow DOM only)
- ❌ Don't add footer / sidebar / eyebrow primitives (Phase B Q7)

---

## 8. Pre-push verification

Sprint 7.3 lesson — grep for stale references before pushing:

```bash
grep -rn "aver-chrome" .github/ package.json 2>&1 | head -20
```

Confirm:
- `aver-chrome.test.js` added to `backend-tests.yml` allowlist
- No other workflow files reference the component (none expected — there's only one CI workflow)

---

## 9. PR title

`feat(chrome): build <aver-chrome> Web Component (Sprint 7.11 — phase 2/5)`

(Numbering: Sprint 7.10 = phase 1 approval; 7.11 = phase 2 build; 7.12 = phase 3 batch 1; 7.13 = phase 4 batch 2; 7.14 = phase 5 cleanup.)

---

## 10. After Sprint 7.11 merged

Sprint 7.12 prompt: migrate batch 1 (5 skill landing pages):
- `home.html`, `speaking.html`, `writing-dashboard.html`, `vocabulary.html`, `grammar.html`
- Per page: replace ~40-line chrome block with `<aver-chrome active="...">`, delete inline theme-toggle binding script, delete user-pill.js script tag, delete inline Lucide MutationObserver, smoke
- Effort ~2h
- Component already proven by Sprint 7.11 — risk is per-page smoke, not architecture

---

*End of Sprint 7.11 prompt. Sprint 7.11 = additive build sprint, zero migration. Sprint 7.12+ migrates pages once the component is locked-in.*
