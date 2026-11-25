-- Rollback of 502_response_pronunciation_sample.sql (G04-T13).
-- Turn the runtime flag `pron_sample_window` off first: with the flag on the
-- grading route writes these columns, and after the drop its full-row write
-- fails over to the core-row fallback (the recording is kept, the
-- pronunciation detail of that answer is not).
-- Drops the three sample columns and their CHECK. The dropped values are only
-- the record of which seconds Azure heard; the scores stay in the 004 columns.
-- Needs the same typed approval as the forward apply. Remove the ledger row
-- only under a separately reviewed decision.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

ALTER TABLE public.responses
    DROP CONSTRAINT IF EXISTS responses_pronunciation_sample_check,
    DROP COLUMN IF EXISTS pronunciation_sample_start_s,
    DROP COLUMN IF EXISTS pronunciation_sample_end_s,
    DROP COLUMN IF EXISTS pronunciation_sample_scope;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'responses'
                  AND column_name LIKE 'pronunciation_sample_%') THEN
        RAISE EXCEPTION 'rollback_502_postcondition: sample columns still present';
    END IF;
END;
$$;

COMMIT;
