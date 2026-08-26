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

## Learner exercise review remediation — 2026-08-26

### Issue: Reading review styled every answer as correct

- **Root cause:** the reading solution returned only an aggregate score, while
  `.cr-answer` always used success styling and omitted the learner's submitted
  answer. A 9/10 result could therefore display ten green explanation cards.
- **Severity:** Critical — the review contradicted the canonical grade and made
  it impossible for a learner to identify the missed question.
- **Impacted files:** `backend/services/quiz_service.py`
  (`_grade_course_section`, section-result responses),
  `frontend/public/js/course-reading.js` (`renderQuestion`), and
  `frontend/public/css/course-exercises.css` (`.cr-answer`).
- **Minimal fix:** derive per-question `is_correct` values from the same exact
  backend matcher used for the total, then render explicit “Bạn trả lời”,
  “Đáp án đúng”, and text status. Legacy responses stay visually neutral.
- **Verification:** confirm exact-match backend tests keep `with` incorrect for
  `with a blue roof`; confirm frontend tests show both explicit text and
  success/error styling and never infer correctness client-side.

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

### Teacher-authored full-test results (2026-08-25)

- Confirmed the released-result hierarchy remains easy to scan: Overall first,
  four skill bands second, then the examiner comment, retest notice, and
  per-skill review actions for Listening, Reading, Writing, and Speaking.
- Kept retest status independent of band availability, so a scored Speaking
  result can still carry a prominent teacher-requested retest instruction.
- Replaced the generic AI-attribution footer with a truthful publication stamp:
  the result was confirmed by a teacher/examiner before release. This avoids
  implying that teacher-final Speaking bands and comments were machine-graded.
- Verification: desktop production pass at 1920×1080, accessibility snapshot
  for labels/statuses, and focused source tests for result links, retest copy,
  authored feedback, and the publication stamp.

### Course multi-section completion gate (2026-08-20)

- Replaced the premature MCQ-only verdict with one learner-facing completion
  checklist for every section actually present in the assigned bank: quiz,
  sentence writing, short reading, listening and pronunciation.
- Partial work remains resumable and is labelled “Đang hoàn thành”; pass/fail
  language, the combined percentage and the assignment hand-in are withheld
  until every required section has a canonical result.
- Reading and listening now use explicit submit actions instead of “self-study”
  wording. Their result bars show section accuracy and return learners to the
  same completion checklist, so the next unfinished section is always visible.
- The admin effort table prioritizes completion state, latest combined score,
  number of graded attempts and total active time. The learner drill-down shows
  a per-attempt section breakdown rather than forcing teachers to infer the
  total from unrelated screens.
- Accessibility contract: progress uses text plus native progress semantics;
  incomplete/complete states never rely on colour alone; existing shared
  buttons, table containment and focus styles are reused rather than creating a
  new control family.


### Native `/instructor/grade` migration (2026-08-16)

- Replaced the legacy stacked cards and browser confirmations with a focused
  review workspace: sticky teacher-note/action rail, readable essay canvas,
  shared learner feedback renderers and accessible confirmation dialogs.
- Made uncertainty visible. Version-budget and active-review lookup failures no
  longer silently hide actions; delivery is disabled with an explicit reason.
- Bound delivery to both `review_id` and `essay_id`, persisted the same note in
  the audit review and student-visible essay, and enforced the server transition
  from `claimed/edited` exactly once.
- Every note, delivery, regrade and revoke mutation is followed by canonical
  readback. Ambiguous state locks further writes and offers a read-only
  reconciliation action; no POST is replayed automatically.

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
  390×844/1280×900. Next production build also passed all 33 route outputs in
  this batch.

## Phase 1–3 implementation (completed on audit branch)

- Added a safe, data-driven Grammar Lab renderer and validator for semantic
  checks, diagrams, repair strips, IELTS transfer and takeaway blocks. The five
  pilots each contain four inline learning moments, and 15 additional priority
  articles received family-appropriate visual blocks (20 articles total).
- Reframed Grammar home as two explicit modes: **Tra cứu** and **Học & luyện**.
  Editorial completeness bars were removed; signed-in recommendations, recent
  history, saved items and weak areas come from existing canonical endpoints.
- Added canonical Next search with level/skill facets, a prerequisite-aware
  roadmap, and an exercise directory with dynamic categories and authenticated
  KP mastery. Guests receive honest static fallbacks, never fabricated progress.
- Backend search/exercise contracts now carry canonical article metadata and
  skill relevance; full-bank quiz links remain unchanged.
- Final verification: learning-block validator 184/184 files; backend Grammar
  403/403; frontend 6,975/6,975; production build
  35/35 route outputs; mobile QA at 390×844 found no horizontal overflow across
  home, search, roadmap, exercises or the five pilots.

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

### Answer-explanation rendering follow-up (2026-08-21)

#### Issue: Authored explanation structure is flattened into one text block

- **Root cause:** `course-runner.js:49` and `course-writing.js:23` implement an
  inline-only formatter: escape HTML, then replace `**…**` with `<mark>`. The
  immediate MCQ renderer at `course-behavior.tsx:282` injects that result
  directly inside one `.cx-why` container. The writing result renderer at
  `course-writing.js:416` does the same inside `.cw-model`. Neither formatter
  creates paragraphs, lists, headings, or explicit label/value groups.
- **Severity:** Medium.
- **Impact:** learners receive the correct answer and canonical explanation, but
  must parse several independent teaching claims as one grey paragraph. The
  cost is highest on “find the error / why wrong / constraint” questions, where
  the learner needs to compare the chosen distractor, the correct rule, and the
  repair step rather than reread prose.
- **Evidence:** production contains 500 populated explanations across C1-B01 to
  C1-B05. All five banks have ten multiline writing explanations with authored
  blank-line sections and bold labels; the current renderer collapses those
  line breaks. C1-B05's 90 MCQ explanations are authored as single paragraphs;
  the longest is 527 characters, so renderer support alone will preserve future
  lists but existing long MCQ content also needs deliberate list markers.
- **Impacted files:** `frontend/public/js/course-runner.js:40-50`,
  `frontend/app/(authed)/course-exercises/course-behavior.tsx:270-287`,
  `frontend/public/js/course-writing.js:16-24,414-424`, and
  `frontend/public/css/course-exercises.css:832-845,1108-1124`.
- **Suggested minimal fix:** introduce one small, safe course-content formatter
  that escapes first and supports only the authored subset actually needed:
  `**strong label**`, blank-line paragraphs, `-`/`*`/`•` unordered items and
  `1.` ordered items. Render the first explanatory paragraph as the lead rule,
  subsequent authored items as a semantic list, and labels such as “Đáp án
  mẫu”, “Cũng được chấp nhận”, and “Chấm thế nào” as strong text—not generic
  browser-yellow `<mark>` elements. Preserve authored list boundaries. For the
  legacy single-paragraph MCQ bank only, use a bounded fallback (at least 240
  characters and three complete sentences): keep the first sentence as the
  lead and make later complete sentences bullets. Never split commas or
  semicolons, and never transform shorter prose.
- **Target hierarchy:** retain the existing correctness summary first; show the
  chosen-distractor trap second when present; then show a labelled “Vì sao”
  panel with a short lead, 2–4 authored bullets, and the existing topic axis as
  quiet metadata. Highlight only grammar forms, correct repairs, or explicit
  author labels—not whole sentences.
- **Verification:** fixture explanations covering one paragraph, several
  paragraphs, unordered and ordered lists, bold labels, empty content and
  hostile HTML; then light/dark and 390px/desktop visual checks on correct,
  wrong, writing-result and long-explanation states.

#### Issue: The same explanation has three incompatible render contracts

- **Root cause:** immediate feedback uses `md()`, writing review duplicates a
  second `md()`, the shared learner/admin answer report escapes `q.explain` into
  one `<p>` at `course-report.js:61-74`, and the durable mistake page sends the
  value through the prompt formatter at `quiz-progress.js:41-54`. Admin writing
  additionally carries a fourth copy, `cwMd()` in `admin-classes.js:1298`.
- **Severity:** Medium.
- **Impact:** the same canonical explanation can show highlights in one place,
  literal Markdown or flattened whitespace in another. Learner and teacher may
  discuss screens that visually emphasize different evidence.
- **Impacted files:** `course-behavior.tsx`, `course-writing.js`,
  `course-report.js`, `quiz-progress.js`, `admin-classes.js`,
  `course-exercises.css`, `course-report.css`, and `quiz-progress.css`.
- **Suggested minimal fix:** make the safe formatter a shared pure module and
  use it for explanation content on all learner/admin course surfaces. Keep
  prompt formatting separate: a question stem and an explanation have different
  block semantics. No backend or database migration is required; the canonical
  `explain` string is already preserved by `quiz_service.py:3424-3470` and
  `quiz_service.py:4200-4209`.
- **Verification:** one shared formatter contract test plus parity assertions
  proving that immediate feedback, learner report, admin report, writing result,
  and mistake history emit the same paragraph/list/strong structure.

#### Issue: Feedback announcement semantics are broader than the changed result

- **Root cause:** `#cx-q` is the polite live region, while answering mutates only
  `#cx-why` and adds the next button. The explanation label is a styled `<span>`,
  not a heading tied to the explanation panel.
- **Severity:** Low.
- **Impact:** visual users see a local result, but assistive technology may
  announce too much of the question card or provide no useful heading when the
  learner navigates back through the new content.
- **Impacted files:** `page-shell.tsx:50-51` and
  `course-behavior.tsx:282-289`.
- **Suggested minimal fix:** give the result summary its own concise polite
  status, make “Vì sao” a real heading, and connect the explanation region with
  `aria-labelledby`. Preserve keyboard position unless testing shows that moving
  focus to the result is necessary; never force focus past the explanation to
  “Câu tiếp”.
- **Verification:** VoiceOver/NVDA pass for correct and wrong selection, followed
  by keyboard navigation through the trap, explanation heading/list, and next
  action without duplicate full-question announcements.

#### Positive observations to preserve

- Backend answer/report paths return the canonical raw explanation and keep
  distractor-specific `why_wrong` separate; no content has been lost in transit.
- HTML is escaped before the current limited Markdown substitution. The richer
  renderer must retain this fail-closed order and must not accept arbitrary HTML.
- The existing correctness summary, text state badges, selected-distractor trap,
  semantic color tokens, and responsive answer card already establish the right
  top-level reading order.

#### Audit limitation

- Chrome had no connected browser session during this audit, so findings are
  based on production content queries and renderer/CSS contracts. A signed-in
  production screenshot pass remains required before calling the visual repair
  complete.

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

### Native migration update — 2026-08-15

- `/reading/vocab/[slug]` and `/reading/skill/[slug]` now share one native React
  workspace. The implementation keeps the canonical GET/check contracts and
  rollback HTML, rejects malformed or answer-bearing detail payloads, and only
  locks a question after a valid server grading result.
- The design-system audit changed the legacy tabs into a labelled tablist with
  roving keyboard focus, kept the compact orientation header and independent
  desktop panes, and added focus-contained glossary/image dialogs. The active
  library cards now link directly to the native routes.
- Verification is pinned by model/route tests, a fixture-backed browser flow,
  the production Next build, and authenticated Legacy↔Next parity pairs.
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

## 2026-08-14 — Native `/admin/listening/attempts` evidence inventory

### Root causes and severity

- **Critical — association lookup failure was rendered as canonical absence.**
  `_rows_by_id()` swallowed `users` or `listening_tests` read failures and returned
  empty maps, so the admin saw dashes indistinguishable from genuinely deleted
  associations. The backend now returns an explicit failure flag plus the failed
  tables; list and detail surfaces render a warning and mark affected cells.
- **Medium — malformed grading data could become a plausible result.** The legacy
  renderer trusted list/detail envelopes, score ratios and question objects. The
  native normalizer checks exact attempt identity, score/total/accuracy agreement,
  lookup flags and per-question scalar/bool contracts, then reports excluded rows
  without replacing the backend total.
