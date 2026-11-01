-- Invoked only after preflight, in the SAME psql -1 session as the restore.
-- Record the restore role before the dump runs; a psql variable cannot be
-- changed by the dump, whose meta-commands preflight refuses.
SELECT current_user AS clone_restore_role \gset
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
COMMENT ON SCHEMA public IS 'standard public schema';
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
-- service_role gets USAGE only; it must not hold CREATE on public (SVCPRIV-0042 FR-007).
GRANT ALL ON SCHEMA public TO postgres;
