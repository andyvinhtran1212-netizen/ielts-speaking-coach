-- App schema and data, as the repo's migrations would create them (run as
-- superuser after seed_platform.sql; DDL runs as the `postgres` role).
\set ON_ERROR_STOP 1
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
-- App objects on platform tables (migration 309 adds a trigger on auth.users).
CREATE FUNCTION public.erasure_gate() RETURNS trigger LANGUAGE plpgsql
  AS $$ BEGIN RETURN NULL; END $$;
CREATE TRIGGER app_erasure_gate BEFORE DELETE ON auth.users
  FOR EACH STATEMENT EXECUTE FUNCTION public.erasure_gate();
CREATE POLICY "Own audio objects" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'audio-responses' AND (storage.foldername(name))[1] = auth.uid()::text);
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
