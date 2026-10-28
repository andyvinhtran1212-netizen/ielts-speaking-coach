# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_async_auth_db_layer.py (flag-off never touches the async client; same results as the sync path) plus backend/tests/test_async_db_scaffold.py (flag default off) and the staging `/health/async-db` check after merge | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_async_auth_db_layer.py (live permissions, account summary, gate 403/503 and memo, staff guards per role and activation state plus 500 path, `/auth/me` incl. provisioning and error contract, `/auth/check-active`, `/api/student/permissions`: same result, status/detail and query sequence in both flag states) plus the staging same-account parity diff | PENDING |
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

What changed (flag-ON path only; the flag-off sync path and the sync transport
are unchanged):

- **Bounded transport.** `database.ASYNC_POSTGREST_TIMEOUT` is
  connect 5 s / read 15 s / write 15 s / pool 5 s, replacing the single 120 s
  timeout. `database.ASYNC_POSTGREST_LIMITS` makes httpx's defaults explicit
  (100 / 20 / keep-alive 5 s).
- **One retry for reads.** `aexecute` re-sends an idempotent GET/HEAD once
  after an `httpx.TransportError`. The pool drops the failed connection, so
  the retry goes out on a fresh one. Writes (POST/PATCH/DELETE/RPC) are never
  re-sent.
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

## Release evidence

- Staging SHA and measurement: pending T006.
- Production: pending T007 (flag off at promotion).
