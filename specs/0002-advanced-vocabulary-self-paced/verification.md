# Verification

Pre-implementation evidence remains pending until the approved spec is present
on staging and replacement implementation commits are created from that base.

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_advanced_vocab_importer.py, backend/tests/test_course_assignment.py, backend/tests/test_quiz_service.py, frontend/tests/admin-class-homework-next-behavior.test.mjs | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_advanced_vocab_service.py | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_advanced_vocab_audio_builder.py, backend/tests/test_advanced_vocab_package_builder.py, backend/tests/test_advanced_vocab_package_validator.py, backend/tests/test_advanced_vocab_importer.py | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_advanced_vocab_service.py, frontend/tests/advanced-vocabulary-next-behavior.test.mjs | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_advanced_vocab_service.py, backend/tests/test_course_assignment.py, frontend/tests/advanced-vocabulary-next-behavior.test.mjs | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_advanced_vocab_service.py, backend/tests/test_quiz_service.py, backend/tests/test_course_attempt_report.py, frontend/tests/my-class-next-behavior.test.mjs, frontend/tests/admin-class-homework-next-behavior.test.mjs, frontend/tests/admin-class-student-work-next-behavior.test.mjs, frontend/tests/advanced-vocabulary-next-behavior.test.mjs | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_advanced_vocab_rls_integration.py | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_advanced_vocab_service.py, backend/tests/test_course_assignment.py | PENDING |

## Contract evidence

- Source provenance: pending committed `source-inputs-manifest.json` with product-owner
  origin/rights, canonical manifest digest, and complete path/digest/role/lesson mapping
  for authored, supplement, Kokoro, and media inputs. Builder tests must replace one
  byte, remove one input, and add one undeclared release input and prove validation
  fails before any deploy snapshot is written; package tests cross-check embedded
  lesson provenance against the manifest.
- OpenAPI/type drift: pending named request/response model generation, Next consumer
  use of generated operation types, and exact implementation SHA CI.
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
- Assignment-only boundary: pending admin API/UI assignment of each Advanced bank
  with immediate and full-reload state equality, plus unauthenticated/public listing
  exclusion and generic quiz-play denial before and after assignment.
- Access cutoff races: pending removal and transfer both before first open and between
  partial stages, direct requests before/at/after `publish_at`, plus deadline crossing
  between page load and every mutation. Each case must reject at persistence time
  with no subsequent write/reload access; no scheduled content/evidence exists before
  release, and submitted-after-deadline reopens persisted review only with
  `accepting:false`.
- Archive lifecycle: pending archive, blocked learner reload, preserved admin reload,
  republish before expiry, and learner resume from the original canonical stage;
  republish after expiry must remain blocked until an explicit deadline extension.
  Every partial-evidence store must make the homework list render Archive instead of
  Delete both immediately and after reload.
- Completion projection: pending finalizer evidence that `submitted_at` and
  `passed_at` share the terminal timestamp while `score` stays null, plus the shared
  course-action/My Class Review state immediately and after full reload. Shared admin
  tally/detail evidence must show neutral `completed`/Hoàn tất, `latest_pct=null`, no
  score or pass count, and no scored-ledger mismatch immediately and after reload.
- Archive serialization: pending barrier-controlled database/API races with the
  assignment-row lock acquired before the item row. Verify mutation-first commits
  evidence before archive closes access; archive-first rejects the later mutation;
  immediate and full-reload learner/admin states agree in both orders.
- Timing truth: pending capped per-question Practice response time and Reading/
  Listening duration persistence, idempotent retry totals, untimed Vocabulary/rewrite
  completion timestamps, and matching learner/admin reload projections without
  fabricated wall-clock values.

## UI evidence

- Viewports/themes/input methods: pending Next.js browser regression, explicit
  no-microphone/no-submission assertion, every required-stage interruption/resume
  state, Practice pre/post-attempt and controlled-rewrite pre/post-completion leakage
  assertions (including failed/pending/accepted/reloaded rewrite completion), Reading
  and Listening pre/post-submit assertions, a lost-response/reload boundary between
  Listening attempt 1 and guided retry, and manual staging review.
- Authorization: pending direct-navigation and reload checks for unauthenticated,
  wrong-assignee, archived-assignment, and authenticated non-admin identities, with
  no protected payload or admin mutation action exposed.

## Release evidence

- Staging SHA and checks: pending implementation merge, exact-SHA integrated CI/live
  Staging E2E evidence, and an immediately pre-promotion `Staging promotion gate`
  proving staging HEAD is still that SHA.
- Production verification: pending staging-to-main promotion.
