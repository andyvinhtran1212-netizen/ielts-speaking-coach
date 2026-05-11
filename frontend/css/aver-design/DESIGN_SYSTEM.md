# Aver Learning Design System

> Foundation sprint: 2026-05-09. This document defines the design language used by every page that opts into the unified system. It is the source of truth — when the codebase and this doc disagree, fix the codebase.

---

## 1. Brand identity

| Aspect | Direction |
|---|---|
| Voice | Vietnamese-first, "warm teacher" tone. Patient, encouraging, never condescending. |
| Pronouns | Speak to the student as `bạn` (informal-respectful "you"). The AI grader speaks in third person ("the model thinks..."), never "I". |
| Casing | Sentence case throughout. Never Title Case headlines, never ALL CAPS body text. Uppercase reserved for short labels (`STREAK`, `TUẦN NÀY`) where the wide tracking earns it. |
| Mood | Calm, professional, encouraging. The student is preparing for an exam — the surface should reduce anxiety, not amplify it. |
| Avoid | Emoji confetti, gamification fanfare, generic "AI assistant" framing. Avoid the visual tropes the `frontend-design` skill calls out (Inter, purple gradients, predictable card grids). |

---

## 2. Theme system

### 2.1 Light + dark are both first-class

Both themes are equally supported. The user can toggle anytime. Neither is the "real" design.

| Theme | Purpose | Mood |
|---|---|---|
| **Light** (default for new users) | Welcoming, editorial, hub-style | Spacious, calm, magazine-like |
| **Dark** | Focus mode for active learning | Quiet, professional, low-fatigue for long sessions |

### 2.2 Resolution priority

When the page boots, the active theme is decided in this order:

1. **User's explicit choice** — `localStorage` key `av-theme` set to `"light"` or `"dark"`
2. **System preference** — `window.matchMedia('(prefers-color-scheme: dark)')`
3. **Light** — final fallback

The mechanism is implemented by `frontend/js/theme-toggle.js` plus an inline IIFE in `<head>` that runs before any stylesheet loads (anti-flash).

### 2.3 Implementation

- Tokens live in `frontend/css/aver-design/tokens.css` — single source for both themes.
- The active theme is signaled by `[data-theme="light"]` or `[data-theme="dark"]` on `<html>`.
- Components reference `--av-*` tokens only — **no hardcoded colors**. Switching `[data-theme]` flips every component automatically.
- The theme toggle (`.av-theme-toggle`) sits in the page nav, near the user menu. Single icon-button, swaps sun↔moon glyph based on active theme.
- `aria-label` updates dynamically in Vietnamese: `"Chuyển sang giao diện sáng"` / `"Chuyển sang giao diện tối"`. `aria-pressed` reflects the active theme.

### 2.4 Anti-flash pattern

Every redesigned page MUST include this **inline IIFE in `<head>`, before any stylesheet `<link>`**:

```html
<script>
  (function () {
    try {
      var stored = localStorage.getItem('av-theme');
      var prefersDark = window.matchMedia &&
                        window.matchMedia('(prefers-color-scheme: dark)').matches;
      var theme = (stored === 'light' || stored === 'dark')
                  ? stored
                  : (prefersDark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', theme);
    } catch (e) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  })();
</script>
```

The IIFE is synchronous — it runs and applies `data-theme` before the browser parses any subsequent `<link rel="stylesheet">`. No flash of wrong theme.

After the page loads, `theme-toggle.js` calls `initTheme()` which adds `theme-loading` to `<html>` for one frame to suppress transitions during initial paint, then removes it.

### 2.5 Per-page checklist

Every page that opts into the system MUST:

- [ ] Include the inline anti-flash IIFE in `<head>` before any `<link>` to a stylesheet
- [ ] Link `tokens.css` BEFORE `components.css`
- [ ] Link any page-specific stylesheet AFTER `components.css`
- [ ] Place `.av-theme-toggle` button in the navigation header
- [ ] Use `--av-*` tokens; no hardcoded colors
- [ ] Render correctly in both themes — visually verify before merging

---

## 3. Typography

### 3.1 Stack

| Role | Font | Why |
|---|---|---|
| Body | **Plus Jakarta Sans** | Geometric-humanist sans, distinctive without being eccentric, strong Vietnamese diacritic rendering |
| Mono | **JetBrains Mono** | Tabular numerals (band scores, streak counts, timer countdowns) need true mono |
| Display | Plus Jakarta Sans (700/600) | Single family for headings; emphasis comes from weight + size, not a separate display face |

