# Implementation plan

## Architecture impact

- Database: archive columns on `public.students`, table
  `public.student_lifecycle_audit`, functions `fn_archive_student` and
  `fn_restore_student` (SECURITY DEFINER, `search_path` pinned, EXECUTE only for
  `service_role`).
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
  empty audit table; roll back code before schema.

## Verification strategy

- PostgreSQL test: archive ends memberships, leaves evidence counts unchanged,
  writes one audit row, is idempotent; restore returns classes; client role
  cannot execute functions or change `users.is_active` (42501); rollback guard
  aborts with archived rows.
- Route tests: DELETE never calls `.delete()`; activation of an archived
  profile → 403 without claiming the code; list filters.
- Staging journeys `research.md` §7 AC-1…AC-13.
