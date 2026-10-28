-- Migration: 335_learner_jwt_writes_require_active_account.sql
--
-- SECURITY (SEC-20261028-02, Security Auditor 2026-10-28; spec
-- INACTIVEWRITE-0035). An account whose users.is_active is false (never
-- redeemed an access code, or deactivated by an archive) can still write its
-- own Vocabulary/flashcard rows straight through PostgREST:
--   POST /rest/v1/user_vocabulary  (and flashcard_stacks, flashcard_cards,
--   flashcard_reviews, flashcard_review_log; PATCH user_d1_questions.is_active)
-- FastAPI refuses the same account with 403 (W-03 activation gate,
-- services/activation_gate.py), but migration 320 deliberately kept
-- INSERT/UPDATE/DELETE for `authenticated` on these tables, because
-- routers/flashcards.py and routers/vocabulary_bank.py write them with the
-- learner's JWT, and their policies check only ownership (auth.uid() =
-- user_id). Side effects: unbounded row spam and headwords fed into the admin
-- IPA/definition enrichment batch (Gemini).
--
-- Fix. One RESTRICTIVE policy per write command (INSERT, UPDATE, DELETE),
-- TO authenticated, on every table where `authenticated` keeps a write
-- privilege after 320. Restrictive policies are AND-ed with the existing
-- permissive owner policies (including any dashboard-created ones), so the
-- owner checks are unchanged and an inactive account now fails every write:
--   INSERT          → 42501 "new row violates row-level security policy"
--                     (PostgREST 403);
--   UPDATE / DELETE → the caller's rows are not visible to the command, so 0
--                     rows change (PostgREST 200/204 with an empty result).
-- Reads (SELECT) are unchanged.
--
-- The activation test is app_private.is_current_user_active(): SECURITY
-- DEFINER (the owner reads public.users without the caller's RLS), STABLE,
-- search_path pinned to '', keyed only on auth.uid() (it cannot be asked about
-- another account), and a missing users row or NULL is_active counts as
-- inactive, like activation_gate.lookup_is_active. It lives in a private,
-- non-exposed schema rather than public because 320's postcondition forbids
-- client-executable SECURITY DEFINER functions in public; `authenticated`
-- needs EXECUTE because RLS evaluates policies as the caller. The policies
-- call it as `(SELECT …)`, so it runs once per statement, not once per row.
--
-- Unaffected: FastAPI's learner-JWT routes (gated to active accounts already),
-- the SECURITY INVOKER fn_apply_srs_review_idempotent (runs as the caller, so
-- it is covered too), service_role (BYPASSRLS: admin tools, D1 finalize,
-- enrichment), the table owner and FK cascades.
--
-- Postconditions: every public relation where `authenticated` holds INSERT,
-- UPDATE (table- or column-level) or DELETE has RLS enabled and the matching
-- restrictive active-account policy; the helper is SECURITY DEFINER, STABLE,
-- search_path-pinned, executable by `authenticated` but not by `anon`/PUBLIC,
-- and its owner bypasses RLS on public.users.
--
-- One transaction, lock_timeout 5s (CREATE POLICY takes a brief ACCESS
-- EXCLUSIVE lock per table). No row is read or written. Re-runnable: the
-- function is CREATE OR REPLACE and each policy is dropped and re-created.
--
-- Rollout. Apply on staging first; no backend deploy is needed (active
-- accounts see no change). Read-only verification after apply:
--   SELECT c.relname, p
--     FROM pg_class c CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE']) p
--    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
--      AND CASE p WHEN 'DELETE' THEN has_table_privilege('authenticated', c.oid, p)
--               ELSE has_any_column_privilege('authenticated', c.oid, p) END
--      AND NOT EXISTS (
--          SELECT 1 FROM pg_policy pol
--           WHERE pol.polrelid = c.oid AND NOT pol.polpermissive
--             AND pol.polcmd = CASE p WHEN 'INSERT' THEN 'a' WHEN 'UPDATE' THEN 'w' ELSE 'd' END
--             AND 'authenticated'::regrole = ANY (pol.polroles)
--             AND pg_get_expr(COALESCE(pol.polwithcheck, pol.polqual), pol.polrelid)
--                 LIKE '%app_private.is_current_user_active()%');
--   -- must return zero rows
--
-- Rollback (forward migration; reopens SEC-20261028-02 only, no data to
-- repair):
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DO $$
--   DECLARE t TEXT; c TEXT;
--   BEGIN
--     FOREACH t IN ARRAY ARRAY['user_vocabulary','flashcard_stacks','flashcard_cards',
--                              'flashcard_reviews','flashcard_review_log','user_d1_questions'] LOOP
--       FOREACH c IN ARRAY ARRAY['insert','update','delete'] LOOP
--         EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'require_active_account_' || c, t);
--       END LOOP;
--     END LOOP;
--   END $$;
--   DROP FUNCTION IF EXISTS app_private.is_current_user_active();
--   COMMIT;
-- (Leave the app_private schema: it is empty and harmless.)

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 1. Preconditions ─────────────────────────────────────────────────────────
DO $$
DECLARE
    learner_tables CONSTANT TEXT[] := ARRAY[
        'user_vocabulary', 'flashcard_stacks', 'flashcard_cards',
        'flashcard_reviews', 'flashcard_review_log', 'user_d1_questions'];
    missing TEXT;
