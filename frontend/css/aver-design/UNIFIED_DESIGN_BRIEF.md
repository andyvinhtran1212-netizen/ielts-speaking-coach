# Unified Design Brief — Per-Page Redesign

> Companion to `DESIGN_SYSTEM.md`. This brief is the operational checklist for migrating an existing page from the legacy `--ds-*` / Manrope+Fraunces system onto the unified `--av-*` / Plus Jakarta Sans + JetBrains Mono system.

---

## 1. Scope of one page redesign

A page redesign is **one PR per page**. Don't bundle two pages into one PR — review surface explodes and JS coupling breaks become impossible to localize.

Exception: pages that are sibling iframe panels (e.g., `my-vocabulary.html` + `flashcards.html` + `exercises.html` mounted into `vocabulary.html`) may share one PR if the redesign keeps them visually identical and the iframe contract is unchanged.

---

## 2. Priority order

| Phase | Pages | Reason |
|---|---|---|
| **Phase 1** | `home.html`, `speaking.html`, `practice.html`, `result.html` | Daily-use surfaces; biggest perceived-quality win |
| **Phase 2** | `writing-dashboard.html`, `writing-result.html`, `full-test-result.html`, `profile.html`, `onboarding.html`, `vocabulary.html` (+ 4 iframe panels) | High-value but lower-frequency screens |
| **Phase 3** | `admin.html` + 8 `admin-*` sub-pages | Internal-facing; bigger refactor (extract `admin.css` first) |
| **Phase 4** | Grammar Wiki cluster (`grammar.html` + 5 sub-pages, `vocab-article.html`) | Decision pending — keep DM Sans + Lora as intentional sub-system, or unify |
| **Phase 5** | `index.html`, `landing.html`, `pricing.html` | Marketing pages; reconcile Era B → Era A brand at the same time |

The `frontend-design` skill warns against the Phase 1 trap of converging on identical patterns across all pages. Each redesign should commit to a clear aesthetic direction for the page's purpose:

- **Home** — editorial overview, asymmetric, generous whitespace, display-scale stats
- **Speaking dashboard** — dense session history with a calm hierarchy, not a marketing layout
- **Practice** — focus mode, minimal chrome during recording, clear state machine affordances
- **Result** — long-form reading; relaxed line-height, atmospheric breaks between criteria

---

## 3. Per-page checklist

For each page being redesigned, work through this list in order. Each item is independently testable.

### 3.1 Setup (every page)

- [ ] Add inline anti-flash IIFE in `<head>` BEFORE any `<link>` to a stylesheet
- [ ] Link in this order: `tokens.css` → `components.css` → page-specific stylesheet (if any)
- [ ] Remove the legacy `<body class="ds-canvas">` opt-in (the new system reads `[data-theme]` on `<html>` instead)
- [ ] Apply `.av-page` class to `<body>` so background + color resolve from tokens
- [ ] Add `<button class="av-theme-toggle">` to the navigation header with sun + moon SVGs
- [ ] Wire the toggle: `import { bindToggleButton } from '/js/theme-toggle.js'; bindToggleButton(...)`

### 3.2 Token replacement

- [ ] Find every `var(--ds-*)` reference in the page's inline `<style>` and any page-specific CSS file
- [ ] Map each to the equivalent `--av-*` token (use `DESIGN_SYSTEM.md` § 4 as the lookup)
- [ ] Find every hardcoded color (`#0a1628`, `#14b8a6`, `rgba(20,184,166,...)`, `teal-*` Tailwind utility, etc.) and replace with the appropriate token
- [ ] Verify with `grep` that no `var(--ds-` or hardcoded teal/navy values remain on this page

### 3.3 Component swaps

- [ ] Replace inline button styles with `.av-button` + variant
- [ ] Replace inline card styles with `.av-card` + variant
- [ ] Replace inline modal markup with `.av-modal-backdrop` + `.av-modal`
- [ ] Replace inline form-input styles with `.av-input` / `.av-select` / `.av-textarea`
- [ ] Replace inline badge styles with `.av-badge-*` variant
- [ ] Replace inline toast pattern with `.av-toast`

### 3.4 What you MUST NOT change

These class names are JS-coupled. Renaming them breaks click handlers, state machines, or admin flows:

- `.btn-primary`, `.btn-secondary`, `.btn-test`, `.btn-start`, `.btn-fulltest`, `.btn-locked`, `.btn-ghost`
- `.tab-btn`, `.main-tab-btn`, `.essay-filter-btn`
- `.skill-card`, `.skill-card-locked`, `.skill-cta-primary`, `.skill-cta-secondary`
- `.session-row`, `.essay-card`, `.part-card`, `.stat-card`
- `.preview-mode-banner`, `.page-moved-banner`, `.vocab-moved-banner`
- `.embedded-mode` and any `html.embedded-mode` selector (Sprint 6.0.1 iframe pattern)
- `.locked` (nav-link permission flag), `.lock-tag`, `.locked-skill`
- `.show`, `.hidden`, `.is-active`, `.is-recording` state classes (broadly used)

