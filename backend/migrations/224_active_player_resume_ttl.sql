-- Migration: 224_active_player_resume_ttl.sql
--
-- Gate F needs a finite, enforceable maximum lifetime for renderer-specific
-- player state.  Historical rows may stay `in_progress` forever as audit data,
-- but they must not remain resumable/mutable forever and thereby keep Legacy
-- HTML alive indefinitely.
--
-- The hard player TTL is 24 hours.  Expiry never deletes or scrubs learner
-- work.  Speaking/Reading/Listening/Dictation start a new attempt after expiry;
-- Writing keeps the assignment and draft but leases its renderer for 24 hours
-- so a later open can safely claim the current implementation.

BEGIN;

-- Stateful core players ------------------------------------------------------

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS resume_expires_at TIMESTAMPTZ;
UPDATE public.sessions
   SET resume_expires_at = started_at + INTERVAL '24 hours'
 WHERE resume_expires_at IS NULL;
ALTER TABLE public.sessions
    ALTER COLUMN resume_expires_at DROP DEFAULT,
    ALTER COLUMN resume_expires_at SET NOT NULL;

ALTER TABLE public.reading_test_attempts
    ADD COLUMN IF NOT EXISTS resume_expires_at TIMESTAMPTZ;
UPDATE public.reading_test_attempts
   SET resume_expires_at = started_at + INTERVAL '24 hours'
 WHERE resume_expires_at IS NULL;
ALTER TABLE public.reading_test_attempts
    ALTER COLUMN resume_expires_at DROP DEFAULT,
    ALTER COLUMN resume_expires_at SET NOT NULL;

ALTER TABLE public.listening_test_attempts
    ADD COLUMN IF NOT EXISTS resume_expires_at TIMESTAMPTZ;
UPDATE public.listening_test_attempts
   SET resume_expires_at = COALESCE(started_at, created_at) + INTERVAL '24 hours'
 WHERE resume_expires_at IS NULL;
ALTER TABLE public.listening_test_attempts
    ALTER COLUMN resume_expires_at DROP DEFAULT,
    ALTER COLUMN resume_expires_at SET NOT NULL;

ALTER TABLE public.dictation_attempts
    ADD COLUMN IF NOT EXISTS resume_expires_at TIMESTAMPTZ;
UPDATE public.dictation_attempts
   SET resume_expires_at = started_at + INTERVAL '24 hours'
 WHERE resume_expires_at IS NULL;
ALTER TABLE public.dictation_attempts
    ALTER COLUMN resume_expires_at DROP DEFAULT,
    ALTER COLUMN resume_expires_at SET NOT NULL;

-- N-1 routers do not know about resume_expires_at yet. A column default based
-- on now() is unsafe because those routers already supply started_at from the
-- application; network latency can make now()+24h exceed the hard upper bound
-- by milliseconds. Fill only omitted values from the canonical row anchor in
-- a BEFORE INSERT trigger, while preserving an explicit value from new code.
CREATE OR REPLACE FUNCTION public.fn_set_active_player_resume_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.resume_expires_at IS NULL THEN
        IF TG_TABLE_NAME = 'listening_test_attempts' THEN
            NEW.resume_expires_at := COALESCE(NEW.started_at, NEW.created_at)
                                     + INTERVAL '24 hours';
        ELSE
            NEW.resume_expires_at := NEW.started_at + INTERVAL '24 hours';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_session_resume_expiry ON public.sessions;
CREATE TRIGGER trg_set_session_resume_expiry
    BEFORE INSERT ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_active_player_resume_expiry();
DROP TRIGGER IF EXISTS trg_set_reading_attempt_resume_expiry
    ON public.reading_test_attempts;
CREATE TRIGGER trg_set_reading_attempt_resume_expiry
    BEFORE INSERT ON public.reading_test_attempts
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_active_player_resume_expiry();
DROP TRIGGER IF EXISTS trg_set_listening_attempt_resume_expiry
    ON public.listening_test_attempts;
CREATE TRIGGER trg_set_listening_attempt_resume_expiry
    BEFORE INSERT ON public.listening_test_attempts
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_active_player_resume_expiry();
DROP TRIGGER IF EXISTS trg_set_dictation_attempt_resume_expiry
    ON public.dictation_attempts;