- **Medium — filter and detail context disappeared on navigation.** User, test,
  type, status, page and selected attempt now round-trip through the clean URL.
  List reads are keyed by admin account and filter scope; detail reads have their
  own sequence guard so a late response cannot overwrite another attempt.
- **Low — the route was missing from migration truth.** The deployed HTML page
  existed but was absent from the route ledger. The ledger, site overview,
  invariant matrix, sidebar and overview activity links now name the native owner.

### Design improvements implemented

- A compact evidence map explains identity, result and per-question layers before
  the inventory. Filters are fully labeled and grouped; the table presents human
  identity, test provenance, lifecycle, score/accuracy and elapsed time.
- Selecting a row opens an inline evidence workspace with summary cards, trap
  totals and a separate per-question table. Closing it removes only the attempt
  identity from the URL while preserving active filters.
- Missing association and failed lookup are visually distinct. Mobile tables
  become labeled cards rather than horizontal page overflow; desktop retains dense
  scanning, visible focus and token-governed dark/reduced-motion behavior.
- The direct HTML page remains an explicit rollback link and preserves the one
  filter (`user`) that the legacy runtime actually supports.

### Verification

- Backend tests cover list/detail failure flags and prove missing join data is no
  longer silently presented as empty truth.
- Model/source tests cover URL ownership, strict envelopes, identity and score
  drift, lookup consistency, duration formatting, admin gate and native links.
- The fixture-backed browser flow proves hostile React escaping, malformed-row and
  lookup warnings, exact detail URL identity, trap evidence, canonical pagination
  and mobile/desktop containment with no JavaScript errors.

## 2026-08-14 — Native `/admin/listening/dictation` evidence workspace

### Root causes and severity

- **Critical — aggregate silently sampled a capped result set.** The legacy
  endpoint requested one 2,000-row batch, still subject to PostgREST row caps,
  then labelled it as the full session count and mean. The backend now pages the
  complete filtered scope in bounded 1,000-row reads before aggregating.
- **Critical — broad learner filters stopped after 200 matched accounts.** Both
  list and aggregate could omit valid sessions without warning. Learner ID lookup
  now uses the same bounded complete-scope pagination and is regression-tested
  beyond 1,000 matches.
- **Critical — learner lookup failure looked like an empty association.** User
  enrichment reused a helper that swallowed lookup failures. List and detail now
  expose an explicit `association_lookup_failed` contract and preserve the user
  ID while the native UI marks affected identity cells.
- **Medium — detail omitted the reference sentence and learner identity.** An
  admin could see a score and typed text but not what the learner was expected to
  hear. The detail endpoint now includes canonical user identity; the workspace
  presents reference and learner text side by side with word/error evidence.
- **Medium — one failed read erased unrelated evidence.** Legacy `Promise.all`
  hid the valid list when aggregate failed. Native list and aggregate reads are
  independently scoped, guarded and retryable.

### Design and verification

- Filters, page and selected session round-trip through the clean URL. A three-step
  evidence map leads from aggregate trends to session rows and then sentence detail.
- Accuracy always carries a textual interpretation, tables become labeled cards on
  mobile, selection is a real button, and focus moves to exact session detail.
- Backend tests prove user-lookup truth and aggregation beyond 1,000 rows. Model,
  source and fixture-backed browser contracts cover malformed data, stale-response
  rejection, independent failures, exact identity, hostile text escaping,
  pagination, responsive containment and rollback behavior.

## 2026-08-14 — Native `/admin/listening/content/[contentId]/edit` metadata editor

### Critical issues resolved

- **Explicit clears were silently ignored.** The PATCH schema accepted `null`, but
  the route checked values instead of Pydantic's provided-field set. Clearing an
  existing license, source URL, CEFR or IELTS section therefore produced no DB
  update. The route now distinguishes omitted from explicit `null` and tests each
  nullable field as canonical API behavior.
- **Concurrent editors could overwrite each other.** The legacy form sent all nine
  fields from a potentially stale snapshot and the backend did not update
  `updated_at`. The native editor computes a field delta, sends the snapshot's
  `expected_updated_at`, and the backend applies the write through the same version
  filter while minting a new UTC timestamp. A 409 locks the editor before reload.

### High-priority improvements

- **Known-bad license data could pass differently by casing or URL scheme.** The
  server now trims license/source values, blocks NC case-insensitively and accepts
  only HTTP(S) attribution URLs. Topic tags are trimmed and deduplicated using a
  case-insensitive key; the client mirrors these rules before network activity.
- **Mutation success was inferred from the PATCH response.** Every save now writes
  an account/content receipt, ignores the ACK as truth and performs an exact GET.
  Ambiguous responses keep the form locked and expose a GET-only reconciliation;
  the request is never automatically replayed.

### Design improvements implemented

- The editor is organized into core content, classification, discovery and rights
  cards, with a read-only provenance rail and sticky delta summary. Nullable CEFR
  and IELTS section start visibly unassigned instead of receiving fabricated
  defaults.
- Transcript length, topic-tag preview, attribution dependencies and paid-tier
  incompatibility are visible beside the controls they affect. Reset, leaving,
  pending-receipt discard and conflict reload use explicit confirmation boundaries.
- Mobile collapses the form and provenance rail to one column, keeps 44px actions,
  avoids horizontal page overflow and honors focus and reduced-motion preferences.
  The HTML editor remains directly available as the rollback path.

### Verification

- Backend route tests cover explicit nulls, tag normalization, lowercase NC,
  non-HTTP URL rejection, version conflict and fresh `updated_at` truth.
- Model/source tests cover exact transcript preservation, nullable fields, delta
  construction, receipt scope, canonical comparison, route ownership and token-only
  responsive CSS. The browser fixture covers successful readback, 409 conflict and
  an after-commit 503 reconciled without a second PATCH.

## 2026-08-14 — Native `/admin/listening/segments` Dictation authoring

### Root causes and severity

- **Critical — saving could update the wrong Dictation block.** Production has
  many legitimate `(content_id, exercise_type)` pairs with different
  `order_num` values, while the legacy backend selected only the first row and
  ignored order identity. Native saves carry exact `exercise_id`, content, type,
  order and `updated_at`; legacy fallback lookup is also scoped by order.
- **Critical — write success was not canonical truth.** The old editor trusted a
  small POST acknowledgement and the backend returned success even when an UPDATE
  matched no rows. Update/insert results must now contain a persisted row, and the
  browser reports success only after a complete Dictation GET matches every field.
- **Critical — concurrent editors could silently overwrite or duplicate a block.**
  Updates now apply an atomic version filter; creates declare `expected_absent`.
  Migration 208 enforces the verified logical block key
  `(content_id, exercise_type, order_num)` without forbidding multiple orders.
- **Critical — a segments-only save could erase unrelated JSONB configuration.**
  The shared upsert previously defaulted omitted `payload` to `{}` and wrote it
  over the stored row. Exact Dictation updates now preserve canonical payload
  unless the caller explicitly supplies that field, with a regression test.
- **Critical — a deleted exact identity could silently become a new exercise.**
  `exercise_id` now requires a valid UUID and `expected_updated_at`; a missing or
  mismatched row is a 409 and never falls through to INSERT.
- **Medium — timestamp tooling depended on private audio internals.** The legacy
  page polled `_audio.currentTime`, continued polling across pause and coupled the
  editor to an implementation detail. The shared player now exposes the additive
  `getCurrentTime()` public method used by the native route.
- **Medium — whitespace-tolerant alignment could map to the wrong character.**
  The previous fallback searched a collapsed transcript but reused that index in
  the original alignment arrays. The model carries collapsed-to-original offsets
  and alignment-token offsets, including multi-character and surrogate-pair data.
- **Medium — an acknowledged POST followed by a failed GET lost reconciliation
  truth.** The receipt now distinguishes write acknowledgement from readback; a
  later 403/404 keeps the form locked and permits GET-only reconciliation without
  replaying the POST.
- **Medium — malformed inventory rows could masquerade as an absent order.** The
  native editor now fails closed when any Dictation row cannot be normalized, so
  it never offers an `expected_absent` create against incomplete canonical truth.
- **Medium — only existing blocks were reachable.** Admins can now create the next
  ordered Dictation block through the native UI. The create uses `expected_absent`,
  remains locked behind a pre-write receipt, and installs the block only after a
  canonical GET confirms it.
- **Medium — the learner lazy-create path could race the new unique key.** Two
  simultaneous first attempts can both miss the preflight lookup. The loser now
  recognizes PostgreSQL `23505`, reads the canonical order-one winner and proceeds
  without an incidental learner-facing 500. The other insert paths were audited:
  full-test/drill imports derive globally distinct `idx + 1` orders per content
  and roll back the entire import on persistence failure.
- **Low — migration truth named the wrong query contract.** The ledger documented
  `section_id/status`, while the live tool requires `content_id`. Route, inventory,
  detail and sidebar now use the clean native entry and retain exact HTML rollback.

### Design and verification

- The editor follows an explicit listen → draft → verify sequence. Canonical audio,
  transcript parsing, segment text/timestamps, block identity and publication are
  visually separated while a sticky action boundary keeps save truth visible.
- Multiple Dictation blocks are selectable by order and status; unsaved switching,
  replacement parsing, deletion, leaving, receipt discard and conflict reload use
  focused confirmation dialogs. Draft, published and archived states round-trip
  without coercion. Missing/malformed/duplicate data fails visibly.
- The global “Chia cắt audio” navigation returns to the native content inventory,
  where every row carries its exact `content_id`; opening the parameterized route
  without that identity also redirects there instead of rendering a dead editor.
- The source transcript is explicitly read-only canonical evidence. Admins edit it
  in the native Metadata screen, then regenerate segments, so the authoring form
  no longer implies that an unpersisted scratch edit changed the content record.
- Pending receipts intentionally use `sessionStorage`, scoped by admin and content.
  This keeps simultaneous tabs from overwriting one another's mutation receipt;
  dirty or pending tabs also register a close warning. A browser restart can lose
  the receipt, so POST acknowledgement is never inferred from storage alone and
  every visible success still requires canonical GET readback.
- Production preflight on 2026-08-14 found 666 `listening_exercises` rows, zero
  duplicate identity groups and zero NULL `updated_at` values. Migration 208 uses
  a plain transactional unique index because the migration helper may wrap files
  in a transaction (where `CONCURRENTLY` is invalid) and the measured table is
  small enough for the bounded one-time lock.
- Deployment must apply migration 208 before exposing the new backend/frontend;
  `expected_absent` relies on that unique index as the atomic backstop between its
  preflight read and insert.
- Alignment is preferred when valid, character-proportional estimates are labeled
  as estimates, and every row exposes manual start/end marking plus clip preview.
  Mobile collapses to one column with 44px actions and no horizontal overflow.
- Backend tests cover exact block/version/expected-absent behavior and unconfirmed
  writes, payload preservation, structured uniqueness conflicts, missing/mismatched
  exact identities, order-scoped legacy callers and complete GET shape. Model/source
  tests cover normalization, token-aware alignment mapping, precision-safe time
  formatting, over-limit transcript reporting, receipts, native links and token-only
  CSS. The fixture browser flow covers draft/published/archived blocks, native
  next-order creation, canonical readback, dirty switching, 409 conflict,
  after-commit 503, POST-200/readback-403 reconciliation, storage failure, public
  audio API and responsive containment.

## 2026-08-14 — Native `/admin/listening/gist` rubric authoring

### Root causes and severity

- **Critical — the editor could mutate the wrong Gist block.** Legacy load chose
  the first result and save omitted `exercise_id`, `order_num` and a version token.
  The native route exposes every ordered block and writes one exact identity with
  `expected_updated_at`, or declares `expected_absent` for a new order.
- **Critical — a POST acknowledgement was treated as persisted truth.** The old
  form immediately announced success without reading the exercise back. The new
  editor records the complete intended operation before POST and only reports
  success after canonical GET matches prompt, model answer, keyword order, status
  and block identity.
- **Critical — concurrent work could overwrite a newer rubric.** Existing blocks
  now use atomic optimistic concurrency and lock on 409. Ambiguous writes retain
  a per-admin, per-content session receipt and expose GET-only reconciliation;
  they are never automatically replayed.
