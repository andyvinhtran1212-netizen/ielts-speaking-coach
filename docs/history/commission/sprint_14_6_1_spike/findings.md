# Sprint 14.6.1 — spike findings

**Sprint:** 14.6.1 Light theme bullets regression hotfix
**Branch:** `feature/sprint-14-6-1-light-theme-bullets-hotfix`
**Phase:** spike output — source-level (no headless browser harness in CI; same constraint as Sprint 14.1)
**Date:** 2026-05-22

---

## 1. Root cause (single)

`frontend/js/practice.js` renders the Speaking results page's feedback
sections by string-concatenating HTML inside ~10 helper functions
(`_listBlock`, `_grammarIssuesBlock`, `_correctionsBlock`,
`_improvedBlock`, `_sampleAnswerBlock`, `_criterionBlock`,
`_reliabilityNote`, plus the `_showFeedback` stub-banner branches).
Each helper hardcodes `style="color:rgba(255,255,255,X)"` on the
content text — i.e. **white text with opacity** for dark theme.

Sprint 14.1 (PR #260) fixed the CSS-side equivalents — it rewrote
the `:root[data-theme="light"]` block in `ds.css` so `--ds-text`,
`--ds-muted`, `--ds-faint` etc. flip per theme, and migrated 12
result-page `.ds-*` rules off the same hardcoded white literals.
**It did not touch the JS string-concatenated inline styles**, which
bypass `ds.css` entirely.

On light theme, every helper produces literal `color: rgba(255,255,255,0.75)`
inline → white text on the `--av-surface-page` (`#FAFAF9`) light
background → invisible.

The `>` arrow markers + section titles use saturated semantic colours
(`#4ade80` mint, `#f87171` red, `#fb923c` orange) baked in as the
helper's `color` arg, so they render in both themes — which is why
Andy's 2026-05-22 17:02 screenshot shows the title rows + the `›`
glyphs but nothing in between. Corrections "works" because its red
`❌` + green `✓` text use the same saturated semantic colours; only
its italic *explanation* line is invisible (lower priority, Andy
didn't notice).

## 2. Inventory of broken inline styles (results-page feedback path)

| Line | Function | Inline style |
|---|---|---|
| 695 | `_showFeedback` stub branch (AI-unavailable copy) | `color:rgba(255,255,255,0.55)` |
| 699 | `_showFeedback` stub branch (recording-saved fallback) | `color:rgba(255,255,255,0.4)` |
| 725 | `_showFeedback` empty case ("Không có nhận xét.") | `color:rgba(255,255,255,0.4)` |
| 1084 | `_reliabilityNote` body text | `color:rgba(255,255,255,0.6)` |
| 1094 | `_criterionBlock` body text (FC / LR / GRA / P feedback) | `color:rgba(255,255,255,0.75)` |
| 1101 | `_listBlock` `<li>` text (**Strengths**, **Vocabulary Issues**) | `color:rgba(255,255,255,0.75)` |
| 1129 | `_grammarIssuesBlock` `<li>` text (**Grammar Issues**) | `color:rgba(255,255,255,0.75)` |
| 1143 | `_improvedBlock` body text (Band 7+ improved response) | `color:rgba(255,255,255,0.8)` |
| 1150 | `_correctionsBlock` row background | `background:rgba(255,255,255,0.04)` |
| 1155 | `_correctionsBlock` italic explanation line | `color:rgba(255,255,255,0.55)` |
| 1170 | `_sampleAnswerBlock` body text | `color:rgba(255,255,255,0.8)` |

All 11 sites are in the same rendering surface (the feedback card on
the results page) and all are addressable with the Sprint 14.1
`--ds-*` token family that already flips per theme.

## 3. Why Sprint 14.1 did not catch this

Sprint 14.1's 23 sentinels operate **on CSS source** — they scan
`ds.css` for hardcoded white literals and pin the
`:root[data-theme="light"]` override block. They do not scan
**JavaScript source** for inline styles. The JS-side regression was
out of the sentinel's source-set entirely.

Pattern #26 candidate (proposed below): visual-regression sentinels
must extend coverage to JS-generated inline styles in the same
render surface, not just CSS source. Adding `practice.js` to the
inline-rgba scan set closes the gap.

## 4. Minimal fix

Map each inline `rgba(255,255,255,X)` to its `--ds-*` token equivalent
(Sprint 14.1 already wired the light-theme overrides):

| Old literal | New token | Sprint 14.1 light-theme alias |
|---|---|---|
| `rgba(255,255,255,0.85)` | `var(--ds-text)`    | `var(--av-text-primary)` |
| `rgba(255,255,255,0.75)` | `var(--ds-text)`    | `var(--av-text-primary)` |
| `rgba(255,255,255,0.8)`  | `var(--ds-text)`    | `var(--av-text-primary)` |
| `rgba(255,255,255,0.6)`  | `var(--ds-muted)`   | `var(--av-text-muted)` |
| `rgba(255,255,255,0.55)` | `var(--ds-muted)`   | `var(--av-text-muted)` |
| `rgba(255,255,255,0.4)`  | `var(--ds-faint)`   | `var(--av-text-faint)` |
| `rgba(255,255,255,0.04)` | `var(--ds-surface)` | `var(--av-surface-sunken)` |

11 inline replacements, all in `practice.js`. Zero new selectors;
zero CSS changes; zero backend changes.

## 5. Backward compat (dark theme)

The `--ds-*` tokens in the base `:root` block keep their dark-theme
literal values from before Sprint 14.1 — so once the JS uses the
token, the dark theme rendering is **byte-identical** to today's
broken-on-light rendering. No dark-theme regression possible.

## 6. Sentinel extension proposal (Sprint 14.6.1 deliverable)

Add a sentinel test that scans `frontend/js/practice.js` for
`rgba(255,255,255,*)` literals inside the feedback-render function
bodies. The function names are stable:

```
_listBlock | _grammarIssuesBlock | _correctionsBlock
| _improvedBlock | _sampleAnswerBlock | _criterionBlock
| _reliabilityNote
```

Plus the `_showFeedback` stub-branch HTML literals (the `if (data._stub)`
branch and the empty-case "Không có nhận xét." block) — scan the
surrounding 20 lines.

This catches the future repeat where someone adds a new feedback
helper and copies a sibling's `rgba(255,255,255,X)` inline style.

## 7. Pre-flight gaps acknowledged

- **PF1 production screenshot reproduction** — not available in CI
  agent context; the empirical evidence is Andy's 2026-05-22 17:02
  screenshot + the source-level inventory in §2, which is
  dispositive (the white-on-white literal is in the diff).
- **PF6 WCAG numeric verification** — not re-computed here; the
  Sprint 14.1 spike already verified that `var(--ds-text)` →
  `var(--av-text-primary)` clears the 4.5:1 threshold on both
  `--av-surface-card` (`#FFFFFF`) and `--av-surface-page` (`#FAFAF9`).
  Sprint 14.6.1's fix re-uses the same tokens; no new contrast math
  required.

---

End of spike findings.
