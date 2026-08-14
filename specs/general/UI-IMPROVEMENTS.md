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

### Native `/admin/writing/instructor-queue` migration (2026-08-13)

- Replaced the compressed legacy table with a readable FIFO operations lane,
  explicit ownership copy, SLA age, mobile cards and a focused release dialog.
- Corrected the active-state contract: `edited` reviews remain visible in both
  All Active and My Claims instead of disappearing before delivery.
- Added account-keyed pending receipts for claim/release. Exact mutation ACKs
  are followed by canonical GET readback; ambiguous responses reconcile with
  reads only and never replay the ownership-changing POST.
- Preserved visible-tab 30-second polling, stale/malformed truth, cockpit
  `embed`/`mocklane` flags and the direct legacy HTML rollback target.

### Native `/admin/writing/queue` migration (2026-08-13)

- Replaced the compressed tab/table with a six-lane operations surface that
  distinguishes AI work, human review, release readiness, delivered history
  and Mock Writing decisions without mixing their mutation rules.
- Preserved canonical contracts: only reviewed essays can be bulk delivered;
  pending Mock essays can be graded; only genuinely short pending Mock essays
  offer skip. Every mutation validates the resource acknowledgement and reads
  the queue again before success is shown.
- Made partial truth visible. Malformed rows are excluded with a warning,
  cohort lookup failures no longer disappear, a failed refresh retains and
  labels the matching prior snapshot, and the 200-row API cap is disclosed.
- Added URL-restorable lane/cohort/overdue state, visible-tab polling only for
  the live grading lane, accessible confirmation dialogs, 44px controls and a
  desktop-table-to-mobile-card layout. Direct legacy HTML remains rollback.

### Native `/admin/writing` hub migration (2026-08-13)

- Replaced the flat emoji tile dashboard with a workflow map: prepare inputs,
  control grading quality, then assign and track learner work.
- Made the route-ownership transition visible rather than implied: native
  Grade/Students destinations and still-migrating child workspaces carry
  explicit status labels, while the hub itself uses the backend admin gate.
- Added canonical learner preview, full-card keyboard targets, 44px controls,
  one/two-column responsive layouts, dark-theme token discipline and
  reduced-motion behavior. Legacy HTML remains directly reachable for rollback.

### Native `/admin/speaking` hub migration (2026-08-13)

- Replaced sprint-history copy and the obsolete `/admin.html` operations link
  with a task-first workspace for session QA, content management and pipeline
  diagnostics.
- Kept Sessions and Topics on their directly reachable rollback HTML until
  each mutation-heavy child is migrated in its own PR; the hub labels that
  ownership truth instead of implying the child routes are already native.
- Promoted Sessions as the primary QA workflow, added a canonical learner
  preview, backend-owned admin gate, full-card keyboard targets, responsive
  one/two/three-column layouts and reduced-motion behavior.

### Native `/admin/grammar` hub migration (2026-08-13)

- Reframed the landing as a content-operations workspace: publishing truth and
  the repository workflow appear before the four operational destinations.
- Kept the canonical file-based contract visible and added no fake counts or
  editing affordances. Articles, analytics, recommendation testing and the
  shared Grammar exercise console are clearly distinguished by purpose.
- Added a direct learner-view link, semantic status labels, full-card keyboard
  targets, responsive one-column composition and reduced-motion fallbacks.
- The backend-owned admin role gate now fails closed before the native surface;
  the legacy HTML remains directly reachable as the rollback target.

### Native `/admin/foot-traffic` migration (2026-08-12)

- Replaced the legacy all-at-once surface with an operational hierarchy: clear
  analytics context, URL-restorable date/route filters, three restrained KPI
  cells, one dominant daily trend, then ranked route detail.
- Preserved semantic Aver tokens and shared admin primitives; added mobile KPI
  stacking, scroll-contained daily bars, card-like route rows and visible focus.
- Correctness drives presentation: unavailable analytics is never rendered as
  zero; partial reads use `≥` and an explicit warning; the inclusive end date
  covers the whole selected calendar day.
- The reporting window and daily buckets are UTC by contract. Legacy
  `date_range` bookmarks fall back to the default 30-day window; new filters
  persist as `from`, `to`, and an exact `route` value.

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

# Speaking practice and results UI audit

> Audit date: 2026-08-09
> Scope: the three Speaking setup modes, shared recording player, immediate
> feedback state, single-session result, Full Test completion, and Full Test
> summary.

## Summary

All three practice modes already share correct session and grading contracts,
but the interface did not make that relationship visible. Setup screens were
flat collections of fields; the player changed visual structure between
states; and result screens gave score, evidence, learning resources, and next
actions nearly equal emphasis. The redesign preserves every JS-coupled ID,
handler, API path, and canonical persisted score while introducing one coherent
Speaking workspace hierarchy.

## Critical issues

No new critical backend or schema issue was found in this UI-only audit. The
session, response, Full Test chaining, and result routes remain canonical and
unchanged.

## High priority improvements

### Issue: Setup screens do not explain the learning contract of each mode

- **Root cause:** the three panels render a title followed directly by controls;
  duration, feedback timing, scoring scope, and best-use context are buried in
  small card copy or absent.
- **Severity:** Medium.
- **Impact:** learners must infer the difference between immediate coaching,
  Part scoring, and a continuous Full Test before committing microphone time.
- **Impacted files:** `frontend/public/pages/speaking.html` (`#tab-practice`,
  `#tab-partbpart`, `#tab-fulltest`),
  `frontend/app/(authed-speaking)/speaking/page-shell.tsx` (matching Next
  shell), and `frontend/public/css/speaking.css` (mode-panel styles).
- **Suggested minimal fix:** add a shared orientation strip, keep mode-specific
  form layouts, expose Full Test readiness separately from optional topics, and
  preserve the existing session creation handlers.
- **Verification:** open all three panels at 1440px and 375px; confirm their
  facts differ truthfully and all existing start actions create the same modes
  as before.

### Issue: Part selection is pointer-only markup

- **Root cause:** `#pbp-card-1..3` are clickable `div` elements even though they
  are the primary interactive controls.
- **Severity:** Medium.
- **Impact:** keyboard and assistive-technology users cannot reliably select a
  Part, and focus state is not communicated.
- **Impacted files:** the same legacy/Next Speaking shells and
  `frontend/public/css/speaking.css` (`.pbp-part-card`).
- **Suggested minimal fix:** render semantic `button type="button"` controls,
  retain the IDs/listeners, and add a token-based `:focus-visible` state.
- **Verification:** Tab through Part 1–3 and activate each with Enter/Space;
  confirm the topic panel and selected state match mouse behavior.

### Issue: Recording states feel like unrelated pages

- **Root cause:** every state uses the shared narrow reading width but owns its
  own spacing and card treatment; the context/progress bars do not establish a
  stable working surface.
- **Severity:** Medium.
- **Impact:** the layout shifts heavily between question, recording, feedback,
  and summary, increasing cognitive load during a timed speaking task.
- **Impacted files:** `frontend/public/pages/practice.html` (`#state-mode-choice`,
  `#state-prep`, Part 2 states, `#state-feedback`, `#state-test-results`,
  `#state-completion`) and `frontend/public/css/practice.css`.
- **Suggested minimal fix:** introduce a shared stage frame while preserving
  the state machine, give Visual/Listening equal scanability, and group score,
  coaching, transcript/audio, and next actions by task.
- **Verification:** run a Part 1 answer and Part 2 timer flow; verify waveform,
  recorder controls, feedback replay/download, next-question, and finish
  actions across desktop/mobile.

### Issue: Result hierarchy does not answer “what should I do next?”

- **Root cause:** the single-session result is a long sequence of same-weight
  cards, while the Full Test summary isolates band, Parts, grammar, and
  pronunciation without a stable overview/action frame.