- **Medium — keyword overflow was silently discarded.** Backend validation used
  `[:10]`, so an admin could believe all anchors were saved while the final five
  disappeared. The API now rejects more than ten, empty, non-string, oversized or
  case-insensitively duplicated keywords. The chip editor makes the count visible
  and reports rejected additions without changing the accepted list.
- **Medium — the screen hid grading behavior.** Admins saw “AI semantic” but not
  that the non-AI fallback is capped at 60 or that learner success requires 80.
  Those three rules now sit beside the rubric they affect; no fake preview score
  is shown because there is no canonical preview endpoint.
- **Medium — malformed rows could look like an empty block slot.** Complete block
  normalization now fails closed on invalid payloads, versions, statuses or
  duplicate orders so the UI cannot offer a misleading create over unknown data.
- **Low — route documentation named a nonexistent `section_id` contract.** The
  actual editor requires `content_id`; the native ledger, content inventory,
  content detail and rollback link now preserve that exact query identity.

### Design and verification

- The workspace follows source → rubric → fallback anchors. Audio and a collapsed,
  read-only transcript provide context without mixing content metadata writes into
  the exercise mutation. Prompt and ground truth have visible counts and adjacent
  validation; keywords use removable chips rather than an opaque comma string.
- A provenance rail exposes block count, exact exercise ID, order, version, source
  and publication state. Draft, published and archived blocks round-trip without
  coercion; creating the next order is explicit and unsaved switching is confirmed.
- The sticky save boundary states dirty/canonical truth. Leaving, switching,
  creating a block, discarding a receipt and loading after conflict use focused
  dialogs. Mobile collapses the rail and actions to one column with 44px controls,
  visible focus and reduced-motion support.
- Backend tests pin strict length/type/count/deduplication validation. Model/source
  tests pin canonical normalization, exact operations, receipts, route ownership,
  scoring copy and token-only responsive CSS. The fixture browser flow covers
  draft/published/archived blocks, exact update, next-order create, dirty switching,
  409 conflict, after-commit 503, POST-200/readback-403 reconciliation, storage
  failure, canonical success truth and mobile/desktop containment.

## 2026-08-14 — Native `/admin/listening/tf` answer-key authoring

### Root causes and severity

- **Critical — legacy saves could overwrite the wrong ordered block.** Load selected
  the first row while POST omitted exact exercise identity, order and version. The
  native editor lists every canonical block and uses `exercise_id` plus
  `expected_updated_at`, or `expected_absent` for a new order.
- **Critical — acknowledged POST was presented as canonical success.** A durable
  per-admin/content receipt now precedes every write. Success requires a GET that
  matches block identity, status, statement order, text and every T/F/NG answer;
  ambiguous writes are reconciled by GET only and never replayed automatically.
- **Critical — concurrent answer-key changes had no conflict boundary.** A 409 now
  locks editing and preserves the newer canonical version until the admin chooses
  to reload it.
- **Medium — malformed field types were silently coerced.** Backend validation no
  longer turns boolean/string indices, numeric statement text or numeric answers
  into apparently valid data. Statements require contiguous integer indices,
  string text of at most 1000 characters and an explicit T/F/NG value.
- **Medium — the old form did not explain the distinction between F and NG.** Each
  ground-truth option now states whether the audio confirms, contradicts or omits
  the claim, reducing invalid answer keys.
- **Medium — completion semantics were hidden.** The authoring screen states that
  per-question marking is exact, blanks are wrong and backend `is_correct` becomes
  true only at 100% for the block.

### Design and verification

- The workspace follows evidence → statements → publication. Audio and collapsed
  transcript stay read-only; each numbered statement has adjacent validation,
  explicit answer cards, reorder controls and a guarded delete boundary.
- The provenance rail exposes exact block ID, order, version, source and lifecycle.
  Dirty switching, leaving, new-block creation, receipt discard and conflict reload
  use focused dialogs; no native `alert` or `confirm` is used.
- Mobile stacks answer options and actions without horizontal overflow, preserves
  44px controls and visible focus, and honors reduced motion. Legacy HTML remains
  an explicit watchdog/manual rollback.
- Production and staging preflight on 2026-08-14 found zero content/type groups
  with more than one published Gist, T/F or MCQ block. Migration 209 therefore
  adds a partial unique index as the atomic backstop for concurrent publishers;
  the backend maps its `23505` to the same actionable 409 as the preflight guard.
- Backend, model/source and fixture-browser tests pin strict payloads, multi-block
  identity, draft/published/archived round-trip, exact update/create, 409, 503 after
  commit, POST-200/readback-403, storage failure, GET-only reconciliation,
  lowest-order learner fallback, keyboard-focus-stable reorder, add/remove/minimum
  interactions and responsive containment.

## 2026-08-14 — Native `/admin/listening/mcq` answer-key authoring

### Root causes and severity

- **Critical — the legacy editor can mutate the wrong MCQ block.** Its GET takes
  `exercises[0]`, while POST omits `exercise_id`, `order_num` and a version token.
  The native route must list every ordered block and update one exact identity,
  or create the next explicit order with `expected_absent`.
- **Critical — a POST response is treated as saved truth.** The old page shows
  success without reading the canonical row back. The native route must create a
  per-admin/content receipt before POST, require a complete GET match before
  success, and reconcile ambiguous outcomes with GET only.
- **Critical — concurrent answer-key edits can overwrite one another.** Existing
  MCQ saves have no `expected_updated_at`; the native editor must lock on 409 and
  reload the exact conflicted block instead of silently switching to order one.
- **High — question editing loses context and focus.** Selecting a correct radio
  re-renders the entire legacy list, deletion has no confirmation/undo boundary,
  and questions cannot be reordered. Stable row keys, focus-preserving reorder,
  inline validation and a live announcement are required.
- **Medium — backend validation coerces malformed fields.** String or boolean
  indices, numeric stems/options and coercible answer indices can become valid
  persisted answer keys. MCQ writes must require exact JSON types and bounded
  stem/option text while still loading oversized legacy rows for in-place repair.
- **Medium — scoring and publication truth are hidden.** The screen must state
  that one exact option is correct per question, unanswered questions are wrong,
  and backend completion is true only at 100%. Multiple drafts remain valid, but
  migration 209 permits only one learner-reachable published MCQ block.

### Target interaction and verification

- Use the established evidence → questions → publication workspace: canonical
  audio/transcript stay read-only, each question groups its stem and four labeled
  A/B/C/D options, and the right rail exposes exact block ID/order/version/status.
- Support 1–20 questions, stable keyboard reorder, minimum-aware delete, add,
  draft/publish/archive, dirty-switch/leave confirmations, receipt recovery,
  exact-block conflict reload and explicit HTML rollback.
- Pin the pure payload model, strict backend validator, migration-209 publication
  backstop, native route ownership and a fixture-backed production browser flow
  covering 401/409/503/readback failure, focus, add/remove/reorder and responsive
  containment. Run Claude review after the major revamp before publishing the PR.

## 2026-08-14 — Native `/admin/listening/import-fulltest`

### Summary

The legacy importer exposes the right parser and upload progress, but presents a
four-file ingestion job as a collection of drop zones and browser-side mutations.
The native redesign organizes it as pack identity → parser evidence → canonical
readback, so an operator can tell which bytes were reviewed, what will be written
and whether the backend actually persisted or published the test.

### Critical issues

#### Issue: Duplicate replacement crosses multiple browser mutations

**Current State**: “Archive bản cũ & Import” PATCHes every matching active row,
then starts a large upload and restores prior statuses when the commit reports an
error.

**Problem**: A lost upload ACK is not proof that commit failed. Restoring the old
row while the server is still completing can create two active identities or hide
which bundle is canonical.

**Recommendation**: Do not archive inside the upload workflow. A duplicate Test ID
must block commit and hand off to Kho test, where status changes already use a
confirmation plus exact GET readback. The operator then reruns dry-run.

**Impact**: A network failure cannot silently remove the only live paper or cause
the importer to guess persisted truth.

**Implementation Notes**: Keep the existing backend duplicate guard. Remove the
combined action only from the native owner; retain HTML as explicit rollback.

#### Issue: Dry-run is not cryptographically tied to the committed files

**Current State**: The browser retains four mutable slot references, while dry-run
sends only three and commit later reparses all four.

**Problem**: The UI cannot prove that the file set being committed is the set the
operator reviewed, especially after a replacement or Mini/Full mode change.

**Recommendation**: Compute SHA-256 for all four files and include mode in one pack
fingerprint. Invalidate preview whenever a slot or mode changes; allow commit only
while the validated fingerprint remains current.

**Impact**: The visual preview and the commit action refer to the same local bytes.

**Implementation Notes**: Hash locally with Web Crypto; never upload or persist
file contents in localStorage.

#### Issue: Ambiguous POST can be replayed

**Current State**: A network failure returns the page to an enabled import button.

**Problem**: The original request may already have created a draft and uploaded
audio. Repeating it can hit duplicate guards or produce uncertain cleanup work.

**Recommendation**: Persist an account-scoped receipt before POST, including Test
ID, pack fingerprint and exact baseline row IDs. A 5xx/network failure locks new
POSTs; recovery searches by exact Test ID, excludes baseline IDs and reads the one
candidate by UUID. Never replay the upload automatically.

**Impact**: Reloads and transport failures become recoverable without duplicate
writes.

**Implementation Notes**: Treat 4xx as a definitive rejection; keep receipts for
5xx, transport errors, malformed ACKs and failed GET readbacks.

### High-priority improvements

- **Evidence hierarchy**: Show parser errors, warnings, every question/answer and
  contiguous IMG-PROMPT block before the commit control.
- **Publication separation**: Commit creates Draft only. Published requires its own
  focused dialog and exact UUID/status GET readback.
- **Operational truth**: Expose file inventory, limits, Test ID, parser counts,
  upload progress and canonical result in distinct regions instead of one mutable
  banner.

### Medium-priority enhancements

- Route a four-file drop by extension/name while preserving explicit individual
  pickers and per-slot errors.
- Keep template downloads adjacent to the pack inventory.
- Provide a one-click copy action per contiguous IMG-PROMPT block and a direct link
  to the native test workspace after import.

### Positive observations

- Backend commit reparses the authoritative source files and already performs
  fail-loud answer/timing validation.
- The 60 MB cap, real XHR upload progress, automatic admin bearer token and
  Draft-first lifecycle are worth preserving.
- The existing canonical test inventory already supplies the safe duplicate-status
  workflow needed by the redesign.

### Verification

- Model tests pin file routing/limits, SHA-256 descriptor shape, strict dry-run and
  ACK contracts, section/image grouping, baseline reconciliation and account scope.
- Fixture-browser coverage pins happy import/publish, duplicate blocking, 503
  recovery without POST replay, storage failure before POST and mobile containment.
- Full frontend tests, TypeScript, production build and focused backend importer
  tests must pass; Claude review runs after browser verification and before commit.

## 2026-08-14 — Native `/admin/listening/import-drills`

### Summary

The legacy batch table compressed file grouping, parser results and persistence
into one optimistic surface. The native redesign uses four explicit evidence
stages: inventory, dry-run, sequential commit and canonical result. It keeps the
existing backend parser while making every uncertain relationship visible and
non-actionable.

### Critical issues resolved

#### Issue: Loose multi-file selection can associate media with the wrong drill

**Current State**: Directory paths are usable, but a loose selection has no
reliable `audio_output/<TEST_ID>` owner and duplicate slots overwrite silently.

**Problem**: The operator can validate one Source JSON while timings/audio from
another drill are committed.

**Recommendation**: Treat directory paths as canonical. Attach loose accessories
only when exactly one Source JSON exists; surface unassigned and duplicate files
as blocking inventory findings.

**Impact**: No bundle is created by inference when the browser cannot prove file
ownership.

**Implementation Notes**: The pure grouping model returns bundles, unassigned
files, ignored files and global errors separately.

#### Issue: Audio without timings is silently downgraded to metadata-only

