---
id: GIVEARCHIVE-0031
title: A Writing give can never create work for an archived learner, even when the archive lands mid-request
status: implementing
risk: high
owner: product
---

# A Writing give can never create work for an archived learner, even when the archive lands mid-request

Approval: approved by Vinh (see [`approval-decision.md`](approval-decision.md)),
including the three recommendations recorded below. Locked migration number:
**331** (`331_writing_assignment_archived_student_guard.sql`). Evidence record
with the writer inventory, lock analysis and retest queries:
[`research.md`](research.md). Origin: PR #1746 Codex P2 thread on
`backend/routers/admin_writing_assignments.py`, deferred by Vinh to this spec
(2026-10-27 11:42 UTC+7).

## Tóm tắt (tiếng Việt)

Sau 0029, khi giao bài Writing, code kiểm tra "học viên đã lưu trữ chưa" rồi mới
ghi bài ở một lệnh khác. Nếu thao tác lưu trữ chen vào đúng khoảnh khắc giữa
hai bước, bài vẫn được tạo cho học viên đã lưu trữ: không mất dữ liệu, học viên
không mở được bài, nhưng bảng theo dõi có một bài "ma". Migration 331 đặt chốt
chặn ngay trong database: mọi cách tạo bài (admin giao lẻ, admin/giảng viên giao
cả lớp, giảng viên giao lẻ, bù bài cho học viên vào lớp muộn, SQL chạy tay) đều
phải giữ dòng hồ sơ học viên rồi kiểm tra. Giao xong trước thì bài được giữ như
mọi bài cũ; lưu trữ xong trước thì cả lần giao bị từ chối với thông báo quen
thuộc "Học viên đã được lưu trữ — khôi phục hồ sơ trước khi thao tác." Giao cả
lớp mà có một bạn bị lưu trữ giữa chừng: từ chối cả lần giao (như 0029), bấm
giao lại sẽ thành công cho các bạn còn lại. Người dùng bình thường không thấy
thay đổi nào khác.

## Problem