- **Severity:** Medium.
- **Impact:** learners see a large amount of feedback but must assemble the
  priority order themselves; actions become easy to lose at the bottom.
- **Impacted files:** `frontend/public/pages/result.html`,
  `frontend/public/css/result.css`, `frontend/public/pages/full-test-result.html`,
  and `frontend/public/css/full-test-result.css`.
- **Suggested minimal fix:** pair canonical score with one coaching focus,
  separate learning resources from per-question evidence, group Full Test
  grammar/pronunciation analysis, and keep next actions visible without hiding
  content.
- **Verification:** load practice and `test_part` sessions plus a three-Part
  result; confirm canonical band fields, hidden practice criteria, audio URLs,
  accordions, PDF, retry, and detail links all remain functional.

## Positive observations to preserve

- The backend/frontend contract already distinguishes coaching-mode feedback
  from four-criterion Test feedback.
- Full Test session chaining and canonical `session.overall_band` handling are
  covered by focused regression tests.
- Both themes use the mature semantic `--av-*` token system.
- Legacy/Next Speaking shell fidelity has a dedicated source gate; the redesign
  updates both sides instead of introducing parity drift.

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

### Assignment geometry follow-up (2026-08-09)

- **Root cause:** `#mc-content` was the single child of `.mc-shell`, so the
  shell's gap did not space the hero, deadline card, and work area. The work
  area also permanently reserved a roughly 30% sidebar column, while assignment
  metadata used only a 4px vertical gap.
- **Severity:** Medium — no assignment data was wrong, but related cards looked
  like different layout systems and dense metadata was hard to scan.
- **Impact:** the assignment cards were visibly shorter than the hero/deadline
  cards, large empty space appeared on the right when class context was absent,
  and labels, titles, descriptions, and deadlines read as one compressed block.
- **Impacted files:** `frontend/public/css/my-class.css`,
  `frontend/tests/my-class-page.test.mjs`.
- **Suggested minimal fix:** give `#mc-content` an explicit 24px vertical
  rhythm, let the worklist consume the canonical page width, place optional
  context panels below it, and increase card padding/content gaps using existing
  spacing tokens.
- **Verification:** compare left/right edges of the hero, deadline, section
  divider, and assignment cards at 1280px; verify 24px separation between page
  sections; repeat at 900px and 390px with optional context present and absent.

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

## Learner Writing workspace and feedback — 2026-08-09

### Issue: the composition surface exposes controls but not the writing flow

- **Root cause:** prompt, timer, textarea, word count, autosave, and submission
  were rendered as equal-weight utility blocks in a full-screen
  modal. The learner had no visible minimum-word target or pre-submit sequence.
- **Severity:** Medium.
- **Impact:** the main task—reading the prompt and producing a complete response—
  competes with tooling; learners must remember the Task 1/Task 2 word minimum.
- **Impacted files:** `writing/dashboard/page-shell.tsx`,
  `writing/dashboard/writing-behavior.tsx`, `writing-dashboard.html`, and
  `writing-dashboard.css`.
- **Minimal fix:** preserve every assignment/draft/submit contract while shaping
  the modal into a prompt rail and paper-like editor, deriving the 150/250-word
  guide from the canonical task type, keeping save/submit status adjacent to the
  final actions, and keeping learner composition as a direct-writing surface.
- **Verification:** open Task 1 and Task 2 assignments, restore a saved draft,
  type through the target, save, submit, and repeat at 390px.

### Follow-up: Task 1 chart is too small beside the editor

- **Current state:** the prompt rail receives 39% of the desktop workspace and
  every prompt image is capped at `22rem` (352px) high.
- **Problem:** Task 1 labels, axes, legends, and small values become difficult to
  read while the learner is drafting; enlarging the browser also enlarges the
  editor more than the chart.
- **Severity:** Medium.
- **Recommendation:** when `prompt_image_url` is present, switch the desktop
  workspace to a 55/45 prompt/editor split and let the image consume up to 58%
  of the viewport height. Keep the normal Task 2 ratio unchanged and preserve
  the stacked, full-width image on compact screens.
- **Impact:** learners can compare data and write simultaneously without losing
  editor context or repeatedly opening a separate overlay.
- **Implementation notes:** toggle a semantic `has-prompt-image` class from the
  canonical prompt data in both legacy and Next behavior; provide meaningful alt
  text; preserve a 24rem minimum editor width above the 860px stacking breakpoint
  so intermediate widths do not overflow.

### Follow-up: file import competes with authentic composition

- **Current state:** the learner editor accepts `.docx` and `.txt`, extracts the
  file, and appends its contents into the active draft.
- **Problem:** it adds a secondary path and upload state to a focused writing
  workspace, while bypassing the direct composition flow the screen is designed
  to support.
- **Severity:** Medium.
- **Recommendation:** remove the learner-facing input, status, keyboard handler,
  and upload listener from both implementations. Retain the backend extraction
  endpoint for now because endpoint deletion requires a separate consumer audit.
- **Impact:** the editor has one clear path—write, autosave, review, submit—and
  the toolbar no longer competes with the primary task.

### Issue: feedback architecture delays the first actionable insight

- **Root cause:** the complete submitted essay occupied the full content width
  before any feedback, while five equal-weight tabs and fourteen section cards
  offered no recommended reading order.
- **Severity:** Medium.
- **Impact:** learners must scroll and self-organize a dense report before they
  can answer “what should I fix in my next essay?”.
- **Impacted files:** `writing-result.html` and `writing-result.css`.
- **Minimal fix:** lead with an explicit learning path, rename the first tabs by
  learner intent, place feedback beside a sticky highlighted source essay on
  desktop, and put feedback before the source essay on compact screens. Keep all
  five tab keys, fourteen renderer targets, score-visibility rules, and export /
  regrade flows unchanged.
- **Verification:** load delivered feedback with and without optional sections,
  switch all tabs by keyboard, open an inline highlight, print/download, test a
  hidden-score essay, and check 390px/768px/1280px layouts.

## Learner Listening mini-test flow — 2026-08-09

### Issue: the mini-test library has no progress hierarchy

- **Root cause:** every test is rendered as an equal three-column card; the
  persisted attempt count is used only inside each card, and `test_id` plus
  `title` are both printed even when they are identical. There is no summary or
  way to separate untouched tests from tests already practised.
- **Severity:** Medium.
- **Impact:** the learner scans a long, repetitive catalogue to decide what to
  do next; start and dictation compete at equal visual weight.
- **Impacted files:** `listening-mini-test.html`, its Next `page-shell.tsx`,
  `listening-mini-test.js`, and `listening-mini-test.css`.
- **Suggested minimal fix:** derive total/new/practised counts from the existing
  list payload, add client-only status filters, suppress the duplicate display
  title, and keep the test action primary while dictation remains secondary.
- **Verification:** compare legacy and Next routes; exercise all filters with
  mixed attempt data, identical/different title and test ID, empty/error states,
  keyboard focus, dark mode, and 390px/768px/1280px widths.

### Issue: mini-test best score is shown against a false fixed denominator

- **Root cause:** the list endpoint exposes `user_best_score` but no
  `max_score`; the card renderer nevertheless appends `/40`, while mini tests
  have a variable real question count.
- **Severity:** Medium.
- **Impact:** a strong score such as 8/10 can be presented as 8/40, materially
  misrepresenting the learner's result.
- **Impacted files:** `listening-mini-test.js` (`renderCard()`).
- **Suggested minimal fix:** do not invent a denominator on the library card;
  display the raw best points and retain the exact score/max pair on submitted
  result and answer-review screens where canonical `max_score` is available.
- **Verification:** render mini tests with different question counts and confirm
  the library never displays `/40`; submitted result/review must still show the
  exact denominator returned by the backend.

### Issue: test states feel like separate utilities instead of one exam flow

