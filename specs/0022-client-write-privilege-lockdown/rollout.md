# Rollout and rollback

## Preconditions

- Spec approved on `staging`; PR CI green; migration 320 unapplied on the target.
- The runner connects as the role that owns the public tables (`postgres`).
- Read-only pre-check (expect zero rows; otherwise 320 aborts atomically and
  reports the relation):
  `SELECT c.relname, pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user);`

## Staging

- `DRY_RUN=1 ./backend/scripts/apply_migrations.sh "$STAGING_DATABASE_URL"`, then apply.
- Run the read-only query from the migration header: zero rows.
- Replay F01/F03/F04 with a synthetic staging student token: each request is denied.
- Exercise profile edit, access-code activation, Speaking practice/grading,
  Vocabulary save, flashcard review and D1 session; run live Staging E2E.

## Production

- Under explicit authorization: `ALLOW_PROD=1 ./backend/scripts/apply_migrations.sh "$DATABASE_URL"`.
- Repeat the read-only query; spot-check `role`/`is_active` distribution for unexpected admins created before the fix.

## Rollback and repair

- Never re-grant blanket client writes; that reopens F01/F03/F04.
- For a proven legitimate client write, add a forward migration granting only
  that privilege on that table. The users trigger can be dropped independently
  (statements in the migration header).
- Repair: list `users` with `role IN ('admin','instructor')` and confirm each
  against the admin/instructor roster; demote any self-escalated account through
  FastAPI admin tools.

## Observability

- PostgREST returns 401/403 (`42501`) for denied writes; FastAPI error logs and
  the admin error dashboard show any unexpected `permission denied` or
  `users_privileged_column_change_forbidden` from learner-JWT routers. Owner:
  backend on-call.
