# Tasks

Single owner and branch (`feat/admin-ai-dashboard`); tasks are dependency
ordered and none run in parallel.

- [ ] T001 Owner approves AIOPS-0024 and the approval lands on `staging` (separate spec PR). `owns: specs/0024-admin-ai-model-control/`
- [ ] T002 Migration 322: override, audit and failure tables, audit triggers, rollup functions, RLS and grants; real-PostgreSQL tests. `depends: T001` `owns: backend/migrations/322_*.sql, backend/migrations/README.md, backend/tests/test_migration_322_*`
- [ ] T003 Override service and router precedence (FR-005/FR-006), TTL snapshot and background refresher, config setting. `depends: T002` `owns: backend/services/ai_model_overrides.py, backend/services/ai_router.py, backend/config.py, backend/main.py`
- [ ] T004 Failure log writer and hooks in `ai_router`, the Claude-after-Gemini call sites and the Speaking orchestrator (FR-007). `depends: T002`
- [ ] T005 Admin endpoints, schemas, usage/failure aggregation with Saigon windows (FR-001, FR-002, FR-004, FR-008); OpenAPI regeneration and route ledger. `depends: T003, T004`
- [ ] T006 `/admin` AI section with complete UI states and React/contract tests (FR-009). `depends: T005`
- [ ] T007 Docs: `docs/AI_PROVIDER_ROUTING.md` override precedence, migrations README entry. `depends: T005`
- [ ] T008 Staging: apply 322 with the locked runner, merge, run the staging journey in `rollout.md` and record evidence (FR-010). `depends: T006, T007`
- [ ] T009 Production: owner-authorized migration under the advisory lock, then promotion; record evidence. `depends: T008`
