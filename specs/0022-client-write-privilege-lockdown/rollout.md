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
  - Default ACLs in public held by a role other than `postgres`, and whether
    the runner can act for it (staging 2026-10-26: none; production
    2026-10-26: `supabase_admin`, runner not superuser and not a member):
    `SELECT pg_get_userbyid(defaclrole), defaclobjtype, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) OR pg_has_role(current_user, defaclrole, 'MEMBER') AS runner_can_act FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace AND pg_get_userbyid(defaclrole) <> 'postgres';`
    Rows with `runner_can_act = true` are revoked and verified strictly. Rows
    with `false` do not abort 320: it succeeds with
    `WARNING: client_default_write_privilege_not_revocable_by_runner: <owner>:<r|S>:<grantee>:<privilege>, …`.
    That ACL only affects objects its owner creates later; app migrations
    never create objects as `supabase_admin`, and every existing relation is
    still checked strictly.
- PostgreSQL 17 (staging and production run 17.6): the Supabase default ACL
  also grants `MAINTAIN` to `anon`/`authenticated`, and so do existing public
  tables. 320 revokes `MAINTAIN` from client roles on every relation and in the
  default ACLs of owners the runner can act for, when
  `server_version_num >= 170000` (CI runs 16, which has no `MAINTAIN`). The
  first staging apply (before this was added) aborted atomically with
  `client_default_write_privilege_survives: postgres:r:anon:MAINTAIN, postgres:r:authenticated:MAINTAIN`
  and left nothing applied; the `supabase_admin` WARNING now also lists its
  `MAINTAIN` entries.

## Staging

- `DRY_RUN=1 ./backend/scripts/apply_migrations.sh "$STAGING_DATABASE_URL"`, then apply.
- Promote the backend from the same PR immediately after: between the two,
  D1 attempt/session writes from the previous backend fail closed (HTTP 500).
  D1 is default-off (`D1_ENABLED` and per-user `d1_enabled`).
- Run the read-only queries from the migration header (the MAINTAIN one on
  PG 17+): zero rows each.
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

- Pre-check (read-only, 2026-10-26 results): all 137 public relations owned by
  `postgres` (first precondition query: zero rows); the same seven F14 trigger
  functions client-executable (revoked by step 7); "Users can update own data"
  present with `{public}` and no WITH CHECK (hardened by step 3); default ACLs
  for `postgres` and `supabase_admin`; latest applied migration 319. Re-run
  the precondition queries immediately before applying.
- Under explicit authorization, with the production promotion ready:
  `ALLOW_PROD=1 ./backend/scripts/apply_migrations.sh "$DATABASE_URL"`, then promote.
- Expect exactly one `client_default_write_privilege_not_revocable_by_runner`
  WARNING naming only `supabase_admin` entries; record it in the release
  evidence. A warning naming `postgres` cannot happen (that would abort as
  `client_default_write_privilege_survives`).
- Repeat the read-only queries; the default-ACL query may list only
  `supabase_admin` rows. Spot-check `role`/`is_active` distribution for
  unexpected admins created before the fix.
- Optional follow-up (not a release blocker; owner decision): ask a Supabase
  superuser / Supabase support to run, as `supabase_admin`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;`
  ,
  `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE MAINTAIN ON TABLES FROM PUBLIC, anon, authenticated;`
  and
  `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM PUBLIC, anon, authenticated;`
  then confirm the default-ACL query returns zero rows. Until then, any table
  Supabase itself creates in `public` as `supabase_admin` would be
  client-writable; re-applying 320 (or the relation query) detects it.

## Amendment 1

### (b) FR-011 — migration 351

- Forward-policy `pending_feature` group `dashboard_rpcs_revoke`: merging
  applies nothing. The Leader/RM applies it on staging with the advisory-locked
  runner; production only at a promotion approved by Vinh. No backend deploy.
- Verify with the read-only query in the 351 header: anon and authenticated
  `false`, service_role `true`, no `=X` PUBLIC entry; then view `/admin`
  overview and trends and confirm no `fn_dashboard_*` 42501 or RPC fallback in
  the backend log.
- Emergency rollback only: the GRANT in the 351 header restores the old ACL.
- One backend-only dashboard function still has client EXECUTE:
  `public.fn_dashboard_daily_practices(p_since timestamptz)` (migration 139) is
  called only by the backend through the service role, but 351 does not revoke
  it. A separate ticket follows after Amendment 1 is approved.

### (c) FR-012 — migration 349

- Amendment 1 exceptions (tables that keep a client privilege although RLS is
  enabled and they have no policy): none. Security Auditor classification
  2026-10-29 (36 tables, all REVOKE; `listening_tests` handled by migration
  347).
- FR-012 holds on an environment only after both 347 and 349 are applied.
  Production was not classified; re-run the Security Auditor catalog query
  read-only on production before the promotion that carries 349.
- Forward-policy `pending_feature`: merging applies nothing. Staging first by
  the Leader/RM under the advisory lock; production only at a promotion
  approved by Vinh. Emergency rollback only: the GRANT SELECT statements in the
  349 header.

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
