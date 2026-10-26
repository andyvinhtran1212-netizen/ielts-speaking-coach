# Implementation plan

## Architecture impact

- **Backend, new:** `services/ai_model_overrides.py` (allowlist, validation,
  in-process snapshot, background refresh, write helper),
  `services/ai_failure_log.py` (error-type normalization, best-effort writer),
  `services/admin_ai_dashboard.py` (window math, usage/failure aggregation,
  feature description), `routers/admin_ai.py` (four endpoints, `require_admin`),
  `models/admin_ai.py` (Pydantic request/response schemas).
- **Backend, changed:** `services/ai_router.py` (override-aware
  `provider_order`/`anthropic_model`, `describe_feature`, failure recording in
  `call_anthropic` and `with_fallback`, `record_fallback` helper);
  `services/grading_orchestrator.py` (records non-success attempts, knows its
  feature); the three call sites that run Claude after a failed Gemini attempt
  (`gemini_writing_grader.py`, `course_writing_grader.py`,
  `advanced_vocab_rewrite_grader.py`) and `routers/listening.py` call
  `record_fallback` on that branch; `main.py` (router mount, refresher started in
  the existing startup hook); `config.py` (`AI_MODEL_OVERRIDE_TTL_SECONDS`).
- **Frontend:** new client component `admin-ai-panel.tsx` rendered by
  `frontend/app/(authed-admin-overview)/admin/admin-overview.tsx`; typed calls
  through `frontend/lib/browser-api.ts` with types from the regenerated
  `frontend/types/api.d.ts`.
- Unchanged: the ledger writer (`ai_usage_logger.py`), `ai_pricing.py`,
  `grading_events`, `/admin/ai-usage`, every default in `config.py`.

## Data and contracts

### Migration `backend/migrations/321_ai_model_overrides_and_failures.sql`

Number 320 is claimed by open PR #1699; the number is re-checked against
`backend/migrations/` and open PRs before merge.

```sql
ai_model_overrides(
  feature text PRIMARY KEY CHECK (feature ~ '^[a-z][a-z0-9_]{1,63}$'),
  preferred_provider text NULL CHECK (preferred_provider IN ('anthropic','gemini','openai')),
  anthropic_model text NULL CHECK (anthropic_model ~ '^claude-[a-z0-9.-]{1,60}$'),
  updated_by uuid NULL, updated_at timestamptz NOT NULL DEFAULT now())

ai_model_override_audit(
  id bigint identity PK, feature text NOT NULL,
  action text CHECK (action IN ('insert','update','delete')),
  old_/new_preferred_provider text, old_/new_anthropic_model text,
  changed_by uuid NULL, changed_at timestamptz NOT NULL DEFAULT now())
  -- written only by trigger fn_ai_model_override_audit() AFTER INSERT/UPDATE/DELETE
  -- on ai_model_overrides (no row when neither value changes);
  -- BEFORE UPDATE/DELETE trigger raises: append-only.

ai_provider_failures(
  id bigint identity PK, created_at timestamptz NOT NULL DEFAULT now(),
  feature text NOT NULL, provider text NOT NULL CHECK (IN anthropic/gemini/openai/unknown),
  model text NULL, route_slot text NULL, attempt smallint NULL,
  error_type text NOT NULL CHECK (IN the FR-007 list),
  error_code text NULL (<= 64 chars), outcome text NOT NULL CHECK (IN retry/fallback/final))
  -- indexes: (created_at DESC), (feature, created_at DESC)

fn_admin_ai_usage_rollup(p_start timestamptz, p_end timestamptz)   -- STABLE, grouped sums of ai_usage_logs
fn_admin_ai_failure_rollup(p_start timestamptz, p_end timestamptz) -- STABLE, grouped counts
```

- RLS enabled on all three tables, no policies. `REVOKE ALL ... FROM PUBLIC,
  anon, authenticated`; `service_role` receives only the privileges it uses
  (overrides: SELECT/INSERT/UPDATE/DELETE; audit and failures: SELECT/INSERT).
  Both functions: `SET search_path = public, pg_temp`, `EXECUTE` revoked from
  PUBLIC/anon/authenticated and granted to `service_role` only.
- Idempotent: `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`
  before `CREATE TRIGGER`; grants are repeatable.
- No change to `ai_usage_logs`: feature, status, error code, cache-read/write
  and thinking tokens already exist (migrations 031/286); provider derives from
  `service` (`claude`→anthropic, `gemini`→gemini, `whisper`/`tts`→openai,
  `elevenlabs`→elevenlabs, other→as stored).

### Endpoints (`routers/admin_ai.py`, all `require_admin`)

| Method/path | Request | Response |
| --- | --- | --- |
| `GET /admin/ai/models` | — | `AdminAiModelsResponse`: `features[]` (feature, label, existing_provider, effective_order[] of {provider, slot, model, model_source}, preferred_provider {value, source}, anthropic_model {value, source}, existing_model {value, source}, override {preferred_provider, anthropic_model, updated_at, updated_by, invalid_fields[]} \| null), `allowlist` {providers per feature, anthropic_models}, `anthropic_key_configured`, `store` {status `ok`/`unavailable`/`not_migrated`/`not_loaded`, last_refreshed_at, ttl_seconds}, `recent_changes[]` (≤20 audit rows; actor id + resolved email) |
| `PUT /admin/ai/models/{feature}` | `{preferred_provider: str \| null, anthropic_model: str \| null}` | `AdminAiModelsResponse` refetched after the write; 422 on invalid; 503 `ai_override_store_unavailable` when the table is missing or the write fails |
| `GET /admin/ai/usage?window=today\|7d\|30d` | — | `AdminAiUsageResponse`: window {key, start, end, timezone}, totals, `by_feature[]`, `by_provider[]` (calls, failed_calls, input/output/thinking/cache_read/cache_write tokens, cost_usd, priced_calls, unpriced_calls, legacy_calls), meta {source, legacy_rows} |
| `GET /admin/ai/failures?window=...` | — | `AdminAiFailuresResponse`: window, totals {failures, fallbacks, retries, final}, `by_provider_feature[]` {provider, feature, total, retry, fallback, final, by_error_type{}}, `recent[]` (≤50), store status |

