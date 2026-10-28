---
id: ACTIVATELIMIT-0034
title: Access-code activation attempts are limited per learner across every backend worker, and the limit fails closed
status: approved
risk: high
owner: product
---

# Access-code activation attempts are limited per learner across every backend worker, and the limit fails closed

Approval: approved as written by Vinh on 2026-10-28 at 16:26 (+07), including
the Decisions below (see [`approval-decision.md`](approval-decision.md)). Vinh
chose the Postgres counter (option "h") on 2026-10-28 09:40 (+07). Locked
migration number: **334** (assigned by the Leader). Origin: brief H-1028-FD4
(F09, Low/P2).

## Tóm tắt (tiếng Việt)

Hiện nay mỗi tài khoản được thử mã kích hoạt 10 lần/10 phút, nhưng bộ đếm nằm
trong bộ nhớ của từng worker backend: có N worker thì thực tế được N×10 lần, và
mỗi lần khởi động lại thì bộ đếm về 0. Thay đổi này chuyển bộ đếm vào Postgres
(migration 334), dùng chung cho mọi worker/replica. Học viên nhập mã bình
thường không thấy gì khác. Lần thử thứ 11 trong 10 phút vẫn nhận đúng thông báo
cũ "Quá nhiều lần thử kích hoạt. Vui lòng đợi vài phút rồi thử lại." và mã
KHÔNG bị tiêu. Nếu database không trả lời được, hệ thống từ chối (không mở
cửa) với thông báo "Chưa kiểm tra được lượt kích hoạt. Mã CHƯA được sử dụng —
vui lòng thử lại sau ít phút." và mã vẫn còn nguyên.

## Problem

`POST /auth/activate` (backend/routers/auth.py) limited attempts with a
module-global dict `_activate_attempts` keyed by user id. Each uvicorn worker
and each Railway replica keeps its own dict, so N processes allow N×10 attempts
per 10 minutes, and a restart or deploy resets every counter. The 429 detail was
a bare Vietnamese string with no machine-readable code and no `Retry-After`.
The security impact is low (the code keyspace is 36^8 and every attempt needs a
real account), but the documented limit was not the enforced one.

## Scope

- Migration 334: `public.activation_attempts(user_id, attempted_at)` with an
  index on `(user_id, attempted_at)`, and the atomic
  `public.fn_activate_attempt_check(p_user_id uuid) → jsonb {allowed, retry_after_s}`.
- Backend: `_rate_limit_activate` calls the RPC; the in-memory dict is removed.
  Only the rate-limit block of `routers/auth.py` changes (AAL2 lot 07 edits the
  same file later).
- Frontend `/login`: read `detail.error_code` of a refused activation.
- Tests: static and PostgreSQL migration tests (PG 16 and 17), backend AC1–AC5,
  frontend model test.

## Non-goals

- A general rate-limit framework, Redis, or limits on any other route.
- Changing the limit (10 per 10 minutes per user), the route path or body, or
  any activation step after the check (code lookup, Step 1b instructor gate,
  Step 1c archived profile, claim, enroll).
- Step 1d (suspended staff, ADMINAAL2-0032) is not on `staging` yet; the check
  stays first, so it will precede 1d as well.
- An admin "reset attempts" control.
- A global sweep of idle users' rows (see Decisions).

## Decisions

- **Old-row cleanup: inside the RPC.** Each call deletes that user's rows older
  than 1 day (`c_keep`). A refused call records nothing, so a user holds at most
  10 rows per 10 minutes, and the table stays bounded without a cron. The
  alternative, the AAL2 lot 08 sweep, does not exist yet, and leaving it to a
  future job would leave the table unbounded until then. Idle users keep at most
  their last day's rows (≤ 1,440, in practice ≤ 10). A global sweep can be added
  later without a contract change.
- **Atomicity: per-user transaction advisory lock** keyed
  `hashtextextended('activate-attempt:' || user_id, 0)` (the one-bigint key
  space, so it can never collide with the `(173204, 1)` migration lock). The
  function requires READ COMMITTED, PostgREST's default, so the count after the
  lock sees every committed attempt.
