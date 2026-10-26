-- Migration: 320_client_write_privilege_lockdown.sql
--
-- SECURITY (F01 critical, F03 high, F04 high, F14 — staging audit 2026-10-25,
-- Project Coordinator review 2026-10-26).
--
-- Root cause. Supabase's schema default privileges (pg_default_acl, owned by
-- `postgres` on staging; by `postgres` and `supabase_admin` on production)
-- grant ALL on every new `public` table to `anon` and `authenticated`, UPDATE
-- on every sequence and EXECUTE on every function.
-- Only a few migrations (194, 223, 226, 227, 245/257, 281–283, 288, 295, 296,
-- 303, 306, 307, 312, 317) revoke them again. RLS is enabled on every table
-- (197), so the remaining guard was the write policies — and several of them
-- are owner-only without column restrictions:
--   · public.users "Users can update own data" (dashboard-created, not in the
--     repo): roles {public}, USING (auth.uid() = id), no WITH CHECK, table-wide
--     UPDATE. A signed-in user could PATCH /rest/v1/users?id=eq.<self>
--     {"role":"admin"} and pass require_admin / require_instructor (F01).
--   · own-row FOR ALL / INSERT / UPDATE policies on grading and score tables
--     (listening_*, reading_attempt_answers, quiz_*, writing_drafts, the
--     dashboard policies on sessions/responses, and d1_sessions /
--     vocabulary_exercise_attempts) let a student rewrite their own scores,
--     bands, correctness and statuses (F03).
--   · the sessions INSERT policy let an account that never redeemed an access
--     code create a session directly and then obtain AI grading (F04; FastAPI
--     now also re-checks activation/permission on every paid Speaking step).
--   · seven SECURITY DEFINER trigger functions were EXECUTE-able by anon and
--     authenticated through /rest/v1/rpc (F14).
--
-- Contract. The browser performs NO direct PostgREST table writes or RPCs (it
-- uses supabase-js only for auth); every product write goes through FastAPI.
-- FastAPI writes with `service_role` (bypasses RLS, unaffected here) except
-- routers/flashcards.py and routers/vocabulary_bank.py, which write the
-- learner's own Vocabulary/flashcard rows with the learner's JWT
-- (`authenticated`, owner-scoped RLS with WITH CHECK), and two narrow
-- learner-JWT writes in routers/vocabulary_bank.py on user_d1_questions
-- (is_active only). Server-computed D1 results — vocabulary_exercise_attempts
-- (is_correct, score, feedback, post_processed_at) and d1_sessions
-- (correct_count, total_count, status, completed_at, exercise_snapshot) — are
-- now written by routers/exercises.py with `service_role` and an explicit
-- user_id; reads stay on the learner JWT under RLS.
--
-- This migration:
--   1. revokes INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from PUBLIC,
--      anon and authenticated on every existing public table, partitioned
--      table, view, materialized view and foreign table, except the five
--      learner-owned Vocabulary/flashcard tables (which only lose anon writes
--      and TRUNCATE/REFERENCES/TRIGGER), and revokes sequence UPDATE (setval)
--      from the client roles (nextval keeps working through USAGE);
--   2. changes the default privileges of the table owner `postgres`, of the
--      runner itself and of every other role holding a default ACL in public,
--      for each role the runner may act for (superuser or member), so
--      tables/sequences created later in public are not client-writable
--      unless a migration grants it explicitly. A default ACL of a role the
--      runner cannot act for — `supabase_admin` on hosted Supabase, where the
--      runner `postgres` is neither superuser nor a member — cannot be changed
--      by this migration; step 8 reports it as a WARNING instead of failing
--      (see "Production pre-check" below). Function EXECUTE defaults are
--      deliberately unchanged: SECURITY INVOKER RPCs cannot write anything the
--      caller's table privileges deny, RLS helper functions must stay
--      callable, and step 7 guards SECURITY DEFINER;
--   3. public.users: no client UPDATE at all (PATCH /auth/profile writes with
--      service_role and validates self_level / weekly_goal / display_name, so
--      a direct column grant would only bypass that validation), and the
--      dashboard policy "Users can update own data" becomes
--      TO authenticated USING/WITH CHECK (auth.uid() = id) when it exists;
--   4. installs a BEFORE UPDATE trigger on public.users that rejects any change
--      outside the profile columns (role, is_active, permissions,
--      feature_flags, access_code_used, email, id, … and any column added
--      later) when the caller is a client role — including through a
--      SECURITY DEFINER wrapper invoked with an anon/authenticated JWT;
--   5. user_d1_questions: authenticated may UPDATE only is_active (the
--      archive/restore cascade); target_answer/options stay server-owned;
--   6. adds fn_finalize_d1_attempt_for_user (SECURITY INVOKER, service_role
--      only) — the D1 attempt seal + SRS update keyed by an explicit user id —
--      and revokes client EXECUTE on the retired learner-JWT
--      fn_finalize_d1_attempt;
--   7. revokes EXECUTE from PUBLIC, anon and authenticated on every SECURITY
--      DEFINER trigger function in public (the seven F14 guards). Trigger
--      firing does not check EXECUTE, so the guards keep running;
--   8. verifies all of the above and fails the transaction otherwise. The only
--      exception is the default ACL of an owner role the runner cannot act
--      for: WARNING `client_default_write_privilege_not_revocable_by_runner`.
--      It only applies to objects that role creates later, which app
--      migrations never do, and every EXISTING relation — whoever owns it —
--      is still checked strictly.
--
-- SELECT privileges, RLS read policies and storage are unchanged. No data is
-- read or rewritten.
--
-- Rollout ordering. The previous backend wrote vocabulary_exercise_attempts /
-- d1_sessions and called fn_finalize_d1_attempt with the learner JWT. Between
-- applying 320 and promoting the backend that ships with it, D1 attempt and D1
-- session writes fail closed (HTTP 500; D1 is default-off behind D1_ENABLED +
-- the per-user d1_enabled flag). Apply 320 and promote the backend together.
--
-- Idempotent: every REVOKE/GRANT/ALTER DEFAULT PRIVILEGES is re-runnable,
-- functions are CREATE OR REPLACE and the trigger is dropped/recreated.
-- Re-applying also restores the intended state after a hand re-grant.
--
-- Production pre-check (2026-10-26, read-only): all 137 public relations are
-- owned by `postgres`; pg_default_acl in public has client-write entries for
-- both `postgres` and `supabase_admin`; the runner `postgres` is normally not
-- superuser and not a member of `supabase_admin`. Expected result: 320
-- revokes and verifies the `postgres` defaults, and emits one WARNING listing
-- the `supabase_admin` entries. Confirm before applying:
--   SELECT rolsuper, pg_has_role(current_user, 'supabase_admin', 'MEMBER')
--     FROM pg_roles WHERE rolname = current_user;
-- Optional follow-up (not a release blocker): ask a Supabase superuser /
-- Supabase support to run, as supabase_admin,
--   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--     REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     ON TABLES FROM PUBLIC, anon, authenticated;
--   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--     REVOKE UPDATE ON SEQUENCES FROM PUBLIC, anon, authenticated;
-- after which the second query below returns zero rows.
--
-- Read-only verification (each query must return zero rows; on production
-- the second may list only `supabase_admin` rows until the follow-up above):
--   -- client writes on relations
--   SELECT c.relname, r.rolname, p.priv
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--     CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
--     CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
--    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
--      AND has_any_column_privilege(r.rolname, c.oid, p.priv)
--      AND NOT (r.rolname = 'authenticated' AND c.relname IN (
--          'user_vocabulary','flashcard_stacks','flashcard_cards',
--          'flashcard_reviews','flashcard_review_log'))
--      AND NOT (r.rolname = 'authenticated' AND c.relname = 'user_d1_questions'
--               AND p.priv = 'UPDATE');
--   -- default privileges still granting client writes
--   SELECT pg_get_userbyid(d.defaclrole), d.defaclobjtype, a.privilege_type,
--          a.grantee::regrole
--     FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
--    WHERE d.defaclnamespace IN (0, 'public'::regnamespace)
--      AND a.grantee IN (0, 'anon'::regrole, 'authenticated'::regrole)
--      AND ((d.defaclobjtype = 'r' AND a.privilege_type <> 'SELECT')
--           OR (d.defaclobjtype = 'S' AND a.privilege_type = 'UPDATE'));
--   -- client-executable SECURITY DEFINER functions
--   SELECT p.oid::regprocedure FROM pg_proc p
--    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
--      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
--           OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
--
-- ROLLBACK NOTE. Do not blanket re-grant: that restores F01/F03/F04 and also
-- re-opens tables that earlier migrations had already locked. If a legitimate
-- client write breaks, grant only that privilege on that table in a new
-- forward migration, e.g.
--   GRANT INSERT ON public.<table> TO authenticated;
-- The users trigger can be removed independently with
--   DROP TRIGGER IF EXISTS trg_users_guard_privileged_columns ON public.users;
--   DROP FUNCTION IF EXISTS public.fn_guard_users_privileged_columns();
-- The default-privilege change can be reverted per owner role with
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     ON TABLES TO anon, authenticated;
-- Never restore client writes on vocabulary_exercise_attempts / d1_sessions or
-- client EXECUTE on fn_finalize_d1_attempt*; roll the backend forward instead.

