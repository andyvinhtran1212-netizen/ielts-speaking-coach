-- Roll back 442 only while no care note was written: once the table has a
-- row (even a removed one), it is an admin's record about a learner; keep
-- the schema and roll forward instead. Needs the same typed approval as the
-- forward apply.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

LOCK TABLE public.learner_care_notes IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.learner_care_notes) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE =
            'care notes exist; keep schema 442 and roll forward';
    END IF;
END;
$$;

DROP TABLE public.learner_care_notes;

COMMIT;
