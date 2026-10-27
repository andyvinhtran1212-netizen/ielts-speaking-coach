# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_admin_students_archive.py (DELETE archives, idempotent, 404) plus research.md §7 AC-2, AC-3 on staging | PENDING |
| FR-002 | kind=journey; ref=research.md §7 AC-4 to AC-8 (lists, roster, assignments, Writing 403, activation 403 with code unused) on staging | PENDING |
| FR-003 | kind=journey; ref=research.md §7 AC-4 and AC-11 (include_archived listing and restore) on staging | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_326_student_archive.py (client cannot execute functions or change is_active) plus AC-9, AC-10 on staging | PENDING |
| FR-005 | kind=query; ref=research.md §7 AC-2 row counts before and after archive and restore | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_admin_students_archive.py (no hard delete reachable from the route) | PENDING |

## Contract evidence

- OpenAPI/type drift: regenerate `frontend/types/api.d.ts` for the new restore
  route, the `include_archived` query and `archived_at` field.
- Backward compatibility: DELETE keeps its path and success status.

## Data evidence

- Migration/schema query: `research.md` §6 P1–P5 on staging after apply;
  production pending Vinh's read-only permission.
- Immediate state versus full reload: archived learner stays hidden after reload; restore persists.

## UI evidence

- Viewports/themes/input methods: admin students page at desktop and mobile
  widths, light and dark, keyboard-only archive and restore.

## Release evidence

- Staging SHA and checks: pending T008.
- Production verification: pending T009.
