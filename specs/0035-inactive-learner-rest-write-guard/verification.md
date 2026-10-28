# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_335_learner_writes_require_active.py (inactive, NULL and missing-row accounts: INSERT 42501 on every table, UPDATE/DELETE 0 rows, invoker SRS RPC refused; PostgreSQL 16 and 17) plus the staging inactive-JWT REST probe | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_335_learner_writes_require_active.py (active learner keeps every write and the owner checks; inactive account still reads) plus the flashcard/vocabulary suites | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_335_learner_writes_require_active.py (service_role writes for an inactive account) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_335_learner_writes_require_active.py (helper answers for the caller only, not anon-executable, pinned search_path, activation change on the next statement) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_migration_335_learner_writes_require_active.py (static contract, double apply, precondition and postcondition failures, rollback then re-apply) plus the staging catalog query | PENDING |

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

## UI evidence

- None (UI impact N/A).

## Release evidence

- Staging SHA and checks: pending T004 (staging is frozen).
- Production verification: pending T005.
