# Implementation plan

## Architecture impact

- Facade: `services/db_async.aexecute(build, sync_client=None)`. The off branch
  runs `build(sync_client or database.supabase_admin).execute()`, so routers
  whose tests patch their module-level `supabase_admin` keep their doubles. The
  on branch awaits `database.get_supabase_async()`.
- Converted paths (FR-002), each an `a*` twin that shares the query builders and
  merge steps with the existing sync function:
  - `services/activation_gate.py`: `alookup_is_active`, `aaccount_is_active`,
    `aensure_account_active`; the router gate `_enforce` uses them.
  - `routers/admin.py`: `_staff_role_row` inside `require_admin` /
    `require_instructor`; no admin data route.
  - `routers/auth.py`: `/auth/me`, `/auth/check-active`.
  - `services/access_code_permissions.py`:
    `aget_user_access_code_permissions(_cached)`,
    `aget_account_permissions_summary`, `astudent_has_writing_assignment`,
    `astudent_id_for_user`.
  - `services/student_service.py`: `afetch_linked_student`.
- `database.py`: HTTP/1.1 transport for the async PostgREST pool, close on
  shutdown (`main.py`), `thread_supabase_admin()` for per-thread clients.
- `services/student_home_aggregator.py` + `routers/student_home.py`:
  `get_home_summary_concurrent`; the sequential `get_home_summary` stays and
  both share `_assemble_home_summary` (FR-004, not flag-gated, following
  `get_dashboard_payload_concurrent`).
- `config.py`: `USE_ASYNC_DB: bool = False` unchanged; the comment lists what it
  now covers.
- Revision 3 (Q5: b), flag off only:
  - `services/db_async.aexecute`: the off branch picks the client exactly as
    today (`sync_client` or `database.supabase_admin`) and runs
    `build(client).execute()` in one `asyncio.to_thread` call. This covers every
    facade user (FR-008 a): `grading.py`, `student_service.afetch_linked_student`,
    the `admin.py` staff role read, `/auth/check-active`, `/auth/me`.
  - `services/activation_gate.alookup_is_active` and the five
    `access_code_permissions` twins: the `if not settings.USE_ASYNC_DB` branch
    becomes `return await asyncio.to_thread(<sync function>, ...)`, one worker
    call per function, so the sync function keeps its own query order, memo use
    and error handling. No `gather`.
  - The module-level names (`lookup_is_active`, `get_*`, `supabase_admin`) are
    looked up at call time, so the conftest and per-test patches keep working.
  - Request memos stay opened by the middleware on the async side
    (`main.py:407`, `:410`) before any worker call.
  - Comments that forbid sharing the sync singleton across threads
    (`database.py:228–234`, `db_async.py:20–23`, `:182–183`, and the "IS the
    sync function" docstrings) are corrected to the FR-009 evidence.
  - `/auth/me` keeps the #2093 helpers; if #2093 is not merged first, the
    implementation rebases on it rather than duplicating it.

## Data and contracts

- No schema, migration, RLS or data change.
- No API shape change: every converted route returns the same body, status and
  `detail` in both flag states; `frontend/types/api.d.ts` is unchanged.
- Same PostgREST queries (table, columns, filters, order) in both flag states,
  pinned by the query-sequence comparison.
- Compatibility: the deployed frontend is unaffected; the flag-off build is
  behaviourally the current backend except that home-summary sections run
  concurrently and, since Revision 3, the flag-off auth and facade queries run
  in worker threads (same results; same-entity requests may overlap).

## UI and interaction

- No UI change; see `ui-states.md`.

## Work decomposition

1. Facade and transport (`db_async.py`, `database.py`, `main.py`).
2. Converted auth/permission paths (gate, staff guard, auth routes, permission
   services, student service).
3. Home-summary concurrency.
4. Tests and allowlist pins. All in one implementation PR (#1805), rebuilt on
   top of this spec's approval commit.
5. Revision 3: flag-off worker threads (PC-J444), a separate implementation PR
   whose commits descend from the Revision 3 approval commit.

## Rollout and rollback

- Merge with the flag off; the Leader flips it on staging after the merge
  (`rollout.md`).
- Rollback: `USE_ASYNC_DB=false` and restart. Code rollback: revert the
  implementation merge; no data impact.
- Revision 3 has no flag of its own: rollback is reverting the Revision 3
  implementation merge, then redeploy; no data impact.

## Verification strategy

- `backend/tests/test_async_auth_db_layer.py`: each converted path runs with the
  flag off and on over the same in-memory data, comparing result, HTTP
  status/detail and query sequence. Also: flag-on never touches the sync
  singleton, flag-off never touches the async client, concurrent gate lookups
  overlap on one loop, async pool on HTTP/1.1 and closed on shutdown, per-thread
  clients, home-summary sections on their own thread clients and overlapping.
- `backend/tests/test_student_home_aggregator.py`: existing behaviour tests run
  against the sequential and the concurrent builder.
- `backend/tests/test_async_db_scaffold.py`: exact facade allowlist (FR-005)
  and the `admin.py` guard-only pin.
- `backend/tests/conftest.py`: the default-active activation seam also covers
  `alookup_is_active`.
- Staging measurement and parity check (`rollout.md`, FR-006).
- Revision 3 (FR-001, FR-008, FR-009):
  - anti-blocking test with the flag off: each FR-008 path, with a slow sync
    double, runs its query off the loop thread (thread id differs from the
    loop's) while a loop heartbeat keeps ticking;
  - parity test: flag-off body, status, detail and query sequence equal the
    pre-change capture for every user, role, activation state and
    lookup-failure case (503 stays 503, 403 stays 403);
  - memo test: a value memoized inside the worker is reused by the next call in
    the same request;
  - the existing tests of these paths (`test_async_auth_db_layer.py`,
    `test_async_db_scaffold.py`, `test_activation_gate_round2.py`, the grading,
    admin, auth and permission suites) stay green unedited;
  - `test_supabase_singleton_threadsafe.py` (from #2093) runs in the suite and
    again whenever httpx, postgrest, supabase or httpcore change;
  - G4 review of every write through `aexecute` with the flag off.
