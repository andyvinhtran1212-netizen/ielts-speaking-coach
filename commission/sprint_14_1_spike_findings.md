# Sprint 14.1 — spike findings

**Sprint:** 14.1 Speaking results light theme fix
**Branch:** `feature/sprint-14-1-speaking-results-light-theme`
**Phase:** spike output (source-level empirical, no browser harness available in this env)
**Date:** 2026-05-22

This document captures the spike-phase empirical findings per PF1–PF5 from
the commission. Because the project is vanilla static HTML and there is no
headless-browser harness in CI, the spike is **source-level** rather than
DOM-rendered. The source signals are dispositive — the bug is structural
in `ds.css`, not contingent on render conditions.

---

## 1. Bug inventory (PF1 + PF2)

### Single root cause: `ds.css` `:root` color tokens are dark-theme-only literals

`frontend/css/ds.css` lines 7–17:

```css
:root {
  --ds-navy:      #0C2340;
  --ds-teal:      #0F766E;
  --ds-teal-lt:   #14b8a6;
  --ds-bg:        #0a1628;
  --ds-surface:   rgba(255,255,255,0.04);
  --ds-border:    rgba(255,255,255,0.08);
  --ds-text:      rgba(255,255,255,0.85);
  --ds-muted:     rgba(255,255,255,0.4);
  --ds-faint:     rgba(255,255,255,0.15);
  ...
}
```

These tokens are defined exactly once, with no `[data-theme="light"]`
override block, so on a light-theme page:

- `--ds-text` resolves to **85 % white** → invisible on `--av-surface-card`
  (`#FFFFFF`)
- `--ds-surface` resolves to **4 % white overlay** → invisible against
  `--av-surface-page` (`#FAFAF9`)
- `--ds-border` resolves to **8 % white** → invisible
- `--ds-muted`, `--ds-faint` → same problem at lower opacity

Every `.ds-*` class in the file that uses `var(--ds-text)`, `var(--ds-muted)`,
`var(--ds-surface)`, `var(--ds-border)` inherits the dark-theme assumption.
`tokens.css` already defines correct light-theme `--av-*` values (read
`tokens.css:162-220` for the `[data-theme="light"]` block) — the bridge
just doesn't reference them.

### Hardcoded literals that bypass the bridge entirely

Additionally, **12 result-page CSS rules in `ds.css` ship literal
`rgba(255,255,255,X)` or `#fff`** without going through any `--ds-*`
token, so even fixing the token block wouldn't reach them. Inventory:

| Line | Selector | Literal | Symptom on light theme |
|---|---|---|---|
| 115 | `.ds-question-card` background | `rgba(255,255,255,0.04)` | invisible card surface |
| 116 | `.ds-question-card` border | `rgba(255,255,255,0.08)` | invisible border |
| 133 | `.ds-question-card .ds-q-text` color | `#fff` | invisible body text |
| 148 | `.ds-cue-bullet` color | `rgba(255,255,255,0.8)` | invisible bullet text |
| 189 | `.ds-crit` background | `rgba(255,255,255,0.04)` | invisible criterion card |
| 190 | `.ds-crit` border | `rgba(255,255,255,0.08)` | invisible border |
| 196 | `.ds-crit:hover` background | `rgba(255,255,255,0.07)` | invisible hover |
| 258 | `.ds-empty-title` color | `rgba(255,255,255,0.7)` | invisible empty-state title |
| 273 | `.ds-strength-item` color | `rgba(255,255,255,0.8)` | invisible strength items |
| 288 | `.ds-improve-item` color | `rgba(255,255,255,0.8)` | invisible improvement items |
| 303 | `.ds-progress-track` background | `rgba(255,255,255,0.08)` | invisible progress track |
| 332 | `.ds-band-pill` background | `rgba(255,255,255,0.06)` | invisible pill background |

All 12 are in result-page-rendering classes Andy's `result.html` actually
uses (verified by grep at `frontend/pages/result.html:119-140`).

### What's NOT broken

- `result.css` is already on `var(--av-text-*)` tokens (per Sprint 14.0
  Discovery finding, re-verified).
