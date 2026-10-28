---
id: STUDENTARCHIVE-0029
title: Admin student delete archives the learner with an audit trail instead of erasing their work
status: approved
risk: critical
owner: product
---

# Admin student delete archives the learner with an audit trail instead of erasing their work

Approval: approved by Vinh 2026-10-27 07:14 UTC+7 (see
[`approval-decision.md`](approval-decision.md)). Revision 1 (FR-003, archived
classes skipped on restore) approved by Vinh 2026-10-28 21:23 UTC+7 (t259u, D2=a). Locked migration number:
**326** (`326_student_archive.sql`). Evidence record with citations, staging
queries and full SQL: [`research.md`](research.md).

## Problem

`DELETE /admin/students/{id}` (`backend/routers/admin_students.py:129-135`,
"Hard delete (W2 scope). Soft delete deferred to W3.") calls
`student_service.delete_student` (`backend/services/student_service.py:306-319`),
which deletes the `students` row as `service_role`. Through `ON DELETE CASCADE`
this erases every writing assignment, draft, essay, feedback, grade rating,
regrade request, class assignment item (and its course drafts, Advanced
Vocabulary and grammar lesson evidence) and class membership of the learner,
with no audit and no way back. Some learners cannot be deleted at all and the
admin gets a 500: `grammar_diagnostic_sessions` is `ON DELETE RESTRICT` to
class items and `trg_protect_advanced_vocab_item_evidence` blocks deletes with
evidence. The Supabase auth user and `public.users` row are not touched.

Staging (read-only, 2026-10-27): 9 students (8 linked to users), 22 writing
assignments, 4 drafts, 10 essays, 16 feedback rows, 3 class items, 5 active
memberships; no archive columns or audit table exist yet.

## Scope

- Migration 326: `students.archived_at / archived_by / archive_reason` with a
  consistency CHECK and partial index; append-only `student_lifecycle_audit`;
  service-role-only `fn_archive_student` and `fn_restore_student`.
- Archive ends every active class membership, clears `students.cohort_id`,
  optionally deactivates the linked account, and writes one audit row, in one
  locked transaction. No learner evidence changes.
- `DELETE /admin/students/{id}` archives (204, idempotent); new
  `POST /admin/students/{id}/restore`.
- Read paths listed in `research.md` §5 exclude archived learners by default;
  activation of an archived profile is refused before the code is consumed;
  new individual writing assignments to archived learners are refused.
- Admin UI archive/restore actions and an archived filter.

## Non-goals

- A true (GDPR-style) erase: a separate, explicit admin action with its own spec and migration (phase 2).
- A global `deleted_at` filter across every table, function and policy (rejected in `research.md` §2).
- Deleting or banning the Supabase auth user.

## Users and journeys

- Admin archives a learner who left, optionally locking the account, and can restore them later.
- Instructor no longer sees the archived learner in the roster.
- Archived learner cannot use Writing/class areas or re-activate with a new code.

## Requirements

- **FR-001:** `DELETE /admin/students/{id}` deletes no row; it archives the learner (204), is idempotent (a repeat adds no audit row), returns 404 for an unknown id, and writes an audit row with actor, reason and the classes left.
- **FR-002:** Archived learners are excluded by default from `GET /admin/students` and the instructor roster, receive no new class or individual writing assignments, get 403 in Writing/class areas, and cannot re-activate through an access code (403 before the code is consumed).
- **FR-003:** Admins can list archived learners with `?include_archived=true`, see their history, and restore them with `POST /admin/students/{id}/restore`, which re-activates the memberships ended by the archive except those in classes archived under CLASSARCHIVE-0030 (skipped, never made the learner's primary class, and listed as `skipped_archived_cohort_ids` in the restore receipt and audit row) and writes a restore audit row; restoring a non-archived learner returns 409.
- **FR-004:** With `deactivate_account=true` the linked `users.is_active` becomes false; clients cannot re-enable it, update archive columns or execute the archive functions (migration 320 trigger and grants unchanged; function EXECUTE revoked from `anon`/`authenticated`).
- **FR-005:** Archiving and restoring change no assignment, draft, essay, feedback, class item or evidence row; only memberships, the archive columns, the optional account flag and the audit table change.
- **FR-006:** A true erase is not reachable through `DELETE /admin/students/{id}`; it is reserved for a later explicit admin action limited to archived learners with typed confirmation and audit-before-delete.

## Acceptance scenarios

### Scenario 1 — archive keeps the work

- **Given** an E2E learner with a drafted assignment, a graded essay and one class membership
- **When** an admin calls `DELETE /admin/students/{id}`
- **Then** the response is 204, all row counts are unchanged except the membership becomes inactive, `archived_at` is set and one `archive` audit row exists

### Scenario 2 — archived learner is hidden and locked out of Writing

- **Given** the archived learner
- **When** the admin and instructor lists load, a class assignment is given, and the learner opens Writing or activates a new code
- **Then** the learner is absent from default lists, receives no item, gets 403, and the code stays unused

### Scenario 3 — restore

- **Given** the archived learner
- **When** an admin calls restore
- **Then** the learner reappears with the previous classes active and every piece of work intact

## Edge cases

- Concurrent archive and restore: both lock the student row `FOR UPDATE`.
- A class deleted while the learner was archived: restore skips it.
- A class archived (CLASSARCHIVE-0030) while the learner was archived: restore skips it and records it in `skipped_archived_cohort_ids` (Revision 1); an admin can add the learner back after restoring the class.
- `trg_sync_legacy_student_cohort_membership` on `cohort_id = NULL` must be tested (body not yet read).
- The learner may still read their own `students` row (`students_self_read`); the backend enforces the lockout.
- E2E cleanup scripts keep their own hard delete.

## Success criteria

- Zero learner work lost through the admin delete route; every archive and restore has an audit row; zero 500s from RESTRICT/evidence triggers on that route.

## Open questions

- None block implementation. Before writing 326, read the live bodies of `fn_create_class_assignment`, `fn_create_writing_assignments_idempotent` and the legacy cohort sync trigger on staging (T002a). Production read-only checks P1–P6 (`research.md` §6) are pending Vinh's read-only permission (chờ anh Vinh cho phép chạy chỉ đọc).
