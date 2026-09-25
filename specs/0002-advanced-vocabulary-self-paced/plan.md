# Implementation plan

## Architecture impact

- Add a FastAPI Advanced Vocabulary service/router and admin reporting endpoints.
- Add a Next.js learner route and reuse the existing assignment/admin surfaces.
- Store canonical authored lessons under backend content and immutable media under
  the frontend public asset tree.
- Keep legacy quiz/session routes unable to reveal or mutate this runtime.

## Data and contracts

- Migration 281 creates only the Advanced Vocabulary stage-progress,
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
- Migration 281 replaces `quiz_banks_public_read` with a role-equivalent select policy
  whose predicate excludes `meta.runtime.kind = 'advanced_vocab'`. Because permissive
  PostgreSQL policies combine with OR, the migration must inventory and test every
  select policy on this table, leaving no alternate anon/authenticated allow path;
  service-role backend/admin reads continue to bypass RLS and ordinary bank behavior
  is preserved.
- Learner payloads whitelist public Practice, controlled-rewrite, Reading, and
  Listening fields. Practice answers, accepted variants, explanations, correction
  notes, and other answer-bearing fields remain absent until that individual
  immutable answer is accepted. Controlled rewrite initially exposes prompt IDs and
  prompts only; its reference solutions are attached only after the exact 20-ID,
  non-empty answer map is atomically persisted as the immutable submission. That
  accepted write owns the one allowed batch feedback request. Provider failure is
  persisted beside the answers and solutions and does not create a retry path or
  prevent stage completion.
  Reading/Listening keys are attached only to persisted post-submission review
  evidence. The generic quiz-player route cannot serve these banks.
- The importer resolves the unique `courses.code = 'C5'` row before mutation, writes
  its UUID to every one of the 30 Advanced banks, and rejects missing, duplicate,
  `C4`, other-course, or null associations. Assignment discovery remains course-
  scoped, and assignment issuance snapshots the `C5` association with the runtime so
  immediate and reloaded admin state cannot drift from persisted bank truth.
- Controlled Rewrite feedback uses a versioned prompt/model pair and one request per
  immutable submission. Before release, an evaluation harness runs 60 synthetic or
  de-identified batch submissions (two per lesson, 1,200 answers: 600 acceptable and
  600 error-bearing) against dual-human annotations with adjudication. It freezes the
  first candidate as the comparison baseline and separately records the solutions-
  only fallback baseline. The report records dataset checksum, prompt/model versions,
  schema validity, claim precision, error coverage, acceptable-answer false-positive
  rate, invented quotations, and the answer-level harmful-correction rate (answers
  with one or more adjudicated harmful/meaning-changing corrections divided by all
  answers receiving at least one generated correction, counting each answer once),
  plus p95 latency, token usage, and estimated cost. The absolute thresholds in
  FR-011 are mandatory; provider
  failure returns the persisted solutions-only fallback and never causes a second
  model call.
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
  section row. The atomic assignment update sets `state='submitted'`, `submitted_at`,
  and `passed_at` to the same terminal timestamp while keeping `score=NULL`.
- Migration 281 performs an idempotent reconciliation of complete pilot items that
  predate the trigger. It derives completion only from all required canonical stage
  and section rows, writes `state='submitted'` alongside terminal timestamps,
  preserves the earliest existing submission timestamps, and leaves partial items
  resumable. Because all post-migration finalization writes are atomic, this migration
  reconciliation is the only legacy repair path required.
- Practice start persists one immutable selected-question ID list in the canonical
  item/stage progress row under the same access locks. A repeated start returns that
  row and its original public question projection; it never selects again. Lesson
  reload reconstructs the same set, and answer mutations reject IDs outside it.
