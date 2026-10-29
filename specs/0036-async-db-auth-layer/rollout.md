# Rollout and rollback

## Preconditions

- ASYNCAUTH-0036 approved on `staging` (this spec).
- Implementation PR #1805 rebuilt on the approval commit, governance green,
  merged to `staging` with `USE_ASYNC_DB` unset or false on Railway staging.
- `/health/async-db` on staging reports `use_async_db: false` for the merged
  SHA, and the startup log shows `[async-db] USE_ASYNC_DB=off`. Read
  `async_client_initialised` only right after a restart, before any traffic
  (see "Flag state evidence" below).
- Baseline from #1795 is on record: the 1-hour log window 02:12–03:12Z and the
  A/B probe 04:16–04:18Z on 2026-10-28 (PR #1805 body).

## Staging

Measurement plan (FR-006). Tools are the PC-J05 scripts (GET only, staging
only): `measure.mjs` (browser waterfall per page, QA_ACTIVE storage state),
`ab.py` (sequential vs parallel A/B), `agg.py` / `solo.py` (p50/p95 per route
from `railway logs -e staging -s ielts-speaking-coach --http --json`), plus the
`[loop-lag]` log lines and `GET /health/async-db`.

1. **Flag off, merged SHA.** Record the deployed SHA. Run `measure.mjs` for
   `/home`, `/writing/dashboard`, `/my-class` and `/instructor`, and `ab.py`,
   with 3–5 concurrent QA sessions. Keep at least a 30-minute log window.
   Capture the JSON of `/auth/check-active`, `/auth/me`,
   `/api/student/permissions` and `/api/student/home-summary` for QA_ACTIVE, an
   inactive QA learner, the QA instructor and the staging E2E admin.
2. **Flip.** The Leader sets `USE_ASYNC_DB=true` on Railway staging and
   restarts. The agent does not change Railway variables. Confirm the startup
   log `[async-db] USE_ASYNC_DB=on — async client initialised` and
   `/health/async-db` `use_async_db: true`, `async_client_initialised: true`.
3. **Flag on, same SHA.** Repeat step 1 with the same accounts, load and window
   length.
4. **Record on the PR:**
   - p50/p95 (server `totalDuration`) for `/auth/check-active`, `/auth/me`,
     `/api/student/permissions`, `/api/student/home-summary`, `/api/class/me`,
     `/api/writing/my-essays` and the six `/instructor/*` dashboard GETs;
   - page-burst totals for `/home`, `/writing/dashboard` and `/instructor`;
   - loop-lag p95 and max;
   - 5xx and 401/403/503 counts per route;
   - the parity diff of the captured JSON, which must be empty apart from
     timestamps.

Keep the flag on only if all of these hold: the parity diff is empty; there is
no rise in 5xx or 401/403/503 counts; Speaking grading shows no new failures;
and lag p95 plus the three auth endpoints' p95 are lower than in step 1.
Otherwise roll back (see the triggers below).

## Production

- Promotion with the flag **off**: production runs the FR-001 sync path, plus
  concurrent home-summary. Before the promotion, confirm that `USE_ASYNC_DB` is
  unset or false on Railway production.
- Since #1890 the shared async transport has bounded timeouts (connect 5 s,
  read/write 15 s, pool 5 s; `backend/database.py:62`, used at `:99`). They
  reach production with the next promotion even with the flag off, because
  the flag-independent async callers listed under "Flag state evidence" use
  the same transport. Their effect and the open option to separate the
  transports are in `verification.md` § "Shared async transport with the flag
  off (PC-J68 F1)".
- Enabling the flag on production needs Vinh's separate go after the staging
  evidence. Then repeat the staging steps 2–4 with read-only checks and the
  same rollback.

## Rollback and repair

- **Flag rollback (FR-007):** set `USE_ASYNC_DB=false` on the Railway service
  and restart. The rollback evidence is `/health/async-db` reporting
  `use_async_db: false` together with the startup log line
  `[async-db] USE_ASYNC_DB=off` for the new deployment. `async_client_initialised:
  false` is only evidence when it is read right after the restart, before any
  traffic (see "Flag state evidence" below). No code revert, migration or data
  repair.
- **Triggers:**
  - any parity difference;
  - a rise in 5xx or 401/403/503 on a converted route;
  - `async_client_initialised: false` while the flag is on;
  - httpx/PostgREST connection, GOAWAY or pool errors in the logs;
  - new Speaking grading failures;
  - the auth endpoints' p95 is not lower than with the flag off.
- **Code rollback:** revert the implementation merge. Concurrent home-summary
  then also returns to sequential. No schema or data impact.
- **Repair:** none needed. The converted paths only read, except the existing
  `/auth/me` first-visit insert and the `last_seen_at` update, which keep their
  sync-path semantics.

## Flag state evidence

`async_client_initialised` and `postgrest_pool` on `/health/async-db` show
whether the shared async client exists (`backend/database.py:189`, `:193`;
`backend/routers/health.py:286`, `:289`). They do not show the flag. With the
flag off, startup does not build the client (`backend/main.py:731–738`) and
`aexecute` uses the sync client (`backend/services/db_async.py:161–164`), but
these modules call `database.get_supabase_async()` (`backend/database.py:182`)
directly, whatever the flag, and build the client on first use:

- `backend/services/ai_usage_logger.py:476`, `:494` (`ai_usage_logs` ledger
  write and its legacy fallback) and `:592`, `:605` (`sessions.estimated_cost_usd`
  refresh). The `log_*_async` ledger helpers run after AI calls in Speaking
  grading and other AI features;
- `backend/services/core_attempt_outcomes.py:213`, `:244`, `:260`,
  `core_attempt_aggregate.py:172`, `core_attempt_inspection.py:136`, `:152`,
  `core_exam_result_proofs.py:68` and `core_operation_correlation.py:129`.

After the first such call, a flag-off service reports
`async_client_initialised: true` and a non-null `postgrest_pool`. The lazy
build predates this spec. So:

- the decisive flag-off evidence is `use_async_db: false` plus the
  `[async-db] USE_ASYNC_DB=off` startup line of the deployment being checked;
- `async_client_initialised: false` confirms the restart only if it is read
  right after the restart, before any traffic;
- with the flag on, `async_client_initialised: false` is still a rollback
  trigger, because startup builds the client when the flag is on.

FR-007 in `spec.md` still names `async_client_initialised: false` as the
post-rollback state. This file does not change the requirement; it records
when that field can be trusted.

## Observability

- `GET /health/async-db`: flag, client state, and rolling `event_loop_lag`.
- `[loop-lag]` log line about every 60 s; `[async-db]` startup line.
- Railway HTTP logs (`totalDuration`, status per route).
- With `ENABLE_SERVER_TIMING` on, the `db` stage of home-summary sums across
  threads, as it does for `/api/dashboard/init`.
- Owner: Vinh (product). The Leader flips and rolls back the flag; the
  implementing agent records the FR-006 evidence on the PR.
