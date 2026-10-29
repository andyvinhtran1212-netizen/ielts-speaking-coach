# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_331_archived_student_give_guard.py (plain, mixed bulk and RPC refused with zero rows, no ledger row, no origin row; also for a role without UPDATE on students) plus research.md §R R4 on staging; R4 on staging is not recorded | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_331_archived_student_give_guard.py (archive-first refused after a measured wait, give-first kept with the archive waiting, stale pre-check, negative control without 331, jittered cohort RPC invariant; PostgreSQL 16 and 17); ci=Tests run 40784593322 on staging `56a8c344f`, 30 passed, 0 skipped (PostgreSQL 16); 30/30 on PostgreSQL 17.11 per #1756 | PASS |
| FR-003 | kind=test; ref=backend/tests/test_migration_331_archived_student_give_guard.py (student_id change to an archived learner refused, concurrent update refused; status/deadline/instructions update and same-value student_id SET pass; delete passes); ci=Tests run 40784593322 on staging `56a8c344f`, 30 passed | PASS |
| FR-004 | kind=test; ref=backend/tests/test_writing_give_archived_race.py (six give paths and the backfill service → 409 with ids from DETAIL or re-read, class give refused as a whole, activation Step 6 best-effort, roster script skips and continues, other errors 500) plus research.md §R W1–W2 on staging; ci=Tests run 40784593322 on staging `56a8c344f`, test_writing_give_archived_race.py 13 passed; W1–W2 reported passed in tracker row 0029-B (/workspace/cc-jobs/handoff/project-coordinator/tracker.tsv) | PASS |
| FR-005 | kind=test; ref=backend/tests/test_admin_students_archive.py (0029 suite unchanged: active give, replay after archive) plus backend/tests/test_migration_331_archived_student_give_guard.py (restore reopens gives, replay after archive) plus research.md §R W3–W5 on staging; ci=Tests run 40784593322 on staging `56a8c344f`, test_admin_students_archive.py 35 passed and the 331 suite 30 passed; W3–W4 reported passed in tracker row 0029-B; W5 is not run | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_migration_331_archived_student_give_guard.py (static contract, catalog after a double apply, preconditions abort without 326 or without FOR UPDATE, rollback then re-apply) plus research.md §R R1–R2 on staging; ci=Tests run 40784593322 on staging `56a8c344f`, 30 passed; R1–R2 passed on staging 2026-10-28 09:18 UTC+7 (/workspace/cc-jobs/handoff/leader/20261028-0918-assignment-tracker-m331-audit.md) | PASS |

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

- Staging SHA and checks (reconciled 2026-10-29): #1756 merged as
  `04dabc4fb980c474045ac88a1001242b0349f1fe` (2026-10-28 00:07 UTC+7); ledger
  `331_writing_assignment_archived_student_guard.sql` applied 2026-10-27
  17:15:31Z (2026-10-28 00:15:31 UTC+7) (`/workspace/qa/pcj60/ledger.out.tsv`).
  R1–R3 passed read-only on 2026-10-28 09:18 UTC+7
  (`/workspace/cc-jobs/handoff/leader/20261028-0918-assignment-tracker-m331-audit.md`).
  W1–W4 passed per tracker row `0029-B`. T007 stays open for W5, R4 and the
  fan-out timing.
- Code on `main`: `04dabc4fb` is an ancestor of `origin/main` (promotion #1786,
  `6cb6ca4320a7f65ae45fddaad7408b8c6c04833e`). The production apply and R1–R3
  are not checked here (no production access); see T008.
- Production verification: pending T008.

