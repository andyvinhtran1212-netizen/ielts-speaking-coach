-- COURSEACCESS-0055 T007 (G04-T07), FR-013/FR-014/FR-015: settle a Speaking
-- credit hold per grading attempt, so a cluster costs exactly one credit when
-- at least one of its answers is graded and saved, and nothing when every
-- answer fails (Andy, BLOCKER on #2554 11:18Z; migration approved 2026-11-23
-- 11:28Z, "duyệt migration 503 cho #2554 (G04-T07)").
--
-- Why a migration: a Speaking cluster hold is shared by the answer that opened
-- it and by every "covered" answer (credit_covered_requests). Plain
-- fn_credit_commit/fn_credit_release cannot tell whether another answer of the
-- cluster is still being graded, and credit_covered_requests is append-only,
-- so the backend cannot record "this attempt failed" there. Deciding "release
-- only when no answer was saved and none can still finish" from the backend
-- leaves a window between the check and the release.
--
-- What it adds:
--   * credit_attempt_outcomes: append-only, one row per (hold, request key),
--     outcome graded | failed. The first outcome of an attempt stands.
--   * fn_credit_settle_attempt(reservation, request_key, outcome, reason),
--     under the user's advisory lock (the lock fn_credit_reserve takes, so no
--     covered answer can join the hold while it decides):
--       graded → commit the hold if it is still open;
--       failed → record it; release the hold only when every participant
--                (the hold's own request key and every covered request key
--                of the hold) has a failed outcome. Otherwise the hold stays
--                open for the answers still running; an attempt that dies
--                without settling is refunded by fn_credit_expire_reservations
--                at expires_at, as before.
--     A non-cluster hold has one participant, so failed releases at once.
--   * an index on credit_covered_requests(reservation_id) for that check.
-- No seed, no backfill, no change to an existing row, table or function.
--
-- Forward: pending_feature credit_attempt_settle. Needs 384. No apply on merge;
-- staging first under the advisory-locked runner after review and Andy's
-- typed approval, in the same run as (or after) 383/384; production only at an
-- authorised staging-to-main promotion. It must be applied before
-- credit_metering is turned on with the G04-T07 backend: that backend settles
-- Speaking holds only through this RPC.
-- Re-runnable; one transaction; postcondition block at the end.
-- Rollback: deploy the preceding backend, then rollback/503_credit_attempt_settle.sql
-- (drops the RPC, keeps the table and its rows).
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Builtins only; every object below is schema-qualified.
SET LOCAL search_path = pg_catalog, pg_temp;

DO $requires$
BEGIN
    IF to_regclass('public.credit_reservations') IS NULL
       OR to_regclass('public.credit_covered_requests') IS NULL
       OR to_regprocedure('public.fn_credit_lock_user(uuid)') IS NULL
       OR to_regprocedure('public.fn_credit_settle_release(public.credit_reservations,text,text)') IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '503 requires 384 (credit ledger and RPCs)';
    END IF;
END;
$requires$;

-- ── credit_attempt_outcomes (append-only) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_attempt_outcomes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    reservation_id uuid NOT NULL REFERENCES public.credit_reservations(id) ON DELETE RESTRICT,
    request_key text NOT NULL CONSTRAINT credit_attempt_outcomes_request_key_check
        CHECK (char_length(request_key) BETWEEN 8 AND 120),
    outcome text NOT NULL CONSTRAINT credit_attempt_outcomes_outcome_check
        CHECK (outcome IN ('graded', 'failed')),
    reason text CONSTRAINT credit_attempt_outcomes_reason_check
        CHECK (reason IS NULL OR reason IN ('grader_failed', 'stt_failed', 'request_failed', 'budget_refused')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_attempt_outcomes_reason_outcome CHECK ((outcome = 'failed') = (reason IS NOT NULL)),
    CONSTRAINT credit_attempt_outcomes_attempt UNIQUE (reservation_id, request_key)
);
CREATE INDEX IF NOT EXISTS ix_credit_attempt_outcomes_user_key
    ON public.credit_attempt_outcomes (user_id, request_key);
CREATE OR REPLACE TRIGGER trg_credit_attempt_outcomes_append_only
    BEFORE UPDATE OR DELETE ON public.credit_attempt_outcomes
    FOR EACH ROW EXECUTE FUNCTION public.fn_course_commerce_append_only();
CREATE OR REPLACE TRIGGER trg_credit_attempt_outcomes_no_truncate
    BEFORE TRUNCATE ON public.credit_attempt_outcomes
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_course_commerce_append_only();

CREATE INDEX IF NOT EXISTS ix_credit_covered_requests_reservation
    ON public.credit_covered_requests (reservation_id);

