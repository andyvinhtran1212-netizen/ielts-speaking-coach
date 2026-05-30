# Design Consistency Audit — Whole Web

**Date:** 2026-05-30  
**Agent:** Codex  
**Scope:** Frontend design consistency audit across admin + user-facing pages  
**Deliverable type:** Discovery-only catalog, no production code changes

## Summary

The app has a real design baseline: `--av-*` tokens, `components.css`, `admin-components.css`, and `DESIGN_SYSTEM.md` document canonical typography, button, card, table, badge, and spacing rules. The main consistency problem is not absence of a baseline; it is uneven adoption across later feature pages and admin carve-outs.

The highest-value fixes are shared admin status/action primitives and page-local button consolidation. I found no current P0 broken/overflow issue in the code scan; the access-code header overlap called out in the prompt appears already structurally fixed by the two-row toolbar. The worst remaining drift is P1: status pills, card tiles, action groups, and hardcoded semantic colors diverge across admin Listening, Grammar, Vocab, Reading, System, and several user-facing Listening exercise pages.

## Method

I enumerated the frontend tree and audited HTML/CSS/JS surfaces by code inspection. This was not a browser screenshot pass; location references below are file/line or selector references from the repo.

Scope inventory:

| Area | Empirical scope |
|---|---:|
| Admin HTML pages under `frontend/pages/admin` | 50 |
| Non-admin HTML pages under `frontend/pages` | 36 |
| Root-level HTML entries | `frontend/index.html`, `frontend/admin.html`, `frontend/grammar.html`, `frontend/login.html`, `frontend/onboarding.html`, `frontend/pricing.html`, `frontend/vocabulary.html`, legacy `frontend/practice.legacy.html` |
| CSS files under `frontend/css` | 29 |
| JS renderers/components inspected for emitted classes | admin modules, reading, listening, grammar, result/practice modules |

## Design Baseline

### Canonical tokens

Primary source: `frontend/css/aver-design/tokens.css`.

| Token family | Canonical rule |
|---|---|
| Font | `--av-font-sans` = Plus Jakarta Sans; `--av-font-mono` = JetBrains Mono; display generally Plus Jakarta Sans |
| Type scale | `--av-fs-xs` through `--av-fs-5xl`; body starts at 16px |
| Line height | body `--av-lh-normal` 1.55; long-form reading `--av-lh-relaxed` 1.7 |
| Spacing | 4px scale: `--av-space-1` through `--av-space-24` |
| Radius | `sm` 4px, `md` 8px, `lg` 12px, `xl` 16px, `2xl` 24px, `pill` 999px |
| Primary color | light `#0F766E`, dark `#14B8A6`, accessed through `--av-primary` |
| Surfaces | `--av-surface-page`, `--av-surface-card`, `--av-surface-sunken`, `--av-surface-elevated` |
| Text | `--av-text-primary`, `--av-text-secondary`, `--av-text-muted`, `--av-text-faint`, `--av-text-on-primary` |
| Semantics | `--av-success`, `--av-warning`, `--av-error`, `--av-info` plus soft variants |

References:

| Baseline evidence | Location |
|---|---|
| Typography stack and avoidance of generic primary fonts | `frontend/css/aver-design/DESIGN_SYSTEM.md:87` |
| Token color table | `frontend/css/aver-design/DESIGN_SYSTEM.md:115` |
| Primary CTA must use `--av-text-on-primary`, not white literals | `frontend/css/aver-design/DESIGN_SYSTEM.md:151` |
| Spacing scale | `frontend/css/aver-design/DESIGN_SYSTEM.md:171` |
| Radius rules | `frontend/css/aver-design/DESIGN_SYSTEM.md:184` |
| Component catalog | `frontend/css/aver-design/DESIGN_SYSTEM.md:190` |

### Canonical app components

Primary source: `frontend/css/aver-design/components.css`.

| Component | Canonical pattern |
|---|---|
| Button | `.av-button`; radius `md`; padding `space-3 space-6`; variants primary/secondary/tertiary/destructive/icon/sizes |
| Primary button | `background: --av-primary`; `color: --av-text-on-primary`; hover `--av-primary-hover`; translateY(-1px) |
| Secondary button | transparent; text primary; border default; hover primary-soft/border |
| Tertiary link button | transparent primary text; arrow via `::after`; hover shifts arrow |
| Card | `.av-card`; surface-card; border-subtle; radius-lg; padding-space-6; shadow-sm |

