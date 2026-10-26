# Rollout and rollback

## Preconditions

- Spec approved on `staging`; PR CI green; migration 320 unapplied on the target.
- The runner connects as the role that owns the public tables (`postgres`).
- Read-only pre-checks (expect zero rows; otherwise 320 aborts atomically and
  reports the object):
  - Relations not owned by the runner:
    `SELECT c.relname, pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user);`
  - Client-executable SECURITY DEFINER functions other than trigger functions:
    `SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.prorettype <> 'trigger'::regtype AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));`
  - Default ACLs in public held by a role other than `postgres` (staging
    2026-10-26: none):
    `SELECT pg_get_userbyid(defaclrole), defaclobjtype FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace AND pg_get_userbyid(defaclrole) <> 'postgres';`

## Staging

- `DRY_RUN=1 ./backend/scripts/apply_migrations.sh "$STAGING_DATABASE_URL"`, then apply.
- Promote the backend from the same PR immediately after: between the two,
  D1 attempt/session writes from the previous backend fail closed (HTTP 500).
  D1 is default-off (`D1_ENABLED` and per-user `d1_enabled`).
- Run the three read-only queries from the migration header: zero rows each.
- Replay with a synthetic staging student token: PATCH `users` role, PATCH
  `d1_sessions` counts, PATCH `vocabulary_exercise_attempts` score, POST
  `sessions`, POST `/rpc/guard_grammar_assignment_evidence_write`; each denied.
- With a synthetic inactive account and a session row created by the service
  role, POST `/sessions/{id}/questions/generate` and `/responses`: 403.
- Exercise profile edit, access-code activation, Speaking practice (start →
  questions → record → grading → result), Full Test pronunciation,
  Vocabulary save/archive, flashcard review and a D1 session; run live
  Staging E2E.

## Production

- Under explicit authorization, with the production promotion ready:
  `ALLOW_PROD=1 ./backend/scripts/apply_migrations.sh "$DATABASE_URL"`, then promote.
- Repeat the read-only queries; spot-check `role`/`is_active` distribution for
  unexpected admins created before the fix.

## Rollback and repair

- Never re-grant blanket client writes; that reopens F01/F03/F04.
- For a proven legitimate client write, add a forward migration granting only
  that privilege on that table. The users trigger can be dropped independently
  (statements in the migration header).
- Never restore client writes on `d1_sessions` / `vocabulary_exercise_attempts`;
  if the D1 backend must be rolled back, roll it forward instead or keep D1 off.
- The Speaking admission guard is code-only; reverting the backend commit
  removes it without a schema change.
- Repair: list `users` with `role IN ('admin','instructor')` and confirm each
  against the admin/instructor roster; demote any self-escalated account through
  FastAPI admin tools.

## Observability

- PostgREST returns 401/403 (`42501`) for denied writes; FastAPI error logs and
  the admin error dashboard show any unexpected `permission denied`,
  `users_privileged_column_change_forbidden` or D1 `Could not save attempt` /
  `Could not finish saving attempt` after promotion. A rise in Speaking 403
  "Tài khoản chưa được kích hoạt" / "không có quyền" on generate/grading means
  accounts were mid-session when deactivated or revoked. Owner: backend on-call.
