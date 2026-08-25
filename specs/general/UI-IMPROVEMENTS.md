# Admin UI/UX audit and redesign packet

> Audit date: 2026-08-07
> Scope: all 66 HTML surfaces under `frontend/public/pages/admin/`, the legacy
> `frontend/public/admin.html`, shared admin CSS, and `aver-admin-chrome`.

## Summary

The admin product already uses the correct Aver Learning foundations—Plus
Jakarta Sans, the `--av-*` token namespace, warm light surfaces, deep-navy dark
surfaces, and teal for primary actions. The inconsistency comes from the layer
above those tokens: dozens of page-local style blocks, incomplete adoption of
shared primitives, and a chrome component whose information architecture and
interaction states have not kept pace with the number of admin tools.

The redesign therefore keeps business logic and backend contracts intact. It
uses a professional “operations workspace” language: quiet neutral surfaces,
clear page hierarchy, compact but comfortable data density, strong keyboard
focus, and semantic color reserved for status and action.

## Design-system packet

### Scope

- Surfaces covered: admin shell, hub pages, data tables, filters, forms,
  workflows, modals, loading/empty/error states, and embedded admin tools.
- Primary mode: cross-surface alignment with a foundations pass.
- Shared goal: every admin page should feel like one workspace without forcing
  every domain workflow into the same layout.

### Foundations

- Color: consume only semantic `--av-*` tokens. Teal means active/primary;
  success, warning, error, and info colors communicate state only.
- Typography: Plus Jakarta Sans for UI; JetBrains Mono only for IDs, codes,
  timestamps, and tabular metrics. Page titles use a fluid 28–36px scale.
- Spacing: 4px base scale; page gap 24px; panel padding 20–24px; row controls
  target a minimum 40px height.
- Radius/elevation: 12px cards, 16px major panels/modals, pill only for status or
  compact segmented controls; use subtle elevation instead of extra borders.
- Motion: 150–250ms for hover/disclosure; disable non-essential transitions
  under `prefers-reduced-motion`.
- Density/breakpoints: desktop-first operational density, 1024px compact mode,
  768px overlay navigation, 640px stacked toolbars/forms.

### Primitive policy

- Shared primitives: admin chrome, page header, toolbar, table wrapper, button,
  field, status pill, card, modal, banner, loading/empty state, tabs.
- Naming: new shared admin primitives use `adm-*`; canonical cross-product
  controls remain `av-*`. Existing JS-coupled class names are aliased, not
  renamed blindly.
- Product-local: grading rubric editors, audio segment tools, mock-test cockpit,
  and content authoring canvases keep local layout classes.
- Promotion rule: a pattern appearing on at least two admin surfaces becomes a
  shared primitive and requires a source test plus light/dark visual review.

### Surface guidance

- Dashboard/hubs: strong title and context, scannable metrics, restrained cards,
  one clearly dominant action per group.
- Data pages: filters and actions sit in a consistent toolbar; tables use sticky
  headers, row hover, tabular numerics, and horizontal containment.
- Forms/workflows: labels remain visible, help/error copy sits next to its field,
  destructive actions are visually separated, and save state is explicit.
- Embedded tools: inherit typography, controls, and focus behavior but do not
  render a second global header/sidebar.

### Accessibility baseline

- Text and status contrast must meet WCAG AA in both themes.
- Every interactive element receives a visible `:focus-visible` ring.
- Icon-only controls require an accessible label and at least a 40×40 target.
- Navigation exposes current state and expanded/collapsed state to assistive
  technology; modal semantics/focus management remain mandatory.
- Reduced-motion users receive no decorative transforms or animated shimmer.

### Governance

- Token changes belong in `aver-design/tokens.css`; admin shared rules belong in
  `aver-design/admin-*.css`; workflow-specific rules remain page-local.
- Do not introduce a new button/modal family. Alias a legacy family during
  migration, then remove the alias only after its cluster is fully converted.
- Every major batch is reviewed by Claude plus the project `review` checklist,
  then verified with focused source tests and a visual pass.

### Route-outs

- Component API extraction: out of scope for this vanilla HTML/CSS revamp.
- Responsive implementation: handled page-by-page after the shared breakpoint
  policy is established here.
