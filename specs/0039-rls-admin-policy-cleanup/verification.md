# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_344_rls_policy_cleanup.py (0 helper-calling policies, BL-11 gone, other policies unchanged) plus the T003 staging catalog query | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_344_rls_policy_cleanup.py (no anon/authenticated privilege on the 21 tables, learner/instructor JWT refused) plus the T003 catalog query and the T004 Security Auditor probe | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_344_rls_policy_cleanup.py (no GRANT, RLS on, service_role ACL byte-identical, helpers unchanged) plus the T003 relacl diff against the T001 baseline in research.md | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_344_rls_policy_cleanup.py (static contract, double apply, precondition and postcondition failures, down script never grants) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_client_write_invariant_postgres.py plus the full backend suite, Next-native verifiers and Staging E2E on the staging SHA that contains 344 | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected; FastAPI is unchanged.
- Database: T001 baseline recorded in `research.md` (2026-10-29 11:23Z,
  staging, read-only).

## Data evidence

- Migration writes no row. Pending T003.

## UI evidence

- N/A (`ui-states.md`).

## Release evidence

- Pending T002 (PC-J131), T003 (staging apply) and T005 (production at
  promotion).
