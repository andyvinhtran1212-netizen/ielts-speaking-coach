# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_grammar_diagnostic_api.py | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_grammar_diagnostic_service.py | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_grammar_diagnostic_service.py | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_grammar_diagnostic_api.py | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_grammar_diagnostic_importer.py | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_grammar_diagnostic_importer.py | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_migration_283_master30_grammar.py | PENDING |
| FR-008 | kind=test; ref=frontend/tests/grammar-diagnostic-ui.test.mjs | PENDING |

## Contract evidence

- OpenAPI/type drift and generated client contracts must pass on the implementation SHA.
- Existing class assignment, My Class, and grading behavior must remain unchanged.

## Data evidence

- Staging and production queries must prove exact package counts, active release hash,
  RLS policy presence, immutable guards, and the two expected runtime flag values.
- Concurrency tests must prove one winning session and one immutable final report.

## UI evidence

- Contract and browser tests cover both modes, responsive themes, keyboard focus,
  loading/error/permission states, completion, reload, and educator visibility.
- Copy must state structural readiness and no default grading, without IELTS band claims.

## Release evidence

- Staging exact-SHA CI, deployment provenance, assigned journey, and flag query: pending.
- Production migration, content verification, deployment, smoke, and flags: pending.
