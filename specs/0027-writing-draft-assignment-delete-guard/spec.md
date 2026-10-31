---
id: ASSIGNDRAFT-0027
title: Deleting a writing assignment can never erase a learner's draft
status: implementing
risk: high
owner: product
---

# Deleting a writing assignment can never erase a learner's draft

Approval: approved by Vinh 2026-10-27 07:14 UTC+7 (see
[`approval-decision.md`](approval-decision.md)). Bug A-08 part B. Part A (code
guard returning 409) merged to `staging` in #1732 (`d129a1d23`). Locked
migration number: **324** (`324_writing_drafts_assignment_fk_no_action.sql`).
Evidence record with citations, staging queries and full SQL:
[`research.md`](research.md) (written before #1732 merged; this spec is the
canonical contract).

Revision 1 (approved by Vinh 2026-10-28 21:23 UTC+7, see
[`approval-decision.md`](approval-decision.md)): the 409
`ASSIGNMENT_STARTED_DETAIL` wording follows Content Manager review item #9 for
#1836. FR-001…FR-004 are unchanged.

## Problem

`writing_drafts.assignment_id` references `writing_assignments(id)` with
`ON DELETE CASCADE` (`backend/migrations/037_writing_drafts.sql:17`, identical
live on staging). Any delete of an assignment silently deletes the learner's
draft. Part A (#1732, `backend/services/writing_assignment_delete_guard.py`)
now refuses deletes of started assignments in both routes
(`DELETE /admin/writing/assignments/{id}`, `DELETE /instructor/assignments/{id}`),
but it is a check-then-delete in application code: its own docstring records
that "a draft inserted between the draft check and the delete can still be
lost; closing that fully needs a schema change". Scripts, manual SQL and any
future path are not covered either.

Staging (read-only, 2026-10-27): `writing_drafts_assignment_id_fkey` is the only
foreign key into `writing_assignments`; 4 drafts, all on `in_progress`
assignments; zero orphan drafts.

## Scope

- Migration 324: change `writing_drafts_assignment_id_fkey` from `ON DELETE
  CASCADE` to `ON DELETE NO ACTION` (precheck, NOT VALID + VALIDATE,
  postcondition; no data change).
- `delete_unstarted_assignment` maps a foreign-key violation (`23503`) on its
  final `DELETE` to the existing 409 `ASSIGNMENT_STARTED_DETAIL`
  ("Học viên đã bắt đầu làm bài nên không xóa được bài giao này.") instead of a 500.
- Revision 1: `ASSIGNMENT_STARTED_DETAIL` changes from "Học viên đã bắt đầu — không xoá được" to
  "Học viên đã bắt đầu làm bài nên không xóa được bài giao này." (Content Manager review item #9 for #1836, "xóa" spelling); the
  pinned backend test, the admin delete-dialog browser verifier and the
  migrations README follow. Status code, routes and refusal rules are unchanged.
- Tests for the migration and the 23503 → 409 mapping; migrations README.

## Non-goals

- Soft-delete of writing assignments (`deleted_at`), rejected in `research.md` §3.
- Changing part A's status/draft/essay rules or the 409 status code (only the
  message wording changes, in Revision 1).
- Class assignment deletion (already guarded by the 179/283 RPC).
- Student deletion semantics (STUDENTARCHIVE-0029).

## Users and journeys

- Admin or instructor deletes an assignment the learner has not started: still succeeds.
- Learner saves a draft at the same moment an assignment is deleted: the draft survives and the deleter sees 409.

## Requirements

- **FR-001:** The database refuses to delete a `writing_assignments` row while a `writing_drafts` row references it, for every database role and every code path.
- **FR-002:** Admin and instructor DELETE routes return 409 with `ASSIGNMENT_STARTED_DETAIL` (never 500) when the delete is refused because a draft exists, including the race where the draft appears after the guard's checks; an unstarted assignment without a draft is still deleted as before.
- **FR-003:** Deleting a student through a single statement that cascades to both the assignment and its draft (purge or E2E cleanup) still succeeds under NO ACTION; this is proven by a PostgreSQL test before merge.
- **FR-004:** Migration 324 changes no row, is idempotent, aborts on orphan drafts or an unexpected FK action, and leaves no cascading child foreign key on `writing_assignments`.

## Acceptance scenarios

### Scenario 1 — started assignment

- **Given** an E2E learner saved a draft on an assignment
- **When** an admin or the owning instructor deletes it
- **Then** the API returns 409 and the draft text is unchanged

### Scenario 2 — race

- **Given** the guard has read an assignment as unstarted
- **When** the learner's draft insert commits before the DELETE
- **Then** the DELETE fails with 23503, the route returns 409 and the draft remains

### Scenario 3 — unstarted assignment

- **Given** a pending assignment with no draft
- **When** it is deleted
- **Then** the delete succeeds exactly as before 324

## Edge cases

- Submission deletes the draft by design (037); submit must keep working.
- Instructor deleting another instructor's assignment keeps returning 404.
- Bulk operational scripts now get 23503 instead of silently erasing drafts (intended).

## Success criteria

- Zero draft rows lost to assignment deletes after 324; zero 500s from the DELETE routes caused by 23503.
- Catalog shows `confdeltype = 'a'` and validated on staging and production.

## Open questions

- None block implementation. Production read-only checks P1–P5 (`research.md` §7) are still pending Vinh's read-only permission (chờ anh Vinh cho phép chạy chỉ đọc).
