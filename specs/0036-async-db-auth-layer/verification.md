# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_async_auth_db_layer.py (flag-off never touches the async client; same results as the sync path) plus backend/tests/test_async_db_scaffold.py (flag default off) and the staging `/health/async-db` check after merge | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_async_auth_db_layer.py (live permissions, account summary, gate 403/503 and memo, staff guards per role and activation state plus the 503 lookup-failure path, `/auth/me` incl. provisioning and error contract, `/auth/check-active` incl. the 503 lookup-failure contract, `/api/student/permissions`: same result, status/detail and query sequence in both flag states) plus backend/tests/test_async_auth_fail_closed_http.py (flag on over a real async client: gate, staff guards and `/auth/check-active` lookup failures are 503, never active or staff) plus the staging same-account parity diff; open failure: PC-J68 F6 (§ "Open parity failure in lookup-failure cases") | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_async_auth_db_layer.py (flag-on never touches the sync singleton, concurrent gate lookups overlap on one loop, async pool HTTP/1.1, closed on shutdown) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_student_home_aggregator.py (behaviour tests against sequential and concurrent builders) plus backend/tests/test_async_auth_db_layer.py (per-thread clients, sections overlap) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_async_db_scaffold.py (exact facade allowlist, `admin.py` guard-only pin) | PENDING |
| FR-006 | Staging measurement and parity record per `rollout.md` on the implementation PR, against the deployed SHA | PENDING |
| FR-007 | Staging rollback rehearsal or recorded `/health/async-db` state after a flag-off restart | PENDING |

## Contract evidence

- OpenAPI/type drift: none expected; `frontend/types/api.d.ts` unchanged.
- Backward compatibility: no response shape change in either flag state.

## Data evidence

- No schema change. Query-sequence equality is pinned by the parity tests.

## UI evidence

- No UI change; staging page waterfalls only (`rollout.md`).

## Stall 29/10 (PC-J55)

Run: staging deploy 6f9f536e (`USE_ASYNC_DB=true`), harness `load_staging.py on`
02:51:10–03:06:25 UTC+7, 4 QA_ACTIVE sessions, GET only. The client saw no
completion from 19:58:41.4Z to 20:00:04.9Z (83.5 s) and 10 ReadTimeouts (60 s) at
20:00:52Z. The OFF control run had none. Evidence and scripts are in
`/workspace/qa/leader-0129/` and `/workspace/qa/q14v-pc-j55/`.

**Cause: the load-generator VM was suspended (snapshot / "VM fork"). The backend
did not stall.**

1. **Client clocks diverged.** In every session the wall clock moved 71.27 s
   more than `perf_counter` across the gap. Sessions 0 and 2 sent their `/home`
   burst at 19:58:41.05Z and 19:58:41.11Z. Each burst has two timestamps:
   - its `t − ms` start reads 19:59:52.3Z;
   - its `/auth/check-active` finished at 19:58:41.05Z and 19:58:41.11Z.

   Session 3's gap is 71.79 s, which is 71.27 s plus its sleep. A server-side
   stall cannot make a client's monotonic clock lose time. A suspended guest
   loses it.
2. **The box records the suspension.** The kernel log has `random: crng
   reseeded due to virtual machine fork` at 20:00:02Z, which is the VM
   generation-ID notice on restore. The client's first post-gap requests start
   1.5 s later (20:00:03.5Z). Five earlier fork events also appear in the same
   kernel log (00:24–02:11 UTC+7). None of them falls inside the OFF window
   02:33–02:49.
3. **The backend answered every timed-out request at once.** The 10 timed-out
   requests were 2×`/auth/me`, 2×`/api/student/permissions`, 2×`/api/class/me`,
   2×`/api/student/home-summary`, 1×`/api/grammar/categories` and
   1×`/auth/check-active`. Railway's HTTP log has exactly that path multiset
   finishing with 200 between 19:58:41.8Z and 19:58:42.6Z, each in at most
   1.31 s. Their implied start times match the client's send times. The
   responses left the edge, but the suspended client never read them, so its
   dead sockets ran into the 60 s read timeout after it resumed. Railway does
   not log the harness `X-Request-ID`, so the pairing uses path, start time and
   duration.