References:

| Baseline evidence | Location |
|---|---|
| `.av-button` base | `frontend/css/aver-design/components.css:87` |
| primary/secondary/tertiary/destructive variants | `frontend/css/aver-design/components.css:120` |
| `.av-card` base | `frontend/css/aver-design/components.css:191` |

### Canonical admin components

Primary source: `frontend/css/aver-design/admin-components.css`.

| Component | Canonical pattern |
|---|---|
| Admin table | `.adm-table-wrap` with border default, radius-md, surface-card, internal horizontal scroll |
| Admin table cells | `space-3 space-4`, `fs-sm`, border-bottom default |
| Admin button | `.adm-btn-primary`, `.adm-btn-secondary`, `.adm-btn-danger`; nowrap labels |
| Admin chip | `.adm-chip`; pill radius; `2px 10px`; token background/text/border |
| Admin stat card | `.adm-card`; surface-card, border-default, radius-md, `space-4` |

References:

| Baseline evidence | Location |
|---|---|
| Admin table wrapper and cells | `frontend/css/aver-design/admin-components.css:24` |
| Admin buttons | `frontend/css/aver-design/admin-components.css:59` |
| Admin chips | `frontend/css/aver-design/admin-components.css:89` |
| Admin cards | `frontend/css/aver-design/admin-components.css:106` |

### Intentional sub-systems

Some differences are deliberate and should not be fixed as drift:

| Sub-system | Status |
|---|---|
| Grammar Wiki typography | Intentional DM Sans body + Lora display, documented in `frontend/css/grammar-wiki.css:11` and `DESIGN_SYSTEM.md:407` |
| Reading exam UI | Intentional exam chrome using `--exam-*` tokens, institutional grays, mono timers and answer boxes |
| Legacy `ds.css` | Compatibility bridge for older `.ds-*` emitted classes; not necessarily a defect by itself |
| Monospace numerics | Intended for timers, band scores, codes, q numbers, and tabular admin values |

Frontend-design skill note: the prompt requested `/mnt/skills/public/frontend-design/SKILL.md`; that file was not present in this workspace. The baseline above is extracted from the repo's own `DESIGN_SYSTEM.md`, token files, and component layers.

## Deviation Catalog

Severity legend:

| Severity | Meaning |
|---|---|
| P0 | Broken, overlapping, clipped, or unusable |
| P1 | Visibly inconsistent or operationally confusing |
| P2 | Minor drift, token debt, or maintainability issue |

