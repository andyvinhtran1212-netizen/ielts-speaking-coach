# Tasks

- [ ] T001 Migration 355 replacing `fn_guard_published_vocab_review()` and `fn_guard_published_vocab_task()` (UPDATE checks old and new version), down script, README and forward-policy entries, reparent regression tests (PC-J267, job 1ds). `owns: backend/migrations/355_*.sql, backend/migrations/README.md, backend/migrations/forward-policy.tsv, backend/tests/test_vocab_curated_postgres.py, backend/tests/test_migration_355_vocab_curated_guard_reparent.py`
- [ ] T002 Staging (Leader): apply 355 under the advisory lock and run the read-only postcheck (both function bodies match 355). `depends: T001`
- [ ] T003 Production, only with Vinh's explicit authorization at the `staging` → `main` promotion: apply 355 under the advisory lock and run the same postcheck. `depends: T002`
