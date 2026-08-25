-- Migration: 215_speaking_session_renderer_affinity.sql
-- Mô tả: pin mỗi Speaking session vào renderer đầu tiên đã mở nó.
--
-- Existing sessions predate the claim protocol and therefore belong to the
-- Legacy player. New rows remain NULL until the runtime-selected stable player
-- boots and claims either `legacy` or `next`. The claim is atomic: concurrent
-- tabs cannot move an already-claimed session to another implementation.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'sessions'
           AND column_name = 'renderer_affinity'
    ) THEN
        ALTER TABLE public.sessions
            ADD COLUMN renderer_affinity TEXT;

        UPDATE public.sessions
           SET renderer_affinity = 'legacy'
         WHERE renderer_affinity IS NULL;
    END IF;
END;
$$;

DO $$
BEGIN
    ALTER TABLE public.sessions
        ADD CONSTRAINT sessions_renderer_affinity_valid
        CHECK (renderer_affinity IN ('legacy', 'next')) NOT VALID;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END;
$$;

ALTER TABLE public.sessions
    VALIDATE CONSTRAINT sessions_renderer_affinity_valid;

COMMENT ON COLUMN public.sessions.renderer_affinity IS
    'Stable Speaking renderer claimed on first player boot. Existing pre-migration sessions are legacy; NULL means a fresh session has not opened a player yet.';

CREATE OR REPLACE FUNCTION public.fn_claim_session_renderer_affinity(
    p_session_id uuid,
    p_user_id uuid,
    p_renderer_affinity text
)
RETURNS TABLE(session_id uuid, renderer_affinity text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_renderer_affinity NOT IN ('legacy', 'next') THEN
        RAISE EXCEPTION 'invalid_renderer_affinity'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    UPDATE public.sessions AS target
       SET renderer_affinity = COALESCE(target.renderer_affinity, p_renderer_affinity)
     WHERE target.id = p_session_id
       AND target.user_id = p_user_id
    RETURNING target.id, target.renderer_affinity;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_claim_session_renderer_affinity(uuid, uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_session_renderer_affinity(uuid, uuid, text)
    TO service_role;

COMMENT ON FUNCTION public.fn_claim_session_renderer_affinity(uuid, uuid, text) IS
    'Atomically claim an unclaimed Speaking session renderer, or return the immutable existing claim. Service-role backend only.';

COMMIT;
