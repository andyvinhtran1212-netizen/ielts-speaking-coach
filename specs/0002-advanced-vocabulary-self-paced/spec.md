---
id: AVOC-0002
title: Advanced Vocabulary self-paced core 30
status: approved
risk: high
owner: product
---

# Advanced Vocabulary self-paced core 30

## Problem

Advanced Vocabulary exists as a planned 30-lesson source course, but learners
cannot yet complete it as an assigned, resumable journey inside Aver Learning.
The authored vocabulary, quizzes, Reading, Listening, Writing references,
Speaking prompts, illustrations, and media also lack one deployable contract
that prevents answer leakage and gives admins canonical completion evidence.

## Scope

- Ship the first 30 core lessons as admin-assigned, self-paced content.
- Attach all 30 assignment-only banks to Course 5 (`C5`), never Course 4.
- Preserve authored content while enriching the 720 vocabulary cards with
  common-error guidance and headword/example audio.
- Persist required-stage evidence and expose canonical learner results to admins.
- Provide learner-friendly Reading, Listening, Writing reference, and Speaking
  practice surfaces without enabling default Writing or Speaking grading.
- Add the migration, RLS, immutable content/media versions, and staged rollout
  needed for safe deployment.

## Canonical authored source

- The release source is the product-owner-provided Advanced Vocabulary export whose
  acquisition root for this build is `/Users/trantrongvinh/Downloads/Vocab course`.
  It is product-owned course material for use in Aver Learning, not third-party public
  content; the local acquisition path is never deployed or treated as reproducible
  identity. The selected generated source package is the corrected v6 T11-map build
  derived from that acquisition root. Its locked revisions are authored-input-map
  SHA-256
  `2d2750cd7dbe55c19adaf2c8b102a653627f494437546740ea2c4ebbad7591fc`,
  Kokoro bundle SHA-256
  `c0495ddac3a1c865d6f07963f11534693f024ba9042eea0ab4b737511fb4c166`,
  and generated package SHA-256
  `176344b624eaf2edcd8b7407b60338ff3a7b3d4fd3a76be268022a6ba1f85e2e`.
  This corrected package revision replaces the unrelated campus template previously
  packaged for T11 with the Westport Intermodal Hub layout required by the audio and
  keyed locations D (bike-hire dock) and F (left luggage). It keeps Reading editorial
  evidence fields in the private solution map,
  and keeps all 20 controlled-rewrite exercises in the public prompt payload while
  retaining reference answers in the private solution payload. The earlier v5
  manifest revision `968a…` referenced the figure without the packaged file or
  checksum and exposed those editorial fields in learner questions. The intervening
  `c0b854…` revision matched an answer-key phrase in the assessment introduction and
  consequently hid all 20 controlled-rewrite exercises as solutions. The later
  `d1acfd…` package restored the rewrite prompts but retained a checksum-valid campus
  map whose semantics did not match T11. None of those earlier revisions is
  publish-ready.
- T002 commits `backend/content/advanced_vocab/source-inputs-manifest.json` as the
  canonical source revision. It records a stable source ID, rights/origin note, every
  builder-consumed relative path (lesson documents, assessment/quiz Markdown, Reading/
  Listening JSON, manifests/timings/audio/figures, Writing banks/illustrations, the
  88-supplement override source, and Kokoro bundle inputs), each SHA-256 and role/
  lesson mapping, plus a canonical manifest SHA-256 used as `source_revision`.
  The manifest must reproduce the three locked revision values above.
- Builder and package validation fail before snapshot/import when any declared source
  input is missing, substituted, extra within the declared release set, or digest-
  mismatched. Generated lesson provenance must be a consistent subset of that source
  manifest; output checksums alone do not substitute for source provenance.

## Non-goals

- Public catalog discovery, self-enrolment, or a general-audience course launch.
- Default scoring for the overall lesson, Writing Insight, or Speaking practice.
- Accepting Writing submissions outside an explicit teacher-created assignment.
- Capturing or submitting microphone audio from the Advanced Vocabulary Speaking
  reference; learners use the prompts for unrecorded practice in this release.
- Expanding beyond the authored T01-T30 core in the first release.

## Users and journeys

- An admin assigns one of the 30 lesson banks and later reads canonical per-stage
  attempts and completion evidence.
- A learner opens an assignment, studies vocabulary, completes the required
  practice, Reading, controlled rewrite, and Listening stages, and resumes from
  persisted progress until completion.
- A learner reads Writing Task 1/2 analysis and model material or uses optional
  Speaking prompts for unrecorded practice without creating a submission.

## Requirements

