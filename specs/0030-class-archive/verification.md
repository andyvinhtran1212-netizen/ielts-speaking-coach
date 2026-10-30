# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_class_archive_routes.py (helper drops archived classes in both branches, include_archived mode, caller grep) plus AC-2, AC-3 on staging | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_337_class_archive.py (membership guard matrix incl. already-active upsert and removal to an archived next class, AFTER trigger, precedence, archive-first race) plus backend/tests/test_class_archive_activate.py (W1, real 227 → 337 route/guard chain; local evidence below) plus backend/tests/test_class_archive_routes.py (W3–W7, W13) plus AC-4, AC-5 on staging | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_337_class_archive.py (assignment, item, give guards) plus backend/tests/test_migration_346_class_archive_update_guards.py (moving an assignment, item or give into an archived class by UPDATE refused; same-class UPDATEs, reaper and finalisers unaffected) plus backend/tests/test_class_archive_routes.py (W2, W8–W10, fan-out replay, individual give allowed) plus AC-6 on staging | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_class_archive_routes.py (every research.md §5 entry point, D3 save/submit/auto-submit, reaper finalise, mock message) plus AC-7, AC-8, AC-13 on staging | PENDING |
| FR-005 | kind=journey; ref=AC-9 on staging (class returns, gives reopen, drafts intact, class code enrolls) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_migration_337_class_archive.py (RPC atomicity, idempotence, counts, no audit on name edit, client denied) plus AC-1, AC-11 on staging | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_migration_337_class_archive.py (restore-student skips archived class with negative control, archive committing mid-restore → 200 and skipped, candidate-class FOR SHARE lock, FOR UPDATE literal, no 331 names) plus AC-10 on staging | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_class_archive_activate.py (pre-check, mid-flight archive between Step 3 and 3b, exact snapshot restoration, revert retry/failure 503, re-claim, rate limit, no DB text, real PostgreSQL 17 enrollment guard; local evidence below) plus AC-4 on staging | PENDING |
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

## PC-J152 activation evidence (2026-10-30)

- Red/green: on base `0243e4e6f58ab8a4ac45459613fccc9227fac227`,
  the unchanged new test file gives **25 failed, 8 passed**. With the patch,
  the activation, rate-limit, suspended/staff/gate, instructor enrollment,
  promotion and student-linking suites give **241 passed**, including all
  **33** new cases and the **5** PostgreSQL 17 cases (`REQUIRE_PG=1`).
- Scope: `activate_account` and its local helpers only; `check_active`, database
  clients, migrations, cohort services/models and existing test files unchanged.
- W1 reads `cohorts.*`, so a schema without `archived_at` works. Only
  `is_active = false AND archived_at IS NOT NULL` is archived. Legacy inactive
  classes and the existing unresolved-owner behavior keep their contracts.
- The bare-router tests verify that the same generic 400 is returned for W1
  and the guard race, without relying on the global 5xx sanitizer. Every
  activation DB exception response is clean. A failed class read is 503 before
  user, student or code writes.
- Race tests cover INSERT/UPDATE, inactive/already-active users, null defaults
  on a newly created user, an instructor code whose role is never written
  before the claim (SA-REVIEW-152 below), and preservation of an admin role. A first compensation failure is retried once; two failures (or
  empty update results) yield 503 `activation_incomplete`, a CRITICAL log with
  request/user ids, and the compensation flag. No archive refusal claims the
  code or writes an assignment; success after enrollment has committed stays
  successful if the class archives before the best-effort backfill.
- Audit schema mapping: migration 099 defines `before` and `after` JSONB,
  with no top-level `detail` column. The rejection action is
  `enroll_rejected_cohort_archived`; its `cohort_id` and nested `detail`
  (`request_id`, `race`, `compensation_failed`) are persisted in `after`.
  Operational queries use `after->'detail'`; no migration is required. Audit
  insertion failure is logged server-side under the request/user ids.
- Real PostgreSQL 17 cases reuse the existing 326/331/337 harness, migration
  099's audit schema and the actual 227 enrollment triggers. W1, races on a
  new/existing student, an active class and a class made legacy-inactive before
  337 are checked through the router. User/code/audit state and whole-statement
  rollback of student/membership writes are read back from PostgreSQL.
- Local PostgreSQL is disposable, loopback-only, with SCRAM host authentication;
  it is stopped and deleted after verification. No staging/production access,
  migration, seed or live acceptance was performed by this job.
- Merge dependencies: J151 (#1938) and #1929 are present in base
  `0243e4e6f58ab8a4ac45459613fccc9227fac227`; J157 (#1974) remains open.
  Leader merges after that dependency and exact-head CI, once staging unfreezes.
  AC-4 still requires applied 337 and a synthetic QA namespace under T011.

## SA-REVIEW-152 follow-up (2026-10-30)

- P2 fix, approach (a): `role='instructor'` is no longer folded into Step 3.
  `_promote_after_claim` runs only after Step 4 wins the claim (upgrade-only
  compare-and-swap on the Step 2 role, one retry), then `promote_role` is
  audited. A pre-claim failure (double compensation failure 503, other Step 3b
  error 500, lost or indeterminate claim) leaves the role and the promote audit
  untouched. A promote that does not land after the immutable claim is audited
  as `promote_role_failed` with the read-back final role and reason, logged
  CRITICAL, and returned as 503 `promote_incomplete` (403 `account_suspended`
  when 332/336 refuse it) after the assignment row and backfill run.
- CR P3-1: compensation restores only fields Step 3 changed, and only while
  they still hold Step 3's value (re-read, plus compare-and-swap on scalar
  fields), so a concurrent admin `is_active=false` or permission strip wins.
  A failed compensation audit lists `after.detail.unrestored_fields`.
- SA-3: `/activate` logs the exception class and SQLSTATE only, never DB text
  or the code; the student-code conflict log names the code row id.
- SA-4: runbook `docs/runbooks/activation-compensation-failed.md`.
- Red/green: 22 cases fail on `25c89b257` and pass with the fix: 20 new in
  `test_class_archive_activate.py` plus 2 updated on purpose.
  `test_instructor_code_matching_email_promotes_and_audits` pinned the old
  "promote folded into the activation write" contract and now pins "promote is
  a separate write after the claim";
  `test_migration_323_users_role_single_check.py::test_application_writes_only_values_the_constraint_allows`
  still pins the canonical `'instructor'` literal, at the new write.

## Codex r4422345951 follow-up (2026-10-30)

- P2 fix: the archive-race undo never overwrites a newer successful activation
  of the same user. If the re-read row carries another `access_code_used`,
  nothing is restored; the undo UPDATE always compare-and-swaps on this
  request's code and on every restored field (`permissions` as jsonb text).
  The lost/indeterminate-claim `is_active=false` undo has the same guard.
- CR P3: a 0-row promote with the role unchanged is labelled `write_failed`;
  a role raised by someone else is audited as `promote_role` with
  `after.noop=true`.
- Red/green: 7 new cases in `test_class_archive_activate.py` fail on
  `a4f64497c` and pass with the fix (interleaving before the undo's read and
  before its write, permissions CAS, unclaimed-claim undo, promote labels).
