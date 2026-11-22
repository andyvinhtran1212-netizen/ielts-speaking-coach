-- Schema rollback of 400, only while it holds nothing worth keeping.
-- Refuses while writing_samples, speaking_samples, writing_sample_slug_history
-- or library_marks has any row, or library-media has any object: imported or
-- published content (Task 2 and YouTube-only Speaking have no media) and slug
-- history are not rebuilt from the manifests. With data present, keep the
-- schema and roll back the application instead. library_topics rows do not
-- block: they are re-imported from backend/content/library/topics.json.
-- Delete library-media objects through the Storage API first; a direct DELETE
-- on storage.objects leaves the files behind.
BEGIN;
SET LOCAL lock_timeout = '5s';

LOCK TABLE public.library_marks, public.writing_sample_slug_history, public.writing_samples,
           public.speaking_samples, public.library_topics IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.writing_samples)
       OR EXISTS (SELECT 1 FROM public.speaking_samples)
       OR EXISTS (SELECT 1 FROM public.writing_sample_slug_history) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Library content or slug history exists; keep schema and roll back the application';
    END IF;
    IF EXISTS (SELECT 1 FROM public.library_marks) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'library_marks has learner rows; keep schema and turn content off';
    END IF;
    IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'library-media') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'library-media still has objects; delete them through Storage first';
    END IF;
END;
$$;

DROP TABLE public.library_marks;
DROP TABLE public.writing_sample_slug_history;
DROP TABLE public.writing_samples;
DROP TABLE public.speaking_samples;
DROP TABLE public.library_topics;
DROP POLICY IF EXISTS library_media_backend_only ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'library-media';

DO $$
BEGIN
    IF to_regclass('public.library_topics') IS NOT NULL
       OR to_regclass('public.writing_samples') IS NOT NULL
       OR to_regclass('public.writing_sample_slug_history') IS NOT NULL
       OR to_regclass('public.speaking_samples') IS NOT NULL
       OR to_regclass('public.library_marks') IS NOT NULL
       OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'library-media')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'storage.objects'::regclass
                   AND polname = 'library_media_backend_only') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '400 rollback postcondition failed';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