STUDENTARCHIVE-0029 (PR #1746, migration 326) requires that archived learners
receive no new class or individual Writing assignments (0029 FR-002). The
individual give paths enforce this only with a Python pre-check that reads
`students.archived_at` in one statement and inserts `writing_assignments` in a
later one:

- admin idempotent give: `_refuse_archived_students()` then RPC
  `fn_create_writing_assignments_idempotent` (live body = 228), whose
  individual branch takes no student lock and makes no archive check;
- admin legacy give (no `request_id`): pre-check then a PostgREST insert;
- instructor give: `students.archived_at` read then a PostgREST insert.

If `fn_archive_student` commits between the read and the insert, one row is
created for an archived learner. The same check-then-write gap exists on the
class paths that do not use the locked RPC branch: the legacy fan-out
(`cohort_assignment_service.fan_out_assignment`, used by admin fan-out without
`request_id` and by instructor fan-out) reads the roster and bulk-inserts
later, and the late-joiner backfill (`backfill_cohort_writing_assignments`,
called by `/auth/activate` Step 6 and the roster backfill script) does the
same. No learner work is lost and the learner cannot open such a row, but admin
and instructor data become wrong: a pending give for an archived learner shows
in assignment lists, the A-07 matrix and the Assignment Tracker counts.

## Scope

- Migration 331: one row-level `BEFORE INSERT OR UPDATE OF student_id` trigger
  on `public.writing_assignments` that locks the referenced `students` row
  `FOR KEY SHARE` and raises `student_archived` (DETAIL = student id) when
  `archived_at IS NOT NULL`.
- Backend: map the refusal to the existing 0029 409 shape on every give path
  (3 individual, 2 class: fan-out and late-joiner backfill) instead of a 500;
  `/auth/activate` Step 6 stays best-effort; the roster backfill script skips
  the learner and continues.
- Tests: static migration contract, PostgreSQL behaviour, two-session
  concurrency (with a negative control without 331) and route mapping.

## Non-goals

- Changing the Python pre-checks: they stay as the fast path and answer the common case before any write.
- Re-creating `fn_create_writing_assignments_idempotent` or any 326 function.
- Class-archive behaviour (A-10 / CLASSARCHIVE-0030, migration 330) and its `cohort_archived` guard.
- Cleaning up rows the old race may already have created: they are only reported (`research.md` §R R3); any repair is a separate decision by Vinh.
- Mapping deadlock (40P01) or serialization (40001) failures to a retryable 409: a separate follow-up (`research.md` §4 item 3).
- Serializing `/auth/activate` against archive (a separate open question of 0029).

## Users and journeys

- An admin or instructor gives Writing to one learner or a class while another admin archives a learner: the result is a give that predates the archive or a clear 409, never a give created silently after the archive.
- The Assignment Tracker counts open gives: no give for an archived learner is created after its archive.
- A restored learner can receive gives again at once.

## Requirements

- **FR-001:** The database refuses every `INSERT` into `writing_assignments` whose `student_id` is an archived learner, for every caller (RPC, PostgREST, SQL), with the message `student_archived` and DETAIL = student id; the whole statement rolls back, leaving no partial bulk insert, no `writing_assignment_requests` ledger row from the RPC and no origin side-effect row.
- **FR-002:** The guard serializes against `fn_archive_student` by locking the learner row `FOR KEY SHARE`, which conflicts with the archive's `FOR UPDATE`: for any interleaving either the insert commits before the archive takes its lock (the give is kept, as in 0029 FR-005) or the insert is refused, so no assignment row can be created for a learner whose archive had already committed.
- **FR-003:** An `UPDATE` that changes `writing_assignments.student_id` to an archived learner is refused the same way; updates that do not change `student_id` (status sync, deadline and instruction edits, claim and affinity writes) behave exactly as today, including on archived learners' existing rows.
- **FR-004:** Every give path returns the 0029 409 `{"code":"student_archived","message":STUDENT_ARCHIVED_MESSAGE,"student_ids":[...]}` instead of a 500 when the database refuses: admin individual give (RPC and legacy), admin fan-out (RPC and legacy), instructor individual give, instructor fan-out and the late-joiner backfill; a class give with any learner archived mid-way is refused as a whole; `student_ids` comes from the error DETAIL or, when it is missing, from a canonical re-read; other database errors keep their current mapping; `/auth/activate` Step 6 keeps its best-effort warning and the roster backfill script logs and skips the learner, then continues.
- **FR-005:** Gives, fan-outs and late-joiner backfills for non-archived learners, replay of a completed `request_id`, deletes of assignments and gives to a learner after `fn_restore_student` behave exactly as today.
- **FR-006:** Migration 331 is forward-only in one transaction with `lock_timeout = '5s'`, re-runnable, aborts unless migration 326 is present and both 326 lifecycle functions still lock the learner row `FOR UPDATE`, verifies the trigger is enabled and the function is `SECURITY DEFINER` with a pinned `search_path` and not executable by `anon`/`authenticated`, and changes no data.

## Acceptance scenarios

### Scenario 1 — archive commits first (the Codex window)

- **Given** an active learner L and session A that has run `fn_archive_student(L)` but not committed
- **When** session B inserts a give for L (plain insert, individual RPC, a bulk insert with L and an active learner, or an `UPDATE` moving a row to L)
- **Then** B waits for A's lock and fails with `student_archived` after A commits; zero rows exist for that give, including the other learner's, and no ledger row exists for B's `request_id`

### Scenario 2 — give commits first

- **Given** session B has inserted a give for L and not committed
- **When** session A archives L
- **Then** A waits, both succeed, the give exists, and L is archived with every membership ended

### Scenario 3 — stale pre-check through the API

- **Given** a give route's pre-check read L as active
- **When** L is archived before the insert runs
- **Then** the route answers 409 `student_archived` with `student_ids=[L]` and no row is created; a class give creates nothing for anyone

### Scenario 4 — restore

- **Given** L archived, then restored
- **When** an admin gives L a prompt
- **Then** the give is created (201)

## Edge cases

- Pre-existing deadlock between a cohort RPC give (memberships `FOR SHARE`, then the student row) and an archive (student `FOR UPDATE`, then memberships): the FK check already took that student lock before 331. PostgreSQL aborts one side with 40P01 and neither leaves partial state; tested as an invariant. Its mapping is the follow-up above.
- `archived_at` must be written only by `fn_archive_student` / `fn_restore_student` (`FOR UPDATE`); a raw `UPDATE students SET archived_at` would not conflict with `FOR KEY SHARE`. 331 checks this at apply time and a static test fails if application code writes the column.
- A-10 / migration 330 (not yet written) and every later migration must not drop, replace or disable the 331 trigger or its function, and must not re-create `fn_create_writing_assignments_idempotent` (or any give writer) in a way that inserts with triggers disabled. A re-created RPC that keeps a plain `INSERT INTO writing_assignments` stays guarded. A static test pins this.
- REPEATABLE READ or SERIALIZABLE callers get 40001 instead of `student_archived`; no row is written. No current caller uses them.
- `created_at` is the transaction start, not commit order: data checks treat `created_at > archived_at` only as a candidate list (`research.md` §R R3).
- Unknown `student_id`: the guard does nothing and the FK raises 23503 as before.
- Trigger order: BEFORE ROW triggers fire in name order; `archive_guard_writing_assignment_student` sorts before `core_capture_writing_origin` and A-10's `trg_guard_writing_give_cohort_active`, so an archived learner in an archived class gets `student_archived`.
- A retry of a refused idempotent request repeats the 409: the RPC rolled back, so no ledger row exists and the client never sees `request_incomplete`.

## Success criteria

- The two-session tests fail on a schema without 331 (negative control) and pass with it on PostgreSQL 16 and 17 in repeated runs.
- After rollout, staging and production R3 return no confirmed row created after its learner's archive.
- The give routes return no 500 caused by `student_archived`.

## Decisions (approved by Vinh)

1. **FR-003 kept:** changing an existing `writing_assignments.student_id` to an archived learner is also refused.
2. **Class give refused as a whole:** a class give with any learner archived mid-way fails with the 409 and creates nothing (the same behaviour as the 326 bulk class add). Skipping the row (`RETURN NULL`) was rejected: it would make the receipt count lie.
3. **Read-only data checks:** the Assignment Tracker may run the read-only queries R1–R4 on staging, and on production at promotion time. The write-then-rollback probe (R5) is **not** approved and is not part of this spec.

## Open questions

- None block implementation. Follow-up (separate `small` change, not in this spec): map 40P01/40001 on the give routes to a retryable 409.
