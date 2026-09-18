-- Migration 285 — remove direct PostgREST execution on the database-only
-- single-attempt trigger functions.
--
-- Migration 284 revoked the default PUBLIC grant, but existing Supabase
-- environments may also retain explicit grants for anon/authenticated. These
-- functions are trigger-only and must never be callable over PostgREST.

BEGIN;

REVOKE ALL ON FUNCTION public.guard_single_attempt_course_session()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_single_attempt_course_answer()
    FROM PUBLIC, anon, authenticated;

COMMIT;
