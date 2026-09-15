# Implementation plan

## Architecture impact

- Add a FastAPI Advanced Vocabulary service/router and admin reporting endpoints.
- Add a Next.js learner route and reuse the existing assignment/admin surfaces.
- Store canonical authored lessons under backend content and immutable media under
  the frontend public asset tree.
- Keep legacy quiz/session routes unable to reveal or mutate this runtime.

## Data and contracts

- Migration 263 creates only the Advanced Vocabulary stage-progress,
  per-question-attempt, and Listening-attempt tables. It reuses the existing
  `course_section_submissions` table as canonical Reading/Listening evidence and
  extends it idempotently with the Advanced Vocabulary finalization trigger.
- Quiz-bank metadata publishes runtime kind, lesson ID, content checksum, required
  stages, practice IDs, and the explicit no-score policy. Assignment creation copies
  that runtime metadata into `class_assignments.content_config.runtime`; every learner,
  submission, resume, and admin-result read resolves the immutable assignment snapshot
  rather than the bank's current metadata. Re-importing a v2 bank therefore leaves an
  already-issued v1 assignment bound to its v1 JSON and checksum-matched media.
- Learner payloads whitelist public Practice, controlled-rewrite, Reading, and
  Listening fields. Practice answers, accepted variants, explanations, correction
  notes, and other answer-bearing fields remain absent until that individual
  immutable answer is accepted. Controlled rewrite initially exposes prompt IDs and
  prompts only; its reference solutions are attached only after persisted completion.
  Reading/Listening keys are attached only to persisted post-submission review
  evidence. The generic quiz-player route cannot serve these banks.
- Writing and Speaking contracts explicitly disable default grading/submission.
- Advanced Vocabulary adds a database guard independent of the generic course-section
  retry key `(class_assignment_item_id, attempt_no, section)`. Before a Reading or
  Listening insert, it locks the assignment item, requires `attempt_no = 1`, and
  rejects any pre-existing row for the same item/section even if another caller sends
  a different attempt number. At the application boundary, an identical normalized
  payload resolves to that existing row and a different payload conflicts.
- The accepted Listening insert invokes one database finalizer in the same
  transaction and while retaining the assignment-item lock. The finalizer verifies
  all six canonical evidence sets, reads lesson identity from the assignment runtime
  snapshot, and stamps submission/mastery with no overall score. Any failed check or
  injected finalizer error rolls back the Listening section insert and assignment
  update together; concurrent calls serialize without a second section row.
- Migration 263 performs an idempotent reconciliation of complete pilot items that
  predate the trigger. It derives completion only from all required canonical stage
  and section rows, preserves the earliest existing submission timestamps, and
  leaves partial items resumable. Because all post-migration finalization writes are
  atomic, this migration reconciliation is the only legacy repair path required.
- Any Advanced Vocabulary stage, question-attempt, first-Listening-attempt, or
  course-section row makes the assignment item non-deletable. The admin surface must
  treat that partial evidence as real learner work and offer only the existing
  archive/retire behavior; archiving preserves the item and all evidence, and learner
  and admin reloads continue to resolve the same progress.

## UI and interaction

- The learner route renders vocabulary cards consistent with the existing design
  system and supplies keyboard-accessible audio controls.
- Reading uses independently scrollable passage and question panes; Speaking and
  Writing use scannable reference panels with clear ungraded labels.
- Loading, empty, permission, validation, retry, responsive, dark-mode, and resume
  states follow the matrix in ui-states.md.

## Work decomposition

- Establish pure package validation and immutable source/media checks first.
- Validate and land the exact inert content snapshot against those checks.
- Review the runtime candidate, then apply and verify its backward-compatible
  schema/RLS migration on staging before merging code that depends on it.
- Implement backend canonical persistence and admin result projection together with
  their service/API, migration/RLS, replay/concurrency, and backend regression tests;
  do not merge that layer until its exact SHA passes.
- Implement learner/admin UI integration together with model, behavior, browser,
  accessibility, responsive, interruption/resume, and reveal-boundary tests; do not
  merge that layer until its exact SHA passes.
- Land generated content separately from runtime code so governance and review
  evidence remain tractable.

## Rollout and rollback

- Merge approved spec, validation foundation, then inert authored content.
- Apply the reviewed runtime migration to staging before merging dependent code;
  then run exact-SHA integrated checks, import 30 banks, and
  execute learner/admin smoke before staging-to-main promotion.
- Apply the additive migration in production before code promotion, then import and
  verify the same 30 banks after production smoke.
- Before rolling back application code, activate the assignment kill switch by
  archiving every active Advanced Vocabulary assignment and verify both the dedicated
  and legacy quiz routes return no learner payload. Only then revert the runtime;
  retain additive tables and all historical evidence.

## Verification strategy

- Run focused Advanced Vocabulary backend and frontend suites plus full repository CI.
- Validate package checksums, immutable version assets, 88 supplements, 720 cards,
  30 banks, and 1,440 imported practice rows.
- Query staging/production schema and RLS policy truth before import.
- Record exact staging SHA, learner completion journey, admin result reload, and
  production health/smoke outcomes.
