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

- **Root cause:** prompt, timer, file import, textarea, word count, autosave, and
  submission were rendered as equal-weight utility blocks in a full-screen
  modal. The learner had no visible minimum-word target or pre-submit sequence.
- **Severity:** Medium.
- **Impact:** the main task—reading the prompt and producing a complete response—
  competes with tooling; learners must remember the Task 1/Task 2 word minimum.
- **Impacted files:** `writing/dashboard/page-shell.tsx`,
  `writing/dashboard/writing-behavior.tsx`, `writing-dashboard.html`, and
  `writing-dashboard.css`.
- **Minimal fix:** preserve every assignment/draft/submit contract while shaping
  the modal into a prompt rail and paper-like editor, deriving the 150/250-word
  guide from the canonical task type and keeping save/submit status adjacent to
  the final actions.
- **Verification:** open Task 1 and Task 2 assignments, restore a saved draft,
  type through the target, import text, save, submit, and repeat at 390px.

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