CREATE TRIGGER trg_set_dictation_attempt_resume_expiry
    BEFORE INSERT ON public.dictation_attempts
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_active_player_resume_expiry();

DO $$
BEGIN
    ALTER TABLE public.sessions
        ADD CONSTRAINT sessions_resume_expiry_within_ttl
        CHECK (resume_expires_at > started_at AND
               resume_expires_at <= started_at + INTERVAL '24 hours') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
    ALTER TABLE public.reading_test_attempts
        ADD CONSTRAINT reading_attempt_resume_expiry_within_ttl
        CHECK (resume_expires_at > started_at AND
               resume_expires_at <= started_at + INTERVAL '24 hours') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
    ALTER TABLE public.listening_test_attempts
        ADD CONSTRAINT listening_attempt_resume_expiry_within_ttl
        CHECK (resume_expires_at > COALESCE(started_at, created_at) AND
               resume_expires_at <= COALESCE(started_at, created_at)
                                      + INTERVAL '24 hours') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
    ALTER TABLE public.dictation_attempts
        ADD CONSTRAINT dictation_attempt_resume_expiry_within_ttl
        CHECK (resume_expires_at > started_at AND
               resume_expires_at <= started_at + INTERVAL '24 hours') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

ALTER TABLE public.sessions VALIDATE CONSTRAINT sessions_resume_expiry_within_ttl;
ALTER TABLE public.reading_test_attempts VALIDATE CONSTRAINT reading_attempt_resume_expiry_within_ttl;
ALTER TABLE public.listening_test_attempts VALIDATE CONSTRAINT listening_attempt_resume_expiry_within_ttl;
ALTER TABLE public.dictation_attempts VALIDATE CONSTRAINT dictation_attempt_resume_expiry_within_ttl;

CREATE INDEX IF NOT EXISTS ix_sessions_active_resume_expiry
    ON public.sessions (resume_expires_at)
    WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS ix_reading_attempts_active_resume_expiry
    ON public.reading_test_attempts (resume_expires_at)
    WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS ix_listening_attempts_active_resume_expiry
    ON public.listening_test_attempts (resume_expires_at)
    WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS ix_dictation_attempts_active_resume_expiry
    ON public.dictation_attempts (resume_expires_at)
    WHERE status = 'in_progress';

COMMENT ON COLUMN public.sessions.resume_expires_at IS
    'Hard 24-hour Speaking player resume/mutation deadline. Expiry preserves the row and responses.';
COMMENT ON COLUMN public.reading_test_attempts.resume_expires_at IS
    'Hard 24-hour Reading player resume/mutation deadline; the shorter standalone test timer still applies at submit.';
COMMENT ON COLUMN public.listening_test_attempts.resume_expires_at IS
    'Hard 24-hour Listening player resume/mutation deadline. Expiry preserves answers.';
COMMENT ON COLUMN public.dictation_attempts.resume_expires_at IS
    'Hard 24-hour Dictation player resume/mutation deadline. Expiry preserves sentence answers.';

-- Claims must fail once the canonical resource is no longer resumable.  The
-- route maps `active_player_expired` to HTTP 410; ownership remains inside the
-- UPDATE predicate so an unknown/foreign UUID cannot be distinguished.