| # | Surface/page | Component | Category | Location | What is wrong | Baseline | Severity | Fix recommendation |
|---:|---|---|---|---|---|---|---|---|
| 1 | Admin access codes | Row action buttons | Action groups | `frontend/js/admin-access-codes.js:119` | Three actions render as inline text fragments in a table cell with mixed danger/secondary sizes. On narrow widths they wrap unpredictably and are not grouped semantically. | Use a consistent action group wrapper with nowrap buttons or compact icon/text buttons. | P1 | Add `.adm-action-group` primitive and wrap `usageLink/refillBtn/revokeBtn`; use consistent size variant. |
| 2 | Admin access codes | Header toolbar | Layout | `frontend/pages/admin/access-codes/index.html:47` | Prompt-reported header overlap appears fixed: filters and CTA are now two rows. This is not an active P0, but should be regression-guarded. | CTA row owns its own line; filters wrap inside their row. | P2 | Add a visual/sentinel note or keep existing comments; no immediate UI fix required. |
| 3 | Admin access codes | Type chip | Status pills | `frontend/js/admin-access-codes.js:73` | `chipForType()` emits `ac-chip`, but no `.ac-chip` rule exists in the page stylesheet; only `.adm-chip` is canonical. Direct type may render unstyled or inherit accidental styles. | Use `.adm-chip` plus semantic modifiers. | P1 | Replace emitted class with `adm-chip` / `adm-chip is-direct`, or define page-local `.ac-chip` only if it differs intentionally. |
| 4 | Admin access codes | Active status chip | Status semantics | `frontend/js/admin-access-codes.js:79` | Active status uses `.adm-chip is-direct`, overloading a code-type modifier for state. | Separate type and status modifiers. | P1 | Add `.adm-chip.is-active` usage for active; reserve `is-direct` for type/cohort if kept. |
| 5 | Admin shared components | Danger button color | Buttons | `frontend/css/aver-design/admin-components.css:81` | Uses `var(--av-color-error, var(--av-text-secondary))`; canonical token is `--av-error`. If `--av-color-error` is absent, danger falls back to muted text. | Destructive should use `--av-error` and `--av-error-soft`. | P1 | Change shared danger primitive to `color: var(--av-error); border-color: var(--av-error)` with soft hover. |
| 6 | Admin Listening content list | Status pills | Status pills | `frontend/pages/admin/listening/index.html:123` | Uses `.lst-chip` with hardcoded draft/archived colors and `2px 8px`, separate from `.adm-chip` `2px 10px`. | `.adm-chip` or a shared status pill primitive. | P1 | Consolidate listening list status pills to shared admin status classes. |
| 7 | Admin Listening tests list | Status pills | Status pills | `frontend/pages/admin/listening/tests.html:97` | `.tl-chip` duplicates `.lst-chip` with same hardcoded colors, separate class name and behavior. | Shared status pill primitive. | P1 | Replace `.tl-chip` with shared `.adm-status-pill` or map to `.adm-chip` modifiers. |
| 8 | Admin Listening detail | Status pills | Status pills | `frontend/pages/admin/listening/content-detail.html:53` | `.det-chip` repeats the same draft/published/archived palette inline. | Shared status pill primitive. | P1 | Move draft/published/archived tokens into one admin status component. |
| 9 | Admin Listening test detail | Status pills | Status pills | `frontend/pages/admin/listening/tests-detail.html:51` | `.td-chip` repeats hardcoded status colors and button families. | Shared status pill primitive. | P1 | Use the same admin status class as list/detail pages. |
| 10 | Admin Reading content | Status pills | Status pills | `frontend/css/admin-reading.css:154` | `.ar-status-pill` uses mono font and no border; `published` uses success-soft rather than teal outline used elsewhere. Draft/archived are both gray. | Admin chips use border, consistent size, explicit semantic colors. | P1 | Normalize Reading status to the shared admin status palette; keep mono only for code-like identifiers. |
| 11 | Admin Writing tips | Status pills | Status pills | `frontend/css/admin-writing.css:862` | Published/draft pills use `.aw-pill--*`, no visible border, color-mix background. Different from Listening/Reading/Admin chips. | Shared admin status pill variants. | P1 | Alias `.aw-pill--published/draft` to the shared status primitive or document as writing-only if intentionally different. |
| 12 | Admin Vocab hub | NEW tag | Status/badge colors | `frontend/pages/admin/vocab/index.html:73` | `.vcb-tag.is-new` hardcodes amber colors. Shape matches others, color source does not. | Semantic warning tokens. | P2 | Use `--av-warning`, `--av-warning-soft`, and a token border. |
| 13 | Admin Grammar hub | READ-ONLY/LIVE tags | Badge semantics | `frontend/pages/admin/grammar/index.html:80` | `READ-ONLY` is gray, `LIVE` is filled teal. This is acceptable semantically, but the classes are copied from hub to hub rather than shared. | Shared admin nav-hub status tag primitive. | P2 | Extract `.admin-hub-tag` with `is-live`, `is-readonly`, `is-new`, `is-soon`. |
| 14 | Admin Speaking/System/Vocab hubs | Hub cards | Cards/tiles | `frontend/pages/admin/speaking/index.html:44`, `frontend/pages/admin/system/index.html:45`, `frontend/pages/admin/vocab/index.html:44` | Four hub pages carry near-identical card CSS under different prefixes (`spk`, `sys`, `vcb`, `grm`). | Reusable admin hub card primitive or `.av-card` adoption. | P1 | Create `.admin-hub-grid`, `.admin-hub-card`, `.admin-hub-tag`; update hub pages in one batch. |
| 15 | Admin Dashboard | Metric cards | Cards/links | `frontend/pages/admin/dashboard/index.html:60` | `.db-card` uses radius-lg and `space-4`; admin shared `.adm-card` uses radius-md. The "Xem chi tiet ->" link is unique. | Admin stat card and tertiary link patterns should be unified. | P2 | Either adopt `.adm-card` or document dashboard as larger metric-card variant; standardize link style. |
| 16 | Admin Dashboard | Refresh button | Buttons | `frontend/pages/admin/dashboard/index.html:47` | `.db-refresh` is a page-local secondary button despite matching `.adm-btn-secondary`. | Shared admin button class. | P2 | Replace with `.adm-btn-secondary` or alias `.db-refresh`. |
| 17 | Admin pages broadly | Button classes | Buttons | `frontend/pages/admin/grammar/articles.html:79`, `frontend/pages/admin/vocab/exercises.html:42`, `frontend/pages/admin/speaking/topics.html:79` | Dozens of page-local `.btn-primary/.btn-secondary/.btn-danger` definitions duplicate same token rules with small padding/radius/color differences. | `.adm-btn-*` for admin or `.av-button*` for app. | P1 | Batch replace page-local admin buttons with shared `.adm-btn-*`, preserving JS-coupled class names only where needed. |
| 18 | Admin Vocab curation/lemmas | Danger buttons | Buttons/colors | `frontend/pages/admin/vocab/d1-curation.html:65`, `frontend/pages/admin/vocab/lemmas.html:56` | Danger buttons use hardcoded red background and border, not theme-aware tokens. | `--av-error`, `--av-error-soft`, `--av-error` border. | P1 | Convert to shared `.adm-btn-danger` after fixing the shared danger token issue. |
| 19 | User Listening MCQ/TF | Correct/incorrect rows | Status colors | `frontend/pages/listening-mcq.html:54`, `frontend/pages/listening-tf.html:55` | Correct/incorrect states use hardcoded teal/red/soft red backgrounds. They may be visually OK but are not theme-aware. | `--av-success-soft`, `--av-success`, `--av-error-soft`, `--av-error`. | P1 | Move state colors to page CSS using semantic tokens; keep structure. |
| 20 | User Listening browse/analytics | Error banners | Color tokens | `frontend/pages/listening-browse.html:133`, `frontend/pages/listening-analytics.html:161` | Error banners hardcode red palette instead of `--av-error-soft`. | Semantic error tokens. | P2 | Replace hardcoded red values with token equivalents. |
| 21 | Reading L1/L2 library | Cards/pills | Positive baseline | `frontend/css/reading-vocab.css:53` | This is a good canonical student card implementation: tokens, radius-md, hover border/translate, pills, wrapped metadata. | Use as reference for reading/listening library cards where `.av-card` is too generic. | P0? no deviation | No fix; reference surface. |
| 22 | Grammar Wiki | Typography | Intentional drift | `frontend/css/grammar-wiki.css:36` | Uses DM Sans/Lora instead of Plus Jakarta Sans. This is documented as intentional editorial subsystem. | Documented exception. | Not a defect | Do not normalize typography unless product direction changes. |
| 23 | Reading exam | Mono/exam theme | Intentional drift | `frontend/css/reading-exam-mockup.css:13`, `frontend/css/reading-exam.css:50` | Uses `--exam-*`, mono numerics, exam-paper surfaces. This is an intentional exam chrome, not app-wide drift. | Documented exam subsystem. | Not a defect | Keep separate. Only align semantic colors through bridge tokens when practical. |
| 24 | Legacy `ds.css` consumers | Component bridge | Token drift | `frontend/css/ds.css:470`, `frontend/css/ds.css:612` | `ds.css` still carries hardcoded colors and legacy `.btn-*`/badge styles. Some pages still load it for compatibility. | Prefer `--av-*` components; `ds.css` is compatibility bridge. | P2 | Avoid new `.ds-*`; replace per-page usage gradually when touching those pages. |
| 25 | Admin monolith | Legacy selectors | Architecture drift | `frontend/css/admin.css:1`, `frontend/css/admin.css:330`, `frontend/css/admin.css:590` | `admin.html` monolith still has legacy `.card`, `.btn-primary`, `.btn-row`, `.badge-*` APIs by design from earlier migration. This is known deferred work. | Shared primitives where JS coupling allows. | P2 | Defer to a focused monolith primitive adoption sprint; avoid opportunistic edits. |
| 26 | Admin page-local tables | Tables | Table duplication | `frontend/pages/admin/listening/index.html:98`, `frontend/pages/admin/listening/tests.html:80`, `frontend/css/admin-reading.css:138` | Multiple admin tables recreate `.adm-table` rules under page prefixes. | `adm-table-wrap` + `adm-table`. | P1 | Standardize admin table wrappers/cells by aliasing page table classes or updating markup. |
| 27 | User pages with inline Tailwind config | Token source | Color/typography drift | `frontend/pages/result.html:37`, `frontend/pages/vocabulary.html:56`, `frontend/pages/writing-dashboard.html:39` | Several pages still define Tailwind navy/teal palettes inline, even while loading `tokens.css`. This keeps visual parity but duplicates token truth. | Single `--av-*` token source. | P2 | Treat as long-tail migration; do not add new inline Tailwind color configs. |
| 28 | User My Vocabulary | Mono font literals | Typography tokens | `frontend/css/my-vocabulary.css:97`, `frontend/css/my-vocabulary.css:581` | Uses literal JetBrains stack instead of `--av-font-mono`. Visual match is likely fine, but token contract drifts. | Use `var(--av-font-mono)`. | P2 | Replace literal mono stacks with token. |
| 29 | User Vocab Article | Editorial typography | Typography | `frontend/pages/vocab-article.html:31` | Uses DM Sans/Lora locally, similar to Grammar Wiki, but not as formally documented as a subsystem. | If editorial vocab articles are intended to mirror Grammar Wiki, document and share CSS; otherwise align. | P2 | Decide whether Vocab Article joins the editorial subsystem; then share/alias typography rules. |
| 30 | Admin link styles | "Xem chi tiet" links | Links | `frontend/pages/admin/dashboard/index.html:105`, `frontend/pages/admin/speaking/index.html:106`, `frontend/pages/admin/system/index.html:95` | Some links are card text links, some are button-like, some are plain hub-card body links. Arrow treatment and weight vary. | `.av-button-tertiary` / consistent admin card link. | P2 | Define `.admin-card-link` with token color, weight, hover underline/arrow. |

