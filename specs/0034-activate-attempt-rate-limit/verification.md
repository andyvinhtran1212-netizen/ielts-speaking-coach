# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_activate_rate_limit.py::test_eleventh_attempt_across_two_processes_is_429_then_allowed_after_the_window, backend/tests/test_migration_334_activate_attempt_rate_limit.py::test_eleventh_call_from_a_second_process_is_refused_while_the_tenth_is_in_flight; ci=Tests run 40784593322 on staging `56a8c344f`: test_activate_rate_limit.py 17 passed, test_migration_334_activate_attempt_rate_limit.py 25 passed, 0 skipped (PostgreSQL 16); PostgreSQL 17.11 per #1847 | PASS |
| FR-002 | kind=test; ref=backend/tests/test_activate_rate_limit.py::test_refusal_is_429_with_error_code_retry_after_and_no_code_lookup; ci=Tests run 40784593322 on staging `56a8c344f`, 17 passed | PASS |
| FR-003 | kind=test; ref=backend/tests/test_activate_rate_limit.py::test_check_failure_is_503_activation_unavailable_and_nothing_else_runs; ci=Tests run 40784593322 on staging `56a8c344f`, 17 passed | PASS |
| FR-004 | kind=test; ref=backend/tests/test_migration_334_activate_attempt_rate_limit.py; ci=Tests run 40784593322 on staging `56a8c344f`, 25 passed, 0 skipped (PostgreSQL 16); PostgreSQL 17.11 per #1847; staging header postcheck returns t, t, f, f, t on 2026-10-29 | PASS |
| FR-005 | kind=test; ref=frontend/tests/login-next-model.test.mjs plus backend/tests/test_activate_rate_limit.py::test_allowed_attempt_reaches_step_1c_and_archived_profile_still_consumes_nothing; ci=Tests run 40784593322 on staging `56a8c344f`: node --test login model cases passed, test_activate_rate_limit.py 17 passed | PASS |

## Contract evidence

- OpenAPI/type drift: none expected (success schema, path and body unchanged).
- Backward compatibility: old backend ignores 334; old `/login` shows the HTTP-status fallback for the dict detail.

## Data evidence

- Migration/schema query: the postcheck in the 334 header returns `t|t|f|f|t`.
  Staging, read-only, 2026-10-29 06:15 UTC+7: `t|t|f|f|t`
  (`/workspace/qa/pcj60/postchecks.out.json`).
- Immediate state versus full reload: N/A (no UI state persisted).

## UI evidence

- Viewports/themes/input methods: error text only, in the existing `role="alert"` line.

## Release evidence

- Staging SHA and checks (reconciled 2026-10-29): spec #1846 merged as
  `ef52009b685bfa50e7c60ae2492f1f673486df07` (2026-10-28 19:39 UTC+7);
  #1847 merged as `fb6abd1d7db5643deb163dee8c4b642a4f363563` (21:18 UTC+7).
  Ledger: `334_activate_attempt_rate_limit.sql` applied 2026-10-28 13:47:44Z
  (20:47:44 UTC+7), before the merge (`/workspace/qa/pcj60/ledger.out.tsv`).
  Staging `56a8c344f` contains #1847: Tests run 40784593322 and Staging release
  smoke run 40784593282 are green. Pending: the 11-attempt QA probe (T006).
- Production verification: pending owner authorization. 334 is not on `main` yet.
