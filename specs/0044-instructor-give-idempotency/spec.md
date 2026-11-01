---
id: INSTRUCTORGIVE-0044
title: A teacher's repeated or retried Writing give from /instructor creates the homework once
status: approved
risk: high
owner: product
---

# A teacher's repeated or retried Writing give from /instructor creates the homework once

Status: **approved by Vinh on 2026-10-31 (UTC+7)**, in his chat with Claude:
decisions D1–D6 as recommended below, spec number 0044, and D7 (the retry
commitment covers the same dashboard tab only). Claude proposed the options; the
decision is the owner's. See [`approval-decision.md`](approval-decision.md).
Spec number 0044 was proposed by job 1ad (0041–0043 are held by open spec PRs). Migration number **360** was allocated by the Leader on
2026-10-31. Origin: PC-J100 design (step b, option (b)), PC-J117 count on
staging, ticket PC-J192.

## Tóm tắt (tiếng Việt)

Hôm nay, ở trang /instructor, nếu giáo viên bấm "Giao bài" rồi mạng chập chờn
(máy chủ đã ghi bài nhưng trình duyệt không nhận được trả lời), bấm lại sẽ tạo
**thêm một lần giao giống hệt**: học viên thấy hai bài trùng. Staging đã có một
cặp như vậy (giao lẻ, cách nhau 4 giây, ngày 27/10). Sau thay đổi này mỗi lần
giao mang một mã yêu cầu (`request_id`). Bấm lại đúng lần giao đó **trong cùng tab** sau khi lỗi
mạng chỉ trả lại kết quả của lần đầu; không có bài mới. Giao lại từ **tab khác**
được tính là một lần giao mới: bài trùng vẫn hiện ra trong danh sách (kèm cảnh
báo trùng) và xoá được, không bị mất trong im lặng (anh Vinh chốt 31/10). Giáo viên vẫn thấy thông báo "Đã giao bài…" như bình thường. Muốn giao
thêm một lần nữa có chủ ý (ví dụ buổi mới) thì vẫn được, như hiện nay. Nếu cùng
mã mà nội dung khác, hoặc mã của tài khoản khác, hệ thống từ chối và không tạo
gì. Một tab /instructor đã mở từ trước khi cập nhật cần tải lại trang một lần.

## Problem

`POST /instructor/assignments` (one prompt → one learner) and
`POST /instructor/assignments/fan-out` (prompts → a class) have no idempotency
key. Each call creates new `writing_assignments` rows (a fan-out also a new
`assignment_group_id`). The frontend only blocks a double click; a retry after
a lost response, a second tab or a direct API call creates a second give.
PC-J117 found one such pair on staging (individual give, 4 s apart,
2026-10-27 03:30 UTC+7, by admin `b34b0721` from /instructor). The admin give
routes already have this protection (PC-J37, `writing_assignment_requests`).

The admin ledger cannot simply be reused: a `writing_assignment_requests`
receipt carrying a give's group id is the W-05 marker for "given from the admin
Writing tools" (`routers/writing_student.py::_admin_gave_via_instructor_workflow`),
so an admin teaching from /instructor would lose the instructor tier and the
"Chấm bài" queue; and its RPC has no `grading_tier`.

## Scope

- Both /instructor give routes require a client `request_id` (UUID).
- Migration 360: ledger `instructor_writing_assignment_requests` and RPC
  `fn_create_instructor_writing_give_idempotent` (one transaction: ledger,
  ownership re-check, roster lock, insert with `grading_tier`, receipt).
- Backend: replay before the route pre-checks; map RPC refusals.
- Frontend /instructor: one `request_id` per give intent; a retry of the same
  give reuses it.
- Tests: static and PostgreSQL (16 and 17) for 360 including two concurrent
  sessions; route tests; React tests; browser verifier fixture.

## Non-goals

