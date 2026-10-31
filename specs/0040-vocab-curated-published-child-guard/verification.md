# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_vocab_curated_postgres.py (reparent cases) + backend/tests/test_migration_355_vocab_curated_guard_reparent.py; not written yet | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected; no route or response change.
- Backward compatibility: draft edits/deletes and published-version rejects
  keep their current results.

## Data evidence

- Migration/schema query: pending T002 (staging postcheck).
- Immediate state versus full reload: N/A, no UI.

## UI evidence

- No UI change (`ui-states.md`).

## Release evidence

- Staging SHA and checks: pending T002.
- Production verification: pending T003 (owner authorization at promotion).