4. **The server kept working through the gap.** Railway shows 71 more
   python-httpx requests at 19:59:25–19:59:38Z. All returned 200 in at most
   3.1 s, and they include a `/health/async-db` sample. None of them matches a
   recorded harness sample: 0 of 70 align at any clock offset near 0. By
   contrast, 68 of 77 align at 0 s before the gap and 438 of 459 after it.
   - The harness is closed-loop, and every session stays blocked from 19:58:41Z
     to 20:00:03Z, so it cannot have sent them.
   - They are most likely a forked copy of the VM running briefly. This cannot
     be proven from the server side.
   - Either way, the backend served them normally.
5. **The backend loop was never frozen.** The app log's `[loop-lag]` lines at
   19:58:35Z and 19:59:39Z are 64.7 s apart for a nominal 60 s interval. The
   120 s window ending 19:59:39Z has lag max 1307 ms and p95 478 ms. A frozen
   process would show one lag sample of 40 s or more.

The handoff hypotheses, one by one:

- **H1 (async PostgREST client wedged): ruled out as the cause of this stall.**
  The requests that "hung" finished on the server in at most 1.31 s, and other
  requests completed during the gap. A wedged shared pool would have shown long
  `totalDuration` or 502/504 edge entries. There were none.
  - The 120 s client timeout is still a real latent risk: one silently dead
    keep-alive socket would hold an auth check longer than any caller waits,
    with no server log. It is hardened below.
- **H2 (default executor exhausted): ruled out.**
  - `/auth/me`, `/auth/check-active` and `/api/grammar/categories` do not use
    `to_thread`. The last of these took 8 ms on the server.
  - The home-summary requests that timed out on the client finished in 0.9 s
    and 1.3 s on the server.
- **H3 (Supabase throttling): ruled out.** Server durations around the gap
  (19:58:30–42Z and 19:59:25–38Z) are the same as the rest of the run. No
  Supabase log was needed.
- **H4 (Railway edge or the network to it): narrowed to the client end.** The
  edge logged and delivered responses throughout. The gap is the client host's
  suspension, not the edge.

What changed. The retry and instrumentation apply only to flag-ON `aexecute`
calls. The flag-off branch of `aexecute` (`backend/services/db_async.py:182–185`)
and the sync transport (`backend/database.py:47–52`, `Timeout(120)`) are
unchanged. The bounded transport is not flag-only: it applies to every user of
the shared async client, including callers that use it with the flag off (see
"Shared async transport with the flag off" below).

- **Bounded transport.** `database.ASYNC_POSTGREST_TIMEOUT`
  (`backend/database.py:62`) is connect 5 s / read 15 s / write 15 s / pool
  5 s, replacing the single 120 s timeout. `database.ASYNC_POSTGREST_LIMITS`
  (`:63–65`) makes httpx's defaults explicit (100 / 20 / keep-alive 5 s). Both
  are set on the one async transport (`_build_supabase_async_http_client`,
  `:90–102`).
- **One retry for reads.** `aexecute` re-sends a GET/HEAD once after a
  dead-socket `httpx.TransportError` (`backend/services/db_async.py:54–66`,
  `:167–181`). The pool drops the failed connection, so the retry goes out on
  a fresh one. POST/PATCH/DELETE requests are never re-sent. Since #1910
  (PC-J84, closing PC-J68 F2) RPCs are never re-sent either, even when called
  with `get=True` or `head=True`, and a `PoolTimeout` is not retried.
- **Instrumentation.**
  - Each flag-ON call is timed. Slow calls (≥ 1 s) and failed calls are logged
    as `[async-db] slow|failed` with the request id, method, table, attempt
    number, and a total / pool-wait / connect / upstream split. Retries are
    logged as `[async-db] retry`. The query string is never logged, because
    filters carry user ids.
  - `/health/async-db` now also reports `aexecute` (calls, transport errors,
    retries, in-flight count, oldest in-flight age, p50/p95/max),
    `postgrest_pool` (connections, idle, active, waiting) and `executor`
    (default thread pool: busy and queued).
- **Tests.** `backend/tests/test_async_db_stall.py` runs against a loopback
  fake PostgREST:
  - the pre-fix transport is still waiting on a swallowed keep-alive request
    after 2 s;
  - after the fix a swallowed GET fails fast and succeeds on a second
    connection;
  - a GET that fails twice raises after exactly 2 attempts;
  - a write is never retried;
  - the pool-wait vs upstream split is correct.

Leader re-measurement (staging, flag ON, same harness, plus an OFF control
in the same time slot), still pending:

- 0 ReadTimeouts.
- No request over 10 s.
- No window of 10 s or more without a completed request.
- `/home` p50 ≤ 2.5 s at 4 concurrent sessions.
- 0 5xx responses.
- Identical parity.

