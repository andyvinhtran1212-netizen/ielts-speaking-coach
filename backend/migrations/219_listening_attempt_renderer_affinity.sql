-- Migration: 219_listening_attempt_renderer_affinity.sql
--
-- Pin every Listening test attempt to the stable player that first opens it.
-- Existing attempts and unversioned/N-1 inserts belong to Legacy. Current
-- affinity-aware clients explicitly insert NULL and atomically claim either
-- `legacy` or `next` before reading or mutating attempt state.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'listening_test_attempts'
           AND column_name = 'renderer_affinity'
    ) THEN
        ALTER TABLE public.listening_test_attempts
            ADD COLUMN renderer_affinity TEXT;

        -- Only rows that predate the protocol are Legacy. Keep this inside the
        -- first-add guard so a migration rerun never captures a fresh
        -- claim-v1 row that is legitimately NULL before first player boot.
        UPDATE public.listening_test_attempts
           SET renderer_affinity = 'legacy'
         WHERE renderer_affinity IS NULL;
    END IF;
END;
$$;

ALTER TABLE public.listening_test_attempts
    ALTER COLUMN renderer_affinity SET DEFAULT 'legacy';

DO $$
BEGIN
    ALTER TABLE public.listening_test_attempts
        ADD CONSTRAINT listening_test_attempts_renderer_affinity_valid
        CHECK (renderer_affinity IN ('legacy', 'next')) NOT VALID;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

ALTER TABLE public.listening_test_attempts
    VALIDATE CONSTRAINT listening_test_attempts_renderer_affinity_valid;

COMMENT ON COLUMN public.listening_test_attempts.renderer_affinity IS
    'Stable Listening renderer claimed on first player boot. Existing and unversioned/N-1 attempts default Legacy; NULL is reserved for claim-v1 attempts before first player boot.';

CREATE OR REPLACE FUNCTION public.fn_claim_listening_attempt_renderer_affinity(
    p_attempt_id uuid,
    p_user_id uuid,
    p_renderer_affinity text
)
RETURNS TABLE(attempt_id uuid, renderer_affinity text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_renderer_affinity NOT IN ('legacy', 'next') THEN
        RAISE EXCEPTION 'invalid_renderer_affinity'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    UPDATE public.listening_test_attempts AS target
       SET renderer_affinity = COALESCE(target.renderer_affinity, p_renderer_affinity)
     WHERE target.id = p_attempt_id
       AND target.user_id = p_user_id
    RETURNING target.id, target.renderer_affinity;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_claim_listening_attempt_renderer_affinity(
    uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_listening_attempt_renderer_affinity(
    uuid, uuid, text
) TO service_role;

COMMENT ON FUNCTION public.fn_claim_listening_attempt_renderer_affinity(
    uuid, uuid, text
) IS
    'Atomically claim an owned Listening attempt renderer, or return its immutable existing claim; service-role backend only.';

NOTIFY pgrst, 'reload schema';

COMMIT;
