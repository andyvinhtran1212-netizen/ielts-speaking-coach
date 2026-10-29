# Tasks

- [x] T001 Owner approves INACTIVEWRITE-0035 and its three defaults (approved by Vinh on 2026-10-28, `approval-decision.md`); migration number 335 locked by the Leader. `owns: specs/0035-inactive-learner-rest-write-guard/*, specs/README.md`
- [x] T002 Write migration 335 and the README note. `owns: backend/migrations/335_learner_jwt_writes_require_active_account.sql, backend/migrations/README.md` `depends: T001`
  Done in #1829 (merge `a43ba63ecd86866157d2d8ac23ba284b33dbb036`, 2026-10-28 19:39 UTC+7, replaces #1803; spec #1831 `d5b77eb82`): `335_learner_jwt_writes_require_active_account.sql` and the README note.
- [x] T003 Static and PostgreSQL tests for 335 on PostgreSQL 16 and 17. `owns: backend/tests/test_migration_335_learner_writes_require_active.py` `depends: T002`
  Done in #1829 (merge `a43ba63ecd86866157d2d8ac23ba284b33dbb036`, 2026-10-28 19:39 UTC+7, replaces #1803; spec #1831 `d5b77eb82`): `test_migration_335_learner_writes_require_active.py`, 20 passed, 0 skipped on PostgreSQL 16 in CI run 40784593322 (staging `56a8c344f`). Locally, with `test_migration_320_client_write_lockdown.py`, the #1829 body records 51 passed on PostgreSQL 17.11 and 50 passed + 1 PG17-only skip on 16.2.
- [ ] T004 Staging (when unfrozen): apply 335 with the advisory-locked runner, run the header catalog query, then the inactive 403 / active 201 REST probes with QA accounts. `depends: T002, T003`
  Partial. 335 is in the staging ledger at 2026-10-28 12:48:38Z (19:48:38 UTC+7) (`/workspace/qa/pcj60/ledger.out.tsv`). The header catalog query returns zero rows, and 6 tables carry the restrictive active-account policies (2026-10-29 06:15 UTC+7, `/workspace/qa/pcj60/postchecks.out.json`). Still open: the inactive 403 / active 201 REST probes with QA accounts (Security Auditor ticket PC-1028-17, no reply yet).
- [ ] T005 Production, with the owner's explicit authorization at the `staging` → `main` promotion: apply 335 under the advisory lock and run the catalog query read-only. `depends: T004`

Follow-up outside this spec: enrichment batch skips inactive owners and caps rows per user (owner set the cap at 50 rows per owner per run on 2026-10-28; separate PR).
