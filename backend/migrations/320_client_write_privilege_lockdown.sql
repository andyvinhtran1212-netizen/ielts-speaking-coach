-- Migration: 320_client_write_privilege_lockdown.sql
--
-- SECURITY (F01 critical, F03 high, F04 high — staging audit 2026-10-25).
--
-- Root cause. Supabase grants ALL on every new `public` table to `anon` and
-- `authenticated` (schema default privileges), and only a few migrations
-- (194, 223, 226, 227, 245/257, 281–283, 288, 295, 296, 303, 306, 307, 312,
-- 317) revoke them again. RLS is enabled on every table (197), so the
-- remaining guard was the write policies — and several of them are owner-only
-- without column restrictions:
--   · public.users "Users can update own data" (dashboard-created, not in the
--     repo): USING (auth.uid() = id), table-wide UPDATE. A signed-in user could
--     PATCH /rest/v1/users?id=eq.<self> {"role":"admin"} and then pass
--     require_admin / require_instructor and the RLS helpers (F01).
--   · own-row FOR ALL / INSERT / UPDATE policies on grading and score tables
--     (listening_attempts, listening_sessions, reading_attempt_answers,
--     quiz_sessions, quiz_attempts, quiz_word_stats, writing_drafts, plus the
--     dashboard policies on sessions/responses) let a student rewrite their own
--     scores, bands and statuses (F03).
--   · the sessions INSERT policy let an account that never redeemed an access
--     code create a session directly and then obtain AI grading (F04).
--
-- Contract. The browser performs NO direct PostgREST table writes or RPCs (it
-- uses supabase-js only for auth); every product write goes through FastAPI.
-- FastAPI writes with `service_role` (bypasses RLS, unaffected here) except
-- routers/flashcards.py, routers/vocabulary_bank.py and routers/exercises.py,
-- which deliberately write the learner's own Vocabulary/D1 practice rows with
-- the learner's JWT (`authenticated`, owner-scoped RLS with WITH CHECK). Those
-- eight tables keep their `authenticated` write privileges; see
-- `client_write_tables` below. Everything else becomes read-only to client
-- roles at the privilege layer, which PostgreSQL checks BEFORE any RLS policy,
-- so policies created by hand outside the repo cannot reopen a write.
--
-- This migration:
--   1. revokes INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from PUBLIC,
--      anon and authenticated on every existing public table, partitioned
--      table, view, materialized view and foreign table, except the eight
--      learner-owned practice tables (which only lose anon writes and
--      TRUNCATE/REFERENCES/TRIGGER);
--   2. changes this role's default privileges so tables created later in
--      public are not client-writable unless a migration grants it explicitly;
--   3. grants `authenticated` UPDATE on exactly the profile columns that
--      PATCH /auth/profile already exposes (routers/auth.py), and nothing else
--      on public.users;
--   4. installs a BEFORE UPDATE trigger on public.users that rejects any change
--      outside those profile columns (role, is_active, permissions,
--      feature_flags, access_code_used, email, id, … and any column added
--      later) when the caller is a client role — including through a
--      SECURITY DEFINER wrapper invoked with an anon/authenticated JWT;
--   5. verifies the resulting privileges and fails the transaction otherwise.
--
-- SELECT privileges, RLS read policies, storage and function EXECUTE grants
-- are unchanged. No data is read or rewritten.
--
-- Idempotent: every REVOKE/GRANT is re-runnable, the function is CREATE OR
-- REPLACE and the trigger is dropped/recreated. Re-applying also restores the
-- intended state if a later hand edit re-granted client writes.
--
-- Read-only verification (expect zero rows):
--   SELECT c.relname, r.rolname, p.priv
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--     CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
--     CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
--    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
--      AND has_any_column_privilege(r.rolname, c.oid, p.priv)
--      AND NOT (r.rolname = 'authenticated' AND c.relname IN (
--          'user_vocabulary','user_d1_questions','flashcard_stacks',
--          'flashcard_cards','flashcard_reviews','flashcard_review_log',
--          'vocabulary_exercise_attempts','d1_sessions'))
--      AND NOT (r.rolname = 'authenticated' AND c.relname = 'users'
--               AND p.priv = 'UPDATE');
--
-- ROLLBACK NOTE. Do not blanket re-grant: that restores F01/F03/F04 and also
-- re-opens tables that earlier migrations had already locked. If a legitimate
-- client write breaks, grant only that privilege on that table in a new
-- forward migration, e.g.
--   GRANT INSERT ON public.<table> TO authenticated;
-- The trigger can be removed independently with
--   DROP TRIGGER IF EXISTS trg_users_guard_privileged_columns ON public.users;
--   DROP FUNCTION IF EXISTS public.fn_guard_users_privileged_columns();
-- and the default-privilege change reverted with
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     ON TABLES TO anon, authenticated;

BEGIN;

-- ── 1. Client write privileges on every existing relation ──────────────────
DO $$
DECLARE
    -- Learner-owned practice rows written by FastAPI with the learner's JWT
    -- (_user_sb in routers/flashcards.py, vocabulary_bank.py, exercises.py and
    -- the SECURITY INVOKER RPCs fn_apply_srs_review_idempotent (212) and
    -- fn_finalize_d1_attempt (211)). Owner-scoped RLS with WITH CHECK.
    client_write_tables CONSTANT TEXT[] := ARRAY[
        'user_vocabulary', 'user_d1_questions', 'flashcard_stacks',
        'flashcard_cards', 'flashcard_reviews', 'flashcard_review_log',
        'vocabulary_exercise_attempts', 'd1_sessions'];
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

-- ── 2. Tables created later are not client-writable by default ─────────────
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLES FROM PUBLIC, anon, authenticated;

-- ── 3. public.users: profile columns only ──────────────────────────────────
-- Exactly the fields PATCH /auth/profile accepts. Step 1 already removed the
-- table-level UPDATE (and with it every column-level UPDATE grant).
GRANT UPDATE (display_name, target_band, exam_date, self_level,
              preferred_topics, onboarding_completed, timezone, weekly_goal,
              notification_email)
    ON public.users TO authenticated;

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

-- ── 5. Postcondition: fail the release instead of leaving a silent hole ────
-- A REVOKE issued by a role that did not grant the privilege only warns, so
-- check the effective privileges rather than trusting step 1.
DO $$
DECLARE
    client_write_tables CONSTANT TEXT[] := ARRAY[
        'user_vocabulary', 'user_d1_questions', 'flashcard_stacks',
        'flashcard_cards', 'flashcard_reviews', 'flashcard_review_log',
        'vocabulary_exercise_attempts', 'd1_sessions'];
    profile_columns CONSTANT TEXT[] := ARRAY[
        'display_name', 'target_band', 'exam_date', 'self_level',
        'preferred_topics', 'onboarding_completed', 'timezone', 'weekly_goal',
        'notification_email'];
    leaks TEXT;
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
       AND NOT (r.rolname = 'authenticated' AND c.relname = 'users' AND p.priv = 'UPDATE');
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'client_write_privilege_lockdown_incomplete: %', leaks;
    END IF;

    SELECT string_agg(a.attname, ', ' ORDER BY a.attname)
      INTO leaks
      FROM pg_attribute a
     WHERE a.attrelid = 'public.users'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
       AND NOT a.attname = ANY (profile_columns);
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'users_privileged_column_still_writable: %', leaks;
    END IF;
END $$;

COMMIT;
