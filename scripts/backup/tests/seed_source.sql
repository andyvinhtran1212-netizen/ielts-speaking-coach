-- Supabase-shaped source database for the offsite-backup self-test.
-- Run as the cluster superuser (named supabase_admin, as on Supabase); the
-- backup then dumps as the NON-superuser `postgres` role, like production.
\set ON_ERROR_STOP 1
\ir seed_roles.sql
\ir seed_platform.sql
\ir seed_app.sql