BEGIN;

-- ── 1. Client write privileges on every existing relation ──────────────────
DO $$
DECLARE
    -- Learner-owned Vocabulary/flashcard rows written by FastAPI with the
    -- learner's JWT (_user_sb in routers/flashcards.py and vocabulary_bank.py
    -- and the SECURITY INVOKER RPC fn_apply_srs_review_idempotent (212)).
    -- Owner-scoped RLS with WITH CHECK. Nothing here is a grade.
    client_write_tables CONSTANT TEXT[] := ARRAY[
        'user_vocabulary', 'flashcard_stacks', 'flashcard_cards',
        'flashcard_reviews', 'flashcard_review_log'];
    rel RECORD;
BEGIN
    FOR rel IN
        SELECT c.oid::regclass AS name, c.relname
          FROM pg_class c
          JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname = 'public'
           AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         ORDER BY c.relname
    LOOP
        EXECUTE format(
            'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON %s FROM PUBLIC, anon',
            rel.name);
        IF rel.relname = ANY (client_write_tables) THEN
            EXECUTE format(
                'REVOKE TRUNCATE, REFERENCES, TRIGGER ON %s FROM authenticated',
                rel.name);
        ELSE
            EXECUTE format(
                'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON %s FROM authenticated',
                rel.name);
        END IF;
    END LOOP;