- Accessibility remediation: included where it is a shared CSS/chrome issue;
  complex modal focus traps remain a per-workflow follow-up if behavior changes.
- Broad UI critique: findings below are the actionable audit backlog.

## Critical issues

### Issue: Reading and instructors cannot be the active navigation section

- **Root cause:** `NAV_GROUPS` declares `reading` and `instructors`, and pages
  pass those values to `<aver-admin-chrome>`, but `VALID_ACTIVE` omits both.
  `_normalizeActive()` therefore returns `null`.
- **Severity:** Critical.
- **Current state:** Reading and instructor pages render without a selected
  sidebar item; Reading also loses its contextual submenu.
- **Impact:** Admins lose location awareness and the navigation contract is
  internally contradictory.
- **Impacted files:**
  `frontend/public/js/components/aver-admin-chrome.js` (`VALID_ACTIVE`,
  `_normalizeActive()`), `frontend/public/pages/admin/reading/*.html`, and
  `frontend/public/pages/admin/instructors.html`.
- **Suggested minimal fix:** add both declared section keys to `VALID_ACTIVE`
  and pin every `NAV_GROUPS` section as valid in the chrome test.
- **Verification:** render a Reading page and Instructors page; confirm the
  correct item has `aria-current="page"` and the Reading submenu is visible.

## High priority improvements

### Issue: Shared chrome no longer matches the product brand or tool scale

- **Root cause:** the admin header still renders `IELTSCoach`, while the
  canonical product chrome renders `Aver.Learning`; navigation spacing and
  active states were designed for fewer sections.
- **Severity:** Medium.
- **Impact:** the admin area feels like a separate legacy product, and the
  crowded sidebar increases scanning effort.
- **Impacted files:** `frontend/public/js/components/aver-admin-chrome.js`.
- **Suggested minimal fix:** align the brand lockup, improve group hierarchy,
  strengthen current-page state, expose collapse/mobile state with ARIA, and
  add a compact footer identity/account region without changing routes.
- **Verification:** desktop expanded/collapsed and 375px mobile visual checks;
  keyboard through header and nav; confirm Escape closes mobile nav.

### Issue: Page-level hierarchy is not governed globally

- **Root cause:** nearly every admin HTML file owns a `<style>` block and only
  16/66 pages load `admin-components.css`. Page titles, shells, toolbars,
  controls, and panels therefore have different spacing, radius, density, and
  hover/focus behavior despite using the same tokens.
- **Severity:** Medium.
- **Impact:** frequent context switching feels visually unstable; new admin
  pages copy another page instead of consuming a stable system.
- **Impacted files:** all files under `frontend/public/pages/admin/`, especially
  Listening, Vocab, Grammar, System, and mock-test clusters.
- **Suggested minimal fix:** add a side-effect-controlled shared admin surface
  layer loaded by the canonical chrome; keep domain layouts local.
- **Verification:** screenshot representative hub/table/form/detail pages in
  light and dark at 1280px, 768px, and 375px.

### Issue: Keyboard focus is inconsistent

- **Root cause:** only 6 of 66 pages declare `:focus-visible`; shared button,
  hub-card, nav, and form primitives do not all provide the same focus ring.
- **Severity:** Medium.
- **Impact:** keyboard users can lose their position, especially inside dense
  tables and long forms.
- **Impacted files:** shared `admin-buttons.css`, `admin-components.css`,
  `admin-hub.css`, `aver-admin-chrome.js`, and page-local controls.
- **Suggested minimal fix:** provide a shared focus baseline using
  `--av-shadow-focus`, with correct offset/radius and no mouse-only outline.
- **Verification:** keyboard-only pass through overview, users/access codes,
  content table, a long Writing form, and mobile navigation.

### Issue: Data surfaces lack one consistent containment contract

- **Root cause:** tables and toolbars are split across many class families;
  several active pages load only button/status bridges and retain local table
  implementations.
- **Severity:** Medium.
- **Impact:** horizontal overflow, inconsistent row targets, non-sticky headers,
  and mismatched empty/loading states on smaller screens.
- **Impacted files:** shared admin CSS plus table-heavy Listening, Vocab,
  Grammar, Reading, Users, Classes, Usage, and System pages.
- **Suggested minimal fix:** strengthen `.adm-table-wrap`/`.adm-table` and add
  safe generic fallbacks within the admin surface; never change table data or
  JS selectors.