CREATE OR REPLACE FUNCTION public.fn_claim_session_renderer_affinity(
    p_session_id uuid,
    p_user_id uuid,
    p_renderer_affinity text
)
RETURNS TABLE(session_id uuid, renderer_affinity text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_renderer_affinity NOT IN ('legacy', 'next') THEN
        RAISE EXCEPTION 'invalid_renderer_affinity' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.sessions
         WHERE id = p_session_id AND user_id = p_user_id
           AND status = 'in_progress' AND resume_expires_at <= now()
    ) THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
    END IF;
    RETURN QUERY
    UPDATE public.sessions AS target
       SET renderer_affinity = COALESCE(target.renderer_affinity, p_renderer_affinity)
     WHERE target.id = p_session_id AND target.user_id = p_user_id
       AND target.status = 'in_progress' AND target.resume_expires_at > now()
    RETURNING target.id, target.renderer_affinity;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_claim_reading_attempt_renderer_affinity(
    p_attempt_id uuid,
    p_user_id uuid,
    p_anon_id text,
    p_renderer_affinity text
)
RETURNS TABLE(attempt_id uuid, renderer_affinity text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_renderer_affinity NOT IN ('legacy', 'next') THEN
        RAISE EXCEPTION 'invalid_renderer_affinity' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.reading_test_attempts target
         WHERE target.id = p_attempt_id AND target.status = 'in_progress'
           AND target.resume_expires_at <= now()
           AND ((p_user_id IS NOT NULL AND target.user_id = p_user_id)
             OR (p_user_id IS NULL AND p_anon_id IS NOT NULL
                 AND target.user_id IS NULL AND target.anon_id = p_anon_id))
    ) THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
    END IF;
    RETURN QUERY
    UPDATE public.reading_test_attempts AS target
       SET renderer_affinity = COALESCE(target.renderer_affinity, p_renderer_affinity)
     WHERE target.id = p_attempt_id AND target.status = 'in_progress'
       AND target.resume_expires_at > now()
       AND ((p_user_id IS NOT NULL AND target.user_id = p_user_id)
         OR (p_user_id IS NULL AND p_anon_id IS NOT NULL
             AND target.user_id IS NULL AND target.anon_id = p_anon_id))
    RETURNING target.id, target.renderer_affinity;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_claim_listening_attempt_renderer_affinity(
    p_attempt_id uuid,
    p_user_id uuid,
    p_renderer_affinity text
)
RETURNS TABLE(attempt_id uuid, renderer_affinity text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_renderer_affinity NOT IN ('legacy', 'next') THEN
        RAISE EXCEPTION 'invalid_renderer_affinity' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.listening_test_attempts
         WHERE id = p_attempt_id AND user_id = p_user_id
           AND status = 'in_progress' AND resume_expires_at <= now()
    ) THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
    END IF;
    RETURN QUERY
    UPDATE public.listening_test_attempts AS target
       SET renderer_affinity = COALESCE(target.renderer_affinity, p_renderer_affinity)
     WHERE target.id = p_attempt_id AND target.user_id = p_user_id
       AND target.status = 'in_progress' AND target.resume_expires_at > now()
    RETURNING target.id, target.renderer_affinity;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_claim_dictation_attempt_renderer_affinity(
    p_attempt_id uuid,
    p_user_id uuid,
    p_renderer_affinity text
)
RETURNS TABLE(attempt_id uuid, renderer_affinity text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_renderer_affinity NOT IN ('legacy', 'next') THEN
        RAISE EXCEPTION 'invalid_renderer_affinity' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.dictation_attempts
         WHERE id = p_attempt_id AND user_id = p_user_id
           AND status = 'in_progress' AND resume_expires_at <= now()
    ) THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
    END IF;
    RETURN QUERY
    UPDATE public.dictation_attempts AS target
       SET renderer_affinity = COALESCE(target.renderer_affinity, p_renderer_affinity),
           updated_at = now()
     WHERE target.id = p_attempt_id AND target.user_id = p_user_id
       AND target.status = 'in_progress' AND target.resume_expires_at > now()
    RETURNING target.id, target.renderer_affinity;
END;
$$;

-- DB-level autosave guards close races and protect N-1 routers.  Reading uses
-- child rows, Listening uses SECURITY DEFINER RPCs, and Dictation already has a
-- parent-locking child trigger.

CREATE OR REPLACE FUNCTION public.fn_guard_speaking_question_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE parent_status text; parent_expiry timestamptz;
BEGIN
    SELECT status, resume_expires_at INTO parent_status, parent_expiry
      FROM public.sessions WHERE id = NEW.session_id FOR UPDATE;
    IF parent_status IS DISTINCT FROM 'in_progress'
       OR parent_expiry IS NULL OR parent_expiry <= now() THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_speaking_question_mutation
    ON public.questions;
CREATE TRIGGER trg_guard_speaking_question_mutation
    BEFORE INSERT OR UPDATE ON public.questions
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_speaking_question_mutation();

