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
  - **Soft scope (FR-021).** A line for `anthropic` is sent to the RPC with
    `mode: "soft"`, which records it without a cap check. If the RPC fails
    and **every** line in the request is soft, `guard` logs
    `[ai_budget] decision=allow_unrecorded scope=anthropic feature=…` and
    yields an unreserved handle whose settle and release are no-ops. If any
    line is hard, the whole request raises
    `AIBudgetRefused("budget_unavailable")` as before. The kill switch and a
    closed `provider_spend_limit` day are checked for soft lines too.
- **`services/ai_budget_config.py`** parses the `AI_BUDGET_*` variables and
  the existing per-user caps into scope caps and per-scope
  `config_invalid` flags (FR-003, FR-006). The values are logged at
  startup without secrets.
  - Defaults: `ANTHROPIC` 100, `GOOGLE` 20, `AZURE` 20. `TOTAL` has no
    default.
  - `SCOPE_MODES = {"anthropic": "soft"}`, and every other scope is
    `hard`. This is a constant, not a variable (FR-003). Changing it needs
    a spec revision.
  - An invalid Anthropic value marks the scope `config_invalid` for the
    panel and sends `month`/`day` null with `mode: "soft"`, so no
    threshold is evaluated and nothing is refused.
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
  2. records expired raises (`fn_ai_budget_raise_expire_sweep`, FR-022);
  3. dispatches alerts;
  4. drains the queue;
  5. writes the heartbeat.
- **`routers/ai_budget.py`**: `GET /ai/status` (signed-in) and
  `GET /admin/ai/budget` (`require_admin`). Registered in `main.py`.
  - `POST /admin/ai/budget/raises` and
    `POST /admin/ai/budget/raises/{id}/end` (FR-022) use `require_admin`
    plus `require_admin_aal2_for_money()`. Until ADMINAAL2-0032's AAL2
    reader exists, that dependency is a no-op. Once the reader exists, it
    returns 403 `mfa_required` for any token whose `aal` is not `aal2`,
    whatever `ADMIN_AAL2_ENFORCE` is. A test pins that the dependency
    switches on when the 0032 reader is importable.
  - The routes delegate to `services/ai_budget_raise.py`.
  - Input validation (whole dollars, 1–72 hours, a 1–500 character reason,
    a known scope) happens in the route. The scope, cap and frequency
    limits are enforced again in the SQL function, which is the authority.
  - The route passes the base caps from `ai_budget_config` and the caller's
    id and `aal`. It never trusts a client-sent cap.

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
     `reason text`, `grading_attempt_id uuid null` (FR-012 compensation), `persisted_at timestamptz null`, `commit_count int not null default 0`, `attempts int not null default 0`,
     `lease_until timestamptz`, `lease_token uuid null`,
     `enqueued_at timestamptz not null default now()`,
     `finished_at`, `last_error text`.
   - Unique: `(kind, resource_id, submission_revision)`.
   - The marker, the canonical result and the job completion commit in
     **one transaction**, through `fn_ai_deferred_commit` (item 7). There
     is no separate claim step, so a crash or writer failure before that
     commit leaves the job reclaimable when its lease expires, with no
     marker set. A crash after the commit leaves a complete result and a
     `done` job.
   - Companion table **`ai_deferred_session_refresh`** holds the durable,
     session-scoped obligation to refresh a session's aggregate.
     - Columns: `session_id uuid pk`, `generation bigint not null default
       0`, `refreshed_generation bigint not null default 0`,
       `updated_at timestamptz`. `refreshed_generation` is the generation
       that the persisted band reflects. A refresh is owed while
       `refreshed_generation < generation`.
     - `fn_ai_deferred_commit` increments `generation` in the same
       transaction as the result (item 7), whatever the session's status.
       Every response change that a drain makes in a session therefore
       moves that session's generation, including while the session is
       still `in_progress`.
     - Only two functions write a session's bands, and both lock this row
       and check `generation` in the same transaction as the session
       write: `fn_ai_session_complete_write` for `PATCH /complete`, and
       `fn_ai_deferred_aggregate_write` for the sweeper refresh. A crash
       between the commit and the refresh leaves the obligation owed, and
       a later sweep repeats the refresh.
     - An owed generation on an `in_progress` session is not sweeper work.
       `PATCH /complete` reads the responses after it and writes the band.
     - RLS is enabled. `service_role` has SELECT only; writes go through
       the functions.
   - Indexes: `(status, enqueued_at, id) where status='queued'`, and
     `(lease_until) where status='running'` for lease reclamation.
   - `service_role`: SELECT, INSERT, UPDATE.