- **Verification:** 320–375px overflow scan and sorting/filtering regression
  tests for users, codes, classes, Listening tests, and Reading content.

## Medium priority enhancements

### Issue: Decorative emoji compete with operational status

- **Root cause:** several Writing/Vocab hub and grading views use emoji as
  structural icons while the canonical chrome uses a consistent stroke system.
- **Severity:** Low.
- **Impact:** mixed visual tone and unpredictable glyph rendering by platform.
- **Suggested minimal fix:** replace decorative hub/navigation emoji with the
  existing line-icon language over time; keep semantic warning/check glyphs
  where text also communicates the state.
- **Verification:** verify every removed glyph still has a visible text label
  and no JS selector depends on its text content.

### Issue: Legacy color declarations still bypass semantic intent

- **Root cause:** the admin cluster contains 163 hex/rgb(a) occurrences,
  including old files predating the `--av-*` ratchet.
- **Severity:** Low to Medium depending on contrast.
- **Impact:** dark-theme drift and inconsistent semantic status color.
- **Suggested minimal fix:** migrate only touched clusters to semantic tokens;
  do not mass-replace opacity values by appearance.
- **Verification:** run `hex-budget`, undefined-token sentinel, and light/dark
  screenshots after each cluster.

## Positive observations to preserve

- The dual-theme `--av-*` token system is mature and should remain canonical.
- Admin backend/frontend contract hazards are well documented and covered by
  source tests, especially access-code association truth.
- The Shadow DOM chrome is a strong single point for safe shell improvements.
- Status, action-group, button, hub, and table primitives already exist; the
  redesign should evolve them instead of creating another component family.
- Reduced-motion handling exists in several data-loading states and should be
  expanded, not replaced.

## Batch and review gates

1. **Batch A — shell and foundations:** fix active-section contract, redesign
   chrome, add shared admin surface/focus/responsive foundation.
2. **Batch B — overview and data surfaces:** refine cards, tables, toolbars,
   status, loading/empty/error states.
3. **Batch C — workflow surfaces:** align forms, editors, detail pages, and
   Writing/Reading/Listening/Vocab specialty views without behavior changes.

After each batch: run focused Node tests, invoke Claude in read-only review mode,
apply valid findings, rerun tests, and record any deferred behavior-level issue.

## Implementation record

### Batch A — shell and foundations (completed)

- Added the statically loaded, token-only `admin-surface.css` baseline to all
  66 admin HTML surfaces, including standalone/embedded tools that do not mount
  the global chrome.
- Reworked the chrome into the canonical Aver.Learning admin shell and fixed
  the Reading/Instructors active-route contract.
- Added deterministic mobile drawer state, current-route focus, focus
  containment, Escape close/return-focus, owned scroll locking, reconnect-safe
  listeners, and abort-safe account polling.
- Claude review found and drove fixes for Shadow DOM box sizing, CSS
  specificity, mobile focusability, lifecycle rebinding, post-await abort
  safety, scroll-lock ownership, fallback colors, and weak source assertions.

### Batch B — shared primitives and data surfaces (completed)

- Unified card, table, toolbar, banner, modal, tab, status, and button treatment
  around semantic tokens, restrained elevation, consistent radii, 40px standard
  controls, and deterministic 32px compact row actions.
- Made anchor and button variants share the same inline-flex alignment; added
  safe `color-mix()` fallbacks and reduced-motion transform suppression.
- Claude review found and drove fixes for stale token tests, inline-anchor
  sizing, the ineffective `adm-btn-sm` cascade, link-order differences, and
  danger-button border fallback behavior.

### Batch C — representative page polish and responsive QA (completed)

- Refined Overview title/KPI label wrapping and mobile hierarchy.
- Reworked the standalone Listening drill importer card/button/status styling
  and removed its 375px horizontal overflow caused by intrinsic file-input
  sizing.

---

# Grammar Wiki content, learning-hook and UI/UX audit

> Audit date: 2026-08-25
> Full packet: `docs/audits/AUDIT_GRAMMAR_WIKI_CONTENT_HOOKS_UX_2026-08-25.md`

## Summary

