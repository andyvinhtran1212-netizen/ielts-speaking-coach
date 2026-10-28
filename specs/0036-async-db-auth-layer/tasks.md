# Tasks

- [x] T001 Approve ASYNCAUTH-0036 and reclassify PR #1805 as `high-risk` (Vinh, 2026-10-28 12:44, `approval-decision.md`). `owns: specs/0036-async-db-auth-layer/*, specs/README.md`
- [x] T002 Facade `sync_client=`, HTTP/1.1 async transport, shutdown close and per-thread clients. `owns: backend/services/db_async.py, backend/database.py, backend/main.py, backend/config.py` `depends: T001`
  Done in #1857 (merge `ef4b6903d10afcc5196e1077afc0cb09777de558`, 2026-10-28 23:14 UTC+7; replaces #1805/#1835, stacked on spec Revision 1 #1856 `823b3eda7`): `sync_client=` facade in `services/db_async.py`, HTTP/1.1 async PostgREST transport and `close_supabase_async()` on shutdown in `database.py`/`main.py`, per-thread service-role clients (`thread_supabase_admin()`), flag in `config.py`. #1890 (`56a8c344f`) later bounded the flag-ON transport timeouts.
- [x] T003 Async twins for the gate, staff guard, `/auth/me`, `/auth/check-active` and permission services, sharing query builders with the sync paths. `owns: backend/services/activation_gate.py, backend/routers/admin.py, backend/routers/auth.py, backend/services/access_code_permissions.py, backend/services/student_service.py` `depends: T002`
  Done in #1857 (merge `ef4b6903d10afcc5196e1077afc0cb09777de558`, 2026-10-28 23:14 UTC+7; replaces #1805/#1835, stacked on spec Revision 1 #1856 `823b3eda7`): async paths in `activation_gate.py`, `staff_guard.py`/`admin.py`, `routers/auth.py` (`/auth/me`, `/auth/check-active`), `access_code_permissions.py` and `student_service.py`.
- [x] T004 Concurrent home-summary on per-thread clients. `owns: backend/services/student_home_aggregator.py, backend/routers/student_home.py` `depends: T002`
  Done in #1857 (merge `ef4b6903d10afcc5196e1077afc0cb09777de558`, 2026-10-28 23:14 UTC+7; replaces #1805/#1835, stacked on spec Revision 1 #1856 `823b3eda7`): `get_home_summary_concurrent` in `student_home_aggregator.py` (sections on per-thread clients), used by `routers/student_home.py`.
- [x] T005 Flag-off/flag-on parity, transport, allowlist and home-summary tests. `owns: backend/tests/test_async_auth_db_layer.py, backend/tests/test_async_db_scaffold.py, backend/tests/test_student_home_aggregator.py, backend/tests/test_activation_gate_round2.py, backend/tests/conftest.py` `depends: T003, T004`
  Done in #1857 (merge `ef4b6903d10afcc5196e1077afc0cb09777de558`, 2026-10-28 23:14 UTC+7; replaces #1805/#1835, stacked on spec Revision 1 #1856 `823b3eda7`). CI run 40784593322 on staging `56a8c344f`, 0 skipped: `test_async_auth_db_layer.py` 56 passed, `test_async_db_scaffold.py` 8, `test_student_home_aggregator.py` 50, `test_activation_gate_round2.py` 42.
- [ ] T006 Staging: merge with the flag off, then the Leader enables `USE_ASYNC_DB`; record the `rollout.md` measurement and parity check against the deployed SHA. `depends: T005`
- [ ] T007 Production: promote with the flag off; enable it only on Vinh's separate go. `depends: T006`

T002–T005 are delivered by PR #1805, rebuilt so its implementation commit
descends from this spec's approval commit.
