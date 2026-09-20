# Verification

Evidence below describes candidate `44d2941f8` and its ancestors. Local/offline
checks do not substitute for database-backed RLS, staging, or production evidence;
those gates remain explicitly pending.

## Latest local candidate evidence

| Gate | Evidence | Result |
| --- | --- | --- |
| Package builder/provenance/audio validators | 121/121 focused backend tests; includes exact 88-error overlay, immutable source inputs, Kokoro/audio, generated package, and importer contracts | PASS |
| Committed core-30 snapshot | `backend/scripts/import_advanced_vocab_core30.py` dry-run; 30/30 lessons valid, 24 cards and 48 selected Practice questions per lesson | PASS |
| Advanced frontend/model contracts | 47/47 tests across Advanced Vocabulary, `whenGlobalReady`, browser-workflow wiring, path coverage, and post-merge gates | PASS |
| Production frontend artifact | `npm run build`; Next 16 compiled, type-checked, and generated all 142 routes including `/advanced-vocabulary` | PASS |
| Hermetic learner browser journey | `frontend/tooling/verify-advanced-vocabulary-flow.mjs`; real production build covers keyboard card interaction, 44 px audio target, independent Reading panes, mobile tab keyboard behavior, reference-only Writing/Speaking, and recoverable normalized load error | PASS |
| Database/RLS/concurrency lifecycle | No database-backed Advanced RLS integration test or exact-SHA staging evidence exists yet | PENDING |
| Production release | Requires completed database gate, exact-SHA staging evidence, and explicit owner go/no-go | PENDING |

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_advanced_vocab_importer.py, backend/tests/test_course_assignment.py, backend/tests/test_quiz_service.py, frontend/tests/admin-class-homework-next-behavior.test.mjs; gap=direct anon/authenticated database-policy proof | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_advanced_vocab_service.py, backend/tests/test_class_student_page.py, frontend/tests/my-class-next-behavior.test.mjs; gap=persistence-time membership/deadline and live reload journey | PENDING |
| FR-003 | kind=command; ref=pytest backend/tests/test_advanced_vocab_audio_builder.py backend/tests/test_advanced_vocab_package_builder.py backend/tests/test_advanced_vocab_package_validator.py backend/tests/test_advanced_vocab_importer.py | PASS |
| FR-004 | kind=test+browser; ref=backend/tests/test_advanced_vocab_service.py, frontend/tests/advanced-vocabulary-next-behavior.test.mjs, frontend/tooling/verify-advanced-vocabulary-flow.mjs; gap=database-backed pre/post-reveal journey | PENDING |
| FR-005 | kind=test+browser; ref=backend/tests/test_advanced_vocab_service.py, backend/tests/test_course_assignment.py, frontend/tests/advanced-vocabulary-next-behavior.test.mjs, frontend/tooling/verify-advanced-vocabulary-flow.mjs; gap=direct stale-client rejection plus teacher-Writing persistence proof | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_advanced_vocab_service.py, backend/tests/test_course_assignment.py, backend/tests/test_quiz_service.py, backend/tests/test_course_attempt_report.py, frontend/tests/my-class-next-behavior.test.mjs, frontend/tests/admin-class-homework-next-behavior.test.mjs, frontend/tests/admin-class-student-work-next-behavior.test.mjs, frontend/tests/advanced-vocabulary-next-behavior.test.mjs; gap=atomic terminal state, archive/deadline races, and immediate-versus-reload staging proof | PENDING |
| FR-007 | kind=missing; ref=none; gap=database-backed RLS, trigger, replay, rollback, and concurrency suite | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_advanced_vocab_service.py, backend/tests/test_course_assignment.py, backend/tests/test_advanced_vocab_importer.py, backend/tests/test_quiz_import.py, frontend/tests/admin-class-homework-next-behavior.test.mjs, frontend/tests/admin-vocab-topics-quiz-next-behavior.test.mjs; gap=bank-lock/delete-guard and v1-assignment/v2-bank database journey | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_advanced_vocab_service.py, frontend/tests/advanced-vocabulary-next-behavior.test.mjs; gap=persisted Practice-selection schema and lost-response database proof | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_advanced_vocab_importer.py, backend/tests/test_course_assignment.py, frontend/tests/admin-class-homework-next-behavior.test.mjs | PENDING |
| FR-011 | kind=check; ref=specs/0002-advanced-vocabulary-self-paced/evidence/controlled-rewrite-feedback-eval.md | PENDING |

## Contract evidence