Grammar Wiki has a strong corpus (137 live articles), rich metadata, full
anchor coverage and one quiz bank per article. The UX gap is the presentation
model: long Markdown flows are styled as reference documents, while meaningful
actions are concentrated at the end. The redesign direction is a Grammar Lab
system with semantic visual explainers, inline retrieval, immediate feedback
and explicit IELTS transfer—not a cosmetic reskin or decorative illustration
pass.

## Critical issues

### Issue: Grammar navigation is inaccessible on mobile

- **Current state:** at 390px, the global nav visibly ends at Listening;
  Grammar, Vocabulary and Reading sit outside the viewport and cannot be
  reached through the intended horizontal scroller.
- **Root cause:** the mobile `.nav-links` container is fixed to `width: 100%`;
  overflowing children do not expand its scrollable width.
- **Recommendation:** use a proper mobile menu or intrinsic-width inner track,
  retain keyboard access, and expose current state.
- **Impact:** restores access to three primary product areas.
- **Implementation notes:** `frontend/public/js/components/aver-chrome.js`,
  mobile media block.

## High priority improvements

- Introduce reusable learning blocks inside articles: lesson hero, visual
  explainer, example pair, error repair, micro-check, IELTS transfer and
  next-step card.
- Convert static in-article practice into answer-reveal or bank-backed
  micro-checks; keep quiz banks canonical.
- Add code-native semantic diagrams. Current corpus has zero image/figure/SVG
  content despite concepts that benefit from timelines, sentence anatomy,
  decision trees and certainty scales.
- Fix the article TOC containment bug and add a mobile TOC disclosure.

## Medium priority enhancements

- Make one taxonomy primary; the home currently shows 10 conceptual groups and
  11 filesystem categories while still saying “9 nhóm chủ đề”.
- Stop presenting editorial completeness (`18/18`, all bars at 100%) as if it
  were learner progress.
- Return canonical `reading_time` from search; current results fall back to
  “1 phút”. Add skill/level facets after the contract fix.
- Make roadmap use prerequisites and learner state rather than category order
  alone; remove duplicate order values first.

## Positive observations

- Markdown remains a suitable canonical source and should be preserved.
- Existing anchors, compare/related/next metadata, save behavior and quiz-bank
  coverage substantially reduce implementation cost.
- Current typography and light/dark tokens are a good foundation for the
  proposed Grammar Lab language.

## Recommended first batch

1. Correct mobile nav, group count, search duration, sticky/mobile TOC and
   duplicate Tenses order.
2. Pilot the new article system on `articles`, `present-perfect`,
   `run-on-sentences`, `complex-noun-phrases` and `grammar-in-task1`.
3. Compare against baseline micro-check completion, full Quick Check start and
   wrong-answer return-to-anchor before scaling to the corpus.

## Phase 0 implementation (completed on audit branch)

- Mobile global nav now forms a real horizontal scroller, preserves every tab,
  exposes `aria-current`, and brings the active destination into view.
- The home CTA derives its group count from the groups API; metadata and loading
  fallback no longer freeze an editorial count.
- Search results preserve canonical `level`, `status`, and `reading_time`.
- Long articles keep a sticky desktop TOC and expose the same anchors through a
  semantic mobile disclosure.
- Tenses roadmap orders are unique and contiguous (1–8).
- Verification: focused frontend 199/199, full frontend source suite pass,
  backend Grammar 286/286, TypeScript checker pass, and responsive visual QA at
  390×844/1280×900. Phase 1 visual learning blocks remain intentionally
  untouched.

---

# Learner My Class and course quiz redesign

> Audit date: 2026-08-08
> Scope: `/pages/my-class.html`, the course-exercises quiz, answer feedback,
> mastery verdicts, and the learner-facing session/revision report.

## Summary

The existing surfaces already preserve the important product rules: deadlines
come from the server, quiz progress is persisted in sessions, answers are
explained after selection, and mastery decisions come from the backend ledger.
The UX problem is hierarchy. My Class presents one long stack; quiz feedback is
encoded mainly through borders; and the verdict exposes only the latest score,
forcing learners to remember how a full run and later revision relate.

The redesign uses a single learning trail: **My Class → active quiz → session
summary → revision decision → answer report**. It does not change thresholds,
retry eligibility, grading, autosave, or deadline contracts.

