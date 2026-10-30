-- Migration: 347_listening_tests_client_revoke.sql
--
-- SECURITY (PC-J163, P3; found by RM at the promo-1030 T-0 gate rehearsal,
-- confirmed by SA on staging 2026-10-29; spec LISTENING-0005 FR-004).
--
-- 295 revoked every client privilege on the Listening content tables
-- (listening_content_packages, listening_lessons, listening_package_stimuli,
-- listening_form_stimuli, listening_exercises) but missed public.listening_tests.
-- That table still has the Supabase default grant, narrowed to SELECT by 320:
--   staging relacl 2026-10-29:
--   {postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,
--    service_role=arwdDxtm/postgres}
-- RLS is on and there is no policy, so no client reads a row today. But the
-- grant is the only layer left: one broad SELECT policy added later would
-- expose every Listening form, including its answers and metadata, through
-- /rest/v1/listening_tests.
--
-- Nobody needs the grant. FastAPI reads and writes listening_tests with
-- service_role only (database.supabase_admin: routers/listening.py,
-- listening_source_collection.py, class_student.py, admin_class_assignments.py,
-- feedback.py, services/exam_content_service.py, mock_exam_service.py,
-- listening_package_import.py, listening_source_collection.py); no JWT-scoped
-- client (_user_sb in dashboard.py, exercises.py, flashcards.py,
-- vocabulary_bank.py) names it, and the frontend makes no PostgREST call on it.
-- On staging no policy on another table names it, the only view on it
-- (listening_public_practice_catalog, 306) is owned by postgres and granted to
-- service_role only, and the one client-executable function that reads it is
-- the trigger function fn_protect_listening_package_child (295), which fires
-- only on writes the client roles cannot make (320).
--
-- This migration revokes ALL on public.listening_tests from PUBLIC, anon and
-- authenticated (on PostgreSQL 17 ALL includes MAINTAIN). service_role, the
-- owner, RLS and every other object are untouched.
--
-- Postconditions:
--   · has_table_privilege('anon'/'authenticated', 'public.listening_tests',
--     'SELECT') are both false;
--   · PUBLIC, anon and authenticated hold no table privilege of any kind
--     (MAINTAIN on PG 17+) and no column privilege;
--   · service_role keeps SELECT, INSERT, UPDATE and DELETE (the backend path).
-- RLS is not touched and not required: the revoke closes the table whether
-- or not RLS is on.
-- A REVOKE only removes grants made by the runner (or the owner it acts for).
-- If a hosted catalog has a client grant from another grantor, the
-- postcondition aborts the transaction instead of reporting success.
--
-- One transaction, lock_timeout 5s. No row is written. Re-runnable. No backend
-- deploy needed.
--
-- Rollout: group listening_tests_revoke in forward-policy.tsv. Merging does
-- not apply it. Staging first under the advisory lock, production only at an
-- authorised staging→main promotion. Read-only verification after apply:
--   SELECT r, has_table_privilege(r, 'public.listening_tests', 'SELECT')
--     FROM unnest(ARRAY['anon', 'authenticated']) r;
--   -- two rows, both f
--   SELECT relacl FROM pg_class WHERE oid = 'public.listening_tests'::regclass;
--   -- no anon=, authenticated= or bare = (PUBLIC) entry
--
-- Rollback (forward migration). DO NOT USE except in an emergency where a
-- client path is proven to need it: it restores the exact pre-347 grant
-- (SELECT only, from the staging relacl above) and leaves the table one
-- broad policy away from exposing every Listening form and answer.
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   GRANT SELECT ON public.listening_tests TO anon, authenticated;
--   COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
    IF to_regclass('public.listening_tests') IS NULL THEN
        RAISE EXCEPTION 'listening_tests_missing';
    END IF;
END $$;

REVOKE ALL ON TABLE public.listening_tests FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
    privileges TEXT[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                               'REFERENCES', 'TRIGGER'];
    gaps TEXT;
BEGIN
    IF current_setting('server_version_num')::int >= 170000 THEN
        privileges := array_append(privileges, 'MAINTAIN');
    END IF;

    SELECT string_agg(r, ', ' ORDER BY r) INTO gaps
      FROM unnest(ARRAY['anon', 'authenticated']) r
     WHERE has_table_privilege(r, 'public.listening_tests', 'SELECT');
    IF gaps IS NOT NULL THEN
        RAISE EXCEPTION 'listening_tests_client_select_remains: %', gaps;
    END IF;

    SELECT string_agg(format('%s:%s', r, p), ', ' ORDER BY r, p) INTO gaps
      FROM unnest(ARRAY['public', 'anon', 'authenticated']) r
     CROSS JOIN unnest(privileges) p
     WHERE has_table_privilege(r, 'public.listening_tests', p)
        OR (p IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
            AND has_any_column_privilege(r, 'public.listening_tests', p));
    IF gaps IS NOT NULL THEN
        RAISE EXCEPTION 'listening_tests_client_privilege_remains: %', gaps;
    END IF;

    SELECT string_agg(p, ', ' ORDER BY p) INTO gaps
      FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
     WHERE NOT has_table_privilege('service_role', 'public.listening_tests', p);
    IF gaps IS NOT NULL THEN
        RAISE EXCEPTION 'listening_tests_service_role_privilege_missing: %', gaps;
    END IF;
END $$;

COMMIT;
