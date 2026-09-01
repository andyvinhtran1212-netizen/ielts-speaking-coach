-- Migration 223 — enforce backend-only access for course pronunciation tables
--
-- Migration 222 enabled RLS without client policies, which blocks row access
-- through PostgREST. Supabase default table privileges still include operations
-- such as TRUNCATE and REFERENCES that RLS does not govern, so revoke the table
-- grants explicitly and retain the backend service-role access path.

BEGIN;

REVOKE ALL ON TABLE public.course_pronunciation_sets
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.course_pronunciation_submissions
    FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.course_pronunciation_sets TO service_role;
GRANT ALL ON TABLE public.course_pronunciation_submissions TO service_role;

COMMIT;

-- VERIFY (read-only): expected f | f | t for each table.
-- SELECT has_table_privilege('anon', 'public.course_pronunciation_sets', 'SELECT'),
--        has_table_privilege('authenticated', 'public.course_pronunciation_sets', 'SELECT'),
--        has_table_privilege('service_role', 'public.course_pronunciation_sets', 'SELECT');
-- SELECT has_table_privilege('anon', 'public.course_pronunciation_submissions', 'SELECT'),
--        has_table_privilege('authenticated', 'public.course_pronunciation_submissions', 'SELECT'),
--        has_table_privilege('service_role', 'public.course_pronunciation_submissions', 'SELECT');
