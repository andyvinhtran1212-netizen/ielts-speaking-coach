-- Invoked only after preflight, in the SAME psql -1 session as the restore.
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
COMMENT ON SCHEMA public IS 'standard public schema';
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
-- service_role gets USAGE only; it must not hold CREATE on public (SVCPRIV-0042 FR-007).
GRANT ALL ON SCHEMA public TO postgres;
