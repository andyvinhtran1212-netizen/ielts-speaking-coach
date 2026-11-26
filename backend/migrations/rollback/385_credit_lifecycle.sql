-- Rollback of 385_credit_lifecycle.sql (COURSEACCESS-0055 T011, spec label 383).
-- Run only after the preceding backend is deployed (the sweep and the confirm
-- path then log "[credits] lifecycle skipped=no_function"), and before
-- rollback/384 (rollout.md order).
-- Drops the two RPCs only. Every ledger row they wrote (expire, carry_over,
-- carry_expire, grant_extra) and every lifecycle stamp on entitlements stays:
-- the ledger is append-only accounting evidence, and the balances 384 reports
-- already read them. No opt-in is needed because nothing is deleted.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DROP FUNCTION IF EXISTS public.fn_credit_grant_extra(uuid, text, uuid, integer, text, text);
DROP FUNCTION IF EXISTS public.fn_credit_expire_entitlements(uuid, integer, integer, integer);

DO $postcondition$
BEGIN
    IF to_regprocedure('public.fn_credit_expire_entitlements(uuid,integer,integer,integer)') IS NOT NULL
       OR to_regprocedure('public.fn_credit_grant_extra(uuid,text,uuid,integer,text,text)') IS NOT NULL
       OR to_regclass('public.credit_ledger') IS NULL
       OR to_regprocedure('public.fn_credit_usable_balance(uuid)') IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '385 rollback postcondition failed';
    END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