## Severity Rollup

| Severity | Count | Notes |
|---|---:|---|
| P0 | 0 | No active broken/overflow state found by code inspection. The reported access-code toolbar overlap appears already addressed. |
| P1 | 15 | Main user-visible/admin-visible drift: status pills, action groups, table/button duplication, hardcoded semantic state colors. |
| P2 | 13 | Token debt, duplicated hub-card CSS, legacy bridge usage, inline Tailwind config, typography documentation gaps. |
| Not defects / reference | 2 | Grammar Wiki typography and Reading exam chrome are intentional subsystems. |

Worst-affected surfaces:

| Rank | Surface | Why |
|---:|---|---|
| 1 | Admin Listening content/test pages | Repeated status chips, tables, buttons, action groups across several pages. |
| 2 | Admin hub pages | Same card/tag pattern copied under `grm`, `vcb`, `spk`, `sys`, `ov` prefixes. |
| 3 | Admin access codes | Header overlap fixed, but action cells and chip semantics still need cleanup. |
| 4 | Listening user exercise pages | Correct/incorrect/error colors are still hardcoded in inline page styles. |
| 5 | Legacy `ds.css` consumers | Still visually functional, but bridge layer keeps older button/badge decisions alive. |

## Fix Batches

### B1 — Admin status pill standardization