**Current State**: The legacy controller simply omits the selected mp3 from the
commit form when `timings.json` is absent.

**Problem**: Admin intent and persisted truth diverge; the visible audio file is
discarded without consent.

**Recommendation**: Block the bundle before dry-run and explain that per-question
replay windows require timings. Metadata-only is valid only when no audio was
selected.

**Impact**: “Audio-ready” and “Metadata-only” become truthful, mutually exclusive
states.

#### Issue: Batch POST results are replayable after transport ambiguity

**Current State**: A network/5xx failure leaves the row available to retry and a
successful ACK is not checked against canonical test detail.

**Problem**: The backend may already have created a draft; a retry can collide or
leave the operator unsure which row is authoritative.

**Recommendation**: Commit selected rows sequentially. Before every POST, save an
account-scoped receipt containing Test ID, SHA-256 fingerprint and baseline IDs.
Keep it for all ambiguous outcomes, stop the whole queue, and reconcile by exact
list/detail GET without replay.

**Impact**: A batch can recover safely after reload, timeout or malformed ACK.

### High-priority improvements implemented

- Duplicate active Test IDs are never selectable and link to the native Kho test.
- Canonical readback requires one exercised section, exact drill metadata and
  top-level `full_audio_*` truth.
- The confirmation dialog reports audio-ready versus metadata-only counts before
  a write begins.
- The table becomes stacked evidence cards on small screens; pickers and CTAs have
  visible focus treatment and 44px touch targets.
- Upload progress uses finite `progressbar` semantics outside a live region.

### Positive observations preserved

- The backend parser remains the canonical validator and commit still reparses
  the uploaded bytes.
- Metadata-only Drafts remain supported for planned audio production.
- The HTML implementation stays reachable as a watchdog/manual rollback target.

### Verification

- Model tests cover deterministic grouping, limits, fingerprints, strict dry-run,
  ACK/detail contracts, baseline reconciliation and account-scoped receipts.
- Fixture-browser coverage exercises audio-ready, metadata-only, duplicate,
  audio-without-timings, sequential success→503 stop, GET-only reconciliation,
  localStorage failure before POST, focus and mobile containment.
- TypeScript, production build, frontend contracts and backend drill importer
  tests run before Claude review and publication.

## 2026-08-14 — Native `/admin/listening/audit`

### Summary

The legacy dashboard visually flattened three different states: a successful
live structural scan, the last persisted structural-plus-LLM audit, and a GET
failure. The native redesign treats them as separate evidence clocks and closes
the complete test inventory before presenting quality coverage.

### Critical issues resolved

#### Issue: Failed per-test reads look like an empty or unknown health pill

**Current State**: Every rejected audit GET is converted to `null`; the row then
shows `?` and `—` beside genuinely unaudited rows.

**Problem**: An outage, permission problem or malformed response can be read as
“nothing to inspect”, and aggregate health has no denominator for failed reads.

**Recommendation**: Give every row a typed `loading`, `ready` or `lookup failed`
state. Exclude lookup failures from clean health, show their count in the summary
and provide a GET-only retry.

**Impact**: Admins cannot confuse missing evidence with passing evidence.

**Implementation Notes**: Response normalization binds UUID, Test ID, lifecycle,
test type, question/section counts, issue counts and saved-audit identity.

#### Issue: A paging guard can silently publish partial coverage

**Current State**: The legacy controller stops after 30 pages, logs a console
warning and renders the partial rows as though the dashboard covered every test.

**Problem**: The screen's operational promise is “all tests”; an omitted older
test may retain broken audio or answer evidence without appearing anywhere.

**Recommendation**: Require a stable canonical total across pages. Reject an
early short page, duplicate UUID, malformed row, changing total or guard overflow
before replacing the last complete snapshot.

**Impact**: The inventory is either demonstrably complete or visibly blocked.

### High-priority improvements implemented

- Live structural health is labelled as current no-LLM evidence; saved full audit
  is labelled as a persisted snapshot from the last explicit full run.
- Search, test type, live health and saved status are encoded in the URL.
- Per-test audit GETs run in bounded batches of eight with a determinate progress
  bar; account/request sequence guards prevent stale responses replacing state.
- Summary cards expose canonical total, tests with errors, warnings and lookup
  failures before the operator opens a detail workspace.
- Desktop rows become labelled cards below 700px, action targets remain at least
  44px and reduced-motion users do not receive progress animation.

### Positive observations preserved

- The backend structural/audio-bounds engine stays the canonical fast scanner.
- The direct HTML audit detail remains an explicit watchdog/manual rollback.
- Direct HTML dashboard remains the watchdog/manual rollback target.

## 2026-08-14 — Admin Listening audit detail native repair workspace

### Root causes closed

- The legacy editor wrote transcript/question payloads without version tokens
  and treated mutation ACK copy as canonical truth. The native workspace sends
  `expected_updated_at` and requires an exact GET readback after every PATCH.
- Its audio fallback selected the first section track for every question. Audio
  now resolves assembled → full → the exact `section_num`; missing section audio
  remains visible and never borrows another section.
- Full audit is a paid, non-idempotent LLM POST but previously had no durable
  ambiguity boundary. An account/test/request-scoped receipt is now written
  before POST; timeout/5xx recovery is GET-only against the exact persisted
  `health.request_id`, so another tab's run cannot close this receipt. A
  confirmation-only discard path prevents an unpersisted 5xx from locking the
  workspace forever and states that a retry can incur another charge.
- Structural and LLM findings were inferred from code names in the browser.
  Backend responses now expose `source`, including deterministic backfill for
  older saved rows, and the UI labels both evidence types explicitly.
- Triage formerly ignored invalid issue indexes and allowed `fixed` while errors
  remained. Backend and UI now reject those states, require
  `expected_updated_at`, and lock preserved inputs when another reviewer changes
  the saved audit.

### Interaction and responsive decisions

- One section is edited at a time through keyboard-accessible tabs; transcript
  and each question pin the version used for the write. An external edit to the
  same canonical fields preserves the local draft but locks Save until the admin
  explicitly reloads; unrelated readbacks preserve triage inputs. Inactive
  section panels remain mounted, so mouse/arrow tab navigation never discards
  transcript or question drafts.
- Question forms include prompt, answer, alternatives, MCQ options, traps,
  solution and optional audio bounds in one repair card. Full/assembled audio
  keeps absolute windows; exact-section fallback subtracts a verified
  `audio_offset`, cross-checks the declared section, and fails closed when the
  timebase is unknown. Malformed option/window rows remain open for repair;
  unreadable list fields must be explicitly re-entered so an unrelated fix
  cannot clear grading data. Clearing both bounds on an existing window emits
  explicit `null` and requires canonical GET confirmation. Non-audio repairs
  on a question that never had a window may leave both bounds empty. Live and saved findings stay
  visually separate instead of being merged into a false current snapshot.
- Invalid or duplicate `q_num` values no longer close the whole workspace. The
  ambiguous cards remain visible but read-only because the positional PATCH
  would be unsafe; valid cards and transcript repair remain available.
- Alternatives and trap mechanisms use newline-delimited fields, while option
  text with embedded newlines round-trips through an escaped JSON string. A
  comma inside a valid answer is never silently split into two grading keys.
- The verification player is fixed but collapses on mobile; all primary controls
  retain 44px touch targets, visible focus, reduced-motion support and no page
  overflow at 390px.

### Verification

- Pure model coverage pins strict identity/count/version contracts, exact section
  audio, option parsing, canonical matchers and durable receipt reconciliation.
- Fixture browser coverage pins transcript/question versioned PATCH + GET,
  ambiguous full-audit recovery without POST replay, triage guards and responsive
  containment. Backend focused coverage pins source provenance and truthful writes.

### Verification

- Pure model tests cover filter URLs, complete inventory pages, exact identity,
  live issue/count consistency, saved evidence and lookup-vs-clean summaries.
- Fixture browser coverage uses 101 tests to prove offset 0/100 pagination,
  bounded per-test reads, hostile-text escaping, lookup failure, URL filters,
  GET-only retry, mobile containment and desktop restoration.
- TypeScript, production build, full frontend contracts and the backend audit
  engine suite run before Claude review and publication.

---

# Course B05 pronunciation and shadowing UI review

> Audit date: 2026-08-19
> Scope: learner flow for 12 fixed B05 sentences, cached reference audio,
> per-sentence recording, one final submission and persisted results.

## Summary

The implemented flow keeps the learner on one sentence at a time while retaining
a visible 12-sentence queue. Reference playback, speed control and recording are
co-located; submission stays disabled until every sentence has a recording and
the active recorder has stopped. Draft audio is isolated by user and bank in
IndexedDB, survives a failed grading request, and is removed after a confirmed
successful result.

## Critical issues resolved

### Issue: Microphone could remain active after navigation

**Current State**: Every back, previous, next and queue-navigation action first
waits for the active `MediaRecorder` to stop and persist its blob.

**Problem**: Re-rendering a different sentence while the old recorder remained
active would hide the real microphone state and could submit an older blob.

**Recommendation**: Preserve the single `stopRecording()` boundary now used by
all navigation paths; do not reintroduce DOM-only state for recording.

**Impact**: The visible sentence, microphone indicator and submitted audio cannot
drift apart.

**Implementation Notes**: Final submission is also disabled while recording,
and component teardown discards an unfinished blob and releases every track.

## High priority improvements implemented

- All recording and navigation targets are at least 44px and have visible
  keyboard focus; the record control expands to full width on small screens.
- The mobile layout becomes one column for playback, recording, queue, score
  metrics and submission rather than forcing horizontal containment.
- The result hierarchy leads with the aggregate score, then accuracy/fluency/
  completeness, then the three weakest sentences and word-level focus.
- Provider names and infrastructure limits are absent from learner-facing copy;
  errors explain the next action and explicitly state that recordings remain.
- Reduced-motion mode removes progress animation while retaining state changes.

## Positive observations to preserve

- `0.85×` is the default shadowing speed and `1×` remains one tap away.
- The full authored sentence is always visible in the active card; the compact
  queue supports orientation without duplicating twelve large cards.
- A grading retry reuses one stable client ID, and concurrent retries cannot
  produce duplicate paid grading calls.
- Reference audio is cached course content; learner recordings are not uploaded
  to permanent storage and only normalized feedback is returned to the browser.

## Verification

- Node tests cover practice, navigation, persisted failure and result states.
- Backend tests cover the 12-sentence contract, 3-sentence/28-second batching,
  omissions, invalid audio and retry concurrency.
- Full TypeScript, OpenAPI drift generation and 640px responsive CSS rules are
  checked before publication; a signed-in device pass remains the deployment
  check for real microphone permission and Safari `audio/mp4` capture.

---

# Whole-web UI/UX completion audit — learner + admin

> Audit date: 2026-08-20
> Scope: revalidation and remediation closure for the two whole-web passes:
> admin operations surfaces and learner-visible pages/flows.

## Summary

The high-impact findings were contract and state-truth problems rather than a
missing visual system. The remediation preserves Aver's shared semantic tokens,
the Grammar editorial subsystem and the Reading exam subsystem while fixing
session truth, resume behavior, navigation dead ends, loading/error states,
catalog density and responsive interaction targets.

## Critical issues resolved

### Issue: Course revision could be lost or rebuilt as a different test

**Current State**: An unledgered revision is returned by the canonical resume
endpoint. Its server session ID deterministically seeds both question selection
and option order, including across devices. A completed revision whose verdict
request failed restores the result and retries only the verdict.

**Problem**: Revision state was treated as ephemeral; reload or network failure
could replace the 20-question sample, lose progress or finalize a session twice.

**Recommendation**: Keep the session/ledger boundary in
`backend/services/quiz_service.py` and deterministic reconstruction in
`frontend/public/js/course-runner.js`; do not move canonical progress to local
storage.

**Impact**: Learners resume the same revision and a verdict retry cannot create
or patch a second attempt.

**Implementation Notes**: No migration was required. Recorded ledger session
IDs exclude completed revisions from future resume responses.

## High priority improvements resolved

- Dashboard and progress totals count completed sessions only; recently opened
  but abandoned rows no longer masquerade as completed practice.
