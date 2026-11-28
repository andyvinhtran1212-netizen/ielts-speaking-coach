-- Rollback of 503_credit_attempt_settle.sql (COURSEACCESS-0055 T007, G04-T07).
-- Run only after the preceding backend (without per-attempt settlement) is
-- deployed: the G04-T07 backend settles Speaking holds only through
-- fn_credit_settle_attempt, and without it every hold would stay open until
-- the expiry sweep refunds it, saved grades included.
-- Keeps credit_attempt_outcomes and its rows (append-only accounting evidence)
-- and the credit_covered_requests index; drops only the RPC.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DROP FUNCTION IF EXISTS public.fn_credit_settle_attempt(uuid, text, text, text);

DO $postcondition$
BEGIN
    IF to_regprocedure('public.fn_credit_settle_attempt(uuid,text,text,text)') IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '503 rollback postcondition: RPC still present';
    END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
