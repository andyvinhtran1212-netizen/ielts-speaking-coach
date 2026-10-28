-- What a NEW Supabase project already contains before any app migration:
-- extensions, auth/storage schemas and tables, platform triggers, the realtime
-- publication. The self-test loads it into a fresh database to rehearse
-- restore_into_project.sh. Run as superuser; roles must already exist.
\set ON_ERROR_STOP 1
CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;

CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  email text UNIQUE,
  raw_user_meta_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE auth.users OWNER TO supabase_auth_admin;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres;

CREATE SCHEMA storage AUTHORIZATION supabase_storage_admin;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text NOT NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (bucket_id, name)
);
ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.update_updated_at() RETURNS trigger LANGUAGE plpgsql
  AS $$ BEGIN NEW.created_at := coalesce(NEW.created_at, now()); RETURN NEW; END $$;
ALTER FUNCTION storage.update_updated_at() OWNER TO supabase_storage_admin;
CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at();
GRANT USAGE ON SCHEMA storage TO postgres, anon, authenticated, service_role;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE
  AS $$ SELECT string_to_array(name, '/') $$;
ALTER FUNCTION storage.foldername(text) OWNER TO supabase_storage_admin;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO postgres;

GRANT ALL ON SCHEMA public TO postgres;
-- Stand-in for supautils, which lets Supabase's postgres role add triggers and
-- policies on platform-owned auth/storage tables (the app's migrations do).
GRANT supabase_auth_admin, supabase_storage_admin TO postgres;
-- Platform-owned DDL hooks, as Supabase installs (owned by the superuser).
CREATE FUNCTION extensions.selftest_ddl_watch() RETURNS event_trigger LANGUAGE plpgsql
  AS $$ BEGIN PERFORM 1; END $$;
CREATE EVENT TRIGGER selftest_ddl_watch ON ddl_command_end EXECUTE FUNCTION extensions.selftest_ddl_watch();
CREATE PUBLICATION supabase_realtime;
ALTER PUBLICATION supabase_realtime OWNER TO postgres;  -- as on staging
-- Like supabase_vault: an extension in its own schema whose member objects
-- carry platform grants, so pg_dump writes GRANTs for objects that only
-- CREATE EXTENSION creates. The drill skips it via DRILL_SKIP_EXTENSIONS.
CREATE SCHEMA trgm;
CREATE EXTENSION pg_trgm WITH SCHEMA trgm;
GRANT USAGE ON SCHEMA trgm TO postgres, service_role;
GRANT EXECUTE ON FUNCTION trgm.similarity(text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION trgm.show_trgm(text) FROM PUBLIC;

