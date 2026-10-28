-- Cluster roles of a Supabase project (see seed_source.sql).
CREATE ROLE postgres LOGIN NOSUPERUSER CREATEROLE CREATEDB BYPASSRLS PASSWORD 'selftest';
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
-- Supabase sets libraries that do not exist in a plain Postgres image.
ALTER ROLE authenticator SET session_preload_libraries TO 'safeupdate';
ALTER ROLE authenticator SET statement_timeout TO '8s';
ALTER ROLE authenticator SET pgrst.db_schemas TO 'public, graphql_public';
CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE;
CREATE ROLE supabase_storage_admin LOGIN NOINHERIT CREATEROLE;
CREATE ROLE read_only NOLOGIN;
GRANT anon, authenticated, service_role TO postgres WITH ADMIN OPTION;