- **Root cause:** briefing, live player, and result use the same narrow card
  width and nearly equal visual weights. Result actions are an unlabelled row,
  so the canonical next step—open answer review—does not dominate.
- **Severity:** Medium.
- **Impact:** rules are harder to scan before starting, the question paper is
  unnecessarily constrained on desktop, and the learner must infer what to do
  after seeing a score.
- **Impacted files:** `listening-test.html`, `listening-test-ui.css`, and the
  display-only mode label in `listening-test-player.js`.
- **Suggested minimal fix:** retain attempt creation, resume, autosave, audio,
  and submit contracts; redesign the briefing as a numbered checklist, widen
  the active paper, and give results an explicit “next step” action hierarchy.
- **Verification:** GET a full/mini/drill, start and resume each supported mode,
  verify full-test no-seek versus practice seek, autosave a response, submit,
  and follow both review and dictation links at desktop/mobile widths.

### Issue: mini-test briefing contradicts the player controls

- **Root cause:** pre-start rules and the start confirmation were static full
  test copy (“không tua lại”), while `mountAudio()` enables pause, seek, and
  replay for `mini`, `drill`, and `practice` test types.
- **Severity:** Medium.
- **Impact:** learners enter a practice test with the wrong expectation and may
  avoid a control the product intentionally provides.
- **Impacted files:** `listening-test.html` and
  `listening-test-player.js` (`loadTest()`, `startAttempt()`, `mountAudio()`).
- **Suggested minimal fix:** derive both briefing and confirmation copy from the
  same `isPracticeTest()` predicate that controls audio scrubbing.
- **Verification:** load each supported `test_type`; mini/drill/practice must
  advertise and provide pause/seek/replay, while full remains single-shot.

### Issue: answer review does not prioritize repair work

- **Root cause:** correct and incorrect answer cards are one undifferentiated
  stream. The transcript gets half the viewport while a sticky player and
  question palette consume additional space, but there is no wrong/all/correct
  control or explicit count of what needs review.
- **Severity:** Medium.
- **Impact:** learners with long tests repeatedly scan known-correct answers
  before reaching the mistakes that deserve replay and explanation.
- **Impacted files:** `listening-review.html`, `listening-review.js`, and
  `listening-review.css`.
- **Suggested minimal fix:** default the learner view to incorrect questions
  when any exist, expose accessible filters and correct/wrong counts, preserve
  every card, transcript anchor, audio window, palette jump, and feedback flag.
- **Verification:** load all-correct and mixed attempts; switch filters by
  keyboard, jump from the palette to a hidden card, replay timestamps across
  sections, expand explanations, submit a feedback flag, and repeat at 390px.

### Issue: dictation hides the listen–write–compare loop inside one card

- **Root cause:** progress, audio, spelling hints, textarea, actions, and diff
  are stacked as peers in a 760px monolithic surface. Tiny circular progress
  dots communicate state but not the current learning step.
- **Severity:** Medium.
- **Impact:** the learner has no stable mental model for when to listen, write,
  or inspect the word diff; audio and composition controls feel buried.
- **Impacted files:** `listening-test-dictation.html` only; grading and session
  persistence remain in the existing controller.
- **Suggested minimal fix:** show the three-step loop in the header, separate
  listen and write into adjacent desktop stages, make compare span the
  workspace, and collapse back to one column on mobile without changing IDs.
- **Verification:** single- and multi-section boot, timed and free-scrub audio,
  empty answer and grade failures, perfect/partial/wrong diff, next/retry,
  completion report persistence, error flagging, dark mode, and 390px/1280px.

## Learner Listening libraries — 2026-08-09

### Issue: Skills Practice exposes the whole catalogue before a learning choice

- **Root cause:** all 11 question types and every available drill render in one
  uninterrupted document. Repeated importer prefixes consume the title line,
  titles are truncated to one line, and dictation is an emoji-only control.
- **Severity:** Medium.
- **Impact:** learners scroll through a very long shelf, cannot quickly isolate
  untouched work, and lose the real scenario that distinguishes one drill from
  another.
- **Impacted files:** `listening-skills.html`, its Next `page-shell.tsx`,
  `listening-skills.js`, and `listening-skills.css`.
- **Suggested minimal fix:** keep the canonical 11-type catalogue and list API,
  but present it as a skill selector that renders one type at a time; derive
  progress from existing attempt fields, add status filters, preserve full
  scenario titles, and label both test and dictation actions.
- **Verification:** compare legacy and Next shells; select every available type,
  switch all/new/done filters, verify empty types remain disabled, inspect long
  titles and mixed attempt data, and check keyboard focus plus 390px/1280px
  layouts in both themes.

### Issue: Full Tests cards under-explain the commitment and next action

- **Root cause:** the page intro owns the only explanation of the exam contract,
  while each card is a sparse stack of ID, title, themes, attempts, and two
  similarly styled actions. Completed and untouched tests have no explicit
  status chip or filter.
- **Severity:** Medium.
- **Impact:** learners must remember that every selection means 40 questions,
  four sections, and one audio play; they also cannot quickly find a fresh test.
- **Impacted files:** `listening-tests.html`, its Next `page-shell.tsx`,
  `listening-tests-list.js`, and `listening-tests.css`.
- **Suggested minimal fix:** repeat the truthful exam structure as compact card
  facts, show persisted attempt/best-score state, add client-only filters, keep
  the full-test action dominant, and make dictation a labelled secondary path.
- **Verification:** render attempted and untouched full tests, validate `/40`
  only on this fixed-length library, switch filters by keyboard, follow both
  actions, and test loading/empty/error states at 390px/768px/1280px.

## Learner Reading libraries — 2026-08-09

### Issue: four libraries look interchangeable despite different learning jobs

- **Root cause:** Vocab, Skill, Full Test, and Mini Test reuse the same large
  heading, thin underline tabs, detached filter strip, and generic card grid.
  The cards expose metadata as equal-weight pills but do not name the next
  action or explain what distinguishes one library from another.
- **Severity:** Medium.
- **Impact:** learners must infer whether a card starts assisted reading,
  targeted practice, a 60-minute exam, or a short test; dense four-column
  shelves make long titles difficult to scan, while the two-item Full Test
  shelf leaves most of the page visually empty.
- **Impacted files:** the four `reading-*.html` library pages, their four Next
  `page-shell.tsx` counterparts, `reading-vocab.css`, and the four library
  controllers in `frontend/public/js/`.
- **Suggested minimal fix:** preserve every endpoint, query filter, and deep
  link, but give the shared shell a compact summary hero, touch-friendly
  library switcher, result-aware filter toolbar, three-column editorial cards,
  and an explicit CTA tailored to each learning job. Only show facts already
  present in the canonical list response.
- **Verification:** compare legacy and Next markup for all four routes; exercise
  every filter and reset action; open a Vocab passage, Skill exercise, Full
  Test, and Mini Test; verify long titles, empty/error states, keyboard focus,
  dark/light themes, and 390px/768px/1280px layouts without horizontal page
  overflow.

### Issue: Mini Test cards silently fall back to full-exam structure

- **Root cause:** `reading-mini-test.js` used the Full Test fallbacks of three
  passages, 40 questions, and 60 minutes when an optional list field was
  absent, even though a mini test is defined as one passage with variable
  question count and duration.
- **Severity:** Medium.
- **Impact:** incomplete metadata can make a short practice item appear to be
  a full exam, undermining trust before the learner starts.
- **Impacted files:** `reading-mini-test.js` (`render()`).
- **Suggested minimal fix:** default only the invariant passage count to one;
  display an em dash for missing variable question/time values and derive the
  summary duration only from real positive durations.
- **Verification:** render mini tests with complete and missing list metadata;
  confirm one passage remains truthful and no `/40` or `60 phút` value is
  invented when the endpoint omits those fields.

