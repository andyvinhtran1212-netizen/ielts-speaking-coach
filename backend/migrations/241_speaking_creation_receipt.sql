-- Atomic insert-vs-replay receipt, without changing existing v1/v2/v3 callers.
-- Requires migration 216. No source-row changes or evidence writes on apply.
-- Invoke as a standalone READ COMMITTED RPC. The learner operation retains
-- its existing quota, identity-conflict and renderer behavior from v3.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_create_session_daily_capped_v4(
    p_session_id uuid,
    p_user_id uuid,
    p_mode text,
    p_part integer,
    p_topic text,
    p_day_start timestamptz,
    p_max_daily integer,
    p_renderer_affinity text
)
RETURNS TABLE(session_data jsonb, created boolean)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    existing public.sessions%ROWTYPE;
    session_count integer;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'session_creation_receipt_requires_read_committed'
            USING ERRCODE = '22023';
    END IF;
    IF p_session_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'session_creation_receipt_requires_identity'
            USING ERRCODE = '22023';
    END IF;

    IF p_renderer_affinity IS NOT NULL AND p_renderer_affinity NOT IN ('legacy', 'next') THEN
        RAISE EXCEPTION 'invalid_renderer_affinity' USING ERRCODE = '22023';
    END IF;
    -- Same order, quota and identity rules as v3. Unlike a wrapper that probes
    -- EXISTS then calls v3 (a second read), only the actual INSERT RETURNING
    -- below can assert created=true. This remains truthful if another source
    -- writer does not participate in these advisory locks.
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text)::bigint);
    PERFORM pg_advisory_xact_lock(hashtext(p_session_id::text)::bigint);
    SELECT * INTO existing FROM public.sessions WHERE id = p_session_id;
    IF FOUND THEN
        IF existing.user_id IS DISTINCT FROM p_user_id
           OR existing.mode IS DISTINCT FROM p_mode
           OR existing.part IS DISTINCT FROM p_part
           OR existing.topic IS DISTINCT FROM p_topic THEN
            RAISE EXCEPTION 'session_id_conflict' USING ERRCODE = 'P0001';
        END IF;
        RETURN QUERY SELECT to_jsonb(existing), false;
        RETURN;
    END IF;
    SELECT count(*) INTO session_count FROM public.sessions
     WHERE user_id = p_user_id AND started_at >= p_day_start;
    IF session_count >= p_max_daily THEN
        RAISE EXCEPTION 'daily_quota_exceeded'
            USING ERRCODE = 'P0001', HINT = session_count::text;
    END IF;
    RETURN QUERY
    WITH inserted AS (
        INSERT INTO public.sessions(id, user_id, mode, part, topic, status, renderer_affinity)
        VALUES(p_session_id, p_user_id, p_mode, p_part, p_topic, 'in_progress', p_renderer_affinity)
        RETURNING *
    ) SELECT to_jsonb(inserted), true FROM inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_session_daily_capped_v4(
    uuid, uuid, text, integer, text, timestamptz, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_session_daily_capped_v4(
    uuid, uuid, text, integer, text, timestamptz, integer, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