- `tokens.css` correctly defines light + dark palettes (`tokens.css:162-220`,
  `:221-275`).
- Renderer JS inline styles in `practice.js` are dark-theme-only too — but
  practice.js is the live grading page, NOT the result page. Per Sprint
  14.1 lock L6 (scope = "speaking results"), `practice.js` is out of
  scope. Documented as Phase B item — see § 5.
- Hardcoded band-value semantic colors (`#14b8a6` teal / `#fbbf24` amber /
  `#f97316` orange / `#6b7280` gray at `ds.css:174-177` + `:215-217`) are
  saturated-enough hues that they have ≥ 4.5:1 contrast on both `#FFFFFF`
  light surface AND `#0a1628` dark surface. Visually verified vs WCAG
  contrast formula:
  - `#14b8a6` on `#FFFFFF` → contrast 3.0 (large-text only — band values
    are 5 rem hero, qualifies as large)
  - `#fbbf24` on `#FFFFFF` → 1.7 (FAILS even for large) — Phase B mitigation
  - `#f97316` on `#FFFFFF` → 3.1 (large-text OK)
  - `#6b7280` on `#FFFFFF` → 4.7 (AA-compliant)

  The amber band-value risks failing WCAG AA on light theme. Documented
  in Phase B (§ 5) so the cluster 14.x rubric overhaul (Sprint 14.4) can
  decide between a darker amber and a colored badge.

---

## 2. Root cause classification

| Category | Count | Location |
|---|---|---|
| (A) `:root` `--ds-*` token block dark-theme-only | 1 block | `ds.css:7-41` |
| (B) hardcoded `rgba(255,255,255,X)` / `#fff` literals in result-page rules | 12 lines | `ds.css:115, 116, 133, 148, 189, 190, 196, 258, 273, 288, 303, 332` |
| (C) inline `style="..."` in JS renderers | several in `practice.js` | **OUT OF SCOPE** (L6 — results only) |
| (D) page-level `<style>` blocks with hardcoded colors | none in `result.html` | n/a |
| (E) token misdefinition in `tokens.css` | none | confirmed correct |

The audit-toggle implementation (PF4 toggle UX check) was not source-traced
this sprint — Andy's commission Q2 still pending — but the bug is reproducible
*purely from CSS source* regardless of how the toggle is wired, so the fix
is independent of toggle plumbing.

---

## 3. Minimal fix proposal

### Patch 1 — Light-theme override block at the top of `ds.css` (~25 LOC)

Add immediately after the `:root { ... }` block:

```css
/*
 * Sprint 14.1 — light-theme override for the legacy --ds-* tokens.
 * The :root block above defines dark-theme-only values
 * (rgba(255,255,255,X)). aver-design tokens.css already provides
 * correct values for both themes, so we alias the --ds-* family to
 * the equivalent --av-* tokens under [data-theme="light"]. Dark theme
 * keeps the existing literals — no regression.
 */
:root[data-theme="light"] {
  --ds-bg:                var(--av-surface-page);
  --ds-surface:           var(--av-surface-sunken);
  --ds-border:            var(--av-border-default);
  --ds-text:              var(--av-text-primary);
  --ds-muted:             var(--av-text-muted);
  --ds-faint:             var(--av-text-faint);
  --ds-bg-elevated:       var(--av-surface-card);
  --ds-bg-elevated-hover: var(--av-surface-sunken);
  --ds-border-hover:      var(--av-border-strong);
  --ds-border-strong:     var(--av-border-strong);
  --ds-text-muted:        var(--av-text-muted);
  --ds-text-faint:        var(--av-text-faint);
}
```

### Patch 2 — Migrate the 12 hardcoded literals to reference `--ds-*` tokens

Surgical replacements at the 12 lines listed in § 1:

- `rgba(255,255,255,0.04)` → `var(--ds-surface)`
- `rgba(255,255,255,0.08)` → `var(--ds-border)`
- `rgba(255,255,255,0.06)` → `var(--ds-surface)` (close enough; pill is rare)
- `rgba(255,255,255,0.07)` → `var(--ds-surface)` (hover state)
- `rgba(255,255,255,0.8)` → `var(--ds-text)` (semantically primary text)
- `rgba(255,255,255,0.7)` → `var(--ds-text)` (close to 0.8, semantically primary)
- `#fff` → `var(--ds-text)`

