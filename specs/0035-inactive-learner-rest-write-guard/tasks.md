# Tasks

- [x] T001 Owner approves INACTIVEWRITE-0035 and its three defaults (approved by Vinh on 2026-10-28, `approval-decision.md`); migration number 335 locked by the Leader. `owns: specs/0035-inactive-learner-rest-write-guard/*, specs/README.md`
- [ ] T002 Write migration 335 and the README note. `owns: backend/migrations/335_learner_jwt_writes_require_active_account.sql, backend/migrations/README.md` `depends: T001`
- [ ] T003 Static and PostgreSQL tests for 335 on PostgreSQL 16 and 17. `owns: backend/tests/test_migration_335_learner_writes_require_active.py` `depends: T002`
- [ ] T004 Staging (when unfrozen): apply 335 with the advisory-locked runner, run the header catalog query, then the inactive 403 / active 201 REST probes with QA accounts. `depends: T002, T003`
- [ ] T005 Production, with the owner's explicit authorization at the `staging` → `main` promotion: apply 335 under the advisory lock and run the catalog query read-only. `depends: T004`

Follow-up outside this spec: enrichment batch skips inactive owners and caps rows per user (owner set the cap at 50 rows per owner per run on 2026-10-28; separate PR).