- Any Advanced Vocabulary stage, question-attempt, first-Listening-attempt, or
  course-section row makes the assignment item non-deletable. The admin surface must
  treat that partial evidence as real learner work and offer only the existing
  archive/retire behavior. Archiving preserves the item and all evidence: admin reload
  continues to show canonical progress, learner routes become unavailable as the kill
  switch requires, and republishing restores learner access at the persisted stage
  only if the deadline remains open. An incomplete expired item requires an explicit
  deadline extension; a terminal submitted item may be republished without changing
  `due_at` because it can only reopen as persisted review with `accepting:false`.
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
- The importer/version switch, publish-state mutation, and assignment issuance use
  dedicated database RPC transactions that acquire the same bank-scoped advisory
  lock. The importer replaces all revision-owned question rows and updates runtime
  metadata in one transaction. The existing `POST /admin/quiz/import` keeps multipart
  `file` and query parameters `topic_id`/`dry_run`; optional query parameter
  `publish_state` accepts `preserve`, `published`, or `unpublished` and defaults to
  `preserve`. An existing bank retains the state read under the lock, a new Advanced
  bank is created unpublished, a new ordinary bank retains today's published default,
  and an explicit state commits atomically with the revision. Invalid values return
  422 before mutation. Assignment issuance
  reads that metadata, revalidates `is_published` immediately before persistence, and
  writes the frozen assignment snapshot in one transaction. Barrier tests force both
  import/issuance commit orders and reject every mixed-revision snapshot; both default-
  import/unpublish orders must retain the admin's retired state; explicit directive/
  unpublish races follow lock order (the later committed state wins); and both unpublish/
  issuance orders prove unpublish-first rejects issuance while issuance-first completes
  before retirement. The assignment list, bank picker, and persisted bank state must
  agree after reload.

## API contract

All learner routes require the bearer-authenticated assignment owner; the admin route
requires an admin bearer. UUID path/query/body identities are server-validated. Named
Pydantic request and response models must generate matching operations in
`frontend/types/api.d.ts`, and the Next.js client must derive its normalization types
from those generated operations rather than maintain a parallel wire schema.

| Method and route | Request | Success response |
| --- | --- | --- |
| `POST /api/class/assignments/{item_id}/start` | UUID path | generated discriminated `ClassAssignmentStart` union; an Advanced snapshot returns `AdvancedVocabularyTarget` `{kind:advanced_vocabulary,item_id,assignment_id,bank_id,course_action,review_only}` while ordinary course responses remain `kind:course` |
| `GET /api/advanced-vocab/lessons/{bank_id}?item={item_id}` | UUID path/query | `LessonView`: bank `{id,code,title}`, assignment `{item_id,due_at,accepting,submitted_at,passed_at}`, lesson `{lesson_id,title,topic_code,objectives,vocabulary,practice,activities}`, and canonical `Progress` |
| `POST /api/advanced-vocab/vocabulary/complete` | `{bank_id,item_id,seen_lexeme_ids[]}` | canonical `Progress` |
| `POST /api/advanced-vocab/practice/start` | `{bank_id,item_id,stage: practice_1|practice_2}` | canonical `Progress` containing the persisted immutable selection and public question projection; identical replay returns the same selection |
| `POST /api/advanced-vocab/practice/answer` | `{bank_id,item_id,stage,qid,answer,response_time_ms?}` | `{qid,answer,is_correct,explanation?,note?,completed,progress}` for that accepted immutable answer |
| `POST /api/advanced-vocab/reading` | `{bank_id,item_id,answers:{qid:value},duration_sec}` | `SectionReview` `{section,total,correct,pct,submitted_at,answer_results,answers}` |
| `POST /api/advanced-vocab/controlled-rewrite/complete` | `{bank_id,item_id,answers:{rewrite_id:text}}` (exactly 20) | `{solutions,submission:{answers,feedback,status,model,prompt_version,error_code},progress}`; the first immutable submission makes one batch model call, identical replay returns persisted truth, and changed replay conflicts |
| `POST /api/advanced-vocab/listening` | `{bank_id,item_id,answers:{qid:value},duration_sec}` | first-attempt review with `requires_guided_retry`, incomplete assignment state, and canonical `Progress`; a non-retry activity may return final `SectionReview` |
| `POST /api/advanced-vocab/listening/guided-retry` | `{bank_id,item_id,answers:{wrong_qid:value}}` | final review with initial and retry evidence, `{completed,pct:null}`, and canonical `Progress` |
| `GET /admin/advanced-vocab/assignments/{assignment_id}/results` | UUID path | `AdminResults`: assignment/bank snapshot, `lesson_id`, `score_policy:none`, six required stages, reference-only markers, and per-student item/stage/practice/section/Listening evidence |
| `POST /admin/quiz/import?topic_id=&dry_run=&publish_state=` | multipart `{file}`; existing query parameters remain unchanged and optional `publish_state` is `preserve|published|unpublished` | import summary; omission preserves an existing bank, leaves a new Advanced bank unpublished, and preserves the existing published default for a new ordinary bank; invalid `publish_state` returns 422 with no mutation |

