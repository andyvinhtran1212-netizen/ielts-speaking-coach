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

## Tóm tắt (tiếng Việt)

Backend chỉ có một event loop, và mọi lần kiểm tra quyền trên **mỗi** request
(chốt `is_active` của học viên, quyền admin/giảng viên, `/auth/me`,
`/auth/check-active`, `/api/student/permissions`) đang gọi DB đồng bộ. Mỗi lần
gọi chặn cả loop, nên khi nhiều người dùng cùng lúc, trang chờ 5–20 s. Spec này
cho phép các lần đọc đó chạy trên client DB bất đồng bộ, sau cờ `USE_ASYNC_DB`.
Cờ **mặc định tắt**. Khi tắt, code chạy y như hiện nay. Khi bật, ai được vào, ai
bị chặn, nội dung trả về, mã lỗi và câu truy vấn gửi đi đều **giữ nguyên**; chỉ
khác là loop không bị chặn. `/api/student/home-summary` chạy song song các phần,
mỗi thread một client riêng (không phụ thuộc cờ). Leader bật cờ trên staging
sau khi merge, đo trước/sau theo kế hoạch ở `rollout.md`. Quay lui: đặt
`USE_ASYNC_DB=false` rồi restart, không cần revert code. Production giữ cờ tắt
cho tới khi Vinh duyệt riêng.

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

## Non-goals

- Changing who gets access or what any endpoint returns: no new rule, filter, column or error message.
- Writing gates (`require_writing_permission`, `get_current_student`): J05-G.
- `/api/class/me` reconcile writes: J05-F, needs the Assignment Tracker.
- Instructor data queries and the dashboard `loadAll` refetch: J05-C / J05-D.
- The `?as_instructor=` impersonation reads.
- Railway worker count (D2) and region (D3).
- Enabling `USE_ASYNC_DB` on production; that is a separate owner decision after staging evidence.
- Any schema, migration or data change.

## Users and journeys

- A learner opens `/home`, `/writing/dashboard` or `/my-class`: the same pages, data and redirects as today, with less waiting while other users are active.
- An inactive learner is blocked with the same 403, and a gate lookup failure still fails closed with the same 503.
- An instructor or admin opens a staff page: the same role decisions and 401/403/500 contract as today.

## Requirements

- **FR-001:** `USE_ASYNC_DB` defaults to off (`config.Settings.USE_ASYNC_DB = False`, unset env means off); with the flag off every converted auth and permission path runs its existing sync query on the calling module's own `supabase_admin` client in the same order, the async client is never created, and responses, status codes and test seams are unchanged.
- **FR-002:** With the flag on, the learner activation gate, `require_admin` / `require_instructor`, `/auth/me` (including first-visit provisioning, the throttled `last_seen_at` update and live permissions), `/auth/check-active` and `/api/student/permissions` return the same body, HTTP status and error detail, and send the same PostgREST query sequence, as with the flag off for every user, role, activation state and lookup-failure case; the gate keeps its fail-closed 503 and per-request memo, and no access decision changes.
- **FR-003:** With the flag on, those reads await the shared async Supabase client and do not run sync `.execute()` on the event loop; the async PostgREST pool uses HTTP/1.1 and is closed on shutdown, and the converted paths never touch the sync singleton.
- **FR-004:** `/api/student/home-summary` builds its independent sections concurrently in worker threads, each with its own service-role client created and reused within that thread and never shared across threads, and returns a payload identical to the sequential builder in both flag states.
- **FR-005:** The flag can switch only the paths in this spec plus the already-wired `grading.py` reads (P0-1 Phase 2): the facade users are pinned to the exact allowlist routers `grading.py`, `admin.py` (staff role read only), `auth.py` and services `activation_gate.py`, `access_code_permissions.py`, `student_service.py`; adding any other user requires a spec revision.
- **FR-006:** Before the flag stays on in staging, the staging measurement in `rollout.md` is recorded on the PR against the exact deployed SHA: flag-off and flag-on p50/p95 for the listed endpoints and pages, `[loop-lag]` / `/health/async-db` lag p95 and max, 5xx and 401/403/503 counts per route, and a same-account JSON parity check, with the rollback trigger evaluated.
- **FR-007:** Rollback is `USE_ASYNC_DB=false` plus a service restart, with no code revert, migration or data repair; after it `/health/async-db` reports `use_async_db: false` and `async_client_initialised: false`, and every path runs the FR-001 sync path.

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

## Edge cases

- A gate `is_active` lookup error or timeout: 503 in both flag states, never treated as active.
- A staff role lookup error: 500 in both flag states, never a role downgrade or upgrade.
- First `/auth/me` for a new auth user: the same provisioning insert and the same error contract in both states.
- HTTP/2 on the async pool would hit the 19,999-stream GOAWAY cap; FR-003 pins HTTP/1.1.
- Flag on also switches the `grading.py` reads already wired to the facade; Speaking grading is watched in the measurement window (`rollout.md`).
- A Railway variable change alone does not affect a running process: the flag is read at startup, so both enabling and rollback need a restart.

## Success criteria

- No access decision, body, status or error detail changes in either flag state (automated parity tests and the staging same-account check).
- On staging with the flag on, event-loop lag p95 and the p95 of `/auth/check-active`, `/auth/me` and `/api/student/permissions` are lower than in the flag-off window of the same SHA, with no rise in 5xx or 401/403/503 counts.
- The #1795 ticket targets (main pages < 3 s, lag p95 < 100 ms with 3–5 QA sessions) are reported but are **not** a gate for this spec: the remaining stalls are the unconverted data queries owned by J05-C/D/E/F/G.

## Open questions

- None block implementation. Enabling the flag on production is a later owner decision after the FR-006 evidence.