- Invalid `window` → 422. Failures reading a missing table → `store.status =
  not_migrated` with empty data (HTTP 200) so the panel can say so.
- Backward compatibility: all endpoints are new; no existing response shape
  changes. Frontend consumers derive types from the regenerated OpenAPI file.

### Router resolution (FR-005/FR-006)

```text
base   = env/code-default effective order (existing parse + legacy append)
pref   = valid override.preferred_provider for the feature, else None
order  = (pref,) + base without pref          if pref else base
model  = override.anthropic_model > ANTHROPIC_MODEL_<FEATURE> > ANTHROPIC_MODEL_<TIER> > DEFAULT_MODELS
then   = drop anthropic when ANTHROPIC_API_KEY is blank (unchanged rule)
```

Source labels: `db_override` when the override supplied the value;
`env` when the setting name is in `settings.model_fields_set`; otherwise
`code_default`.

Snapshot: one query for all rows; stale-while-revalidate with a background
refresher started from the existing FastAPI startup hook (interval = TTL,
default 30 s, clamped to 30–60 s); each refresh has a 5 s timeout; a failed
refresh empties the snapshot (env/code defaults) and records the error state;
the saving process replaces its snapshot immediately after a successful write.

### Failure log (FR-007)

`ai_failure_log.record(...)` builds the row from enumerated fields only and
schedules the insert as a retained background task (same pattern as
`ai_usage_logger.schedule_usage_log`). Error normalization maps:
`timeout`/`TimeoutError`/`total_timeout` → timeout; `rate_limited`/429 →
rate_limit; 529/`overloaded` → overloaded; 5xx → server_error; other 4xx/
`api_status` → api_error; `network` → network; `invalid_response`/JSON/parse/
schema errors → invalid_json; `empty_body` → empty_response;
`missing_api_key` → missing_key; `not_configured` → not_configured; anything
else → unknown. Cancellations are not recorded (client disconnect, not a
provider failure). Outcome is `retry` when the orchestrator retries the same
slot, `fallback` when another provider/slot follows, `final` when none does.

## UI and interaction

- `AdminAiPanel` renders below the existing overview tiles on `/admin`, as a
  `section` with heading "AI" and three independently loaded panels; each panel
  owns its loading/empty/error-retry state (see `ui-states.md`).
- Control per feature: a provider select (Mặc định / Claude / Gemini) and a
  Claude model select (Mặc định / allowlisted models), a Save button disabled
  until something changes, `aria-busy` while saving, then the canonical refetched
  configuration replaces the row. Errors render inline with `role="alert"`.
- Usage window: a tablist (Hôm nay / 7 ngày / 30 ngày) with arrow-key movement,
  matching the existing overview window control.
- Times render with `Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })`.
- Tables scroll horizontally on narrow viewports; colors use existing admin
  tokens so both themes inherit.

## Work decomposition

1. Migration + real-PostgreSQL tests (schema, RLS, grants, trigger, idempotency).
2. Override service + router precedence + failure log + orchestrator hook, with
   unit tests (no network).
3. Dashboard aggregation service + admin router + schemas + route tests.
4. OpenAPI regeneration (`frontend/types/api.d.ts`), route ledger, docs.
5. Frontend panel + React/contract tests + typecheck.
6. Spec verification evidence; staging migration and smoke after merge.

Single owner (one branch); no parallel file ownership needed.

## Rollout and rollback

See `rollout.md`. Summary: apply 321 to staging, merge code, verify the panel
and one override flip on staging, then production migration under the
advisory lock before promotion. Rollback is code-first (the code tolerates the
missing tables) and override-first (`DELETE FROM ai_model_overrides` restores
env/code defaults within one refresh window).

## Verification strategy

- Real PostgreSQL (`TEST_PG_URL`, CI service): tables, CHECKs, RLS flag, no
  anon/authenticated privileges, service-role privileges, audit trigger rows and
  append-only refusal, rollup functions, double application.
- Backend unit/route tests: precedence and source labels, allowlist rejection,
  TTL behavior with a fake clock, DB-failure fallback, missing-table states,
  failure-row content (no prompt/user fields) for router, `with_fallback`,
  manual call-site fallback and orchestrator, Saigon window boundaries, usage
  aggregation (priced/unpriced/legacy/unattributed), 401/403 for every endpoint.
- Existing `test_ai_router.py`, orchestrator and grader suites pass unchanged
  (no-override behavior).
- Frontend: React interaction test for the panel (loading, empty, error/retry,
  save pending/settled, 422 message, store-unavailable), node contract test for
  the overview wiring, both `tsc` boundaries, `npm run build`.
- Staging: panel visible for an admin, 403 for a learner, one override flip
  observed in `ai_usage_logs`/`ai_provider_failures` and reverted.
