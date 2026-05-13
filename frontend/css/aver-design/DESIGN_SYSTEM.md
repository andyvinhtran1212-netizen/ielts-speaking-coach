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

## 12. Architectural notes — vocabulary module composition (historical)

> **Sprint 7.6 closure note:** This section originally documented the iframe-composition pattern shipped in Sprint 6.0 / 6.0.1 (`vocabulary.html` mounting three child app pages — `my-vocabulary.html`, `flashcards.html`, `exercises.html` — inside `<iframe>` elements, with an embedded-mode IIFE + `embedded-mode.css` hiding the child chrome). **DEBT-2026-05-09-B closed Sprint 7.6** retired the entire pattern: each child is now an ES module under `/js/vocab-modules/*` that exports `mount(container, opts) → { unmount }` and the parent dynamic-imports + mounts it into a `<div class="tab-mount">`. The iframe pattern, the embedded-mode IIFE, and the matching CSS no longer exist anywhere in production.
>
> Cross-reference: `PHASE_CLOSURE_LEDGER.md` Sprint 7.3 → 7.6, `TECH_DEBT.md` → `DEBT-2026-05-09-B (CLOSED)`.

### 12.1 Current pattern — module mount

`vocab-landing.js` declares a `TAB_LOADERS` map keyed by tab name; each value is a `() => import('/js/vocab-modules/X.js')` thunk. On first tab activation the parent calls `mount(container, { embedded: true })` against the imported module. Tabs not in `TAB_LOADERS` (currently only `topic-bank`) are pure CSS reveals — no module load needed.

The module contract (see `_loader.js`):

- `mount(container, opts) → { unmount }`
- `opts.embedded` switches auth-redirect target — embedded calls go to `window.top.location.href` (auth loss is a top-level event); standalone calls go to `window.location.href`
- Idempotent guard via the container's `data-mounted="true"` attribute (cached handle returned on repeat mount calls)
- `unmount()` clears event listeners, cancels timers, releases media, clears innerHTML, clears guard

### 12.2 Why we ended up here

The original Sprint 6.0 Approach B (iframes) was a pragmatic shortcut — child pages were self-contained surfaces (auth bootstrap + Supabase init + modal lifecycle each) and rewriting them as modules would have touched ~600 LOC for an architectural win without immediate product capability. Approach A (modules) was deferred and tracked as `DEBT-2026-05-09-B`.

