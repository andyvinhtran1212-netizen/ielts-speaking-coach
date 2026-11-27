-- COURSEACCESS-0055 T014 (G04-T16): recent learner sign-ins.
-- The spec calls this file "387"; that is only a working label. register.tsv
-- assigns 389 (approval-decision.md, Andy 2026-11-20; 387 belongs to G04-T15).
--
-- Purpose: the data behind "Lần đăng nhập gần đây" (plan 5.13b, FR-049). One
-- row per (session, outcome), written by services/session_gate.py through
-- services/login_events.py only while runtime flag `single_session_learners`
-- is on. Stores the derived device kind and label and the sign-in method;
-- never an IP address, a location or the raw User-Agent. Not append-only:
-- rows older than LOGIN_EVENTS_KEEP_DAYS are deleted by the sweep.
--
-- Forward: pending_feature single_session. No apply on merge. Apply after 388
-- in the same group, staging first under the advisory-locked runner after
-- review and Andy's typed approval; production only at an authorised
-- staging-to-main promotion. Needs only public.users.
-- Re-runnable; one transaction; postcondition block at the end.
-- Rollback: turn the flag off, then rollback/389_learner_login_events.sql
-- (drops the table: no learning data).
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Builtins only; every object below is schema-qualified.
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TABLE IF NOT EXISTS public.learner_login_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- The `session_id` claim of the session the event is about.
    session_id uuid NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    device_kind text NOT NULL CONSTRAINT learner_login_events_device_kind_check
        CHECK (device_kind IN ('desktop', 'phone', 'tablet', 'unknown')),
    device_label text CONSTRAINT learner_login_events_device_label_check
        CHECK (device_label IS NULL OR char_length(device_label) <= 120),
    method text NOT NULL CONSTRAINT learner_login_events_method_check
        CHECK (method IN ('google', 'email_code', 'unknown')),
    outcome text NOT NULL CONSTRAINT learner_login_events_outcome_check
        CHECK (outcome IN ('signed_in', 'pending', 'claimed', 'claim_refused_timed',
                           'displaced', 'signed_out_all')),
    CONSTRAINT learner_login_events_session_outcome_key UNIQUE (user_id, session_id, outcome)
);
CREATE INDEX IF NOT EXISTS ix_learner_login_events_user_occurred
    ON public.learner_login_events (user_id, occurred_at DESC);

-- Backend-only (plan 5.2 convention): RLS on, no policy, nothing for client
-- roles. service_role inserts (ON CONFLICT DO NOTHING), reads, and deletes
-- expired rows; it never updates one.
ALTER TABLE public.learner_login_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.learner_login_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.learner_login_events TO service_role;
DO $sequence$
BEGIN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role',
                   pg_catalog.pg_get_serial_sequence('public.learner_login_events', 'id'));
END;
$sequence$;

COMMENT ON TABLE public.learner_login_events IS
    'COURSEACCESS-0055 FR-049 (mig 389): recent learner sign-in events while runtime flag '
    'single_session_learners is on. Backend-only; no IP address, no location, no raw User-Agent.';

-- ── Postcondition ───────────────────────────────────────────────────────────
DO $postcondition$
DECLARE
    v_role text;
    v_privilege text;
BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
             WHERE oid = 'public.learner_login_events'::regclass) THEN
        RAISE EXCEPTION 'learner_login_events_389_rls_disabled';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                WHERE polrelid = 'public.learner_login_events'::regclass) THEN
        RAISE EXCEPTION 'learner_login_events_389_unexpected_policy';
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
            IF pg_catalog.has_table_privilege(v_role, 'public.learner_login_events', v_privilege) THEN
                RAISE EXCEPTION 'learner_login_events_389_unexpected_privilege % %', v_role, v_privilege;
            END IF;
        END LOOP;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF pg_catalog.has_table_privilege('service_role', 'public.learner_login_events', v_privilege) THEN
            RAISE EXCEPTION 'learner_login_events_389_unexpected_privilege service_role %', v_privilege;
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'learner_login_events'
                  AND (column_name ~ '(^|_)(ip|addr|address|location|user_agent)(_|$)')) THEN
        RAISE EXCEPTION 'learner_login_events_389_forbidden_column';
    END IF;
END;
$postcondition$;

COMMIT;
