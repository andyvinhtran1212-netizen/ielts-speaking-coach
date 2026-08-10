-- Migration: 201_session_create_idempotency.sql
-- Mô tả: idempotent POST /sessions retry for result-page "Luyện lại".
--
-- The original fn_create_session_daily_capped remains intact for legacy
-- clients. V2 accepts a client-minted UUID as the session primary key. A retry
-- with the same owner + payload returns the existing row before checking the
-- daily cap; a reused key with different identity/payload fails closed.

CREATE OR REPLACE FUNCTION fn_create_session_daily_capped_v2(
    p_session_id uuid,
    p_user_id    uuid,
    p_mode       text,
    p_part       integer,
    p_topic      text,
    p_day_start  timestamptz,
    p_max_daily  integer
)
RETURNS SETOF sessions
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count    integer;
    v_existing sessions%ROWTYPE;
BEGIN
    -- Preserve the original per-user quota serialization. The UUID lock also
    -- makes the already-improbable cross-user UUID collision deterministic.
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text)::bigint);
    PERFORM pg_advisory_xact_lock(hashtext(p_session_id::text)::bigint);

    SELECT * INTO v_existing
      FROM sessions
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
      FROM sessions
     WHERE user_id = p_user_id
       AND started_at >= p_day_start;

    IF v_count >= p_max_daily THEN
        RAISE EXCEPTION 'daily_quota_exceeded'
            USING ERRCODE = 'P0001', HINT = v_count::text;
    END IF;

    RETURN QUERY
    INSERT INTO sessions (id, user_id, mode, part, topic, status)
    VALUES (p_session_id, p_user_id, p_mode, p_part, p_topic, 'in_progress')
    RETURNING *;
END;
$$;

COMMENT ON FUNCTION fn_create_session_daily_capped_v2 IS
    'Idempotent daily-capped session create. Same client UUID + owner + payload returns the existing row; conflicting reuse fails closed.';