Precondition: `dmesg | grep "virtual machine fork"` shows no event inside
either run window. Otherwise the run measures the load generator, not the
backend.

### Shared async transport with the flag off (PC-J68 F1)

These modules call `database.get_supabase_async()` (`backend/database.py:182`)
directly, whatever `USE_ASYNC_DB` is, and so use the transport above with the
flag off too:

- `backend/services/ai_usage_logger.py:476`, `:494`: the `ai_usage_logs`
  ledger write (upsert or insert) and its legacy-schema fallback insert;
- `backend/services/ai_usage_logger.py:592`, `:605`: the
  `sessions.estimated_cost_usd` refresh (paged read, then guarded update);
- `backend/services/core_attempt_outcomes.py:213`, `:244`, `:260`,
  `core_attempt_aggregate.py:172`, `core_attempt_inspection.py:136`, `:152`,
  `core_exam_result_proofs.py:68`, `core_operation_correlation.py:129`.

What this means since #1890:

- The 15 / 5 / 5 s limits apply to all of these callers. They reach production
  with the next promotion that contains #1890, even with the flag off. Saying
  that "production is unchanged" while the flag is off is therefore wrong for
  these callers.
- The AI ledger write and the session cost refresh now fail after 15 s read
  (5 s connect or pool wait) instead of 120 s. They do not go through
  `aexecute`, so nothing is retried and no `[async-db]` line is logged. A
  write that commits upstream after more than 15 s is logged as
  `[ai_usage] ledger write failed` although the row exists. No duplicate row
  follows, because the legacy fallback runs only on a schema error.
- Each `core_*` read runs under its own `asyncio.timeout` budget of 0.5–2 s,
  which fires well before the 15 s read limit, so they are not affected.
- With the flag off, the first such call builds the async client. After that,
  `/health/async-db` reports `async_client_initialised: true` and a non-null
  `postgrest_pool`. The lazy build predates this spec; the health comment
  "`None` with the flag off" (`backend/routers/health.py:280`) holds only until
  that first call. The FR-007 rollback evidence in `rollout.md` accounts for
  this.

Current state: option (b). The new timeouts apply to every caller of the
shared async client, as recorded here. Option (a) is still open: give the
flag-independent callers their own transport with the previous timeout, so
that only the `aexecute` pool uses the bounded one. Choosing between (a) and
(b) is for the Leader and Vinh; this record does not decide it.

### Open parity failure in lookup-failure cases (PC-J68 F6)

FR-002 asks for the same body, status and error detail in both flag states for
every lookup-failure case. Since #1890, a given transport fault does not always
end the same way in both states:

- With the flag on, a non-RPC GET/HEAD that fails with a dead-socket error
  (`ReadTimeout`, `ReadError`, `RemoteProtocolError`, `WriteError`,
  `ConnectError`; `backend/services/db_async.py:54–66`) is re-sent once and
  can succeed. With the flag off, the same fault returns the existing error:
  503 from the activation gate (`backend/services/activation_gate.py:166`)
  and the staff guards (`backend/services/staff_guard.py:257`, `:269`), and
  500 from `/auth/me` (`backend/routers/auth.py:231`, `:253`), and 503
  from `/auth/check-active` (`:334`; 500 before Revision 2).
- A read that takes between 15 s and 120 s succeeds with the flag off but
  fails with the flag on, with the same error responses.

This is a difference in status and body for the same lookup-failure case, so
it violates FR-002 and the approved status/error-detail parity
(`approval-decision.md` item 2), and it is a rollback trigger under "any parity
difference" in `rollout.md`. This record does not change the acceptance test:

- FR-002 stays PENDING while F6 is open. It can move to PASS only after the
  behaviour is fixed so both states end the same way, or after an approved
  spec revision that changes FR-002 for transport faults
  (`specs/_meta/constitution.md`). Choosing between the two is for the Leader
  and Vinh.
- In the FR-006 staging parity check, a lookup-failure case where the same
  injected fault succeeds in one flag state and errors in the other is a
  parity difference. Record it as a failed check, not as an expected result.
- The automated parity tests (`backend/tests/test_async_auth_db_layer.py`)
  inject `RuntimeError`, which `aexecute` never re-sends. They pass, but they
  do not exercise F6. No paired transport-fault test exists yet; one added
  before the fix or revision would fail by design.

## Release evidence

- Staging SHA and measurement: pending T006.
- Production: pending T007 (flag off at promotion).