END $$;

-- setval() is a write; nextval() for client inserts needs only USAGE.
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- ── 2. Objects created later are not client-writable by default ────────────
-- ALTER DEFAULT PRIVILEGES only changes the ACL of the role named in FOR ROLE,
-- and only a superuser or a member of that role may name it. The staging
-- default ACL belongs to `postgres`; production also has one for
-- `supabase_admin`. Revoke for every owner the runner can act for; step 8
-- verifies those strictly and warns about the others.
DO $$
DECLARE
    owner_role TEXT;
BEGIN
    FOR owner_role IN
        SELECT r.rolname
          FROM pg_roles r
         WHERE (r.rolname IN ('postgres', 'supabase_admin', current_user)
                OR r.oid IN (SELECT d.defaclrole FROM pg_default_acl d
                              WHERE d.defaclnamespace = (SELECT oid FROM pg_namespace
                                                          WHERE nspname = 'public')))
           AND ((SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
                OR pg_has_role(current_user, r.oid, 'MEMBER'))
         ORDER BY r.rolname
    LOOP
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
            'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER '
            'ON TABLES FROM PUBLIC, anon, authenticated', owner_role);
        EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
            'REVOKE UPDATE ON SEQUENCES FROM PUBLIC, anon, authenticated', owner_role);
    END LOOP;