- Speaking history distinguishes read failure from a genuinely empty history.
- Writing deadlines exclude overdue work; MY CLASS keeps expired work closed
  and explains that the learner must contact the instructor to reopen it.
- Reading Vocab, Reading Skill and Listening Browse use 24-row server
  pagination. Load-more failures retain prior cards and retry the same page.
- Vocabulary Practice renders canonical per-bank progress as independent
  enrichment. Malformed numeric values normalize to zero instead of `NaN`.
- Admin Writing links use native canonical routes. Listening chrome no longer
  exposes contextless authoring editors that require `content_id`; independent
  import, inventory, attempts, report and audit destinations remain visible.
- Speaking's topic picker is initially absent from the accessibility tree and
  has dialog semantics, Escape close, Tab containment and focus restoration.
- React-owned Speaking selects use `defaultValue` rather than `selected` on
  child options, removing the runtime warning without changing DOM behavior.
- Learner load failures no longer display raw transport messages such as
  `Failed to fetch`; actionable backend-owned 4xx explanations remain visible.
- A revision left open in an older tab is discarded once a newer revision
  verdict has entered the mastery ledger. Only an unledgered revision created
  after the latest canonical verdict can be resumed.

## Design-system boundary and preserved exceptions

- Shared semantic `--av-*` foundations remain canonical; meaningful KPI labels
  were promoted from faint to muted without globally weakening the faint token.
- Grammar's editorial typography and Reading's exam-paper chrome are intentional
  product modes, not inconsistencies to normalize.
- Listening rows with an explicit empty `available_modes` list truthfully show
  that no exercise mode exists; `null` remains a separate lookup-failure state.
- Horizontally scrollable mobile top navigation is contained inside the chrome;
  the document itself has no horizontal overflow. This is not treated as a page
  layout failure.
- Mini tests may validly have a configured 60-minute duration. Copy describes
  one-passage/configured-duration practice rather than inventing a duration cap.
- User-name differences require canonical account/data verification and are not
  patched in presentation code. Gate E/F and migration state are operational,
  not UI findings.

## Verification

- Full frontend contract suite passed before the final completion guards and
  again after them (exit 0); the final focused frontend gate passed 115 tests.
- Current backend resume/quiz/dashboard regression: 83 passed. The earlier
  broader backend run passed 112 with 1 skipped.
- Production build compiled TypeScript and generated all 132 routes.
- Public Grammar browser checks at 1440×900 and 390×844 found no document
  overflow; disclosure controls measure 44px.
- Authenticated read-only browser check covered nine learner routes against
  staging truth. A fixture render then covered populated learner/admin states at
  1440×900 and 390×844: no page errors, no document overflow and no visible
  button/input/select/textarea target below 24px.
- Populated pagination checks moved Listening, Reading Vocab and Reading Skill
  from 24 to 25 unique cards on both viewports. MY CLASS exposed the overdue
  next-step copy; Vocabulary rejected malformed progress without `NaN`.
- Admin shadow-DOM navigation exposed only canonical native Writing links and
  context-valid Listening destinations at both viewports.
- Claude Sonnet reviewed the production diff independently in read-only mode.
  One valid concurrent-tab retake finding was fixed and covered by regression
  tests. The reported account-pagination bleed was rejected because all three
  libraries remount on `key={accountKey || status}`; the remaining total-count,
  completed-status and retake-number notes were rejected against canonical
  backend and runner contracts.

## Design system packet

- **Scope**: learner app shell, public editorial content and admin operations.
- **Primary mode**: cross-surface alignment; shared foundations with distinct
  learning modes.
- **Foundations**: semantic tokens, Plus Jakarta Sans for product UI, 4px spacing
  scale, visible focus, reduced-motion baseline and responsive containment.
- **Primitive policy**: keep `av-*` learner primitives and `adm-*` admin
  primitives shared; course player, exam chrome and authoring tools stay local.
- **Promotion threshold**: only promote a local pattern after reuse on at least
  two surfaces and light/dark plus responsive evidence.
- **Open decision**: none required for this remediation batch.

This packet defines shared UI governance; page-level responsive and accessibility
remediation remains owned by each affected workflow and its regression tests.

---

# Reading and Listening full-test fidelity audit

> Audit date: 2026-08-21
> Scope: native Next Reading `/reading/exam/session` and Listening
> `/listening/test/session`, their stylesheet cascades, canonical attempt/save/
> submit contracts, the internal interactive-HTML standard, and current official
> IELTS on-computer sample/familiarisation surfaces.

## Validated findings and remediation

### High — the Listening full test looked and behaved like a learner dashboard

- **Root cause:** `ListeningTestSession()` mounted the global `aver-chrome`, a
  sticky media-player card with elapsed/total progress, a wide card-like paper,
  and a flat 40-question grid. The same audio controls served both practice and
  full-test modes even though their learning contracts are intentionally
  different.
- **Impact:** the visible hierarchy trained the learner to look for a media
  scrubber and product navigation rather than the recording status, current
  part, question paper and exam navigator used during a computer-delivered test.
- **Impacted files/functions:**
  `frontend/app/(authed-listening-player)/listening/test/session/listening-test-session.tsx`
  (`ListeningTestSession`, `startAudio`) and
  `frontend/public/css/listening-test-next.css`.
- **Minimal fix applied:** neutral exam top bar; explicit headphone/Play gate;
  one-shot full-test audio status with no seek timeline; practice-only pause and
  seek controls; flat institutional question canvas; bottom palette grouped by
  Part with current, answered, review and save states.
- **Verification:** source-contract tests pin the practice/full-test split and
  one-shot latch; keyboard and pointer navigation are checked at desktop and
  narrow widths; answer autosave and submit continue to use the canonical APIs.

### Medium — choice and matching tasks were flattened into generic controls

- **Root cause:** the React ports preserved data and scoring contracts but used
  a shared `<select>` fallback for Reading T/F/NG, Y/N/NG and Matching Features,
  and Listening matching. This discarded the comparison model of each task.
- **Impact:** learners could not scan all choices at once; matching features did
  not resemble the row-by-option matrix used by the official computer sample;
  claim-evaluation tasks felt like completion gaps.
- **Impacted files/functions:**
  `reading-exam-session.tsx` (`QuestionControl`, `QuestionRun`,
  `MatchingMatrixRun`) and `listening-test-session.tsx` (`Exercise`,
  `MatchingMatrixTemplate`).
- **Minimal fix applied:** vertical radios for T/F/NG and Y/N/NG; radios for
  single-choice and checkboxes for multiple-choice; matrix renderers for feature
  matching; option-bank plus constrained select retained for heading/endings,
  map and plan-label tasks; authored inline form/table/note/summary templates
  remain structurally distinct.
- **Verification:** renderer source tests cover each dispatch branch; typecheck
  rejects prop/answer-shape drift; desktop and mobile QA checks matrix overflow.

### Medium — Reading lacked complete computer-test navigation affordances

- **Root cause:** the native player had the split-view CSS foundation, but its
  divider was inert and the palette did not expose a current question or grouped
  Part model. The React route also omitted the selection highlight affordance
  present in the official familiarisation UI.
- **Impact:** pane balance could not be adjusted, Previous/Next acted at the
  wrong information level, and learners had weaker position/review awareness.
- **Impacted files/functions:**
  `frontend/app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx`
  (`ReadingExamSession`, `QuestionCard`, `QuestionRun`) and
  `frontend/public/css/reading-exam-next.css`.
- **Minimal fix applied:** pointer- and keyboard-operable 30–70% divider;
  current-question tracking; grouped Part palette; Previous/Next by question;
  local Review markers; selection toolbar using the browser Highlight API;
  display Options and Help without changing answer state.
- **Verification:** divider exposes separator ARIA range state and Arrow/Home/
  End keys; question palette states and radio/matrix branches are source-tested;
  independent pane scrolling is visually checked at 1280×720.

### Low — inherited “paper” typography misrepresented the current exam mode

- **Root cause:** `ielts-test-paper.css` intentionally used Georgia and rounded
  paper cards from an earlier Cambridge-book metaphor.
- **Impact:** the test looked like a printable worksheet instead of a modern
  institutional computer test and reduced visual continuity between Reading and
  Listening.
- **Impacted file:** `frontend/public/css/listening-test-next.css` (final cascade
  override; the legacy shared stylesheet remains intact for legacy dependants).
- **Minimal fix applied:** system sans typography, neutral gray/white surfaces,
  square controls, restrained accent use and a full-viewport test canvas.
- **Verification:** computed typography, surface, focus and containment are
  checked in the native Next route; no broad change is made to legacy pages.

## Preserved canonical behavior and boundaries

- Attempt ownership, renderer affinity, resume offsets, class sitting hooks,
  debounced autosave, unload flush, failed-save retry, sealed mock flow and
  server submit/grading contracts are unchanged.
- The redesign is a faithful training simulation, not a copied IELTS product:
  it keeps Aver Learning identification and does not reproduce protected IELTS
  logos or claim official affiliation.
- Desktop is the fidelity target. Small screens use a deliberate training
  fallback (stacked content and horizontally contained matrices/palettes) rather
  than squeezing a desktop examination layout into an unusable viewport.
- Highlighting is local to the active rendered attempt and is not part of the
  canonical answer contract. Persisted notes would require a separate approved
  data contract and are not invented as optimistic client state.

---

# Reading and Listening result + review continuity audit

> Audit date: 2026-08-21
> Scope: submitted full-test result states and native Reading/Listening review
> workspaces on desktop and narrow training viewports.

## Validated findings and remediation

### High — completion screens exposed answer-key detail without a learning hierarchy

- **Root cause:** both native players rendered every `per_question` row directly
  after submit; Listening also printed `user_answer → expected` before the
  learner entered the review workspace. Score, section signal and next action
  competed with a long technical answer dump.
- **Impact:** a 40-row table pushed the primary review action below the fold and
  encouraged answer scanning instead of evidence-led correction. Reading and
  Listening also ended the same exam journey with unrelated visual structures.
- **Impacted files/functions:**
  `frontend/app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx`
  (`ResultView`),
  `frontend/app/(authed-listening-player)/listening/test/session/listening-test-session.tsx`
  (`ResultView`), both player layouts, and
  `frontend/public/css/exam-result-next.css`.
- **Minimal fix applied:** one shared completion hierarchy with submitted state,
  estimated band, canonical raw score, answered count, correction count,
  Listening Part breakdown and a compact right/wrong/blank question map. Full
  expected answers remain in the server-gated review route. Primary CTA enters
  review; dictation/library remain secondary.
- **Verification:** native controller tests require the shared result layer and
  reject reintroduction of the old expected-answer row; result fixtures are
  checked for 40-question containment at desktop and mobile.

### Medium — Reading review did not prioritize incorrect answers

- **Root cause:** the workspace opened the first canonical item and always
  rendered every question in the active passage, although the bottom palette
  already knew each verdict.
- **Impact:** learners with a small error set had to scan all forty questions;
  the review flow did not state whether to locate evidence before revealing the
  explanation.
- **Impacted files/functions:**
  `frontend/app/(reading-review)/reading/review/reading-review-workspace.tsx`
  (`ReadingReviewWorkspace`, `selectQuestion`) and
  `frontend/public/css/reading-review-next.css`.
- **Minimal fix applied:** start on the first incorrect item when one exists;
  add incorrect/all/correct filters; preserve palette access by automatically
  revealing a filtered-out target; add an explicit evidence → answer → trap
  sequence and an honest empty-filter state.
- **Verification:** source-contract tests pin the default and palette reveal
  behavior; the passage locate, translation, distractor, micro-check and
  feedback contracts remain covered by their existing tests.

### Medium — Listening review had strong tools but weak process orientation

- **Root cause:** audio seek, transcript highlight and solution accordions were
  individually present, but the header did not tell learners how to combine
  them. Score was compressed into one unstructured text string.
- **Impact:** learners could open the explanation before listening again and
  miss the core Listening correction loop.
