# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_296_listening_programme_feedback_postgres.py::test_reveal_fails_closed_for_assigned_expired_unpublished_and_unsaved_attempts; companion=backend/tests/test_listening_programme_feedback.py::test_reveal_route_returns_only_requested_question_after_owner_gate | PASS |
| FR-002 | kind=test; ref=backend/tests/test_migration_296_listening_programme_feedback_postgres.py::test_concurrent_reveals_create_one_immutable_first_answer; companion=backend/tests/test_migration_296_listening_programme_feedback_postgres.py::test_reveal_snapshots_first_answer_and_retries_are_idempotent; deletion=backend/tests/test_migration_296_listening_programme_feedback_postgres.py::test_reveal_rejects_direct_delete_but_cascades_with_attempt | PASS |
| FR-003 | kind=test; ref=backend/tests/test_listening_programme_feedback.py::test_objective_reveal_is_one_question_only; companion=backend/tests/test_listening_programme_feedback.py::test_guided_state_returns_only_persisted_reveals | PASS |
| FR-004 | kind=test; ref=backend/tests/test_listening_programme_feedback.py::test_text_reveal_is_unscored_and_once_policy_hides_window; companion=frontend/tests/react/listening-programme-learning.test.tsx | PASS |
| FR-005 | kind=test; ref=frontend/tests/react/listening-programme-learning.test.tsx; companion=backend/tests/test_listening_overview.py | PASS |
| FR-006 | kind=test; ref=backend/tests/test_listening_overview.py; companion=frontend/tooling/verify-listening-analytics-flow.mjs; product-policy=2026-09-23-task | PASS |
| FR-007 | kind=test; ref=frontend/tests/react/listening-programme-learning.test.tsx; journey=frontend/tooling/verify-listening-programme-guided-flow.mjs | PASS |
| FR-008 | kind=test; ref=frontend/tests/listening-programme-replay.test.mjs; companion=backend/tests/test_listening_programme_feedback.py | PASS |
| FR-009 | kind=check; ref=.github/workflows/typecheck.yml; in-process OpenAPI regenerated and `cmp` matched `frontend/types/api.d.ts`; migration 295/296 PostgreSQL tests passed | PASS |
| FR-010 | kind=test; ref=frontend/tests/react/listening-programme-learning.test.tsx; browser journey covered 375/768/1440px light/dark, keyboard focus, 44px replay target, reduced motion, and overflow | PASS |

## Release evidence

Local evidence: 888 affected backend Listening tests (including migration
295/296 on disposable PostgreSQL), 706 frontend Listening contract tests,
11 React interaction tests, TypeScript, and a webpack production build
passed. Browser checks passed for guided form (six viewport/theme combinations),
landing (18/18), and analytics (15/15). Turbopack cannot build through this
worktree's out-of-root `node_modules` symlink; the webpack build completed.
After the owner clarified the deletion policy, the changed migration and its
regression test passed a 658-test Listening/migration-policy suite on disposable
PostgreSQL; direct ledger DELETE was rejected and parent attempt DELETE cascaded.

Exact staging and production SHA, staging migration ledger, live route contract,
protected-content sentinel, and production smoke journey remain pending.
Local checks do not establish that implementation or production promotion is complete.
