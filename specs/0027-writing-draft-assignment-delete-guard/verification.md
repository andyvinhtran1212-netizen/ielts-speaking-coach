# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_324_writing_drafts_fk.py (delete with draft raises 23503) plus catalog query research.md §7 P1 on staging (AC-1) | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_writing_assignment_delete_guard.py (23503 maps to 409) plus staging journeys research.md §8 AC-3 to AC-6 | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_324_writing_drafts_fk.py (single-statement student delete) plus AC-8 E2E cleanup | PENDING |
| FR-004 | kind=query; ref=research.md §2.2 counts before and after apply (AC-2) and re-apply no-op test | PENDING |

## Contract evidence

- OpenAPI/type drift: none; status codes and detail strings are those of #1732.
- Backward compatibility: backend works with or without 324 applied.

## Data evidence

- Migration/schema query: `research.md` §7 P1/P2 on staging after apply;
  production pending Vinh's read-only permission.
- Immediate state versus full reload: draft text re-read after a refused delete.

## UI evidence

- Viewports/themes/input methods: no UI surface.

## Release evidence

- Staging SHA and checks: pending T007.
- Production verification: pending T008.