- **Impacted files/functions:**
  `frontend/app/(authed-listening-review)/listening/review/listening-review-workspace.tsx`
  and `frontend/public/css/listening-review-next.css`.
- **Minimal fix applied:** explicit listen → transcript → paraphrase sequence,
  separate band/raw-score pills, while retaining wrong-first filtering, exact
  audio-window seek, transcript anchors, skills and authored explanation blocks.
- **Verification:** contract tests keep real audio-window seek and transcript
  anchors server-owned; the new process cues are pinned in the native review
  suite.

## Preserved contracts and constraints

- Server result, band, section breakdown and per-question verdicts remain the
  canonical source. The UI only derives display counts from that submitted
  payload and never updates persistence.
- Review ownership, anonymous Reading capability, submitted/approved gates,
  admin preview neutrality, feedback widgets, knowledge links and audio timing
  are unchanged.
- Result screens intentionally do not reveal expected answers; they summarize
  performance and route the learner into the protected pedagogical workspace.
- Reading and Listening retain task-specific review tools: passage evidence and
  distractor analysis for Reading; exact audio windows, transcript and
  paraphrase analysis for Listening.

## Verification

- Focused native controller/review regression: 68 tests passed.
- TypeScript check passed and the production build generated all 132 routes.
- Four populated result/review browser fixtures passed at 1280×720 and
  390×844. Each asserted `scrollWidth <= clientWidth`; visual QA found and fixed
  an intrinsic-width overflow in the Listening review grid before sign-off.
- Demo screenshots use canonical-shaped 40-question submitted payloads and keep
  developer overlays out of the learner-facing evidence.

---

## Admin Mock Test operations wave — 2026-08-21

### Validated audit findings

#### Fragmented workflow language and hierarchy

- **Root cause:** `/admin/mock-tests`, `/admin/mock-exams`, `/admin/mock-live`
  and `/admin/mock-reviews` exposed the same lifecycle as separate tools with
  different headings, English/Vietnamese status labels and no persistent model
  of the next operational step.
- **Severity:** Medium.
- **Impact:** admins had to remember whether publish, open, collect, claim,
  final-band and release belonged to the current screen; this increased the
  risk of acting on the wrong exam or mistaking “claim” for learner submission.
- **Impacted files/functions:** `admin-mock-tests.tsx` (`TABS`, cockpit shell),
  `admin-mock-exams.tsx` (inventory actions), `admin-mock-live.tsx` (command
  room), `admin-mock-reviews.tsx` (review roster and release workspace).
- **Minimal fix applied:** introduce one route-local operations language and a
  six-stage workflow: Soạn đề → Giao đề → Phòng live → Thu bài → Chấm nháp →
  Trả kết quả. Backend statuses and mutation contracts remain unchanged.
- **Verification:** source/model tests, TypeScript build, and populated desktop
  plus mobile visual checks across all four routes.

#### Flat exam creation form hid sequencing and review context

- **Root cause:** eleven fields were presented in one four-column grid with the
  submit action detached from the consequences of creating a draft.
- **Severity:** Medium.
- **Impact:** weak scan order, easy content/duration omission and unclear
  difference between saving a draft, publishing and assigning a test.
- **Impacted file/function:** `exam-create-form.tsx` (`ExamCreateForm`).
- **Minimal fix applied:** group fields into identity/audience, published exam
  content and timing/review fieldsets; add a sticky draft summary and explicit
  next-step copy without changing `buildExamCreatePayload()`.
- **Verification:** create-payload contract tests; keyboard and responsive form
  pass; confirm sequential mode still requires a cohort and retake does not.

#### Live-room command priority competed with monitoring data

- **Root cause:** exam identity, timer, destructive/open controls and phase
  actions shared one visual level; the roster did not expose the active paper
  sequence above the command area.
- **Severity:** Critical for operational UX; no backend correctness defect was
  found.
- **Impact:** during a timed session an operator could take longer to identify
  whether the room was collecting, paused or safe to advance.
- **Impacted file/function:** `admin-mock-live.tsx` (`AdminMockLive`).
- **Minimal fix applied:** add a section phase rail, isolate the priority queue,
  preserve the existing `collectionSweepCompletedSection` gate and keep table
  identity/header visible while scanning horizontally.
- **Verification:** live model/source guard tests must continue to prove that
  Advance remains disabled until final-save collection is canonical.

#### Review queue mixed selection, AI draft grading and release actions

- **Root cause:** a single bulk toolbar placed selection metadata, Writing tier,
  claim, final-band and irreversible release controls in one undifferentiated
  row.
- **Severity:** Medium.
- **Impact:** eligibility counts were hard to associate with their action and
  the difference between “receive for grading” and “return to learner” was weak.
- **Impacted file/function:** `admin-mock-reviews.tsx` (`AdminMockReviews`).
- **Minimal fix applied:** expose queue-stage counts; group selection, Writing
  draft grading and canonical bulk actions; rename display copy to “Nhận bài”
  and “Trả kết quả” while preserving claim/release endpoints and reconciliation.
- **Verification:** review behavior/model tests; bulk partial-refusal test; full
  reload must match immediate post-action status.

### Design-system packet for this wave

- **Scope:** admin Mock Test cockpit, exam definition/assignment, live room,
  pacing evidence and review/release workspace.
- **Primary mode:** cross-surface alignment, not a global token rewrite.
- **Foundations:** existing semantic `--av-*` tokens, operational low-elevation
  surfaces, mono only for IDs/timers/counts, 44px critical controls, sticky data
  context, visible focus and reduced-motion support.
- **Primitive policy:** shared lifecycle primitives use `aop-*`; route contracts
  and domain layouts retain `mts-*`, `mex-*`, `mlv-*`, `mpn-*` and `mrr-*`.
- **Surface guidance:** one dominant next action per state; destructive actions
  remain isolated; canonical snapshot warnings stay visible and never collapse
  into empty states.
- **Accessibility:** semantic nav/section labels, horizontally contained dense
  tables, visible focus, 44px actions and mobile workflow scrolling.
- **Route-outs:** backend/API/schema changes, grading policy and exact-thinking-
  time inference are out of scope. Pacing timestamps remain last-save evidence.
- **Open decisions:** none; all labels map onto existing canonical operations.
# Admin assignment surfaces — light/dark and workflow closure

> Audit closure: 2026-08-21
> Scope: Admin Students, Class Homework, Writing Prompts, Writing Assignments,
> plus shared class and My Class readability styles.

## Validated root causes and fixes

- Writing assignment and prompt states used fixed teal palette values. Those
  values had 1.02–1.15:1 contrast on dark surfaces. Operational states now use
  semantic theme roles (`--av-primary`, `--av-primary-soft`,
  `--av-primary-border`, `--av-text-on-primary`).
- Meaningful 10–12px metadata used the decorative muted text role. The affected
  labels now use `--av-text-secondary`, which measures at least 4.5:1 against
  the light page and card surfaces. Muted colour remains only on decorative
  arrows and rhythm cells.
- Students, class homework and prompt inventory had no direct path to the
  Writing assignment ledger. Each now links to one assignment URL contract
  with a student, cohort or prompt prefill. The destination validates every ID
  against its canonical picker snapshot or exact detail endpoint before
  selecting it, including entities outside list caps and archived classes, and
  rejects an ambiguous student-plus-cohort target.
- The native student and class ledgers remain separate: “Gửi bài chấm” still
  submits on behalf of a learner, while “Giao bài Writing” creates a Writing
  assignment. Writing is not inserted into the class-homework backend contract.
- Student and class tables no longer depend on a 980–1080px minimum width on
  phones. They become labelled cards so identity, class/account/goal, due date,
  progress and actions remain visible without horizontal page overflow.
- Mixed English/internal terms in the primary prompt and assignment workflow
  were replaced with learner-facing Vietnamese labels where they affected task
  comprehension; persisted API field names and backend contracts are unchanged.

## False positives explicitly rejected

- Theme initialization was not broken; the fault was page-local fixed palette
  usage, so the shared token values were not globally changed.
- The learner Writing dashboard remains the canonical Writing inbox. My Class
  does not need to duplicate the Writing assignment ledger.
- A four-request peak in the prompt browser fixture occurs only under React dev
  effect replay. The same production build fixture peaks at two parallel reads,
  one per lifecycle, while stale-response guards remain active.
- Decorative muted glyphs are not treated as readable copy and are intentionally
  excluded from the AA text assertion.

## Verification

- Theme and responsive contracts cover fixed-palette exclusion, semantic state
  roles, measured light-theme AA contrast, labelled mobile cards and phone-width
  prompt actions.
- Deep-link tests cover exact student/cohort/prompt serialization, ambiguous
  target rejection, canonical option validation and preservation of the two
  distinct admin Writing actions.
- Fixture browser flows cover canonical readback, idempotent assignment retry,
  prompt lifecycle writes, hostile-text escaping, mobile containment and the
  separate class/student ledgers. The prompt concurrency assertion is run on the
  production build to avoid React development replay noise.
- A successful Next production build is required to close TypeScript and route
  integration for all touched surfaces.

---

 # Multi-class membership UX — 2026-08-21

## Summary

The admin and learner class surfaces now treat class membership as additive.
One learner can remain active in two classes, receive each class's assignments,
and see the source class beside every task and lesson.

## Critical issues resolved

### Issue: “Add to class” silently moved a learner

**Current State**: Single and bulk admin actions now write an active membership
and explicitly say that existing classes are preserved.

**Problem**: The previous label suggested addition while the backend overwrote
`students.cohort_id`, hiding the old class's work.

**Recommendation**: Keep “Thêm vào lớp” additive. If transfer is introduced,
ship it as a separate destructive action with a confirmation listing every
membership that will end.

**Impact**: Admin intent and persisted roster truth stay aligned after reload.

**Implementation Notes**: Student rows render class chips; the class picker
disables only a membership that already exists in the current class.

### Issue: Learner work from different classes was indistinguishable

**Current State**: My Class exposes `Tất cả` plus one 44px class control per
active membership. Tasks and lessons carry their class name, and the home card
summarizes the number of active classes.

**Problem**: A flat unlabelled list makes deadlines and lesson notes ambiguous.

**Recommendation**: Preserve the aggregate view for cross-class prioritization
and class filters for focused work; never remove source labels from the
aggregate view.

**Impact**: Learners can act on the nearest deadline without losing class
context and can isolate one timetable when needed.

**Implementation Notes**: The class switcher scrolls horizontally on narrow
screens, uses `aria-pressed`, visible focus and semantic buttons. The backend
remains the source of deadline and membership truth.

## Verification

- Add a learner to class B while they remain in A; compare immediate admin
  state with a full reload on both class rosters and the student directory.
- Give one task from each class; confirm `Tất cả`, A and B show the correct
  counts, task labels, lesson labels and nearest deadline.
- Remove only A; confirm B remains visible and an A assignment can no longer be
  opened while historical A submission evidence remains intact.
 - Keyboard through the class switcher and verify 375px horizontal containment.

---

# Admin course-Grammar result and inspection content audit — 2026-08-22

> Validated against the production C1 “GRAMMAR 01” assignment on both the
> legacy class workspace and the native Next.js class workspace. This is an
> information/content audit only; no grading or submission behaviour changed.

## Critical issues

### Issue: completed failed attempts are presented as “not submitted”

- **Root cause:** course completion only stamps `submitted_at` after the learner
  passes, while the generic tally derives hand-in state exclusively from
  `submitted_at`. A completed failed run is therefore labelled `pending` or
  `missing`, even when it has a canonical score and next action.
- **Severity:** Critical.
- **Observed impact:** four C1 learners with completed 47–70% results appeared
  as “chưa nộp”; the 5/13 headline was effectively a pass count labelled as a
  submission count. Admin outreach can target the wrong learners for the wrong
  reason.
- **Impacted files:** `backend/services/quiz_service.py`
  (`refresh_course_completion()`),
  `backend/routers/admin_class_assignments.py` (`_hand_in_status()`,
  `assignment_tally()`), `frontend/public/js/admin-classes.js` (`tallyRow()`),
  and `frontend/app/(authed-admin-classes)/admin/classes/[cohortId]/admin-class-submissions.tsx`.
