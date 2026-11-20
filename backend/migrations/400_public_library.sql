-- LIBRARY-0061 T002 (G06-T02). Public Library schema and private media bucket.
-- Number 400 is from the G06 band 400-419 of the commercialization register.
-- No apply on merge: pending_feature public_library. Staging first under the
-- advisory lock with MIGRATION_FEATURES=public_library after review and Andy's
-- typed approval; production only at an authorised staging-to-main promotion.
--
-- Five tables, all RLS-enabled with no client policies and no client grants:
-- every read and write goes through the FastAPI backend as service_role.
-- library-media is private (public = false). Media is served by the backend
-- after it checks `published` (FR-064), never by a Storage URL. A RESTRICTIVE
-- storage.objects policy keeps every client role out of this bucket even if a
-- broad permissive policy exists; no permissive policy may name it.
-- Re-runnable: IF NOT EXISTS / ON CONFLICT, postconditions at the end.
-- Rollback: rollback/400_public_library.sql (schema only while Library data tables are empty).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.library_topics (
    slug          text PRIMARY KEY CONSTRAINT library_topics_slug_shape
                  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    label_vi      text NOT NULL,
    shelves       text[] NOT NULL CONSTRAINT library_topics_shelves_valid
                  CHECK (cardinality(shelves) > 0 AND shelves <@ ARRAY['writing', 'speaking']::text[]),
    display_order integer NOT NULL
);

