-- Migration: 334_activate_attempt_rate_limit.sql
--
-- ACTIVATELIMIT-0034 (specs/0034-activate-attempt-rate-limit, F09). POST
-- /auth/activate limited attempts with an in-memory dict per worker, so N
-- workers allowed N×10 attempts per 10 minutes and a restart reset the count.
-- Move the counter into Postgres so every worker and replica shares it:
--
--   public.activation_attempts(user_id, attempted_at) — one row per ALLOWED
--     attempt (a refused call writes nothing, so a flood cannot grow the table).
--   public.fn_activate_attempt_check(p_user_id uuid) → jsonb
--     {"allowed": bool, "retry_after_s": int}. 10 attempts per rolling 10
--     minutes per user. Atomic: a per-user transaction advisory lock serializes
--     the count-then-insert, so two connections can never both take the 10th
--     slot. It also deletes that user's rows older than 1 day, which bounds the
--     table without any cron (AAL2 lot 08 sweep does not exist yet).
--
-- Only service_role (the backend) may execute the function; clients cannot
-- read, write or reset the counter. The backend calls it BEFORE the access
-- code is looked up or claimed and fails closed (503 activation_unavailable)
-- when the call errors.
--
-- Order: apply BEFORE the 0034 backend. The old backend never touches these
-- objects (backward compatible). The 0034 backend without this migration
-- refuses every activation with 503 (fails closed, no code consumed).
--
-- ROLLBACK (a new forward migration, never an edit of this file). Deploy the
-- pre-0034 backend first, otherwise every activation returns 503:
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DROP FUNCTION IF EXISTS public.fn_activate_attempt_check(uuid);
--   DROP TABLE IF EXISTS public.activation_attempts;
--   COMMIT;
--
-- Postcheck (read-only; must return one row 't|t|f|f|t'):
--   SELECT p.prosecdef, p.proconfig = ARRAY['search_path=""'],
--          has_function_privilege('anon', p.oid, 'EXECUTE'),
--          has_function_privilege('authenticated', p.oid, 'EXECUTE'),
--          has_function_privilege('service_role', p.oid, 'EXECUTE')
--     FROM pg_proc p WHERE p.oid = 'public.fn_activate_attempt_check(uuid)'::regprocedure;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 0. Preconditions (abort if unsafe)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        RAISE EXCEPTION 'service_role_missing';
    END IF;
END $$;

-- 1. Counter
CREATE TABLE IF NOT EXISTS public.activation_attempts (
    user_id      uuid        NOT NULL,
    attempted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_activation_attempts_user_attempted
    ON public.activation_attempts (user_id, attempted_at);

ALTER TABLE public.activation_attempts ENABLE ROW LEVEL SECURITY;

-- No policies: clients get nothing. Supabase default privileges grant ALL on
-- new tables to anon/authenticated/service_role, so revoke them explicitly.
-- service_role keeps SELECT for support queries; writes go only through the
-- function below, so backend code cannot bypass or reset the limit.
REVOKE ALL ON TABLE public.activation_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.activation_attempts TO service_role;

-- 2. Atomic check-and-record
CREATE OR REPLACE FUNCTION public.fn_activate_attempt_check(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    c_max    CONSTANT integer  := 10;
    c_window CONSTANT interval := interval '10 minutes';
    c_keep   CONSTANT interval := interval '1 day';
    v_now     timestamptz;
    v_count   integer;
    v_free_at timestamptz;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'activate_attempt_user_required' USING ERRCODE = '22004';
    END IF;
    -- The count below must see attempts committed while this call waited on
    -- the lock. Only READ COMMITTED takes a fresh snapshot per statement.
    IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'activate_attempt_check_requires_read_committed';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('activate-attempt:' || p_user_id::text, 0));
    v_now := pg_catalog.clock_timestamp();   -- after the wait, not before

    DELETE FROM public.activation_attempts
     WHERE user_id = p_user_id AND attempted_at < v_now - c_keep;

    SELECT count(*) INTO v_count
      FROM public.activation_attempts
     WHERE user_id = p_user_id AND attempted_at > v_now - c_window;

    IF v_count >= c_max THEN
        -- The window frees a slot when the (v_count - c_max + 1)-th oldest
        -- in-window attempt ages out.
        SELECT attempted_at + c_window INTO v_free_at
          FROM public.activation_attempts
         WHERE user_id = p_user_id AND attempted_at > v_now - c_window
         ORDER BY attempted_at
         OFFSET v_count - c_max LIMIT 1;
        RETURN pg_catalog.jsonb_build_object(
            'allowed', false,
            'retry_after_s', GREATEST(1, pg_catalog.ceil(
                EXTRACT(EPOCH FROM v_free_at - v_now))::integer));
    END IF;

    INSERT INTO public.activation_attempts (user_id, attempted_at) VALUES (p_user_id, v_now);
    RETURN pg_catalog.jsonb_build_object('allowed', true, 'retry_after_s', 0);
END $$;

-- Default privileges also grant EXECUTE to anon/authenticated: revoke both.
REVOKE ALL ON FUNCTION public.fn_activate_attempt_check(uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_activate_attempt_check(uuid) TO service_role;

-- 3. Postconditions (abort the whole migration if any fails)
DO $$
DECLARE
    v_fn    regprocedure := to_regprocedure('public.fn_activate_attempt_check(uuid)');
    v_role  text;
    v_priv  text;
BEGIN
    IF to_regclass('public.activation_attempts') IS NULL OR v_fn IS NULL THEN
        RAISE EXCEPTION 'activate_attempt_objects_missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_index i
         WHERE i.indrelid = 'public.activation_attempts'::regclass
           AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
                  FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum)
               = ARRAY['user_id', 'attempted_at']) THEN
        RAISE EXCEPTION 'activate_attempt_index_missing';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.activation_attempts'::regclass) THEN
        RAISE EXCEPTION 'activate_attempt_rls_disabled';
    END IF;
    -- A NULL ACL is the default one, which lets PUBLIC execute.
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND p.proacl IS NULL)
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                   WHERE p.oid = v_fn AND a.grantee = 0) THEN
        RAISE EXCEPTION 'activate_attempt_check_public_executable';
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
            FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
                IF has_table_privilege(v_role, 'public.activation_attempts', v_priv) THEN
                    RAISE EXCEPTION 'activate_attempt_table_client_privilege: % %', v_role, v_priv;
                END IF;
            END LOOP;
            IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
                RAISE EXCEPTION 'activate_attempt_check_client_executable: %', v_role;
            END IF;
        END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'activate_attempt_check_not_service_executable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn AND prosecdef
                     AND proconfig = ARRAY['search_path=""']) THEN
        RAISE EXCEPTION 'activate_attempt_check_not_pinned_security_definer';
    END IF;
    -- The definer must see every row: it owns the table (RLS not forced) or
    -- bypasses RLS.
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_class c ON c.oid = 'public.activation_attempts'::regclass
          JOIN pg_roles r ON r.oid = p.proowner
         WHERE p.oid = v_fn
           AND (r.rolsuper OR r.rolbypassrls
                OR (p.proowner = c.relowner AND NOT c.relforcerowsecurity))) THEN
        RAISE EXCEPTION 'activate_attempt_check_owner_subject_to_rls';
    END IF;
END $$;

COMMIT;
