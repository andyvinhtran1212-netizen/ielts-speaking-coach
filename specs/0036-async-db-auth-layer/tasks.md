# Tasks

- [x] T001 Approve ASYNCAUTH-0036 and reclassify PR #1805 as `high-risk` (Vinh, 2026-10-28 12:44, `approval-decision.md`). `owns: specs/0036-async-db-auth-layer/*, specs/README.md`
- [ ] T002 Facade `sync_client=`, HTTP/1.1 async transport, shutdown close and per-thread clients. `owns: backend/services/db_async.py, backend/database.py, backend/main.py, backend/config.py` `depends: T001`
- [ ] T003 Async twins for the gate, staff guard, `/auth/me`, `/auth/check-active` and permission services, sharing query builders with the sync paths. `owns: backend/services/activation_gate.py, backend/routers/admin.py, backend/routers/auth.py, backend/services/access_code_permissions.py, backend/services/student_service.py` `depends: T002`
- [ ] T004 Concurrent home-summary on per-thread clients. `owns: backend/services/student_home_aggregator.py, backend/routers/student_home.py` `depends: T002`
- [ ] T005 Flag-off/flag-on parity, transport, allowlist and home-summary tests. `owns: backend/tests/test_async_auth_db_layer.py, backend/tests/test_async_db_scaffold.py, backend/tests/test_student_home_aggregator.py, backend/tests/test_activation_gate_round2.py, backend/tests/conftest.py` `depends: T003, T004`
- [ ] T006 Staging: merge with the flag off, then the Leader enables `USE_ASYNC_DB`; record the `rollout.md` measurement and parity check against the deployed SHA. `depends: T005`
- [ ] T007 Production: promote with the flag off; enable it only on Vinh's separate go. `depends: T006`

T002–T005 are delivered by PR #1805, rebuilt so its implementation commit
descends from this spec's approval commit.
