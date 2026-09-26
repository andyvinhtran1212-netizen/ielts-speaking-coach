---
id: LISTENING-0005
title: Listening content programmes, import and learner hub
status: implementing
risk: high
owner: product
---

# Listening content programmes, import and learner hub

## Problem

The current Listening product is organized around four implementation-shaped
libraries: full tests, mini tests, skill drills, and quick practice. The new
content release contains two distinct learner programmes that do not fit that
flat model:

- General Listening Practice: 56 lessons, 143 forms, 911 items, and 273 audio
  stimuli;
- IELTS Listening Practice: 10 groups, 16 forms, 134 items, and 117 audio
  stimuli.

The two packages pass their immutable publish-package validation, but every form
is `report_only`. They explicitly prohibit IELTS band, CEFR, mastery,
psychometric-equivalence, and full-progression claims. The existing
`listening_tests` player and analytics assume scored exam-like attempts and can
emit band estimates and weakness conclusions. In addition, a package form can
reference up to 15 stimuli while the current test-section schema supports at
most four sections. Importing the packages directly into the current contract
would therefore create incorrect scoring, navigation, and analytics behavior.

The current learner hub also labels the whole product "Luyện nghe IELTS", gives
four modes equal prominence, and has no programme, lesson, or resume hierarchy.
Its visual foundations are mostly token-compliant, but page headers, back links,
eyebrow wording, shell spacing, and Listening-specific class ownership are not
consistent across the Listening route group.

## Audit baseline

- Audit date: 2026-09-21.
- Official publish-package validator: PASS for 2/2 packages; 1,314 artifact
  hashes, 458 public JSON files, 390 WAV files, 390 timing files, 1,474 timing
  segments, and 2 SVG files checked; zero failures and zero protected-field
  findings.
- Package payload: approximately 422 MiB General plus 54 MiB IELTS.
- General response types: 698 short answer, 183 open rubric, 23 single choice,
  and 7 map label. Seventy-two forms contain open-rubric work.
- IELTS response types: 118 single choice, 7 written, 6 short answer, and 3
  multiple choice.
- All 159 forms use `report_only`; 61 forms use more than one stimulus.
- Human content verification and perceptual listening remain explicitly
  deferred and are not claimed as completed.
- Current targeted backend Listening baseline: 60/60 tests pass. The targeted
  frontend baseline passes 116/117 assertions; the one failure is a stale
  regression fixture path in `listening-analytics-next-behavior.test.mjs` that
  reads removed `frontend/public/pages/listening-analytics.html` instead of the
  retained legacy fixture. It must be repaired and rerun before feature work.
- The broader working Content Hub currently fails reproducibility validation:
  34 external-source symlinks are broken, so 19 candidate manifests are not
  reachable. This does not alter the self-contained publish-package bytes, but
  it must be repaired or explicitly archived before the overall hub can be
  described as healthy.

## Scope

- Import the two immutable publish-ready packages through a dry-run-first,
  idempotent operator workflow.
- Preserve package, lesson, form, stimulus, item, scoring, replay, support,
  transcript, answer-key, timing, and rollback provenance.
- Add the minimum canonical programme and lesson model required to group forms
  and calculate truthful completion.
- Support report-only attempts without IELTS band, CEFR, mastery, pass/fail, or
  diagnostic weakness claims.
- Present objective items as report-only feedback and textual/rubric items as
  unscored self-review in v1 unless a future approved review workflow exists.
- Reorganize `/listening` around resume, General Listening, IELTS Listening,
  recent activity, and progress.
- Add General and IELTS programme hubs while preserving existing Listening deep
  links.
- Synchronize the affected Listening surfaces with the Aver design system and
  one local Listening page-header/card/state vocabulary.
- Stage, verify, publish, observe, and roll back each package independently.

## Non-goals

- Claiming that General content is a complete course progression or exposing
  source-like A0/B1/B2 identifiers as CEFR levels.
- Treating imported IELTS practice as a Cambridge full test or band predictor.
- Building human marking, AI semantic grading, psychometric calibration, or
  adaptive mastery in v1.
- Replacing the existing full-test, mini-test, skill-drill, quick-practice,
  dictation, or mock-exam contracts.
- Building a general-purpose browser ZIP upload console or background job
  platform. The first release uses an operator-run importer; browser upload can
  be proposed separately if repeated content operations justify it.
