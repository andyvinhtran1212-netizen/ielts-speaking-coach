-- Migration: 225_allow_admitted_speaking_grade_after_submit.sql
--
-- A Speaking grading request is admitted while its parent session is still
-- in_progress, then spends 15-30 seconds in STT/grading before it persists the
-- response. During that window finalize-full-test may atomically move the
-- parent to submitted. Migration 224 rejected that already-admitted INSERT,
-- which could make the background finalizer mark a valid part analysis_failed.
--
-- New requests remain closed by require_resume_active() in the router because
-- submitted is not a resumable state. The DB guard only lets the in-flight,
-- already-admitted response finish while the original resume TTL is unexpired.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_guard_speaking_response_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE parent_status text; parent_expiry timestamptz;
BEGIN
    SELECT status, resume_expires_at INTO parent_status, parent_expiry
      FROM public.sessions WHERE id = NEW.session_id FOR UPDATE;

    -- INSERTs normally belong to an open player. A submitted parent is also
    -- accepted until the same hard TTL so a request admitted before
    -- finalize-full-test can persist after that concurrent status transition.
    -- The HTTP router still rejects every request that starts after submit.
    IF TG_OP = 'INSERT' THEN
        IF (
              parent_status IS DISTINCT FROM 'in_progress'
              AND parent_status IS DISTINCT FROM 'submitted'
           )
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

REVOKE ALL ON FUNCTION public.fn_guard_speaking_response_mutation()
    FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_guard_speaking_response_mutation() IS
    'Guards learner response mutations by the 24-hour player TTL; permits an admitted insert to finish after concurrent full-test submission.';

NOTIFY pgrst, 'reload schema';

COMMIT;
