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
- Preserve authored content while enriching the 720 vocabulary cards with
  common-error guidance and headword/example audio.
- Persist required-stage evidence and expose canonical learner results to admins.
- Provide learner-friendly Reading, Listening, Writing reference, and Speaking
  practice surfaces without enabling default Writing or Speaking grading.
- Add the migration, RLS, immutable content/media versions, and staged rollout
  needed for safe deployment.

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
  by the generic quiz-player route.
- **FR-002:** Each assigned lesson is resumable and completes only after the
  required vocabulary, two practice, Reading, controlled-rewrite, and Listening
  interactions; opening a page alone never completes a stage, and every mutation
  rechecks active cohort membership, `publish_at`, and the assignment deadline at
  persistence time. Learner reads apply the same canonical open-state gate.
- **FR-003:** The release preserves 24 authored words per lesson, uses the authored
  per-session quiz material, includes all 88 curated common-error supplements,
  and serves checksum-bound headword and example audio for every vocabulary card.
- **FR-004:** Reading and Listening are automatically checked without leaking
  solutions before submission; both Practice stages omit answers, accepted variants,
  explanations, and correction fields until the corresponding immutable attempt is
  accepted; controlled rewrite exposes only its prompt IDs/prompts until all 20 are
  accepted, then returns reference solutions from persisted completion evidence;
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
  course action is Review immediately and after reload. Any partial evidence prevents
  assignment-item deletion; archiving preserves progress for admins, blocks learner access, and
  republishing restores learner resume from the same canonical stage only while the
  deadline remains open. An expired incomplete item requires an explicit deadline
  extension before resume; a submitted expired item remains review-only.
- **FR-007:** Database migration and RLS policies isolate learner-owned evidence,
  preserve immutable submission/version history, and support idempotent staged
  deployment before application promotion. The final Listening evidence and
  assignment finalization must commit atomically under parent-assignment then
  assignment-item locks;
  an Advanced-Vocabulary-specific guard permits only attempt 1 and one row per
  item/section regardless of the generic course retry key, identical replay is
  idempotent, different replay conflicts, and complete pilot states that predate the
  trigger are reconciled from canonical evidence. Persistence-time guards reject any
  evidence write before `publish_at` or after membership removal/transfer, archival,
  or deadline expiry. Archive/republish takes the same assignment-row lock so a
  learner evidence transaction and archival serialize in either commit order.
- **FR-008:** Authored lesson JSON and runtime media use immutable content versions
  and verified SHA-256 provenance, including Listening figures and audio, so a
  deployed assignment reopens the same content revision. Assignment creation must
  snapshot the bank runtime metadata into the assignment, and learner, submission,
  resume, and admin-result reads must resolve that snapshot even after a later bank
  version is imported.

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
- **Controlled rewrite:** after Reading, the learner confirms an attempt for all 20
  server-issued prompt IDs; only then does the server persist the canonical attempted
  ID set and server completion timestamp and reveal reference solutions. This is an
  untimed completion marker, not a graded Writing submission; no client-derived
  duration is stored.
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
  rewrite solutions appear only after all 20 prompt IDs are persisted

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
  changes only a pilot item that already has all six canonical evidence sets.
- Admin deletion is rejected after the first partial-progress row in each Advanced
  Vocabulary evidence store; archive/retire preserves the assignment and every row,
  hides it from the learner, and a later republish restores the saved progress.
- Removing an assignment does not make its historical evidence public or reusable.
- Network or browser interruption resumes from persisted stage state.
- Membership removal/transfer between any two stages revokes further read/write
  access without deleting prior evidence. A deadline crossed after page load rejects
  that stage mutation; submitted work remains review-only, while incomplete expired
  work exposes no lesson payload.
- Before `publish_at`, direct learner reads and every mutation expose no lesson
  payload and persist no evidence; the canonical open state begins at the timestamp.

## Success criteria

- Package validation reports 30/30 publish-ready lessons, 720 words, all required
  activities, and no unapproved or checksum-mismatched media.
- Import verification reports 30 assignment-only banks with 48 practice questions
  per bank and no default score policy.
- Backend, frontend, browser, migration/RLS, staging smoke, and production smoke
  gates pass on the exact promoted SHA.
- Admin and learner views agree after immediate actions and full reload.

## Open questions

- Public discovery and self-enrolment will be specified as a separate expansion
  after assignment-only production evidence is stable.
- Approval record: the product owner confirmed the core-30, assignment-only,
  no-default-grading scope on 2026-09-15 before replacement implementation work.