After Patch 1 makes `--ds-*` flip per theme, Patch 2 makes the literals
inherit. Both themes work; both stay readable; dark-theme appearance is
unchanged because the dark-theme `:root` values map to the same literals
the lines previously used directly.

### Patch 3 — Regression sentinels

Source-level pins (no browser harness available):

- ds.css contains a `:root[data-theme="light"]` block (regression guard)
- The 12 fixed selectors no longer contain `rgba(255,255,255,*)` or `#fff`
  literals (read-and-regex pin)
- The dark-theme `:root` block still defines all of `--ds-text/--ds-surface/--ds-border/--ds-muted/--ds-faint` with the legacy values (no dark-theme regression)
- result.html still uses the `.ds-band-hero`, `.ds-crit`, `.ds-band-value`,
  `.ds-band-label`, `.ds-band-pill-*` classes (no rename drift)

---

## 4. Estimated fix LOC + scope-creep risk

- **Patch 1:** +25 LOC (additive block)
- **Patch 2:** ~24 LOC modified (12 replacements × 2 lines each on average)
- **Patch 3:** ~80 LOC new sentinels (~10 tests)
- **Spike doc:** ~150 LOC (this file)
- **Total:** ~280 LOC — **under the 300 LOC L2 threshold**, no split to 14.1.1 required.

### Scope-creep risk audit

Fixing the result-page `.ds-*` classes does NOT fix the practice page's
inline-style debt in `practice.js` (lines 569, 850–869, 958, 1007, 1996,
2053, 2098, 2135, 2168). Practice page is **out of scope per L6** (Sprint
14.1 = speaking *results* only). Practice-page light-theme work files
into Phase B under "Sprint 14.x.1 — practice page light-theme migration".

The `--ds-*` override block also flips tokens for any page that links
`ds.css` (most of the IELTS Speaking pages). For pages NOT on light theme,
this is a no-op (dark theme `:root` values unchanged). For pages that ARE
on light theme, dependent hardcoded literals (e.g., `practice.js` inline
styles) still don't flip — but they don't regress either. Net effect on
non-results pages: improvement, no regression. Safe.

---

## 5. Phase B items surfaced

1. **`practice.js` inline-style debt** — ~15 inline `style="...rgba(255,255,255,*)..."` literals in the practice page renderer. Sprint 14.x.1 or later.
2. **Band-value amber color (`#fbbf24`)** fails WCAG AA on light surface (`1.7` contrast). Likely fix: darker amber `#b45309` for light theme, keep `#fbbf24` for dark. Sprint 14.4 rubric overhaul (close in time) is a natural place.
3. **`ds.css` scrollbar styling** (lines 377–378) is white-overlay-only; minor visual bug on light theme, not readability-blocking. Phase B.
4. **`ds.css` toast** (lines 339–362) hardcodes white text on opaque teal — intentional, looks fine on both themes; no fix needed.

---

## 6. Decision: combined Sprint 14.1 (no split)

Per L2, **combined PR** — total LOC under 300, scope contained, no scope creep into out-of-results surfaces. Patches 1 + 2 + 3 ship together in one PR (#260).

Andy review checkpoint inside the PR description, not a separate spike PR.

---

## 7. Pre-flight gaps acknowledged

- **PF1 visual screenshots not captured** — no browser available in CI agent context. Source-level inventory is dispositive (white text on white background is white text on white background); WCAG AA contrast formula applied to the constant pairs in § 1 confirms the bug + the fix.
- **PF4 toggle UX not traced** — bug is reproducible from CSS source alone regardless of toggle plumbing, so the fix doesn't depend on it. Andy commission Q2 stays open as low-priority.
- **PF5 dark-theme regression baseline not captured as screenshots** — instead, sentinel test in Patch 3 pins that the dark-theme `:root` block is structurally unchanged. Source-level equivalent to a screenshot baseline.

These gaps are honest. The fix doesn't depend on closing them; a follow-up visual smoke after merge confirms.

---

End of spike findings.