- Source provenance (local pass): committed `source-inputs-manifest.json` records
  product-owner origin/rights, canonical locked revisions, and complete
  path/digest/role/lesson mappings for authored, supplement, Kokoro, and media
  inputs. Package-validator tests reject missing, byte-substituted, recertified, and
  undeclared release inputs and cross-check the deploy snapshot. Reproducing the
  locked package from the mutable Downloads copy is not release evidence; deployment
  uses the committed immutable snapshot.
- OpenAPI/type drift: pending named request/response model generation, Next consumer
  use of generated operation types, and exact implementation SHA CI.
- My Class admission: pending generated start-response discriminator tests proving
  the frozen Advanced snapshot routes untouched, partial, completed, and reloaded
  items to the dedicated shell, while ordinary course responses and
  `/course-exercises` routing remain unchanged. Unknown discriminators must not fall
  through to either player.
- Backward compatibility: pending legacy-route isolation, frozen-version tests,
  existing course retry/report regression tests, and an integration journey that
  assigns v1, imports a changed v2 bank, and proves learner, submission, resume, and
  admin-result reads still use the v1 content and checksum-bound assets. Rollback
  rehearsal must archive assignments first and prove both dedicated and legacy routes
  remain unavailable before and after the runtime revert.

## Data evidence

- Migration/schema query: pending staging and production policy inspection plus
  database-backed attempt-number enforcement, cross-attempt duplicate rejection,
  identical/different replay, concurrent finalizer, injected rollback, and complete-
  versus-partial pilot reconciliation cases.
- Immediate state versus full reload: pending learner/admin staging journey.
- Submission isolation: pending direct and stale-client API calls proving Advanced
  Vocabulary Writing/Speaking requests create neither submission nor grading-job
  rows, while a distinct teacher-created Writing assignment remains submittable.
- Stage ordering: pending out-of-order start/answer calls before every predecessor,
  followed by the accepted in-order journey and canonical reload comparison.
- Practice start idempotency: pending first start, lost response after commit,
  identical retry, and lesson reload for Practice 1 and Practice 2; every path must
  return the same persisted selection, and out-of-selection answer IDs must fail.
- Assignment-only boundary: pending admin API/UI assignment of each Advanced bank
  with immediate and full-reload state equality, plus unauthenticated/public listing
  exclusion and generic quiz-play denial before and after assignment. Database-backed
  tests must query `quiz_banks` directly as anon and authenticated roles after import,
  observe no Advanced rows/meta, retain ordinary bank reads, and inventory policies to
  prove no permissive alternate SELECT path; service-role assignment/admin reads must
  still resolve the Advanced banks.
- Course association: pending a database query that resolves the unique `C5` course
  UUID and proves exactly 30 Advanced banks use it, with zero Advanced banks attached
  to `C4`, another course, or `NULL`; importer tests must reject missing/ambiguous `C5`
  and wrong/null associations. Assignment API/UI evidence must prove only a `C5`
  cohort can discover and issue these banks and that bank, frozen snapshot, immediate
  admin state, and full reload retain the same persisted `C5` UUID.
- Access cutoff races: pending removal and transfer both before first open and between
  partial stages, direct requests before/at/after `publish_at`, plus deadline crossing
  between page load and every mutation. Each case must reject at persistence time
  with no subsequent write/reload access; no scheduled content/evidence exists before
  release, and submitted-after-deadline reopens persisted review only with
  `accepting:false`.
- Archive lifecycle: pending archive, blocked learner reload, preserved admin reload,
  republish before expiry, and learner resume from the original canonical stage;
  republish after expiry for an incomplete item must remain blocked until an explicit
  deadline extension, while a terminal submitted item may republish with unchanged
  `due_at` and only persisted review with `accepting:false`.
  Every partial-evidence store must make the homework list render Archive instead of
  Delete both immediately and after reload.
- Protected bank lifecycle: pending direct/admin deletion after partial and completed
  Advanced work must return 409 before cascade, preserve every evidence row, and keep
  learner/admin reloads resolvable from the assignment snapshot. Unpublish/archive
  must hide the bank from new assignment selection without breaking existing work.
- Completion projection: pending finalizer evidence that `submitted_at` and
  `passed_at` share the terminal timestamp and item `state='submitted'` while `score`
  stays null, plus the shared
  course-action/My Class Review state immediately and after full reload. Shared admin
  tally/detail evidence must show neutral `completed`/Hoàn tất, `latest_pct=null`, no
  score or pass count, and no scored-ledger mismatch immediately and after reload.
- Archive serialization: pending barrier-controlled database/API races with the
  active-membership row acquired before assignment and item rows. Verify mutation-
  first commits evidence before remove/transfer/archive closes access; each revocation-
  first order rejects the later mutation. Immediate and full-reload learner/admin
  access and evidence agree for all six orders.
