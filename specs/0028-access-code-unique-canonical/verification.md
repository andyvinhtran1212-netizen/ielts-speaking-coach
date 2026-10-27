# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_325_access_codes_unique.py (index codified, re-apply no-op, invalid index aborts) plus catalog AC-1 on staging | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_325_access_codes_unique.py (lower-case or padded insert raises 23514) | PENDING |
| FR-003 | kind=query; ref=research.md §2.1 counts before and after apply (AC-2) and precheck abort test | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_access_code_generation.py (instructor mint retries on 23505) plus AC-4 on staging | PENDING |
| FR-005 | kind=journey; ref=research.md §9 AC-5, AC-6 (normalized input and class code activation) on staging | PENDING |

## Contract evidence

- OpenAPI/type drift: none; mint responses keep their shape.
- Backward compatibility: legacy 8-character codes remain canonical and active.

## Data evidence

- Migration/schema query: `research.md` §8 P1–P4 on staging after apply;
  production pending Vinh's read-only permission.
- Immediate state versus full reload: minted codes listed after reload.

## UI evidence

- Viewports/themes/input methods: no UI change.

## Release evidence

- Staging SHA and checks: pending T007.
- Production verification: pending T008.