- **FR-001:** Admins can assign exactly 30 Advanced Vocabulary core lesson banks;
  the banks remain assignment-only and are not exposed in public discovery or served
  by the generic quiz-player route. Anonymous and authenticated Supabase/PostgREST
  reads must also exclude banks whose runtime kind is `advanced_vocab`; service-role
  admin/assignment flows retain canonical access.
- **FR-002:** Each assigned lesson is resumable and completes only after the
  required vocabulary, two practice, Reading, controlled-rewrite, and Listening
  interactions; opening a page alone never completes a stage, and every mutation
  rechecks active cohort membership, `publish_at`, and the assignment deadline at
  persistence time. Learner reads apply the same canonical open-state gate. My Class
  derives an Advanced runtime discriminator from the frozen assignment snapshot and
  routes Start, Continue, and Review to the dedicated learner shell; ordinary course
  assignments retain their current course-exercises route.
- **FR-003:** The release preserves 24 authored words per lesson, uses the authored
  per-session quiz material, includes all 88 curated common-error supplements,
  and serves checksum-bound headword and example audio for every vocabulary card.
- **FR-004:** Reading and Listening are automatically checked without leaking
  solutions before submission; both Practice stages omit answers, accepted variants,
  explanations, and correction fields until the corresponding immutable attempt is
  accepted; Controlled Rewrite exposes only its prompt IDs/prompts before submission,
  then persists all 20 answers as one immutable submission, makes exactly one batch
  model request for grammar/style feedback per learner/unit, and returns feedback plus
  reference solutions. Provider failure must preserve the answers and consume no
  second model call; reload returns the same persisted state;
  Reading text and questions scroll independently, and fixed-choice/MCQ option
  identities grade consistently.
- **FR-005:** Writing Task 1/2 and Speaking remain reference or practice content,
  do not capture or submit responses in this runtime, are not graded by default,
  and Writing can be submitted for grading only through a teacher assignment.
- **FR-006:** Required-stage answers, attempts, guided retry state, completion
  timestamps, and bounded response time/duration where the interaction supplies one
  are persisted as canonical backend truth and returned to admins without inventing
  an overall score or wall-clock duration. Terminal completion stamps the existing
  `passed_at` marker alongside `submitted_at` while leaving `score` null, so the shared
  learner course action is Review immediately and after reload. Shared admin summary
  and tally paths use a runtime-aware neutral `completed` state (not `passed`), show no
  score or fabricated pass verdict, and emit no scored-ledger mismatch. Any partial
  evidence prevents assignment-item deletion; archiving preserves progress for
  admins, blocks learner access, and republishing restores learner resume from the
  same canonical stage only while the deadline remains open. An expired incomplete
  item requires an explicit deadline extension before resume; a submitted expired
  item may be republished without changing `due_at` because it remains review-only
  with `accepting:false`. Terminal finalization also sets
  `class_assignment_items.state = 'submitted'` in the same transaction.
- **FR-007:** Database migration and RLS policies isolate learner-owned evidence,
  preserve immutable submission/version history, and support idempotent staged
  deployment before application promotion. The final Listening evidence and
  assignment finalization must commit atomically under active-membership, parent-
  assignment, then assignment-item locks;
  an Advanced-Vocabulary-specific guard permits only attempt 1 and one row per
  item/section regardless of the generic course retry key, identical replay is
  idempotent, different replay conflicts, and complete pilot states that predate the
  trigger are reconciled from canonical evidence. Persistence-time guards reject any
  evidence write before `publish_at` or after membership removal/transfer, archival,
  or deadline expiry. Archive/republish takes the same assignment-row lock so a
  learner evidence transaction and archival serialize in either commit order;
  removal/transfer updates the same locked membership row and provides the equivalent
  serialization for roster changes. Migration 281 replaces the legacy public
  `quiz_banks` select policy so direct anon/authenticated reads cannot enumerate the
  Advanced runtime while ordinary bank visibility remains unchanged.
- **FR-008:** Authored lesson JSON and runtime media use immutable content versions
  and verified SHA-256 provenance, including Listening figures and audio, so a
  deployed assignment reopens the same content revision. Assignment creation must
  snapshot the bank runtime metadata into the assignment, and learner, submission,
  resume, and admin-result reads must resolve that snapshot even after a later bank
  version is imported. An Advanced bank referenced by any assignment or immutable
  version cannot be deleted; admin may unpublish/archive it to prevent new assignment,
  while existing pinned assignments and all evidence remain resolvable. Importing a
  new bank revision, changing its published state, and issuing an assignment must
  serialize on the same bank-scoped database lock: the import atomically replaces the
  question rows and switches the bank runtime metadata; publish-state mutation commits
  before any later issuance can proceed; and assignment issuance atomically reads the
  metadata, revalidates `is_published` immediately before persistence, and writes its
  frozen snapshot. The existing `POST /admin/quiz/import` contract retains multipart
  `file` and query parameters `topic_id`/`dry_run`; it adds optional query parameter
  `publish_state=preserve|published|unpublished`, defaulting to `preserve`. Under
  `preserve`, an existing bank retains the publication state observed under the lock;
  a newly created Advanced bank starts unpublished, while a new ordinary bank keeps
  the existing published default. An explicit `published` or
  `unpublished` directive changes state atomically with the revision; an unknown value
  returns 422 before mutation. Either import/issuance commit
  order therefore yields a wholly old or wholly new revision, never a mixed snapshot/
  question set; an overlapping default import cannot undo an admin retirement; and
  unpublish-first rejects issuance while issuance-first completes before unpublish
  returns.