CREATE OR REPLACE FUNCTION public.fn_guard_speaking_response_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE parent_status text; parent_expiry timestamptz;
BEGIN
    SELECT status, resume_expires_at INTO parent_status, parent_expiry
      FROM public.sessions WHERE id = NEW.session_id FOR UPDATE;

    -- A new learner response always belongs to a live player. Updates on a
    -- still-open player obey the same deadline. Once the parent is terminal,
    -- operational regrade/pronunciation/retention updates remain legal.
    IF TG_OP = 'INSERT' THEN
        IF parent_status IS DISTINCT FROM 'in_progress'
           OR parent_expiry IS NULL OR parent_expiry <= now() THEN
            RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
        END IF;
    ELSIF parent_status = 'in_progress'
          AND (parent_expiry IS NULL OR parent_expiry <= now())
          AND (
              NEW.session_id IS DISTINCT FROM OLD.session_id
              OR NEW.question_id IS DISTINCT FROM OLD.question_id
              OR NEW.audio_url IS DISTINCT FROM OLD.audio_url
              OR NEW.audio_storage_path IS DISTINCT FROM OLD.audio_storage_path
              OR NEW.transcript IS DISTINCT FROM OLD.transcript
              OR NEW.raw_transcript_text IS DISTINCT FROM OLD.raw_transcript_text
              OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
          ) THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_speaking_response_mutation
    ON public.responses;
CREATE TRIGGER trg_guard_speaking_response_mutation
    BEFORE INSERT OR UPDATE ON public.responses
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_speaking_response_mutation();

CREATE OR REPLACE FUNCTION public.fn_guard_reading_attempt_answer_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE parent_status text; parent_expiry timestamptz;
BEGIN
    SELECT status, resume_expires_at INTO parent_status, parent_expiry
      FROM public.reading_test_attempts WHERE id = NEW.attempt_id FOR UPDATE;
    IF parent_status IS DISTINCT FROM 'in_progress' OR parent_expiry <= now() THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_reading_attempt_answer_mutation
    ON public.reading_attempt_answers;
CREATE TRIGGER trg_guard_reading_attempt_answer_mutation
    BEFORE INSERT OR UPDATE ON public.reading_attempt_answers
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_reading_attempt_answer_mutation();