## Admin Class student work history — 2026-08-12

### Issue: the native class workspace cannot answer “this learner has done what?”

- **Root cause:** the roster and four-skill progress table expose class-level
  metrics but no student-level action. The native homework area starts from an
  assignment, while the canonical cross-assignment endpoint starts from a
  student; only the rollback page connected that second direction.
- **Severity:** Medium.
- **Impact:** an admin must remember an assignment first or leave the native
  workspace to inspect one learner's submitted, late, missing and archived
  work. That interrupts the common intervention flow and makes the Next route
  look complete while an operational read remains legacy-only.
- **Impacted files:** the native class detail, submission workspace and shared
  dialog component; `admin-class-student-work-model.mjs`; the dedicated CSS,
  behavior test and fixture-backed browser verifier.
- **Suggested minimal fix:** add one consistent “Xem bài” action to roster and
  progress rows; render the canonical per-student endpoint in a focus-trapped
  responsive dialog; show explicit loading/error/empty/partial states; expose
  actions only for real artifacts; carry `student_id` through the URL and
  return to the same learner after native marking.
- **Verification:** open the workspace from both source tables; inspect
  submitted/late/missing/archived and stale fixtures; verify an absent artifact
  has no false link, Speaking opens its existing session surface, Course opens
  the selected native student report plus writing, Back restores the learner,
  Close clears the deep-link, payload text is escaped, and no unexpected write
  occurs at desktop or narrow widths.

## Admin operational alerts — 2026-08-12

### Issue: the legacy alert tables flatten incident priority and overstate available actions

- **Root cause:** session errors and response grading failures are rendered as
  two wide tables with equal visual weight, truncated messages and no mobile
  reading hierarchy. The route ledger also described dismissal although the
  backend exposes only `GET /admin/alerts`; adding that control in the UI would
  invent persistence that does not exist.
- **Severity:** Medium.
- **Impact:** admins must horizontally scan identifiers before understanding
  the failure, long messages are hidden, and narrow screens become a table
  viewport. A misleading dismissal control would make operational state diverge
  from canonical backend truth.
- **Impacted files:** native `/admin/system/alerts` page and model, system hub
  link/layout, dedicated responsive CSS, route ledger, contract tests and
  fixture-backed browser verifier.
- **Suggested minimal fix:** keep the endpoint read-only; present each incident
  as a message-first card with explicit type, learner identity, step, timestamp
  and real session link; preserve backend deduplication, expose client-only
  session/response scope in the URL, and surface malformed or missing identity
  as partial data rather than an empty value.
- **Verification:** verify the admin gate and canonical `limit=30` request,
  session/response counts, malicious payload escaping, malformed-row warning,
  URL scope restoration, refresh, both real session links, no unexpected write,
  and no horizontal overflow at 390px.

## Admin AI usage — 2026-08-12

### Issue: the legacy cost summary presents a capped estimate as an exact bill

- **Root cause:** the backend intentionally caps aggregation at 10,000 log rows
  and returns `meta.truncated`, but the legacy page ignores all metadata and
  labels the resulting sum “Tổng cộng”. It also hardcodes four service buckets,
  so a new backend service silently disappears from the breakdown.
- **Severity:** Medium.
- **Impact:** admins can under-read total AI consumption while believing the
  number is complete, and cannot reconcile the overall total when a new or
  unknown provider contributes cost.
- **Impacted files:** native `/admin/system/ai-usage` route, model and responsive
  CSS; system hub link/layout; route ledger, contract test and browser verifier.
- **Suggested minimal fix:** preserve the canonical read-only endpoint and
  period options; render every service key returned by the backend; surface
  exact/unknown/truncated coverage from `meta`; distinguish estimates from
  provider invoices; reject malformed top-level totals rather than defaulting
  them to zero.
- **Verification:** test exact and truncated meta, unknown service keys,
  malformed totals and per-user rows; switch `days` and confirm URL/request;
  escape authored identity fields; verify no write and no horizontal overflow
  at 390px.

## Admin instructor oversight — 2026-08-12

### Issue: the legacy table hides one canonical metric and implies unsupported management

- **Root cause:** the eight-column table omits `regrade_events`, compresses the
  distinction between regraded essays and regrade volume into a footnote, and
  the route ledger calls the surface instructor/cohort management even though
  `GET /admin/instructors` is read-only oversight. The table also overflows on
  narrow screens.
- **Severity:** Medium.
- **Impact:** admins cannot see how repeated regrades differ from the number of
  affected essays, may attribute those regrades to the roster owner, and may
  expect assignment controls that have no canonical mutation contract.
- **Impacted files:** native `/admin/instructors` route/model/CSS, admin chrome,
  instructor workspace exit link, route ledger, source tests and fixture-backed
  browser verifier.
- **Suggested minimal fix:** keep the endpoint read-only; validate every metric
  fail-closed; present responsive instructor cards with explicit student,
  prompt, delivered, regraded-essay, regrade-event, all-version token and cost
  facts; label the drill-down as audited impersonation and retain the legacy
  HTML only as rollback.
- **Verification:** verify the admin gate and exact canonical GET, malformed and
  duplicate exclusion, metric distinction, malicious identity escaping, client
  search URL, sanctioned encoded `as_instructor` link, no unexpected write and
  no page overflow at 390px, and the two-column card hierarchy at 1440px; run
  the backend aggregation and impersonation audit tests separately.

## Admin user activity — 2026-08-12

### Issue: the legacy activity log confuses read failures with no activity

- **Root cause:** the default legacy controller catches a failed
  `/admin/usage/users` request, replaces the response with an empty array and
  renders “Chưa có hoạt động nào”. Its per-code summary also coerces degraded
  `null` session/cost metrics to zero, while unpaged PostgREST reads can silently
  stop at the default row cap. The route ledger separately mislabels this
  contract as DAU/MAU analytics.
- **Severity:** Medium.
- **Impact:** admins can treat an unavailable or truncated source as proof of no
  usage, underestimate total activity/cost, and misunderstand what the page is
  measuring. On mobile the wide table also requires horizontal scanning.
- **Impacted files:** backend usage aggregation and focused tests; native
  `/admin/usage` route/model/CSS; Admin Overview and Access Code entry links;
  route ledger, behavior test and fixture-backed browser verifier.
- **Suggested minimal fix:** retain the two canonical read-only endpoints;
  page stable queries past backend caps; preserve degraded aggregate metrics as
  unknown; separate loading/error/empty/stale-data states; expose `code_id`,
  search and sort in the URL; turn rows into labeled cards at narrow widths;
  keep the HTML page as rollback only.
- **Verification:** test more than 1,000 source rows and partial source failure;
  validate duplicate/malformed identities; open both global and code drill-down
  fixtures; confirm canonical endpoint selection, exact null messaging, stale
  retry, URL search/sort, malicious identity escaping, no unexpected write, and
  no horizontal overflow with populated rows at 390px and a table at 1440px.

## Admin learner-feedback triage — 2026-08-12

### Issue: the legacy inbox makes incomplete reads and optimistic status look canonical

- **Root cause:** the legacy controller reads the whole `user_feedback` table in
  one unpaged request, groups only by `test_id`, defaults to mixing resolved and
  new work, and mutates rows optimistically before the backend is read again.
- **Severity:** Medium.
- **Impact:** PostgREST caps can hide older feedback without warning; equal
  Reading/Listening identifiers can merge unrelated work; and a successful-looking
  toggle can disagree with a full reload. Filter state also disappears on refresh.
- **Impacted files:** feedback backend route/tests; native `/admin/feedback`
  route/model/CSS; admin chrome link; route ledger, behavior test and
  fixture-backed browser verifier.