Sprint 7.1 audited the un-defer triggers (mobile perf concerns, cross-tab live state, future XSS reach, commercial launch prep) and Andy approved the phased 4-sprint migration. Sprint 7.3 / 7.4 / 7.5 / 7.6 executed the conversion incrementally — each sprint shipped one child module + retired its IIFE, and Sprint 7.6 deleted the now-empty iframe code path + `embedded-mode.css`.


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
| 4 | `frontend/pages/admin-writing-assignments.html` | 6.14b | #150 | **Phase 4 admin sprint 2/4 — table pages cluster, page 1/2 (outlier — like prompts).** Surgical migration on the 470-line teacher-assignment-management page. **Outlier — does NOT call `WC.bootstrap()`.** Inline Supabase init preserved byte-identical. Card-list rendering (not a real `<table>`): each assignment renders as a `.aw-card` with status pill, task pill, optional `⏱️ N phút` timer pill, and `auto_submitted` hint. **5-status assignment lifecycle** (`pending` / `in_progress` / `submitted` / `graded` / `delivered`) gets its own `.aw-assign-pill[data-status="…"]` namespace — deliberately separate from the essay-grading `.aw-status-pill` namespace because the two lifecycles don't overlap. 4-step modal preserved byte-identical: prompt picker → student multi-select with search + select-all/clear-all → deadline + instructions → IELTS-mode timer (Phase 2.3c-3). All 22 JS-coupled IDs preserved (incl. `_selectedStudentIds` Set logic + timer-pair client-side validation 1-180 mirroring server `model_validator`). POST `/admin/writing/assignments` payload (prompt_id + student_ids + deadline + instructions + is_timed + time_limit_minutes) unchanged. |
| 4 | `frontend/pages/admin-students.html` | 6.14b | #150 | **Phase 4 admin sprint 2/4 — table pages cluster, page 2/2.** Surgical migration on the 449-line admin student-management page. Uses `WC.bootstrap({onReady})` + 4 state-* IDs. **First true HTML `<table>` in the admin cluster** — opens the new `.aw-table` primitive: 6-column thead (Code / Name / Target / Current / Date / Actions), `tr:hover` accent, monospace `.aw-table__code` cell, `.aw-table__empty` placeholder. Row actions preserved: Tổng quan (Phase 2.5 summary modal) / New Essay (→ admin-writing-new.html) / Edit / Delete. **Two modals:** edit-or-create student (6 form-* IDs: `f-code`, `f-name`, `f-target-band`, `f-current-band`, `f-target-date`, `f-notes`) + Phase 2.5 student summary modal with 4 stat-cards (total / graded / flagged / avg-band-last5) + recent-essays list + recent-assignments list. Search input wrapped in `WC.debounce(…, 300)`. CSV import preserved. Delete confirm preserved with embedded student code + "Tất cả essays … cũng sẽ bị xóa" warning. ESC dismisses summary modal. Establishes `.aw-stat-card` / `.aw-stat-num[--flagged]` / `.aw-stat-label` / `.aw-summary-list[__empty]` / `.aw-mini-pill[--flagged]` primitives for Sprint 6.14c/d reuse. |
| 4 | `frontend/pages/admin-instructor-queue.html` | 6.14c | #151 | **Phase 4 admin sprint 3/4 — instructor queue + grading, page 1/2 (Phase A warmup).** Surgical migration on the 378-line instructor review queue. Uses `WC.bootstrap({onReady:(me)=>…})` to gate the page until `/auth/me` resolves the current instructor identity (needed for `my_claims` filter scope). **7-column HTML `<table>`** (`Submitted` / `Age` / `Student` / `Lvl` / `Task` / `Status` / `Actions`) renders via the new `.aw-queue-table` primitive — denser variant of `.aw-table` for higher-throughput review work. **4 filter buttons** (`all_active` / `queued` / `my_claims` / `delivered`) wire to a `FILTERS` map (statuses + `scopeToMe`) and toggle `.aw-filter-btn--active` on click. **5-state instructor lifecycle pill** gets its own `.aw-instructor-pill[data-status]` namespace (queued / claimed / edited / delivered / released) — separate from `.aw-assign-pill` (assignment lifecycle) and `.aw-status-pill` (grading lifecycle) because all three lifecycles co-exist in this cluster. **Age SLA color coding** via `ageClass(hours)` → `.aw-age-cell--fresh` (≤6h) / `--warning` (6–24h) / `--overdue` (>24h). **30s poll + visibility-aware pause:** `POLL_INTERVAL_MS = 30000`, `setInterval(loadQueue, …)` paused via `document.hidden` on `visibilitychange`. **4 row action variants** (`.aw-btn-act--claim` / `--edit` / `--release` / `--view`) — claim/release call POST `/admin/instructor/reviews/{id}/claim` and `/release`, edit links to `admin-writing-grade.html?essay_id=…`, view is the placeholder for delivered rows. **Locked-by-other state** rendered via `.aw-locked-tag` ("🔒 Locked by another instructor") when `status=claimed && !isMine`. 409 conflict path detects "already claimed" / "cannot claim" and auto-refreshes the queue. `setAlert(kind, msg)` migrated from inline-palette JS to `.aw-alert--{error,success,warn,info}` class hooks (Sprint 6.14a primitive). GET `/admin/instructor/queue?status=…` endpoint preserved. Vietnamese microcopy byte-identical (`đã chấm xong AI Pass 1, chờ giảng viên review`, `Auto-refresh mỗi 30s`, `Bạn chưa claim bài nào.`, `Chưa có bài đã deliver gần đây.`, `Hàng đợi trống. 🎉`, `Đã release. Bài về queue.`, `Bài đã được instructor khác claim. Đang refresh`, `Release claim? Bài sẽ trở về queue cho instructor khác.`). |
| 4 | `frontend/admin.html` | 6.14d-α | #153 | **Phase 4 admin sprint 4/4 — admin monolith, chrome-only migration (STRUCTURALLY COMPLETE).** Surgical migration on the 3,667-line system-wide admin dashboard (10-tab monolith: Topics / Codes / Users / Stats / AI Cost / Sessions / Alerts / Vocab Monitor / Vocab Exercises / Flashcards, plus 2 nested tab systems — Topics Part 1/2/3 + Vocab Exercises draft/published/rejected). **Scope reduced to chrome-only-α** after Phase A pre-work revealed deeper-than-estimated complexity (433-line inline `<style>` + 2,401-line inline JS + Tailwind CDN with custom navy/teal palette + 317 rgba whites + Inter font + hardcoded `body { background: #0a1628 }` dark-navy era). **Sprint 6.14d-β** (Tailwind utility-class refactor — replace `bg-white/10` etc. with admin-*/aw-* primitives, drop Tailwind CDN entirely) and **Sprint 6.14d-γ** (per-tab primitive adoption polish) are **deferred** with un-defer triggers logged in § 14.5. **Foundation:** canonical anti-flash IIFE (§ 13), Plus Jakarta Sans + JetBrains Mono (Inter dropped + Tailwind custom palette config L10-21 dropped), `tokens.css → components.css → admin-writing.css → admin.css` order, `body.av-page` opt-in, canonical `.icon-sun`/`.icon-moon` theme toggle (Sprint 6.10.1). `ds.css` link **DROPPED** — pre-work verified zero `.ds-*` class usage. `writing-renderers.css` **NOT linked** (Sprint 6.8 finding). **`frontend/css/admin.css` (NEW, ~683 lines):** dedicated stylesheet per UNIFIED_DESIGN_BRIEF § 2.1 strategy. Hosts the 433-line inline `<style>` block migrated to `--av-*` tokens (legacy class names `.card` / `.stat-card` / `.fcs-*` / `.tab-btn` / `.ve-status-tab` / `.tlib-tab` / `.tbl` / `.toggle*` / `.btn-primary` / `.btn-secondary` / `.btn-danger` / `.inp` / `.modal-*` / `.badge-*` / `.spinner` / `.code-mono` / `.topics-*` / `.topic-*` / `.status-*` / `.btn-row` / `.q-row` / `.q-text-edit` / `.btn-icon` / `.cue-field` preserved byte-identical because the 2,401-line inline JS renderer emits them). New admin-* namespace chrome selectors: `.admin-header` + variants, `.admin-content-shell`, `.admin-tab-nav`, `.admin-state-text`, `.admin-page-subtitle`, etc. Body class adds `av-page` while preserving Tailwind utilities (`text-white font-sans antialiased min-h-screen flex flex-col` kept — utility refactor is β scope; `body.av-page .text-white { color: var(--av-text-primary) }` neutralizer ships in admin.css so light theme renders readable slate text). **HTML body markup (lines 49-853): zero `rgba()` and zero hex literals** — Phase C migrated 127 inline `style="..."` attributes to tokens via scoped Python script (boundary preserves the inline JS template literals in lines 857-3258, which carry the renderer-emitted styles deferred to β). 4 modal close-button hover handlers (`onmouseover="this.style.color='#fff'"...`) rewritten to use `var(--av-text-X)` tokens. **JS contracts preserved byte-identical:** inline Supabase init (outlier pattern from `admin-writing-prompts.html` + `admin-writing-assignments.html`, NOT WC.bootstrap), all 22 unique `/admin/*` endpoint paths, all 10 tab handlers (`window.switchTab` + `window.switchLibTab` exports), all 49 form inputs, 8 tables, modal markup, 186 IDs (185 original + theme-toggle button), `admin-flashcard-stats.js` external helper (211 lines, link preserved). **Token discipline (Gate 4):** admin.css `--av-text-faint` count below 10 (fresh budget), zero `--ds-*` references, zero hardcoded `color:` hex declarations. `admin-writing.css` **unchanged at 10/10 at-cap snapshot** (§ 17.6 discipline — Sprint 6.14d-α does NOT extend the shared file). Vietnamese microcopy byte-identical. |
| 4 | `frontend/grammar.html` + `frontend/pages/grammar-{roadmap,article,search,compare}.html` | 6.15 | #154 | **Phase 4 closure — Grammar Wiki cluster (5 pages, atomic ship).** Final Phase 4 sub-cluster. Token-only chrome migration (S+A scope confirmed) mirroring Sprint 6.14d-α discipline. Pages: `frontend/grammar.html` landing at root (361 lines), `grammar-roadmap.html` (89 lines), `grammar-article.html` (348 lines), `grammar-search.html` (138 lines), `grammar-compare.html` (184 lines). **Typography sub-system PRESERVED** intentionally per § 14.2 sub-system decision — DM Sans (body) + Lora (display headings). Resolves the "decision pending" status flagged in brief § 2 Phase 4 row. Rationale: Grammar Wiki = long-form reading content; editorial typography distinct from utilitarian dashboards (Plus Jakarta Sans elsewhere). Pattern matches academic/dictionary sites. **Foundation order:** `tokens.css → components.css → ds.css → grammar-wiki.css` (Sprint 6.5.1 pattern preserved — pages use `.ds-badge`/`.ds-badge-teal`/`.ds-fadein` legacy classes from ds.css, so the link stays with grammar-wiki.css providing scoped overrides last in cascade). `admin-writing.css` NOT linked (different cluster, at-cap 10/10 § 17.6). `writing-renderers.css` NOT linked (Sprint 6.8 finding extends). **Canonical anti-flash IIFE (§ 13)** per page; **canonical `.icon-sun`/`.icon-moon` theme toggle** (Sprint 6.10.1) per page; `body.av-page` opt-in per page (with `text-white font-sans antialiased min-h-screen` Tailwind utilities preserved per 6.14d-α discipline). **`frontend/css/grammar-wiki.css` (NEW, ~340 lines):** consolidates the per-page inline `<style>` blocks (174+10+173+46+102 = 505 lines source) into one cluster stylesheet driven by `--av-*` tokens. `body.av-page { font-family: 'DM Sans', ...; }` override ensures the sub-system wins over components.css's `--av-font-sans` (Plus Jakarta Sans) on cascade. Lora applied via `.hero-title`, `#article-title`, `#search-heading`, `.article-body h2`, `.article-body blockquote::before`. **91 inline rgba whites + dark-navy hex literals migrated to tokens** semantically (rgba(255,255,255,X) → `--av-text-X` / `--av-border-X` / `--av-surface-X` per opacity tier; teal tints → `--av-primary-soft`/`-border`; `#07111f` body bg → `--av-surface-page`). Light + dark theme functional. **Phase B/C spec adjustments** (documented in PR): (a) **Tailwind custom navy/teal palette config PRESERVED** because `frontend/js/grammar.js` renderer (1,034 lines) emits `text-teal-light`/`bg-teal/15` etc. utility classes that depend on the palette — removal deferred to a future grammar-wiki-β sprint analogous to Sprint 6.14d-β; (b) **ds.css link PRESERVED** per Sprint 6.5.1 because grammar pages use `.ds-*` legacy classes. Only the Tailwind `fontFamily` key was dropped (grammar-wiki.css owns font discipline now). **Preserved byte-identical:** 62 JS-coupled IDs (17+7+24+8+6), `frontend/js/grammar.js` renderer, `frontend/js/api.js` coupling, Sprint 5 deep-link feature (`.grammar-anchor` scroll-margin-top + `.grammar-anchor-pulse` 3s teal-tint animation, namespaced to `@keyframes gw-grammarAnchorPulse`), Sprint 5 article TOC `.toc-sidebar` sticky + `.toc-link.text-teal-light` active-state border indicator, reading progress bar `#reading-progress` linear gradient, SEO + Open Graph meta tags on `grammar-article.html` (`canonical-url`, `og:type`/`title`/`description`, `meta-description`), `grammarWiki.setupSearch` / `loadGrammarHome` / `loadGrammarArticle` / `loadSearchPage` / `loadRoadmap` / `loadComparePage` handler wiring, public anonymous access (no auth gate), Vietnamese grammar terminology, cross-page navigation map (landing↔4 sub-pages + breadcrumbs). **`gw-*` namespace reserved** (no conflict with `av-/aw-/admin-`) for future cluster primitives; currently none defined (token-only migration scope). **§ 17 audit gates:** all 7 + § 17.6 cap discipline verified. admin-writing.css unchanged at 10/10. Grammar-wiki.css fresh budget, `--av-text-faint` count well under 10. Brand-color typo `#14a8ae` regression guard clean. |
| 4 | `frontend/pages/admin-writing-grade.html` | 6.14c | #151 | **Phase 4 admin sprint 3/4 — instructor queue + grading, page 2/2.** Surgical migration on the 2,113-line instructor grading interface — first-of-kind in the admin cluster (tabbed multi-textarea editor over the AI Pass 1 feedback JSON). **Sprint 6.8 finding confirmed:** this page owns its CSS separately — links `frontend/css/admin-writing-grade.css` (NEW, ~700 lines, page-specific) instead of extending `admin-writing.css`. The page does **NOT** link `writing-renderers.css` (intentional — admin grading uses different rendering paths than the student-facing `writing-result.html`). Foundation order: `tokens.css` → `components.css` → `admin-writing.css` → `admin-writing-grade.css`. Legacy 498-line inline `<style>` block deleted; only minimal `.hidden{display:none!important}` inline rule remains. Uses `WC.bootstrap({onReady:(me)=>…})` to bind the instructor identity. **All 15 textareas preserved** (`instructor-note-input` + 14 data-input keys: `overview` / `mistakes` / `band_breakdown` / `corrected_essay` / `lexical_issues` / `coherence_issues` / `idea_alignment` / `argument_counter` / `improved` / `complexity_pacing` / `focus_theme` / `takeaway` / `next_essay_prompts` / `feedback_summary`). **All 7 backend endpoints preserved** (GET `/admin/writing/essays/{id}`, PATCH `/admin/writing/essays/{id}/feedback`, PATCH `/admin/writing/essays/{id}/instructor-note`, GET `/admin/writing/essays/{id}/rendered`, GET `/admin/writing/essays/{id}/export.docx`, POST `/admin/writing/essays/{id}/mark-delivered`, POST `/admin/writing/essays/{id}/regrade`). **`SECTION_KEYS` map (13 sections) + `STRING_SECTIONS` set (`overview` + `improved`)** unchanged. **4 tabs** (`tongquan` / `loi` / `nangcao` / `baimau`) with `.tab-btn.active` toggle preserved. **4 tier badges** (`quick` / `standard` / `deep` / `instructor` via `.tier-badge` + `[data-tier]` variants). **6-state status pill** (`pending` / `grading` / `graded` / `reviewed` / `delivered` / `failed`) — `setStatusPill(status)` migrated from inline `style.background/color` mutation to `setAttribute('data-status', …)`. `setAlert(kind, msg)` migrated to `.aw-alert--{error,success,warn,info}` class hooks. **Instructor panel 3 variants** (`.instructor-panel` / `.locked` / `.delivered`) preserved — Phase 2.7d.2 review-claim contract. **5 header action buttons** (`btn-save` / `btn-deliver` / `btn-regrade` / `btn-export` / `btn-render`) + `.btn-dirty` unsaved-changes state. **`_mergeFeedback()` Sprint 2.5.1 fix preserved** (merges instructor edits into the feedback JSON without clobbering AI-generated sections). Routing accepts both `?id=` and `?essay_id=` query params. **14 section-specific component classes** byte-identical (every class emitted by the inline JS renderers preserved: `criterion-card`, `card-criterion`, `mistake-card`, `lexical-card`, `coherence-card`, `idea-card`, `counter-block`, `essay-improved-block`, `stat-tile`, `criterion-mini`, `focus-theme-card`, `issue-card`, `takeaway-block`, `complexity-meter`). Token discipline: 200+ `--av-*` references, zero `--ds-*`, zero `color: #…` literals, zero Era B hex literals, `--av-text-faint` ≤ 10 on this page. Vietnamese microcopy byte-identical. |