END $$;

-- ── 3. public.users: server-written only ───────────────────────────────────
-- Step 1 removed the table-level UPDATE and with it every column grant. The
-- dashboard policy is hardened too, so a later grant could not reopen a write
-- that moves a row to another id or applies to anon.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'users'
                  AND policyname = 'Users can update own data') THEN
        ALTER POLICY "Users can update own data" ON public.users
            TO authenticated
            USING (auth.uid() = id)
            WITH CHECK (auth.uid() = id);
    END IF;
END $$;

-- ── 4. public.users: privilege/entitlement columns are server-owned ────────
-- SECURITY INVOKER on purpose: current_user must be the role performing the
-- write. A client role is detected both by current_user and by the PostgREST
-- JWT role, so a SECURITY DEFINER function called with an anon/authenticated
-- token cannot change these columns either. service_role (FastAPI) and the
-- database owner/migration roles are unaffected.
CREATE OR REPLACE FUNCTION public.fn_guard_users_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    profile_columns CONSTANT TEXT[] := ARRAY[
        'display_name', 'target_band', 'exam_date', 'self_level',
        'preferred_topics', 'onboarding_completed', 'timezone', 'weekly_goal',
        'notification_email', 'updated_at'];
    jwt_role TEXT := NULLIF(current_setting('request.jwt.claim.role', true), '');
    claims TEXT := NULLIF(current_setting('request.jwt.claims', true), '');
BEGIN
    IF jwt_role IS NULL AND claims IS NOT NULL THEN
        jwt_role := claims::jsonb ->> 'role';
    END IF;
    IF current_user::text NOT IN ('anon', 'authenticated')
       AND COALESCE(jwt_role, '') NOT IN ('anon', 'authenticated') THEN
        RETURN NEW;
    END IF;
    IF (to_jsonb(NEW) - profile_columns) IS DISTINCT FROM (to_jsonb(OLD) - profile_columns) THEN
        RAISE EXCEPTION 'users_privileged_column_change_forbidden'
            USING ERRCODE = '42501',
                  DETAIL = 'Only profile columns may be changed by a client role.';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guard_users_privileged_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_users_guard_privileged_columns ON public.users;
CREATE TRIGGER trg_users_guard_privileged_columns
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_users_privileged_columns();

-- ── 5. user_d1_questions: learner may only (de)activate ────────────────────
-- routers/vocabulary_bank._cascade_d1_questions_is_active. The answer key
-- (target_answer, options) is written by service_role only.
GRANT UPDATE (is_active) ON public.user_d1_questions TO authenticated;