- **Suggested minimal fix:** page a frozen backend snapshot using the
  `(created_at,id)` keyset; return typed complete/partial/unavailable coverage;
  redact anonymous capability tokens; group by `(skill,test_id)`; default the
  native inbox to new work; keep type/skill/status in the URL; reload canonical
  GET state after every PATCH; retain the HTML page as rollback.
- **Verification:** cross the simulated response cap; collide a test id across
  skills; reject malformed/unknown coverage; verify admin gate, URL filters,
  hostile note escaping, partial/unavailable messaging, 44px mobile actions,
  no overflow, and PATCH→GET reconciliation on resolve and reopen.

## Admin Reading-attempt analytics — 2026-08-13

### Issue: the legacy dashboard presents capped and unavailable reads as exact truth

- **Root cause:** the backend aggregates one capped attempt read without a
  common upper snapshot bound, performs an unbounded title lookup, and returns
  only a `truncated` boolean. The legacy controller then renders zero/empty
  metrics when the source read fails and continues to show averages from an
  incomplete sample.
- **Severity:** Medium.
- **Impact:** an admin can interpret a lower-bound sample as the exact number of
  submissions or learners, treat an unavailable source as proof of no activity,
  and act on biased band, duration, or skill averages. The wide tables also
  overflow instead of becoming scan-friendly records on mobile.
- **Impacted files:** Reading-attempt aggregation route/service/tests; native
  `/admin/dashboard/reading-attempts` route/model/CSS; rollback controller;
  admin navigation, route documentation, contract tests and fixture-backed
  browser verifier.
- **Suggested minimal fix:** freeze every source read at one UTC snapshot;
  validate and exclude malformed rows; chunk exact title lookups; return a typed
  `complete`/`partial`/`unavailable` contract with nullable unknowns; use `≥`
  for incomplete derived counts and hide derived rates; keep the exact window
  total exact when its count succeeds; make refresh `private, no-store`; retain
  the legacy page only as a truthful rollback target.
- **Verification:** cross the simulated row cap; fail the primary and each
  auxiliary source separately; inject malformed rows and skill groups; confirm
  no anonymous hash reaches the response; verify the admin gate, 7/30/90-day
  URL/request contract, stale-refresh retention, hostile text escaping,
  accessible band data, and populated table-to-card layouts without horizontal
  page overflow at 390px and 1440px.

## Admin Speaking Sessions — 2026-08-13

### Issue: legacy session triage can hide partial data and stale mutation results

- **Root cause:** the legacy controller lets older list/detail requests overwrite
  newer state, treats enrichment failures as empty related data, uses native
  alert/confirm dialogs, and refreshes only the open detail after repair or
  rebuild mutations. The targeted backend repair path could also mark a session
  completed while some failed responses remained. Single-response regrade and
  summary rebuild had the same completion-laundering path because they accepted
  any computable aggregate band without checking every persisted response.
- **Severity:** Critical for grading truth; Medium for the interaction defects.
- **Impact:** an admin can see a completed status that disagrees with persisted
  response failures, mistake unavailable user/question/response enrichment for
  genuine absence, or see a stale list row after a successful-looking repair.
  Filter and deep-link state is also lost across refreshes.
- **Impacted files:** admin session list/detail/regrade/rebuild routes and focused
  tests; native `/admin/speaking/sessions` route/model/CSS; Speaking hub, System
  Alerts and class-work entry links; route docs, contract tests and the
  fixture-backed browser verifier.
- **Suggested minimal fix:** keep the existing canonical endpoints; expose
  enrichment lookup failures, require every regrade/rebuild path to verify that
  no response remains failed or missing-band before clearing errors or syncing
  a class score; add request
  sequence guards, URL-backed filters, safe audio validation, an accessible
  detail/confirmation flow and mandatory detail plus list GET readback after
  every mutation. Retain the HTML page as rollback only.
- **Verification:** cover partial targeted repair, summary error clearing and
  class-score sync at route level; reject malformed responses and unsafe audio;
  race list/detail requests; verify failed-only versus explicit full regrade,
  duplicate-submit prevention, PATCH/POST→detail/list reconciliation, keyboard
  dialog behavior, hostile text escaping, deep links and populated layouts at
  390px and 1440px without horizontal overflow.

## Learner Reading passage workspace — 2026-08-09

### Issue: passage detail pages hide orientation data and fragment the reading flow

- **Root cause:** the Vocab and Skill detail controllers already receive
  canonical difficulty, duration, word count, topic, and skill-focus fields,
  but the page shells rendered only a back link and title above two visually
  unframed scroll columns. The shared question renderer then emitted a generic
  heading, detached score block, and equal-weight answer rows.
- **Severity:** Medium.
- **Impact:** learners start long passages without knowing level or time
  commitment, cannot quickly distinguish assisted Vocab reading from targeted
  Skill practice, and must infer that the right rail is the next step. On
  mobile, the title and three vertically stacked view buttons consumed most of
  the first viewport before any passage text appeared.
- **Impacted files:** `reading-vocab-passage.html`,
  `reading-skill-exercise.html`, their two page controllers,
  `components/reading-questions.js`, and `reading-vocab.css`.
- **Suggested minimal fix:** keep both GET and check endpoints, answer-key
  stripping, glossary, pane toggles, feedback flags, and grading behaviour;
  organize existing response fields into a compact orientation header, frame
  the article and question rail as one workspace, and keep the three reading
  modes in a compact segmented control on narrow screens.
- **Verification:** open one published item from each library; compare rendered
  level/time/word/topic/skill values to its detail response, switch all
  available reading panes, inspect glossary and image lightbox, check every
  supported question type plus feedback flag, and verify independent desktop
  pane scrolling versus normal mobile document flow in light and dark themes.
## Admin Speaking Topics — 2026-08-13

### Summary

The legacy Topics page mixed dense row actions, browser-native confirmation dialogs,
and an inline question expansion into one desktop table. The native redesign makes
the inventory and question library separate but connected workspaces, keeps Part and
search state in the URL, and exposes the backend bulk operations that were previously
described as future work.

### Critical issues resolved

- **AI generation copy contradicted the write contract.** The old control promised to
  add only missing questions while an empty request selected the backend's destructive
  `replace_all` default. The API and UI now default to `missing_only`; rotation is a
  separately labelled destructive action with an accessible confirmation dialog.
- **Question creation omitted canonical Part.** The old form sent no `part`, producing
  a 422 response, and it hid Part 3 follow-ups inside a Part 2 topic. The new editor
  sends and displays each question's actual Part, type, order, cue-card bullets and
  reflection.
- **Metadata lookup failure appeared as zero questions.** A failed aggregate query
  previously produced `question_count=0`, inviting unsafe generation. The response now
  carries `question_metadata_lookup_failed`, renders the count as unknown and disables
  missing-only actions until the source can be read.

### High-priority improvements implemented

- Replaced `confirm()` and duplicated modal CSS with the shared focus-trapped `Dialog`,
  including Escape, focus return and busy-state close prevention.
- Added a mutation lock and canonical list/question readback after create, edit, toggle,
  delete, generation and bulk operations. Acknowledgements must identify the exact
  written records before success is shown.
- Preserved the last valid topic snapshot on refresh failure and kept question-fetch
  failure distinct from a genuinely empty topic.
- Added responsive card rows below 768px, a non-sticky stacked detail surface on narrow
  screens, 40px+ actions, visible focus rings and reduced-motion handling.
- Warned that editing question text invalidates old audio, matching the backend's
  deliberate audio reset behavior.

### Positive observations preserved

- The Part 1/2/3 mental model and direct topic/question CRUD remain familiar.
- The legacy HTML page stays available as an explicit rollback artifact while the
  clean route is owned by Next.js.
## Admin Writing Status — native job monitor (2026-08-13)

### Summary