Properties of every redesigned page:

- **Token namespace:** `--av-*` (canonical going forward; `frontend/css/aver-design/tokens.css`)
- **Typography:** Plus Jakarta Sans (body) + JetBrains Mono (numerics)
- **Theme:** Light default + dark toggle, persisted via `localStorage['av-theme']`. Anti-flash IIFE (validated, see § 13) sets `[data-theme]` on `<html>` synchronously before any stylesheet loads
- **Component library:** `.av-*` classes from `frontend/css/aver-design/components.css`
- **Theme runtime:** `frontend/js/theme-toggle.js` (8 named exports, `VALID_THEMES = ['light', 'dark']` validator that the IIFE mirrors)

### 14.2 Token system status + typography sub-systems (post Sprint 6.15.2)

**All 29 redesigned pages use `--av-*` tokens exclusively.** Zero pages remain on `--ds-*` tokens. Phase 4 closure is clean — there is no legacy-page outlier.

**Sprint 6.15.2 narrative correction:** Sprint 6.15 (PR #154) shipped with a claim that `frontend/pages/dashboard.html` was the sole remaining legacy `--ds-*` outlier. **That claim was factually wrong.** Sprint 6.15.1 investigation confirmed `dashboard.html` was deleted in Sprint 5.1 (commit `3f4ff14`) when the multi-skill `frontend/pages/home.html` shipped. A Vercel `permanent: true` 301 redirect (`frontend/vercel.json` line 12) handles legacy bookmarks → `/pages/speaking.html`. PR #155 (Sprint 6.15.2) corrected this narrative.

**`frontend/css/ds.css` is intentionally retained** as the Sprint 6.5.1 compatibility bridge:

- Inline JS in `practice.html` + `result.html` emits `.ds-band-*`, `.ds-crit*`, `.ds-cue-*` classes at runtime.
- `ds.css` defines tokens + base styling for those legacy class names.
- Redesigned pages override hardcoded `color: #fff` / `rgba(255,…)` rules via scoped `body.av-page .ds-* { color: var(--av-text-X) }` blocks (Sprint 6.5.1 pattern, documented in `UNIFIED_DESIGN_BRIEF.md` § 12).
- `ds.css` retirement is a Phase 5+ decision — fires only when the renderer-emitted `.ds-*` class emissions are eliminated from `practice.html` + `result.html` inline JS.

**`frontend/css/result.css` has 3 `var(--ds-*)` references — all inside CSS comments only.** They document the legacy `ds.css` behavior that `result.css` overrides; zero functional consumption.

**Phase 4 admin closure (Sprint 6.14d-α):** `frontend/admin.html` ships STRUCTURALLY COMPLETE — canonical IIFE + Plus Jakarta Sans + JetBrains Mono + `body.av-page` + foundation order, with the Tailwind utility-class refactor + per-tab primitive polish deferred to Sprint 6.14d-β / 6.14d-γ per the un-defer triggers in § 14.5.2 / § 14.5.3.

**Typography sub-system resolution (Sprint 6.15 closure):** The Grammar Wiki cluster (`frontend/grammar.html` landing + 4 sub-pages under `/pages/`) was previously flagged "decision pending on DM Sans + Lora sub-system vs unification" in brief § 2. **Decision: SUB-SYSTEM PRESERVED.** Grammar Wiki is the authoritative DM Sans (body) + Lora (display) consumer. Rationale: Grammar Wiki = long-form reading content; editorial typography distinct from utilitarian dashboards. Pattern matches academic/dictionary sites. Plus Jakarta Sans + JetBrains Mono remains the canonical type system for all other redesigned pages (24 utilitarian pages). Sprint 6.15 brought the cluster onto `--av-*` tokens + canonical IIFE + canonical theme toggle while preserving the typography sub-system via a `body.av-page { font-family: 'DM Sans', ...; }` cascade-winning override in `frontend/css/grammar-wiki.css`.

All Tier 1 learner-facing pages migrated in Phase 1-3 — the `typography-tier1.test.js` `TIER_1_PAGES` list is empty as of Sprint 6.12b. The sentinel test in that file catches any future Tier 1 regression.

**Cumulative typography summary:**

- **Plus Jakarta Sans + JetBrains Mono** — 24 utilitarian pages (Phase 1: 4 + Phase 2: 3 + Phase 3: 6 + Phase 4 marketing: 2 + Phase 4 admin: 9).
- **DM Sans + Lora** — 5 Grammar Wiki pages (editorial sub-system, intentional per § 14.2).
- **Total: 29 pages on `--av-*` tokens.** Zero pages on legacy `--ds-*`.

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
| Phase 4 | 6.13 – 6.15 | **✅ COMPLETE.** Sprint 6.13a: `index.html` ✅. Sprint 6.13b: `pricing.html` ✅. Sprint 6.14 pre-work (PR #148). Sprint 6.14a: small writing admin cluster ✅ (4 pages). Sprint 6.14b: table pages ✅ (2 pages). Sprint 6.14c: instructor queue + grading ✅ (2 pages). **Sprint 6.14d-α: `admin.html` monolith chrome-only ✅** (STRUCTURALLY COMPLETE; 6.14d-β / 6.14d-γ deferred with triggers — see § 14.5.2 / § 14.5.3). **Sprint 6.15: Grammar Wiki cluster ✅** (5 pages atomic, DM Sans + Lora sub-system PRESERVED per § 14.2 — closes Phase 4). **29 pages redesigned cumulative** (Phase 1: 4 + Phase 2: 3 + Phase 3: 6 + Phase 4 marketing: 2 + Phase 4 admin: 9 + Phase 4 Grammar Wiki: 5). **Zero pages remain on `--ds-*` tokens.** `ds.css` is preserved as the Sprint 6.5.1 compatibility bridge for renderer-emitted `.ds-*` classes (see § 14.2). |

### 14.5.1 Phase 4 admin status after Sprint 6.14d-α — STRUCTURALLY COMPLETE

After PR #153, the 9-page admin cluster is in this state:

- **8 of 9 admin pages FULLY MIGRATED** (Sprints 6.14a / 6.14b / 6.14c) — all chrome + content on `--av-*` tokens, no Tailwind dependencies, full light + dark theme parity.
- **1 of 9 admin pages STRUCTURALLY COMPLETE** — `admin.html` ships canonical chrome (IIFE + Plus Jakarta Sans + JetBrains Mono + `body.av-page` + canonical theme toggle + foundation order + admin.css token-driven primitives), with Tailwind utility-class refactor + per-tab primitive adoption polish **deferred** to Sprint 6.14d-β + 6.14d-γ.

This closes the visual-inversion gap (admin no longer renders dark navy while sub-pages are cream-light). Light theme functional on chrome surfaces; dark theme continues to look polished because the dark-theme tokens align nearly 1:1 with the original `rgba(255,255,255,X)` whites the page used. Tailwind utility classes (`text-white`, `bg-navy`, etc.) survive in HTML markup unchanged but are neutralized under `body.av-page` scope where they would otherwise produce illegible text on light surfaces.

### 14.5.2 Sprint 6.14d-β un-defer triggers (Tailwind utility-class removal)

Sprint 6.14d-β replaces Tailwind utility classes in `admin.html` markup (`bg-white/10`, `border-white/10`, `text-white`, `bg-navy`, etc.) with `aw-*` / `admin-*` primitives, drops the Tailwind CDN, and migrates the remaining ~167 inline-style template literals in `frontend/admin.html` lines 857-3258 (the inline JS renderer block). Estimated effort: ~20-30h.

Un-defer when ANY of the following fires:

- Adding a new admin tab requires a Tailwind primitive that cannot be mapped to existing `aw-*` reuse, AND building it inline would force a third per-tab styling pattern.
- Tailwind CDN dependency becomes an infrastructure requirement to remove (CSP tightening, offline support, supply-chain audit).
- CDN performance regression measured (Tailwind CDN adds ~3MB / parse time blocks first paint on slow mobile networks — escalate if monitoring surfaces this on the admin page specifically).
- Phase 5+ adds a new admin component that visually clashes with surrounding Tailwind-styled markup beyond what scoped overrides can fix.
- **Calendar trigger:** 6 months elapse from PR #153 merge with no progress → re-evaluate; either ship β or accept indefinite deferral and remove this row.

### 14.5.3 Sprint 6.14d-γ un-defer triggers (per-tab primitive adoption polish)

Sprint 6.14d-γ replaces the page-local class names emitted by the 2,401-line inline JS renderer (`.card`, `.stat-card`, `.fcs-*`, `.tab-btn`, `.ve-status-tab`, `.tlib-tab`, `.tbl`, `.btn-primary`, `.inp`, `.modal-*`, `.badge-*`, `.topics-*`, `.btn-row`) with the canonical `aw-*` primitives where they exist (`.aw-table` / `.aw-status-pill` family / `.aw-stat-card` / `.aw-card` / `.aw-foa-pill` / `.aw-alert--*` / `.aw-mini-pill`). Estimated effort: ~15-20h.

Un-defer when ANY of the following fires:

- Admin user feedback flags a specific UI inconsistency between `admin.html` and the migrated admin sub-pages (e.g., "the Topics table doesn't look like the Students table").
- A visual regression report ties an admin-page bug to a primitive-vs-legacy class divergence.
- A primitive-layer change to `admin-writing.css` (e.g., new `.aw-table` variant) ships but `admin.html` doesn't benefit because it still uses `.tbl`.
- **Calendar trigger:** 6 months elapse from PR #153 merge with no progress → re-evaluate.

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
<!-- Sprint 7.6 — iframe-children sub-bullet retired. The vocab children
     no longer ship the Sprint 6.0.1 embedded-mode IIFE (DEBT-2026-05-09-B
     closed); only the canonical theme IIFE remains in <head>. See Gate 6
     for the closure note. -->

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

#### Gate 6: Iframe embedded-mode preservation (CLOSED Sprint 7.6 — DEBT-2026-05-09-B)

This gate guarded the Sprint 6.0.1 iframe contract on the three vocab child pages (`my-vocabulary.html`, `flashcards.html`, `exercises.html`). It was closed in Sprint 7.6 when DEBT-2026-05-09-B retired the iframe pattern entirely. Vocab tabs are now ES module mounts (`/js/vocab-modules/*`); the IIFE, `embedded-mode.css`, and `embedded-mode.test.js` have been deleted.

No active checklist — kept here as a historical pointer so future audits don't re-introduce the pattern. For the canonical mount contract see § 12.1.

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
| `frontend/tests/vocab-module-loader.test.mjs` | DEBT-2026-05-09-B closure — `_loader.js` contract + per-module mount/unmount + standalone-shell pins | 7.3 → 7.6 |

Plus the per-page `*-redesign.test.mjs` for the page under audit (`profile-redesign`, `onboarding-redesign`, etc.). The legacy `embedded-mode.test.js` was retired Sprint 7.6 alongside the iframe pattern it pinned.

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

### 17.6 Shared CSS file cap monitoring (formalized Sprint 6.14c-hotfix)

**Origin:** Sprint 6.14c proactively demoted 3 new selectors (`.aw-locked-tag`, `.aw-queue-table__empty`, `.aw-meta-line`) from `--av-text-faint` → `--av-text-muted` because `admin-writing.css` would otherwise have crossed the Gate 4 `--av-text-faint ≤ 10` ceiling. Codex audit Phase 4 admin (AMBER #2) confirmed the file is now exactly at 10/10 (no slack). This subsection formalizes the operating rule so the next admin cluster sprint doesn't silently re-cross the cap.

**Rule for shared CSS files:**

When a shared CSS file (consumed by multiple pages — e.g., `admin-writing.css` across the 8 admin sub-pages) reaches the `--av-text-faint ≤ 10` cap, treat the file as "at-cap" and apply the strategy below:

1. **Don't add new `--av-text-faint` usages** to that file.
2. **New page-specific styles** belong in a dedicated page stylesheet, not in the shared file.
3. **New shared primitives** must use `--av-text-muted` or a stronger semantic-tier token.
4. **Cap verification gate** (run before opening a PR that touches a shared CSS file):

   ```bash
   grep -c "var(--av-text-faint)" frontend/css/<shared>.css
   ```

   Should return ≤ 10. If approaching 10, demote the weakest semantic-role users first (italic captions, empty-state copy, hover-only hints) before adding new ones.

**Current at-cap shared files (Sprint 6.14c-hotfix snapshot):**

| Shared file | Faint count | Status |
|---|---|---|
| `frontend/css/admin-writing.css` | 10 / 10 | **AT CAP** — treat as full |

**Strategy for upcoming sprints (Codex Phase 4 admin audit recommendation):**

- **Sprint 6.14d `admin.html` monolith:** dedicated `frontend/css/admin.css` for monolith-specific selectors. Reuse `aw-*` primitives but don't extend `admin-writing.css`. Foundation order: `tokens.css` → `components.css` → `admin-writing.css` → `admin.css`. See UNIFIED_DESIGN_BRIEF.md § 2.1.
- **Future admin work:** monolith-specific or tab-specific selectors belong in the page stylesheet unless the pattern is genuinely cross-page reusable.
- **Re-evaluate cap** at the next major cluster opening (Grammar Wiki cluster, Sprint 6.15+).

**Anti-patterns:**

❌ Don't fold monolith-specific styles into shared `admin-writing.css` just because they happen to live under the admin namespace. The shared file is a primitive layer, not a dump.

❌ Don't cross the `--av-text-faint ≤ 10` cap silently. If a new shared selector genuinely needs faint text, demote the weakest existing faint usage first and document the swap in the PR body.

❌ Don't widen the cap from 10. The cap exists to prevent contrast-regression accumulation — `--av-text-faint` is the weakest readable tier (just above the AA contrast cliff), and 10 across HTML + CSS is the empirical maximum where the page still feels read-able rather than washed-out.

**Sprint provenance:**

- Cap value `10` established in Sprint 6.4.2 (`speaking.html` contrast hotfix); pinned by per-page redesign tests (`<page>-redesign.test.mjs` → `--av-text-faint usage stays under the 10-instance cap`).
- Shared-file monitoring rule formalized in Sprint 6.14c-hotfix following Codex Phase 4 admin audit AMBER #2.


### 17.7 Phase closure ledger — Gate 8 (formalized Sprint 6.15.3-hotfix)

**Origin:** Two independent findings converged:

1. Sprint 6.15+ HANDOFF discovery — PR #129 was tracked as merged in the handoff document but was actually never merged (stale tracking error caught only by manual re-audit).
2. Codex Phase 4 closure audit AMBER #2 — Phase 4 closure truth was spread across `CLAUDE.md` + `DESIGN_SYSTEM.md` + `UNIFIED_DESIGN_BRIEF.md` + per-page redesign tests + `frontend/vercel.json` redirects. The same fact (e.g., "29 pages redesigned cumulative") was repeated in 4 separate files, and the Sprint 6.15 PR #154 narrative shipped a factually wrong claim ("Only `frontend/pages/dashboard.html` remains on the legacy `--ds-*` system") that survived review because no single document was the source of truth.

**Pattern:** Documentation closure truth requires (a) a central source-of-truth file and (b) an automated cross-reference test that fails when the ledger drifts from the docs that reference it.

#### Gate 8 — Phase closure ledger verification

`PHASE_CLOSURE_LEDGER.md` at repo root is the canonical closure record. It tracks:

- Per-page redesign status (path + PR number + Sprint + status)
- Phase closure milestones
- Deleted pages history (with replacement + Vercel redirect status)
- Cumulative metrics (page count, `--ds-*` state, at-cap shared files, audit-hotfix count)
- Deferred items with un-defer trigger references
- Phase 5+ pending decisions

**Verification:** `frontend/tests/phase-closure-ledger.test.mjs` cross-references the ledger against:

- `DESIGN_SYSTEM.md` § 14.1 / § 14.2 / § 14.5 row claims
- `UNIFIED_DESIGN_BRIEF.md` § 2 phase map + cumulative count line
- Per-page file existence (deleted pages verified absent; replacement pages verified present)
- `frontend/vercel.json` redirect preservation
- `admin-writing.css` `--av-text-faint` cap (≤ 10 per § 17.6)

When the ledger drifts from those docs, the test fails — closure truth requires audit before proceeding.

**Update protocol:**

- After every per-page redesign sprint ship
- After every audit closure
- After every page deletion
- After every Phase closure milestone
- Sprint hotfix prompts include a ledger-update step

**Anti-patterns:**

❌ Don't track closure state in ad-hoc Slack messages, HANDOFF docs, or sprint prompts. Those drift; the ledger is canonical.

❌ Don't claim a Phase status (COMPLETE / IN PROGRESS / STRUCTURALLY COMPLETE) in `DESIGN_SYSTEM.md` or `UNIFIED_DESIGN_BRIEF.md` without a corresponding ledger update in the same PR.

❌ Don't merge a per-page redesign PR without adding its ledger row.

❌ Don't delete a page without adding a ledger deletion row (with replacement + Vercel redirect status).

❌ Don't write closure narrative claims that contradict the ledger. If you find such a claim, the ledger wins and the contradicting doc must be corrected (mirror Sprint 6.15.2 pattern).

#### Audit gate consolidation (cumulative through Sprint 6.15.3-hotfix)

§ 17 audit checklist gates:

| Gate | Purpose | Formalized |
|---|---|---|
| Gate 1 | JS contract preservation | Sprint 6.12c |
| Gate 2 | Canonical theme infrastructure (IIFE) | Sprint 6.12c |
| Gate 3 | Theme toggle icon rendering | Sprint 6.10.1 / 6.12c |
| Gate 4 | Color migration discipline | Sprint 6.12c |
| Gate 5 | `ds.css` legacy override pattern | Sprint 6.5.1 / 6.12c |
| Gate 6 | Iframe embedded mode (where applicable) | Sprint 6.0.1 / 6.12c |
| Gate 7 | Pre-work documentation | Sprint 6.9.1 / 6.12c |
| **Gate 8** | **Phase closure ledger verification** | **Sprint 6.15.3-hotfix (this section)** |

Plus standing sections:

- § 17.2 — Brand-color regression guard (#14a8ae typo)
- § 17.3 — Sentinel tests inventory
- § 17.4 — Audit blind-spots anti-pattern catalog
- § 17.5 — When to extend § 17
- § 17.6 — Shared CSS file cap monitoring (Sprint 6.14c-hotfix)
- § 17.7 — Phase closure ledger (Sprint 6.15.3-hotfix)
- § 17.8 — Cascade-winning override coverage smoke (Sprint 6.15.4-hotfix)

---

### 17.8 Cascade-winning override coverage smoke (formalized Sprint 6.15.4-hotfix)

**Origin:** Sprint 6.15 shipped grammar-wiki.css with a cascade-winning override (`body.av-page .text-white { color: var(--av-text-primary); }`) that worked correctly for plain `.text-white` but missed every Tailwind opacity variant (`text-white/15` through `text-white/90`). The 5 grammar pages + `frontend/js/grammar.js` renderer emit ~30 such variants. Dark-theme smoke test passed (white-on-dark renders fine); light theme was not exercised, so the bug shipped to production. Anonymous users could not read any Grammar Wiki content in light theme.

Same blind-spot class as Sprint 6.10.1 icon rendering miss: structural verification (override block exists, correct foundation order, no hardcoded whites in own file) is necessary but **not sufficient**.

#### Methodology amendment — when a page ships a cascade-winning override

A "cascade-winning override" is any rule of the form `body.av-page <selector> { ... }` (or equivalent scoped to a page-owned class) intended to neutralize an upstream framework / legacy file. Examples:

- Tailwind utility neutralizers (`.text-white`, `.bg-white`, etc.)
- ds.css legacy-class scoped overrides (Sprint 6.5.1 pattern)
- Custom palette neutralizers in admin pages

For every such override, the audit must verify:

1. **Coverage audit (grep, not eyeballing).** Enumerate every variant of the targeted utility/class consumed by the page or its JS renderer. For `text-white`, this means `grep -hoE 'text-white(/[0-9]+)?' page.html renderer.js | sort -u`. Each variant requires its own override line OR a documented decision to leave it uncovered (with rationale).
2. **Both-theme smoke test.** Verify visual rendering in light theme AND dark theme. Dark-theme-only smoke is a known blind spot. Mobile 375px regression checked alongside.
3. **JS renderer coverage.** If the page has a runtime renderer (`grammar.js`, writing-renderers, etc.), grep the renderer source for emitted utility classes too. Static-markup-only audit misses 50%+ of class usage on renderer-heavy pages.
4. **Hover / focus / state variants.** `hover:text-white`, `focus:text-white`, etc. each need their own override. Tailwind compiles each state variant as a separate class.

#### Verification

`frontend/tests/grammar-wiki-light-theme-rendering.test.mjs` is the canonical regression pin for grammar-wiki.css coverage. Future cascade-winning override sprints should ship a parallel coverage-pin test for the file they touch.

#### Anti-patterns

❌ Don't trust a cascade-winning override based on the override block existing. The block can be present but incomplete — exactly the Sprint 6.15 bug.

❌ Don't smoke-test only the active theme. Toggle between light + dark at least once per cascade-winning sprint.

❌ Don't ignore the JS renderer. Pages with runtime renderers (grammar, practice, writing) emit utilities the static HTML grep won't find.

❌ Don't add new white-utility variants to grammar pages or `grammar.js` without extending the grammar-wiki.css override block first. (Marker comment in grammar-wiki.css enforces this convention.)

#### Cumulative audit gate table (refresh)

§ 17 audit checklist gates after this hotfix:

| Gate | Purpose | Formalized |
|---|---|---|
| Gate 1 | JS contract preservation | Sprint 6.12c |
| Gate 2 | Canonical theme infrastructure (IIFE) | Sprint 6.12c |
| Gate 3 | Theme toggle icon rendering | Sprint 6.10.1 / 6.12c |
| Gate 4 | Color migration discipline | Sprint 6.12c |
| Gate 5 | `ds.css` legacy override pattern | Sprint 6.5.1 / 6.12c |
| Gate 6 | Iframe embedded mode (where applicable) | Sprint 6.0.1 / 6.12c |
| Gate 7 | Pre-work documentation | Sprint 6.9.1 / 6.12c |
| Gate 8 | Phase closure ledger verification | Sprint 6.15.3-hotfix |
| **Gate 9** | **Cascade-winning override coverage + both-theme smoke** | **Sprint 6.15.4-hotfix (this section)** |

---

### 17.9 Runtime-render inheritance — Gate 9.5 (formalized Sprint 6.16.1, filed Sprint 6.15.5-hotfix)

**Origin:** Sprint 6.15.5-hotfix — `grammar-article.html` rendered `<body class="av-page text-white ...">` with the canonical descendant override `body.av-page .text-white { color: var(--av-text-primary); }` in grammar-wiki.css. The override worked correctly for every class-bearing descendant, but two structural facts the audit missed:

1. A descendant selector (`body.av-page .text-white`) **cannot match the body element itself** — that requires a compound selector (`body.av-page.text-white`).
2. Backend markdown (Python `markdown` library with `[tables, fenced_code, toc, attr_list]`) emits **class-less** semantic HTML — bare `<p>`, `<h2>`, `<li>`, `<td>`, `<code>` — which inherit `color` from the nearest ancestor with an explicit rule. The nearest ancestor was `<body>` itself, carrying raw Tailwind `text-white`.

Effect: the article body — every paragraph, list item, table cell — rendered white-on-white in light theme. Class-bearing chrome and components were readable; the actual article content was not. Same blind-spot family as § 17.8 (Gate 9) but one rung deeper: not "did the override cover every variant?" but "did the override cover the *root* element + every inheritance chain leading to class-less children?"

#### When this gate applies

Any page that consumes runtime-rendered HTML where the runtime emits class-less semantic elements:

- Backend markdown → HTML (`markdown` library, `mistune`, `commonmark`, etc.)
- JS template literals that emit bare `<p>` / `<li>` / `<h2>` / `<code>` without class attributes
- API responses that deliver HTML fragments (e.g., feedback rendering, comment threads)
- Any pipeline where editors / content authors can produce HTML without enforced class hooks

#### Verification

1. **Runtime-render inventory.** Grep for every code path that injects HTML:
   ```bash
   grep -rn 'innerHTML\|insertAdjacentHTML\|outerHTML' frontend/js/ frontend/pages/
   grep -rn 'markdown\.markdown\|markdown_to_html\|md\.render' backend/
   ```
   For each hit, sample the emitted HTML to confirm whether class-less semantic tags appear.
2. **Body class audit.** Grep for `<body[^>]*class=`. If the body carries any utility that is *also* a property the runtime children inherit (`text-*`, `font-*`, `leading-*`, etc.), the descendant override pattern is insufficient — children inherit before any descendant rule fires.
3. **Anti-pattern recognition.** `body.av-page .text-white` is a descendant selector. It does not cover the body itself. `body.av-page.text-white` (no space — compound) does cover the body. Both may be needed: the compound form for body itself, plus bare-tag overrides for inherited color on class-less children.
4. **Fix pattern (Sprint 6.15.5 canonical).** Three moves bundled:
   - Drop the Tailwind utility from the body element (`text-white` removed from `<body class="av-page text-white ...">` → `<body class="av-page ...">`).
   - Add bare-tag overrides scoped to the article container: `body.av-page .article-body p, body.av-page .article-body li, body.av-page .article-body td { color: var(--av-text-primary); }`.
   - Add a defensive compound-selector guard: `body.av-page.text-white { color: var(--av-text-primary); }` — catches future regressions that re-add the utility on body.
5. **Smoke verification.** Inspect bare semantic tags (`<p>`, `<li>`, `<h2>`, `<td>`) in DevTools, both themes. Computed `color` must resolve to `--av-text-primary` (or another `--av-text-*` token), not the inherited Tailwind raw color.

#### Anti-patterns

❌ Rely on a descendant override (`body.X .Y`) to neutralize a utility carried on the body itself.

❌ Trust that "all my classes look fine" means the page is fine — class-less runtime content has no class to check.

❌ Forget to audit backend renderers — Python markdown + Tailwind body utility is the canonical Sprint 6.15.5 trap.

✅ Drop the utility from the body, scope overrides to the runtime container, and ship a compound-selector defensive guard.

#### Pages requiring Gate 9.5

| Page | Runtime path | Status |
|---|---|---|
| `grammar-article.html` | Backend Python `markdown` → article body HTML | ✅ Fixed Sprint 6.15.5-hotfix |
| `admin.html` (writing review surfaces) | JS template literals emitting class-less semantic tags | ⏳ Deferred (Sprint 6.14d-α chrome-only); revisit when admin content surfaces are migrated |
| `result.html` / `practice.html` feedback | Whisper / Claude grader emits some class-less HTML in feedback strings | ✅ Class-bearing wrappers in place; periodic re-audit recommended |

---

### 17.10 Structural layout context — Gate 9.6 (formalized Sprint 6.16.1, filed Sprint 6.15.7-hotfix)

**Origin:** Sprint 6.15.7-hotfix — on `grammar-roadmap.html`, `grammar-search.html`, `grammar-compare.html`, and `grammar-article.html` the theme toggle button was placed OUTSIDE the inner flex chrome wrapper. The Sprint 6.10.1 Gate 3 sentinel verified that `<button class="av-theme-toggle">` carries `.icon-sun` + `.icon-moon` markup, and the test passed — markup strings were correct. What it did *not* verify was the button's DOM-tree position. Block-flow placement of a button containing two absolutely-positioned icons (one with `display: none` until the theme inverts) produced a visibly stacked sun+moon at the page's top-left corner. Click also no-op'd because the click handler resolved relative paths that 404'd under Vercel rewrites.

The bug was shipped by Sprint 6.15 (PR #154) — the original Grammar Wiki cluster ship — and survived 5 stacked subsequent PRs (#156-#160) because every PR's audit verified markup presence, not structural placement.

#### When this gate applies

- Any chrome control whose CSS layout assumes a specific parent (flex container, grid track, sticky bar)
- Multi-icon swap components (`.icon-sun` / `.icon-moon`, before/after states) where the swap relies on the parent's display context
- Components depending on positional context (header chrome, nav containers, fixed-position toolbars)
- Any page served under a Vercel rewrite where the served URL's depth differs from the underlying HTML path

#### Verification

1. **Structural sentinel test (canonical pattern).** Walk the HTML with a lightweight tag-depth tracker. When you hit the target element, assert its immediate enclosing element matches the expected layout class (Tailwind `flex`/`inline-flex` or a known chrome wrapper such as `topnav-right`, `header-actions`, `aw-header`, `ob-nav`, etc.). Reference implementation: `frontend/tests/theme-toggle-layout-context.test.mjs` — uses `findToggleParent()` to extract the parent and assert against a `FLEX_HINTS` list of known-good wrapper classes. Coverage: all 29 redesigned pages carrying the toggle.

2. **Belt-and-suspenders depth check.** Assert the element sits at depth ≥ 2 (e.g., `body > nav > button`). Direct-child-of-body placement is almost always a structural drift signal.

3. **Cross-page sample manual smoke.** For each rewrite class (e.g. `/grammar/:category/:slug`, `/writing/dashboard`, `/admin/writing/*`), open one page from that class and verify:
   - Toggle renders at the canonical right-aligned chrome position
   - Single icon visible (sun in light, moon in dark)
   - Click flips theme + persists across reload
   - Network tab shows no 404 on `theme-toggle.js`, `tokens.css`, `components.css`

4. **Relative-resource sweep.** Pages served under URL rewrites must use absolute paths for stylesheets, scripts, and any `<link>` / `<script src>` reference. Browser resolves relative paths against the served URL, not the rewritten target. (See Sprint 6.15.7-hotfix Item 3 + Sprint 6.15.8-hotfix Items 1-2 for the canonical absolutization sweep.)

#### Anti-patterns

❌ Sentinel test that verifies element existence only (markup strings present) — passes while the element is at the wrong DOM position.

❌ Skip structural parent verification because "the markup is correct" — markup is necessary but not sufficient.

❌ Trust dev-machine rendering — Vercel rewrites change the served URL depth, breaking relative imports that work locally.

✅ Sentinel verifies parent-child layout context (immediate enclosing element matches expected class set).

✅ Use absolute paths for scripts and stylesheets on any rewrite-served page (`/js/theme-toggle.js`, `/css/aver-design/tokens.css`).

✅ Per-page manual smoke verifies position + click response, not just markup existence.

#### Pages requiring Gate 9.6

All 29 chrome-bearing redesigned pages. The `theme-toggle-layout-context.test.mjs` sentinel sweep covers the toggle universally; extend the same pattern to any new positional-context-dependent component (sticky CTAs, anchor-position popovers, scroll-pinned headers).

---

### 17.11 Per-component theme verification — Gate 9.7 (formalized Sprint 6.16.1, filed Sprint 6.15.6-hotfix)

**Origin:** Sprint 6.15.6-hotfix — after three prior hotfixes (6.15.4 / 6.15.5 / pre-emptive prose updates) the Grammar Wiki cluster still rendered with invisible cards on `grammar.html`, `grammar-roadmap.html`, `grammar-search.html`, `grammar-compare.html`. Page-level "is the page readable?" smoke passed; component-level inspection surfaced **five distinct mechanisms** all contributing to the same symptom:

1. Tailwind opacity variants `text-white/X` already covered by Sprint 6.15.4, but a few hover/border/bg variants slipped (e.g., `border-white/10`, `bg-white/[0.03]` arbitrary-value notation).
2. Component class hooks (`.cat-card`, `.article-card`, `.group-card`, `.group-article-row`) had no explicit `color` rules — they relied on cascade-winning overrides on their children, which fired but didn't cover the card's own `<h3>` / `<p>` slots when those children carried a `text-white/X` utility with the variant gap.
3. JS inline styles (`element.style.cssText = "background:rgba(255,255,255,0.06); ..."`) bypassed CSS entirely — `frontend/js/grammar.js` had four such sites (status dot, status badge, progress track, save button).
4. Card surfaces used `bg-white/[0.03]` arbitrary-value notation — invisible against the light-theme page background (`--av-surface-page` is near-white in light mode).
5. Hover utilities (`hover:text-white/85`, `hover:border-white/15`) needed their own override lines; Tailwind compiles each state variant as a separate class.

Page-level "looks readable" smoke missed all five because they only surface when the audit inspects every visible component type separately, in both themes, with DevTools open.

#### When this gate applies

- Multi-component pages with custom card / panel / badge / chip classes
- Pages layering Tailwind utilities on top of token-driven custom classes
- JS renderers emitting multiple component types (`grammar.js`, `writing-renderers.js`, `practice.js`)
- Pages using arbitrary-value Tailwind utilities (`bg-white/[0.03]`, `text-[#abc]`, `border-[1px]`)
- Pages with inline `style="..."` attributes set via JS
- Pages with hover/focus/active state variants

#### Verification

1. **Per-page element inventory.** Open the page and list every visible component type — cards, badges, breadcrumbs, TOCs, body copy, tables, lists, code blocks, hover states, focus rings, disabled states. Write the list down before opening DevTools.

2. **Per-component DevTools inspection × both themes.** For each component type, inspect computed `color`, `background-color`, `border-color`. Verify they resolve through `var(--av-*)` tokens, not raw Tailwind colors or hardcoded hex.

3. **Comprehensive Tailwind utility enumeration (including arbitrary values).**
   ```bash
   grep -oE 'class="[^"]*\b(text|bg|border|hover:text|hover:bg|hover:border)-[a-z]+(-[0-9]+)?(/[\[0-9.\]]+)?[^"]*"' page.html \
     | grep -oE '\b(text|bg|border)-[a-z]+(-[0-9]+)?(/[\[0-9.\]]+)?' | sort -u
   ```
   The arbitrary-value pattern `(/[\[0-9.\]]+)?` catches `bg-white/[0.03]`-style notation that plain `text-white/15` regex misses.

4. **JS inline style audit.**
   ```bash
   grep -nE 'style\s*=\s*["\x27][^"\x27]*(color|background|border)' frontend/js/*.js
   grep -nE '\.style\.(color|background|borderColor|cssText)\s*=' frontend/js/*.js
   ```
   Each hit is a candidate to refactor into a class hook with `var(--av-*)` token color.

5. **Component class hook strategy.** Custom component classes (`.cat-card`, `.gw-save-btn`, etc.) should set color explicitly via `var(--av-text-*)` — don't depend on cascade-winning overrides reaching the right element through inheritance.

#### Anti-patterns

❌ Claim "the page is readable" based on page-level smoke without per-component verification.

❌ Rely on a cascade-winning override (Gate 9) to color a custom component class — the override fires on Tailwind utilities, not on the component's own slots.

❌ Use `bg-white/[arbitrary]` (or any arbitrary-value Tailwind utility) without a scoped override mapping it to `--av-surface-*`.

❌ Leave JS `element.style.cssText = "..."` or `style="..."` attributes in renderers — they bypass the entire token system.

✅ Component class hooks set `color: var(--av-text-*)` explicitly.

✅ Per-component DevTools inspection × both themes is mandatory before signing off a multi-component page.

✅ Tailwind comprehensive search includes arbitrary-value variants and hover/focus/active state variants.

✅ Refactor JS inline styles into class hooks; let CSS own color discipline.

#### Pages requiring Gate 9.7

- All 5 Grammar Wiki pages (✅ fixed Sprint 6.15.6-hotfix)
- `admin.html` (multi-component, chrome-only migrated Sprint 6.14d-α — content surfaces deferred; per-component sweep required before any content-surface migration)
- `practice.html` and `result.html` feedback panels (multiple class-bearing component types, runtime renderer)
- Any future page introducing a new card / panel / badge component family

---

### 17.12 Audit gate evolution through blind-spot recognition

The § 17 audit gates evolve through cumulative experience. Each new gate closes a single class of blind spot that prior gates didn't cover. The pattern is honest: six sprints, six distinct mechanisms, one systemic methodology gap that progressively narrowed as each was filed.

| Sprint | Blind spot | Resolution gate |
|---|---|---|
| 6.10.1 | Icon rendering missed by IIFE-focused audit (canonical class names not enforced) | Gate 3 — Theme toggle icon rendering (canonical `.icon-sun` / `.icon-moon`) |
| 6.15.4-hotfix | Tailwind opacity variant coverage missed by cascade-winning override audit | Gate 9 — Cascade-winning override coverage + both-theme smoke |
| 6.15.5-hotfix | Body inheritance into class-less runtime-rendered HTML | Gate 9.5 — Runtime-render inheritance verification |
| 6.15.6-hotfix | 5 component-level mechanisms across multi-component pages | Gate 9.7 — Per-component theme verification |
| 6.15.7-hotfix | Toggle markup outside intended flex wrapper (sentinel verified existence, not structure) | Gate 9.6 — Structural layout context verification |
| 6.20 | Markup contract tests passed Codex 9/9 GREEN while rendered nav position drifted cross-page (chrome nested inside `.shell` on 2 of 18 pages) | Gate 10 — Visual position verification (screenshot-level + cross-page) |

#### Pattern principle

Sentinel tests progressively get smarter as gates are filed:

- **Gate 3** — verify required class names are present in the markup
- **Gate 9** — verify cascade order (the override exists, applies, and covers every variant of the targeted utility)
- **Gate 9.5** — verify the body element doesn't carry an inherited utility that escapes the descendant override
- **Gate 9.6** — verify structural parent-child context (the element sits inside the expected layout container)
- **Gate 9.7** — verify per-component computed styles across the full element inventory
- **Gate 10** — verify rendered pixel position is stationary across cross-page navigation (markup-correct ≠ position-correct)

#### Pre-empt the next blind spot

Audit reviewers should ask before signing § 17 compliance:

1. What rendering path might bypass this verification? (backend markdown? JS template literals? API HTML fragments?)
2. What component types haven't been per-component inspected? (cards? badges? hover/focus/active states?)
3. What utility variants haven't been comprehensively enumerated? (opacity? arbitrary values? state variants?)
4. What inheritance chains run from class-bearing parents to class-less children?
5. What layout-context assumptions could be violated by malformed markup or stale wrappers?
6. What URL rewrites could break relative imports? (CSS, JS, fonts, anything resolved against the served URL)

Each unanswered question is a candidate for the next gate.

---

### 17.13 Audit gate consolidation (post Sprint 6.20)

§ 17 audit checklist gates — cumulative 13 gates:

| Gate | Purpose | Formalized |
|---|---|---|
| Gate 1 | JS contract preservation | Sprint 6.12c |
| Gate 2 | Canonical theme infrastructure (IIFE) | Sprint 6.12c |
| Gate 3 | Theme toggle icon rendering | Sprint 6.10.1 / 6.12c |
| Gate 4 | Color migration discipline | Sprint 6.12c |
| Gate 5 | `ds.css` legacy override pattern | Sprint 6.5.1 / 6.12c |
| Gate 6 | Iframe embedded mode (where applicable) | Sprint 6.0.1 / 6.12c |
| Gate 7 | Pre-work documentation | Sprint 6.9.1 / 6.12c |
| Gate 8 | Phase closure ledger verification | Sprint 6.15.3-hotfix |
| Gate 9 | Cascade-winning override coverage + both-theme smoke | Sprint 6.15.4-hotfix |
| **Gate 9.5** | **Runtime-render inheritance verification** | **Sprint 6.16.1 (filed Sprint 6.15.5-hotfix)** |
| **Gate 9.6** | **Structural layout context verification** | **Sprint 6.16.1 (filed Sprint 6.15.7-hotfix)** |
| **Gate 9.7** | **Per-component theme verification** | **Sprint 6.16.1 (filed Sprint 6.15.6-hotfix)** |
| **Gate 10** | **Visual position verification (screenshot-level + cross-page)** | **Sprint 6.20** |

Plus methodology sections:

- § 17.4 — Audit blind-spots anti-pattern catalog
- § 17.5 — When to extend § 17
- § 17.6 — Shared CSS file cap monitoring (Sprint 6.14c-hotfix)
- § 17.7 — Phase closure ledger (Sprint 6.15.3-hotfix)
- § 17.8 — Cascade-winning override discipline (Sprint 6.15.4-hotfix)
- § 17.9 — Runtime-render inheritance (Sprint 6.16.1)
- § 17.10 — Structural layout context (Sprint 6.16.1)
- § 17.11 — Per-component theme verification (Sprint 6.16.1)
- § 17.12 — Audit gate evolution through blind-spot recognition (Sprint 6.16.1)
- § 17.14 — Visual position verification — Gate 10 (Sprint 6.20)

---

### 17.14 Visual position verification — Gate 10 (formalized Sprint 6.20)

**Origin.** Sprint 6.20 retrospection. Codex visual consistency audit of Sprint 6.19 reported 9/9 dimensions GREEN — canonical chrome structure, theme toggle integrity, color tokens, foundation order, eyebrow primitive, alignment exceptions, practice modes distinction, etc. — but Andy reported nav chrome position **drift** when navigating between pages: logo left edge + tabs + theme toggle + user pill shifted vertically by ~24px between `home.html` / `vocabulary.html` and the other 16 canonical chrome pages.

Root cause: `home.html` and `vocabulary.html` nested `<nav class="topnav">` inside `<div class="shell">` (which has `padding-top: var(--av-space-6)` = 24px), while the other 16 canonical pages used `<div class="topnav-wrap"><nav class="topnav">` as a direct body child (no top padding). The chrome contract was structurally correct on every page individually; only **cross-page comparison** revealed the drift.

The blind-spot pattern: contract tests verify markup presence and structure. They do not verify the **rendered pixel position** of an element relative to the viewport, and they cannot detect drift that only manifests when the user navigates from one page to another. This is the 6th cumulative blind-spot instance documented in § 17.12.

**When this gate applies.**

- Cross-page consistent visual anchors — chrome (logo, primary nav, theme toggle, user pill), sticky headers, anchored navigation rails
- Sticky / fixed elements that interact with viewport edges
- Pages that mix canonical chrome with bespoke per-page layout containers (`.shell`, `<main class="max-w-*">`, etc.)
- Any element whose perceived "stationary" behavior across navigation is part of the design contract

**Verification protocol.**

1. **Per-page absolute position measurement** at canonical viewport sizes:
   - Desktop 1440px (default editorial viewport)
   - Tablet 768px (median tablet)
   - Mobile 375px (canonical mobile)
2. **Cross-page sample** — measure ≥ 5 pages spanning chrome categories (Cat 1 reference, Cat 2A canonical, Cat 2B embedded, Cat 3 grammar). Compare absolute pixel positions of:
   - Brand logo left edge (px from viewport left)
   - First nav tab left edge
   - Nav tab-to-tab gap
   - Theme toggle right edge (px from viewport right)
   - User pill right edge
3. **Drift threshold** — any cross-page discrepancy > 2px is drift. The chrome contract requires pixel-perfect stationary positions across navigation.
4. **Manual smoke checklist (PR description requirement when chrome restructured):**
   - [ ] Logo left edge stationary across navigation
   - [ ] First nav tab left edge stationary
   - [ ] Tab-to-tab gaps uniform
   - [ ] Theme toggle right edge stationary
   - [ ] User pill right edge stationary
   - [ ] Measurements taken at 1440px / 768px / 375px viewports
   - [ ] Measurements compared across ≥ 5 pages from different chrome categories

**Anti-patterns.**

- ❌ Don't trust markup contract tests for rendered position. A pin that asserts `<div class="topnav-wrap"><nav class="topnav">…</nav></div>` exists is satisfied even if the wrapper is nested inside `<div class="shell">` (where it inherits unwanted padding).
- ❌ Don't skip cross-page visual smoke when restructuring chrome — a single-page smoke that "looks correct" can mask drift that only manifests at navigation time.
- ❌ Don't conflate "Codex 9/9 GREEN" with "user-perceived chrome stationary." Contract green ≠ rendered green.
- ✅ Measure absolute pixel positions on ≥ 2 pages and diff them.
- ✅ Treat the chrome contract as a **cross-page** contract, not a per-page contract.

**Sentinel pattern (chrome-anchoring pin).** Test that `<div class="topnav-wrap">` is a direct body child on every canonical chrome page (not nested inside `.shell`, `<main>`, or any per-page wrapper). This is the markup-level proxy for the rendered-position contract and lives in `chrome-unification-canonical.test.mjs`.

#### Pages requiring Gate 10

- All 18 canonical chrome pages (cross-page anchor consistency contract)
- Any future page introducing sticky / fixed elements that interact with viewport edges
- Any future page mixing canonical chrome with bespoke per-page layout containers
