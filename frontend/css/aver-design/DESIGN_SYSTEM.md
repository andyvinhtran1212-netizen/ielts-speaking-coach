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


## 14. Phase 1–3 hybrid state — what migrated, what remains

The app is in a **HYBRID state**. Phases 1–3 are complete (Sprints 6.3 → 6.12b, May 2026): **13 learner-facing pages + 1 shared component** have migrated to the Aver Design System with full light + dark theme support. The remaining legacy surface is the marketing + admin + Grammar Wiki cluster (Phase 4). Both systems coexist via the `body.av-page` opt-in pattern.

This section is the canonical reference for the migration state — Codex audit Phase 1 AMBER #2 closure (Sprint 6.6.1).

### 14.1 Redesigned pages (Phases 1 – 3)

| Phase | Page | Sprint | PR | Notes |
|---|---|---|---|---|
| 1 | `frontend/pages/home.html` | 6.3 | #121 | First page on `--av-*`, established the canonical anti-flash IIFE |
| 1 | `frontend/pages/speaking.html` | 6.4 / 6.4.1 / 6.4.2 | #123 / #124 / #125 | Closes DEBT-2026-05-10-A; contrast hotfix lessons folded into UNIFIED_DESIGN_BRIEF.md § 11 |
| 1 | `frontend/pages/practice.html` | 6.5 / 6.5.1 | #127 / #128 | Light + dark from day 1; ds.css legacy override pattern (UNIFIED_DESIGN_BRIEF.md § 12) |
| 1 | `frontend/pages/result.html` | 6.6 / 6.6.1 | #130 / #131 | Surgical migration on inline-JS rendering; IIFE normalized |
| 2 | `frontend/pages/writing-dashboard.html` | 6.7 / 6.7.1 | #132 / #133 / #134 | Surgical migration on 1060-line teacher-assignment workflow (2 tabs / 6-state pill / submit modal); Tailwind utility overrides under body.av-page; Sprint 6.7.1 closed AMBER on hardcoded #ffffff CTA text |
| 2 | `frontend/pages/writing-result.html` | 6.8 | #135 | Surgical migration on 671-line graded-essay view (5 states / 5 tabs / sticky header / tier-aware Instructor copy); 87-color writing-renderers.css migrated to tokens; Era A/B reconcile premise falsified by pre-work (backend uniformly v2.1) |
| 2 | `frontend/pages/full-test-result.html` | 6.9 | #136 | Phase 2 closure — surgical migration on 611-line mock-test summary (3 sessions in one view, Chart.js radar, 25 JS-coupled IDs); first page to apply the Chart.js A.2 theme-aware pattern reused from Sprint 6.4.1 (getComputedStyle + MutationObserver on `[data-theme]` re-renders the radar so axes/dataset/tooltip track the active theme) |
| 3 | `frontend/pages/vocabulary.html` | 6.10 | #138 | Phase 3 page 1 — surgical migration on the 4-tab iframe landing (Sprint 6.0 PR #115 / 6.0.1 PR #116). `vocab-landing.js` test seam untouched. DEBT-2026-05-09-B (iframe → module extraction) remains **deferred** — pre-work confirmed no un-defer triggers fired. Iframe children stay legacy dark-only until Sprint 6.11 migrates them and adds same-origin localStorage theme propagation. |
| 3 | `frontend/pages/my-vocabulary.html` | 6.11a | #140 | Phase 3 page 2 — surgical migration on the Personal Vocab Bank (400-line page, 710-line JS). Sprint 6.0.1 embedded-mode IIFE preserved byte-identical (pinned by `embedded-mode.test.js`). All JS-coupled selectors preserved: 5 states, 7 filter buttons, 4 source badges, 2 mastery pills, 8 vocab-action variants, 2 modals, manual add form, stats bar exports, `window._myVocab` test seam. `cardHtml` + `flashToast` template-literal inline styles migrated to class hooks (mv-def-block / mv-context / mv-toast--*). The JS-rendered `_renderPreviewModal` was left on legacy dark styling and **closed in Sprint 6.11b**. |
| 3 | `frontend/pages/flashcards.html` | 6.11b | #141 | Phase 3 page 3 — surgical migration on the Phase D Wave 2 stack-list page (286-line HTML / 408-line JS). Sprint 6.0.1 IIFE preserved; JS-coupled contract intact (`#fc-container`, `#fc-modal`, 11 modal field IDs, 4 chip categories, `.stack-card[data-stack-id]`, `#fc-toast`). Preview-error template literal migrated to `.fc-preview-error` class. `btn-primary` CTA routes through `--av-text-on-primary` (Sprint 6.7.1). |
| 3 | `frontend/pages/exercises.html` | 6.11b | #141 | Phase 3 page 4 — surgical migration on the drill hub (227-line HTML, inline feature-flag gating script preserved byte-identical). Default-deny DOM removal for `card-d1` / `card-flashcards` / `card-d3` and the `/auth/me` flag-check contract are unchanged. |
| 3 | `js/my-vocabulary.js` `_renderPreviewModal` | 6.11b | #141 | Phase 3 cleanup — closes the Sprint 6.11a documented seam. ~15 inline `style="…"` template-literal emissions in `_renderPreviewModal` migrated to class hooks (`mv-preview-modal`, `mv-preview-modal__panel/__close`, `mv-preview-face/face--front/face--back/face__label/face__headword`, `mv-preview-ipa`, `mv-preview-def-vi/-en`, `mv-preview-example`, `mv-preview-context`, `mv-preview-no-back`). The `#fc-preview-close` ID + event wiring preserved byte-identical. |
| 3 | `frontend/pages/profile.html` | 6.12a | #142 | Phase 3 final cluster page 1 of 2 — surgical migration on the standalone profile route (498-line page; ~140-line inline `<style>` + ~165-line inline JS at the bottom). NOT iframe-embedded (opened from `home.html → user-pill`), so no Sprint 6.0.1 IIFE. All 21 JS-coupled IDs preserved (`header-avatar`/`-initials`, `profile-avatar`/`-initials`/`-avatar-img`/`-display-name`/`-email`/`-joined`, 3 stat cards, `profile-form`, 4 form inputs, `band-btns`, `level-options`, `goal-display`, `btn-save`, `toast`); 4 `.level-card[data-level]` options + `saveProfile()` onclick + `window.saveProfile` global + BANDS array + GET/PATCH `/auth/profile` + GET `/auth/me` fallback all unchanged. Toast `style.background = isError ? '#dc2626' : '#0D7377'` migrated to `.pf-toast--error` class toggle. Spec ZIP claimed 3 tabs / Chart.js / password / sign-out / access-code forms — pre-work falsified all five; production is a single linear form. |
| 3 | `frontend/onboarding.html` | 6.12b | #143 | **Phase 3 closure** — surgical migration on the post-signup 3-step wizard (442-line page; ~75-line inline `<style>` + ~177-line inline state machine). At the frontend root, NOT `/pages/`. All 14 JS-coupled IDs preserved (`step-label`, `step-pct`, `progress-fill`, `error-banner`, `step-1`/`-2`/`-3`, `btn-back`, `btn-next`, `nav-row`, `target-band`, `exam-date`, `level-cards`, `topic-cards`); 4 level + 3 topic `.opt-card[data-value]` options; `currentStep`/`goingBack`/`stepData` state preserved; `.step-panel.active`/`.slide-back` animation hooks renamed to `ob-slide-in`/`ob-slide-back` keyframes; PATCH `/auth/profile` (5 fields incl. `onboarding_completed: true`) + GET `/auth/me` already-onboarded redirect + login-guard + submit redirect to `pages/home.html?first_topic=…` all byte-identical. Error banner migrated from inline `style.display = 'block'` to `.show` class. **Production typo `#14a8ae` (used in 3 places) normalized to `--av-primary` — the intended `#14b8a6` was off by a digit.** typography-tier1 `TIER_1_PAGES` list now empty; sentinel test pins emptiness. |
| 4 | `frontend/index.html` | 6.13a + 6.13a-ext | #145 + #146 | **Phase 4 opening — marketing landing.** Sprint 6.13a (PR #145): surgical migration on the canonical landing/login entry (667-line page). Drops Inter for Plus Jakarta Sans + JetBrains Mono; replaces 37 Tailwind palette + inline hex literals with `--av-*` tokens. Conversion flow preserved: CTAs to `/login.html` / `/grammar.html` / `/pricing.html` / `/frontend/pages/home.html` + section anchors + pricing `display:none` pre-launch hide. Hero + final CTA + footer are intentionally "always-dark" atmosphere (whitelist `color: #FFFFFF` per Gate 4). **Atomic Era B reconciliation:** `frontend/landing.html` orphan deleted in PR #145; sentinel test pins no-resurrection. Sprint 6.13a-extension (PR #146): repositioned content from single-skill Speaking-only to **multi-skill platform** (Speaking + Writing + Vocabulary + Grammar). New `.ix-skill-card[data-skill]` 4-card grid replaces the 3-Speaking-feature section; skill-specific terminology lifted from production redesigned pages (Part 1/2/3 + Full Test, Task 1/Academic+GT, Quên/Khó/Dễ/Đã thuộc SRS, Roadmap+Articles). Speaking/Writing/Vocabulary cards route to `/login.html` (auth-gated); Grammar Wiki card routes to `/grammar.html` (public). "How it works" steps reframed for multi-skill workflow. /login.html CTA count went 8 → 10+ (added skill-card CTAs). Pre-work falsified 5 marketing-specific risks (no SEO meta, no analytics, no A/B infra, no cookie banner, no auth-state-aware CTA — page is a pure static splash). |
| 4 | `frontend/pricing.html` | 6.13b | #147 | **Phase 4 page 2 — marketing pricing.** Surgical migration on the 766-line Era B pricing page (`#1B3A5C` / `#0D7377` / Inter). Drops Inter for Plus Jakarta Sans + JetBrains Mono; replaces Tailwind navy/teal palette + inline hex with `--av-*` tokens. **Page-level redirect preserved:** `window.location.replace('/')` at the top of `<head>` keeps the page hidden pre-launch — canonical IIFE follows it idempotently so the post-launch theme bootstrap is already wired when marketing removes the redirect. All 11 JS-coupled IDs preserved (`btn-monthly`, `btn-yearly`, `yearly-badge`, `yearly-note`, `price-student`/`-sub`/`-yearly-note`, `price-intensive`/`-sub`/`-yearly-note`, `faq-list`). Monthly/yearly toggle JS unchanged except the active-button class swap (`bg-white text-navy shadow-sm` → `pr-toggle__btn--active`); `PRICES` const (student 299K↔239K, intensive 499K↔399K), `formatPrice` helper, and `setMonthly`/`setYearly` state machine byte-identical. FAQ accordion JS preserved byte-identical (`.faq-trigger` → `.faq-body.open` + `.faq-chevron.open`). Tier content byte-identical: Miễn phí (0đ) / Học viên (299K popular) / Intensive (499K). All 12 CTA destinations preserved (5 `/login.html`, 4 `https://zalo.me/0000000000`, 2 `/pricing.html` self-refs, 2 `/grammar.html`, 1 `/`, plus `/#features` deep links). Final CTA + footer follow the "always-dark" atmosphere whitelist (literal `#FFFFFF` permitted per Gate 4). |
| 4 | `frontend/pages/admin-writing.html` | 6.14a | #149 | **Phase 4 admin sprint 1/4 — small writing cluster, page 1/4.** Surgical migration on the 74-line writing-coach admin hub (Era A header band + legacy navy body + Inter → `--av-*` tokens + Plus Jakarta Sans). **`WC.bootstrap()` (writing-admin.js, 100 lines) preserved byte-identical** — the shared admin auth contract across this cluster: 4 canonical state IDs (`state-loading`, `state-denied`, `state-ready`, `header-email`) gate the page until `/auth/me` confirms `role === 'admin'`. 4 hub card links unchanged: `/pages/admin-writing-new.html`, `/pages/admin-writing-grade.html`, `/pages/admin-instructor-queue.html`, `/pages/admin-students.html`. Theme-aware (light default + dark toggle) — first admin page on the design system, opens the `aw-*` class namespace + shared `frontend/css/admin-writing.css` that powers all 4 pages in this sprint. |
| 4 | `frontend/pages/admin-writing-new.html` | 6.14a | #149 | **Phase 4 admin sprint 1/4 — small writing cluster, page 2/4.** Surgical migration on the 250-line paste-essay submission form. All 14 form IDs preserved (`f-student`, `f-task-type`, `f-level`, `f-model`, `f-prompt`, `f-essay`, `word-count`, `alert-area`, `btn-submit`, `essay-form`, plus 4 state-* IDs). `WC.bootstrap({onReady})` shape preserved — the callback initializes the student picker, word counter, and submit handler. POST `/admin/writing/essays` payload shape byte-identical (`student_id` + `task_type` + `analysis_level` + `selected_model` + `form_of_address` + `grading_tier` + `prompt_text` + `essay_text`). 2 radio groups preserved byte-identical: form-of-address (bạn/em/anh/chị, `em` default checked) and grading_tier (standard default / deep / instructor — Sprint 2.7a tier picker). Form-of-address chrome moved from raw inline styles to `.aw-foa-pill` with click-driven `.aw-foa-pill--checked` toggle. Success path redirects to `/pages/admin-writing-status.html?essay_id=…` unchanged. |
| 4 | `frontend/pages/admin-writing-status.html` | 6.14a | #149 | **Phase 4 admin sprint 1/4 — small writing cluster, page 3/4.** Surgical migration on the 183-line grading-progress poller. All 13 IDs preserved (4 state-* + `status-pill`, `status-text`, `elapsed`, `progress-bar`, `eta-text`, `error-box`, `error-msg`, `link-essay`, `btn-view`). Polling JS preserved byte-identical: `POLL_INTERVAL_MS = 5000`, `TERMINAL` map (graded/reviewed/delivered/failed), `STATUS_DISPLAY` map (6 statuses), `deepGradingMessage` helper (Sprint 2.7b 3-pass rotation), GET `/admin/writing/essays/{id}/status` endpoint. Inline pill `style.background`/`style.color` migrated to `data-status` attribute that drives CSS color-mix variants (`pending` → warning, `grading` → info, terminal → success, `failed` → error). Pulse keyframe namespaced to `aw-pulse` to avoid global-CSS clash. `WC.notify('Bài chấm xong', …)` first-terminal-state notification preserved. |
| 4 | `frontend/pages/admin-writing-prompts.html` | 6.14a | #149 | **Phase 4 admin sprint 1/4 — small writing cluster, page 4/4 (outlier).** Surgical migration on the 465-line prompts CRUD page. **Outlier — does NOT call `WC.bootstrap()`.** Inline Supabase init via `SUPABASE_URL` + `SUPABASE_ANON` + `initSupabase()` preserved byte-identical (the page is rewrite-routed under `/admin/writing/prompts` and `js/api.js` resolves rewrite-agnostically via absolute `/js/api.js`). All 28+ JS-coupled IDs preserved (`filter-task-type`, `filter-difficulty`, `btn-create`, 4 state-* equivalents, full modal contract: `modal`, `modal-title`, `btn-close-modal`, `modal-error`, 5 form-* IDs, image-upload contract with 6 IDs incl. `form-image-file`/`-url`/`-public-id`, `btn-cancel`, `btn-save`). All 4 CRUD endpoints preserved: GET / POST / PATCH / DELETE `/admin/writing/prompts` + Cloudinary upload endpoint. Image-section visibility logic tied to `task1_academic` preserved. Soft-delete `confirm('Tắt prompt này?')` preserved. |

