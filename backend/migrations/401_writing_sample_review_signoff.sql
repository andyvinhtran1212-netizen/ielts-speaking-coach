-- LIBRARY-0061 T002b (G06-T02b, amendment 2). Store the reviewer sign-off of a
-- Writing sample set so the database itself can tell an approved set from one
-- that only carries the source's editing history (source_review_status).
-- Number 401 is from the G06 band 400-419 of the commercialization register.
-- No apply on merge: pending_feature public_library, same as 400. Staging first
-- under the advisory lock after review and Andy's typed approval; production
-- only at an authorised staging-to-main promotion.
--
-- writing_samples gains review_status / reviewed_by / reviewed_at, copied by
-- scripts/import_writing_samples.py from the manifest's review.{status,by,at}.
-- Two CHECKs make the publish gate (FR-019, E_NOT_APPROVED) hold in the DB:
--   * an 'approved' row always names who signed and when;
--   * a published row is always 'approved'.
-- Existing rows default to 'needs_review'. The migration refuses to run while
-- any row is published (those rows have no stored sign-off): unpublish them,
-- or re-import them signed, after this migration.
-- Re-runnable: ADD COLUMN IF NOT EXISTS, constraints added only when missing,
-- postconditions at the end.
-- Rollback: rollback/401_writing_sample_review_signoff.sql (refuses while any
-- sign-off is stored).

BEGIN;
SET LOCAL lock_timeout = '5s';

LOCK TABLE public.writing_samples IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.writing_samples
        WHERE published
          AND NOT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'writing_samples'
                AND column_name = 'review_status')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = '401 refused: published writing_samples have no stored sign-off; unpublish them first';
    END IF;
END;
$$;

ALTER TABLE public.writing_samples
    ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'needs_review',
    ADD COLUMN IF NOT EXISTS reviewed_by   text,
    ADD COLUMN IF NOT EXISTS reviewed_at   timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.writing_samples'::regclass
                     AND conname = 'writing_samples_review_status_valid') THEN
        ALTER TABLE public.writing_samples
            ADD CONSTRAINT writing_samples_review_status_valid
            CHECK (review_status IN ('approved', 'needs_review', 'excluded'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.writing_samples'::regclass
                     AND conname = 'writing_samples_review_signed') THEN
        ALTER TABLE public.writing_samples
            ADD CONSTRAINT writing_samples_review_signed
            CHECK (review_status <> 'approved'
                   OR (reviewed_by IS NOT NULL AND btrim(reviewed_by) <> '' AND reviewed_at IS NOT NULL));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.writing_samples'::regclass
                     AND conname = 'writing_samples_published_approved') THEN
        ALTER TABLE public.writing_samples
            ADD CONSTRAINT writing_samples_published_approved
            CHECK (NOT published OR review_status = 'approved');
    END IF;
END;
$$;

COMMENT ON COLUMN public.writing_samples.review_status IS
    'Manifest review.status: approved | needs_review | excluded. Only approved rows may be published.';
COMMENT ON COLUMN public.writing_samples.reviewed_by IS
    'Manifest review.by: who signed the approval. Required when review_status = approved.';
COMMENT ON COLUMN public.writing_samples.reviewed_at IS
    'Manifest review.at: when the approval was signed. Required when review_status = approved.';

-- No grant changes: writing_samples stays RLS-enabled with no client policy
-- and no client grant (400). New columns inherit that.

DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(c, ', ') INTO missing
    FROM unnest(ARRAY['review_status', 'reviewed_by', 'reviewed_at']) AS c
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'writing_samples'
                        AND column_name = c);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = format('401 column postcondition failed: %s', missing);
    END IF;
    SELECT string_agg(k, ', ') INTO missing
    FROM unnest(ARRAY['writing_samples_review_status_valid', 'writing_samples_review_signed',
                      'writing_samples_published_approved']) AS k
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conrelid = 'public.writing_samples'::regclass
                        AND conname = k AND convalidated);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = format('401 constraint postcondition failed: %s', missing);
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.writing_samples'::regclass) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '401 writing_samples lost RLS';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