The legacy `/pages/admin/writing/status.html` was audited against its backend contract and migrated to the clean `/admin/writing/status` route. The screen is a read-only monitor for one `essay_id`, not the daily aggregate dashboard previously described by the route ledger.

### Critical issue resolved: ownership metadata contradicted the product

**Current state**: The ledger claimed `date_range`, `metric`, charts and a daily dashboard, while the implementation only calls `GET /admin/writing/essays/{id}/status`.
**Problem**: Migration planning could invent filters and analytics that no canonical backend supports.
**Recommendation implemented**: The route now exposes one essay identity, canonical state, retry evidence and operational next steps; the ledger was corrected to the real contract.
**Impact**: Admins see backend truth and future batches cannot rely on fictional API behavior.

### High priority issue resolved: overlapping poll responses

**Current state**: The legacy page used an unconditional `setInterval(5000)`.
**Problem**: A slow request can overlap the next interval and a late response can overwrite a newer state.
**Recommendation implemented**: The native monitor schedules the next poll only after the current read settles, keys responses by admin account and essay, pauses while hidden, and stops at terminal status.
**Impact**: The displayed state cannot regress because of overlapping requests or an account/essay switch.

### High priority issue resolved: simulated progress looked canonical

**Current state**: A time-derived percentage was presented as a normal progress bar.
**Problem**: The backend reports an ETA, not realtime completion percentage or actual Deep-tier pass telemetry.
**Recommendation implemented**: The UI labels both the bar and Deep-tier phase as time estimates, caps active progress below completion, and distinguishes canonical status from perceived wait time.
**Impact**: Operators can judge waiting time without mistaking an animation for backend processing truth.

### Medium priority improvements implemented

- Poll failures keep the last matching snapshot and label it stale instead of replacing the status with an error string.
- Retry count and the latest persisted failure are separated into a reliability ledger; malformed optional details are excluded visibly.
- Terminal success links to the native Grade workspace; failure links back to the correct Queue or embedded Mock lane.
- Responsive timeline/cards, keyboard focus, reduced-motion behavior and text-safe rendering are included in the native surface.

### Positive observations preserved

- Five-second polling cadence and terminal states remain compatible with the existing backend.
- `embed` and `mocklane` survive the complete Queue → Status → Grade/Queue flow.
- Direct legacy HTML remains available as the rollback artifact.

## Admin Writing Prompts — native content workspace (2026-08-13)

### Root causes and severity

- **Critical — explicit clears were silently discarded.** `PromptUpdate` accepted
  JSON `null`, but the route removed every `None` before sending the PATCH to
  Supabase. Clearing difficulty, removing a chart or changing away from Task 1
  Academic therefore left canonical database values unchanged while the legacy UI
  reported success. The route now distinguishes omitted fields from explicit nulls,
  permits null only for declared nullable fields and rejects null on required fields.
- **Critical — stale answer keys could outlive their image.** Image replacement,
  removal and soft-delete did not clear all analysis columns, and review writes did
  not prove they still referred to the chart the admin opened. The backend now
  invalidates the full analysis record whenever image/task identity changes, retains
  every published Storage object as immutable historical grading evidence and uses
  `expected_image_public_id` plus analysis status as optimistic-concurrency guards
  on approval.
- **Medium — archive was effectively irreversible.** The API supported inactive rows
  and restore, but the UI only loaded active prompts and labelled soft-delete as
  deletion. The native workspace provides explicit Active and Archived views with
  canonical readback after archive and restore.
- **Medium — answer-key editing dropped schema data.** The legacy form omitted
  `axes_or_categories`; saving an otherwise valid extraction could erase the axes,
  categories or time frame used by grading. The native editor includes every
  `PromptImageAnalysis` field and preserves the image fingerprint when saving.
- **Medium — async writes lacked operational truth.** Browser-native confirms,
  non-awaited list reloads and a “close and reopen” reanalysis message could present
  stale state as success. Mutations are now locked, exact acknowledgements validated,
  and both lifecycle lists read back before success appears. Pending analysis polls
  sequentially only while visible; failed refreshes keep and label the last snapshot.

### Design improvements implemented

- A manually composed content workspace separates server filters, local search and
  student/exam visibility without inventing backend search semantics. A visible cap
  warning explains that local search covers at most the loaded 500 records.
- Prompt cards combine Task, difficulty, audience and answer-key state into a compact
  visual hierarchy; archived content gets one safe restore action.
- Prompt content, image upload and verified answer-key editing live in distinct,
  focus-trapped dialogs. Files accept only PNG/JPG/WebP and upload on Save, avoiding
  abandoned objects when a user merely previews or cancels a form.
- Responsive layouts collapse overview metrics, filters and cards without horizontal
  overflow; keyboard focus and reduced-motion behavior follow the governed admin
  token system.

### Verification

- Backend route tests cover nullable clears, required-null rejection, paired image
  validation, published-object retention, full analysis invalidation, discard path
  scoping, pending-worker exclusion and stale image-fingerprint rejection.
- Frontend model tests reject malformed canonical payloads and pin URL filters plus
  exact mutation acknowledgements.
- The fixture-backed browser flow covers admin gate, active/archive reads, hostile
  text escaping, answer-key approval, student/exam changes, create, archive, restore,
  stale snapshot preservation and 390px layout.

## Admin Writing Regrade Requests — atomic decision workspace (2026-08-13)

### Root causes and severity

- **Critical — Accept was a non-atomic two-table saga.** The legacy route first
  moved `writing_essays` from delivered to reviewed, then separately marked
  `essay_regrade_requests` accepted. A write failure or concurrent admin decision
  could hide feedback from the learner while the request remained pending or was
  rejected. Migration 205 now locks both rows and applies accept/reject through a
  service-role-only RPC in one transaction.
- **Critical — re-delivery could leave an accepted request open.** Standard delivery
  previously updated the essay and then fulfilled the request best-effort; Instructor
  delivery did not close it at all. Migration 205 adds an atomic delivery RPC plus a
  database trigger that fulfils every accepted request in the same transaction as any
  essay transition to delivered.
- **Medium — list completeness and malformed data were invisible.** The endpoint
  silently capped at 300, while the legacy UI trusted every response row and showed
  no stale state. The API reads a 301st sentinel and reports `capped`; the native UI
  also labels stale snapshots and excluded contract violations.
- **Medium — decisions lacked canonical reconciliation.** The legacy modal accepted
  any PATCH response, closed immediately and reloaded one filtered lane. The native
  flow validates the exact request/status acknowledgement, then reads both detail and
  the all-status snapshot back before showing success. A transient post-write failure
  exposes a readback-only retry and never repeats the PATCH.

### Design improvements implemented

- Four lifecycle tabs keep counts from four status-scoped canonical snapshots, with local search over
  learner, cohort, prompt and reason. Cards prioritize the learner's reason beside the
  exact task, band and essay state instead of compressing the decision into a table row.
- A visible three-step strip explains request → atomic decision → re-delivery, and an
  accepted detail links directly to the native grade workspace for the next action.
- The focus-trapped dialog fetches fresh detail before enabling action, requires a
  written rejection reason and removes browser-native confirm/alert behavior.
- Responsive cards collapse to one column at mobile width, with 44px targets, visible
  keyboard focus and reduced-motion support.

### Verification

- Backend tests cover RPC parameter truth, malformed acknowledgements, lifecycle 409s,
  atomic migration sentinels and standard delivery through the new RPC.
- Frontend model tests reject invalid identity/status/band values, pin exact decision
  acknowledgements, URL filters, native ownership and governed styles.
- The fixture-backed production browser flow covers hostile text, fresh detail reads,
  Accept followed by a failed readback without a duplicate PATCH, retry reconciliation,
  native grade handoff, stale snapshot preservation and 390px no-overflow layout.

## 2026-08-13 — Admin Writing Assignments native redesign

### Root causes and severity

