# Verification

Pre-implementation evidence remains pending until the approved spec is present
on staging and replacement implementation commits are created from that base.

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_advanced_vocab_importer.py | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_advanced_vocab_service.py | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_advanced_vocab_audio_builder.py, backend/tests/test_advanced_vocab_package_validator.py, backend/tests/test_advanced_vocab_importer.py | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_advanced_vocab_service.py, frontend/tests/advanced-vocabulary-next-behavior.test.mjs | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_advanced_vocab_service.py, backend/tests/test_course_assignment.py, frontend/tests/advanced-vocabulary-next-behavior.test.mjs | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_advanced_vocab_service.py, frontend/tests/admin-class-homework-next-behavior.test.mjs, frontend/tests/advanced-vocabulary-next-behavior.test.mjs | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_advanced_vocab_rls_integration.py | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_advanced_vocab_service.py, backend/tests/test_course_assignment.py | PENDING |

## Contract evidence

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
- Archive lifecycle: pending archive, blocked learner reload, preserved admin reload,
  republish, and learner resume from the original canonical stage. Every partial-
  evidence store must make the homework list render Archive instead of Delete both
  immediately and after reload.
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

- Staging SHA and checks: pending implementation merge.
- Production verification: pending staging-to-main promotion.