`Progress` contains `completed_stages`, persisted stage rows, immutable Practice
answers, the immutable Controlled Rewrite submission/feedback, submitted section
reviews, `listening_submitted`, and `required_completed`.
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

The shared start service derives `kind` only from
`class_assignments.content_config.runtime`, never the mutable current bank. The My
Class normalizer consumes the generated discriminated union: Advanced targets map to
`/advanced-vocabulary?bank={bank_id}&item={item_id}` for Start/Continue and the same
shell's persisted review state for Review; ordinary `kind:course` targets continue to
map to `/course-exercises` without behavioral change.

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
- Implement a reviewable backend runtime candidate for canonical persistence and
  admin result projection together with
  their service/API, migration/RLS, replay/concurrency, and backend regression tests;
  generate the OpenAPI declaration, and keep the candidate unmerged while its exact
  SHA passes API drift and the later Course-5 and feedback-quality gates.
- Implement and verify the `C5` lookup/import/assignment contract, including database
  queries proving exactly 30 Advanced banks own the resolved `C5` UUID and none own
  `C4`, another course, or `NULL` before any bank is published.
- Build the Controlled Rewrite gold-cohort harness and versioned evaluation report;
  freeze first-candidate and solutions-only baselines, exercise the provider-failure
  fallback, and run it against that exact unmerged runtime candidate. Block runtime
  merge until every FR-011 threshold passes within the stated 60-call cost budget.
- Merge the runtime only after the candidate SHA, `C5` association evidence, and
  FR-011 evaluation report have all passed review; publication/import remains a later
  staging operation.
- Implement learner/admin UI integration together with model, behavior, browser,
  accessibility, responsive, interruption/resume, and reveal-boundary tests; do not
  merge that layer until its exact SHA passes.
- Land generated content separately from runtime code so governance and review
  evidence remain tractable.

## Rollout and rollback

- Merge approved spec, validation foundation, then inert authored content.
- Apply the reviewed runtime migration to staging before merging dependent code;
  run the 60-submission evaluation against the exact unmerged candidate in the scoped
  evaluation environment and require every FR-011 threshold to pass; only then merge
  the runtime, run exact-SHA integrated checks, import 30 banks, and
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
  banks, and only then re-enable an incomplete assignment whose deadline is open or
  extended, or a terminal submitted assignment that remains review-only without a
  deadline mutation.

## Verification strategy

- Run focused Advanced Vocabulary backend and frontend suites plus full repository CI.
- Validate the source-input manifest/revision, package checksums, immutable version
  assets, 88 supplements, 720 cards, 30 `C5` banks, zero Advanced banks outside `C5`,
  and 1,440 imported practice rows.
- Run the versioned 60-submission Controlled Rewrite evaluation, compare the release
  candidate with both frozen baselines, and attach the threshold/cost report to the
  exact implementation SHA.
- Query staging/production schema and RLS policy truth before import.
- Record exact staging SHA, learner completion journey, admin result reload, and
  production health/smoke outcomes.