- **Only allowed attempts count.** Hammering after the limit does not extend
  the lockout; `retry_after_s` is when the oldest counted attempt leaves the
  window.
- **No FK to `users`.** The check runs before Step 2 creates a missing
  `public.users` row; the rows are age-bounded instead.

## Users and journeys

- A learner who mistypes a code a few times activates normally.
- A learner (or script) that makes more than 10 attempts in 10 minutes sees the
  existing Vietnamese message; the code they typed is not consumed; they can
  retry once the oldest attempt leaves the window.
- When the database cannot answer, the learner sees a clear "try again later,
  code not used" message instead of a silent pass or a generic 500.

## Requirements

- **FR-001:** `POST /auth/activate` allows at most 10 attempts per user in any rolling 10-minute window, counted in Postgres and shared by every backend worker and replica; the count-then-record is atomic, so concurrent attempts from different processes never exceed 10; a refused attempt is not recorded; the in-memory `_activate_attempts` counter no longer exists.
- **FR-002:** The check runs after authentication and before the access code is looked up or claimed; when it refuses, the response is 429 with `detail = {"error_code": "activate_rate_limited", "retry_after_s": <int ≥ 1>, "message": <existing Vietnamese text>}` and a `Retry-After` header equal to `retry_after_s`, and no access code, user, student or assignment row changes.
- **FR-003:** The check fails closed: when the RPC errors or returns anything other than `{allowed: boolean, retry_after_s: non-negative integer}`, the response is 503 with `detail.error_code = "activation_unavailable"` (plus `message` and `ref`), the attempt is never allowed, and the code is neither looked up nor claimed.
- **FR-004:** Migration 334 creates `public.activation_attempts(user_id uuid, attempted_at timestamptz)` with an index on `(user_id, attempted_at)`, RLS enabled and no `anon`/`authenticated` privileges, and `public.fn_activate_attempt_check(uuid)` as a `SECURITY DEFINER` function with `search_path = ''` that only `service_role` may execute (revoked from PUBLIC, `anon`, `authenticated`); the function deletes that user's rows older than 1 day; the migration runs in one transaction with `lock_timeout = '5s'`, is re-runnable, changes no existing data and aborts unless its postconditions hold.
- **FR-005:** `/login` reads `detail.error_code` of a refused activation: `activate_rate_limited` shows "Quá nhiều lần thử kích hoạt. Vui lòng đợi vài phút rồi thử lại.", `activation_unavailable` shows the "Mã CHƯA được sử dụng" retry message; string details and every other activation outcome, including the archived-profile 403 (Step 1c), behave as today, and the request path and body are unchanged.

## Acceptance scenarios

### Scenario 1 — limit shared across processes (AC1)

- **Given** a user with no attempts in the last 10 minutes
- **When** two backend processes make 11 or more attempts for that user in parallel
- **Then** exactly 10 are allowed and the rest return 429 `activate_rate_limited` with `Retry-After`

### Scenario 2 — window expiry (AC2)

- **Given** a user refused with 429
- **When** the oldest counted attempt is more than 10 minutes old
- **Then** the next attempt is allowed

### Scenario 3 — database failure (AC3)

- **Given** the RPC cannot be executed or returns a malformed answer
- **When** the user submits a code
- **Then** the response is 503 `activation_unavailable` and the code is never read or claimed

### Scenario 4 — refusal before claim (AC4)

- **Given** a user at the limit
- **When** they submit a valid unused code
- **Then** the response is 429 and the code is still unused

### Scenario 5 — archived profile unchanged (AC5)

- **Given** an allowed attempt by a user whose roster profile is archived
- **When** they submit a valid code
- **Then** Step 1c still answers 403 and nothing is written

## Success criteria

- PostgreSQL tests prove the 11th concurrent call is refused (and a lock-less negative control is not) on PostgreSQL 16 and 17.
- Backend tests prove AC1–AC5, including two real Python processes against one database.
- Staging: after 334 and the 0034 backend, 11 attempts by one QA account give 10 non-429 answers and one 429 with `Retry-After`, and the code used in the 11th attempt is still unused.