CREATE OR REPLACE FUNCTION public.fn_upsert_listening_answer(
    p_attempt_id uuid, p_q_num integer, p_user_answer text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
    UPDATE public.listening_test_attempts a
       SET answers = (
           SELECT COALESCE(jsonb_agg(s.x ORDER BY
               CASE WHEN s.x->>'q_num' ~ '^[0-9]+$'
                    THEN (s.x->>'q_num')::int ELSE 2147483647 END), '[]'::jsonb)
             FROM (
                 SELECT e AS x FROM jsonb_array_elements(a.answers) AS e
                  WHERE e->>'q_num' IS DISTINCT FROM p_q_num::text
                 UNION ALL
                 SELECT jsonb_build_object('q_num', p_q_num,
                     'user_answer', COALESCE(p_user_answer, ''),
                     'answered_at', to_jsonb(now()))
             ) s
       )
     WHERE a.id = p_attempt_id AND a.status = 'in_progress'
       AND a.resume_expires_at > now()
    RETURNING jsonb_array_length(a.answers) INTO v_count;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_insert_listening_answer_once(
    p_attempt_id uuid, p_q_num integer, p_user_answer text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_exists boolean; v_written boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements(a.answers) AS e
         WHERE e->>'q_num' IS NOT DISTINCT FROM p_q_num::text)
      INTO v_exists
      FROM public.listening_test_attempts a
     WHERE a.id = p_attempt_id AND a.status = 'in_progress'
       AND a.resume_expires_at > now();
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF v_exists THEN RETURN FALSE; END IF;
    UPDATE public.listening_test_attempts a
       SET answers = COALESCE(a.answers, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object('q_num', p_q_num,
               'user_answer', COALESCE(p_user_answer, ''),
               'answered_at', to_jsonb(now())))
     WHERE a.id = p_attempt_id AND a.status = 'in_progress'
       AND a.resume_expires_at > now()
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(a.answers, '[]'::jsonb)) AS e
            WHERE e->>'q_num' IS NOT DISTINCT FROM p_q_num::text)
    RETURNING TRUE INTO v_written;
    RETURN COALESCE(v_written, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_guard_dictation_attempt_answer_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE parent_status text; parent_expiry timestamptz;
BEGIN
    SELECT status, resume_expires_at INTO parent_status, parent_expiry
      FROM public.dictation_attempts WHERE id = NEW.attempt_id FOR UPDATE;
    IF parent_status IS DISTINCT FROM 'in_progress' OR parent_expiry <= now() THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

-- Migration 220 finalizes the parent from a dictation_sessions BEFORE INSERT
-- trigger. Guard that completion report at the same database boundary: an N-1
-- router or a request that crosses the deadline must not let the older
-- finalizer complete an expired player. PostgreSQL fires same-event triggers
-- alphabetically, so the explicit 00 prefix makes this lock/check run first.
CREATE OR REPLACE FUNCTION public.fn_guard_dictation_session_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE parent_status text; parent_expiry timestamptz;
BEGIN
    IF NEW.attempt_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT status, resume_expires_at INTO parent_status, parent_expiry
      FROM public.dictation_attempts WHERE id = NEW.attempt_id FOR UPDATE;
    -- Leave missing/terminal-parent error semantics to the migration-220
    -- finalizer. Only an expired still-open player is this guard's contract.
    IF parent_status = 'in_progress'
       AND (parent_expiry IS NULL OR parent_expiry <= now()) THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_00_guard_dictation_session_completion
    ON public.dictation_sessions;
CREATE TRIGGER trg_00_guard_dictation_session_completion
    BEFORE INSERT ON public.dictation_sessions
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_dictation_session_completion();

-- Writing renderer lease -----------------------------------------------------

ALTER TABLE public.writing_assignments
    ADD COLUMN IF NOT EXISTS renderer_affinity_claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS renderer_affinity_expires_at TIMESTAMPTZ;

-- A historical in-progress NULL affinity may represent an N-1 open tab, so it
-- receives the same finite lease.  Pending + NULL was never opened and remains
-- unclaimed/non-blocking.
UPDATE public.writing_assignments
   SET renderer_affinity_claimed_at = COALESCE(started_at, updated_at, created_at),
       renderer_affinity_expires_at = COALESCE(started_at, updated_at, created_at)
                                      + INTERVAL '24 hours'
 WHERE status IN ('pending', 'in_progress')
   AND (renderer_affinity IS NOT NULL OR status = 'in_progress')
   AND renderer_affinity_expires_at IS NULL;

DO $$
BEGIN
    ALTER TABLE public.writing_assignments
        ADD CONSTRAINT writing_renderer_lease_pair
        CHECK ((renderer_affinity_claimed_at IS NULL) =
               (renderer_affinity_expires_at IS NULL)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
    ALTER TABLE public.writing_assignments
        ADD CONSTRAINT writing_renderer_lease_order
        CHECK (renderer_affinity_expires_at IS NULL OR
               renderer_affinity_expires_at > renderer_affinity_claimed_at) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
ALTER TABLE public.writing_assignments VALIDATE CONSTRAINT writing_renderer_lease_pair;
ALTER TABLE public.writing_assignments VALIDATE CONSTRAINT writing_renderer_lease_order;

CREATE INDEX IF NOT EXISTS ix_writing_assignments_active_renderer_lease
    ON public.writing_assignments (renderer_affinity_expires_at)
    WHERE status IN ('pending', 'in_progress');

CREATE OR REPLACE FUNCTION public.fn_claim_writing_assignment_renderer_affinity(
    p_assignment_id uuid,
    p_student_id uuid,
    p_renderer_affinity text
)
RETURNS TABLE(assignment_id uuid, renderer_affinity text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_renderer_affinity NOT IN ('legacy', 'next') THEN
        RAISE EXCEPTION 'invalid_renderer_affinity' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    UPDATE public.writing_assignments AS target
       SET renderer_affinity = CASE
               WHEN target.renderer_affinity IS NULL
                 OR target.renderer_affinity_expires_at <= now()
                 OR target.renderer_affinity = p_renderer_affinity
               THEN p_renderer_affinity ELSE target.renderer_affinity END,
           renderer_affinity_claimed_at = CASE
               WHEN target.renderer_affinity IS NULL
                 OR target.renderer_affinity_expires_at <= now()
                 OR target.renderer_affinity = p_renderer_affinity
               THEN now() ELSE target.renderer_affinity_claimed_at END,
           renderer_affinity_expires_at = CASE
               WHEN target.renderer_affinity IS NULL
                 OR target.renderer_affinity_expires_at <= now()
                 OR target.renderer_affinity = p_renderer_affinity
               THEN now() + INTERVAL '24 hours'
               ELSE target.renderer_affinity_expires_at END
     WHERE target.id = p_assignment_id AND target.student_id = p_student_id
       AND target.status IN ('pending', 'in_progress')
    RETURNING target.id, target.renderer_affinity;
END;
$$;

-- writing_drafts is the mutable player state behind both autosave and the
-- append_paste_event RPC.  Keep the deadline at the database boundary too so
-- an N-1 backend, direct service-role write, or request crossing the expiry
-- instant cannot extend a retired renderer after its finite lease.  Deletes
-- remain allowed so submit/retention cleanup can preserve their existing
-- finalization semantics.
CREATE OR REPLACE FUNCTION public.fn_guard_writing_draft_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    parent_student_id uuid;
    parent_status text;
    parent_affinity text;
    parent_expiry timestamptz;
BEGIN
    SELECT student_id, status, renderer_affinity, renderer_affinity_expires_at
      INTO parent_student_id, parent_status, parent_affinity, parent_expiry
      FROM public.writing_assignments
     WHERE id = NEW.assignment_id
     FOR UPDATE;

    IF parent_student_id IS DISTINCT FROM NEW.student_id
       OR parent_status NOT IN ('pending', 'in_progress') THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
    END IF;

    -- N-1 Writing clients predate renderer claim-v1. Their first autosave is
    -- the only authoritative signal that a historical pending+NULL workspace
    -- is actually open. Give that write one finite compatibility lease without
    -- inventing a Legacy/Next affinity. The old router then transitions the
    -- assignment to in_progress, where Gate F counts the unclaimed live lease.
    IF parent_affinity IS NULL AND parent_expiry IS NULL THEN
        UPDATE public.writing_assignments
           SET renderer_affinity_claimed_at = now(),
               renderer_affinity_expires_at = now() + INTERVAL '24 hours'
         WHERE id = NEW.assignment_id
           AND renderer_affinity IS NULL
           AND renderer_affinity_claimed_at IS NULL
           AND renderer_affinity_expires_at IS NULL
        RETURNING renderer_affinity_expires_at INTO parent_expiry;
    END IF;

    IF parent_expiry IS NULL OR parent_expiry <= now() THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_writing_draft_mutation
    ON public.writing_drafts;
CREATE TRIGGER trg_guard_writing_draft_mutation
    BEFORE INSERT OR UPDATE ON public.writing_drafts
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_writing_draft_mutation();

-- Parent terminal-state guards ------------------------------------------------
--
-- The current routers bind expiry/lease predicates to their final UPDATE, but
-- a rolling Railway deploy can keep an N-1 instance alive long enough to run
-- the pre-224 direct parent UPDATE.  Child-write guards are not sufficient for
-- that path: an old request can reuse already-persisted answers and move the
-- parent from open -> submitted/completed after the deadline.  Enforce the
-- same boundary on the parent row itself.  Only transitions out of an OPEN
-- player are guarded, so background grading, admin review/regrade and repairs
-- on rows that were admitted to a terminal pipeline before expiry remain legal.
CREATE OR REPLACE FUNCTION public.fn_guard_active_player_terminal_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    old_status text := to_jsonb(OLD)->>'status';
    new_status text := to_jsonb(NEW)->>'status';
    expiry timestamptz;
    leaves_open_player boolean := false;
    links_learner_artifact boolean := false;
BEGIN
    IF old_status IS NOT DISTINCT FROM new_status THEN
        RETURN NEW;
    END IF;

    -- finalize-full-test updates all three rows in one statement.  Do not let
    -- a concurrent background completion/repair be regressed to submitted;
    -- raising aborts the entire three-row statement instead of leaving a
    -- partially advanced chain.
    IF TG_TABLE_NAME = 'sessions'
       AND new_status = 'submitted'
       AND old_status NOT IN ('in_progress', 'submitted') THEN
        RAISE EXCEPTION 'active_player_state_conflict' USING ERRCODE = '55000';
    END IF;

    IF TG_TABLE_NAME = 'writing_assignments' THEN
        expiry := NULLIF(
            to_jsonb(OLD)->>'renderer_affinity_expires_at', ''
        )::timestamptz;
        -- Student submit always links the newly-created essay in the same
        -- UPDATE. Admin has an explicit status override that intentionally
        -- does not fabricate an essay row; preserve that operational path
        -- even after the renderer lease expires.
        links_learner_artifact :=
            (to_jsonb(NEW)->>'essay_id') IS DISTINCT FROM
            (to_jsonb(OLD)->>'essay_id');
        leaves_open_player := old_status IN ('pending', 'in_progress')
            AND new_status IN ('submitted', 'graded', 'delivered')
            AND links_learner_artifact;
    ELSE
        expiry := NULLIF(to_jsonb(OLD)->>'resume_expires_at', '')::timestamptz;
        leaves_open_player := old_status = 'in_progress'
            AND (
                (TG_TABLE_NAME = 'sessions'
                 AND new_status IN ('submitted', 'completed'))
                OR (TG_TABLE_NAME IN (
                        'reading_test_attempts', 'listening_test_attempts'
                    )
                    AND new_status = 'submitted')
            );
    END IF;

    IF leaves_open_player AND (expiry IS NULL OR expiry <= now()) THEN
        RAISE EXCEPTION 'active_player_expired' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_session_terminal_mutation
    ON public.sessions;
CREATE TRIGGER trg_guard_session_terminal_mutation
    BEFORE UPDATE OF status ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_active_player_terminal_mutation();

DROP TRIGGER IF EXISTS trg_guard_reading_attempt_terminal_mutation
    ON public.reading_test_attempts;
CREATE TRIGGER trg_guard_reading_attempt_terminal_mutation
    BEFORE UPDATE OF status ON public.reading_test_attempts
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_active_player_terminal_mutation();

DROP TRIGGER IF EXISTS trg_guard_listening_attempt_terminal_mutation
    ON public.listening_test_attempts;
CREATE TRIGGER trg_guard_listening_attempt_terminal_mutation
    BEFORE UPDATE OF status ON public.listening_test_attempts
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_active_player_terminal_mutation();

DROP TRIGGER IF EXISTS trg_guard_writing_assignment_terminal_mutation
    ON public.writing_assignments;
CREATE TRIGGER trg_guard_writing_assignment_terminal_mutation
    BEFORE UPDATE OF status ON public.writing_assignments
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_active_player_terminal_mutation();

COMMENT ON COLUMN public.writing_assignments.renderer_affinity_claimed_at IS
    'Start/refresh time of the current Writing renderer lease.';
COMMENT ON COLUMN public.writing_assignments.renderer_affinity_expires_at IS
    '24-hour Writing renderer lease expiry. Assignment/draft remain intact and may be reclaimed afterwards.';

-- Preserve the backend-only ACLs after CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.fn_claim_session_renderer_affinity(uuid, uuid, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_claim_reading_attempt_renderer_affinity(uuid, uuid, text, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_claim_listening_attempt_renderer_affinity(uuid, uuid, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_claim_dictation_attempt_renderer_affinity(uuid, uuid, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_claim_writing_assignment_renderer_affinity(uuid, uuid, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_upsert_listening_answer(uuid, integer, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_insert_listening_answer_once(uuid, integer, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_reading_attempt_answer_mutation()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_speaking_question_mutation()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_speaking_response_mutation()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_dictation_attempt_answer_mutation()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_dictation_session_completion()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_writing_draft_mutation()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guard_active_player_terminal_mutation()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_set_active_player_resume_expiry()
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_claim_session_renderer_affinity(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_reading_attempt_renderer_affinity(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_listening_attempt_renderer_affinity(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_dictation_attempt_renderer_affinity(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_writing_assignment_renderer_affinity(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_upsert_listening_answer(uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_insert_listening_answer_once(uuid, integer, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
