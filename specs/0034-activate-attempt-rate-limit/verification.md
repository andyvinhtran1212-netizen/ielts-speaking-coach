# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_activate_rate_limit.py::test_eleventh_attempt_across_two_processes_is_429_then_allowed_after_the_window, backend/tests/test_migration_334_activate_attempt_rate_limit.py::test_eleventh_call_from_a_second_process_is_refused_while_the_tenth_is_in_flight | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_activate_rate_limit.py::test_refusal_is_429_with_error_code_retry_after_and_no_code_lookup | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_activate_rate_limit.py::test_check_failure_is_503_activation_unavailable_and_nothing_else_runs | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_334_activate_attempt_rate_limit.py | PENDING |
| FR-005 | kind=test; ref=frontend/tests/login-next-model.test.mjs, backend/tests/test_activate_rate_limit.py::test_allowed_attempt_reaches_step_1c_and_archived_profile_still_consumes_nothing | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected (success schema, path and body unchanged).
- Backward compatibility: old backend ignores 334; old `/login` shows the HTTP-status fallback for the dict detail.

## Data evidence

- Migration/schema query: the postcheck in the 334 header returns `t|t|f|f|t`.
- Immediate state versus full reload: N/A (no UI state persisted).

## UI evidence

- Viewports/themes/input methods: error text only, in the existing `role="alert"` line.

## Release evidence

- Staging SHA and checks: pending.
- Production verification: pending owner authorization.