4. **`writing_jobs` budget-drain columns** (additive, nullable or with a
   constant default, no CHECK change):
   - `budget_deferred_at timestamptz null`;
   - `budget_lease_token uuid null` and `budget_lease_until timestamptz
     null`, which hold drain ownership;
   - `budget_drain_count int not null default 0`, which numbers the drain
     runs for the reservation `request_key`;
   - `budget_persisted_at timestamptz null` and `budget_commit_count int
     not null default 0`, which are the drain's persistence marker.

   These are separate from `attempt_count` and `max_attempts`. The live
   worker fences ownership with `attempt_count`
   (`essay_service.py:171-204`), and that counter is the Writing retry
   allowance, which a budget deferral must not use (FR-011). A drain
   never reads or writes `attempt_count`. There is a partial index on
   `(budget_deferred_at, id)` for rows where `budget_deferred_at` is not
   null and the status is `queued` or `running`.
5. **`ai_budget_alerts`**
   - Columns: `id uuid pk`,
     `kind text not null default 'threshold' check (kind in ('threshold','raise_granted','raise_ended','raise_expired'))`,
     `raise_id uuid null references ai_budget_raises`, `scope`,
     `period_kind`, `period_start`,
     `threshold int null check (threshold in (50,80,100))`,
     `trigger text null check (trigger in ('crossing','cap_refusal','provider_spend_limit'))`,
     `committed_usd`, `cap_usd`, `created_at`,
     `send_status text check (in ('pending','sent','failed')) default 'pending'`,
     `attempts int`, `next_attempt_at`, `sent_at`, `last_error`.
   - CHECK: `kind = 'threshold'` requires `threshold` and `trigger` and a
     null `raise_id`. A raise kind requires `raise_id` and a null
     `threshold`.
   - Unique partial indexes: `(scope, period_kind, period_start,
     threshold) where kind = 'threshold'` (FR-015), and `(raise_id, kind)
     where kind <> 'threshold'` (FR-022).
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
     - `p_caps` maps each scope to `{month, day, mode}` (null `month`/`day`
       means no per-provider cap). It comes from the caller's
       environment. FR-003 validation happens before the call. The
       function also rejects hard caps of zero or less.
     - `mode = 'soft'` lines (FR-021) are inserted and counted on their
       own scope's counters, but they are never compared with a cap and
       are not added to `total`. Soft thresholds are still evaluated for
       alerts when the scope's cap is not null.
     - The effective cap of a hard scope is `p_caps` plus the `amount_usd`
       of its active raise (item 10: `ended_at is null and expires_at >
       now()`), read after the counter rows are locked.
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
       any `closed_reason` is set (soft scopes included, FR-009) or any
       hard scope's `settled + reserved + Σestimate` would exceed its
       effective cap.
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
   - **`fn_ai_deferred_commit(p_job_id uuid, p_lease_token uuid, p_result jsonb)`**
     commits a deferred result atomically.
     - `p_result` holds the Speaking `responses` column patch and the
       `grammar_recommendations` rows. The live route's mapper produces
       both, so the canonical shape is unchanged.
     - In one transaction the function:
       1. locks the job row and the target `responses` row;
       2. returns `duplicate` with no write when the job is already
          `done` or `persisted_at` is set;
       3. returns `lease_lost` when the lease token does not match;
       4. marks the job `superseded` and returns `superseded` when the
          response no longer carries the job's submission revision;
       5. otherwise updates the response (`grading_status = 'completed'`
          and scores), replaces that response's grammar recommendations,
          sets `persisted_at = now()`, `commit_count = commit_count + 1`
          and `status = 'done'`. It then upserts the response's session's
          `ai_deferred_session_refresh` row with `generation + 1`, for
          every session status, and returns `committed`. It does not read
          or lock the `sessions` row.
     - Writing uses `fn_ai_deferred_commit_writing(p_writing_job_id,
       p_lease_token, p_result)`. It validates ownership against the
       item 4 columns, not against `attempt_count`. In one transaction it:
       1. locks the `writing_jobs` row and its essay;
       2. returns `duplicate` with no write when `budget_persisted_at` is
          set or the job is `completed`;
       3. returns `lease_lost` when `budget_lease_token` is null or does
          not match;
       4. returns `superseded`, with no write, when the essay is no longer
          `pending` or `grading`, or the job is no longer budget-deferred;
       5. otherwise inserts the `writing_feedback` row (with `job_id`),
          updates the essay, sets the job `completed`,
          `budget_persisted_at = now()` and `budget_commit_count + 1`, and
          returns `committed`.
   - **`fn_ai_deferred_aggregate_write(p_session_id uuid, p_generation bigint, p_bands jsonb)`**
     writes a refreshed aggregate under a generation check. In one
     transaction it:
     1. locks the session's `ai_deferred_session_refresh` row
        `FOR UPDATE`, which serialises every band write for that session
        with `fn_ai_session_complete_write` and with drain commits;
     2. returns `stale`, with no write, when `generation <> p_generation`;
     3. returns `not_completed`, with no write, when the session's status
        is not `completed`;
     4. otherwise writes `overall_band` and the criteria bands from
        `p_bands` to the session, sets `refreshed_generation =
        p_generation`, and returns `written`.

     The caller reads `generation` **before** it reads the responses, and
     reads `0` when the session has no row. Suppose a commit lands for
     the session after that snapshot, while another writer is computing.
     The commit moves `generation`, so the computation that missed it
     gets `stale`, writes nothing and leaves the obligation owed. A
     writer that read the newer generation then writes the band covering
     both results. Bands are therefore never written and acknowledged
     from a response set older than the latest drain commit.
   - **`fn_ai_session_complete_write(p_session_id uuid, p_generation bigint, p_patch jsonb, p_from_in_progress boolean, p_acknowledge boolean)`**
     is the only way `PATCH /complete` writes the session. `p_patch` is
     the route's existing `update_payload` (status `completed`,
     `overall_band`, the non-null criteria bands and, only when unset,
     `completed_at`). In one transaction it:
     1. inserts the session's `ai_deferred_session_refresh` row as
        `(generation 0, refreshed_generation 0)` when it is absent, then
        locks it `FOR UPDATE`;
     2. when `p_acknowledge` is true, returns `stale`, with no write, when
        `generation <> p_generation`;
     3. when `p_from_in_progress` is true, returns `not_applied`, with no
        write, unless the session is still `in_progress` and
        `resume_expires_at > now()`. This is the route's current
        conditional update, unchanged;
     4. otherwise writes `p_patch` to the session and sets
        `refreshed_generation = p_generation`, then returns `written`.
        With `p_acknowledge` false and a newer `generation`, the row
        stays owed.

     Lock order is the same everywhere: a drain commit locks the job, the
     response, then the refresh row, and never the session row; both
     band writers lock the refresh row, then the session row. There is no
     lock cycle.
   - **`fn_ai_deferred_claim(p_limit int, p_lease_seconds int)`** claims
     queued jobs `FOR UPDATE SKIP LOCKED` in `enqueued_at, id` order.
     It also reclaims `running` jobs whose `lease_until` has passed, so a
     job left `running` by a dead worker is resumed by a later sweep.
     - Every claim, first or reclaim, sets `status = 'running'`, a new
       `lease_token`, `lease_until = now() + p_lease_seconds` and
       `attempts = attempts + 1`.
     - The new `attempts` gives the reclaimed run a new `request_key`
       (job id plus `attempts`). The dead worker's reservation is
       therefore never replayed as a grant. It is settled at its estimate
       by `fn_ai_budget_expire` (FR-004), unless the dead worker settled
       it first.
     - A stale worker that outlives its lease still holds the old token.
       Its `fn_ai_deferred_commit` returns `lease_lost` and writes
       nothing, so only the current lease holder can persist.
   - **`fn_ai_deferred_claim_writing(p_limit int, p_lease_seconds int)`**
     works the same way on `writing_jobs` rows where `budget_deferred_at`
     is not null. It claims `queued` rows, and `running` rows whose
     `budget_lease_until` has passed, `FOR UPDATE SKIP LOCKED` in
     `budget_deferred_at, id` order.
     - Each claim sets `status = 'running'`, a new `budget_lease_token`,
       `budget_lease_until` and `budget_drain_count + 1`. It leaves
       `attempt_count`, `max_attempts` and `started_at` unchanged. The
       drain's `request_key` is the Writing job id plus
       `budget_drain_count`.
     - A crashed drain is reclaimed after its lease expires, by the same
       rule as Speaking. The in-process reaper skips every row with
       `budget_deferred_at` set, so it never competes with the drain.
       A stale drain's commit returns `lease_lost`.
     - A drain refused again for budget returns the row to `queued` and
       clears the lease, leaving `budget_deferred_at` set.
   - **Sweeper drain order.** A refresh has four steps:
     1. read the session's `generation`;
     2. compute the bands with the canonical `_compute_session_bands`;
     3. call `fn_ai_deferred_aggregate_write` with that generation;
     4. on `stale`, start again from step 1, at most 3 times in this
        sweep. Anything still owed is left for the next sweep.

     It does not call `PATCH /complete`, whose early return keeps an
     existing non-null band (`routers/sessions.py:2094-2102`). A refresh
     makes no provider call and needs no reservation, so it runs even
     while scopes are closed. The sweeper runs one for every `completed`
     session with `refreshed_generation < generation` first. It runs
     another after each `committed` result whose session is `completed`.
     Then it claims new jobs. `not_completed` ends the refresh for that
     session; `PATCH /complete` owns the band of an `in_progress`
     session.
   - **`PATCH /sessions/{id}/complete` finalisation** (`routers/sessions.py`,
     T006). The route keeps its early return for a completed session
     with a non-null band, its 422 gates and its fresh-reload handling of
     a conditional update that matched no row. It changes only how the
     band is read and saved:
     1. read the session's `generation` (`0` when it has no row);
     2. compute the bands with `_compute_session_bands`, as today;
     3. build the existing `update_payload` and call
        `fn_ai_session_complete_write` with that generation,
        `p_from_in_progress` set when the loaded session was
        `in_progress`, and `p_acknowledge` true;
     4. on `stale`, start again from step 1, at most 3 times. When the
        third attempt is still `stale`, call it once more with
        `p_acknowledge` false. The learner's completion succeeds, the
        row stays owed because `refreshed_generation` is the generation
        that was read, and the next sweep refreshes the band, which is
        now `completed`;
     5. `not_applied` takes the route's current path for an update that
        matched no row.

     So a drain commit that lands between the route's response read and
     its session write is never lost. Either the write is `stale` and
     the route recomputes with that result, or the band is written
     unacknowledged and the sweeper owes the refresh.
