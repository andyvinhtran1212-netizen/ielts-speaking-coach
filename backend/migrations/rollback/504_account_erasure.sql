-- Rollback of 504 (ACCOUNTDATA-0100): removes the erasure pass from every
-- guard and drops the erasure functions. Refuses while a deletion request is
-- 'erasing' (a run in progress would lose its database step).
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    p record;
    def text;
    -- Verbatim copies of the passes 504 injects.
    delete_pass CONSTANT text := ' /* ACCOUNTDATA-0100 erasure pass */ IF TG_OP = ''DELETE'' AND '
        'coalesce(current_setting(''aver.account_erasure_user'', true), '''') <> '''' THEN '
        'IF public.fn_account_erasure_row_allowed(to_jsonb(OLD)) THEN RETURN OLD; END IF; END IF;';
    scrub_pass CONSTANT text := ' /* ACCOUNTDATA-0100 erasure pass */ IF TG_OP = ''UPDATE'' AND '
        'coalesce(current_setting(''aver.account_erasure_user'', true), '''') <> '''' THEN '
        'IF public.fn_account_erasure_scrub_allowed(TG_TABLE_NAME, to_jsonb(OLD), to_jsonb(NEW)) THEN RETURN NEW; END IF; END IF;';
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
        def := replace(replace(def, delete_pass, ''), scrub_pass, '');
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
DROP FUNCTION IF EXISTS public.fn_account_erasure_key_ok(text, text, text);
DROP TRIGGER IF EXISTS trg_account_deletion_requests_xact_guard ON public.account_deletion_requests;
DROP FUNCTION IF EXISTS public.fn_account_deletion_requests_xact_guard();
ALTER TABLE IF EXISTS public.account_deletion_requests DROP COLUMN IF EXISTS erasing_xact;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                AND (prosrc LIKE '%ACCOUNTDATA-0100 erasure pass%' OR proname LIKE 'fn_account_eras%'
                     OR proname = 'fn_account_deletion_requests_xact_guard')) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '504 rollback postcondition failed';
    END IF;
END;
$$;

COMMIT;
