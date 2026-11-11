-- Manual rollback only; separate authorization required. Never delete attempts,
-- snapshots or published content. Keep widened CHECKs so retained rows stay valid.
BEGIN;
-- Block publication changes until the guard has been removed atomically.
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
DROP TRIGGER IF EXISTS trg_zz_blackeye_admission ON public.listening_test_attempts;
DROP FUNCTION IF EXISTS public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT);
DROP FUNCTION IF EXISTS public.fn_guard_blackeye_admission();
COMMIT;
