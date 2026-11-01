# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_instructor_give_idempotency.py (missing, malformed and empty request_id → 422 with zero DB calls, both routes) | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_360_instructor_give_idempotency.py (replay, roster change, two sessions with lock observation for both kinds, bursts of three, negative control) plus backend/tests/test_instructor_give_idempotency.py (same response twice, replay after archive and roster change) plus rollout.md S2 on staging | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_360_instructor_give_idempotency.py (name, tier, level, prompts, route) plus backend/tests/test_instructor_give_idempotency.py (409 per field, cross-route 409) plus rollout.md S3 | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_360_instructor_give_idempotency.py (other owner, no receipt leak) plus backend/tests/test_instructor_give_idempotency.py (409, nothing written) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_migration_360_instructor_give_idempotency.py (prompt, class, foreign member, individual learner; active memberships only; archived learner rolls back then retries; grading_tier stored) plus backend/tests/test_writing_give_archived_race.py | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_instructor_routes_isolation.py::test_w05_admin_role_instructor_give_grades_instructor_and_reaches_queue (admin ledger empty, instructor ledger row) plus backend/tests/test_migration_360_instructor_give_idempotency.py::test_never_touches_the_admin_ledger_or_the_admin_rpc | PENDING |
| FR-007 | kind=test; ref=frontend/tests/react/instructor-dashboard-double-submit.test.tsx (retry reuses the id; new and changed give get a new id; red on the pre-0044 dashboard) plus frontend/tooling/verify-instructor-dashboard-flow.mjs | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_migration_360_instructor_give_idempotency.py (static contract, double apply, privileges, postcondition abort) plus backend/tests/test_client_write_invariant_postgres.py (locked NOSUPERUSER runner, invariant) plus backend/tests/test_migration_forward_policy.py plus rollout.md S1 | PENDING |

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` regenerated; `request_id`
  required on `FanOutBody` and `routers__instructor__AssignBody`.
- Backward compatibility: success responses unchanged; requests without
  `request_id` become 422 (D3). New frontend on an old backend: extra field
  ignored.

## Data evidence

- Migration/schema query: S1 (catalog) on staging after apply.
- Immediate state versus full reload: after a replayed give the dashboard
  refetches `/instructor/assignments`; a reload shows one give.

## UI evidence

- Viewports/themes/input methods: /instructor give form, desktop and mobile,
  light and dark, keyboard submit; no visual change.

## Release evidence

- Staging SHA and checks: pending T007.
- Production verification: pending T008.
