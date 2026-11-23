-- COURSEACCESS-0055 T009 (G04-T09): one active session per learner account.
-- The spec calls this file "384"; that is only a working label. register.tsv
-- assigns 388 (approval-decision.md, Andy 2026-11-20).
--
-- Purpose: the backend-only table that remembers, per learner account, which
-- Supabase Auth session is the one "in use" (plan 5.13). The session gate in
-- services/session_gate.py reads it on learner routes only while the runtime
-- flag `single_session_learners` is on (default off). This file adds one table
-- and nothing else: no trigger, no function, no seed, no change to any
-- existing row. It never touches auth.sessions; the backend deletes other
-- sessions on the direct connection only after the learner presses
-- "Tiếp tục ở đây".
--
-- Forward: pending_feature single_session. No apply on merge. Staging first
-- under the advisory-locked runner after review and Andy's typed approval;
-- production only at an authorised staging-to-main promotion. Independent of
-- 383/384 (needs only public.users). G04-T16 (389, spec label "387", learner_login_events)
-- applies after this file in the same group.
-- Re-runnable; one transaction; postcondition block at the end.
-- Rollback: turn the flag off, then rollback/388_learner_active_sessions.sql
-- (drops the table: it holds no learning data, only which session is current).
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
    IF NOT pg_catalog.has_table_privilege('service_role', 'public.learner_active_sessions', 'SELECT')
       OR NOT pg_catalog.has_table_privilege('service_role', 'public.learner_active_sessions', 'INSERT') THEN
        RAISE EXCEPTION 'learner_active_sessions_388_missing_service_privilege';
    END IF;
END;
$postcondition$;

COMMIT;
