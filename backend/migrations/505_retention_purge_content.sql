-- COURSEACCESS-0055 FR-048 follow-up (G04-T10b, after #2550): purge one
-- Speaking session's content by the learner's course-access window, checked
-- and purged in one transaction under the learner's locks.
--
-- Why (#2550, Andy 2026-11-23 option 1): the sweep decides a learner's window
-- (plan 5.14) from a batch read, re-reads it right before the purge, then
-- scrubs with separate requests. A grant, a renewal, a class membership or a
-- code that commits between that re-read and the scrub would lose content the
-- policy keeps. With retention_by_entitlement on, the sweep purges only through
-- this RPC, which re-checks under locks every such write must wait for.
--
-- One function, no table, no column, no seed, no change to any existing row
-- except the purge itself (responses' four content columns set NULL and
-- sessions.content_purged_at stamped, exactly as jobs/retention_sweep.py
-- _purge_content does today; scores are never touched).
--
-- Forward: pending_feature retention_purge (a group of its own). No apply on
-- merge. Apply only after 383 and 384 are on that environment, on staging first
-- under the advisory-locked runner after SA review and Andy's typed approval;
-- production only at an authorised staging-to-main promotion. Re-runnable; one
-- transaction; postcondition block.
-- Rollback: deploy the preceding backend (with the flag on, the sweep then
-- keeps every course-window learner's content and logs no_function), then
-- rollback/505_retention_purge_content.sql (drops the RPC; nothing else).
--
-- Locking, in this order (the order of 384/387: advisory lock before rows):
--   0. read the session's owner without a lock;
--   1. fn_credit_lock_user(owner): the lock of every 384/387 grant, confirm,
--      extend, reserve and class conversion. It comes before any row lock:
--      fn_credit_reserve holds it and then inserts credit_cluster_members,
--      whose FK check needs KEY SHARE on this sessions row, so a session row
--      lock taken first would deadlock with a regrade (SA #2624);
--   2. the sessions row FOR UPDATE (two sweeps cannot purge one session
--      twice), then the owner is read again: if it changed, keep;
--   3. the owner's users row FOR UPDATE: any insert that references the user
--      (entitlements, user_code_assignments, students) waits on its foreign
--      key check until this transaction ends. 384's header keeps users free
--      of FOR UPDATE because of the 332/341 triggers; a row lock fires no
--      trigger, and this lock is taken last-but-one, after the advisory lock
--      every 384/387 writer takes first, so it adds no new wait order;
--   4. the owner's students rows, their memberships, assignments,
--      entitlements and used_by codes FOR UPDATE: a membership insert waits on
--      its student foreign key; a reactivation, extension or revoke-undo of an
--      existing row waits on the row.
-- After the locks every check reads committed rows (READ COMMITTED, one
-- snapshot per statement), so a write that committed first is seen and one
-- that comes later waits for the purge to commit. Transaction-scoped only.
-- Known limits (rare, recorded rather than locked, SA #2624 nit 2): un-
-- archiving a class (cohorts.archived_at back to NULL) and un-revoking,
-- unlocking or extending (a later expires_at) a code the learner holds only
-- through an assignment are not waited for. Locking cohorts or those codes here would invert 387's order
-- (cohort row before the member's advisory lock). Both keep-side checks are
-- still read after every lock above.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Builtins only; every object below is schema-qualified.
SET LOCAL search_path = pg_catalog, pg_temp;

-- 383/384 and the tables the check and the purge read must be present.
DO $precondition$
BEGIN
    IF to_regprocedure('public.fn_credit_lock_user(uuid)') IS NULL
       OR to_regclass('public.entitlements') IS NULL
       OR to_regclass('public.students') IS NULL
       OR to_regclass('public.student_cohort_memberships') IS NULL
       OR to_regclass('public.cohorts') IS NULL
       OR to_regclass('public.user_code_assignments') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.access_codes'::regclass
                         AND attname = 'product_id' AND NOT attisdropped)
       OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.sessions'::regclass
                         AND attname = 'content_purged_at' AND NOT attisdropped)
       OR (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.responses'::regclass AND NOT attisdropped
              AND attname IN ('session_id', 'transcript', 'raw_transcript_text', 'feedback',
                              'pronunciation_payload')) <> 5 THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '505 needs 383, 384 and the retention columns first';
    END IF;
END;
$precondition$;

-- ── fn_retention_purge_content (plan 5.14, FR-048) ──────────────────────────
-- Statuses: purged (+responses = rows scrubbed), already_purged, not_found,
-- kept (+reason):
--   * no_owner     the session has no user_id;
--   * owner_changed the session's user_id changed before its row was locked;
--   * live_access  an active membership of an unarchived class, or a live
--                  legacy code (product_id NULL; held through an active
--                  assignment, or used_by with no assignment row at all;
--                  not revoked, not locked, not expired);
--   * window_open  an entitlements row that never ends (active, no
--                  expires_at, started or not), or whose end (expires_at, or
--                  revoked_at for a revoked row when earlier) plus
--                  p_after_expiry_days is still ahead.
-- The check is a superset of services/retention_policy.window_from_access: it
-- can keep content the Python rule would purge (a code without Speaking
-- permissions, a class without a course), never the reverse. Whether the
-- session itself is old enough stays with the sweep (compute_expiry); no write
-- can make a session younger.
CREATE OR REPLACE FUNCTION public.fn_retention_purge_content(p_session_id uuid, p_after_expiry_days integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_now timestamptz := statement_timestamp();
    v_user uuid;
    v_owner uuid;
    v_purged timestamptz;
    v_rows integer;
BEGIN
    IF p_session_id IS NULL OR p_after_expiry_days IS NULL OR p_after_expiry_days NOT BETWEEN 0 AND 3650 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'retention_purge_invalid_argument';
    END IF;
    -- 0. The owner, unlocked: the advisory lock must come before any row lock.
    SELECT s.user_id INTO v_user FROM public.sessions s WHERE s.id = p_session_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v_user IS NULL THEN
        RETURN jsonb_build_object('status', 'kept', 'reason', 'no_owner');
    END IF;

    PERFORM public.fn_credit_lock_user(v_user);
    SELECT s.user_id, s.content_purged_at INTO v_owner, v_purged
      FROM public.sessions s WHERE s.id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v_owner IS DISTINCT FROM v_user THEN
        RETURN jsonb_build_object('status', 'kept', 'reason', 'owner_changed');
    END IF;
    IF v_purged IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'already_purged');
    END IF;
    PERFORM 1 FROM public.users u WHERE u.id = v_user FOR UPDATE;
    PERFORM 1 FROM public.students st WHERE st.user_id = v_user FOR UPDATE;
    PERFORM 1 FROM public.student_cohort_memberships m
     WHERE m.student_id IN (SELECT st.id FROM public.students st WHERE st.user_id = v_user) FOR UPDATE;
    PERFORM 1 FROM public.user_code_assignments a WHERE a.user_id = v_user FOR UPDATE;
    PERFORM 1 FROM public.entitlements e WHERE e.user_id = v_user FOR UPDATE;
    PERFORM 1 FROM public.access_codes c WHERE c.used_by = v_user FOR UPDATE;

    IF EXISTS (SELECT 1 FROM public.student_cohort_memberships m
                 JOIN public.students st ON st.id = m.student_id
                 JOIN public.cohorts k ON k.id = m.cohort_id
                WHERE st.user_id = v_user AND m.is_active AND k.archived_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.access_codes c
                   WHERE c.product_id IS NULL
                     AND c.is_revoked IS NOT TRUE AND c.is_active IS DISTINCT FROM false
                     AND (c.expires_at IS NULL OR c.expires_at > v_now)
                     AND (EXISTS (SELECT 1 FROM public.user_code_assignments a
                                   WHERE a.code_id = c.id AND a.user_id = v_user AND a.is_active)
                          OR (c.used_by = v_user
                              AND NOT EXISTS (SELECT 1 FROM public.user_code_assignments a
                                               WHERE a.code_id = c.id AND a.user_id = v_user)))) THEN
        RETURN jsonb_build_object('status', 'kept', 'reason', 'live_access');
    END IF;
    IF EXISTS (SELECT 1 FROM public.entitlements e
                WHERE e.user_id = v_user
                  AND ((e.status = 'active' AND e.expires_at IS NULL)
                       OR LEAST(e.expires_at, CASE WHEN e.status = 'revoked' THEN e.revoked_at END)
                          + make_interval(days => p_after_expiry_days) > v_now)) THEN
        RETURN jsonb_build_object('status', 'kept', 'reason', 'window_open');
    END IF;

    UPDATE public.responses
       SET transcript = NULL, raw_transcript_text = NULL, feedback = NULL, pronunciation_payload = NULL
     WHERE session_id = p_session_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    UPDATE public.sessions SET content_purged_at = v_now WHERE id = p_session_id;
    RETURN jsonb_build_object('status', 'purged', 'responses', v_rows);
END;
$$;

-- RPC: service_role only (plan 5.3).
REVOKE ALL ON FUNCTION public.fn_retention_purge_content(uuid, integer)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_retention_purge_content(uuid, integer) TO service_role;

-- ── Postcondition ───────────────────────────────────────────────────────────
DO $postcondition$
DECLARE
    v_routine regprocedure := 'public.fn_retention_purge_content(uuid,integer)'::regprocedure;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_routine AND prosecdef
                      AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '505 postcondition: definer/search_path';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_routine AND a.grantee = 0)
       OR has_function_privilege('anon', v_routine, 'EXECUTE')
       OR has_function_privilege('authenticated', v_routine, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_routine, 'EXECUTE') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '505 postcondition: EXECUTE';
    END IF;
END;
$postcondition$;

NOTIFY pgrst, 'reload schema';
COMMIT;
