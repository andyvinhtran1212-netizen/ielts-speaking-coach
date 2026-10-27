# Implementation plan

## Architecture impact

- Database: archive columns on `public.students`, table
  `public.student_lifecycle_audit`, functions `fn_archive_student` and
  `fn_restore_student` (SECURITY DEFINER, `search_path` pinned, EXECUTE only for
  `service_role`); archive guards on the existing membership writers
  `fn_add_student_cohort_membership`, `fn_add_students_cohort_membership` and
  `fn_sync_legacy_student_cohort_membership` (227), re-created in 326 with the
  same signatures and grants (`research.md` §4 step 4b).
- Backend (`research.md` §5 table): `routers/admin_students.py`
  (`delete_student` → archive RPC; new restore route), `services/student_service.py`
  (`delete_student` → `archive_student`; `list_students` filters
  `archived_at IS NULL` unless `include_archived`; `fetch_linked_student`
  ignores archived rows), `models/admin_students.py` (`archived_at`),
  `routers/instructor.py` roster/detail filters, `routers/auth.py`
  `/auth/activate` refuses an archived profile before activation/claim,
  individual writing assignment creation (admin and instructor) refuses archived
  learners.
- Class fan-out relies on active memberships, which archive ends; confirm by
  reading the live function bodies first (T002a).
- Archive must also stop memberships coming back (FR-002). Today three paths
  reactivate an inactive membership with `ON CONFLICT … SET is_active = true`
  (227): admin single/bulk class add (`routers/cohorts.py:283`, `:319` →
  `class_membership_service.add_student(s)` → `fn_add_student(s)_cohort_membership`),
  the direct-code cohort bridge (`routers/admin.py:2636-2653` → `add_student`),
  and the legacy `students.cohort_id` trigger (`/auth/activate` fold,
  `routers/auth.py:610-623`). 326 guards all three in the database: the add
  functions lock the student row(s) (`FOR NO KEY UPDATE`, conflicting with
  `fn_archive_student`'s `FOR UPDATE`, so an add either commits first and is then
  ended by the archive, or sees `archived_at` and refuses) and raise
  `student_archived`; the bulk function refuses the whole batch (no partial
  add); the trigger raises when it would add a membership for an archived row.
  Backend: `cohorts.py` single/bulk map `student_archived` to 409 instead of
  500; the direct-code bridge checks the linked profile before minting the code
  and returns 409 instead of swallowing the error in a warning.
- Frontend: `admin-students-directory.tsx` archive/restore actions and filter;
  retire or reword the legacy `public/js/admin-students-panel.js` delete confirm.

## Data and contracts

- `backend/migrations/326_student_archive.sql`, one transaction,
  `lock_timeout = 5s` (full SQL `research.md` §4): preconditions (no
  conflicting columns/table, 320 trigger enabled) → columns + CHECK
  `chk_students_archive_fields` + partial index → audit table (RLS on, no
  client privileges, `service_role` SELECT/INSERT only) → two functions →
  REVOKE/GRANT → postconditions (columns, privileges, RLS, no client UPDATE on
  `students`).
- API: `DELETE /admin/students/{id}` → 204 (body/query optional `reason`,
  `deactivate_account`); `POST /admin/students/{id}/restore` → 200 or 409
  `not_archived`; `GET /admin/students?include_archived=true`.
- Ordering: independent of 321–325; a ledger gap is allowed by
  `backend/migrations/README.md`. Backend that calls the RPC must deploy after
  326 is applied.

## UI and interaction

- See `ui-states.md`: archive confirmation with reason and optional account
  lock, archived filter, restore action, error banners for 404/409.

## Work decomposition

- T002a read-only function bodies → T002 migration → T003 backend → T005 UI;
  T004 tests follow T002/T003; T006 README independent.

## Rollout and rollback

- Apply 326 first, then the backend, then the UI (see `rollout.md`).
- Rollback of the schema is guarded: only with zero archived learners and an
  empty audit table; roll back code before schema, and restore the unguarded 227
  function bodies before dropping the columns.
- A plain revert of the backend is allowed only while zero learners are
  archived: the pre-0029 backend hard-deletes (`admin_students.py:129-136`) and
  admits archived learners to Writing. With archived learners present, roll back
  through an archive-compatible build that keeps the archive enforcement
  (`rollout.md`).

## Verification strategy

- PostgreSQL test: archive ends memberships, leaves evidence counts unchanged,
  writes one audit row, is idempotent; restore returns classes; client role
  cannot execute functions or change `users.is_active` (42501); rollback guard
  aborts with archived rows; single/bulk add and a `students.cohort_id` write for
  an archived learner raise `student_archived` and change no membership (bulk adds
  none of the batch); concurrent archive and add never leave an archived learner
  with an active membership; restore does not trip the guard.
- Route tests: DELETE never calls `.delete()`; activation of an archived
  profile → 403 without claiming the code; list filters; single/bulk class add
  and direct-code cohort bridge for an archived learner → 409, no code minted.
- Staging journeys `research.md` §7 AC-1…AC-14.
