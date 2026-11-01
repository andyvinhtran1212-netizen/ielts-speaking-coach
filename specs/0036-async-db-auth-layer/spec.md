---
id: ASYNCAUTH-0036
title: Per-request auth and permission checks can run on the async DB client behind USE_ASYNC_DB without changing any access decision
status: approved
risk: high
owner: product
---

# Per-request auth and permission checks can run on the async DB client behind USE_ASYNC_DB without changing any access decision

Approval: approved by Vinh on 2026-10-28 12:44 (UTC+7) in the Leader chat
("duyệt"), see [`approval-decision.md`](approval-decision.md). The decision
reclassifies PR #1805 (PC-J05 D1, first filed as `small` / `Spec: N/A`) as
`high-risk`, because it touches auth and access-code permission paths.
Origin: the PC-J05 investigation (#1795), decision D1 (a)+(b), approved
2026-10-28 10:49; D2 (worker count) is explicitly unchanged.

Revision: on 2026-10-28 17:53 (UTC+7) Vinh approved option 2A for PR #1835:
FR-001 now describes the implemented insert-if-absent first-visit
provisioning instead of the existing sync query, see
[`approval-decision.md`](approval-decision.md).

Revision 2: on 2026-10-29 13:58 (UTC+7) Vinh decided (SPEC-DECISIONS-J76 F-4)
that a DB failure or error on these reads answers **503** for the learner
activation gate, the staff guards and `/auth/check-active`, in both flag
states. The spec said 500 for the staff guards while the code already returned
503; `/auth/check-active` moves from 500 to 503. The body keeps the sanitized
`{error_code, message, ref}` shape, see
[`approval-decision.md`](approval-decision.md).

Revision 3: on 2026-10-30 22:13 (UTC+7) Vinh chose Q5: b (t1098u, relayed by
the Leader): with `USE_ASYNC_DB` **off**, the converted auth and permission
paths and `aexecute` run their existing sync query in a worker thread
(`asyncio.to_thread`) instead of on the event loop; the flag stays off on
staging and production. Same query, same client, same order, same body,
status, error detail and 503 fail-closed contract (FR-001, FR-008, FR-009).
#2093 (PC-J428) already runs `/auth/me` that way with the flag off. Production
still needs Vinh's separate go at the promotion, see
[`approval-decision.md`](approval-decision.md).

## Tóm tắt (tiếng Việt)

Backend chỉ có một event loop, và mọi lần kiểm tra quyền trên **mỗi** request
(chốt `is_active` của học viên, quyền admin/giảng viên, `/auth/me`,
`/auth/check-active`, `/api/student/permissions`) đang gọi DB đồng bộ. Mỗi lần
gọi chặn cả loop, nên khi nhiều người dùng cùng lúc, trang chờ 5–20 s. Spec này
cho phép các lần đọc đó chạy trên client DB bất đồng bộ, sau cờ `USE_ASYNC_DB`.
Cờ **mặc định tắt**. Khi tắt (Bản sửa 3, Vinh chọn Q5: b ngày 30/10 lúc
22:13): mỗi bước kiểm quyền chạy **đúng câu truy vấn sync như cũ, trên đúng
client cũ, đúng thứ tự**, nhưng trong worker thread (`asyncio.to_thread`), không
chạy trên event loop nữa. Các bước vẫn chạy lần lượt, không song song. Ai được
vào, ai bị chặn, nội dung trả về, mã lỗi và lỗi 503 khi DB hỏng đều giữ nguyên.
Phạm vi: `aexecute` (kéo theo `grading.py`, `student_service`, đọc role staff ở
`admin.py`, `/auth/check-active`; `/auth/me` đã làm ở #2093) và các nhánh cờ
tắt trong `activation_gate.py`, `access_code_permissions.py`. Khi bật cờ, câu
truy vấn chạy trên client bất đồng bộ, kết quả giữ nguyên như khi tắt.
`/api/student/home-summary` chạy song song các phần, mỗi thread một client
riêng (không phụ thuộc cờ). Cờ vẫn tắt ở staging và prod. Quay lui phần cờ:
đặt `USE_ASYNC_DB=false` rồi restart. Quay lui phần chạy trong thread khi cờ
tắt: revert code (không có cờ riêng). Production cần Vinh duyệt riêng khi
promote.

## Problem

PC-J05 (#1795) traced the 5–20 s staging pages and the slow instructor buttons
to one cause: a single uvicorn event loop where every `async def` route calls
the **sync** `supabase_admin….execute()`. Each DB round-trip (50–150 ms,
cross-region) blocks the loop for every user. A cached 10 ms endpoint took
1.6 s when sent with five other GETs. The checks that run on **every**
request are the most frequent blockers: the learner activation gate, the staff
role guard, `/auth/me`, `/auth/check-active` and `/api/student/permissions`.
`/api/student/home-summary` additionally runs about 16 sequential queries on the
loop.

The async facade `services/db_async.aexecute` and the `USE_ASYNC_DB` flag
already exist (P0-1, C-1.1) and are wired only to `grading.py`; the flag is off
on staging and production.

Revision 3 (Q5: b): with the flag off, the converted paths still run their
sync query directly on the event-loop thread (`backend/services/db_async.py:182–185`
and the `if not settings.USE_ASYNC_DB: return <sync>()` branches, at
`origin/staging` `d4cfa1ab9`). The staging load test 001j7 (30 learners opening
the FINAL) measured `/health` p95 25–32 s and `[loop-lag]` max 33.5 s. After
#2093 (PC-J428) every `/api/quiz/*` request still blocks the loop for at least
one query: `require_active_learner` (`backend/main.py:251`) →
`activation_gate._enforce` → `aensure_account_active` → `alookup_is_active`,
which with the flag off calls `lookup_is_active` directly
(`backend/services/activation_gate.py:185–186`).

## Scope

- Per-request auth and permission reads through `aexecute`:
  - `services/activation_gate.py` (router-level `is_active` gate);
  - `routers/admin.py` `require_admin` / `require_instructor` role read only;
  - `routers/auth.py` `/auth/me` and `/auth/check-active`;
  - `services/access_code_permissions.py` live permissions, account summary,
    Writing bridge, `/api/student/permissions`;
  - `services/student_service.py` linked-student lookup used by that bridge.
- Async client transport: PostgREST over HTTP/1.1 (the same GOAWAY guard as the
  sync singleton) and closed on shutdown.
- `/api/student/home-summary`: independent sections run concurrently on
  per-thread service-role clients (`database.thread_supabase_admin`).
- The staging measurement and the flag-based rollback in `rollout.md`.
- Revision 3, flag off: the same sync queries run in a worker thread instead of
  on the event loop, for exactly the paths listed in FR-008.

## Non-goals

- Changing who gets access or what any endpoint returns: no new rule, filter, column or error message. The one exception is Revision 2: `/auth/check-active` answers a lookup failure with 503 instead of 500, with the same body.
- Writing gates (`require_writing_permission`, `get_current_student`): J05-G.
- `/api/class/me` reconcile writes: J05-F, needs the Assignment Tracker.
- Instructor data queries and the dashboard `loadAll` refetch: J05-C / J05-D.
- The `?as_instructor=` impersonation reads.
- Railway worker count (D2) and region (D3).
- Enabling `USE_ASYNC_DB` on production; that is a separate owner decision after staging evidence.
- Any schema, migration or data change.
- Revision 3 does not enable `USE_ASYNC_DB` on staging or production, does not
  change any environment variable, and does not change the default executor
  size (`min(32, os.cpu_count() + 4)`, shared with the `to_thread` offloads of
  #2093 and the other off-loop work).
- Revision 3 does not change any access decision, error code, response body or
  query order.

## Users and journeys

- A learner opens `/home`, `/writing/dashboard` or `/my-class`: the same pages, data and redirects as today, with less waiting while other users are active.
- An inactive learner is blocked with the same 403, and a gate lookup failure still fails closed with the same 503.
- An instructor or admin opens a staff page: the same role decisions and 401/403/503 contract as today; a role or `is_active` lookup failure is 503.

## Requirements

- **FR-001:** `USE_ASYNC_DB` defaults to off (`config.Settings.USE_ASYNC_DB = False`, unset env means off). With the flag off, every converted auth and permission path, and every `aexecute` call, runs its existing sync query on its existing client (the calling module's own `supabase_admin`, or the `sync_client` passed to `aexecute`, chosen exactly as before) in the same order, but in a worker thread (`asyncio.to_thread`) and never on the event-loop thread (Revision 3); the steps are awaited one after another, never with `asyncio.gather`, so the PostgREST query sequence is unchanged. The one query exception is `/auth/me` first-visit provisioning, which in both flag states sends an insert-if-absent (`INSERT … ON CONFLICT (id) DO NOTHING`) and then re-selects the row, so a concurrent first visit reads the winner's row instead of failing on the primary key and an existing row's role, activation and profile fields are never overwritten. With the flag off these paths never create the async client, and the body, HTTP status, error detail, the 503 fail-closed contract, the per-request memo and the test seams are unchanged.
- **FR-002:** With the flag on, the learner activation gate, `require_admin` / `require_instructor`, `/auth/me` (including first-visit provisioning, the throttled `last_seen_at` update and live permissions), `/auth/check-active` and `/api/student/permissions` return the same body, HTTP status and error detail, and send the same PostgREST query sequence, as with the flag off for every user, role, activation state and lookup-failure case; the gate keeps its fail-closed 503 and per-request memo, and no access decision changes.
- **FR-003:** With the flag on, those reads await the shared async Supabase client and do not run sync `.execute()` on the event loop; the async PostgREST pool uses HTTP/1.1 and is closed on shutdown, and the converted paths never touch the sync singleton.
- **FR-004:** `/api/student/home-summary` builds its independent sections concurrently in worker threads, each with its own service-role client created and reused within that thread and never shared across threads, and returns a payload identical to the sequential builder in both flag states.
- **FR-005:** The flag can switch only the paths in this spec plus the already-wired `grading.py` reads (P0-1 Phase 2): the facade users are pinned to the exact allowlist routers `grading.py`, `admin.py` (staff role read only), `auth.py` and services `activation_gate.py`, `access_code_permissions.py`, `student_service.py`; adding any other user requires a spec revision.
- **FR-006:** Before the flag stays on in staging, the staging measurement in `rollout.md` is recorded on the PR against the exact deployed SHA: flag-off and flag-on p50/p95 for the listed endpoints and pages, `[loop-lag]` / `/health/async-db` lag p95 and max, 5xx and 401/403/503 counts per route, and a same-account JSON parity check, with the rollback trigger evaluated.
- **FR-007:** Rollback is `USE_ASYNC_DB=false` plus a service restart, with no code revert, migration or data repair; after it `/health/async-db` reports `use_async_db: false` and `async_client_initialised: false`, and every path runs the FR-001 sync path.
- **FR-008:** The flag-off worker-thread rule of FR-001 covers exactly these paths and no others: (a) the flag-off branch of `services/db_async.aexecute` and so every facade call: `routers/grading.py` (all seven calls, including the `user_vocabulary` insert after the existing-headword read), `services/student_service.afetch_linked_student`, the `routers/admin.py` staff role read used through `staff_guard.alookup_role`, `/auth/check-active`, and `/auth/me` (already moved off the loop by #2093); (b) the `if not settings.USE_ASYNC_DB: return <sync function>(…)` branches of `services/activation_gate.alookup_is_active` and of `services/access_code_permissions` `aget_user_access_code_permissions_cached`, `aget_account_permissions_summary`, `aget_user_access_code_permissions`, `astudent_has_writing_assignment` and `astudent_id_for_user`, each running its whole sync function in one worker call. The facade users stay the FR-005 allowlist, and the existing tests of these paths stay green without being edited.
- **FR-009:** Using the shared sync `supabase_admin` from several worker threads at once rests on `backend/tests/test_supabase_singleton_threadsafe.py` (job 001jy, PR #2093: 32 threads × 60 = 1,920 requests through `database.supabase_admin`, every response matched its request) at httpx 0.27.2, postgrest 2.28.3, supabase 2.28.3 and httpcore 1.0.9; any change to those versions re-runs that test before merge, the code comments that forbid sharing the singleton across threads are corrected to match, and every write that reaches `aexecute` with the flag off passes the G4 same-entity serialization check before merge.

## Acceptance scenarios

### Scenario 1 — flag off after merge

- **Given** the merged SHA deployed on staging with `USE_ASYNC_DB` unset or false
- **When** QA accounts open `/home`, `/writing/dashboard` and `/instructor`
- **Then** responses equal the pre-merge ones, `/health/async-db` shows the flag off with no async client, and the startup log shows `[async-db] USE_ASYNC_DB=off`

### Scenario 2 — flag on, same decisions

- **Given** the Leader set `USE_ASYNC_DB=true` on staging and restarted
- **When** the same accounts (active learner, inactive learner, instructor, admin) call the converted routes
- **Then** bodies, statuses and error details equal the flag-off capture, and lag p95 and the auth endpoints' p95 are lower than the flag-off window

### Scenario 3 — rollback

- **Given** the flag is on and a rollback trigger in `rollout.md` fires
- **When** the Leader sets `USE_ASYNC_DB=false` and restarts
- **Then** `/health/async-db` shows the flag off with no async client, and the routes behave as in Scenario 1

### Scenario 4 — flag off, loop not blocked (Revision 3)

- **Given** the Revision 3 implementation deployed on staging with `USE_ASYNC_DB` unset or false
- **When** 30 learners open the FINAL (the 001j7 / ladder scenario) and the same QA accounts call the converted routes
- **Then** no converted path runs a sync query on the event-loop thread, bodies, statuses and error details equal the previous flag-off capture, and `[loop-lag]` max and `/health` p95 are lower than the previous run of the same scenario

## Edge cases

- A gate `is_active` lookup error or timeout: 503 in both flag states, never treated as active.
- A staff role lookup error: 503 in both flag states, never a role downgrade or upgrade (Revision 2).
- A `/auth/check-active` lookup error or timeout: 503 in both flag states with the sanitized `{error_code, message, ref}` detail, never reported as active (Revision 2).
- First `/auth/me` for a new auth user: the same insert-if-absent provisioning and the same error contract in both states; two concurrent first visits both succeed with one `users` row.
- HTTP/2 on the async pool would hit the 19,999-stream GOAWAY cap; FR-003 pins HTTP/1.1.
- Flag on also switches the `grading.py` reads already wired to the facade; Speaking grading is watched in the measurement window (`rollout.md`).
- A Railway variable change alone does not affect a running process: the flag is read at startup, so both enabling and rollback need a restart.
- Revision 3, per-request memo: `asyncio.to_thread` copies the context, so `_perm_memo` and the gate memo in the worker point at the same dict, and writes into that dict are seen by the request. A `ContextVar.set()` inside the worker does **not** reach the request, so the memo must be opened (`set`) on the async side before the worker call, as the middleware does today (`backend/main.py:407`, `:410`). With no memo open (background task, tests) the sync function runs un-memoized, as today.
- Revision 3, concurrency: before, the flag-off branch never yielded the loop, so same-entity requests ran one after another inside one process; with the worker thread they can overlap. Every write reached through `aexecute` with the flag off needs the G4 check (CR checklist `cc-jobs/reviews/G4-same-entity-serial-checklist.md`). Known writes today: `routers/grading.py:1878` `user_vocabulary` insert after the read at `:1725` (backed by the unique index `idx_user_vocab_unique` on `(user_id, lower(headword)) WHERE NOT is_archived`, migration 019, and the duplicate skip at `:1882`; lemma-only duplicates have no unique guard and must be assessed), and `/auth/me` provisioning (insert-if-absent) and the `last_seen_at` update (idempotent), already moved by #2093.
- Revision 3, thread safety: the shared sync client is used from several threads at once on the FR-009 evidence; the comments at `backend/database.py:228–234` ("must never be used from two threads at once") and `backend/services/db_async.py:20–23`, `:182–183` ("not thread-safe", "NOT threaded") are stricter than that evidence and are corrected by the implementation.
- Revision 3, executor: the worker calls share Python's default executor with the other `to_thread` work. When it is busy, an auth read waits in the queue; the result is unchanged, only the wait grows. Its size is not changed here.
- Revision 3, cancellation: a worker call cannot be cancelled. If the request is cancelled, the sync query still finishes and its result is dropped, as it did before when it ran to completion on the loop.
- Revision 3 has no separate flag: `USE_ASYNC_DB=false` keeps the worker-thread path; going back to on-loop execution means reverting the implementation.

## Success criteria

- No access decision, body, status or error detail changes in either flag state (automated parity tests and the staging same-account check).
- On staging with the flag on, event-loop lag p95 and the p95 of `/auth/check-active`, `/auth/me` and `/api/student/permissions` are lower than in the flag-off window of the same SHA, with no rise in 5xx or 401/403/503 counts.
- Revision 3, flag off on staging: in the 30-learner FINAL load test (001j7 / ladder scenario, after #2093), `[loop-lag]` max and `/health` p95 are lower than in the previous run of the same scenario, with no rise in 5xx or 401/403/503 counts.
- Revision 3: automated parity shows the same body, status, error detail and PostgREST query sequence as before the change, for every user, role, activation state and lookup-failure case, and a test proves the flag-off paths in FR-008 never run a sync query on the event-loop thread.
- The #1795 ticket targets (main pages < 3 s, lag p95 < 100 ms with 3–5 QA sessions) are reported but are **not** a gate for this spec: the remaining stalls are the unconverted data queries owned by J05-C/D/E/F/G.

## Open questions

- None block implementation. Enabling the flag on production is a later owner decision after the FR-006 evidence.
