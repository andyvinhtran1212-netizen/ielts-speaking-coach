-- Rollback of 509_course_give_request_unique.sql.
-- Drops only the partial unique index. Sequential retries of a course give
-- still replay through the route's read; two simultaneous identical requests
-- could again both insert. No data is changed. Needs the same typed approval as
-- the forward apply. Remove the ledger row only under a separately reviewed
-- decision.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DROP INDEX IF EXISTS public.uq_course_give_request;

DO $$
BEGIN
    IF to_regclass('public.uq_course_give_request') IS NOT NULL THEN
        RAISE EXCEPTION 'rollback_509_postcondition: uq_course_give_request still present';
    END IF;
END;
$$;

COMMIT;