- The admin give routes, `writing_assignment_requests`, its RPC (206/228) and W-05.
- Cleaning up existing duplicates, including pair `8e0892b9` on staging (its repeat already has a draft; A-08 would refuse a delete). Any clean-up is a separate decision.
- `expected_student_count` (class size changed between preview and give) for /instructor (D2).
- Bounds on `AssignBody.instructions` / `analysis_level` (PC-J115, #2047).
- Measuring duplicates on production (needs Vinh's permission; not this spec).
- Mapping 40P01/40001 to a retryable 409 (GIVEARCHIVE-0031 follow-up).

## Users and journeys

- A teacher (instructor, or an admin teaching from /instructor) gives a prompt to one learner or a class; the response is lost and they press "Giao bài" again: one give exists and they see the usual success banner.
- The same teacher deliberately gives the same prompt again later (a new session): a new give is created (allow + warn, unchanged).
- A learner sees each give once in /writing.

## Requirements

- **FR-001:** `POST /instructor/assignments` and `POST /instructor/assignments/fan-out` require `request_id` (UUID); a missing or malformed value is 422 before any database read or write.
- **FR-002:** A request whose `request_id` was already completed by the same account with the same body creates no row and returns the first response (the stored row for an individual give; `student_count`, `created_count`, `group_id`, `duplicates_warning`, `assignment_ids` for a fan-out), even when the class roster, the learner's archive state or ownership changed since. Concurrent requests with the same `request_id` serialize in the database: exactly one give is created and every response carries the same receipt.
- **FR-003:** The same `request_id` with another body, or used on the other give route, is refused with 409 "Yêu cầu giao bài này đã được gửi trước đó với nội dung khác. Vui lòng tải lại trang rồi giao lại." and creates nothing.
- **FR-004:** A `request_id` is bound to the account that first used it (`assigned_by`); another account using it gets 409 "Yêu cầu giao bài này không thuộc tài khoản của bạn. Vui lòng tải lại trang rồi thử lại.", learns nothing of the first give, and creates nothing.
- **FR-005:** The RPC re-checks ownership inside its transaction (every prompt `created_by` = owner; the class `created_by` = owner and no active member owned by another instructor; the individual learner `instructor_id` = owner), locks the active memberships `FOR SHARE` and writes `grading_tier`, `analysis_level`, deadline, name and instructions as sent; a refusal (ownership 403, empty class 400, archived learner 409 from 331, archived class from 337) rolls back the ledger row too, so a retry with the same id runs again.
- **FR-006:** /instructor receipts are never written to `writing_assignment_requests`; an admin giving from /instructor keeps the instructor tier and reaches "Chấm bài" (W-05 unchanged).
- **FR-007:** The /instructor dashboard sends one `request_id` per give intent (account, target, route and body): re-sending the same give after an error or a lost response reuses it; a successful give or any change to the give uses a new one. Success and error banners are unchanged.
- **FR-008:** Migration 360 is additive, one transaction with `lock_timeout = 5s`, re-runnable, aborts if a prerequisite table, column or the `grading_tier_enum` type is missing, keeps RLS on the ledger with no policy, gives clients no table or EXECUTE privilege and `service_role` only SELECT on the ledger and EXECUTE on the RPC, verifies this in a postcondition, changes no existing data, and is held by `forward-policy.tsv` (group `instructor_give_idempotency`) so merging does not apply it.

## Acceptance scenarios

### Scenario 1 — lost response, same give again

- **Given** a teacher's class give committed but the browser saw a network error
- **When** they press "Giao bài" again without changing the form
- **Then** the request carries the same `request_id`, the API returns 201 with the first receipt, and the class has one group

### Scenario 2 — two requests at once

- **Given** two requests with the same `request_id` and body arrive together
- **When** both reach the database
- **Then** one waits for the other; one give exists; both responses carry the same receipt

### Scenario 3 — reused id, different body or account

- **Given** a completed request `R`
- **When** the same teacher sends `R` with another name, or another teacher sends `R`
- **Then** 409 with the FR-003 / FR-004 message and no new row

### Scenario 4 — deliberate re-give

- **Given** a successful give
- **When** the teacher fills the form again and confirms "Giao thêm"
- **Then** a new `request_id` is sent and a second give is created with `duplicates_warning`

### Scenario 5 — admin teaching from /instructor

- **Given** an admin gives from /instructor
- **When** the learner submits
- **Then** the essay's tier is `instructor` and it appears in the admin's "Chấm bài" queue

## Edge cases

- Old frontend (a tab opened before the deploy) sends no `request_id`: 422 until reload (D3). A new frontend against an old backend is harmless: the extra field is ignored.
- New backend before migration 360: the give routes fail (500, RPC missing) — apply 360 first (rollout).
- A refused request (403/400/409) leaves no ledger row; the same id can be retried after the cause is fixed.
- A replay returns the stored first result, not today's row state (e.g. the row may since be submitted).
- Two different `request_id`s with the same body are two intents: two gives (allow + warn).
- A retry of the same give from **another tab** (or another browser) carries a different `request_id`, because the pending id lives only in the tab that made the first attempt (D7). It creates a second give with `duplicates_warning`; the duplicate stays visible on the dashboard and can be removed. Only a retry in the same tab is guaranteed to replay.
- The legacy `students.cohort_id` roster fallback is no longer used by the class give: the RPC reads active memberships (canonical since 227). The route pre-check still reads it, so a class with only legacy rows gets 400 from the RPC.
- An instructor who lost access to a learner or class after a completed give can still replay that give's own receipt with the same `request_id` and body: the response is the stored first result and nothing is written (SA-4, accepted by design). Losing the instructor role or being deactivated is refused before any ledger read (403 at the route; the RPC also refuses an owner that is not an active instructor or admin).
- Deadlock between a class give and a learner archive (pre-existing, 228/331): one side aborts with 40P01 and nothing is half-written.

## Success criteria

- PostgreSQL two-session tests pass on 16 and 17; a negative control with two ids produces two gives.
- On staging (AT retest): sending the same give twice with one `request_id` leaves one group/row; a different body gets 409; a fresh id still gives.
- No new duplicate /instructor give pairs on staging after rollout (read-only query in `rollout.md`).

## Decisions for Vinh

1. **D1 — separate ledger (recommended, implemented):** a new table + RPC instead of reusing `writing_assignment_requests`, so W-05 keeps its meaning and the admin RPC is untouched. Cost: about 100 lines of plpgsql similar to 228.
2. **D2 — no `expected_student_count`** for /instructor (not in the ticket). A class that changed between the preview and the give is given to today's roster, as now.
3. **D3 — required at once** (ticket): no optional phase; an old open tab gets 422 until reload.
4. **D4 — `assigned_by … ON DELETE CASCADE`** on the new ledger: `writing_assignments.assigned_by` is `SET NULL`, so receipts must not start blocking a user delete (206 uses RESTRICT).
5. **D5 — both routes** (ticket): individual give and class fan-out.
6. **D6 — copy (Content Manager review):** the two new 409 messages in FR-003/FR-004 and the backstop "Yêu cầu giao bài đang được xử lý. Vui lòng thử lại." / "Dữ liệu giao bài không hợp lệ."; the response does not expose a `replayed` flag, so both responses are identical (the server logs replays). CM review 31/10 (CM-TEXT-2116): instructors must not see "request_id", so the API returns "Yêu cầu giao bài này đã được gửi trước đó với nội dung khác. Vui lòng tải lại trang rồi giao lại." (FR-003) and "Yêu cầu giao bài này không thuộc tài khoản của bạn. Vui lòng tải lại trang rồi thử lại." (FR-004); the incomplete and 422 backstop messages are kept verbatim. The FR-003/FR-004 lines keep their original quotes because FR text is frozen once implementation commits exist; this decision is the wording that ships.

7. **D7 — retry commitment is per tab (owner decision 2026-10-31, option (a)):** idempotent replay is promised for a retry in the same /instructor tab. A retry from another tab is a new intent: a visible, removable duplicate with `duplicates_warning`, never a silent loss. Rejected option (b): persist the pending `request_id` in `localStorage` keyed by the give body; it adds complexity and could block a deliberate re-give.

## Open questions

None. D1–D7 and the spec number were approved by Vinh on 2026-10-31.
