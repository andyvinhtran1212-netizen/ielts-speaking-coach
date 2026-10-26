# Rollout and rollback

## Preconditions

- AIOPS-0024 approved by the owner and landed on `staging` before the
  implementation PR (constitution §2).
- Migration number re-checked against `backend/migrations/` and open PRs
  (320 is SECWRITE-0022, merged) immediately before merge.
- AI-0004 migration 286 is applied (the rollup reads its columns). Staging and
  production both have it.
- No new secrets or Railway variables are required. `AI_MODEL_OVERRIDE_TTL_SECONDS`
  is optional (default 30, clamped to 30–60).

## Staging

1. After the implementation PR is approved, apply the migration to staging
   (`zjphffoujxkpltixsbzj`) with the repository runner
   (`backend/scripts/apply_migrations.sh` / `apply_migration_locked.sql`, advisory
   lock and ledger), then confirm with read-only queries:
   - `select relrowsecurity from pg_class where relname in ('ai_model_overrides','ai_model_override_audit','ai_provider_failures')` → all true;
   - `select grantee, privilege_type from information_schema.role_table_grants where table_name like 'ai_%override%' or table_name = 'ai_provider_failures'` → no `anon`/`authenticated`;
   - `select count(*) from ai_model_overrides` → 0 (no behavior change).
2. Merge the implementation PR; wait for the exact merged staging SHA to pass
   integrated CI and live Staging E2E.
3. Staging journey: an admin opens `/admin` → AI section shows six features
   with sources; a learner account gets 403 from `/admin/ai/models`; switch
   `course_writing` to Gemini, confirm the audit line, wait ≤60 s, submit one
   course-writing answer and confirm `ai_usage_logs` shows a Gemini row first;
   reset the feature to "Mặc định" and confirm the audit line.

## Production

- Owner authorizes the production migration explicitly. Apply 322 to
  production (`huwsmtubwulikhlmcirx`) with the advisory-locked runner before the
  `staging` → `main` promotion that contains the dependent code.
- Health checks after promotion: `/admin` AI section loads for the owner; store
  status `ok`; failure panel shows rows or a correct empty state; no increase in
  grading error rate in `ai_usage_logs`.
- No production override is set as part of the release. Any later override is
  an owner action from the dashboard.

## Rollback and repair

- **Behavior rollback without deploy:** reset each feature to "Mặc định" in the
  dashboard, or `DELETE FROM ai_model_overrides;` (audited by trigger). Every
  instance returns to env/code-default routing within one refresh window.
- **Code rollback:** revert the implementation commit. Older code does not read
  the new tables; they stay and are harmless.
- **Schema rollback (only if explicitly required; destroys audit/failure
  history):**

  ```sql
  BEGIN;
  DROP FUNCTION IF EXISTS public.fn_admin_ai_failure_rollup(timestamptz, timestamptz);
  DROP FUNCTION IF EXISTS public.fn_admin_ai_usage_rollup(timestamptz, timestamptz);
  DROP TABLE IF EXISTS public.ai_provider_failures;
  DROP TABLE IF EXISTS public.ai_model_override_audit;
  DROP TABLE IF EXISTS public.ai_model_overrides;
  DROP FUNCTION IF EXISTS public.fn_ai_model_override_audit();
  DROP FUNCTION IF EXISTS public.fn_ai_model_override_audit_append_only();
  COMMIT;
  ```

  Run it only after the code that reads the tables is reverted; the current
  code then reports `not_migrated` and routes with env/code defaults.
- **Repair:** an invalid hand-edited override is ignored by the router and
  flagged in the panel; fix it by saving a valid value or "Mặc định".

## Observability

- `[ai_overrides] refresh ok features=N` / `refresh failed: <type>` backend
  log lines; store status and last refresh on the models panel.
- `ai_provider_failures` counts by feature/provider/error type on the failure
  panel; `[ai_router] ... falling back` log lines remain.
- Spend and failed-attempt counts per feature/provider from `ai_usage_logs` on
  the usage panel.
- Owner: product owner (Vinh). No paging; a sustained rise in `final` failures
  or a store status other than `ok` is reviewed from the dashboard.
