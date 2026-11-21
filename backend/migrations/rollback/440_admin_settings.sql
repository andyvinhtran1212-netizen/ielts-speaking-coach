-- Roll back 440 only while no admin has changed a setting: once the log has a
-- row, the settings and their history are evidence; keep the schema and roll
-- forward instead. Needs the same typed approval as the forward apply.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

LOCK TABLE public.admin_settings, public.admin_settings_log IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.admin_settings_log)
       OR EXISTS (SELECT 1 FROM public.admin_settings WHERE key <> 'ops_thresholds') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE =
            'admin settings were changed; keep schema 440 and roll forward';
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.fn_admin_settings_merge(text, jsonb, text, uuid);
DROP TABLE public.admin_settings_log;
DROP TABLE public.admin_settings;
DROP FUNCTION IF EXISTS public.fn_admin_settings_log_append_only();

COMMIT;
