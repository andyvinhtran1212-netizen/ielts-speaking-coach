-- Roll back 400 only before learners have marks and before any media is stored.
-- Delete library-media objects through the Storage API first (a direct DELETE
-- on storage.objects leaves the files behind); this script refuses while any
-- object or any library_marks row remains. Content rows are re-importable
-- from backend/content/library, so they do not block the rollback.
BEGIN;
SET LOCAL lock_timeout = '5s';

LOCK TABLE public.library_marks, public.writing_sample_slug_history, public.writing_samples,
           public.speaking_samples, public.library_topics IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
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
DELETE FROM storage.buckets WHERE id = 'library-media';

DO $$
BEGIN
    IF to_regclass('public.library_topics') IS NOT NULL
       OR to_regclass('public.writing_samples') IS NOT NULL
       OR to_regclass('public.writing_sample_slug_history') IS NOT NULL
       OR to_regclass('public.speaking_samples') IS NOT NULL
       OR to_regclass('public.library_marks') IS NOT NULL
       OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'library-media') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '400 rollback postcondition failed';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
