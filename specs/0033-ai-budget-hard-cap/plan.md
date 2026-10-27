# Implementation plan

This plan is for implementation **after** AIBUDGET-0033 is approved on
`staging`. It also needs the Leader's confirmation of migration number 333
(Q5). Call-site citations are in `research.md`.

## Architecture impact

### New backend modules

- **`services/ai_budget.py`**, the single chokepoint.
  - `reserve(lines, *, request_key, feature, operation, user_id, resource)`
    returns a `Reservation` or raises `AIBudgetRefused(reason, scope)`.
  - `Reservation.settle(provider, usage)`, `.release(provider)` and
    `.settle_at_estimate(provider)`.
  - `guard(provider, model, feature, estimate, …)` is an async context
    manager that reserves before the call and settles or releases on exit.
    It is the form every call site uses.
  - `kill_switch_on()` reads `os.environ["AI_KILL_SWITCH"]` per call and
    never touches the DB (FR-007).
  - `estimate(provider, model, *, input_chars, max_tokens, audio_seconds,
    text_chars)` uses `services/ai_pricing.py` (FR-004).
  - `classify_provider_error(exc)` returns `provider_spend_limit` or
    `transient`. It is fixture-driven (FR-009, research §6).
  - The RPC call has a 2 s timeout. Any exception, unexpected shape or
    missing object raises `AIBudgetRefused("budget_unavailable")`
    (FR-005).
  - `AI_BUDGET_MODE` is `enforce` by default and for any unrecognised
    value. `shadow` logs `would_refuse` and lets the call through (staging
    calibration only, Q6).
- **`services/ai_budget_config.py`** parses the `AI_BUDGET_*` variables and
  the existing per-user caps into scope caps and per-scope
  `config_invalid` flags (FR-003, FR-006). The values are logged at
  startup without secrets.
- **`services/deferred_grading.py`** enqueues and drains Speaking jobs. It
  also drains budget-deferred Writing jobs and recomputes the session
  aggregate (FR-011, FR-013).
  - The Speaking drain grades from the stored recording. It reuses the
    admin regrade pipeline (`routers/admin.py:4303-4540`), which already
    downloads, transcribes, grades and persists from storage. That
    pipeline is extracted into a service function shared by both the
    regrade route and the drain.
- **`scripts/ai_budget_sweep.py`**, the Railway cron entry point (Q8). Each
  run:
  1. expires stale reservations;
  2. dispatches alerts;
  3. drains the queue;
  4. writes the heartbeat.
- **`routers/ai_budget.py`**: `GET /ai/status` (signed-in) and
  `GET /admin/ai/budget` (`require_admin`). Registered in `main.py`.

### Changed call sites

These are the call sites in research §1. Each wraps its provider request in
`ai_budget.guard` and sets SDK `max_retries=0`.

- **`ai_router.with_fallback`** and **`call_anthropic`**: re-raise
  `AIBudgetRefused` before the generic `except Exception`. Map 402
  `billing_error` to `provider_spend_limit` through the classifier.
- **`grading_orchestrator`**: re-raise `AIBudgetRefused` from every rung,
  and from the JSON-repair second run in `claude_grader.py:577-583`.
- **`routers/grading.py`** (Speaking):
  - After `read_file` and before Whisper, reserve one all-or-nothing
    bundle: Whisper (OpenAI, `MAX_AUDIO_DURATION_SECONDS`), the grader
    (Anthropic, primary model `max_tokens`), the judge (Anthropic Haiku)
    and pronunciation (Azure).
  - Move `record_grading_attempt` after the bundle is granted (FR-012).
  - On refusal: upload the recording (`storage_upload` moves ahead of
    Whisper only on this branch), persist the `responses` row with
    `grading_status='awaiting_budget'`, enqueue the job, and return
    FR-010.
  - A fallback rung reserves its own line at the moment it is tried.
  - Any later budget refusal in the same request goes through the same
    deferral as a refusal before Whisper, for example a refused fallback
    line or a provider spend-limit response after the grant. The deferral:
    1. stores the recording;
    2. persists `awaiting_budget` with any transcript already obtained;
    3. enqueues the job with the `grading_attempt_id` that request
       recorded;
    4. deletes that `grading_attempts` row (FR-012), with the sweeper
       retrying the delete if it fails;
    5. releases the unused lines.

    Lines already used stay settled. The drain skips Whisper when the
    stored transcript belongs to the same submission revision.
  - Unused lines are released when the response is persisted.
