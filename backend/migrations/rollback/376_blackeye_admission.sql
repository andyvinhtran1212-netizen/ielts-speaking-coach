-- Manual rollback only; separate authorization required. Never delete attempts,
-- snapshots or published content. Keep widened CHECKs so retained rows stay valid.
BEGIN;
DROP TRIGGER IF EXISTS trg_zz_blackeye_admission ON public.listening_test_attempts;
DROP FUNCTION IF EXISTS public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT);
DROP FUNCTION IF EXISTS public.fn_guard_blackeye_admission();
COMMIT;