- **Critical — a successful fan-out could be repeated after readback failure.** The
  legacy flow used a single `try` around POST plus list reload and had no durable
  acknowledgement state. A network failure after the insert left the same “Giao
  bài” action available, so retrying could create the full Cartesian product again.
  The native flow persists a client request UUID before POST; migration 206 owns
  the request ledger and Cartesian insert in one transaction. An ambiguous retry
  with the same UUID returns the original receipt instead of inserting again. Once
  acknowledged, the client stores that receipt separately and exposes only GET
  reconciliation.
- **Medium — list completeness was invisible.** The assignment endpoint silently
  returned at most 200/500 rows, so counts and search could look complete while old
  assignments were omitted. It now reads a sentinel row and returns `capped`; the
  UI labels the scope rather than presenting partial data as canonical totals.
- **Medium — cohort failures masqueraded as an empty catalog.** The legacy
  `loadCohorts()` swallowed every error and replaced the source with `[]`. The new
  composer loads prompts, students and cohorts independently with source-specific
  errors, excludes malformed rows and never enables a stale failed source.
- **Medium — the destructive scale of fan-out was hidden behind browser confirm.**
  Admins selected inputs in one long modal, then saw a generic native confirmation.
  A dedicated review step now shows `đề × học viên = bài sẽ tạo`, the exact class,
  timing, feedback depth and duplicate policy before POST. The reviewed cohort
  count is also sent as a backend precondition; a membership change returns 409
  and forces a fresh review instead of silently changing fan-out scale.

### Design improvements implemented

- Grouped register cards mirror one give-action and expose per-row learner, prompt,
  timer/deadline, lifecycle state and the next grade action without a wide table.
- The composer keeps individual, cohort, multi-prompt, Student Hub deep-link,
  soft-check, IELTS timer and L1–L5 capabilities, with searchable bounded pickers.
- URL-backed status, cohort and local query filters are shareable; stale snapshots,
  caps and malformed rows remain visible instead of collapsing to empty states.
- The focus-trapped two-stage dialog, 44px controls, visible keyboard focus,
  reduced-motion treatment and 390px single-column layout replace `alert/confirm`.

### Verification

- Backend tests pin the 501st sentinel and confirm the public response remains at
  500 rows with an explicit `capped=true` signal.
- Model tests reject impossible timer/status identities, duplicate IDs, partial
  receipt verification and malformed receipts, and cover grouping, URL normalization
  and server caps. The browser fixture also proves a missing non-first assignment
  keeps reconciliation pending and a definitive 422 returns the admin to editing.
- The fixture-backed browser flow checks hostile text, partial picker failure,
  exact review arithmetic, successful POST followed by failed readback, GET-only
  retry reconciliation, and mobile overflow.
## 2026-08-13 — Admin Writing Cohorts native redesign

### Summary

The clean `/admin/writing/cohorts` route now owns a native React operational
workspace while the direct legacy HTML remains the rollback target. The audit
found a canonical contract bug before visual work: the backend keyed columns by
`prompt_id`, although product policy permits assigning the same prompt in a new
lesson. A later give could therefore overwrite an earlier one in the matrix.

### Critical issues resolved

- **Repeated gives no longer disappear.** Columns now use the real
  assignment-group × prompt identity, with immutable assignment-id fallback for
  legacy standalone rows. Every give remains independently visible and links to
  its own essay.
- **Deadline truth uses instants.** Overdue calculation parses timezone-aware
  timestamps instead of comparing differently formatted ISO strings.
- **Read failures never masquerade as empty state.** List and detail requests
  preserve their last account-keyed snapshot, label it stale, and expose retry;
  malformed rows/cells are counted visibly.

### High-priority UX improvements

- Replaced emoji-only tooltip cells with readable status labels, deadline/band
  context, a persistent legend and URL-restorable activity/status/query filters.
- Added a responsive master/detail hierarchy, compact cohort summaries, sticky
  student/header context and 44px controls. Mobile keeps the matrix horizontally
  scrollable without overflowing the page shell.
- Grade actions are rendered only for canonical cells carrying an `essay_id`;
  empty assignments remain truthful non-actions.

### Positive observations preserved

- Full backend admin statuses remain visible rather than collapsing to the
  learner-facing lifecycle.
- The legacy rollback page and direct URL stay available for parity verification.
## 2026-08-14 — Native `/admin/reading/preview` migration

### Root causes and severity

- **Critical — image writes could look complete before canonical truth was known.**
  The legacy preview treated any resolved upload/delete request plus a reload as
  success, without validating the mutation identity or the exact persisted image
  path. The native flow validates the question-bound ACK and only reports success
  after the full test GET confirms the canonical question payload. Ambiguous
  responses are reconciled with GET and never replay the non-idempotent upload.
- **Medium — paper QA and student preview were conflated.** The old workspace
  rendered an admin-specific answer-key inspector but documentation described it
  as the student view. The native page labels itself as Paper QA, while a separate
  link opens the exact student review renderer through `admin_test_id` without
  creating an attempt.
- **Medium — malformed content was silently absorbed.** Invalid passage/question
  identities, count drift, malformed IMG-PROMPT records and duplicate question
  numbers could disappear into the render. The normalizer now excludes only rows
  that cannot be identified and exposes each contract issue visibly.
- **Medium — long papers lacked a usable information hierarchy.** Passages,
  questions, answer keys and diagram tooling ran as one long column. The new
  workspace separates reading rhythm from QA inspection and adds passage-level
  sticky navigation.

### Design improvements implemented

- A restrained test hero, explicit admin-QA banner and compact truth metrics make
  scope/status visible before the paper body.
- Passage text uses a bounded reading measure; the question inspector separates
  prompt/options, parsed template, diagram workflow and canonical answer evidence.
- Consecutive diagram/flow questions expose exactly one image owner, matching the
  student renderer. IMG-PROMPT metadata is collapsible and copyable beside it.
- Mobile navigation becomes a contained horizontal passage strip; cards collapse
  to one column without page overflow. Controls retain 44px targets, visible focus,
  focus-trapped delete confirmation, dark tokens and reduced-motion behavior.
- The legacy HTML remains an explicit rollback link; content-library and Reading
  feedback deep links now target the clean native route.

### Verification

- Model/source tests cover nullable-number truth, malformed/count drift, duplicate
  identity reporting, block ownership, IMG-PROMPT matching and exact mutation ACKs.
- A fixture-backed browser flow proves admin gating, sanitized hostile Markdown,
  answer/explanation visibility, one image manager per block, multipart upload and
  delete followed by canonical readback, student-like preview URL, mobile/desktop
  containment, dark mode and absence of unexpected writes.

## 2026-08-14 — Native `/admin/listening` content inventory

### Root causes and severity

- **Medium — lookup failure looked like missing authoring.** The legacy table
  rendered a bare `?` when a per-row exercise request failed. This made an API
  outage indistinguishable from an incomplete lesson. The native inventory has
  explicit loading, ready and unavailable states; unavailable copy states that it
  does not mean “chưa có”.
- **Medium — malformed payloads could become a false empty screen.** The legacy
  controller defaulted absent `items` and `total` to empty values. The native
  normalizer rejects an invalid envelope, excludes only malformed identified rows
  and keeps the backend total visible.
- **Medium — filter and page context were not restorable.** Status and offset lived
  only in memory, so refresh/back lost the admin’s place. Native status and page
  live in the clean URL and reset coherently when the filter changes.
- **Low — the nine-column table hid the authoring workflow.** The inventory listed
  raw fields and six tiny actions with little hierarchy. A four-step authoring map,
  grouped audio/status/exercise evidence and clearer primary identity reduce scan
  cost without inventing aggregate metrics.

### Design improvements implemented

- A compact operational hero separates Cambridge test management and learner
  preview from the canonical content list; the legacy page remains an explicit
  rollback link rather than a competing primary destination.
