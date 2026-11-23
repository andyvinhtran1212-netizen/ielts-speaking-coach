-- Rollback of 505_retention_purge_content.sql (COURSEACCESS-0055 FR-048, G04-T10b).
-- Run only after the preceding backend is deployed (with retention_by_entitlement
-- on, the sweep then keeps every course-window learner's content and logs
-- "[sweep] content skipped=no_function").
-- Drops the RPC only. Content it already purged stays purged (the scrub is
-- the point of the function); no table, column or row was added. No opt-in is
-- needed because nothing is deleted.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DROP FUNCTION IF EXISTS public.fn_retention_purge_content(uuid, integer);

DO $postcondition$
BEGIN
    IF to_regprocedure('public.fn_retention_purge_content(uuid,integer)') IS NOT NULL
       OR to_regclass('public.sessions') IS NULL
       OR to_regclass('public.responses') IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '505 rollback postcondition failed';
    END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
