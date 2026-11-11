-- Manual rollback, never a forward-runner input. Preserve any audit history.
BEGIN;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.blackeye_course2_grants)
       OR EXISTS (SELECT 1 FROM public.blackeye_course2_grant_log) THEN
        RAISE EXCEPTION 'blackeye_grant_history_exists';
    END IF;
END $$;
DROP TRIGGER IF EXISTS blackeye_grants_audit ON public.blackeye_course2_grants;
DROP TRIGGER IF EXISTS blackeye_grants_immutable ON public.blackeye_course2_grants;
DROP TRIGGER IF EXISTS blackeye_grant_log_immutable ON public.blackeye_course2_grant_log;
DROP FUNCTION IF EXISTS public.fn_blackeye_audit_grant();
DROP FUNCTION IF EXISTS public.fn_blackeye_grant_append_only();
DROP TABLE public.blackeye_course2_grant_log;
DROP TABLE public.blackeye_course2_grants;
COMMIT;