- **`services/essay_service.py` and `gemini_writing_grader.py`**: on
  `AIBudgetRefused`, call `defer_writing_job(job_id)` (FR-011). The reaper
  at `essay_service.py:1245-1340` skips rows where `budget_deferred_at` is
  not null.
- **`services/rate_limit.py`, `routers/tts.py`, `routers/listening.py`**:
  - A count error raises `AIBudgetRefused("budget_unavailable")`.
  - A cap of zero or less is `config_invalid`.
  - The exercise (non-AI) limiter is unchanged (FR-006).
- **`services/runtime_flags.py`**: add `is_enabled(key, default,
  on_error=None)`. A paid-AI gate passes `on_error=False`. Existing callers
  keep their current semantics (FR-006).
- **Learner AI routes in FR-020**: map `AIBudgetRefused` to FR-010 before
  any attempt, quota row or session slot is written.

### Frontend

The surfaces are in `ui-states.md`. They consume `GET /ai/status` and the
new 503 detail through `frontend/lib/browser-api.ts` and the regenerated
`frontend/types/api.d.ts`.

## Data and contracts

### Migration 333 (provisional), `backend/migrations/333_ai_budget_hard_cap.sql`

All objects live in `public`. RLS is enabled with no policies. Every
privilege is revoked from `PUBLIC`, `anon` and `authenticated`.
`service_role` gets only what is listed for each object. The migration is
idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`) and runs in one
transaction with `lock_timeout = 5s`.

1. **`ai_budget_counters`**
   - Columns: `scope text` (`total`, `anthropic`, `google`, `openai`,
     `elevenlabs`, `azure`), `period_kind text` (`month`, `day`),
     `period_start date`, `cap_usd numeric(12,4)` (the snapshot used by
     the last decision), `settled_usd numeric(14,6) not null default 0`,
     `reserved_usd numeric(14,6) not null default 0`,
     `closed_reason text null` (`provider_spend_limit`),
     `updated_at timestamptz`.
   - Primary key: `(scope, period_kind, period_start)`.
   - CHECK: `settled_usd >= 0 and reserved_usd >= 0`.
   - `service_role`: SELECT only. Writes happen only through the functions
     below.
2. **`ai_budget_reservations`**
   - Columns: `id uuid pk` (deterministic from `request_key` and line),
     `request_key text not null`, `provider text`, `model text`,
     `feature text`, `operation text`, `user_id uuid null`,
     `resource_type text`, `resource_id text`, `month_start date`,
     `day_start date`, `estimate_usd numeric(14,6) not null check (> 0)`,
     `actual_usd numeric(14,6) null`,
     `status text check (status in ('reserved','settled','released','expired'))`,
     `created_at`, `expires_at`, `settled_at`.
   - Unique index: `(request_key, provider, line_no)`.
   - Indexes: `(status, expires_at) where status='reserved'`.
   - `service_role`: SELECT.
3. **`ai_deferred_grading_jobs`**
   - Columns: `id uuid pk`, `kind text check (kind in ('speaking_response'))`,
     `resource_id uuid not null`, `submission_revision text not null`,
     `user_id uuid not null`,
     `status text check (status in ('queued','running','done','failed','superseded'))`,
     `reason text`, `grading_attempt_id uuid null` (FR-012 compensation), `attempts int not null default 0`,
     `lease_until timestamptz`, `enqueued_at timestamptz not null default now()`,
     `finished_at`, `last_error text`.
   - Unique: `(kind, resource_id, submission_revision)`.
   - Index: `(status, enqueued_at, id) where status='queued'`.
   - `service_role`: SELECT, INSERT, UPDATE.
4. **`writing_jobs.budget_deferred_at timestamptz null`** (additive), with
   a partial index for rows where it is not null and status is `queued`.
   No CHECK change.
5. **`ai_budget_alerts`**
   - Columns: `id uuid pk`, `scope`, `period_kind`, `period_start`,
     `threshold int check (threshold in (50,80,100))`,
     `trigger text check (trigger in ('crossing','cap_refusal','provider_spend_limit'))`,
     `committed_usd`, `cap_usd`, `created_at`,
     `send_status text check (in ('pending','sent','failed')) default 'pending'`,
     `attempts int`, `next_attempt_at`, `sent_at`, `last_error`.
   - Unique: `(scope, period_kind, period_start, threshold)` (FR-015).
   - `service_role`: SELECT and UPDATE of the send columns. Inserts happen
     only inside the reserve, settle and close-scope functions. Whichever
     trigger fires first owns the row, so each scope, period and
     threshold is emailed once.
6. **`ai_budget_heartbeat`**: a single row (`id boolean pk default true
   check (id)`), with `last_run_at` and `last_result jsonb`.
7. **Functions.** Each is `SECURITY DEFINER` with
   `search_path = public, pg_temp`. EXECUTE is revoked from `PUBLIC`,
   `anon` and `authenticated` and granted to `service_role` only.
   - **`fn_ai_budget_reserve(p_request_key text, p_lines jsonb, p_caps jsonb, p_ttl_seconds int)`**
     - `p_lines` has the shape `[{line_no, provider, model, feature,
       operation, estimate_usd, user_id, resource_type, resource_id}]`.
     - `p_caps` maps each scope to `{month, day}` (null means no
       per-provider cap). It comes from the caller's environment.
       FR-003 validation happens before the call; the function also
       rejects caps of zero or less.
     - First, if rows for `p_request_key` already exist, the function
       does not grant anything. It returns `{granted: false, replay: true,
       lines: [{provider, status}]}` without changing a counter (FR-012,
       AC3). A replay **never authorises a provider request**, whatever
       the existing status (`reserved`, `settled`, `released` or
       `expired`). Only the transaction that inserted the rows gets
       `granted: true` and the reservation ids that `guard` needs to send.
       A concurrent duplicate blocks on the unique index until the first
       transaction commits, then sees a replay.
     - Callers derive `request_key` from the logical attempt: for
       Speaking, `submission_id` plus the attempt number; for a deferred
       job, the job id plus `attempts`. A true retry after a failure uses
       the next attempt number, and so gets a new reservation. A duplicate
       of the same attempt (a client retry, or a concurrent request with
       the same `submission_id`) gets a replay. It must then return the
       canonical stored state, through the existing `check_submission`
       readback or the deferred state, and never call the provider.
     - Then it upserts the counter rows for every touched scope and
       period and locks them `FOR UPDATE` in `(scope, period_kind)`
       order.
     - It refuses the whole request, returning the reason and scope, if
       any `closed_reason` is set or any `settled + reserved + Σestimate`
       would exceed its cap.
     - On a cap refusal it still commits one thing: a 100% alert row for
       each refusing scope and period (`trigger = 'cap_refusal'`,
       `ON CONFLICT DO NOTHING`). No reservation and no counter change are
       committed, so repeated refusals stay idempotent (FR-015).
     - Otherwise it inserts the reservations, increments `reserved_usd`,
       inserts alert rows for newly crossed thresholds with
       `ON CONFLICT DO NOTHING`, and returns the granted rows.
   - **`fn_ai_budget_settle(p_reservation_id uuid, p_actual_usd numeric)`**
     moves a `reserved` row to `settled`. It subtracts the estimate from
     `reserved_usd` and adds the actual to `settled_usd`, then checks
     thresholds again. A second call is a no-op.
   - **`fn_ai_budget_release(p_reservation_id uuid)`** moves `reserved` to
     `released` and subtracts the estimate. It is a no-op on any other
     state.
   - **`fn_ai_budget_expire(p_now timestamptz)`** settles every `reserved`
     row past `expires_at` at its estimate (status `expired`). It returns
     the count.
   - **`fn_ai_budget_close_scope(p_scope text, p_day date, p_reason text)`**
     sets `closed_reason` on that scope's day counter (FR-009) and inserts
     the 100% daily alert (`trigger = 'provider_spend_limit'`).
   - **`fn_ai_budget_recompute(p_period_start date)`** is operator-only
     repair. It recomputes `reserved_usd` and `settled_usd` from the
     reservations, and never lowers `settled_usd` below the settled sum.
   - **`fn_ai_deferred_claim(p_limit int, p_lease_seconds int)`** claims
     queued jobs `FOR UPDATE SKIP LOCKED` in `enqueued_at, id` order and
     sets the lease.
8. **Postconditions.** A `DO` block raises if any of the following does not
   hold:
   - every table exists with RLS enabled;
   - `anon` and `authenticated` hold no privilege on any of the objects;
   - each function exists with `prosecdef` and the pinned `search_path`;
   - the unique indexes exist;
   - `writing_jobs.budget_deferred_at` exists.
9. **Down script** (in the header, guarded). It aborts unless
   `ai_deferred_grading_jobs` has no `queued` or `running` rows and no
   `writing_jobs` row has `budget_deferred_at` set while `queued`.

N-1 compatibility: the deployed backend does not read these objects, and
the `writing_jobs` column is nullable with no default.

### API contract

All shapes are published in OpenAPI and regenerated into
`frontend/types/api.d.ts` (constitution §3).

- **The 503 detail** (FR-010) for every synchronous AI route:

  ```json
  {"error_code": "ai_budget_exhausted",
   "reason": "monthly_cap|daily_cap|kill_switch|config_invalid|budget_unavailable|provider_spend_limit",
   "work_saved": true,
   "resource": {"session_id": "…", "question_id": "…", "response_id": "…"},
   "message": "Hệ thống chấm tự động tạm dừng. Bài của bạn đã được lưu và sẽ được chấm khi hệ thống mở lại."}
  ```

  For non-admin callers, `reason` is reduced to `"paused"`. Admins and logs
  see the real reason. Refuse-before-accept routes (FR-020) send
  `work_saved: false` with the P2 message.
- **Speaking response read models** (`GET /sessions/{id}`, the result and
  Full Test summary) carry `grading_status: 'awaiting_budget'` on pending
  responses. The band fields are null, and a pending session reports
  `grading_pending: true`. The fields are additive; old clients ignore
  them.
- **Writing essay and result reads** report `grading_status`, mapped from
  `writing_essays.status='pending'` together with
  `writing_jobs.budget_deferred_at is not null` to `'awaiting_budget'`.
- **`GET /ai/status`** returns
  `{paid_ai_available: bool, pending_grading_count_for_caller: int}`.
  Any lookup failure returns `paid_ai_available:false`. The response
  carries `Cache-Control: private, max-age=30`.
- **`GET /admin/ai/budget`** returns:

  ```json
  {"mode": "enforce|shadow", "kill_switch": false,
   "scopes": [{"scope", "period_kind", "period_start", "cap_usd",
               "settled_usd", "reserved_usd", "committed_usd", "percent",
               "state", "config_error"}],
   "queue": {"speaking_queued", "writing_deferred", "oldest_enqueued_at"},
   "reservations": {"open", "expired_last_24h"},
   "alerts": [{"scope", "period_start", "threshold", "send_status", "sent_at"}],
   "sweeper": {"last_run_at", "stale"}, "lookup_failed": false}
  ```

### Backward compatibility

- A browser running the old frontend that gets the new 503 classifies it
  as `ambiguous_commit` and reads back
  (`speaking-submission-controller.mjs:141-158`). The readback finds the
  saved row, so no work is lost or duplicated before the frontend deploys.
- Writing submit is unchanged.

## UI and interaction

See `ui-states.md`. Component ownership:

- **Speaking:** `practice-page-shell.tsx`, `practice-submission-bridge.tsx`
  and `public/js/speaking-submission-controller.mjs`. A new classifier
  branch comes first, before the generic 5xx branch.
- **Results:** `speaking-result-behavior.tsx`, the Full Test result,
  `writing-result-behavior.tsx` and `writing-behavior.tsx`.
- **Learner AI controls:** a shared `useAiStatus()` hook in
  `frontend/lib/ai-status.ts`, gated on sign-in after hydration.
- **Instructor and admin:** the instructor banner in
  `instructor-dashboard.tsx`; the admin panel in `admin-overview.tsx`.

## Work decomposition

The order follows `tasks.md`. File ownership:

| Unit | Owns |
| --- | --- |
| Migration | `backend/migrations/333_ai_budget_hard_cap.sql`, `backend/migrations/README.md`, `backend/migrations/forward-policy.tsv` |
| Budget core | `services/ai_budget.py`, `services/ai_budget_config.py`, `config.py`, `services/ai_pricing.py` (Azure row) |
| Router and providers | `services/ai_router.py`, `services/grading_orchestrator.py`, `services/grading_providers/*`, `services/claude_grader.py`, `services/whisper.py`, `services/tts_audio.py`, `services/azure_pronunciation.py`, `services/listening_*`, `services/gemini*.py`, `services/course_writing_grader.py`, `services/advanced_vocab_rewrite_grader.py`, `services/d1_*.py`, `services/vocab_enrichment.py`, `services/writing_prompt_analysis.py`, operator scripts |
| Quotas and flags | `services/rate_limit.py`, `routers/tts.py`, `routers/listening.py` (gist only), `services/runtime_flags.py` |
| Deferred grading | `services/deferred_grading.py`, `routers/grading.py`, `routers/admin.py` (regrade extraction), `services/essay_service.py`, `routers/sessions.py` (aggregate hook), `scripts/ai_budget_sweep.py` |
| Status APIs and alerts | `routers/ai_budget.py`, `main.py`, the email transport shared with 0032 |
| Frontend | the files in UI and interaction, `frontend/types/api.d.ts`, `frontend/lib/browser-api.ts` |

Router, provider, frontend and migration work can run in parallel once the
budget core interface (T002) is merged. Deferred grading depends on the
migration and the budget core.

## Rollout and rollback

See `rollout.md`. In summary:

- Variables are set before deploy, because an invalid total cap means
  refuse.
- Staging order: migration 333, then shadow calibration, then enforce with
  a low cap through AC1–AC9 with E2E accounts, then restore production
  values.
- Production: authorised promotion, with 333 applied under the advisory
  lock first. Enforce from the first deploy. A 7-day reconciliation
  follows.
- The fast stop is `AI_KILL_SWITCH=on`. A code revert is safe once the
  queue has been exported. Schema rollback is guarded on an empty queue.

## Verification strategy

### Offline tests

These run in CI with fake providers; no network.

- **`backend/tests/test_ai_budget_gate.py`**: an AST and regex scan
  confirms that every provider SDK call or endpoint sits inside a guarded
  wrapper and every SDK client sets `max_retries=0` (FR-001).
- **`backend/tests/test_ai_budget_service.py`**: kill-switch parsing,
  config validation, estimator bounds, the fail-closed RPC (raise, timeout,
  bad shape, missing function) and shadow vs enforce (FR-003 to FR-008,
  AC2, AC5, AC9).
- **`backend/tests/test_migration_333_ai_budget.py`**, on PostgreSQL 16 and
  17:
  - catalog, grants, RLS, idempotent re-apply and N-1;
  - two connections racing 4N reservations for N slots (AC4);
  - replaying a request key (AC3);
  - settle, release and expire arithmetic;
  - an alert exactly once under concurrent crossing (AC7);
  - the guarded down script.
- **`backend/tests/test_ai_budget_fallback.py`**: `with_fallback`, the
  orchestrator, the JSON-repair rerun and each custom chain. A budget
  refusal or a 402 leads to zero further stub calls. 429, 529 and timeout
  still fall back, with a reservation for each attempt (AC1, AC8).
- **`backend/tests/test_ai_budget_speaking_deferred.py`**:
  - refusal before Whisper, with zero stub calls;
  - the recording stored and the row `awaiting_budget`;
  - one job, and no `grading_attempts` row;
  - a replay with the same `submission_id`;
  - a superseding revision;
  - the drain grading once in order;
  - the aggregate recomputed;
  - a crash between the provider response and persistence (FR-011 to
    FR-013, AC6).
- **`backend/tests/test_ai_budget_writing_deferred.py`**: a refused job
  stays `queued` with `budget_deferred_at`; no attempt is used, the reaper
  skips it, and the drain grades it once. This covers mock-exam and admin
  regrade triggers.
- **`backend/tests/test_ai_budget_quotas.py`**: grading, TTS and gist
  counters fail closed, and a value of zero or less is `config_invalid`.
  It also covers `runtime_flags` `on_error` (FR-006, AC9).
- **`backend/tests/test_ai_budget_alerts_sweeper.py`**: expiry,
  dispatch with backoff, heartbeat, and a non-zero exit when the DB is
  down (FR-014, FR-015).
- **`backend/tests/test_ai_budget_status_api.py`**: the status and admin
  shapes, `lookup_failed`, reason redaction for non-admins, and the admin
  refused like everyone else (FR-010, FR-016).
- **Frontend**:
  - vitest for the Speaking classifier branch and the `useAiStatus` gating;
  - a Next-native verifier per surface in `ui-states.md` (stubbed API),
    covering a reload and both themes (FR-017).

### Read-only operator queries

These are referenced by `rollout.md`. They make no writes, run in the
Supabase SQL editor or the runner, and print no secrets.

- **V1 — last month's spend by provider (Q1 default):**

  ```sql
  select service, model, round(sum(cost_usd_est)::numeric, 2) as usd,
         count(*) filter (where cost_source = 'unpriced') as unpriced_rows
  from ai_usage_logs
  where created_at >= date_trunc('month', now() at time zone 'utc') - interval '1 month'
    and created_at <  date_trunc('month', now() at time zone 'utc')
  group by 1, 2 order by 3 desc nulls last;
  ```

- **V2 — postconditions:** catalog, grants and RLS for the 333 objects
  (the same checks as the migration's `DO` block, as a `select`).
- **V3 — counter drift and estimate/actual ratio:**

  ```sql
  select c.scope, c.period_kind, c.period_start, c.settled_usd, c.reserved_usd,
         coalesce(sum(r.actual_usd) filter (where r.status in ('settled')), 0)
           + coalesce(sum(r.estimate_usd) filter (where r.status = 'expired'), 0) as settled_from_rows,
         coalesce(sum(r.estimate_usd) filter (where r.status = 'reserved'), 0) as reserved_from_rows
  from ai_budget_counters c
  left join ai_budget_reservations r
    on (c.scope = 'total' or c.scope = r.provider)
   and ((c.period_kind = 'month' and r.month_start = c.period_start)
     or (c.period_kind = 'day' and r.day_start = c.period_start))
  group by 1, 2, 3, 4, 5;
  -- ratio per feature
  select feature,
         min(estimate_usd / actual_usd) as min_ratio,              -- must be >= 1.0
         count(*) filter (where actual_usd > estimate_usd) as underestimated,  -- must be 0
         percentile_cont(0.5) within group (order by estimate_usd / actual_usd) as median_ratio  -- must be <= 3.0
  from ai_budget_reservations where status = 'settled' and actual_usd > 0 group by 1;
  ```

- **V4 — stuck reservations (sweeper health):**

  ```sql
  select count(*), min(created_at) from ai_budget_reservations
  where status = 'reserved' and created_at < now() - interval '1 hour';
  ```

- **V5 — exactly-once grading for deferred items** (the expected result is
  zero rows):

  ```sql
  select j.resource_id, count(*) filter (where l.status = 'success') as successes
  from ai_deferred_grading_jobs j
  join ai_usage_logs l on l.resource_id = j.resource_id::text and l.feature = 'speaking_grading'
  where j.status = 'done'
  group by 1 having count(*) filter (where l.status = 'success') > 1;
  ```

  The Writing equivalent joins `writing_jobs` to `writing_feedback` per
  essay.
- **V6 — the kill switch:** the `[ai_budget] decision=refuse
  reason=kill_switch` log appears for the first request after the
  deployment with the variable serves. No ledger row is written after that
  timestamp.
- **V7 — alerts:**

  ```sql
  select scope, period_kind, period_start, threshold, send_status, attempts, sent_at
  from ai_budget_alerts order by created_at desc limit 50;
  ```
