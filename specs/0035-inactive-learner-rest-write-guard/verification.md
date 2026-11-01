# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_335_learner_writes_require_active.py (inactive, NULL and missing-row accounts: INSERT 42501 on every table, UPDATE/DELETE 0 rows, invoker SRS RPC refused; PostgreSQL 16 and 17) plus the staging inactive-JWT REST probe; ci=Tests run 40784593322 on staging `56a8c344f`, 20 passed, 0 skipped (PostgreSQL 16); PostgreSQL 17.11 per #1829; the staging inactive-JWT REST probe (PC-1028-17) is not recorded | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_335_learner_writes_require_active.py (active learner keeps every write and the owner checks; inactive account still reads) plus the flashcard/vocabulary suites; ci=Tests run 40784593322 on staging `56a8c344f`, 20 passed; the full backend suite including the flashcard/vocabulary suites passed in the same run | PASS |
| FR-003 | kind=test; ref=backend/tests/test_migration_335_learner_writes_require_active.py (service_role writes for an inactive account); ci=Tests run 40784593322 on staging `56a8c344f`, 20 passed | PASS |
| FR-004 | kind=test; ref=backend/tests/test_migration_335_learner_writes_require_active.py (helper answers for the caller only, not anon-executable, pinned search_path, activation change on the next statement); ci=Tests run 40784593322 on staging `56a8c344f`, 20 passed | PASS |
| FR-005 | kind=test; ref=backend/tests/test_migration_335_learner_writes_require_active.py (static contract, double apply, precondition and postcondition failures, rollback then re-apply) plus the staging catalog query; ci=Tests run 40784593322 on staging `56a8c344f`, 20 passed; staging catalog query returns zero rows on 2026-10-29 06:15 UTC+7 (/workspace/qa/pcj60/postchecks.out.json) | PASS |

## Contract evidence

- OpenAPI/type drift: none; FastAPI is unchanged.
- PostgREST for an inactive account: POST 201 → 403; PATCH/DELETE affect no
  row; GET unchanged. Active accounts unchanged.

## Data evidence

- Staging pre-check (read-only, 2026-10-28): `authenticated` writes exactly the
  five tables plus `user_d1_questions.is_active`; their policies are
  owner-only; `users` is owned by `postgres` (BYPASSRLS, RLS not forced); no
  vocabulary row belongs to an inactive account; no `users.is_active` is NULL.
- After apply: the 335 header catalog query returns zero rows.
  Observed on staging, read-only, 2026-10-29 06:15 UTC+7: zero rows; the
  `app_private.is_current_user_active()` policies cover 6 tables
  (`/workspace/qa/pcj60/postchecks.out.json`).

## UI evidence

- None (UI impact N/A).

## Release evidence

- Staging SHA and checks (reconciled 2026-10-29): #1829 merged as
  `a43ba63ecd86866157d2d8ac23ba284b33dbb036` (2026-10-28 19:39 UTC+7). Ledger:
  `335_learner_jwt_writes_require_active_account.sql` applied 2026-10-28
  12:48:38Z (19:48:38 UTC+7) (`/workspace/qa/pcj60/ledger.out.tsv`). Staging
  `56a8c344f` contains #1829: Tests run 40784593322 is green. Pending: the
  inactive/active REST probes (T004, PC-1028-17).
- Production verification (2026-10-29, owner Vinh 10:53 UTC+7, option A): 335
  applied to production under `pg_advisory_lock(173204,1)`, one request, before
  promotion PR #1906 merged. Read-only postcheck: the header catalog query
  returns 0 rows; 18 RESTRICTIVE `require_active_account_*` policies; RLS on for
  the 6 learner tables; `app_private.is_current_user_active()` SECURITY
  DEFINER, `search_path=""`, EXECUTE authenticated only; anon-writable 0; same
  as the staging postcheck. Source: `/workspace/cc-jobs/release-1029.md`,
  `/workspace/cc-jobs/rel1029/out/apply-335.json`, `q00b-post335.json`.
  Railway production deployment `ab70b603` and
  Vercel production deployment 7404494270 are SUCCESS on the merge SHA. No production write probe
  (rollout). Pending: the staging REST probes (T004, Security Auditor).

| Migration | Staging apply (ledger) | Production apply (ledger) | Merge to `main` |
| --- | --- | --- | --- |
| `335_learner_jwt_writes_require_active_account.sql` | 2026-10-28 12:48:38Z (19:48:38 UTC+7), `/workspace/qa/pcj60/ledger.out.tsv` | 2026-10-29 04:52:11Z (11:52:11 UTC+7), `rel1029/out/apply-335.json` | #1906 `584b7e418e38a0be869933538fe78e9737c4f30b`, 2026-10-29 12:01:31 UTC+7 |
