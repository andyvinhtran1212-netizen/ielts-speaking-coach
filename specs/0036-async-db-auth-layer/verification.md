# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_async_auth_db_layer.py (flag-off never touches the async client; same results as the sync path) plus backend/tests/test_async_db_scaffold.py (flag default off) and the staging `/health/async-db` check after merge | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_async_auth_db_layer.py (live permissions, account summary, gate 403/503 and memo, staff guards per role and activation state plus 500 path, `/auth/me` incl. provisioning and error contract, `/auth/check-active`, `/api/student/permissions`: same result, status/detail and query sequence in both flag states) plus the staging same-account parity diff | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_async_auth_db_layer.py (flag-on never touches the sync singleton, concurrent gate lookups overlap on one loop, async pool HTTP/1.1, closed on shutdown) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_student_home_aggregator.py (behaviour tests against sequential and concurrent builders) plus backend/tests/test_async_auth_db_layer.py (per-thread clients, sections overlap) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_async_db_scaffold.py (exact facade allowlist, `admin.py` guard-only pin) | PENDING |
| FR-006 | Staging measurement and parity record per `rollout.md` on the implementation PR, against the deployed SHA | PENDING |
| FR-007 | Staging rollback rehearsal or recorded `/health/async-db` state after a flag-off restart | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected; `frontend/types/api.d.ts` unchanged.
- Backward compatibility: no response shape change in either flag state.

## Data evidence

- No schema change. Query-sequence equality is pinned by the parity tests.

## UI evidence

- No UI change; staging page waterfalls only (`rollout.md`).

## Release evidence

- Staging SHA and measurement: pending T006.
- Production: pending T007 (flag off at promotion).
