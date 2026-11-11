-- Manual rollback only; separate authorization required. Never delete attempts,
-- snapshots or published content. Keep widened CHECKs so retained rows stay valid.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Block publication changes until the guard has been replaced atomically.
LOCK TABLE public.listening_content_packages, public.listening_lessons,
    public.listening_tests IN SHARE MODE;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.listening_content_packages
               WHERE programme_id='blackeye-v5-upper-listening' AND status='published')
       OR EXISTS (SELECT 1 FROM public.listening_lessons
                  WHERE programme_id='blackeye-v5-upper-listening' AND status='published')
       OR EXISTS (SELECT 1 FROM public.listening_tests
                  WHERE (programme_id='blackeye-v5-upper-listening' OR metadata ? 'blackeye')
                    AND (status='published' OR is_public IS TRUE)) THEN
        RAISE EXCEPTION 'blackeye_rollback_published_content' USING ERRCODE='55000';
    END IF;
END $$;
DROP FUNCTION IF EXISTS public.fn_submit_blackeye_attempt(UUID,UUID,JSONB,JSONB);
DROP FUNCTION IF EXISTS public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT);

-- Keep the existing trigger as a deny-all backstop even if Black Eye content
-- is published again later. Ordinary Listening INSERTs still pass through.
CREATE OR REPLACE FUNCTION public.fn_guard_blackeye_admission()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_programme TEXT; v_metadata JSONB;
BEGIN
    SELECT t.programme_id,t.metadata INTO v_programme,v_metadata
      FROM public.listening_tests t WHERE t.id=NEW.test_id;
    IF v_programme IS NOT DISTINCT FROM 'blackeye-v5-upper-listening'
       OR COALESCE(v_metadata ? 'blackeye',FALSE) THEN
        RAISE EXCEPTION 'blackeye_unavailable';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_guard_blackeye_admission() FROM PUBLIC,anon,authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid='public.listening_test_attempts'::pg_catalog.regclass
          AND t.tgname='trg_zz_blackeye_admission' AND t.tgenabled='O'
          AND NOT t.tgisinternal
          AND t.tgfoid=pg_catalog.to_regprocedure('public.fn_guard_blackeye_admission()')) THEN
        RAISE EXCEPTION 'rollback_376_guard_not_enabled' USING ERRCODE='55000';
    END IF;
    IF pg_catalog.to_regprocedure('public.fn_acquire_blackeye_attempt(uuid,uuid,jsonb,text)') IS NOT NULL
       OR pg_catalog.to_regprocedure('public.fn_submit_blackeye_attempt(uuid,uuid,jsonb,jsonb)') IS NOT NULL THEN
        RAISE EXCEPTION 'rollback_376_rpc_still_present' USING ERRCODE='55000';
    END IF;
END $$;
-- The migration-ledger row is retained; changing it needs a separate decision.
COMMIT;