- Editing the hash-locked v1 package in place. Corrections require a new package
  version and a complete validation run.
- Mass-refactoring unrelated Listening player, admin, or legacy CSS.

## Users and journeys

- A learner opens `/listening`, resumes an active free-practice attempt, or
  chooses General Listening or IELTS Listening according to today's goal.
- A General learner browses lesson-sized groups, opens a form, completes one or
  more audio-based activities, and receives completion plus objective feedback
  and self-review material without a proficiency claim.
- An IELTS learner sees imported practice separated from exam-shaped Full Test,
  Mini Test, Skills, and Quick Practice choices.
- An operator dry-runs a package, reviews its compatibility report, imports it
  as non-public content, performs a complete static walkthrough, and publishes
  the package atomically.
- An operator archives one imported package revision without deleting attempt
  history or disturbing pre-existing Listening content.

## Requirements

- **FR-001:** Only a package listed in `02_PUBLISH_READY/release-index.json`
  whose manifest binding, complete artifact inventory, hashes, public/protected
  boundary, media format, timing bounds, and declared counts pass server-side
  validation may be committed; a dry run performs no database or Storage
  mutation.
- **FR-002:** Import is idempotent by package ID, manifest SHA-256, source lesson
  ID, and source form ID. Re-running the same package produces no duplicate rows
  or overwritten media; a conflicting package ID with different bytes fails
  closed and requires a new version.
- **FR-003:** Canonical persisted truth represents package release, programme,
  lesson/group, form, assembled form media, item, and source provenance. Existing
  IELTS rows remain readable and default to their current diagnostic behavior.
- **FR-004:** Public learner responses never include protected answers, rubrics,
  evidence quotes, scripts, or teacher data before submission. Controlled
  transcripts are exposed only through the existing authorized accommodation or
  post-submission boundary; audio stays in private Storage and is served through
  authorized or time-limited access.
- **FR-005:** Every imported form retains `scoring_policy`, `replay_policy`,
  `support_policy`, purpose, maximum score, source identifiers, and claim policy.
  A `report_only` attempt never receives a band estimate, CEFR label, mastery,
  pass/fail, diagnostic weakness, or exam-equivalence wording.
- **FR-006:** V1 may auto-check only objective choice/map items. Short-answer,
  written, and open-rubric responses remain unscored self-review unless an
  explicit machine-readable objective rule is added by a later package revision
  and approved contract. Results separate checked, unscored, blank, and technical
  error states; completion is not inferred from score.
- **FR-007:** A form with one to 15 source stimuli receives one deterministic
  derived form-audio asset. Assembly preserves declared stimulus order, records
  source-to-derived offsets, shifts segment timing without inventing text, stores
  transform version and output hash, and gives every item a resolvable source
  window. Source WAV files and package hashes remain unchanged.
- **FR-008:** `/listening` renders one dominant resume/next-action card, two
  programme cards, bounded recent activity, truthful progress, and secondary
  library/analytics links. The page title is "Luyện nghe", not "Luyện nghe
  IELTS", and all counts come from canonical published rows.
- **FR-009:** `/listening/general` groups the 143 forms under 56 lesson cards and
  exposes practice/transfer/checkpoint forms within a lesson. It uses neutral
  library wording rather than CEFR, mastery, or guaranteed progression wording,
  and supports all/new/in-progress/completed filtering.
- **FR-010:** `/listening/ielts` presents imported report-only practice separately
  from existing Quick Practice, Skills, Mini Test, and Full Test paths. Imported
  forms cannot appear as Full Tests unless a later revision satisfies the
  existing exam contract.
- **FR-011:** Overview, programme-library, form-detail, and attempt-result
  endpoints publish explicit response schemas. During the compatibility window,
  `/api/listening/overview` and `/api/listening/tests` retain fields required by
  the currently deployed frontend while adding programme, source, scoring, and
  resume fields.
- **FR-012:** Analytics separates diagnostic/scored evidence from report-only
  completion. Imported attempts may contribute activity, minutes, completion,
  and review-needed counts, but not band trends, aggregate diagnostic accuracy,
  or `weakest_mode`.
