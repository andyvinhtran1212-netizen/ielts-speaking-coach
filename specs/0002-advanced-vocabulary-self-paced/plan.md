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
- The content snapshot includes `source-inputs-manifest.json`, whose canonical digest
  is the source revision for the owner-provided local export. It maps every consumed
  authored/supplement/Kokoro/media input path to SHA-256, role, and lesson IDs and
  records product ownership/use rights. The builder verifies the actual source tree
  against this manifest before generation; package validation cross-checks every
  lesson's embedded provenance and media reference against the same manifest, so an
  input substitution fails before content landing or database import.
- A database `BEFORE DELETE` guard on `quiz_banks` rejects deletion of an Advanced
  bank when any class assignment snapshot references it or an immutable content
  version exists, preventing the existing course-section cascade from erasing
  evidence. The admin delete route returns a stable 409 and offers unpublish/archive;
  that action removes the bank from new-assignment selection but existing assignments
  continue to resolve their frozen runtime/content and canonical results.
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
  transaction and while retaining the assignment and assignment-item locks. The
  finalizer verifies all six canonical evidence sets, reads lesson identity from the
  assignment runtime snapshot, and stamps `submitted_at` and `passed_at` to the same
  completion timestamp while keeping `score = NULL`. For this no-score runtime,
  `passed_at` is the existing canonical terminal-completion marker, not a numeric pass
  verdict; the shared course-action projection must therefore return `review` both
  immediately and after reload. The shared admin summary detects the Advanced runtime
  snapshot and projects neutral `state=completed`, `latest_pct=null`, no score/pass
  tally, and no `course_ledger_mismatch`, both in list/tally and detail views. Any
  failed check or injected finalizer error rolls back the Listening section insert
  and assignment update together; concurrent calls serialize without a second
  section row.
- Migration 263 performs an idempotent reconciliation of complete pilot items that
  predate the trigger. It derives completion only from all required canonical stage
  and section rows, preserves the earliest existing submission timestamps, and
  leaves partial items resumable. Because all post-migration finalization writes are
  atomic, this migration reconciliation is the only legacy repair path required.
- Any Advanced Vocabulary stage, question-attempt, first-Listening-attempt, or
  course-section row makes the assignment item non-deletable. The admin surface must
  treat that partial evidence as real learner work and offer only the existing
  archive/retire behavior. Archiving preserves the item and all evidence: admin reload
  continues to show canonical progress, learner routes become unavailable as the kill
  switch requires, and republishing restores learner access at the persisted stage
  only if the deadline remains open (otherwise an admin must explicitly extend it).
- Every learner read and mutation resolves the assignment item through its assignment,
  student, and active cohort membership; retaining a historical item after removal or
  transfer grants no access. Every evidence write, including the final Listening
  transaction, rechecks published status, `publish_at`, active membership, and
  `due_at` at database persistence time so a page opened before a schedule boundary,
  removal, or deadline cannot write afterward. Reads use the same canonical open-state
  check. Membership/identity mismatch and a not-yet-published item use the canonical
  non-enumerating 404. An incomplete item after deadline returns the stable deadline
  conflict and no lesson payload; a submitted item may reopen only its persisted
  review with `accepting:false` and no mutation controls.
- Every Advanced Vocabulary evidence transaction locks the active
  `student_cohort_memberships` row, then the parent `class_assignments` row, then the
  `class_assignment_items` row; only then does it revalidate the open-state guard and
  write evidence. Membership removal/transfer must update the same membership row,
  while archive/republish uses the same transactional assignment-row lock and shared
  ordering. These operations therefore serialize with learner mutations: an access-
  revocation winner permits no later evidence, while a mutation winner commits before
  removal/transfer/archive returns and closes access.

## API contract

All learner routes require the bearer-authenticated assignment owner; the admin route
requires an admin bearer. UUID path/query/body identities are server-validated. Named
Pydantic request and response models must generate matching operations in
`frontend/types/api.d.ts`, and the Next.js client must derive its normalization types
from those generated operations rather than maintain a parallel wire schema.