8. **Postconditions.** A `DO` block raises if any of the following does not
   hold (item 10 objects included):
   - every table exists with RLS enabled;
   - `anon` and `authenticated` hold no privilege on any of the objects;
   - each function exists with `prosecdef` and the pinned `search_path`;
   - the unique indexes exist;
   - the item 4 `writing_jobs` columns exist.
9. **Down script** (in the header, guarded). It aborts unless
   `ai_deferred_grading_jobs` has no `queued` or `running` rows,
   no `completed` session owes a refresh in `ai_deferred_session_refresh`, no `writing_jobs` row has
   `budget_deferred_at` set while `queued` or `running`, and no raise is
   active. It keeps `ai_budget_raise_events` as an exported audit record
   before any drop.
10. **Budget-raise objects (FR-022).** Created before item 5, because the
    alerts reference them.
    - **`ai_budget_raises`**: `id uuid pk`,
      `scope text check (scope in ('total','google','azure','openai','elevenlabs'))`,
      `amount_usd numeric(10,2) check (amount_usd >= 1 and amount_usd = trunc(amount_usd) and amount_usd <= 50)`,
      `base_month_cap_usd numeric(12,4)`, `granted_at`,
      `expires_at` (CHECK: between 1 and 72 hours after `granted_at`),
      `granted_by uuid`, `granted_aal text`, `reason text` (CHECK:
      1–500 characters), `ended_at null`, `ended_by null`,
      `end_kind text null check (in ('ended_early','expired'))`,
      `end_reason null`, `request_id`. There is a unique partial index
      `(scope) where ended_at is null`. `service_role`: SELECT only.
    - **`ai_budget_raise_events`**: append-only. `id`, `raise_id`,
      `event text check (in ('granted','ended_early','expired'))`, `scope`,
      `amount_usd`, `base_month_cap_usd`, `effective_month_cap_usd`,
      `expires_at`, `actor_id null` (null for `expired`), `actor_aal`,
      `request_id`, `reason`, `created_at`. It is unique on
      `(raise_id, event)`. `service_role`: SELECT only. A trigger refuses
      `UPDATE` and `DELETE` for every role.
    - **`fn_ai_budget_raise_grant(p_scope, p_amount_usd, p_hours, p_reason, p_actor, p_actor_aal, p_base_caps jsonb, p_request_id)`**
      upserts and locks the scope's current month counter row, the same
      lock the reserve function takes. It ends any raise of that scope whose
      `expires_at <= now()` as `expired`, with its event and alert. Then it
      refuses `scope_not_raisable` (soft or unknown scope),
      `scope_config_invalid` (null or ≤ 0 base cap),
      `amount_out_of_range` (above the base monthly cap or $50),
      `raise_active` or `raise_limit_reached` (three grants this UTC month).
      Otherwise it inserts the raise, the `granted` event and the
      `raise_granted` alert, and returns the raise with its effective
      caps. Every refusal writes nothing.
    - **`fn_ai_budget_raise_end(p_raise_id, p_actor, p_actor_aal, p_reason, p_request_id)`**
      sets `ended_at`, `end_kind = 'ended_early'` and the event and alert
      once. It returns `not_active` for an ended or expired raise.
    - **`fn_ai_budget_raise_expire_sweep(p_now)`** ends every raise past
      `expires_at` as `expired`, with its event and alert, and returns the
      count. The cap reverts without it, because the reserve function
      checks `expires_at` directly.