Avoid: Inter, Roboto, Arial, Helvetica, system-ui as the primary face. The `frontend-design` skill flags these as generic "AI slop" choices.

### 3.2 Vietnamese typography

Vietnamese text carries diacritics above and below the baseline. Default leading must accommodate them without collision.

- Body line-height defaults to **1.55** (`--av-lh-normal`). Don't go tighter for paragraphs.
- Long-form reading (results, articles) uses **1.7** (`--av-lh-relaxed`).
- Display headings can go to **1.2** (`--av-lh-tight`) but only at sizes ≥ `--av-fs-3xl`.
- **Avoid uppercase on long Vietnamese strings** — accent marks become illegible. Reserve uppercase for short labels (≤ 3 words).
- Test every page with sample strings containing rich diacritics: `"Học viên đang luyện tập"`, `"Đã hoàn thành phần thi"`, `"Tất cả các kỹ năng IELTS"`.

### 3.3 Type scale

Defined as `--av-fs-xs` through `--av-fs-5xl` in `tokens.css`. 16px base, ratio ~1.125 (compact for app UI; not editorial 1.25).

---

## 4. Color

The full token catalog lives in `tokens.css`. Highlights:

| Concept | Light | Dark | Notes |
|---|---|---|---|
| Page surface | `#FAFAF9` warm off-white | `#0A1628` deep navy | Warm both ways — not clinical white, not gray-on-black |
| Card surface | `#FFFFFF` | `#112236` slightly raised navy | One step elevated from page |
| Primary | `#0F766E` (teal-700) | `#14B8A6` (teal-500) | Lighter shift on dark for AA contrast |
| Accent | `#F59E0B` amber-500 | `#FBBF24` amber-400 | Same hue, slight value shift |

### Text tokens — semantic tiers + WCAG contrast

Choose the token by **semantic role**, not by what the legacy opacity number was. Per Sprint 6.4.1 → 6.4.2 lesson (see `UNIFIED_DESIGN_BRIEF.md` § 11), opacity-driven migration ships invisible text on light theme. Verified contrast is against `--av-surface-page`.

| Token | Light | Dark | Contrast (light / dark) | When to use |
|---|---|---|---|---|
| `--av-text-primary`   | `rgba(15,23,42,0.92)` | `rgba(241,245,249,0.95)` | ~13.8:1 / ~17.5:1 — AAA | Body, headings, page titles |
| `--av-text-secondary` | `rgba(15,23,42,0.68)` | `rgba(241,245,249,0.72)` | ~6.0:1  / ~7.8:1  — AAA | Helper text, eyebrow labels, sub-content |
| `--av-text-muted`     | `rgba(15,23,42,0.50)` | `rgba(241,245,249,0.55)` | ~4.6:1  / ~5.6:1  — AA  | Meta info, durations, counts, empty states |
| `--av-text-faint`     | `rgba(15,23,42,0.32)` | `rgba(241,245,249,0.32)` | ~3.0:1  ⚠️ fails AA     | Em-dashes, disabled state, placeholders only |

`--av-text-faint` is auxiliary-only. Use it when the user reads adjacent primary copy first (em-dash next to a band score, timestamp next to an article title) — never as the sole content of an element.

**Never hardcode** these values in component CSS. Always reference the token. If a new shade is needed, add it to `tokens.css` first.

### Inverse-on-brand text — `--av-text-on-primary`

CTA buttons place text on the brand-colored `--av-primary` background. The correct text color is **not** a member of the 4-tier semantic ladder above — those are for text on page/card surfaces. Use the dedicated inverse token:

| Token | Light | Dark | When to use |
|---|---|---|---|
| `--av-text-on-primary` | `#FFFFFF` | `#0A1628` | Text on `var(--av-primary)` background (CTA buttons, primary action chips) |

The token value **flips between themes** because the brand surface flips: in light the CTA is deep teal `#0F766E` (so text is white), in dark the CTA is bright teal `#14B8A6` (so text is deep navy for AA contrast). Hardcoding `color: #ffffff` on a CTA renders **correctly in light but wrong in dark** — white text on bright teal fails AA. Always use the token.