| Method and route | Request | Success response |
| --- | --- | --- |
| `GET /api/advanced-vocab/lessons/{bank_id}?item={item_id}` | UUID path/query | `LessonView`: bank `{id,code,title}`, assignment `{item_id,due_at,accepting,submitted_at,passed_at}`, lesson `{lesson_id,title,topic_code,objectives,vocabulary,practice,activities}`, and canonical `Progress` |
| `POST /api/advanced-vocab/vocabulary/complete` | `{bank_id,item_id,seen_lexeme_ids[]}` | canonical `Progress` |
| `POST /api/advanced-vocab/practice/start` | `{bank_id,item_id,stage: practice_1|practice_2}` | canonical `Progress` |
| `POST /api/advanced-vocab/practice/answer` | `{bank_id,item_id,stage,qid,answer,response_time_ms?}` | `{qid,answer,is_correct,explanation?,note?,completed,progress}` for that accepted immutable answer |
| `POST /api/advanced-vocab/reading` | `{bank_id,item_id,answers:{qid:value},duration_sec}` | `SectionReview` `{section,total,correct,pct,submitted_at,answer_results,answers}` |
| `POST /api/advanced-vocab/controlled-rewrite/complete` | `{bank_id,item_id,attempted_item_ids[]}` | `{solutions,progress}` only after canonical completion |
| `POST /api/advanced-vocab/listening` | `{bank_id,item_id,answers:{qid:value},duration_sec}` | first-attempt review with `requires_guided_retry`, incomplete assignment state, and canonical `Progress`; a non-retry activity may return final `SectionReview` |
| `POST /api/advanced-vocab/listening/guided-retry` | `{bank_id,item_id,answers:{wrong_qid:value}}` | final review with initial and retry evidence, `{completed,pct:null}`, and canonical `Progress` |
| `GET /admin/advanced-vocab/assignments/{assignment_id}/results` | UUID path | `AdminResults`: assignment/bank snapshot, `lesson_id`, `score_policy:none`, six required stages, reference-only markers, and per-student item/stage/practice/section/Listening evidence |

`Progress` contains `completed_stages`, persisted stage rows, immutable Practice
answers, submitted section reviews, `listening_submitted`, and `required_completed`.
After the immutable first Listening attempt but before guided retry, it also contains
`listening_pending_retry: {initial_answer_results, required_retry_ids}` reconstructed
from `advanced_vocab_listening_attempts`; this lets a lost response or reload render
exactly the remaining wrong-question inputs without resubmitting or exposing answers
for other questions. The field is absent before the first attempt and after the
canonical Listening section exists. Pre-reveal `LessonView` follows the field
projections above; post-reveal answer fields exist only in the accepted mutation
response and persisted review. Writing and Speaking have no submission route in this
router, and generic submission routes must reject this runtime while leaving teacher-
created Writing assignments unchanged.

Stable failures are: 401 unauthenticated; 403 non-admin on the admin route; 404 wrong
assignee, inactive/transferred membership, scheduled/not-yet-published, archived/
unknown item, or non-Advanced bank; 409 `deadline_passed`, unmet predecessor, frozen-
version mismatch, protected-bank deletion, immutable-answer conflict, or already-
submitted different payload; 422 invalid/missing IDs or required answers; and
sanitized 500 persistence/content failure. Existing non-Advanced course route schemas
and behavior remain unchanged.

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
  generate the OpenAPI declaration and do not merge that layer until its exact SHA and
  API drift check pass.
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
- Immediately before staging-to-main merge, run the repository `Staging promotion
  gate` and record that staging HEAD is unchanged from the SHA owning both the exact-
  SHA integrated checks and live Staging E2E evidence.
- Apply the additive migration in production before code promotion, then import and
  verify the same 30 banks after production smoke.
- Before rolling back application code, activate the assignment kill switch by
  archiving every active Advanced Vocabulary assignment and verify both the dedicated
  and legacy quiz routes return no learner payload. Only then revert the runtime;
  retain additive tables and all historical evidence. Before any republish, deploy a
  known-good guarded runtime at a recorded SHA, verify dedicated and legacy-route
  isolation plus assignment open-state guards on that SHA, repair/import canonical
  banks, and only then re-enable an assignment whose deadline is open or extended.

## Verification strategy

- Run focused Advanced Vocabulary backend and frontend suites plus full repository CI.
- Validate the source-input manifest/revision, package checksums, immutable version
  assets, 88 supplements, 720 cards, 30 banks, and 1,440 imported practice rows.
- Query staging/production schema and RLS policy truth before import.
- Record exact staging SHA, learner completion journey, admin result reload, and
  production health/smoke outcomes.