Properties of every redesigned page:

- **Token namespace:** `--av-*` (canonical going forward; `frontend/css/aver-design/tokens.css`)
- **Typography:** Plus Jakarta Sans (body) + JetBrains Mono (numerics)
- **Theme:** Light default + dark toggle, persisted via `localStorage['av-theme']`. Anti-flash IIFE (validated, see § 13) sets `[data-theme]` on `<html>` synchronously before any stylesheet loads
- **Component library:** `.av-*` classes from `frontend/css/aver-design/components.css`
- **Theme runtime:** `frontend/js/theme-toggle.js` (8 named exports, `VALID_THEMES = ['light', 'dark']` validator that the IIFE mirrors)

### 14.2 Legacy pages (pre-redesign)

All other pages still render on the Sprint 6.2 dark-navy era:

- `frontend/pages/dashboard.html`
- `frontend/admin.html` (~3,667 lines, partial `--ds-*` use)
- `frontend/grammar.html` + Grammar Wiki cluster (6 pages on DM Sans + Lora intentionally)

All Tier 1 learner-facing pages have migrated — the `typography-tier1.test.js` `TIER_1_PAGES` list is empty as of Sprint 6.12b. The sentinel test in that file catches any future Tier 1 regression.

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
| Phase 3 | 6.10 – 6.12b ✅ | `vocabulary.html` (6.10 ✅), `my-vocabulary.html` (6.11a ✅), `flashcards.html` + `exercises.html` + `_renderPreviewModal` (6.11b ✅), `profile.html` (6.12a ✅), `onboarding.html` (6.12b ✅) — **closure** |
| Phase 3 audit closure | 6.12c ✅ | Documentation drift closures (3 AMBER) + § 17 audit checklist gates formalized |
| Phase 4 | 6.13 – 6.15 | **In progress.** Sprint 6.13a: `index.html` ✅ (also deletes Era B `landing.html` orphan). Sprint 6.13b: `pricing.html` ✅. Sprint 6.14 pre-work (PR #148) inventoried 9 admin pages + 4-sprint Option C grouping. Sprint 6.14a: small writing admin cluster ✅ (4 pages: `admin-writing.html`, `admin-writing-new.html`, `admin-writing-status.html`, `admin-writing-prompts.html`). Sprint 6.14b: table pages (assignments + students). Sprint 6.14c: instructor queue + grading. Sprint 6.14d: `admin.html` monolith. Sprint 6.15: Grammar Wiki cluster. |

When the last legacy page migrates, `ds.css` is retired and the `--ds-*` token namespace is removed. The `.av-page` opt-in becomes redundant and gets dropped in a cleanup sprint.

### 14.6 Audit history

- `DESIGN_AUDIT_REPORT.md` (repo root, gitignored) — Phase 1 inventory
- `CODEX_AUDIT_PHASE_1.md` (repo root, gitignored) — Codex Phase 1 ship audit; AMBER findings (IIFE drift + architecture doc stale) closed in Sprint 6.6.1
- `CODEX_AUDIT_PHASE_2.md` (repo root, gitignored) — Codex Phase 2 ship audit; 2 AMBER findings (brief/test drift + central architecture-insights placement) + 2 pattern formalization recommendations closed in Sprint 6.9.1


## 15. Pre-work discipline pattern (formalized Sprint 6.9.1)

**Origin:** Sprint 6.8 introduced the mandatory pre-work phase after Sprint 6.7's spec mismatch (self-directed vs teacher-assignment writing-dashboard). Sprint 6.9 reused the pattern. Codex audit Phase 2 recommends formalization so future redesign sprints don't have to rediscover it.

### 15.1 When to apply

Pre-work is **mandatory** before implementing a redesign for any page with **any** of these traits:

- Complex inline JS (> 200 lines)
- Multi-state state machine
- Dual-shape or version-tolerant rendering
- Permission gating logic
- Chart.js or canvas-based UI elements
- An entry-point dependency that varies by mode/tier/role

For trivially static pages (e.g., a marketing page with no JS), pre-work is optional but still encouraged.

### 15.2 The 7-step checklist

```
Step 1 — File structure inventory
  • Total lines + file size (bytes)
  • Inline <style> block lines + color counts (rgba(), hex)
  • Inline JS lines
  • External CSS/JS files linked (note CDN vs local)

Step 2 — JS-coupled selector inventory
  • All element IDs the JS targets (grep id="...")
  • data-* attributes the JS reads
  • Render function names + state machine IDs
  • onclick / inline handlers

Step 3 — Page-specific contracts
  • URL params (e.g., ?session_id, ?p1=&p2=&p3=)
  • Entry-point dependencies (which page hands users off here, with what URL shape)
  • Backend endpoint contracts (route + query + body shape + response shape)

Step 4 — Permission gating pattern verification
  • UI banner element? (e.g., #writing-preview-banner)
  • JS gating function name?
  • Or server-authoritative only?
  • Required permission key in the access-code shape?

Step 5 — External dependency check
  • Tailwind utility classes consumed (which ones, where)
  • Chart.js / canvas dependencies and how they integrate
  • ds.css legacy class consumption (which .ds-* classes does the JS emit?)

Step 6 — Backend coordination check
  • Era / parser version stamping
  • Schema version compatibility with current production
  • Migration history relevant to the data shape

Step 7 — Comparison with precedent pages
  • Reusable patterns from earlier sprints (link the Sprint/PR)
  • Differences that require new work
  • A.1 vs A.2 decisions for theme-aware behavior (see § 16)
```

### 15.3 Output format

Generate the pre-work summary **before** committing implementation. Paste it into the PR description draft under a `## Pre-work findings` heading:

```markdown
## Pre-work findings

### File structure
[lines, size, inline <style> count, inline JS count]

### JS-coupled contract
[IDs, data-*, function list, onclick handlers]

### Migration scope
[rgba count, hex count, external CSS scope, ds-* classes consumed]

### Permission gating
[Pattern verified: banner + JS gate / server-only / none]

### Comparison with Sprint X.Y
[Reusable patterns documented, e.g., "reusing Chart.js A.2 from Sprint 6.4.1"]

### Specific concerns
[Concerns flagged for user decision before scope is locked]

## Scope recommendation
[Option A / B / C with rationale + effort estimate]
```

### 15.4 Outcome evidence (Phase 2 sprints)

| Sprint | Pre-work catch | Time saved |
|---|---|---|
| 6.7 | Self-directed vs teacher-assignment IA mismatch (spec proposed a self-directed dashboard; production is teacher-assignment) | ~4–6h of invented work |
| 6.8 | Era A/B reconcile premise falsified (backend stamps uniformly v2.1; renderer already era-tolerant) | ~4h of invented work |
| 6.9 | Chart.js A.2 precedent identified in Sprint 6.4.1 (`_tokenColor` + `MutationObserver` already shipped) | ~1.5h of reinvention |

Pre-work has paid back its investment **every sprint in Phase 2**. The 30–60 min spent on pre-work consistently saves multiples of that in avoided rework.

### 15.5 Anti-pattern

❌ **Don't skip pre-work to "save time."** Phase 2 evidence shows pre-work consistently saves multiples of its cost.

❌ **Don't paraphrase spec assumptions in pre-work.** Verify against production code, DB schema, or shipped JS — not against what the spec claims.

❌ **Don't bury findings in pin-test comments.** Pre-work findings that have architectural implications belong in `UNIFIED_DESIGN_BRIEF.md` (per-page contracts) or this file (cross-page patterns), not only in `*.test.mjs` comments.


## 16. Chart.js theme-aware rendering recipe (A.2 pattern)

**Origin:** Sprint 6.4.1 (speaking.html line + radar charts on the dashboard) → Sprint 6.9 (full-test-result.html pronunciation radar) reuse. Codex audit Phase 2 recommends formalization so the next chart-bearing page doesn't reinvent the pattern (or skip it).

### 16.1 The problem

Chart.js draws to `<canvas>`. The canvas API cannot consume CSS custom properties — passing `'var(--av-primary)'` as a `borderColor` renders as the literal string and Chart.js falls back to undefined/black. So tokens must be **resolved to their computed value at draw time**, and the chart must be **re-rendered when the theme changes** so the resolved values track the active palette.

### 16.2 A.1 vs A.2 — pick A.2 by default

| Option | Cost | Behavior on theme toggle |
|---|---|---|
| **A.1** Leave literals + log DEBT | 0 lines of JS | Chart keeps its baked-in palette → looks dark-themed in light mode, or vice-versa. Visual inconsistency, sometimes a contrast failure inside the widget. |
| **A.2** Read tokens + re-render | ~30 lines of JS | Chart palette flips immediately with the rest of the page. Theme-consistent. |

**Default to A.2.** Use A.1 only when pre-work documents a specific reason (e.g., the chart lives in an iframe whose theme is owned by the parent, or the chart is third-party and not under our control).

### 16.3 Canonical recipe (lift verbatim)

The pattern below is shipped in `frontend/pages/speaking.html` (Sprint 6.4.1) and `frontend/pages/full-test-result.html` (Sprint 6.9). Lift the four building blocks into your page:

```javascript
// 1. Token reader — Chart.js cannot consume CSS vars directly, so
//    resolve them at draw time. Trim because the cascade preserves
//    leading whitespace from the source declaration.
function _tokenColor(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name).trim() || '#888';
}

// 2. Cache the last payload so theme-flip can re-render without
//    re-fetching the data.
var _lastPayload = null;
var _chart = null;

// 3. Build / rebuild the chart from tokens resolved RIGHT NOW.
function renderChart(payload) {
  _lastPayload = payload;
  var ctx = document.getElementById('my-chart').getContext('2d');
  if (_chart) _chart.destroy();
  _chart = new Chart(ctx, {
    type: 'radar', // or line/bar/etc.
    data: {
      labels: payload.labels,
      datasets: [{
        data: payload.values,
        backgroundColor: _tokenColor('--av-primary-soft'),
        borderColor:     _tokenColor('--av-primary'),
        pointBackgroundColor: _tokenColor('--av-primary'),
        pointBorderColor:     _tokenColor('--av-surface-elevated'),
      }],
    },
    options: {
      scales: {
        r: {
          ticks:       { color: _tokenColor('--av-text-faint') },
          grid:        { color: _tokenColor('--av-border-default') },
          angleLines:  { color: _tokenColor('--av-border-default') },
          pointLabels: { color: _tokenColor('--av-text-secondary') },
        },
      },
      plugins: {
        tooltip: {
          backgroundColor: _tokenColor('--av-surface-elevated'),
          titleColor:      _tokenColor('--av-text-secondary'),
          bodyColor:       _tokenColor('--av-text-primary'),
          borderColor:     _tokenColor('--av-border-default'),
          borderWidth: 1,
        },
      },
    },
  });
}

// 4. Re-render hook + MutationObserver wiring (in <script type="module">
//    at the bottom of <body>, so the canonical IIFE has already set
//    data-theme before this runs).
function refreshChart() {
  if (_lastPayload) renderChart(_lastPayload);
}
window._myPage = window._myPage || {};
window._myPage.refreshChart = refreshChart;

var html = document.documentElement;
var lastTheme = html.getAttribute('data-theme');
new MutationObserver(function () {
  var t = html.getAttribute('data-theme');
  if (t !== lastTheme) {
    lastTheme = t;
    refreshChart();
  }
}).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
```

### 16.4 Token reference for chart styling

Use the same semantic ladder Chart.js elements would otherwise hardcode. The defaults below match what Sprint 6.4.1 and Sprint 6.9 ship.

| Chart element | Token | Notes |
|---|---|---|
| Primary dataset fill | `--av-primary-soft` | Translucent so overlapping datasets stay legible |
| Primary dataset border / line | `--av-primary` | Solid brand color |
| Point background | `--av-primary` | Matches the line so points read as part of the curve |
| Point border / outline | `--av-surface-elevated` | Reads as a "halo" around each point in both themes |
| Radar grid / angle lines | `--av-border-default` | Stronger than `--av-border-subtle` because grid lines compete with the dataset |
| Tick labels (axis numbers) | `--av-text-faint` | Auxiliary — counts against the § 11 cap of ≤10 references |
| Axis labels (radar pointLabels, line x/y) | `--av-text-secondary` | Primary readable axis labels |
| Tooltip background | `--av-surface-elevated` | Matches `--av-surface-card` siblings |
| Tooltip title | `--av-text-secondary` | Meta-level inside the tooltip |
| Tooltip body | `--av-text-primary` | Most readable text in the tooltip |
| Tooltip border | `--av-border-default` | |

For line charts, also resolve `--av-text-muted` for x/y tick labels (Sprint 6.4.1 uses this for the band-trend chart).

### 16.5 Anti-patterns

❌ **Don't hardcode chart colors as literals.** They won't track theme toggles, and they're a silent contrast bug in the off-theme palette.

❌ **Don't read CSS vars only at initial render** and call it done. The values need to be resolved fresh on every theme flip, which means the rebuild path has to run again.

❌ **Don't use Chart.js without the MutationObserver hook** on `[data-theme]`. The IIFE applies the theme synchronously before paint, but `theme-toggle.js` flips it mid-session — without the observer, the chart freezes on whichever palette it first rendered with.

### 16.6 Sprint precedent

- Sprint 6.4.1 (PR #124) — speaking.html `chart-line` + `chart-radar` — first ship of the pattern.
- Sprint 6.9 (PR #136) — full-test-result.html `pron-radar` — first deliberate reuse; lifted the helper signature byte-identical.

When the next chart-bearing page needs theme support, lift from these two — don't reinvent.


## 17. Audit checklist gates (formalized Sprint 6.12c)

**Origin:** Codex audit Phase 3 AMBER #3 (PR #143 ship audit, 2026-05-11). Sprint 6.10.1 caught cumulative drift across 6 prior redesigned pages — BEM-style icon classes shipped with no matching CSS rule, leaving BOTH sun + moon SVGs visible stacked. Codex Phase 1 and Phase 2 audits **missed** this because they verified IIFE *behavior* (theme persistence + system-preference fallback) but never IIFE *rendering correctness* (does the icon actually swap visually). That is a documented blind spot.

This section formalizes the audit gates a Codex reviewer (or a maintainer running self-audit before merge) should walk through for every per-page redesign and every Phase-closure audit. The gates are intentionally narrow — they pin patterns where drift has already happened once.

### 17.1 Standing audit gates

Apply every gate below to every per-page redesign audit. If a gate doesn't apply (e.g., Gate 6 on a non-iframe page), mark it N/A in the audit report rather than silently skipping.

#### Gate 1: JS contract preservation

- [ ] Every element `id` consumed by JS is preserved byte-identical
- [ ] Every `data-*` attribute consumed by JS is preserved byte-identical
- [ ] Render-function names + global handlers (`window.saveProfile`, `window._myVocab`, etc.) unchanged
- [ ] State-machine transitions (`currentStep`, `_ftAllSessionIds`, etc.) unchanged
- [ ] Backend endpoint contracts (path + payload shape) unchanged
- [ ] `localStorage` key names preserved (`av-theme`, `av-onboarding-progress`, etc.)

**Why this matters:** The 13 Phase 1–3 migrations are surgical. A renamed ID or a coerced field shape would surface as a runtime regression, not a visual one, so audits must spot it before merge.

#### Gate 2: Canonical theme infrastructure (§ 13)

- [ ] Canonical anti-flash IIFE present in `<head>` before any stylesheet `<link>`
- [ ] Validates stored value (`(stored === 'light' || stored === 'dark')`)
- [ ] Falls back to `prefers-color-scheme` system preference
- [ ] Wraps `localStorage.getItem` in `try/catch`
- [ ] Catch arm sets `data-theme="light"` (last-resort fallback)
- [ ] For iframe children: Sprint 6.0.1 embedded-mode IIFE runs FIRST, canonical theme IIFE runs AFTER (no collision; `embedded-mode.test.js` still passes)

#### Gate 3: Theme toggle icon rendering (NEW — Sprint 6.10.1 blind-spot closure)

This gate exists because Codex Phase 1 + 2 audits passed pages that were visually broken — the IIFE worked, but both sun + moon SVGs rendered simultaneously because the toggle button used BEM classes that components.css never styled.

- [ ] HTML uses canonical `.icon-sun` + `.icon-moon` class names on the two SVGs inside `.av-theme-toggle`
- [ ] **Zero BEM drift variants** in markup or CSS — none of `theme-toggle__icon`, `av-theme-toggle__icon--sun`, `av-theme-toggle__icon--moon`, `av-theme-toggle__sun`, `av-theme-toggle__moon`
- [ ] `components.css` lines ~78–82 own the visibility swap; page CSS does NOT redefine it
- [ ] Visual verification: light theme shows ONLY sun; dark theme shows ONLY moon. No stacking, no flicker on toggle

**Detection commands:**

```bash
# Page markup: no BEM drift
grep -E "theme-toggle__icon|av-theme-toggle__sun|av-theme-toggle__moon" frontend/pages/<page>.html

# Page CSS: does NOT redefine the canonical swap
grep -E "\.av-theme-toggle\s+\.icon-(sun|moon)\s*\{[^}]*display\s*:" frontend/css/<page>.css
```

Both should return 0 matches. Both are pinned by `theme-toggle-icon-canonical.test.mjs` — if that suite fails on a page added to its `REDESIGNED_PAGES` list, this gate is failing.

#### Gate 4: Color migration discipline

- [ ] No hardcoded `color: #...`, `color: white`, or `color: black` in the page's CSS file (runtime paths only — `@media print` exceptions documented per UNIFIED_DESIGN_BRIEF.md § 12.5 are OK)
- [ ] CTA text routes through `--av-text-on-primary` (Sprint 6.7.1 — never hardcode `#ffffff` because the value flips between themes)
- [ ] `--av-text-faint` references stay ≤ 10 combined across HTML + page CSS (Sprint 6.4.2 anti-pattern guard — `text-faint` fails AA contrast)
- [ ] Semantic role mapping: pick the token by what the text *is* (heading, helper, meta, em-dash), not by what its legacy opacity *was*

**Detection commands:**

```bash
# No hardcoded runtime colors
grep -E "^\s*color:\s*(#[0-9a-fA-F]{3,6}|white|black);" frontend/css/<page>.css

# CTAs route through --av-text-on-primary
grep -E "\.(btn|av-button)[^{]*\{[^}]*color:" frontend/css/<page>.css
```

The first should return 0 (or only documented `@media print` exceptions). The second should show every CTA rule referencing `var(--av-text-on-primary)`.

#### Gate 5: `ds.css` legacy override pattern (Sprint 6.5.1 lesson)

`ds.css` is the bridge between the dark-navy legacy era and the Aver Design System. It carries hardcoded `#fff` + `rgba(255,…)` rules invisible on the light-theme cream surface. Redesigns must **override locally** under `body.av-page`, never patch the shared sheet.

- [ ] `ds.css` not modified by this PR (last legitimate edit: Sprint 6.2.1 font hotfix)
- [ ] If the redesigned page consumes legacy classes (`.ds-band-*`, `.ds-crit*`, etc.), the page CSS overrides them under `body.av-page { ... }` scope
- [ ] The override block is commented with `Sprint 6.5.1 ds.css override pattern` (or equivalent)

**Verification:**

```bash
git log --oneline -- frontend/css/ds.css | head -5
```

#### Gate 6: Iframe embedded-mode preservation (if applicable)

Only applies to iframe-child pages (currently `my-vocabulary.html`, `flashcards.html`, `exercises.html`).

- [ ] Sprint 6.0.1 IIFE (`?embedded=1` → adds `html.embedded-mode`) is the FIRST `<script>` in `<head>`
- [ ] `embedded-mode.css` is linked
- [ ] Canonical theme IIFE runs AFTER the embedded-mode IIFE, both before stylesheets
- [ ] `embedded-mode.test.js` still passes (7/7 pins)

#### Gate 7: Pre-work documentation (§ 15 lesson)

- [ ] Pre-work findings recorded in the PR body (steps 1–8 from § 15.2)
- [ ] Spec-assumption falsifications listed explicitly (e.g., "ZIP claimed X — production has Y")
- [ ] Scope rationale stated (Option A surgical vs Option B refactor — and why)

### 17.2 Brand-color regression guard

Sprint 6.12b discovered a production typo (`#14a8ae` in 3 places where `#14b8a6` was intended) that pre-migration testing never surfaced because the typo rendered as "close enough to teal." The migration eliminated it by routing through `--av-primary`. Standing check:

```bash
grep -rn "#14a8ae" frontend/ backend/
```

Should return 0 matches. Any reappearance is either (a) the same typo recurring or (b) someone copy-pasting historical context — in either case it's worth a quick `git blame` + fix.

### 17.3 Sentinel tests — verify these pass during audit

The following suites pin canonical patterns. An audit should confirm all of them still pass on the audited branch:

| Suite | Pins | Sprint |
|---|---|---|
| `frontend/tests/anti-flash-iife-canonical.test.mjs` | Canonical IIFE compliance + DESIGN_SYSTEM § 13/14 narrative integrity | 6.6.1 |
| `frontend/tests/theme-toggle-icon-canonical.test.mjs` | Icon class drift (NEW Sprint 6.10.1 gate) + per-page CSS no-duplicate-of-canonical-swap | 6.10.1 |
| `frontend/tests/typography-tier1.test.js` | `TIER_1_PAGES` emptiness sentinel (Phase 3 closure) — catches any page reverting to Manrope+Fraunces | 6.12b |
| `frontend/tests/embedded-mode.test.js` | Sprint 6.0.1 iframe contract — byte-identical IIFE on the 3 iframe-child pages | 6.0.1 |

Plus the per-page `*-redesign.test.mjs` for the page under audit (`profile-redesign`, `onboarding-redesign`, `flashcards-redesign`, etc.).

### 17.4 Anti-pattern: audit blind spots

❌ **Don't verify "theme works" only by checking IIFE behavior.** Codex Phase 1 + 2 passed pages whose IIFE was correct but whose icon-swap CSS was missing. The icon swap is a separate gate (Gate 3).

❌ **Don't trust spec assumptions without pre-work verification.** Sprint 6.12a falsified five ZIP-reference claims (tabs / Chart.js / password / sign-out / access-code) and Sprint 6.12b falsified two more (localStorage progress / skip option). Audit reports that simply quote the spec back are not doing the work.

❌ **Don't accept "shared" CSS file comments at face value.** Sprint 6.8 found `writing-renderers.css` was annotated as shared but was de-facto single-consumer. The audit method is to grep for actual imports, not to trust the file's docstring.

❌ **Don't skip documentation table maintenance.** Codex Phase 3 AMBER #1 + #2 were both pure documentation drift — the kind that compounds into "we have three partially overlapping stories" if not cleaned at each phase boundary.

### 17.5 When to extend this section

Add a new gate when any of the following happens:

- An audit (Codex or self-audit) discovers a cumulative-drift pattern that prior audits missed (Gate 3 came from this trigger)
- A production bug surfaces during migration and gets normalized via the token system (§ 17.2 came from this trigger)
- A new canonical pattern is formalized in DESIGN_SYSTEM.md (Chart.js A.2 from § 16, pre-work from § 15, etc.) — the gate verifies adherence to the pattern

When extending, name the originating sprint + finding in the gate's preamble so future readers know what the gate is defending against.