- **Suggested minimal fix:** keep the immutable mastery ledger as truth and add
  an explicit course learning state to each tally row. For course assignments,
  replace “Ai nộp” with an outcome summary: Đã đạt, Gần đạt / Revision, Cần làm
  lại toàn bài, Thiếu phần, Đang làm, Chưa mở. Keep deadline/hand-in state as a
  separate operational field instead of using it as the learning verdict.
- **Verification:** fixture one learner in each outcome and deadline state;
  assert the API, immediate UI, and full reload agree, and a completed failed
  attempt is never described as “chưa nộp”.

### Issue: the completion denominator is derived from existing evidence

- **Root cause:** `course_attempt_report()` sets `sections_total` to
  `len(latest_attempt.sections)`. Missing required sections are absent from that
  object, so the denominator shrinks to the work already present.
- **Severity:** Critical.
- **Observed impact:** a learner was labelled “Còn phần chưa xong” and “1/1
  phần” on the same row. The admin still cannot see which required section is
  missing.
- **Impacted files:** `backend/services/quiz_service.py`
  (`course_attempt_report()`), both class submission renderers, and their
  report/model tests.
- **Suggested minimal fix:** derive `sections_total` from the assignment's
  canonical required-section snapshot, count only completed required sections,
  and return `missing_sections[{key,label}]`.
- **Verification:** cover quiz-only, writing-only and every multi-section
  permutation; a quiz-complete/writing-missing attempt must say “1/2 · thiếu Tự
  luận”, never “1/1”.

## High-priority improvements

### Issue: the individual report mixes different scoring scopes without labels

- **Root cause:** `course_answer_report()` builds question groups and top stats
  from the earliest response ever recorded for each question, while the history
  uses the latest canonical mastery attempts and the combined weighted result.
- **Severity:** Medium.
- **Observed impact:** the C1 report showed 44/90 in the hero beside a latest
  53.4% result; a passed learner showed 76/90 quiz answers beside 77.2% overall.
  Both values can be valid, but the UI makes them look like the same metric.
- **Impacted files:** `backend/services/quiz_service.py`
  (`course_answer_report()`), `frontend/public/js/course-report.js`
  (`renderReport()`), and the native `Report` component.
- **Suggested minimal fix:** expose labelled `baseline_quiz`,
  `latest_attempt`, `section_results`, `history` and `delta`. Lead with “Điểm
  tổng gần nhất” and next action; label the diagnostic as “Trắc nghiệm lượt
  đầu”. Add an attempt selector for per-question inspection, defaulting to the
  latest completed full run.
- **Verification:** use one multi-attempt learner and one weighted multi-section
  learner; every displayed value must name its attempt, section and scoring
  scope, and the latest value must match the canonical ledger.

### Issue: the legacy history renderer invents a result for an incomplete run

- **Root cause:** `renderAttemptHistory()` appends `%` to a null percentage and
  maps an absent `next_action` to “Đã ghi nhận”. The backend correctly returns
  `completed: false`; the legacy renderer ignores it.
- **Severity:** Medium.
- **Observed impact:** production displayed “Kết quả % · Đã ghi nhận · —” for
  an in-progress learner. The Next.js renderer already avoids this error.
- **Impacted files:** `frontend/public/js/course-report.js`
  (`renderAttemptHistory()`), `frontend/tests/course-report.test.mjs`.
- **Suggested minimal fix:** port the native semantics: show “Đang hoàn thành”,
  “Làm nốt các phần”, existing section scores and the missing-section label;
  never render a percent suffix for `null`.
- **Verification:** add an incomplete-history fixture with `pct: null`, no
  timestamp and one missing section; assert that no bare `%`, false completion
  copy or invented timestamp appears.

### Issue: class difficulty ranking has no denominator or affected-learner count

- **Root cause:** class axes expose only raw wrong count and median seconds,
  aggregated from first responses. They omit attempts, error rate, affected
  students, eligible students and the aggregation scope.
- **Severity:** Medium.
- **Observed impact:** “23 sai” can mean a broadly misunderstood concept or
  simply an axis with more questions. Admin cannot separate teaching need from
  a potentially flawed question.
- **Impacted files:** `backend/services/quiz_service.py`
  (`course_attempt_report()` axes aggregation), both class effort renderers.
- **Suggested minimal fix:** return and display `affected_students / eligible`,
  `wrong / attempted`, error rate, median time, sample size and scope. Rank by
  affected-learner rate with a minimum sample; surface a neutral “Kiểm tra chất
  lượng câu hỏi” flag when a high error rate is broad and concentrated.
- **Verification:** compare axes with different question counts and sparse
  samples; rankings must not be driven by raw exposure alone.

### Issue: course Grammar has no actionable admin flag contract

- **Root cause:** tally flags are currently computed only for Speaking. Grammar
  has enough canonical evidence to detect intervention and data-quality needs,
  but none is transformed into an admin action queue.
- **Severity:** Medium.
- **Impacted files:** `backend/routers/admin_class_assignments.py`
  (`assignment_tally()`), course report services, both admin renderers.
- **Suggested minimal fix:** produce server-side course flags with evidence and
  a concrete action: near pass (revision eligible), repeated full failure,
  stalled over 24h, no improvement across completed attempts, persistent
  misconception, missing required section, deadline risk, suspicious timing
  for review, and data/system mismatch. Use non-accusatory language and never
  infer cheating from timing alone.
- **Verification:** one fixture per flag plus negative boundary fixtures (for
  example 64.9%, 65%, 74.9%, 75% when the pass threshold is 75%); every flag
  states what happened, why it matters and what the admin can inspect.

## Proposed information architecture

1. **Tổng kết / Cần xử lý:** outcome funnel, due-state context and a prioritized
   queue of evidence-backed flags. Primary CTA: “Inspect”.
2. **Tiến độ lớp:** learner rows with latest overall score, threshold, required
   sections, attempt trend and contextualised time (`5 lượt · 386 phút tổng ·
   77 phút/lượt`; idle remains explicitly approximate).
3. **Inspect học viên:** decision card first (current outcome, score versus
   threshold, next required action), weighted section cards, attempt trend,
   top three persistent misconceptions, then detailed questions. Default the
   question list to wrong answers; keep “Tất cả câu” and an attempt selector.
4. **Inspect câu:** preserve the existing prompt, learner answer, correct answer,
   misconception-specific `why_wrong`, explanation and response time. Keep the
   writing submission in the same learner view rather than making admin switch
   to a disconnected report.

## Positive observations to preserve

- Canonical mastery history, section weights and per-question explanations are
  already available and substantially more useful than a score-only report.
- Stale/partial reads are visible instead of silently rendered as empty data.
- The effort report already distinguishes untouched, doing, stalled,
  incomplete-section, retry and passed states and sorts actionable states first.
- The native Next.js history renderer correctly handles incomplete runs and is
  the best semantic baseline for legacy parity.

## Implementation record — first remediation wave

- Added a canonical read-only course summary so learning outcome no longer
  inherits the generic `submitted_at` label. The admin funnel now separates
  passed, near-pass Revision, full retry, in-progress, untouched and
  unactivated learners.
- Required-section progress now uses the assignment snapshot, returns explicit
  missing-section labels and refuses to count a partial section as complete.
- Near-pass and full-retry remain explicit outcomes but no longer become admin
  flags on a learner's first unsuccessful run. The action queue is reserved for
  repeated failure, missing sections in an active attempt, stalled work and
  ledger/data mismatch, so routine learning states do not bury real intervention.
- Individual reports now label baseline quiz evidence separately from the
  latest weighted course result, lead with the current decision and section
  scores, and default detailed inspection to wrong answers with progressive
  disclosure.
- Class misconceptions now include affected learners, learner sample, wrong
  attempts, error rate, median response time and an explicit first-attempt
  scope. Axes with no errors are not presented as class problems; samples below
  three learners rank after reliable samples and are labelled “Mẫu nhỏ · chỉ
  tham khảo” instead of being presented as a class-wide conclusion.
- Legacy assignments without a required-section snapshot now resolve their bank
  shape once and share that denominator across tally and effort reports. A
  malformed learner ledger marks only that row and the report as stale rather
  than returning a class-wide 500 in either tally or effort. If the assignment
  shape itself cannot be read, both admin surfaces say the required-section
  denominator is unknown instead of presenting zero as a real denominator.
- Writing-only course reports now build the canonical mastery decision before
  the quiz-session path, preserving result/history even when no quiz session can
  exist.
- The legacy surface received the same semantic corrections for course outcome,
  incomplete history, required sections and misconception denominators; the
  native Next.js surface owns the richer action queue and inspection layout.

## Release verification

- Backend contract tests for course outcome, required sections, score scopes,
  flag boundaries and stale reads.
- Renderer tests for null values, incomplete attempts, labels and progressive
  disclosure in both legacy and Next.js paths.
- Signed-in production-like fixture covering passed, near-pass, full retry,
  missing section, stalled and untouched learners; compare immediate and
  full-reload state.
- Light/dark visual QA at 1280px, 768px and 375px; keyboard through filters,
  attempt selector, accordion and Inspect actions.

---

# Mock Exam resilience and live-operations audit — 2026-08-22

## Summary

The sequential Listening → Reading → Writing journey and the admin live room
were audited as one distributed workflow: canonical paper readiness, shared
clock admission, embedded-player flush, answer autosave, Writing local backup,
audio recovery, collection ACKs, and stale live snapshots. The remediation is
fail-closed where an irreversible exam action depends on fresh server truth,
but keeps the learner in the current attempt while recoverable network or media
failures are retried.

## Critical issues

### Issue: an unservable paper could start the shared section clock

**Root cause:** published status and the admin content picker were treated as
sufficient readiness evidence. Opening or advancing an exam did not re-check
that referenced Listening/Reading rows still existed and were published, that
Listening had a storage path and positive duration, or that configured Writing
prompts still matched their task slot. The service also trusted IDs from the
picker without proving that both LR papers were `test_type=full`.

**Severity:** Critical.

**Impacted files:** `backend/services/mock_exam_service.py`
(`admin_update_exam()`, `set_open()`, `_advance_from()` and the new canonical
readiness helpers) and `backend/tests/test_mock_exam_workflow.py`.

**Suggested minimal fix:** validate canonical content before publish, before
opening the room, and immediately before stamping the next section clock. Treat
lookup uncertainty as not ready. Run validation before the atomic mode-change
RPC so a mixed failed PATCH cannot leave `exam_mode` changed behind an error.
On an already-published exam, validate only the section whose paper or duration
is being repaired; a broken historical Listening asset must not prevent an
admin from repairing the future Writing paper.

**Verification:** reject missing/unpublished Reading, missing/zero-duration
Listening audio, non-full LR papers, wrong-slot Writing prompts, and a mixed
mode/content patch; also prove a future paper can be repaired after a consumed
historical asset breaks and that closing remains available in that condition;
assert status, mode, `active_section`, and `{section}_started_at` remain
unchanged. A valid published paper must still open and advance normally.

### Issue: a stale admin snapshot still looked operational

**Root cause:** a failed live refresh retained the last useful snapshot, but its
clock continued ticking locally and mutation controls remained enabled. That
made an old client estimate look current and allowed open, collect,
advance, recollect, or void decisions without fresh canonical state.

**Severity:** Critical for live operations.

**Impacted files:**
`frontend/app/(authed-admin-mock-live)/admin/mock-live/admin-mock-live.tsx`,
`frontend/lib/admin-mock-live-model.mjs`,
`frontend/public/css/admin-mock-live-next.css`, and their model/browser gates.

**Suggested minimal fix:** retain the snapshot for situational awareness, label
it explicitly as stale, freeze its clock, close any pending destructive dialog,
and disable every risky mutation until a canonical refresh succeeds. Preserve
one explicit idempotent `Đóng kỳ khẩn` action while the stale snapshot says the
room was open: backend closing is intentionally always legal and reduces harm
even when the confirming live read is unavailable. Reject partial
student section maps, malformed clocks, malformed server time, and retake rows
whose section keys differ from their assigned skills.

