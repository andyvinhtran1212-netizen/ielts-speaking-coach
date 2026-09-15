# Verification

Pre-implementation evidence remains pending until the approved spec is present
on staging and replacement implementation commits are created from that base.

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_advanced_vocab_importer.py | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_advanced_vocab_service.py | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_advanced_vocab_audio_builder.py | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_advanced_vocab_package_validator.py | PENDING |
| FR-005 | kind=test; ref=frontend/tests/advanced-vocabulary-next-behavior.test.mjs | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_advanced_vocab_service.py | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_advanced_vocab_rls_integration.py | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_advanced_vocab_package_validator.py | PENDING |

## Contract evidence

- OpenAPI/type drift: pending exact implementation SHA CI.
- Backward compatibility: pending legacy-route isolation, frozen-version tests,
  and existing course retry/report regression tests.

## Data evidence

- Migration/schema query: pending staging and production policy inspection plus
  database-backed identical/different replay, concurrent finalizer, injected
  rollback, and complete-versus-partial pilot reconciliation cases.
- Immediate state versus full reload: pending learner/admin staging journey.

## UI evidence

- Viewports/themes/input methods: pending Next.js browser regression, explicit
  no-microphone/no-submission assertion, every required-stage interruption/resume
  state, Practice pre/post-attempt leakage assertions, and manual staging review.

## Release evidence

- Staging SHA and checks: pending implementation merge.
- Production verification: pending staging-to-main promotion.
