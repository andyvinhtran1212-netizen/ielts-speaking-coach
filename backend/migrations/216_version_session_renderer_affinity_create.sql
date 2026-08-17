-- Migration: 216_version_session_renderer_affinity_create.sql
--
-- Migration 215 backfilled rows that already existed, but a browser that loaded
-- the pre-affinity frontend can remain open after that migration and create a
-- new Legacy session without making the claim introduced by the new player.
-- Pin all legacy/unversioned inserts by default, while giving the affinity-aware
-- backend one explicit atomic create path that may deliberately insert NULL for
-- the first stable player to claim.

ALTER TABLE public.sessions
    ALTER COLUMN renderer_affinity SET DEFAULT 'legacy';

CREATE OR REPLACE FUNCTION public.fn_create_session_daily_capped_v3(
    p_session_id       uuid,
    p_user_id          uuid,
    p_mode             text,
    p_part             integer,
    p_topic            text,
    p_day_start        timestamptz,
    p_max_daily        integer,
    p_renderer_affinity text
)
RETURNS SETOF public.sessions
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count    integer;
    v_existing public.sessions%ROWTYPE;
BEGIN
    IF p_renderer_affinity IS NOT NULL
       AND p_renderer_affinity NOT IN ('legacy', 'next') THEN
        RAISE EXCEPTION 'invalid_renderer_affinity'
            USING ERRCODE = '22023';
    END IF;

    -- Keep the quota and idempotency locks from the v2 contract. The backend
    -- now supplies a server-minted UUID even for non-retryable callers so this
    -- single versioned function can own both create paths.
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text)::bigint);
    PERFORM pg_advisory_xact_lock(hashtext(p_session_id::text)::bigint);

    SELECT * INTO v_existing
      FROM public.sessions
     WHERE id = p_session_id;

    IF FOUND THEN
        IF v_existing.user_id IS DISTINCT FROM p_user_id
           OR v_existing.mode IS DISTINCT FROM p_mode
           OR v_existing.part IS DISTINCT FROM p_part
           OR v_existing.topic IS DISTINCT FROM p_topic THEN
            RAISE EXCEPTION 'session_id_conflict'
                USING ERRCODE = 'P0001';
        END IF;
        RETURN NEXT v_existing;
        RETURN;
    END IF;

    SELECT count(*) INTO v_count
      FROM public.sessions
     WHERE user_id = p_user_id
       AND started_at >= p_day_start;

    IF v_count >= p_max_daily THEN
        RAISE EXCEPTION 'daily_quota_exceeded'
            USING ERRCODE = 'P0001', HINT = v_count::text;
    END IF;

    RETURN QUERY
    INSERT INTO public.sessions (
        id, user_id, mode, part, topic, status, renderer_affinity
    ) VALUES (
        p_session_id, p_user_id, p_mode, p_part, p_topic, 'in_progress',
        p_renderer_affinity
    )
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_session_daily_capped_v3(
    uuid, uuid, text, integer, text, timestamptz, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_session_daily_capped_v3(
    uuid, uuid, text, integer, text, timestamptz, integer, text
) TO service_role;

COMMENT ON FUNCTION public.fn_create_session_daily_capped_v3(
    uuid, uuid, text, integer, text, timestamptz, integer, text
) IS
    'Versioned atomic session create. Unversioned/N-1 inserts default Legacy; affinity-aware callers explicitly pass NULL for first-player claim.';

NOTIFY pgrst, 'reload schema';
