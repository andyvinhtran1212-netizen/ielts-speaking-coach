-- Rollback of 401: drops the Writing sample sign-off columns and their CHECKs.
-- Refuses while any row stores a sign-off (reviewed_by or reviewed_at) or is
-- published: the sign-off is not rebuilt by the rollback, and without it the
-- publish gate lives only in the import script again. Unpublish and re-run the
-- import after a re-apply instead.
BEGIN;
SET LOCAL lock_timeout = '5s';

LOCK TABLE public.writing_samples IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.writing_samples
               WHERE published OR reviewed_by IS NOT NULL OR reviewed_at IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'writing_samples has signed or published rows; keep 401 and roll back the application';
    END IF;
END;
$$;

ALTER TABLE public.writing_samples
    DROP CONSTRAINT IF EXISTS writing_samples_published_approved,
    DROP CONSTRAINT IF EXISTS writing_samples_review_signed,
    DROP CONSTRAINT IF EXISTS writing_samples_review_status_valid,
    DROP COLUMN IF EXISTS reviewed_at,
    DROP COLUMN IF EXISTS reviewed_by,
    DROP COLUMN IF EXISTS review_status;

NOTIFY pgrst, 'reload schema';

COMMIT;
