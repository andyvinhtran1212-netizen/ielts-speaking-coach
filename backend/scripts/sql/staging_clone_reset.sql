-- Invoked only after preflight, in the SAME psql -1 session as the restore.
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
COMMENT ON SCHEMA public IS 'standard public schema';
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
-- Existing bootstrap policy: service_role retains CREATE on this schema.
GRANT ALL ON SCHEMA public TO postgres, service_role;
