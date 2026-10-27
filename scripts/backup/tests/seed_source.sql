-- Supabase-shaped source database for the offsite-backup self-test.
-- Run as the cluster superuser (named supabase_admin, as on Supabase); the
-- backup then dumps as the NON-superuser `postgres` role, like production.
\set ON_ERROR_STOP 1

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
GRANT USAGE ON SCHEMA storage TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO postgres;

GRANT ALL ON SCHEMA public TO postgres;
-- Platform-owned DDL hooks, as Supabase installs (owned by the superuser).
CREATE FUNCTION extensions.selftest_ddl_watch() RETURNS event_trigger LANGUAGE plpgsql
  AS $$ BEGIN PERFORM 1; END $$;
CREATE EVENT TRIGGER selftest_ddl_watch ON ddl_command_end EXECUTE FUNCTION extensions.selftest_ddl_watch();
CREATE PUBLICATION supabase_realtime;
-- Like supabase_vault: an extension in its own schema whose member objects
-- carry platform grants, so pg_dump writes GRANTs for objects that only
-- CREATE EXTENSION creates. The drill skips it via DRILL_SKIP_EXTENSIONS.
CREATE SCHEMA trgm;
CREATE EXTENSION pg_trgm WITH SCHEMA trgm;
GRANT USAGE ON SCHEMA trgm TO postgres, service_role;
GRANT EXECUTE ON FUNCTION trgm.similarity(text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION trgm.show_trgm(text) FROM PUBLIC;

SET ROLE postgres;
CREATE TABLE public._schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  role text NOT NULL DEFAULT 'student'
);
CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  band numeric(3,1),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.responses (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.sessions(id),
  transcript text,
  audio_path text
);
CREATE TABLE public.events (id bigint, at date NOT NULL, kind text) PARTITION BY RANGE (at);
CREATE TABLE public.events_2026_09 PARTITION OF public.events FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE public.events_2026_10 PARTITION OF public.events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE public.empty_table (id int PRIMARY KEY);
CREATE VIEW public.session_bands AS SELECT user_id, avg(band) AS band FROM public.sessions GROUP BY user_id;
CREATE MATERIALIZED VIEW public.band_counts AS SELECT band, count(*) AS n FROM public.sessions GROUP BY band;
CREATE FUNCTION public.touch_notes() RETURNS trigger LANGUAGE plpgsql
  AS $$ BEGIN NEW.notes := coalesce(NEW.notes, ''); RETURN NEW; END $$;
CREATE TRIGGER sessions_touch BEFORE INSERT ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.touch_notes();
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_sessions ON public.sessions FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.sessions TO authenticated;
GRANT SELECT ON public.session_bands TO read_only;
RESET ROLE;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;

INSERT INTO auth.users (email, raw_user_meta_data)
SELECT 'user' || g || '@example.test', jsonb_build_object('name', 'Người dùng ' || g)
FROM generate_series(1, 50) g;
INSERT INTO public.users (id, display_name) SELECT id, raw_user_meta_data->>'name' FROM auth.users;
INSERT INTO public.sessions (user_id, band, notes)
SELECT u.id, (4 + (g % 10) * 0.5)::numeric(3,1),
       CASE g % 4 WHEN 0 THEN E'line one\nline two' WHEN 1 THEN E'tab\there' WHEN 2 THEN E'back\\slash' ELSE NULL END
FROM generate_series(1, 200) g JOIN LATERAL (SELECT id FROM public.users ORDER BY id OFFSET g % 50 LIMIT 1) u ON true;
INSERT INTO public.responses (session_id, transcript, audio_path)
SELECT s.id, E'I think\r\nthat "quotes" and \\. are fine', 'audio-responses/' || s.user_id || '/' || g || '.webm'
FROM public.sessions s, generate_series(1, 3) g;
INSERT INTO public.events SELECT g, DATE '2026-09-15' + (g % 30), 'k' || g FROM generate_series(1, 120) g;
INSERT INTO public._schema_migrations (filename) VALUES ('001_init.sql'), ('326_latest.sql');
REFRESH MATERIALIZED VIEW public.band_counts;