CREATE TABLE IF NOT EXISTS public.writing_samples (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key           text NOT NULL UNIQUE,
    slug                 text NOT NULL UNIQUE CONSTRAINT writing_samples_slug_shape
                         CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
    title_en             text NOT NULL CONSTRAINT writing_samples_title_length
                         CHECK (char_length(title_en) BETWEEN 3 AND 70),
    task_type            text NOT NULL CONSTRAINT writing_samples_task_type
                         CHECK (task_type IN ('task1_academic', 'task2')),
    question_type        text CONSTRAINT writing_samples_question_type
                         CHECK (question_type IN ('opinion', 'discussion', 'problem_solution',
                                                  'advantages_disadvantages', 'two_part', 'positive_negative')),
    task1_subtype        text CONSTRAINT writing_samples_task1_subtype
                         CHECK (task1_subtype IN ('bar', 'line', 'pie', 'table', 'process', 'map', 'mixed')),
    topic_slug           text NOT NULL REFERENCES public.library_topics(slug),
    prompt_text          text NOT NULL,
    prompt_image_path    text,
    essays               jsonb NOT NULL,
    delta_75_70          jsonb NOT NULL CONSTRAINT writing_samples_delta_75_70_array
                         CHECK (jsonb_typeof(delta_75_70) = 'array'),
    delta_70_60          jsonb NOT NULL CONSTRAINT writing_samples_delta_70_60_array
                         CHECK (jsonb_typeof(delta_70_60) = 'array'),
    justification        jsonb NOT NULL,
    task1_data           jsonb,
    content_hash         text NOT NULL,
    source_review_status text,
    published            boolean NOT NULL DEFAULT false,
    published_at         timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT writing_samples_task_shape CHECK (
        (task_type = 'task2' AND question_type IS NOT NULL AND task1_subtype IS NULL)
        OR (task_type = 'task1_academic' AND question_type IS NULL AND task1_subtype IS NOT NULL)
    ),
    CONSTRAINT writing_samples_task1_published_image CHECK (
        NOT published OR task_type <> 'task1_academic' OR prompt_image_path IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS ix_writing_samples_listing
    ON public.writing_samples (published, task_type, question_type, topic_slug);

CREATE TABLE IF NOT EXISTS public.writing_sample_slug_history (
    old_slug   text PRIMARY KEY,
    sample_id  uuid NOT NULL REFERENCES public.writing_samples(id) ON DELETE CASCADE,
    changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_writing_sample_slug_history_sample
    ON public.writing_sample_slug_history (sample_id);

CREATE TABLE IF NOT EXISTS public.speaking_samples (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id     text NOT NULL UNIQUE,
    slug          text NOT NULL UNIQUE CONSTRAINT speaking_samples_slug_shape
                  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
    topic_id      uuid REFERENCES public.topics(id) ON DELETE SET NULL,
    part          smallint NOT NULL CONSTRAINT speaking_samples_part CHECK (part IN (1, 2, 3)),
    title_en      text NOT NULL,
    title_vi      text,
    topic_slug    text REFERENCES public.library_topics(slug),
    cue_card      jsonb,
    video_source  text CONSTRAINT speaking_samples_video_source
                  CHECK (video_source IN ('youtube', 'self_hosted')),
    youtube_id    text CONSTRAINT speaking_samples_youtube_id_shape
                  CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
    video_url     text CONSTRAINT speaking_samples_video_url_https
                  CHECK (video_url ~ '^https://'),
    duration_s    integer CONSTRAINT speaking_samples_duration_positive CHECK (duration_s > 0),
    transcript    jsonb NOT NULL,
    sample_text   text NOT NULL CONSTRAINT speaking_samples_sample_text_present
                  CHECK (length(btrim(sample_text)) > 0),
    audio_path    text,
    voice         text NOT NULL DEFAULT 'synthetic' CONSTRAINT speaking_samples_voice
                  CHECK (voice IN ('synthetic')),
    outline       jsonb NOT NULL DEFAULT '[]'::jsonb,
    vocabulary    jsonb NOT NULL DEFAULT '[]'::jsonb,
    related_part3 jsonb NOT NULL DEFAULT '[]'::jsonb,
    source_note   text,
    content_hash  text NOT NULL,
    published     boolean NOT NULL DEFAULT false,
    published_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT speaking_samples_youtube_needs_id CHECK (
        video_source IS DISTINCT FROM 'youtube' OR youtube_id IS NOT NULL
    ),
    CONSTRAINT speaking_samples_self_hosted_needs_url CHECK (
        video_source IS DISTINCT FROM 'self_hosted' OR video_url IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS ix_speaking_samples_listing
    ON public.speaking_samples (published, part, topic_slug);

CREATE TABLE IF NOT EXISTS public.library_marks (
    user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    shelf      text NOT NULL CONSTRAINT library_marks_shelf
               CHECK (shelf IN ('writing_sample', 'speaking_sample', 'writing_guide', 'grammar_article')),
    item_key   text NOT NULL,
    kind       text NOT NULL CONSTRAINT library_marks_kind CHECK (kind IN ('read', 'saved')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, shelf, item_key, kind)
);

ALTER TABLE public.library_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.writing_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.writing_sample_slug_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.speaking_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_marks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.library_topics, public.writing_samples, public.writing_sample_slug_history,
              public.speaking_samples, public.library_marks
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.library_topics, public.writing_samples, public.writing_sample_slug_history,
       public.speaking_samples, public.library_marks
    TO service_role;

-- Private media bucket. 10 MiB is the largest per-type cap (mp3/m4a); the
-- 2 MiB image cap is enforced in services/storage_limits.py before upload.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('library-media', 'library-media', false, 10485760,
        ARRAY['image/png', 'image/webp', 'audio/mpeg', 'audio/mp4'])
ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Fail-closed guard (FR-064): a RESTRICTIVE policy is ANDed with every
-- permissive policy, so even a broad client policy on storage.objects (for
-- example USING (true)) cannot reach library-media rows. Other buckets are
-- untouched; service_role bypasses RLS and keeps backend access.
DROP POLICY IF EXISTS library_media_backend_only ON storage.objects;
CREATE POLICY library_media_backend_only ON storage.objects
    AS RESTRICTIVE FOR ALL TO PUBLIC
    USING (bucket_id IS DISTINCT FROM 'library-media')
    WITH CHECK (bucket_id IS DISTINCT FROM 'library-media');

DO $$
DECLARE
    tbl regclass;
    privilege text;
    role_name text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'public.library_topics'::regclass, 'public.writing_samples'::regclass,
        'public.writing_sample_slug_history'::regclass, 'public.speaking_samples'::regclass,
        'public.library_marks'::regclass
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = tbl AND relrowsecurity)
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = tbl)
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
                       WHERE c.oid = tbl AND a.grantee <> c.relowner
                         AND (a.grantee <> 'service_role'::regrole OR a.is_grantable)) THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = format('400 library table RLS, policy or grant postcondition failed: %s', tbl);
        END IF;
        FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
            IF has_table_privilege('service_role', tbl, privilege)
               IS DISTINCT FROM (privilege IN ('SELECT','INSERT','UPDATE','DELETE')) THEN
                RAISE EXCEPTION USING ERRCODE = '55000',
                    MESSAGE = format('400 service role access is incorrect: %s %s', tbl, privilege);
            END IF;
            FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
                IF has_table_privilege(role_name, tbl, privilege) THEN
                    RAISE EXCEPTION USING ERRCODE = '55000',
                        MESSAGE = format('400 browser role has library table access: %s %s %s', role_name, tbl, privilege);
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM storage.buckets
         WHERE id = 'library-media' AND public = false
           AND file_size_limit = 10485760
           AND allowed_mime_types = ARRAY['image/png', 'image/webp', 'audio/mpeg', 'audio/mp4']
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '400 library-media bucket postcondition failed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
                    WHERE oid = 'storage.objects'::regclass AND relrowsecurity)
       OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policy p
         WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'library_media_backend_only'
           AND NOT p.polpermissive AND p.polcmd = '*' AND p.polroles = ARRAY[0::oid]
           AND pg_get_expr(p.polqual, p.polrelid) LIKE '%IS DISTINCT FROM%library-media%'
           AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%IS DISTINCT FROM%library-media%'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '400 library-media restrictive storage guard missing';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects' AND permissive = 'PERMISSIVE'
           AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%library-media%'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '400 a permissive storage.objects policy names library-media';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