N-1 compatibility: the deployed backend does not read these objects, and
the `writing_jobs` columns are nullable or have a constant default, so
the live Writing worker and reaper are unaffected.

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
   "scopes": [{"scope", "enforcement": "hard|soft", "period_kind",
               "period_start", "base_cap_usd", "effective_cap_usd",
               "cap_usd", "settled_usd", "reserved_usd", "committed_usd",
               "percent", "state", "config_error"}],
   "raises": {"active": [{"id", "scope", "amount_usd", "expires_at",
                          "granted_by_email", "reason"}],
              "used_this_month": {"<scope>": 0}},
   "queue": {"speaking_queued", "writing_deferred", "oldest_enqueued_at"},
   "reservations": {"open", "expired_last_24h"},
   "alerts": [{"scope", "period_start", "threshold", "send_status", "sent_at"}],
   "sweeper": {"last_run_at", "stale"}, "lookup_failed": false}
  ```

  `cap_usd` equals `effective_cap_usd`, kept for the panel's percentage.
  For the soft scope, `state` is `open` or `over_soft_budget` and never a
  refusal state.
- **`POST /admin/ai/budget/raises`** takes
  `{scope, amount_usd, duration_hours, reason}` and returns 201 with the
  raise and its effective caps. It returns 422 for input validation, 409
  with `error_code` set to one of the item 10 refusals, 403 `mfa_required`
  (FR-022), and 503 `budget_unavailable` on an RPC failure.
  **`POST /admin/ai/budget/raises/{id}/end`** takes `{reason}` and returns
  200, 409 `not_active`, 403 or 503 in the same way.

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
  `instructor-dashboard.tsx`; the admin panel in `admin-overview.tsx`; the
  raise form and active-raise list in a new
  `admin-ai-budget-raise.tsx` used by that panel. It confirms before
  submitting and refetches `GET /admin/ai/budget` after every mutation,
  with no optimistic state.

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
| Budget raise (FR-022) | `routers/ai_budget.py` (raise routes), `services/ai_budget_raise.py`, `frontend/app/(authed-admin-overview)/admin/admin-ai-budget-raise.tsx` |
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
  AC2, AC5, AC9). It also covers the soft scope: the defaults 100/20/20,
  no refusal over budget, `allow_unrecorded` for a soft-only request on
  an RPC failure, and refusal of a mixed bundle (FR-021, AC10, AC11).
- **`backend/tests/test_migration_333_ai_budget.py`**, on PostgreSQL 16 and
  17:
  - catalog, grants, RLS, idempotent re-apply and N-1;
  - two connections racing 4N reservations for N slots (AC4);
  - replaying a request key (AC3);
  - settle, release and expire arithmetic;
  - soft lines recorded without a cap check and excluded from `total`;
    effective cap with an active raise, and the base cap the moment
    `expires_at` passes; the raise function's refusals, the
    one-active-raise index, three grants a month, and events that refuse
    `UPDATE`/`DELETE` (FR-021, FR-022);
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
  - the aggregate recomputed, including after a worker is killed just
    after `fn_ai_deferred_commit` (the next sweep refreshes the band
    from the owed generation). Two jobs for one completed session are
    interleaved so that refresh A reads before B commits and writes
    after B's refresh: A gets `stale`, and the final band includes both
    results once nothing is owed;
  - completion racing a drain commit (`PATCH /complete` fence). A session
    with one graded response and one deferred job is completed while the
    job commits: completion reads `generation` and the responses, the
    drain commits, then completion writes. The write returns `stale`,
    completion recomputes, and the persisted `overall_band` includes the
    deferred result with nothing owed and no further submission or
    `/complete` call. With the commit forced to land before each of three
    attempts, completion still succeeds through the unacknowledged write,
    the row stays owed, and the next sweep writes the band that includes
    the result. A commit for an `in_progress` session moves `generation`
    and the sweeper does not refresh that session;
  - a crash between the provider response and persistence (FR-011 to
    FR-013, AC6).
- **`backend/tests/test_ai_budget_writing_deferred.py`**: a refused job
  stays `queued` with `budget_deferred_at`; no attempt is used, the reaper
  skips it, and the drain grades it once. A drain killed after claim is
  reclaimed after `budget_lease_until`, the stale drain's commit returns
  `lease_lost`, and `attempt_count` is unchanged throughout. This covers
  mock-exam and admin regrade triggers.
- **`backend/tests/test_ai_budget_quotas.py`**: grading, TTS and gist
  counters fail closed, and a value of zero or less is `config_invalid`.
  It also covers `runtime_flags` `on_error` (FR-006, AC9).
- **`backend/tests/test_ai_budget_alerts_sweeper.py`**: expiry,
  dispatch with backoff, heartbeat, and a non-zero exit when the DB is
  down (FR-014, FR-015).
- **`backend/tests/test_ai_budget_status_api.py`**: the status and admin
  shapes, `lookup_failed`, reason redaction for non-admins, and the admin
  refused like everyone else (FR-010, FR-016).
- **`backend/tests/test_ai_budget_raise.py`**: the raise routes for a
  learner, an instructor, an active admin, and an AAL1 versus an AAL2
  admin once the 0032 reader is present. It covers every input and limit
  refusal with no row, event or email; one alert row per grant, end and
  expiry; the sweeper's expiry event; and an RPC failure → 503 with
  nothing written (FR-022, AC12).
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

- **V5 — exactly-once persistence for each deferred revision.** This
  correlates on the job and its submission revision, never on ledger
  success rows. One correct grade can produce several successful
  `speaking_grading` ledger rows (JSON repair, grounded-answer
  regeneration), and a response can have several revisions. Every query
  below must return zero rows.

  ```sql
  -- (a) a done job without the persistence marker, or a marker without done
  select id, kind, resource_id, submission_revision, status, persisted_at
  from ai_deferred_grading_jobs
  where (status = 'done') <> (persisted_at is not null);
  -- (b) more than one committed result for the same revision
  select kind, resource_id, submission_revision, sum(commit_count) as commits
  from ai_deferred_grading_jobs
  group by 1, 2, 3 having sum(commit_count) > 1;
  -- (d) a completed session whose aggregate refresh has been owed for over 15 minutes
  select r.session_id, r.generation, r.refreshed_generation, r.updated_at
  from ai_deferred_session_refresh r
  join sessions s on s.id = r.session_id and s.status = 'completed'
  where r.refreshed_generation < r.generation
    and r.updated_at < now() - interval '15 minutes';
  -- (e) Writing: drain marker and completion disagree, or more than one drain commit
  select id, status, budget_persisted_at, budget_commit_count from writing_jobs
  where budget_deferred_at is not null
    and (budget_commit_count > 1
      or (budget_persisted_at is not null and status <> 'completed'));
  -- (c) Writing: more than one feedback row persisted by deferred drains for one job
  select f.job_id, count(*) from writing_feedback f
  join writing_jobs w on w.id = f.job_id
  where w.budget_deferred_at is not null
  group by 1 having count(*) > 1;
  ```

  The `writing_feedback.job_id` linkage is confirmed or added in T007.
  If that column does not exist, T007 records the drain's job id on the
  feedback row, so (c) keys on the job and not on the essay.

- **V6 — the kill switch:** the `[ai_budget] decision=refuse
  reason=kill_switch` log appears for the first request after the
  deployment with the variable serves. No ledger row is written after that
  timestamp.
- **V7 — alerts:**

  ```sql
  select kind, scope, period_kind, period_start, threshold, send_status, attempts, sent_at
  from ai_budget_alerts order by created_at desc limit 50;
  ```
- **V8 — raises (FR-022):**

  ```sql
  select r.scope, r.amount_usd, r.granted_at, r.expires_at, r.end_kind,
         (select count(*) from ai_budget_raise_events e where e.raise_id = r.id) as events,
         (select count(*) from ai_budget_alerts a where a.raise_id = r.id) as alerts
  from ai_budget_raises r order by r.granted_at desc limit 20;
  ```

  Every ended raise has two events and two alerts, and an active raise
  has one of each.
