-- COURSEACCESS-0055 T009 (G04-T09): one active session per learner account.
-- The spec calls this file "384"; that is only a working label. register.tsv
-- assigns 388 (approval-decision.md, Andy 2026-11-20).
--
-- Purpose: the backend-only table that remembers, per learner account, which
-- Supabase Auth session is the one "in use" (plan 5.13). The session gate in
-- services/session_gate.py reads it on learner routes only while the runtime
-- flag `single_session_learners` is on (default off). This file adds that
-- table, one per-account advisory lock (`learner_session_lock`) and seven
-- lock-only AFTER triggers on the writes that start timed work
-- (reading_test_attempts, class_assignment_items, mock_exam_sittings,
-- mock_exams), so a session revoke can never miss a timed start that races it
-- (HOLD FR-040/041 on #2544). No seed, no change to any existing row, no
-- change to any existing trigger. It never touches auth.sessions; the backend
-- deletes other sessions on the direct connection only after the learner
-- presses "Tiếp tục ở đây". With the flag off nothing else takes the lock, so a
-- start pays one uncontended lock and two primary-key reads.
--
-- Forward: pending_feature single_session. No apply on merge. Staging first
-- under the advisory-locked runner after review and Andy's typed approval;
-- production only at an authorised staging-to-main promotion. Independent of
-- 383/384 (needs public.users and the four timed-work tables, all older). G04-T16 (389, spec label "387", learner_login_events)
-- applies after this file in the same group.
-- Re-runnable; one transaction; postcondition block at the end.
-- Rollback: turn the flag off, then rollback/388_learner_active_sessions.sql
-- (drops the triggers, functions and table: no learning data, only which
-- session is current).
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Builtins only; every object below is schema-qualified.
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TABLE IF NOT EXISTS public.learner_active_sessions (
    user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    -- The `session_id` claim of the Supabase Auth access token in use.
    session_id uuid NOT NULL,
    -- Derived from the User-Agent at claim time ("Chrome trên Windows"); never
    -- an address or a location.
    device_label text CONSTRAINT learner_active_sessions_device_label_check
        CHECK (device_label IS NULL OR char_length(device_label) <= 120),
    claimed_at timestamptz NOT NULL DEFAULT now(),
    -- The session the last claim replaced: only used to answer that device
    -- 401 session_displaced instead of the generic 401.
    previous_session_id uuid,
    displaced_at timestamptz,
    -- Set by "Đăng xuất khỏi mọi thiết bị" while this session was in timed
    -- work; the gate signs it out on its first request after the work ends.
    revoke_pending_at timestamptz,
    CONSTRAINT learner_active_sessions_displaced_pair_check
        CHECK ((previous_session_id IS NULL) = (displaced_at IS NULL)),
    CONSTRAINT learner_active_sessions_previous_differs_check
        CHECK (previous_session_id IS NULL OR previous_session_id <> session_id)
);

-- Backend-only (plan 5.2 convention): RLS on, no policy, nothing for client
-- roles. service_role reads the row on learner requests and inserts the first
-- row of an account; claims, displacement and revocation run on the direct
-- connection together with the auth.sessions delete, so service_role needs no
-- UPDATE or DELETE.
ALTER TABLE public.learner_active_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.learner_active_sessions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.learner_active_sessions TO service_role;

COMMENT ON TABLE public.learner_active_sessions IS
    'COURSEACCESS-0055 FR-028/040/041 (mig 388): the one Supabase Auth session in use per learner '
    'account while runtime flag single_session_learners is on. Backend-only; no learning data.';

-- ── One lock per account, shared with every timed-work start (FR-040/041) ──
-- A claim and "Đăng xuất khỏi mọi thiết bị" decide whether timed work is
-- running and then delete Auth sessions. Both take this transaction-scoped
-- advisory lock first and look for timed work only while holding it. Every
-- write that starts timed work (the triggers below) takes the same lock, so
-- the two are ordered: a start that got the lock first commits before the
-- decision reads, and the decision sees it; a start that waited behind a
-- decision that changed the account's current session is refused, so no
-- timed work begins on a session that was just signed out. Two-key form,
-- class 388: its own lock space, never a migration-runner key.
CREATE OR REPLACE FUNCTION public.learner_session_lock(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(388, pg_catalog.hashtext(p_user_id::text));
END;
$fn$;

-- Takes the lock for a timed-work start. With p_refuse, raises 55000 when
-- the account's current-session row changed while the start waited (a claim,
-- a revoke-all or a pending revoke committed in between).
CREATE OR REPLACE FUNCTION public.learner_session_guard_start(p_user_id uuid, p_refuse boolean)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
    v_before text;
    v_after text;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN;
    END IF;
    SELECT s.session_id::text || '|' || s.claimed_at::text || '|' || COALESCE(s.revoke_pending_at::text, '')
      INTO v_before
      FROM public.learner_active_sessions AS s WHERE s.user_id = p_user_id;
    PERFORM public.learner_session_lock(p_user_id);
    -- READ COMMITTED: this statement sees what committed while we waited.
    SELECT s.session_id::text || '|' || s.claimed_at::text || '|' || COALESCE(s.revoke_pending_at::text, '')
      INTO v_after
      FROM public.learner_active_sessions AS s WHERE s.user_id = p_user_id;
    IF p_refuse AND v_before IS DISTINCT FROM v_after THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'learner_session_changed_during_timed_start',
            HINT = 'The account''s current session changed while this timed start waited; nothing was started.';
    END IF;
END;
$fn$;

-- Learner-started work: reading attempts, opened timed class items, mock-exam
-- sittings (seat taken, status change, retake section start).
CREATE OR REPLACE FUNCTION public.learner_session_guard_user_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
    PERFORM public.learner_session_guard_start(NEW.user_id, true);
    RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.learner_session_guard_item_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
    v_user uuid;
BEGIN
    SELECT st.user_id INTO v_user FROM public.students AS st WHERE st.id = NEW.student_id;
    PERFORM public.learner_session_guard_start(v_user, true);
    RETURN NULL;
END;
$fn$;

-- A teacher opening a shared mock-exam section starts the clock of every
-- seated learner: lock each of them (fixed order, no deadlock between two
-- such updates) but never refuse the teacher's start.
CREATE OR REPLACE FUNCTION public.learner_session_guard_exam_start()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
    v_user uuid;
BEGIN
    FOR v_user IN
        SELECT DISTINCT s.user_id FROM public.mock_exam_sittings AS s
         WHERE s.mock_exam_id = NEW.id AND s.user_id IS NOT NULL
           AND s.status IN ('registered', 'lrw_in_progress')
         ORDER BY 1
    LOOP
        PERFORM public.learner_session_guard_start(v_user, false);
    END LOOP;
    RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.learner_session_lock(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.learner_session_guard_start(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.learner_session_guard_user_start() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.learner_session_guard_item_start() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.learner_session_guard_exam_start() FROM PUBLIC, anon, authenticated, service_role;

-- AFTER triggers see the final row (mig 280's BEFORE trigger fills
-- timed_expires_at). Each fires only on the write that starts a clock.
DROP TRIGGER IF EXISTS trg_learner_session_reading_start_ins ON public.reading_test_attempts;
CREATE TRIGGER trg_learner_session_reading_start_ins
AFTER INSERT ON public.reading_test_attempts
FOR EACH ROW WHEN (NEW.status = 'in_progress')
EXECUTE FUNCTION public.learner_session_guard_user_start();

DROP TRIGGER IF EXISTS trg_learner_session_reading_start_upd ON public.reading_test_attempts;
CREATE TRIGGER trg_learner_session_reading_start_upd
AFTER UPDATE ON public.reading_test_attempts
FOR EACH ROW WHEN (NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.learner_session_guard_user_start();

DROP TRIGGER IF EXISTS trg_learner_session_item_start_ins ON public.class_assignment_items;
CREATE TRIGGER trg_learner_session_item_start_ins
AFTER INSERT ON public.class_assignment_items
FOR EACH ROW WHEN (NEW.timed_expires_at IS NOT NULL AND NEW.submitted_at IS NULL)
EXECUTE FUNCTION public.learner_session_guard_item_start();

DROP TRIGGER IF EXISTS trg_learner_session_item_start_upd ON public.class_assignment_items;
CREATE TRIGGER trg_learner_session_item_start_upd
AFTER UPDATE ON public.class_assignment_items
FOR EACH ROW WHEN (OLD.timed_expires_at IS NULL AND NEW.timed_expires_at IS NOT NULL)
EXECUTE FUNCTION public.learner_session_guard_item_start();

DROP TRIGGER IF EXISTS trg_learner_session_sitting_start_ins ON public.mock_exam_sittings;
CREATE TRIGGER trg_learner_session_sitting_start_ins
AFTER INSERT ON public.mock_exam_sittings
FOR EACH ROW WHEN (NEW.status IN ('registered', 'lrw_in_progress'))
EXECUTE FUNCTION public.learner_session_guard_user_start();

DROP TRIGGER IF EXISTS trg_learner_session_sitting_start_upd ON public.mock_exam_sittings;
CREATE TRIGGER trg_learner_session_sitting_start_upd
AFTER UPDATE ON public.mock_exam_sittings
FOR EACH ROW WHEN (NEW.status IN ('registered', 'lrw_in_progress') AND (
    OLD.status IS DISTINCT FROM NEW.status
    OR (OLD.listening_started_at IS NULL AND NEW.listening_started_at IS NOT NULL)
    OR (OLD.reading_started_at IS NULL AND NEW.reading_started_at IS NOT NULL)
    OR (OLD.writing_started_at IS NULL AND NEW.writing_started_at IS NOT NULL)))
EXECUTE FUNCTION public.learner_session_guard_user_start();

DROP TRIGGER IF EXISTS trg_learner_session_exam_start_upd ON public.mock_exams;
CREATE TRIGGER trg_learner_session_exam_start_upd
AFTER UPDATE ON public.mock_exams
FOR EACH ROW WHEN (
    (OLD.listening_started_at IS NULL AND NEW.listening_started_at IS NOT NULL)
    OR (OLD.reading_started_at IS NULL AND NEW.reading_started_at IS NOT NULL)
    OR (OLD.writing_started_at IS NULL AND NEW.writing_started_at IS NOT NULL))
EXECUTE FUNCTION public.learner_session_guard_exam_start();

-- ── Postcondition ───────────────────────────────────────────────────────────
DO $postcondition$
DECLARE
    v_role text;
    v_privilege text;
BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
             WHERE oid = 'public.learner_active_sessions'::regclass) THEN
        RAISE EXCEPTION 'learner_active_sessions_388_rls_disabled';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                WHERE polrelid = 'public.learner_active_sessions'::regclass) THEN
        RAISE EXCEPTION 'learner_active_sessions_388_unexpected_policy';
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
            IF pg_catalog.has_table_privilege(v_role, 'public.learner_active_sessions', v_privilege) THEN
                RAISE EXCEPTION 'learner_active_sessions_388_unexpected_privilege % %', v_role, v_privilege;
            END IF;
        END LOOP;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF pg_catalog.has_table_privilege('service_role', 'public.learner_active_sessions', v_privilege) THEN
            RAISE EXCEPTION 'learner_active_sessions_388_unexpected_privilege service_role %', v_privilege;
        END IF;
    END LOOP;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF pg_catalog.has_function_privilege(v_role, 'public.learner_session_lock(uuid)', 'EXECUTE')
           OR pg_catalog.has_function_privilege(v_role, 'public.learner_session_guard_start(uuid, boolean)', 'EXECUTE') THEN
            RAISE EXCEPTION 'learner_active_sessions_388_unexpected_execute %', v_role;
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_catalog.pg_trigger
         WHERE NOT tgisinternal AND tgname IN (
             'trg_learner_session_reading_start_ins', 'trg_learner_session_reading_start_upd',
             'trg_learner_session_item_start_ins', 'trg_learner_session_item_start_upd',
             'trg_learner_session_sitting_start_ins', 'trg_learner_session_sitting_start_upd',
             'trg_learner_session_exam_start_upd')) <> 7 THEN
        RAISE EXCEPTION 'learner_active_sessions_388_start_trigger_missing';
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', 'public.learner_active_sessions', 'SELECT')
       OR NOT pg_catalog.has_table_privilege('service_role', 'public.learner_active_sessions', 'INSERT') THEN
        RAISE EXCEPTION 'learner_active_sessions_388_missing_service_privilege';
    END IF;
END;
$postcondition$;

COMMIT;