-- ── fn_credit_settle_attempt ────────────────────────────────────────────────
-- Statuses: committed | already_committed | released | pending (failed, other
-- answers of the hold still running) | not_open (released/expired before this
-- outcome) | not_participant | not_found.
CREATE OR REPLACE FUNCTION public.fn_credit_settle_attempt(
    p_reservation_id uuid, p_request_key text, p_outcome text, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_user uuid;
    v_res public.credit_reservations%ROWTYPE;
    v_waiting integer;
BEGIN
    IF p_reservation_id IS NULL OR p_request_key IS NULL
       OR char_length(p_request_key) NOT BETWEEN 8 AND 120
       OR p_outcome IS NULL OR p_outcome NOT IN ('graded', 'failed')
       OR (p_outcome = 'graded' AND p_reason IS NOT NULL)
       OR (p_outcome = 'failed' AND (p_reason IS NULL OR p_reason NOT IN
           ('grader_failed', 'stt_failed', 'request_failed', 'budget_refused'))) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'credit_settle_attempt_invalid_argument';
    END IF;
    SELECT user_id INTO v_user FROM public.credit_reservations WHERE id = p_reservation_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    -- Same order as fn_credit_reserve: the user's lock, then the hold's row.
    PERFORM public.fn_credit_lock_user(v_user);
    SELECT * INTO v_res FROM public.credit_reservations WHERE id = p_reservation_id FOR UPDATE;

    IF v_res.request_key IS DISTINCT FROM p_request_key
       AND NOT EXISTS (SELECT 1 FROM public.credit_covered_requests c
                        WHERE c.reservation_id = v_res.id AND c.user_id = v_res.user_id
                          AND c.feature = v_res.feature AND c.request_key = p_request_key) THEN
        RETURN jsonb_build_object('status', 'not_participant', 'reservation_id', v_res.id);
    END IF;

    INSERT INTO public.credit_attempt_outcomes (user_id, reservation_id, request_key, outcome, reason)
    VALUES (v_res.user_id, v_res.id, p_request_key, p_outcome, p_reason)
    ON CONFLICT ON CONSTRAINT credit_attempt_outcomes_attempt DO NOTHING;

    IF v_res.status = 'committed' THEN
        RETURN jsonb_build_object('status', 'already_committed', 'reservation_id', v_res.id);
    ELSIF v_res.status <> 'open' THEN
        RETURN jsonb_build_object('status', 'not_open', 'reservation_id', v_res.id,
                                  'reservation_status', v_res.status);
    END IF;

    IF p_outcome = 'graded' THEN
        UPDATE public.credit_reservations SET status = 'committed', settled_at = statement_timestamp()
         WHERE id = v_res.id;
        RETURN jsonb_build_object('status', 'committed', 'reservation_id', v_res.id);
    END IF;

    -- failed: release only when no participant can still finish.
    SELECT count(*) INTO v_waiting
      FROM (SELECT v_res.request_key AS request_key
            UNION
            SELECT c.request_key FROM public.credit_covered_requests c
             WHERE c.reservation_id = v_res.id) AS p
     WHERE NOT EXISTS (SELECT 1 FROM public.credit_attempt_outcomes o
                        WHERE o.reservation_id = v_res.id AND o.request_key = p.request_key
                          AND o.outcome = 'failed');
    IF v_waiting > 0 THEN
        RETURN jsonb_build_object('status', 'pending', 'reservation_id', v_res.id, 'waiting', v_waiting);
    END IF;
    PERFORM public.fn_credit_settle_release(v_res, 'released', p_reason);
    RETURN jsonb_build_object('status', 'released', 'reservation_id', v_res.id);
END;
$$;

-- ── Privileges ──────────────────────────────────────────────────────────────
-- Backend-only, like the 384 tables: RLS on, no policy, SELECT for
-- service_role (the route reads an attempt's outcome to allow a retry);
-- every write goes through the SECURITY DEFINER RPC.
ALTER TABLE public.credit_attempt_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_attempt_outcomes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.credit_attempt_outcomes TO service_role;
DO $sequences$
BEGIN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
                   pg_get_serial_sequence('public.credit_attempt_outcomes', 'id'));
END;
$sequences$;
REVOKE ALL ON FUNCTION public.fn_credit_settle_attempt(uuid, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_credit_settle_attempt(uuid, text, text, text) TO service_role;

-- ── Postcondition ───────────────────────────────────────────────────────────
DO $postcondition$
DECLARE
    v_table regclass := 'public.credit_attempt_outcomes'::regclass;
    v_routine regprocedure := 'public.fn_credit_settle_attempt(uuid,text,text,text)'::regprocedure;
    v_role text;
BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table)
       OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_table) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '503 postcondition: RLS/policy on ' || v_table;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF has_table_privilege(v_role, v_table, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '503 postcondition: ' || v_role || ' on ' || v_table;
        END IF;
    END LOOP;
    IF has_table_privilege('service_role', v_table, 'INSERT, UPDATE, DELETE, TRUNCATE')
       OR NOT has_table_privilege('service_role', v_table, 'SELECT') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '503 postcondition: service_role on ' || v_table;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_routine AND prosecdef
                      AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '503 postcondition: definer/search_path ' || v_routine;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_routine AND a.grantee = 0)
       OR has_function_privilege('anon', v_routine, 'EXECUTE')
       OR has_function_privilege('authenticated', v_routine, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_routine, 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '503 postcondition: EXECUTE ' || v_routine;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_credit_attempt_outcomes_append_only'
                    AND tgrelid = v_table)
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_credit_attempt_outcomes_no_truncate'
                       AND tgrelid = v_table) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '503 postcondition: append-only triggers';
    END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