BEGIN
    SELECT string_agg(t, ', ') INTO missing
      FROM unnest(learner_tables) t
     WHERE to_regclass('public.' || t) IS NULL;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'learner_table_missing: %', missing;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute
                    WHERE attrelid = 'public.users'::regclass
                      AND attname = 'is_active' AND NOT attisdropped) THEN
        RAISE EXCEPTION 'users_is_active_missing';
    END IF;
    IF to_regprocedure('auth.uid()') IS NULL THEN
        RAISE EXCEPTION 'auth_uid_missing';
    END IF;
    -- 320 must already have narrowed client writes; otherwise the
    -- postcondition below would have to cover ~100 tables.
    IF has_table_privilege('anon', 'public.user_vocabulary', 'INSERT') THEN
        RAISE EXCEPTION 'migration_320_missing: anon can still write public.user_vocabulary';
    END IF;
END $$;

-- ── 2. Activation helper (private schema, not exposed by PostgREST) ──────────
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON SCHEMA app_private FROM anon;
GRANT USAGE ON SCHEMA app_private TO authenticated;

CREATE OR REPLACE FUNCTION app_private.is_current_user_active()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT u.is_active FROM public.users u WHERE u.id = auth.uid()),
        FALSE)
$$;

COMMENT ON FUNCTION app_private.is_current_user_active() IS
    'SEC-20261028-02 / migration 335: users.is_active of the JWT caller (missing row or NULL = false). '
    'Used by the require_active_account_* restrictive RLS policies.';

REVOKE ALL ON FUNCTION app_private.is_current_user_active() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.is_current_user_active() FROM anon;
GRANT EXECUTE ON FUNCTION app_private.is_current_user_active() TO authenticated;

-- ── 3. Restrictive active-account policies ───────────────────────────────────
DO $$
DECLARE
    learner_tables CONSTANT TEXT[] := ARRAY[
        'user_vocabulary', 'flashcard_stacks', 'flashcard_cards',
        'flashcard_reviews', 'flashcard_review_log', 'user_d1_questions'];
    t TEXT;
BEGIN
    FOREACH t IN ARRAY learner_tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS require_active_account_insert ON public.%I', t);
        EXECUTE format('CREATE POLICY require_active_account_insert ON public.%I'
                       ' AS RESTRICTIVE FOR INSERT TO authenticated'
                       ' WITH CHECK ((SELECT app_private.is_current_user_active()))', t);
        EXECUTE format('DROP POLICY IF EXISTS require_active_account_update ON public.%I', t);
        EXECUTE format('CREATE POLICY require_active_account_update ON public.%I'
                       ' AS RESTRICTIVE FOR UPDATE TO authenticated'
                       ' USING ((SELECT app_private.is_current_user_active()))'
                       ' WITH CHECK ((SELECT app_private.is_current_user_active()))', t);
        EXECUTE format('DROP POLICY IF EXISTS require_active_account_delete ON public.%I', t);
        EXECUTE format('CREATE POLICY require_active_account_delete ON public.%I'
                       ' AS RESTRICTIVE FOR DELETE TO authenticated'
                       ' USING ((SELECT app_private.is_current_user_active()))', t);
    END LOOP;
END $$;

-- ── 4. Postconditions ────────────────────────────────────────────────────────
DO $$
DECLARE
    fn OID := to_regprocedure('app_private.is_current_user_active()');
    gaps TEXT;
BEGIN
    IF fn IS NULL THEN
        RAISE EXCEPTION 'active_helper_missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p
                    WHERE p.oid = fn AND p.prosecdef AND p.provolatile = 's'
                      AND p.proconfig @> ARRAY['search_path=""']) THEN
        RAISE EXCEPTION 'active_helper_not_pinned_stable_security_definer';
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'active_helper_executable_by_anon';
    END IF;
    IF NOT has_function_privilege('authenticated', fn, 'EXECUTE')
       OR NOT has_schema_privilege('authenticated', 'app_private', 'USAGE') THEN
        RAISE EXCEPTION 'active_helper_not_executable_by_authenticated';
    END IF;
    -- The definer must see every users row: superuser, BYPASSRLS, or the
    -- table owner while RLS is not forced.
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_roles r ON r.oid = p.proowner
          JOIN pg_class u ON u.oid = 'public.users'::regclass
         WHERE p.oid = fn
           AND (r.rolsuper OR r.rolbypassrls
                OR (u.relowner = p.proowner AND NOT u.relforcerowsecurity))) THEN
        RAISE EXCEPTION 'active_helper_owner_subject_to_users_rls';
    END IF;

    SELECT string_agg(format('%s:%s', c.relname, priv), ', ' ORDER BY c.relname, priv)
      INTO gaps
      FROM pg_class c
     CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) priv
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind IN ('r', 'p')
       AND CASE priv WHEN 'DELETE' THEN has_table_privilege('authenticated', c.oid, priv)
                     ELSE has_any_column_privilege('authenticated', c.oid, priv) END
       AND NOT (
           c.relrowsecurity
           AND EXISTS (
               SELECT 1 FROM pg_policy pol
                WHERE pol.polrelid = c.oid
                  AND NOT pol.polpermissive
                  AND pol.polcmd = CASE priv WHEN 'INSERT' THEN 'a' WHEN 'UPDATE' THEN 'w' ELSE 'd' END
                  AND 'authenticated'::regrole = ANY (pol.polroles)
                  AND (priv = 'INSERT' OR pg_get_expr(pol.polqual, pol.polrelid)
                                         LIKE '%app_private.is_current_user_active()%')
                  AND (priv = 'DELETE' OR pg_get_expr(pol.polwithcheck, pol.polrelid)
                                         LIKE '%app_private.is_current_user_active()%')));
    IF gaps IS NOT NULL THEN
        RAISE EXCEPTION 'client_write_without_active_account_check: %', gaps;
    END IF;
END $$;

COMMIT;
