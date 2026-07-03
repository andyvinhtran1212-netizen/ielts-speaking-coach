-- Migration: 126_create_session_daily_capped_rpc.sql
-- Audit 2026-07-03 L7 (LOW): session-creation quota TOCTOU.
--
-- routers/sessions.py POST /sessions did read-count-then-insert: SELECT today's
-- session count → if under MAX_SESSIONS_PER_USER_PER_DAY, INSERT. Two concurrent
-- POST /sessions (double-click / retry) both read count=N<cap and both insert →
-- the daily cap is exceeded by one. No DB constraint backed the check.
--
-- Scope note: only the DAILY cap is genuinely raceable at creation time. The
-- per-code LIFETIME quota counts COMPLETED sessions, and a freshly created
-- session is `in_progress`, so concurrent creates cannot overrun it — that check
-- stays in Python (sessions.py) unchanged.
--
-- This RPC makes the daily count-then-insert atomic: a per-user advisory lock is
-- held for the PostgREST request transaction, so a second concurrent create for
-- the same user blocks until the first commits and then sees the updated count.
--
-- The UTC day-start is computed in Python and passed in (p_day_start) so the
-- UTC-vs-local day-boundary logic stays in one place. Admins pass an
-- effectively-unlimited p_max_daily to bypass the cap while still getting the
-- atomic insert.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_create_session_daily_capped(
    p_user_id   uuid,
    p_mode      text,
    p_part      integer,
    p_topic     text,
    p_day_start timestamptz,
    p_max_daily integer
)
RETURNS SETOF sessions
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count integer;
BEGIN
    -- Serialize concurrent creates for THIS user. Transaction-scoped advisory
    -- lock → released automatically when PostgREST commits the request txn.
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text)::bigint);

    SELECT count(*) INTO v_count
      FROM sessions
     WHERE user_id = p_user_id
       AND started_at >= p_day_start;

    IF v_count >= p_max_daily THEN
        -- Sentinel the caller maps to HTTP 429. HINT carries the observed count.
        RAISE EXCEPTION 'daily_quota_exceeded'
            USING ERRCODE = 'P0001', HINT = v_count::text;
    END IF;

    RETURN QUERY
    INSERT INTO sessions (user_id, mode, part, topic, status)
    VALUES (p_user_id, p_mode, p_part, p_topic, 'in_progress')
    RETURNING *;
END;
$$;

COMMENT ON FUNCTION fn_create_session_daily_capped IS
    'Audit 2026-07-03 L7: atomic daily-capped session create. Per-user advisory lock makes the count-then-insert race-free; raises daily_quota_exceeded (P0001) when the cap is hit.';