- Bank snapshot serialization: pending barrier-controlled import-versus-assignment
  races on the shared bank-scoped lock. Verify import-first creates a wholly new
  frozen snapshot and assignment-first creates a wholly old snapshot; neither order
  may combine metadata, authored payload, or question rows from different revisions.
  Force both unpublish-versus-assignment orders on the same lock: unpublish-first must
  make issuance fail its final `is_published` recheck, while issuance-first commits
  before unpublish returns. Force both default-import-versus-unpublish orders and prove
  import preserves the locked publication state, so retirement wins in either order;
  initial Advanced import with omission creates an unpublished bank while an ordinary
  import retains its existing published default. Verify the unchanged route, multipart
  file plus query-parameter OpenAPI operation, existing dry-run/commit browser flow,
  explicit `published` and `unpublished`, invalid-value 422 with no mutation, and both explicit-directive-
  versus-retirement orders; the later lock holder's intentional state wins.
  The persisted bank state, assignment list, and bank picker must agree after reload.
- Admin retirement UI: pending behavior/browser coverage for successful retirement,
  rejected mutation with no optimistic stale state, immediate list/picker agreement,
  full-reload agreement, and continued access to every existing pinned assignment.
- Timing truth: pending capped per-question Practice response time and Reading/
  Listening duration persistence, idempotent retry totals, untimed Vocabulary/rewrite
  completion timestamps, and matching learner/admin reload projections without
  fabricated wall-clock values.
- Controlled Rewrite persistence: pending exact-20-ID/non-empty validation, atomic
  immutable answer-map storage before reveal, exactly one model request, persisted
  feedback/model/prompt provenance, identical replay/reload, changed-replay conflict,
  and provider-failure evidence that answers and solutions remain available, learner
  progress continues, and no second request is made.

## Controlled Rewrite quality evidence

- Gold cohort: pending 60 synthetic or de-identified immutable submissions, two for
  each T01-T30 lesson, containing 1,200 answer-level items split evenly between 600
  acceptable answers and 600 human-labeled grammar/style errors. Two qualified
  reviewers label expected findings independently and adjudicate disagreements; the
  versioned dataset checksum and rubric are recorded with the exact implementation
  SHA in `evidence/controlled-rewrite-feedback-eval.md`.
- Baselines: pending the solutions-only fallback baseline (100% solution availability,
  zero generated-feedback coverage) and the frozen first prompt/model candidate. The
  release report compares both, but absolute FR-011 thresholds remain mandatory and
  cannot be waived by relative improvement.
- Release metrics: pending 100% schema-valid one-call persistence; false-positive rate
  at or below 5% of acceptable answers; claim precision at or above 90%; coverage at
  or above 85% of error-bearing answers; zero invented quotations; meaning-changing
  or harmful corrections at or below 1%; p95 feedback latency at or below 20 seconds;
  p95 estimated model cost at or below USD 0.10 per 20-answer submission; and total
  estimated cost at or below USD 6.00 for the 60-call evaluation.
- Failure/fallback: pending forced timeout, provider error, malformed response, and
  persistence-reload cases proving the immutable answers and reference solutions
  survive, status/error code are sanitized and stable, progression remains available,
  and no automatic or replay-triggered second model call occurs.

## UI evidence

- Viewports/themes/input methods: pending Next.js browser regression, explicit
  no-microphone/no-submission assertion, every required-stage interruption/resume
  state, Practice pre/post-attempt and controlled-rewrite pre/post-completion leakage
  assertions (including failed/pending/accepted/reloaded rewrite completion), Reading
  and Listening pre/post-submit assertions, a lost-response/reload boundary between
  Listening attempt 1 and guided retry, and manual staging review.
- Vocabulary completion: pending interruption before request, during pending, and
  after server acceptance; exact 24-ID acceptance; partial/malformed 422; stale 409;
  network/identical retry; focus recovery; and reload reconstruction with no optimistic
  stage advance.
- Authorization: pending direct-navigation and reload checks for unauthenticated,
  wrong-assignee, archived-assignment, and authenticated non-admin identities, with
  no protected payload or admin mutation action exposed.

## Release evidence

- Staging SHA and checks: pending implementation merge, exact-SHA integrated CI/live
  Staging E2E evidence, and an immediately pre-promotion `Staging promotion gate`
  proving staging HEAD is still that SHA.
- Quality gate: pending the versioned Controlled Rewrite evaluation report on that
  exact staging SHA with every FR-011 threshold passing and reviewer sign-off; a
  missing report, threshold failure, dataset drift, or cost overrun blocks promotion.
- Production verification: pending staging-to-main promotion.
