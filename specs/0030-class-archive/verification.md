# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_class_archive_routes.py (helper drops archived classes in both branches, include_archived mode, caller grep) plus AC-2, AC-3 on staging | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_337_class_archive.py (membership guard matrix incl. already-active upsert and removal to an archived next class, AFTER trigger, precedence, archive-first race) plus backend/tests/test_class_archive_routes.py (W1, W3–W7, W13) plus AC-4, AC-5 on staging | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_337_class_archive.py (assignment, item, give guards) plus backend/tests/test_migration_346_class_archive_update_guards.py (moving an assignment, item or give into an archived class by UPDATE refused; same-class UPDATEs, reaper and finalisers unaffected) plus backend/tests/test_class_archive_routes.py (W2, W8–W10, fan-out replay, individual give allowed) plus AC-6 on staging | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_class_archive_routes.py (every research.md §5 entry point, D3 save/submit/auto-submit, reaper finalise, mock message) plus AC-7, AC-8, AC-13 on staging | PENDING |
| FR-005 | kind=journey; ref=AC-9 on staging (class returns, gives reopen, drafts intact, class code enrolls) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_migration_337_class_archive.py (RPC atomicity, idempotence, counts, no audit on name edit, client denied) plus AC-1, AC-11 on staging | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_migration_337_class_archive.py (restore-student skips archived class with negative control, archive committing mid-restore → 200 and skipped, candidate-class FOR SHARE lock, FOR UPDATE literal, no 331 names) plus AC-10 on staging | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_class_archive_routes.py (pre-check, mid-flight archive between Step 3 and 3b, revert-failure 503, re-claim, rate limit, no DB text) plus AC-4 on staging | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_migration_337_class_archive.py (legacy inactive class stays legacy, postcondition count) plus AC-12 snapshot comparison on staging | PENDING |
| FR-010 | kind=journey; ref=AC-14 admin dialogs on staging plus frontend admin classes tests | PENDING |
| FR-011 | kind=test; ref=backend/tests/test_migration_337_class_archive.py (old-backend PATCH both ways after apply, light and full rollback, re-apply, refusals) | PENDING |

## Acceptance on staging

Preconditions:

- 337 and 346 applied with the advisory-locked runner.
- Backend and frontend at the merged SHA.
- AC-2…AC-11, AC-13 and AC-14 use a fresh `staging_seed.py --ns <ns>`
  namespace with classes E2E-A and E2E-B. They never use "QA Course 1 Resume
  20261010".

| # | Step | Expected |
| --- | --- | --- |
| AC-1 | Catalog after apply (337 and 346) | 3 columns; `trg_cohorts_archive_metadata` and the 4 guards `O`; the 3 346 move guards `O`, `tgtype` 19, one-column `tgattr` and the value-changed `WHEN`; DEFINER and no client EXECUTE; audit RLS on with no client privilege; no `is_active`-dependent CHECK |
| AC-2 | Learner in E2E-A and E2E-B; admin archives E2E-B with a reason | `/my-class` shows only E2E-A; `/home` does not count E2E-B work; 1 `archive` audit row with counts and reason |
| AC-3 | Learner only in E2E-B | "chưa có lớp"; `has_class=false` |
| AC-4 | New learner activates E2E-B's class code | generic 400; code unused; account inactive; no `students`/membership row; audit `enroll_rejected_cohort_archived` |
| AC-5 | Admin add/bulk/members/generate code; instructor mint, for E2E-B | 409 `cohort_archived`; no row; pickers omit E2E-B |
| AC-6 | Class assignment, backfill, Writing fan-out (admin and instructor), lesson, for E2E-B | 409; no row |
| AC-7 | Untimed pending give with a draft in E2E-B | listed with the closed label; draft readable; draft PATCH, start and submit return 409; `draft_text` unchanged |
| AC-8 | Submitted essay in E2E-B | result visible; admin/instructor can still grade and return |
| AC-9 | Restore E2E-B | back on `/my-class`; gives reopen; drafts intact; `restore` audit row; class code enrolls |
| AC-10 | 0029-archive a learner of E2E-A and archived E2E-B, then restore the learner | 200; E2E-A active; E2E-B in `skipped_archived_cohort_ids`; `students.cohort_id` = E2E-A |
| AC-11 | With learner and instructor JWTs: PATCH `/rest/v1/cohorts`, POST `/rest/v1/student_cohort_memberships`, GET `/rest/v1/class_lifecycle_audit`, POST `/rest/v1/rpc/fn_archive_cohort` and `/rpc/fn_restore_cohort` | all refused; DB unchanged |
| AC-12 | FR-009: before apply and after deploy, the `/my-class` and `/writing/my-assignments` responses of the 3 learners of "QA Course 1 Resume 20261010" | `/my-class` byte-identical; `/writing/my-assignments` identical once `class_archived` and `archive_finish_allowed` are removed from every row, and both are `false` on the 4 legacy gives; the class still has `archived_at IS NULL`; its 4 open gives keep their status and stay workable; admin shows "Lưu trữ cũ — chưa áp dụng" |
| AC-13 | Timed give in E2E-B started before the archive | autosave and auto-submit succeed |
| AC-14 | Admin confirm dialogs (archive, restore, apply to legacy) at desktop and mobile, light and dark | copy as in `ui-states.md`; counts equal `archive-preview`; reason optional |

## Contract evidence

- OpenAPI/type drift: regenerate `frontend/types/api.d.ts` for the cohort
  receipt, `archive-preview`, the new cohort fields and the two Writing flags.
- Backward compatibility: success shapes are additive. New 409s and the
  activation 400 happen only for archived classes. Legacy inactive classes
  are unchanged.

## Data evidence

- Migration/schema query: AC-1. The FR-009 count is taken before and after
  apply with a separate read-only SELECT, because the Management API drops
  NOTICEs.
- Immediate state versus full reload: after archive, restore or apply, the list
  and detail refetch and a reload show the same state.

## UI evidence

- Viewports/themes/input methods: AC-14 plus the Writing dashboard and
  `/my-class` at 375 px and desktop, light and dark, keyboard-only confirm.

## Release evidence

- Staging SHA and checks: pending T011.
- Production verification: pending T010 (read-only) and T012.