- Each row exposes content identity, classification, audio readiness, publication
  status and all four exercise types. Exercise chips retain draft/published/archive
  truth and report malformed or duplicate records instead of silently collapsing.
- At tablet widths the table becomes labelled record cards; mobile actions retain
  44px targets. Focus-visible states, token-only dark surfaces and reduced-motion
  behavior follow the governed admin language.
- This batch is intentionally read-only. Detail, status and metadata mutations stay
  on their existing workspaces until separately audited and migrated.

### Verification

- Model tests cover filter normalization, canonical list invariants, malformed-row
  reporting, exercise ownership/status/duplicates, audio sentinels and durations.
- A fixture-backed browser flow proves admin gating, URL state, escaped hostile
  titles, per-row partial failure truth, deep-link identity, mobile/desktop
  containment, dark mode and zero business writes.

## 2026-08-14 — Native `/admin/listening/content/[contentId]` detail

### Root causes and severity

- **Critical — publication writes could be shown optimistically.** The legacy
  workspace merged the PATCH response into local state, so a stale or partial ACK
  could disagree with persisted backend truth. The native flow requires an explicit
  confirmation and only reports success after a canonical content GET confirms the
  requested state.
- **Medium — an exercise outage erased otherwise valid metadata.** Content and
  exercise requests previously shared one `Promise.all`; either failure collapsed
  the whole page. They now load independently, and an exercise failure explicitly
  says that it is not evidence of an empty lesson.
- **Medium — malformed and cross-content exercise rows were treated as empty.**
  The shared normalizer validates ownership, aggregates duplicate blocks, exposes
  mixed publication status and counts supplemental mini-tests separately.
- **Medium — audio provenance and render waiting were ambiguous.** Content audio,
  parent-test audio, pending ElevenLabs output and failed/unknown states now remain
  distinct. Automatic polling is bounded to 60 seconds and exposes its expiry.

### Design improvements implemented

- The page uses a canonical metadata hero, compact truth cards, a four-type
  exercise matrix and a readable transcript surface instead of an undifferentiated
  editor column.
- Publication actions explain learner visibility and attempt-history preservation
  before mutation. The accessible dialog traps/restores focus, supports Escape and
  stacks into a mobile sheet with 44px controls.
- The native detail owns the clean path identity. Existing metadata and exercise
  editors remain explicit links, and the legacy detail remains an explicit rollback
  target rather than being silently removed.
- Responsive grids collapse without horizontal page overflow; hostile title and
  transcript text remain escaped by React. Dark surfaces, focus-visible states and
  reduced-motion behavior use the governed admin tokens.

### Verification

- Model/source tests cover identity validation, safe signed-audio URLs, independent
  reads, status readback, bounded polling, rollback/editor links and responsive CSS.
- A fixture-backed browser flow proves partial exercise failure, escaped hostile
  data, mobile/desktop containment, focused confirmation, exactly one PATCH and
  canonical GET reconciliation against a deliberately stale mutation response.

## 2026-08-14 — Native `/admin/listening/tests` inventory

### Root causes and severity

- **Critical — a resolved PATCH was treated as the final truth.** The legacy list
  refetched broadly but never proved that the exact test carried the requested
  status or `exam_only` flag. Native mutations use a confirmation dialog, ignore
  the PATCH payload and validate an exact test GET before refreshing the list.
- **Medium — malformed list envelopes became empty inventories.** Missing `items`,
  invalid counts and malformed test rows were defaulted or rendered as absence.
  The normalizer now rejects invalid envelopes, excludes only bad rows and keeps
  the backend total plus a visible contract warning.
- **Medium — operational context disappeared on refresh.** Status, type, search
  and page lived only in JavaScript memory. They now round-trip through the clean
  URL, with a bounded debounced search and coherent page reset.
- **Medium — publication and learner visibility were visually conflated.** A
  published `exam_only` test is valid but absent from the practice library. The
  native page presents lifecycle and scope as separate canonical dimensions.

### Design improvements implemented

- A visibility-boundary explainer precedes the inventory, then each responsive
  record groups identity, type/scope, section/audio completeness and lifecycle.
- Import actions remain direct legacy workspaces and test detail remains an
  explicit legacy link; the old tests list is retained as a rollback target.
- Mutation copy explains the backend audio publish gate and the possible 409 when
  returning a test that an active mock exam still owns. The UI distinguishes a
  confirmed backend write from a failed follow-up list refresh.
- Mobile cards avoid page overflow, keep 44px actions and preserve visible focus;
  dark surfaces and reduced-motion behavior stay on shared admin tokens.

### Verification

- Model/source tests cover URL normalization, row/envelope invariants, backend
  total preservation, identity-bound readback, dialog ownership and responsive CSS.
- The fixture-backed browser flow uses hostile text and deliberately stale PATCH
  responses to prove no optimistic state, then validates status and exam-only via
  exact GET plus list refresh on mobile and desktop.

## 2026-08-14 — Native `/admin/listening/tests/[testId]` workspace

### Root causes and severity

- **Critical — audio mode could disagree with persisted truth.** The legacy page
  changed local state before PATCH and deliberately kept that selection after a
  failed write. The native selector may preview the requested panel while saving,
  but a rejected mutation rereads the test and returns to the canonical mode.
- **Critical — destructive and publication ACKs were trusted too broadly.** Audio,
  map, status and cascade-archive writes now ignore their mutation payload and
  require an exact test GET. Hard delete cannot be read back, so it requires the
  UUID, human Test ID and complete non-negative cascade summary in its ACK. A
  profile-keyed one-shot receipt carries cleanup totals or storage-orphan warnings
  to the inventory without being consumed twice by React Strict Effects.
- **Medium — concurrent actions could double-submit.** Upload, assemble, map,
  lifecycle and delete controls now share one operation lock; dialogs remain busy
  until canonical reconciliation finishes.
- **Medium — preview-signing failure looked like missing media.** Test audio and
  map storage truth is rendered separately from signed URLs. A stored asset whose
  preview cannot be minted is reported as an operational error, never as absence.
- **Medium — archive semantics were visually conflated.** Parent-only lifecycle
  changes are now separated from “Lưu trữ toàn bundle”, which verifies every
  returned section is archived while preserving attempts.

### Design improvements implemented

- A canonical hero and metadata strip lead into an audio pipeline workspace, then
  section ownership, cue timeline, map assets, publication and a dedicated danger
  zone. Test identity and learner/exam scope remain visible at the top.
- Audio modes expose only relevant upload controls. Full and section assets show
  canonical storage paths independently from playable signed previews; assemble
  stays disabled until sections 1–4 are actually ready.
- Plan-label cards retain manual-upload provenance, local image preview, MIME/size
  validation and explicit $0 API copy. Existing API-generated assets remain
  identifiable even though generation itself is decommissioned.
- Confirmations use the shared focused dialog. Hard delete requires typing the
  human Test ID; mobile grids collapse without page overflow and all controls keep
  visible focus, reduced-motion support and token-governed surfaces.
- `/admin/listening/tests/[testId]` owns the clean identity. The direct HTML page
  remains an explicit rollback link; import and specialized editors remain direct
  legacy workspaces until their own audited batches.

### Verification

- Model/source tests cover identity, duplicate/malformed children, mutation
  readbacks, safe media URLs, upload constraints, publish gates, hard-delete ACKs,
  route ownership, responsive CSS and dialog boundaries.
- A fixture-backed browser flow proves escaped hostile data, mobile/desktop
  containment, explicit map-signing failure, failed-mode rollback, stale-ACK
  rejection, busy locking, map deletion, cascade archive and typed hard delete.
- TypeScript strict and the production Next.js build include the dynamic route;
  legacy test-detail behavior tests remain green as rollback coverage.