Scope:

- Create or extend a shared admin status primitive, likely `.adm-status-pill`.
- Cover states: `draft`, `published`, `archived`, `active`, `inactive`, `revoked`, `readonly`, `live`, `new`, `soon`.
- Replace `.lst-chip`, `.tl-chip`, `.det-chip`, `.td-chip`, `.ar-status-pill`, `.aw-pill--published/draft`, and hub tags where appropriate.

Candidate files:

- `frontend/css/aver-design/admin-components.css`
- `frontend/pages/admin/listening/index.html`
- `frontend/pages/admin/listening/tests.html`
- `frontend/pages/admin/listening/content-detail.html`
- `frontend/pages/admin/listening/tests-detail.html`
- `frontend/css/admin-reading.css`
- `frontend/css/admin-writing.css`
- Admin hub pages under `frontend/pages/admin/*/index.html`

Estimate: 120-220 LOC.  
Risk: Medium, because many JS renderers emit specific class names. Prefer aliasing old classes to new primitive first.

### B2 — Admin action group and table density cleanup

Scope:

- Add `.adm-action-group` with inline-flex, wrap, gap, align-items center, and optional compact variant.
- Fix access-code row actions by wrapping the three controls.
- Apply to Listening list/test rows and Reading admin row actions.
- Keep tables horizontally scrollable inside `.adm-table-wrap`.

Candidate files:

- `frontend/css/aver-design/admin-components.css`
- `frontend/js/admin-access-codes.js`
- Listening admin list/detail renderers
- `frontend/js/admin-reading.js`

Estimate: 80-160 LOC.  
Risk: Low-medium. Mostly layout and class additions, but verify narrow widths.