## Critical issues

None found that require a schema or grading rewrite.

## High priority improvements

### Issue: My Class has no stable visual priority

- **Root cause:** deadline, four summary figures, assignment groups, rhythm,
  and lesson notes all occupy the same single-column reading flow.
- **Severity:** Medium.
- **Impact:** the learner must scan most of the page to answer “what should I do
  now?”, especially on a returning visit.
- **Impacted files:** `frontend/public/pages/my-class.html`,
  `frontend/public/js/my-class.js`.
- **Minimal fix:** place class identity and totals in one hero, give the nearest
  deadline one dominant card, keep actionable assignments in the main column,
  and move rhythm/lesson notes to a quieter responsive rail.
- **Verification:** 375px/768px/1280px checks with no class, empty assignment,
  overdue, partial writing, and active-deadline fixtures.

### Issue: Correct answer and explanation require visual inference

- **Root cause:** answer state is mostly a changed option border/key and the
  explanation block has no explicit label or answer sentence.
- **Severity:** Medium.
- **Impact:** a learner can see that something changed without immediately
  understanding “what I chose, what is correct, and why”.
- **Impacted files:** `course-behavior.tsx`, `course-exercises.css`.
- **Minimal fix:** add textual state badges, a direct correct-answer summary,
  a labelled explanation block, and preserve the selected distractor trap.
- **Verification:** keyboard-select a correct and wrong answer; verify labels,
  focus, contrast, and that the original grading/persistence calls are unchanged.

### Issue: Retry consequences are not visible as a learning trail

- **Root cause:** verdict copy explains the next action but has no canonical
  history table; learners cannot distinguish a 10-session full run from a
  one-session revision without remembering earlier screens.
- **Severity:** Medium.
- **Impact:** uncertainty about whether old answers carry over and why a full
  retry versus short revision is required.
- **Impacted files:** `backend/services/quiz_service.py`, `course-behavior.tsx`,
  `course-report.js`, `course-report.css`.
- **Minimal fix:** expose a learner-safe projection of the mastery ledger and
  render a Session & Revision table with phase, session count, score, timestamp,
  and canonical next action. Explicitly warn that answers do not carry over.
- **Verification:** full fail → full retry → near pass → revision → pass; compare
  the table against persisted mastery attempts after reload.

## Positive observations to preserve

- Immediate answer feedback and distractor-specific explanations are valuable.
- Autosave, page-hide flushing, server-side regrading, and retry eligibility
  remain backend truths and are not replaced with optimistic UI state.
- The shared Aver token system, Plus Jakarta Sans, mono numerics, dark theme,
  reduced motion, and 44px mobile targets remain canonical.
- Browser checks covered Overview, Grammar, Users, Reading, the mobile drawer,
  and the standalone importer at 375px; chrome pages remained at viewport
  width, with active navigation truth preserved.
- Claude final review found one remaining dark-mode hover contrast regression
  in the importer; its legacy teal hover was replaced with the semantic
  `--av-primary-hover` token. All other reviewed areas passed.

### Verification status

- Focused shell/design-system regression: 100/100 passing.
- Full frontend Node suite: passing (`node --test --test-reporter=dot
  frontend/tests/*.test.mjs`). The first sandboxed run failed only where tests
  needed temporary directories; the approved unrestricted rerun passed.
- `git diff --check`: passing.

### Lớp & Học viên — alignment follow-up (2026-08-08)

- **Root cause:** the roster split reserved a 340px drawer column even while
  the drawer was hidden; Progress was nested as a second-level lens; and the
  marking workspace lived outside `#view-detail`, creating a wider independent
  container with a read-width-capped assignment ledger.
- **Severity:** Medium — no data loss, but related class workflows appeared to
  belong to different layout systems and large blank gutters reduced table
  readability.
- **Minimal remediation:** keep the roster one-column until a drawer is open,
  promote Progress to the class section tabs, move marking into the canonical
  detail shell, and let its ledgers consume the panel width with contained
  horizontal overflow for genuinely wide tables.
- **Verification:** confirm all five class tabs share one nav; compare the left
  and right edges of roster/progress/homework/marking panels at desktop widths;
  open and close a student drawer; inspect tally/effort views; repeat at 390px
  and verify there is no page-level horizontal overflow.