- **FR-009:** Starting either Practice stage creates exactly one immutable server-
  selected question set for that assignment item/stage. Repeated starts, response-
  loss recovery, and reload return the original persisted selection rather than
  conflict or select again; answers and completion accept only IDs from that set.
- **FR-010:** Every imported Advanced Vocabulary core bank belongs to the persisted
  course row whose stable code is `C5`. The importer must resolve `C5` before any
  write, reject a missing or ambiguous course, write that `course_id` on all 30 banks,
  and verify that no released Advanced bank is attached to `C4`, another course, or
  `NULL`. Admin assignment discovery must expose the banks only to a cohort whose
  canonical `course_id` is the resolved `C5` row, and the frozen assignment snapshot
  must preserve that association after reload.
- **FR-011:** Controlled Rewrite AI feedback is release-gated by the versioned gold-
  cohort evaluation defined below. A release candidate must meet every absolute
  quality, grounding, false-positive, latency, and cost threshold; retain reference
  solutions as the no-AI baseline/fallback; and persist the provider-failure state
  without retrying or blocking learner progress. Prompt version, model, evaluation-
  dataset checksum, token usage, latency, and estimated cost must be recorded in the
  release evidence so the result is reproducible and comparable across revisions.

### Required-stage completion evidence

- **Vocabulary:** the learner sends the complete set of 24 authored `lexeme_id`
  values; the server rejects a partial set and upserts a completed vocabulary stage
  with the canonical seen-ID set and server completion timestamp. No client-derived
  duration is recorded for this untimed study stage.
- **Practice 1 and Practice 2:** Practice 1 mutations require persisted Vocabulary
  completion, and Practice 2 mutations require persisted Practice 1 completion; the
  server rejects out-of-order start and answer calls without writing progress. It
  accepts at most one immutable answer per server-selected question and marks the
  stage complete only when distinct persisted question attempts cover every selected
  question (28 and 20 respectively). Each accepted answer stores its supplied
  `response_time_ms`, capped at 12 hours; identical replay does not add time, and the
  admin stage duration is the sum of those immutable rows.
- **Reading:** the learner submits a non-empty answer for every authored Reading
  question after Practice 2; the server creates exactly one canonical
  `course_section_submissions` Reading row containing answers, frozen answer key,
  frozen content, result counts, and duration.
- **Controlled rewrite:** after Reading, the learner submits exactly one non-empty
  answer for every one of the 20 server-issued prompt IDs. The server validates the
  exact ID set, atomically persists the normalized answer map as the first immutable
  submission with its completion timestamp, and only then reveals reference
  solutions. That accepted submission triggers at most one batch model request for
  grammar/style feedback. The feedback result or sanitized provider-failure state is
  persisted with model and prompt-version provenance; identical replay and reload
  return the same record, while a changed replay conflicts and never invokes the
  model again. Provider failure does not roll back the answers, hide the solutions,
  or block progression. This is an untimed learning interaction, not a graded Writing
  submission; no client-derived duration or score is stored.
- **Listening:** after controlled rewrite, the learner submits a non-empty first
  answer for every authored Listening question. When guided retry is required, the
  first attempt alone is not completion: the learner must submit every initially
  incorrect question, after which the server creates exactly one canonical Listening
  section row containing both the frozen initial attempt and retry evidence. Reading
  and Listening store supplied `duration_sec`, capped at 12 hours; retry/resume never
  replaces the first accepted duration. Until retry completes, learner progress
  reconstructs the persisted initial results and exact initially incorrect question
  IDs so an interrupted client resumes the guided retry without repeating attempt 1.
- Repeating an identical completion call returns the existing canonical evidence or
  performs an idempotent upsert. A different answer after an immutable submission,
  or a conflicting concurrent retry, returns a conflict and never overwrites the
  first accepted evidence. Reload/resume reconstructs completion only from these
  persisted records; client view state is never completion evidence.

