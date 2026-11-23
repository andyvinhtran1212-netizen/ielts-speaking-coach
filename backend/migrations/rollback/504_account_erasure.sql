-- Rollback of 504 (ACCOUNTDATA-0100): removes the erasure pass from every
-- guard and drops the erasure functions. Refuses while a deletion request is
-- 'erasing' (a run in progress would lose its database step).
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    p record;
    def text;
BEGIN
    IF to_regclass('public.account_deletion_requests') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.account_deletion_requests WHERE status = 'erasing') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'an erasure is running; release it before rolling back 504';
    END IF;
    FOR p IN
        SELECT oid, proname FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace AND pronargs = 0
           AND prosrc LIKE '%ACCOUNTDATA-0100 erasure pass%'
    LOOP
        def := pg_get_functiondef(p.oid);
        def := regexp_replace(def, ' /\* ACCOUNTDATA-0100 erasure pass \*/ IF TG_OP = ''(DELETE|UPDATE)'' AND '
                                   'public\.fn_account_erasure_(row|scrub)_allowed\([^;]*\) THEN RETURN (OLD|NEW); END IF;', '', 'g');
        IF position('ACCOUNTDATA-0100 erasure pass' IN def) > 0 THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = format('504 rollback could not remove the pass from %s', p.proname);
        END IF;
        EXECUTE def;
    END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.fn_account_erase_learner(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.fn_account_erasure_scrub_allowed(text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.fn_account_erasure_row_allowed(jsonb);
DROP FUNCTION IF EXISTS public.fn_account_erasure_user();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                AND (prosrc LIKE '%ACCOUNTDATA-0100 erasure pass%' OR proname LIKE 'fn_account_eras%')) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '504 rollback postcondition failed';
    END IF;
END;
$$;

COMMIT;