- **FR-013:** The Listening route group uses the canonical `.shell`, `--av-*`
  tokens, Plus Jakarta Sans and JetBrains Mono roles, light/dark themes, visible
  focus, 44px targets, reduced-motion guards, sentence-case Vietnamese copy,
  one shared back-link/header pattern, and complete loading, empty, success,
  error/retry, permission, and partial-data states.
- **FR-014:** Publishing is package-scoped and atomic. All imported rows begin
  non-public; promotion requires package validation, database/static walkthrough,
  representative player/result checks, and exact-SHA staging evidence. Rollback
  archives the package's public rows and derived assets without deleting attempts
  or modifying unrelated content.

## Acceptance scenarios

### Dry-run and immutable commit

- **Given** a self-contained package whose manifest is bound by the release index
- **When** an operator runs the importer in dry-run mode
- **Then** the report lists exact creates/reuses/rejections, type mappings,
  derived media plan, claim restrictions, and total bytes without mutating
  Storage or PostgreSQL.
- **When** the operator commits that same approved manifest
- **Then** all rows and assets are namespaced by package/version, initially
  non-public, and a repeated commit is a no-op.

### Conflicting package bytes

- **Given** an imported package ID already exists
- **When** another payload presents the same package ID with a different manifest
  hash
- **Then** the import fails closed and neither existing rows nor media are
  overwritten.

### Multi-stimulus form

- **Given** a form references 15 stimuli
- **When** it is imported and opened
- **Then** one deterministic derived audio timeline preserves all 15 stimuli,
  each question resolves to the correct source window, and replay behavior
  follows the form policy.

### Report-only result

- **Given** a learner submits a General form containing objective and open-rubric
  items
- **When** the result is rendered
- **Then** objective feedback is labeled as practice feedback, open responses are
  labeled for self-review, completion is persisted, and no band, CEFR, mastery,
  pass/fail, or weakest-skill claim is produced.

### Programme navigation

- **Given** both packages are published
- **When** a learner opens `/listening`
- **Then** the page first shows an eligible active free-practice attempt or one
  deterministic next action, followed by General and IELTS programme choices;
  existing Full Test, Mini Test, Skills, Quick Practice, Browse, and Analytics
  URLs still resolve.

### Package rollback

- **Given** an imported package is public and has learner attempts
- **When** an operator rolls back that package revision
- **Then** its library rows disappear after canonical reload, attempt history is
  retained, unrelated Listening content is unchanged, and a later corrected
  package must use a new immutable version.

## Edge cases

- A package upload is incomplete, its TUS/upload token expires, or a local import
  is interrupted before commit.
- Archive paths contain traversal, symlinks, undeclared files, excessive expanded
  size, spoofed MIME/signature, or unsafe active content.
- A stimulus is referenced by several items or forms and derived media assembly
  is retried after partial Storage success.
- A form has only unscored textual responses, only objective responses, or a mix.
- A transcript is requested before submission without an approved accommodation.
- A resumable attempt belongs to a mock/class context and must not appear as a
  free-practice resume card.
- Counts load while recent activity fails, or one programme has no public forms.
- Existing diagnostic attempts and imported report-only attempts coexist in
  analytics.
- The 34 broken working-hub symlinks remain unavailable even though publish-ready
  packages still validate independently.

## Success criteria

- Both release packages dry-run and import with zero missing/duplicate source
  entities and exact package counts.
- A static walkthrough resolves all 159 forms, 1,045 items, 390 source stimuli,
  390 media files, 390 timing files, and 2 visuals from database rows back to
  source hashes.
- No pre-submission learner response contains a protected field or controlled
  transcript.
- Every imported attempt has a null band estimate and is excluded from diagnostic
  weakness calculations.
- `/listening` and both programme hubs pass desktop/mobile, light/dark, keyboard,
  focus, reduced-motion, loading, empty, error, retry, and permission checks.
- Existing Listening routes, diagnostic scoring, exam resume, dictation, and mock
  flows pass their regression suites unchanged.
- Each package can be unpublished independently with attempt history retained.

## Approved decisions and release preconditions

- V1 treats all short-answer, written, and open-rubric items as unscored
  self-review. No human or AI adjudication is part of this import; adding either
  requires a separate approved grading specification.
- The missing external working-source roots must either be restored or formally
  archived with a revised validator scope before implementation depends on the
  broader working hub. No symlink target may be guessed or silently replaced.