**Anti-pattern (Codex audit Sprint 6.7 AMBER #1):**

```css
/* ❌ Wrong — breaks dark theme contrast */
.btn-start-assignment {
  background: var(--av-primary);
  color: #ffffff;
}

/* ✅ Right — theme-aware via the token */
.btn-start-assignment {
  background: var(--av-primary);
  color: var(--av-text-on-primary);
}
```

`.av-button-primary`, `.btn-primary`, `.btn-start-assignment`, `.wd-modal-btn-submit` all consume this token. Any future CTA on a primary background should too.

---

## 5. Spacing

4px base scale: `--av-space-1` (4) through `--av-space-24` (96). Skip 5/7/9/10/11/13/14/15 deliberately to enforce scale discipline. If 24px isn't enough between two elements, use 32px (`--av-space-8`), not 28px.

Common patterns:

- Card padding: `--av-space-6` (24px)
- Stack between cards: `--av-space-4` (16px)
- Section margin: `--av-space-12` (48px)
- Form field gap: `--av-space-3` (12px)

---

## 6. Border radius

Five steps: `sm` (4) / `md` (8) / `lg` (12) / `xl` (16) / `2xl` (24) / `pill` (999). Cards default to `lg`, modals to `xl`, buttons to `md`, badges to `pill`.

---

## 7. Components

The `.av-*` namespace is documented inline in `components.css`. Catalog:

| Component | Class | Variants |
|---|---|---|
| Theme toggle | `.av-theme-toggle` | (single) |
| Button | `.av-button` | `-primary`, `-secondary`, `-tertiary`, `-destructive`, `-icon`, size `-sm` `-lg` |
| Card | `.av-card` | `-interactive`, `-elevated`, `-flat`, `-locked` |
| Stat | `.av-stat-block` | `.is-streak` modifier for amber emphasis |
| Badge | `.av-badge` | `-neutral`, `-primary`, `-success`, `-warning`, `-error`, `-locked`, `-used-well`, `-needs-review` |
| Tabs | `.av-tabs` + `.av-tab` | `[aria-selected]` / `.is-active` |
| Forms | `.av-input`, `.av-select`, `.av-textarea`, `.av-label`, `.av-help-text`, `.av-error-text`, `.av-check` | — |
| Modal | `.av-modal-backdrop` + `.av-modal` | `-header`, `-body`, `-footer` |
| Audio | `.av-recorder` (`.is-recording` state), `.av-player` | — |
| Feedback | `.av-feedback-card`, `.av-feedback-criterion`, `.av-feedback-band`, `.av-correction`, `.av-sample-answer` | — |
| Toast | `.av-toast` | `.is-shown` state |

Class names are deliberately distinct from the legacy `.btn-primary`, `.skill-card`, `.tab-btn`, `.main-tab-btn`, `.essay-card`, `.session-row` names — JS hooks target those, and renaming would break click handlers.

---

## 8. Iconography

- **Lucide CDN** for line icons (sun, moon, mic, check, chevron, etc.). Stroke-width 2, 18-20px in nav, 14-16px inline with text.
- **Brand SVGs** (`logo-mark.svg`, `wordmark.svg`) embedded inline for crisp rendering.
- **Avoid emoji in UI chrome.** Exception: `.av-badge-*` chips for vocab review states (e.g., 🔥 in streak badge) — but only as flair, never as the only signal.

---

## 9. Motion

Three durations: `fast` (150ms), `base` (250ms), `slow` (400ms). Default easing is `cubic-bezier(0.4, 0, 0.2, 1)`. Theme transitions use `base`. Hover micro-interactions use `fast`.

`prefers-reduced-motion: reduce` suppresses transitions on buttons, cards, tabs, recorder, toast.

---

## 10. Accessibility

WCAG AA contrast minimum **in both themes**. Verified against the `--av-text-primary` × `--av-surface-page` pair:

- Light: `rgba(15,23,42,0.92)` on `#FAFAF9` → ~13.8:1 (AAA)
- Dark: `rgba(241,245,249,0.95)` on `#0A1628` → ~17.5:1 (AAA)

Other rules:

- Touch targets ≥ 44×44 px for primary actions
- Every icon-only button has `aria-label` (translated to Vietnamese)
- Theme toggle: `aria-label` + `aria-pressed` both update dynamically
- Focus-visible ring uses `--av-shadow-focus` (3px outer ring, primary color, 25-40% opacity) — visible on both surfaces
- Keyboard navigation: every interactive element reachable via `Tab`; `Enter` and `Space` activate buttons
- Modal focus trap + `Escape` to close (implemented in component JS, not CSS)

---

## 11. Migration plan

### 11.1 New pages

Use `.av-*` classes from day 1. Both themes from day 1. Inline anti-flash IIFE mandatory.

### 11.2 Existing pages

Per-page rewrite, one page per sprint. Priority order is documented in `UNIFIED_DESIGN_BRIEF.md`. The rewrite:

1. Adds `tokens.css` + `components.css` + `theme-toggle.js`
2. Adds inline anti-flash IIFE in `<head>`
3. Replaces page-specific styles with `.av-*` classes where possible
4. **Preserves JS-coupled class names** (`.btn-primary`, `.skill-card`, `.tab-btn`, `.main-tab-btn`, `.essay-card`, `.session-row`, `.skill-cta-primary`, `.skill-cta-secondary`, `.preview-mode-banner`, `.page-moved-banner`, `.btn-test`, `.btn-start`, `.btn-fulltest`, `.btn-locked`) — these are immutable during migration. **Note:** `.skill-card-locked` was previously listed here as a JS-coupled lock class, but the actual homepage runtime uses `.coming-soon` + `data-locked="true"` (rendered by `js/home.js renderSkillCard`); see `UNIFIED_DESIGN_BRIEF.md` § 3.6.1 for the per-page lock-state inventory. Always verify against the page's JS before assuming a lock class.
5. Tests in both themes before merge

### 11.3 Coexistence

`--ds-*` and `--av-*` tokens coexist throughout the migration. `ds.css` continues to ship. Old pages continue to use `--ds-*` until their redesign sprint touches them. There is no "flag day".

Once all pages are migrated, a cleanup sprint removes `ds.css` and the legacy class definitions. Until then: don't rip out the legacy system.

---

## 12. Architectural notes — iframe composition pattern

The vocabulary landing (`/pages/vocabulary.html`) mounts three same-origin app pages — `my-vocabulary.html`, `flashcards.html`, and `exercises.html` — inside `<iframe>` elements (Sprint 6.0 Approach B). The embedded-mode contract (Sprint 6.0.1) hides the child page's nav and "page moved" banner via `html.embedded-mode` so the composed surface reads as one page.

### 12.1 This is a UX composition pattern, NOT a security boundary

The iframes do **not** declare a `sandbox` attribute. Child pages are first-party, same-origin pages we control:

- The auth gate runs in each child page independently — access control is preserved
- Same-origin means parent (`vocabulary.html`) can read/write child DOM and storage freely
- A future XSS or DOM bug in any child page would have full reach into the parent

The pattern is using `<iframe>` as a **composition shortcut** to embed an existing self-contained page into a tab without rewriting it as a module. It is **not** providing isolation.

### 12.2 When to revisit (un-defer triggers)

Module-extraction was the alternative considered (Sprint 6.0 Approach A). It was deferred because the child pages were too self-contained at the time (each carries its own auth bootstrap, Supabase init, modal lifecycle). The iframe pattern stays acceptable while:

- Child pages remain first-party and same-origin
- No sensitive data flows through the iframe boundary that doesn't already flow through the parent
- Mobile performance stays acceptable (currently fine — `loading="lazy"` defers off-tab iframes)

Trigger an architectural revisit when any of these flips — see `TECH_DEBT.md` → `DEBT-2026-05-09-B` for the canonical un-defer trigger list.

### 12.3 What NOT to do as a quick fix

Adding `sandbox="allow-same-origin allow-scripts ..."` to the existing iframes does **not** add isolation — `allow-same-origin` keeps the parent and child in the same origin and reintroduces all the same-origin reach the unprefixed iframe already has. A real isolation boundary requires either:

- Cross-origin iframes (different subdomain), which breaks the auth-gate-runs-in-each-child contract, or
- Genuine module extraction (Approach A), which is the deferred alternative

Until module extraction lands, the iframe approach should be treated as an internal composition tool, not a containment claim.


## 13. Canonical anti-flash theme bootstrap

Every redesigned page MUST embed this exact IIFE in `<head>` BEFORE any stylesheet — it sets `[data-theme]` on `<html>` synchronously so the first paint already matches the user's theme. Without it, the page paints in the default (light) and snaps to dark on the next frame.

```html
<script>
  (function () {
    try {
      var stored = localStorage.getItem('av-theme');
      var prefersDark = window.matchMedia &&
                        window.matchMedia('(prefers-color-scheme: dark)').matches;
      var theme = (stored === 'light' || stored === 'dark')
                  ? stored
                  : (prefersDark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', theme);
    } catch (e) {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  })();
</script>
```

Three properties hold across every page:

1. **The stored value is validated.** Only `'light'` or `'dark'` are passed through; anything else falls through to system preference. This mirrors `VALID_THEMES` in `frontend/js/theme-toggle.js` so the IIFE and the runtime validator agree on what counts as a valid choice.
2. **`window.matchMedia` is tested for existence** before being called — the page still loads in environments without `matchMedia` (very old browsers, headless test runners) and falls back to `'light'`.
3. **`try/catch` wraps the localStorage access.** Privacy-mode browsers and third-party-cookie-blocked contexts throw on `localStorage.getItem`; the catch-all hard-codes `'light'` so the page renders something instead of breaking.

### Anti-pattern (Codex audit Phase 1, AMBER #1)

❌ Don't use the unvalidated short-circuit:

```javascript
var theme = stored
  || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
```

This pattern lets *any* truthy string in `localStorage['av-theme']` flow through to `data-theme`. The CSS today only keys `[data-theme="dark"]`, so a garbage value resolves as light by accident — the page works, but the contract is wrong. The next person who adds an `[data-theme="high-contrast"]` selector inherits a silent bug: stale corrupted entries from a prior session can land users in a half-broken UI. Validate at the IIFE.

### Pin tests

Each per-page redesign suite (`*-redesign.test.mjs`) should pin:

- The IIFE includes a validation check (`(stored === 'light' || stored === 'dark')` or equivalent `validValues.indexOf(stored)` / `VALID_THEMES.includes(stored)`)
- The IIFE has the `try { … } catch { … }` wrapping
- The IIFE falls back to `prefers-color-scheme: dark` when the stored value is missing or invalid
- The IIFE does not use the weak `var theme = stored ||` short-circuit pattern

`frontend/tests/anti-flash-iife-canonical.test.mjs` enforces these properties across every redesigned page in one suite, so a future page that copies an older snippet is caught at the gate.


## 14. Phase 1 hybrid state — what migrated, what remains

The app is in a **HYBRID state** post-Phase 1 (Sprints 6.3 → 6.6.1, May 2026). Four pages have migrated to the Aver Design System with full light + dark theme support; the rest remain on the Sprint 6.2 dark-navy era. Both systems coexist via the `body.av-page` opt-in pattern.

This section is the canonical reference for the migration state — Codex audit Phase 1 AMBER #2 closure (Sprint 6.6.1).

### 14.1 Redesigned pages (Phase 1 + Phase 2 in progress)

| Phase | Page | Sprint | PR | Notes |
|---|---|---|---|---|
| 1 | `frontend/pages/home.html` | 6.3 | #121 | First page on `--av-*`, established the canonical anti-flash IIFE |
| 1 | `frontend/pages/speaking.html` | 6.4 / 6.4.1 / 6.4.2 | #123 / #124 / #125 | Closes DEBT-2026-05-10-A; contrast hotfix lessons folded into UNIFIED_DESIGN_BRIEF.md § 11 |
| 1 | `frontend/pages/practice.html` | 6.5 / 6.5.1 | #127 / #128 | Light + dark from day 1; ds.css legacy override pattern (UNIFIED_DESIGN_BRIEF.md § 12) |
| 1 | `frontend/pages/result.html` | 6.6 / 6.6.1 | #130 / #131 | Surgical migration on inline-JS rendering; IIFE normalized |
| 2 | `frontend/pages/writing-dashboard.html` | 6.7 / 6.7.1 | #132 / #133 / #134 | Surgical migration on 1060-line teacher-assignment workflow (2 tabs / 6-state pill / submit modal); Tailwind utility overrides under body.av-page; Sprint 6.7.1 closed AMBER on hardcoded #ffffff CTA text |
| 2 | `frontend/pages/writing-result.html` | 6.8 | TBD | Surgical migration on 671-line graded-essay view (5 states / 5 tabs / sticky header / tier-aware Instructor copy); 87-color writing-renderers.css migrated to tokens; Era A/B reconcile premise falsified by pre-work (backend uniformly v2.1) |
| 2 | `frontend/pages/full-test-result.html` | 6.9 | TBD | Phase 2 closure — surgical migration on 611-line mock-test summary (3 sessions in one view, Chart.js radar, 25 JS-coupled IDs); first page to apply the Chart.js A.2 theme-aware pattern reused from Sprint 6.4.1 (getComputedStyle + MutationObserver on `[data-theme]` re-renders the radar so axes/dataset/tooltip track the active theme) |

Properties of every redesigned page:

- **Token namespace:** `--av-*` (canonical going forward; `frontend/css/aver-design/tokens.css`)
- **Typography:** Plus Jakarta Sans (body) + JetBrains Mono (numerics)
- **Theme:** Light default + dark toggle, persisted via `localStorage['av-theme']`. Anti-flash IIFE (validated, see § 13) sets `[data-theme]` on `<html>` synchronously before any stylesheet loads
- **Component library:** `.av-*` classes from `frontend/css/aver-design/components.css`
- **Theme runtime:** `frontend/js/theme-toggle.js` (8 named exports, `VALID_THEMES = ['light', 'dark']` validator that the IIFE mirrors)

### 14.2 Legacy pages (pre-redesign)

All other pages still render on the Sprint 6.2 dark-navy era:

- `frontend/index.html` (landing)
- `frontend/pages/dashboard.html`, `pages/profile.html`, `pages/vocabulary.html` (+ Phase B sub-pages)
- `frontend/onboarding.html`
- `frontend/admin.html` (~3,667 lines, partial `--ds-*` use)
- `frontend/grammar.html` + Grammar Wiki cluster (6 pages on DM Sans + Lora intentionally)
- Era B: `pricing.html`

Properties of the legacy era:

- Theme: dark-navy `#0a1628` + `body.ds-canvas` atmosphere overlay (no theme toggle)
- Tokens: `--ds-*` (legacy)
- Typography: Manrope + Fraunces (Tier 1 transition pages) or Inter (Era B landing/pricing)
- Component classes: ad-hoc (`.skill-card`, `.btn-primary`, `.main-tab-btn`, `.tab-btn`, `.essay-card`, `.session-row`) — JS-coupled, immutable
- Icons: mostly emoji (🎤 ✍️ 📚 ✦ 🔥) + some Lucide CDN

### 14.3 Compatibility layer

`frontend/css/ds.css` is retained as the bridge between the two eras. Phase 1 redesigned pages keep linking it because the inline JS in `practice.html` / `result.html` still emits `.ds-band-*` / `.ds-crit*` / `.ds-cue-*` classes. ds.css hardcodes `color: #fff` and `rgba(255,255,255,X)` in many selectors — invisible on the cream light surface — so the redesigned pages override the broken selectors via scoped blocks under `body.av-page` (the **Sprint 6.5.1 ds.css override pattern**, documented in UNIFIED_DESIGN_BRIEF.md § 12).

**ds.css MUST NOT be modified during Phase 2+.** It is shared infrastructure across legacy pages, and a fix targeted at a redesigned page would silently break a legacy one. Override under `body.av-page` instead.

### 14.4 Foundation files

```
frontend/css/aver-design/
  ├── tokens.css              — light + dark theme variables (--av-*)
  ├── components.css          — .av-* component library + .av-page surface
  ├── DESIGN_SYSTEM.md        — design language, canonical IIFE (§ 13), hybrid state (§ 14)
  └── UNIFIED_DESIGN_BRIEF.md — per-page redesign brief + cumulative lessons

frontend/js/
  └── theme-toggle.js         — VALID_THEMES validator, 8 named exports
```

### 14.5 Forward path (Phase 2–4)

| Phase | Sprint range | Pages |
|---|---|---|
| Phase 2 | 6.7 – 6.9 | `writing-dashboard.html`, `writing-result.html`, `full-test-result.html` (closed in Sprint 6.9) |
| Phase 3 | 6.10 – 6.11 | `vocabulary.html` + sub-pages, `profile.html` |
| Phase 4 | 6.12 – 6.14 | Marketing (`index.html`, `pricing.html`), `admin.html`, Grammar Wiki |

When the last legacy page migrates, `ds.css` is retired and the `--ds-*` token namespace is removed. The `.av-page` opt-in becomes redundant and gets dropped in a cleanup sprint.

### 14.6 Audit history

- `DESIGN_AUDIT_REPORT.md` (repo root, gitignored) — Phase 1 inventory
- `CODEX_AUDIT_PHASE_1.md` (repo root, gitignored) — Codex Phase 1 ship audit; AMBER findings (IIFE drift + architecture doc stale) closed in Sprint 6.6.1
