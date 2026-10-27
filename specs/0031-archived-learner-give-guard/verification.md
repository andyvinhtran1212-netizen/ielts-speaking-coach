# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_331_archived_student_give_guard.py (plain, mixed bulk and RPC refused with zero rows, no ledger row, no origin row; also for a role without UPDATE on students) plus research.md §R R4 on staging | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_331_archived_student_give_guard.py (archive-first refused after a measured wait, give-first kept with the archive waiting, stale pre-check, negative control without 331, jittered cohort RPC invariant; PostgreSQL 16 and 17) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_331_archived_student_give_guard.py (student_id change to an archived learner refused, concurrent update refused; status/deadline/instructions update and same-value student_id SET pass; delete passes) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_writing_give_archived_race.py (six give paths and the backfill service → 409 with ids from DETAIL or re-read, class give refused as a whole, activation Step 6 best-effort, roster script skips and continues, other errors 500) plus research.md §R W1–W2 on staging | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_admin_students_archive.py (0029 suite unchanged: active give, replay after archive) plus backend/tests/test_migration_331_archived_student_give_guard.py (restore reopens gives, replay after archive) plus research.md §R W3–W5 on staging | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_migration_331_archived_student_give_guard.py (static contract, catalog after a double apply, preconditions abort without 326 or without FOR UPDATE, rollback then re-apply) plus research.md §R R1–R2 on staging | PENDING |

## Contract evidence

- OpenAPI/type drift: none. The 409 `detail` object is the existing 0029
  shape; `frontend/types/api.d.ts` is unchanged.
- Backward compatibility: success responses are unchanged. Only a former 201
  inside the race window (or the 500 an old backend would return once 331 is
  applied) becomes a 409.

## Data evidence

- Migration/schema query: R1, R2 (catalog) on staging after apply; R3 before
  apply, after apply and after the journey (`research.md` §R).
- Immediate state versus full reload: after a refused give the list refetch and
  a reload show no new row (W1, W2).

## UI evidence

- Viewports/themes/input methods: admin Writing "Giao bài" dialog and the
  instructor give/fan-out, desktop and mobile, light and dark, keyboard submit
  (W1–W2; no component change).

## Release evidence

- Staging SHA and checks: pending T007.
- Production verification: pending T008.