### B3 — Admin button consolidation

Scope:

- Normalize page-local `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.td-btn-*`, `.db-refresh` to shared `.adm-btn-*` rules where JS allows.
- Fix `.adm-btn-danger` to use `--av-error`.
- Preserve legacy class names as aliases where event listeners rely on them.

Candidate files:

- `frontend/css/aver-design/admin-components.css`
- Admin grammar pages
- Admin vocab pages
- Admin listening builder pages
- Admin speaking topics/sessions pages
- Admin dashboard/users/system pages

Estimate: 180-320 LOC.  
Risk: Medium due to class names used in JS selectors. Use alias CSS first, markup second.

### B4 — Admin hub card primitive

Scope:

- Extract duplicated hub card/tag CSS into `.admin-hub-grid`, `.admin-hub-card`, `.admin-hub-tag`.
- Migrate Grammar, Vocab, Speaking, System, Overview hub pages.
- Keep hub copy and IA unchanged.

Candidate files:

- `frontend/css/aver-design/admin-components.css` or a small `admin-hub.css`
- `frontend/pages/admin/grammar/index.html`
- `frontend/pages/admin/vocab/index.html`
- `frontend/pages/admin/speaking/index.html`
- `frontend/pages/admin/system/index.html`
- `frontend/pages/admin/index.html`

Estimate: 100-180 LOC net reduction likely.  
Risk: Low. These are mostly static anchor cards.

### B5 — User-facing semantic color token cleanup

Scope:

- Replace hardcoded correct/incorrect/error colors in Listening exercise pages with `--av-success/error` tokens.
- Replace hardcoded mono stacks in My Vocabulary with `--av-font-mono`.
- Audit root pages with inline Tailwind palettes and record long-tail migration targets.

Candidate files:

- `frontend/pages/listening-mcq.html`
- `frontend/pages/listening-tf.html`
- `frontend/pages/listening-browse.html`
- `frontend/pages/listening-analytics.html`
- `frontend/css/my-vocabulary.css`

Estimate: 60-120 LOC.  
Risk: Low. Mostly token substitution, but verify light/dark contrast.

### B6 — Legacy bridge governance

Scope:

- Do not remove `ds.css` globally.
- Add a short design-governance note: new pages should use `tokens.css` + `components.css`, and only load `ds.css` for known legacy emitted classes.
- Add a lint/sentinel later if desired for new hardcoded semantic colors.

Candidate files:

- `frontend/css/aver-design/DESIGN_SYSTEM.md`
- Optional future test/sentinel

Estimate: 20-60 docs LOC now, more only if adding tests.  
Risk: Low.

## Recommended Fix Order

1. B2 first if Andy still sees action overflow in access codes or admin tables. It is operationally visible and low-risk.
2. B1 next. Status pill drift is the most common visual inconsistency and creates the clearest admin-truth problem.
3. B3 after B1. Buttons are broader and more JS-coupled; doing status first reduces surface area.
4. B4 as a contained cleanup sprint. It should reduce duplicate CSS without changing workflows.
5. B5 for user-facing polish. These are mostly token substitutions and should be paired with light/dark screenshot checks.
6. B6 as governance, either bundled with B1/B3 or documented as a separate small PR.

## Shared Component Library Recommendation

Do not build a new frontend component library. The repo already has the right abstraction level for a vanilla HTML/CSS/JS app:

- `components.css` for user-facing `.av-*`.
- `admin-components.css` for admin `.adm-*`.
- Page CSS for genuinely page-specific layout.

The recommended architecture is to fill the missing admin primitives (`adm-status-pill`, `adm-action-group`, maybe `admin-hub-card`) and alias legacy page classes onto them. A separate JS component library would add more migration cost than value for this codebase.

## Verification Plan For Follow-Up Fix Sprints

Each fix batch should verify:

- Desktop and mobile widths for affected pages.
- Light and dark theme for token changes.
- Access-code table after filtering/searching, with long cohort names and all row actions visible.
- Listening and Reading admin tables with draft/published/archived rows.
- Hub pages with live/readonly/new/soon tags.
- User Listening MCQ/TF correct and incorrect feedback states.

Suggested automated sentinels:

- CSS sentinel: no new hardcoded semantic red/amber/teal values in touched files unless annotated as intentional.
- HTML sentinel: admin hub pages use shared hub classes after B4.
- JS sentinel: access-code action cell emits an action group wrapper after B2.

