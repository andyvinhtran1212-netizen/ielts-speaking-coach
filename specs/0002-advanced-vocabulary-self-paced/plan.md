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
- Learner payloads whitelist public Reading/Listening fields; answer keys are
  attached only to persisted post-submission review evidence.
- Writing and Speaking contracts explicitly disable default grading/submission.

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
- Implement backend canonical persistence and admin result projection.
- Implement learner/admin UI integration and regression tests.
- Land generated content separately from runtime code so governance and review
  evidence remain tractable.

## Rollout and rollback

- Merge approved spec, validation foundation, then inert authored content.
- Apply the reviewed runtime migration to staging before merging dependent code;
  then run exact-SHA integrated checks, import 30 banks, and
  execute learner/admin smoke before staging-to-main promotion.
- Apply the additive migration in production before code promotion, then import and
  verify the same 30 banks after production smoke.
- Roll back application code without dropping additive tables; disable/remove bank
  assignments to stop access while preserving historical evidence.

## Verification strategy

- Run focused Advanced Vocabulary backend and frontend suites plus full repository CI.
- Validate package checksums, immutable version assets, 88 supplements, 720 cards,
  30 banks, and 1,440 imported practice rows.
- Query staging/production schema and RLS policy truth before import.
- Record exact staging SHA, learner completion journey, admin result reload, and
  production health/smoke outcomes.