-- ── 6. D1 attempt finalization runs as service_role ────────────────────────
-- Same transaction and locking as fn_finalize_d1_attempt (211), keyed by the
-- user id FastAPI resolved from the verified JWT instead of auth.uid().
CREATE OR REPLACE FUNCTION public.fn_finalize_d1_attempt_for_user(
    p_user_id          uuid,
    p_attempt_id       uuid,
    p_vocab_id         uuid,
    p_interval         integer,
    p_ease             real,
    p_lapse_delta      integer,
    p_last_reviewed_at timestamptz,
    p_next_review_at   timestamptz,
    p_feedback         jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt vocabulary_exercise_attempts%ROWTYPE;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user id is required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_attempt
      FROM vocabulary_exercise_attempts
     WHERE id = p_attempt_id
       AND user_id = p_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'D1 attempt not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.post_processed_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'attempt', to_jsonb(v_attempt),
            'finalized', false
        );
    END IF;

    IF p_vocab_id IS NOT NULL THEN
        IF p_interval IS NULL OR p_ease IS NULL
           OR p_last_reviewed_at IS NULL OR p_next_review_at IS NULL THEN
            RAISE EXCEPTION 'Incomplete D1 SRS payload' USING ERRCODE = '22023';
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM user_vocabulary
             WHERE id = p_vocab_id
               AND user_id = p_user_id
               AND NOT is_archived
               AND NOT is_pending
        ) THEN
            RAISE EXCEPTION 'D1 target vocabulary is not reviewable' USING ERRCODE = '22023';
        END IF;

        INSERT INTO flashcard_reviews AS fr (
            user_id, vocabulary_id, interval_days, ease_factor,
            review_count, lapse_count, last_reviewed_at, next_review_at, updated_at
        ) VALUES (
            p_user_id, p_vocab_id, p_interval, p_ease,
            1, GREATEST(COALESCE(p_lapse_delta, 0), 0),
            p_last_reviewed_at, p_next_review_at, p_last_reviewed_at
        )
        ON CONFLICT (user_id, vocabulary_id) DO UPDATE SET
            interval_days    = EXCLUDED.interval_days,
            ease_factor      = EXCLUDED.ease_factor,
            review_count     = fr.review_count + 1,
            lapse_count      = fr.lapse_count + GREATEST(COALESCE(p_lapse_delta, 0), 0),
            last_reviewed_at = EXCLUDED.last_reviewed_at,
            next_review_at   = EXCLUDED.next_review_at,
            updated_at       = EXCLUDED.updated_at;
    END IF;

    UPDATE vocabulary_exercise_attempts
       SET feedback = COALESCE(p_feedback, '{}'::jsonb),
           post_processed_at = NOW()
     WHERE id = p_attempt_id
       AND user_id = p_user_id
     RETURNING * INTO v_attempt;

    RETURN jsonb_build_object(
        'attempt', to_jsonb(v_attempt),
        'finalized', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_finalize_d1_attempt_for_user(
    uuid, uuid, uuid, integer, real, integer, timestamptz, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_finalize_d1_attempt_for_user(
    uuid, uuid, uuid, integer, real, integer, timestamptz, timestamptz, jsonb
) TO service_role;

DO $$
DECLARE
    retired REGPROCEDURE := to_regprocedure(
        'public.fn_finalize_d1_attempt(uuid, uuid, integer, real, integer, timestamptz, timestamptz, jsonb)');
BEGIN
    IF retired IS NOT NULL THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', retired);
    END IF;
END $$;

-- ── 7. SECURITY DEFINER trigger functions are not client RPCs (F14) ────────
-- Staging: advanced_vocab_complete_practice_after_answer,
-- advanced_vocab_guard_course_section, advanced_vocab_guard_listening_attempt,
-- advanced_vocab_guard_question_attempt, advanced_vocab_guard_selection,
-- guard_advanced_vocab_assignment_snapshot and
-- guard_grammar_assignment_evidence_write. PostgreSQL does not check EXECUTE
-- when a trigger fires, so every guard keeps running for every writer.
DO $$
DECLARE
    fn RECORD;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
          FROM pg_proc p
          JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public'
           AND p.prosecdef
           AND p.prorettype = 'trigger'::regtype
           AND NOT EXISTS (SELECT 1 FROM pg_depend d
                            WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                              AND d.deptype = 'e')
         ORDER BY 1
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
                       fn.signature);
    END LOOP;
END $$;

-- ── 8. Postcondition: fail the release instead of leaving a silent hole ────
-- A REVOKE issued by a role that did not grant the privilege only warns, so
-- check the effective privileges rather than trusting the steps above.
DO $$
DECLARE
    client_write_tables CONSTANT TEXT[] := ARRAY[
        'user_vocabulary', 'flashcard_stacks', 'flashcard_cards',
        'flashcard_reviews', 'flashcard_review_log'];
    leaks TEXT;
    unrevocable TEXT;
BEGIN
    SELECT string_agg(format('%s:%s:%s', c.relname, r.rolname, p.priv), ', '
                      ORDER BY c.relname, r.rolname, p.priv)
      INTO leaks
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
     CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
     WHERE ns.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND CASE WHEN p.priv IN ('INSERT', 'UPDATE')
                THEN has_any_column_privilege(r.rolname, c.oid, p.priv)
                ELSE has_table_privilege(r.rolname, c.oid, p.priv) END
       AND NOT (r.rolname = 'authenticated'
                AND c.relname = ANY (client_write_tables)
                AND p.priv <> 'TRUNCATE')
       AND NOT (r.rolname = 'authenticated' AND c.relname = 'user_d1_questions'
                AND p.priv = 'UPDATE');
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'client_write_privilege_lockdown_incomplete: %', leaks;
    END IF;

    SELECT string_agg(format('%s.%s:%s', a.attrelid::regclass, a.attname, r.rolname), ', '
                      ORDER BY a.attrelid::regclass::text, a.attname, r.rolname)
      INTO leaks
      FROM pg_attribute a
     CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
     WHERE a.attrelid IN ('public.users'::regclass, 'public.user_d1_questions'::regclass)
       AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege(r.rolname, a.attrelid, a.attnum, 'UPDATE')
       AND NOT (r.rolname = 'authenticated'
                AND a.attrelid = 'public.user_d1_questions'::regclass
                AND a.attname = 'is_active');
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'server_owned_column_still_client_writable: %', leaks;
    END IF;

    SELECT string_agg(format('%s:%s', c.relname, r.rolname), ', ' ORDER BY c.relname, r.rolname)
      INTO leaks
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
     WHERE ns.nspname = 'public' AND c.relkind = 'S'
       AND has_sequence_privilege(r.rolname, c.oid, 'UPDATE');
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'client_sequence_update_survives: %', leaks;
    END IF;

    -- Default ACLs of owners the runner can act for were revoked in step 2 and
    -- must be clean. An owner it cannot act for (supabase_admin on hosted
    -- Supabase) needs a Supabase superuser; its ACL only affects objects that
    -- role creates later, and every existing relation was checked above.
    SELECT string_agg(entry, ', ' ORDER BY entry) FILTER (WHERE can_act),
           string_agg(entry, ', ' ORDER BY entry) FILTER (WHERE NOT can_act)
      INTO leaks, unrevocable
      FROM (SELECT format('%s:%s:%s:%s', pg_get_userbyid(d.defaclrole), d.defaclobjtype,
                          CASE a.grantee WHEN 0 THEN 'PUBLIC'
                               ELSE pg_get_userbyid(a.grantee) END,
                          a.privilege_type) AS entry,
                   (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
                   OR pg_has_role(current_user, d.defaclrole, 'MEMBER') AS can_act
              FROM pg_default_acl d
             CROSS JOIN LATERAL aclexplode(d.defaclacl) a
             WHERE (d.defaclnamespace = 0
                    OR d.defaclnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
               AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
               AND ((d.defaclobjtype = 'r' AND a.privilege_type <> 'SELECT')
                    OR (d.defaclobjtype = 'S' AND a.privilege_type = 'UPDATE'))) acl;
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'client_default_write_privilege_survives: %', leaks;
    END IF;
    IF unrevocable IS NOT NULL THEN
        RAISE WARNING 'client_default_write_privilege_not_revocable_by_runner: %', unrevocable
            USING DETAIL = format('Runner %s is neither superuser nor a member of these owner roles. '
                                  'Their default ACLs apply only to objects they create later, which '
                                  'app migrations never do; existing relations were verified.',
                                  current_user),
                  HINT = 'Optional follow-up: a Supabase superuser (support) revokes them for '
                         'that owner; statements in the migration 320 header and '
                         'specs/0022-client-write-privilege-lockdown/rollout.md.';
    END IF;

    SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
      INTO leaks
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND (p.prosecdef OR p.proname IN ('fn_finalize_d1_attempt',
                                         'fn_finalize_d1_attempt_for_user'))
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'client_executable_privileged_function: %', leaks;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'users'
                  AND policyname = 'Users can update own data'
                  AND (roles <> ARRAY['authenticated']::name[] OR with_check IS NULL)) THEN
        RAISE EXCEPTION 'users_update_policy_not_hardened';
    END IF;
END $$;

COMMIT;