**Verification:** inject a 503 on the live endpoint, wait longer than one clock
tick, and assert the displayed time is unchanged and all coordination actions
except emergency close are disabled; assert emergency close sends exactly
`is_open=false`, then restore the endpoint and verify canonical closed state and
re-enabled controls. Model fixtures must reject missing/extra sections and
invalid timing.

## High-priority improvements

### Issue: Listening media failure had no in-attempt recovery path

**Root cause:** `<audio>` load/decode errors and rejected `play()` promises only
changed internal playback state. A signed URL could expire or a connection
could drop after the section clock began, leaving the learner with no diagnosis
or way to request a fresh URL.

**Severity:** High.

**Impacted files:**
`frontend/app/(authed-listening-player)/listening/test/session/listening-test-session.tsx`,
`frontend/public/css/listening-test-next.css`, and Listening controller/browser
tests.

**Suggested minimal fix:** show a persistent accessible alert that truthfully
states the exam clock continues, refresh the canonical test payload to obtain a
new signed URL, remount the audio element, and resume from the shared mock clock
for a sitting. For a standalone attempt in the same tab, retain the media
element's last heard `currentTime` so time spent before the learner first pressed
Play is not incorrectly counted as heard audio. Retry automatically when the
browser returns online while keeping an explicit manual retry.

**Verification:** serve a broken media URL first, confirm the alert, replace it
with a decodable WAV, click “Tải lại audio”, and assert recovery happens in the
same attempt without losing answers or restarting the section.

### Issue: the parent could acknowledge an embedded flush it never performed

**Root cause:** a missing iframe/content window resolved the parent flush as if
it succeeded, and the three-second timeout was shorter than the embedded save
coordinator's retry ladder.

**Severity:** High.

**Impacted files:**
`frontend/app/(authed-mock-exam)/mock-exam/mock-exam-runner.tsx`, embedded
Reading/Listening flush contracts, and `verify-mock-exam-flow.mjs`.

**Suggested minimal fix:** missing or unreachable embeds must reject, malformed
ACKs must reject, and the parent timeout must cover the child retry window. Only
`unsaved: 0` from the exact frame and origin may release the server flush ACK.

**Verification:** delay a final embedded PATCH, fail the first Reading PATCH,
and omit `unsaved` once. Assert the paper remains mounted and inert, no server
ACK is sent early, and unmount occurs only after the latest answer persists and
an explicit clean ACK returns.

### Issue: Writing copy overpromised a local backup

**Root cause:** local-storage writes swallowed quota/privacy exceptions, while
the failure message always claimed the essay remained on the device.

**Severity:** High.

**Impacted files:**
`frontend/app/(authed-mock-exam)/mock-exam/mock-exam-runner.tsx` and its unit and
browser flow gates.

**Suggested minimal fix:** make local backup writes return success/failure and
show the stronger “keep this tab open until server saved” warning when storage
is unavailable. Offline and final-submit copy must distinguish in-memory,
device-local, and server-persisted states instead of treating them as equal.
When server autosave and local backup fail together, compose both facts into one
warning instead of letting the local-storage message hide the server failure.

**Verification:** force `Storage.setItem()` to throw for mock Writing draft keys
and verify the warning appears immediately. Separately verify newer unsynced
local drafts win restore, server autosave clears the dirty state, final-submit
retries reuse one immutable payload, and an ACK-lost submission reconciles from
canonical server state without duplication. A combined failure fixture must
show the stronger two-layer warning without false reassurance.

## Positive observations to preserve

- Native Reading and Listening coordinators already expose per-answer unsaved
  state, retry transient failures, retain terminal failures visibly, flush on
  `pagehide`/hidden state with keepalive, and retry when connectivity returns.
- Reading final submit sends the full current in-memory answer map after its
  flush; the mock parent independently refuses to ACK while the child snapshot
  still contains unsaved answers.
- Writing already combines server autosave, a versioned local draft, keepalive
  flush, bounded final-submit retry, and canonical readback after a lost ACK.
- Collection already freezes the paper before its ACK, and the backend sweep is
  gated by per-sitting flush acknowledgements rather than optimistic UI state.
- The runner already reports offline/blur/resume evidence as neutral integrity
  signals; the admin pacing view explicitly warns that these are not proof of
  misconduct.

## False positives rejected during validation

- Reading's standalone submit does not need to abort when an individual PATCH
  remains failed: the submit body contains the complete in-memory answer map.
  In mock collection, the stronger parent/child `unsaved` handshake still
  blocks an early sweep.
- The live payload's `live: false` value is not currently emitted by the
  backend, so no new attention flag was added for a state that has no canonical
  producer.
- Listening duration fallback remains useful for legacy standalone attempts,
  but publish/open/advance now prevent a configured mock section from reaching
  the shared clock without canonical positive audio duration.

## Independent Claude follow-up — 2026-08-23

- Accepted P1: reopening a mid-flight exam now validates only its current LRW
  section; a broken already-consumed paper cannot strand learners in a later
  section. A current broken section still blocks reopening without changing the
  room state or its original clock.
- Accepted P2: a successful Writing server autosave no longer clears the local
  backup warning unless both Task 1 and Task 2 device writes really succeed.
  Copy distinguishes canonical server persistence from unavailable device
  backup.
- Rejected P3: standalone Listening intentionally resumes from the media
  position actually heard in the same tab. Using wall time would count the
  briefing period before the learner first presses Play as consumed audio;
  seated Mock Exam attempts continue to derive position from the shared server
  clock.
- Rejected the prompt-injection warning for `frontend/AGENTS.md`: it is the
  framework-generated Next 16.3 instruction file required by the repository,
  not executable product input.
- Claude follow-up review found no further product defect. Its one Medium test-
  coverage concern about `active_section=not_started` was rejected after
  repository-context validation: `test_open_revalidates_audio_after_publish`
  and `test_deactivated_writing_prompt_blocks_open_without_changing_state`
  already prove that the explicit `sections=None` path validates all configured
  sections and leaves the room closed when readiness fails.
- Accepted post-merge inline P2: every new Writing edit now clears the prior
  server-saved cue immediately. When device backup is unavailable, the debounce
  window shows an unsaved-device warning until the newer snapshot receives its
  own server ACK; it no longer reassures the learner using an ACK for stale text.
- Accepted follow-up inline P2: edits after a failed server autosave preserve
  the server-failure cue. This keeps both the server-only warning (device backup
  succeeded) and the combined server/device warning visible while retry is due.

## Release verification

- Backend: full mock workflow and result endpoint suites, including readiness,
  mode atomicity, shared clocks, collection and submission reconciliation.
- Frontend: mock runner, Listening/Reading native controllers, admin live model,
  API auth/transport, and sealed-section contract suites.
- Browser: hermetic native mock journey, Listening broken-audio recovery, and
  admin stale-snapshot failure injection; no production egress.
- Build: strict TypeScript plus production Next.js build so Client Component and
  global CSS ordering are validated in the shipped mode.
- Independent review: send only the final repository diff to Claude with tool
  access disabled; remediate any validated P0–P2 finding and rerun the affected
  layer plus the full focused gates.

---

# Learner Mock Test exam-fidelity remediation — 2026-08-23

## Summary

The Mock runner already shares Reading and Listening through the stable core
player admission route, but fresh admission remains on Legacy while the latest
native redesign is staged behind Gate E. This batch deliberately does not flip
renderer policy. It removes Mock-only nested learner chrome from the admitted
Legacy Listening player and upgrades the native Mock Writing workspace without
changing answer, timer, save, collection or submission contracts.

## High-priority improvements completed

### Issue: Listening exposed a second product navigation inside the exam room

**Current state:** the embedded Legacy page rendered `<aver-chrome>` plus its
library header below the Mock room timer.

**Problem:** duplicate navigation consumed exam space and offered an irrelevant
escape route, while Reading correctly retained only its task-specific exam
tools.

**Recommendation applied:** scope embed CSS to `body.av-page`; hide the learner
chrome and library header, widen the Listening paper to the Mock viewport, and
leave Reading's `.exam-topbar` untouched.

**Impact:** one room-level timer and navigation hierarchy, with skill-specific
audio and question controls preserved.

### Issue: Writing showed a generic editor without task-completion guidance

**Current state:** Task tabs carried no progress, the editor showed only a raw
word count, and learners received no persistent 150/250-word, 20/40-minute or
Task 2 weighting context.

**Problem:** a learner could reach automatic collection with a blank or very
short task without noticing, even though the admin queue later applies those
same word minimums.

**Recommendation applied:** add canonical per-task guidance, honest tab states,
structured prompt hierarchy, word progress and a ten-minute short-task warning.
“Enough words” is never labelled “complete” and the warning explicitly states
that length is not a quality judgement. Spellcheck and autocorrect are disabled
for exam fidelity. Existing server/device save truth remains unchanged.

**Impact:** learners can allocate attention between both tasks and identify an
incomplete-length response before collection without receiving false quality
reassurance.

## Positive observations preserved

- Reading keeps its display settings, Hide/Help controls, split paper and exam
  palette; the Mock embed patch does not flatten task-specific behavior.
- Writing keeps four pane layouts, pointer and keyboard resizing, responsive
  stacking, canonical autosave, local recovery and collection freeze.
- No renderer cutover, API, schema, scoring or timer behavior changes are part
  of this UI remediation.

## Verification

- Focused source/model suite: 48 tests passed.
- Strict TypeScript: `tsc --noEmit --incremental false` passed.
- Hermetic browser journey: 34/34 checks passed, including desktop, 390×844,
  dark theme, page-level overflow, save failure, lost ACK and collection flows.
- Visual QA used populated Writing fixtures at 1280×900, 390×844 and dark
  1280×900. Developer cache overlays are excluded from product assessment.

## Independent Claude review

- Accepted P2: Task 1 guidance now reads canonical `task_type` and distinguishes
  Academic visual-information analysis from General Training letter writing;
  unknown historical types receive neutral instructions instead of guessed
  chart guidance.
- Accepted the coverage part of Claude's Listening selector concern: regression
  tests now pin the actual Legacy Listening `av-page`/`ft-shell` DOM and the
  separate Reading `exam-chrome`/`exam-topbar` DOM, not only hook source text.
- Rejected the claimed cross-surface regression after repository validation:
  the admitted Reading page uses `body.exam-chrome`, never `body.av-page`, so
  the Listening-only selector cannot remove Reading tools.
- Rejected the warning-token concern: `--av-warning-soft` is defined in light,
  explicit dark and system-dark token scopes and was visually checked in dark
  mode.
- Rejected the heading concern: the Writing prompt heading is the sole `<h1>`
  in the mounted exam-workspace state; waiting/submitted states are mutually
  exclusive, and Task switching keeps exactly one page heading mounted.
- Claude's final follow-up confirmed all four concerns closed and found no new
  actionable P0–P2 issue; Gate E admission remains unchanged.

## Final independent-review remediation

- The ten-minute Writing guidance is visual context only. Its ticking clock is
  no longer an `aria-live` region, preventing per-second screen-reader
  announcements from masking autosave and collection messages.
- Task 1/2 time guidance now follows the canonical server section duration at a
  1:2 allocation. A 40-minute section shows 13/27 minutes rather than the fixed
  20/40-minute full-test recommendation; extremely short fixtures fall back to
  proportional wording instead of impossible minute totals.
- Active-tab progress text now uses the full on-primary token. The previous 78%
  alpha colour measured about 4.00:1 on the light primary surface and did not
  meet WCAG AA for small text.
- Browser QA now freezes the 09:00 countdown, exercises the final-ten-minute
  banner in dark mode, checks its computed background, and covers the 900px
  toolbar band. Listening/Reading source sentinels also match body classes and
  hidden selectors structurally instead of relying on whitespace-exact strings.
- Follow-up review hardened the same contracts further: configured-duration
  fallback and zero/invalid inputs are covered in model tests, the 1:2 time
  ratio is derived from one canonical guidance table, warning text uses the
  primary readable text token, and Listening tests pin the direct-child DOM
  relationships required by the embed selectors.
