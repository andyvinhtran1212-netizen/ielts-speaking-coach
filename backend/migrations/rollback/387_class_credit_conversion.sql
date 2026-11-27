-- Rollback of 387_class_credit_conversion.sql (COURSEACCESS-0055 T013, spec label 388).
-- Run only after the preceding backend is deployed (the convert-class routes
-- then answer 503 credits_unavailable).
-- Drops the RPC only. Every entitlement (source 'class_conversion'), event and
-- ledger row it wrote stays, and so does the append-only request log
-- credit_class_conversions (a re-run of 387 keeps it: CREATE TABLE IF NOT
-- EXISTS, so a resent request_key still replays): those learners keep their class entitlement and
-- credits, and charge_plan keeps metering their class work (plan 5.18: there is
-- no way back to legacy_class). No opt-in is needed because nothing is deleted.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DROP FUNCTION IF EXISTS public.fn_credit_convert_class(uuid, uuid, uuid, integer, uuid);

DO $postcondition$
BEGIN
    IF to_regprocedure('public.fn_credit_convert_class(uuid,uuid,uuid,integer,uuid)') IS NOT NULL
       OR to_regclass('public.entitlements') IS NULL
       OR to_regclass('public.credit_ledger') IS NULL
       OR to_regclass('public.credit_class_conversions') IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '387 rollback postcondition failed';
    END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