**Strategy:** instead of renaming, **co-style** — keep the legacy class on the element AND add the `.av-*` class. The legacy CSS rule still matches but the `.av-*` rule wins on cascade order (load `.av-*` last). When the legacy class is no longer JS-targeted, drop it in a follow-up cleanup sprint.

Example for a "Start practice" button currently classed `.btn-primary`:

```html
<button class="btn-primary av-button av-button-primary">
  Bắt đầu luyện tập
</button>
```

The legacy click handler still finds `.btn-primary`. The visual style comes from `.av-button-primary`. Both work.

### 3.5 Iframe contract (only for vocabulary tabs)

If the page being redesigned is `my-vocabulary.html`, `flashcards.html`, or `exercises.html`, preserve:

- The Sprint 6.0.1 inline embedded-mode IIFE at the top of `<head>` (detects `?embedded=1` and adds `html.embedded-mode`)
- The `embedded-mode.css` link
- The `<header>` and `#vocab-moved-banner` elements (CSS hides them when in embedded mode; markup must remain)

Test embed-mode rendering in BOTH themes after the redesign.

### 3.6 Permission gating contract

If the page is `writing-dashboard.html`, `writing-result.html`, or any vocabulary surface, preserve the Sprint 5.2 / 5.2.1 gating UI states:

- `.skill-card-locked` muted variant when permission missing
- Locked-CTA modal copy (Vietnamese) intact
- The `Liên hệ admin` action wired to the support email/Telegram link

### 3.7 Vietnamese typography review

- [ ] Replace any `text-transform: uppercase` on Vietnamese strings ≥ 4 words with sentence case
- [ ] Verify body line-height ≥ 1.55 (`--av-lh-normal`)
- [ ] Sample-test with diacritic-rich strings: `"Học viên đang luyện tập"`, `"Đã hoàn thành phần thi"`, `"Tất cả các kỹ năng IELTS"`, `"Chuyển sang giao diện sáng"`
- [ ] Check that no font-feature-settings strip the marks (don't blanket-apply `'liga' 0` or similar)

### 3.8 Accessibility review

- [ ] Every icon-only button has `aria-label` in Vietnamese
- [ ] Theme toggle: `aria-label` + `aria-pressed` both update via `bindToggleButton()`
- [ ] Tab navigation works (no `tabindex="-1"` blocking primary actions)
- [ ] Focus-visible ring visible on all interactive elements in both themes
- [ ] Modal focus trap works; `Escape` closes the modal
- [ ] No reliance on color alone to convey state (e.g., error fields need an icon or text, not just red border)
- [ ] Touch targets ≥ 44×44 px on primary actions

### 3.9 Test before merge

- [ ] Visual smoke in light theme — desktop (1280px), tablet (768px), mobile (375px)
- [ ] Visual smoke in dark theme — same breakpoints
- [ ] Theme toggle works on this page (click → flip → reload → persists)
- [ ] System preference change reflected if user hasn't set explicit choice
- [ ] All existing tests still pass (run `node --test frontend/tests/*.test.js` + backend regression)
- [ ] No console errors in either theme
- [ ] No visual regression on adjacent pages (this redesign should not touch their CSS, but verify nothing leaked)

### 3.10 PR body

Document in this order:

1. **What changed** — files touched, classes added/removed, JS hooks affected (or "none")
2. **Spec deviations** — every place this page diverges from the design system, with rationale
3. **Manual test results** — light + dark smoke results, tested viewports
4. **Anti-patterns avoided** — be explicit about preserved class names, single-page scope, etc.

---

## 4. Foundation invariants (do not violate)

These hold across every per-page redesign:

- **Single source of truth for tokens.** `tokens.css` is the only place `--av-*` values are defined.
- **Theme switching is global.** No page-specific theme override; flipping `[data-theme]` flips every component.
- **Coexistence is permanent during migration.** `ds.css` ships in production until the cleanup sprint after Phase 5. Don't pre-emptively delete it.
- **No build step introduced.** Tailwind CDN stays. `theme-toggle.js` is plain ES module, importable without bundling.
- **Components don't override JS-coupled classes.** When in doubt, co-style instead of rename.

---

## 5. When to push back

If a page redesign requires:

- Renaming a JS-coupled class — push back, co-style instead
- Adding a new `--av-*` token because nothing fits — fine, add it to `tokens.css` and document why
- Changing the iframe contract for vocabulary tabs — push back, that's a separate sprint
- Migrating a page from light theme to dark or vice versa — push back, both themes are user-controlled
- Touching backend code — push back, redesign is frontend-only
- Updating tests for unrelated pages — push back, scope creep