## Acceptance scenarios

### Assigned learner completes a lesson

- **Given** an admin-assigned Advanced Vocabulary bank
- **When** the learner completes every required interaction in order
- **Then** progress survives reload, the assignment becomes complete, and the
  admin sees the persisted evidence with no default total score

### Reference content remains ungraded

- **Given** an assigned lesson containing Writing and Speaking material
- **When** the learner reads the analysis or uses the optional Speaking prompts
- **Then** no Writing submission or grading job is created, and teacher assignment
  remains the prerequisite for graded Writing

### Authored answers remain private

- **Given** either Practice stage, controlled rewrite, Reading, or Listening before
  its reveal boundary
- **When** the learner API returns its activity payload
- **Then** answers, accepted variants, explanations, correction notes, solutions,
  evidence, transcripts, rewrite solutions, and answer-bearing editorial fields are
  absent while public prompts and option identifiers remain usable; an accepted
  Practice answer reveals feedback only for that immutable attempt, and controlled-
  rewrite solutions appear only after the immutable answer map for all 20 prompt IDs
  is accepted

### Frozen assignment reopens safely

- **Given** an assignment pinned to a lesson checksum
- **When** canonical content is revised later
- **Then** the learner and admin continue reading the immutable pinned snapshot
  and its checksum-matched assets

## Edge cases

- Duplicate or normalization-colliding option IDs fail package validation.
- Malformed activity rows, answer-bearing support objects, missing media, and
  checksum drift fail before import or filesystem mutation.
- Repeated submissions cannot overwrite canonical first-submission evidence.
- Finalizer failure rolls back the triggering Listening evidence, concurrent
  finalizers serialize without duplicate completion, and the migration repair
  changes only a pilot item that already has all six canonical evidence sets. Both
  live finalization and eligible pilot repair atomically set item `state='submitted'`
  with terminal timestamps, and learner/admin reloads agree.
- Admin deletion is rejected after the first partial-progress row in each Advanced
  Vocabulary evidence store; archive/retire preserves the assignment and every row,
  hides it from the learner, and a later republish restores the saved progress.
- Removing an assignment does not make its historical evidence public or reusable.
- Network or browser interruption resumes from persisted stage state.
- A Practice start response lost after commit returns the same persisted selection on
  retry and lesson reload for both Practice 1 and Practice 2.
- Membership removal/transfer between any two stages revokes further read/write
  access without deleting prior evidence. A deadline crossed after page load rejects
  that stage mutation; submitted work remains review-only, while incomplete expired
  work exposes no lesson payload.
- Before `publish_at`, direct learner reads and every mutation expose no lesson
  payload and persist no evidence; the canonical open state begins at the timestamp.
- Direct or stale-client deletion of an assigned/versioned Advanced bank conflicts
  before database cascade; unpublishing hides it from new assignment selection but
  learner/admin reloads of existing pinned work retain the bank and evidence.

## Success criteria

- Package validation reports 30/30 publish-ready lessons, 720 words, all required
  activities, and no unapproved or checksum-mismatched media.
- Import verification reports 30 assignment-only banks with 48 practice questions
  per bank, no default score policy, and the resolved `C5` `course_id` on all 30 with
  zero Advanced banks attached to `C4`, another course, or `NULL`.
- The Controlled Rewrite quality report evaluates 60 immutable batch submissions
  (two per lesson; 1,200 answer-level items split evenly between acceptable and
  error-bearing answers) against dual-human labels with adjudication. The release
  candidate must produce schema-valid, one-call persisted output for 100% of cases;
  keep false-positive feedback at or below 5% of acceptable answers; achieve at least
  90% precision across individual feedback claims and at least 85% coverage of
  error-bearing answers; make zero invented quotations and no more than 1% meaning-
  changing or harmful corrections; keep p95 feedback latency at or below 20 seconds;
  and keep p95 estimated model cost at or below USD 0.10 per 20-answer submission and
  the full 60-call release evaluation at or below USD 6.00. Any failed absolute
  threshold blocks release even if it improves on the frozen first-candidate baseline.
- Backend, frontend, browser, migration/RLS, staging smoke, and production smoke
  gates pass on the exact promoted SHA.
- Admin and learner views agree after immediate actions and full reload.

## Open questions

- Public discovery and self-enrolment will be specified as a separate expansion
  after assignment-only production evidence is stable.
- Approval record: the product owner confirmed the core-30, assignment-only,
  no-default-grading scope on 2026-09-15 before replacement implementation work.
- Approval amendment: on 2026-09-20 the product owner approved the Controlled Rewrite
  immutable-answer/AI-quality contract and the executable `C5` association requirement
  before implementation of those amended requirements.
