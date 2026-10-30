# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_admin_ai_dashboard.py; models endpoint order, slot models and source labels for env, code default and DB override; ci=Tests run 40784593322 on staging `56a8c344f`, 31 passed | PASS |
| FR-002 | kind=test; ref=backend/tests/test_admin_ai_dashboard.py; Saigon window boundaries and per-feature/provider aggregation including unpriced, legacy and unattributed rows; rollup function on real PostgreSQL; ci=Tests run 40784593322 on staging `56a8c344f`, 31 passed plus backend/tests/test_migration_322_ai_model_overrides_postgres.py usage/failure rollup cases on PostgreSQL 16 | PASS |
| FR-003 | kind=test; ref=backend/tests/test_migration_322_ai_model_overrides_postgres.py; tables, CHECKs, RLS, grants, audit trigger, append-only audit, double application; ci=Tests run 40784593322 on staging `56a8c344f`, 12 passed, 0 skipped (PostgreSQL 16); PostgreSQL 17.11 per #1837 | PASS |
| FR-004 | kind=test; ref=backend/tests/test_admin_ai_dashboard.py; 401/403 for non-admins, 422 allowlist rejections with no write, audit actor, refetched response; ci=Tests run 40784593322 on staging `56a8c344f`, 31 passed | PASS |
| FR-005 | kind=test; ref=backend/tests/test_ai_model_overrides.py; precedence, reorder-only semantics, Speaking slot placement, missing-key rule; ci=Tests run 40784593322 on staging `56a8c344f`, 27 passed | PASS |
| FR-006 | kind=test; ref=backend/tests/test_ai_model_overrides.py; snapshot TTL with a fake clock, background refresh, DB failure/timeout/missing table/invalid value fall back to env/code defaults; ci=Tests run 40784593322 on staging `56a8c344f`, 27 passed | PASS |
| FR-007 | kind=test; ref=backend/tests/test_ai_failure_log.py; router, with_fallback, Claude-after-Gemini and orchestrator records; enumerated fields only; write failure isolation; ci=Tests run 40784593322 on staging `56a8c344f`, 49 passed | PASS |
| FR-008 | kind=test; ref=backend/tests/test_admin_ai_dashboard.py; failure counts per provider/feature/outcome/error type and recent 50 ordering; ci=Tests run 40784593322 on staging `56a8c344f`, 31 passed | PASS |
| FR-009 | kind=test; ref=frontend/tests/react/admin-ai-panel.test.tsx; loading, empty, error/retry, save pending/settled, store states; both typecheck boundaries; ci=Tests run 40784593322 on staging `56a8c344f`, 11 passed; Typecheck + OpenAPI drift run 40784593245 green | PASS |
| FR-010 | kind=journey; ref=specs/0024-admin-ai-model-control/rollout.md; staging migration before merge, staging journey, production migration before promotion; staging 322 applied 2026-10-28 22:13:05 UTC+7 before the #1837 merge (22:43), read-only journey steps passed; production 322 applied 2026-10-29 11:51:18 UTC+7 before the #1906 merge (`584b7e418`, 12:01:31), postcheck PASS (T009); still open: the staging admin write steps (T008, Leader) and the owner `/admin` AI load on production | PENDING |

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` regenerated in #1837; the
  Typecheck + OpenAPI drift check is green on staging `56a8c344f`
  (run 40784593245).
- Backward compatibility: four new endpoints only; no existing response shape,
  default or chain changes. Existing router/orchestrator tests unchanged.

## Data evidence

- Migration/schema query (staging, read-only): at 2026-10-29 ~01:30 UTC+7 RLS
  was on for `ai_model_overrides`, `ai_model_override_audit` and
  `ai_provider_failures`, anon/authenticated held no grants and all three
  tables had 0 rows (`/workspace/qa/leader-0129/0024-t008-readonly.txt`).
  RLS re-checked on at 06:15 (`/workspace/qa/pcj60/postchecks.out.json`).
- Immediate state versus full reload: the post-save models panel equals a
  reload of `/admin` (staging journey).

## UI evidence

- Viewports/themes/input methods: desktop and 390 px, light and dark, keyboard
  only for the window tabs, selects and Save.

## Release evidence

- Staging SHA and checks: #1837 merged as `f04cbe052f6b1843d378e0e621e75124f3f54198`
  (2026-10-28 22:43 UTC+7). Ledger: `322_ai_model_overrides_and_failures.sql`
  applied 2026-10-28 15:13:05Z (22:13:05 UTC+7)
  (`/workspace/qa/pcj60/ledger.out.tsv`). Staging `56a8c344f` contains it:
  Tests run 40784593322 and Staging release smoke run 40784593282
  (provenance OK, 41 passed) are green. The T008 admin write steps are still
  open (see `tasks.md`).
- Production verification (2026-10-29, owner Vinh 10:53 UTC+7, option A):
  322 applied to production (`huwsmtubwulikhlmcirx`) under
  `pg_advisory_lock(173204,1)`, one request; read-only postcheck PASS: RLS on
  for `ai_model_overrides`, `ai_model_override_audit` and
  `ai_provider_failures`, anon/authenticated grants 0 (service_role only), the
  4 functions not executable by PUBLIC/anon/authenticated, overrides 0 rows;
  tables and functions identical to the staging postcheck. Then promotion PR
  #1906 merged. Source: `/workspace/cc-jobs/release-1029.md`,
  `/workspace/cc-jobs/rel1029/out/apply-322.json`, `q00b-post322.json`,
  `q00b-ledger-post.json`. Railway production deployment `ab70b603` and Vercel
  production deployment 7404494270 are SUCCESS on the merge SHA.
  Pending: the rollout post-promotion health check (owner loads the `/admin`
  AI section on production) and the staging T008 write steps.

| Migration | Staging apply (ledger) | Production apply (ledger) | Merge to `main` |
| --- | --- | --- | --- |
| `322_ai_model_overrides_and_failures.sql` | 2026-10-28 15:13:05Z (22:13:05 UTC+7), `/workspace/qa/pcj60/ledger.out.tsv` | 2026-10-29 04:51:18Z (11:51:18 UTC+7), `rel1029/out/apply-322.json` | #1906 `584b7e418e38a0be869933538fe78e9737c4f30b`, 2026-10-29 12:01:31 UTC+7 |
