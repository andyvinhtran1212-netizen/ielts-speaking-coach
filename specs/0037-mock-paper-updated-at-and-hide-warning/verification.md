# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_338_paper_updated_at_triggers.py (visibility RPC, raw update, explicit stale value and child-table updates advance updated_at; insert keeps its value) plus the staging visibility probe | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_338_paper_updated_at_triggers.py (policy_revision, release event and mock_content_revision unchanged in behaviour; guard refusal still aborts; guards fire first) plus test_mock_paper_policy_postgres.py and test_mock_private_draft_postgres.py | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_338_paper_updated_at_triggers.py (static contract, double apply, precondition and postcondition failures) plus the staging catalog query | PENDING |
| FR-004 | kind=test; ref=frontend/tests/react/mock-public-source-hide-warning.test.tsx (public source warns, private/empty/Writing do not) | PENDING |
| FR-005 | kind=test; ref=frontend/tests/react/mock-private-draft-create.test.tsx (payload unchanged) and backend/tests/test_migration_338_paper_updated_at_triggers.py (copy still hides the source) | PENDING |

## Contract evidence

- OpenAPI/type drift: none; FastAPI is unchanged.
- Database: UPDATE on the five tables now returns an advanced `updated_at`.

## Data evidence

- Migration writes no row. Pending: staging catalog query after apply.

## UI evidence

- React test for the warning; staging check pending.

## Release evidence

- Staging SHA and checks: pending T005.
- Production verification: pending T007.
