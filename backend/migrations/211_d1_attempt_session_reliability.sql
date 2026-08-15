-- Migration: 211_d1_attempt_session_reliability.sql
-- Make learner-supplied D1 attempt retries idempotent and preserve the exact
-- learner-facing session payload. Historical rows remain valid: both columns
-- are nullable and existing clients may omit the idempotency key.

ALTER TABLE vocabulary_exercise_attempts
    ADD COLUMN IF NOT EXISTS client_attempt_id UUID,
    ADD COLUMN IF NOT EXISTS post_processed_at TIMESTAMPTZ;

ALTER TABLE d1_sessions
    ADD COLUMN IF NOT EXISTS exercise_snapshot JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vocab_attempts_user_client_attempt
    ON vocabulary_exercise_attempts (user_id, client_attempt_id)
    WHERE client_attempt_id IS NOT NULL;

COMMENT ON COLUMN vocabulary_exercise_attempts.client_attempt_id IS
    'Client-generated idempotency key. Reusing a key with the same answer returns the persisted attempt; reusing it for different input is rejected.';

COMMENT ON COLUMN vocabulary_exercise_attempts.post_processed_at IS
    'Set only after feedback and the optional first-attempt SRS mutation commit atomically. A null value is safe to resume after a lost HTTP acknowledgement.';

COMMENT ON COLUMN d1_sessions.exercise_snapshot IS
    'Immutable learner-facing exercise payload captured at session start so resume and completion do not depend on later pool edits.';

-- Finish one persisted attempt's post-processing in the same transaction as
-- its optional SRS mutation. Locking the attempt row makes concurrent retries
-- with the same client_attempt_id converge on one SRS increment.
CREATE OR REPLACE FUNCTION fn_finalize_d1_attempt(
    p_attempt_id       uuid,
    p_vocab_id         uuid,
    p_interval         integer,
    p_ease             real,
    p_lapse_delta      integer,
    p_last_reviewed_at timestamptz,
    p_next_review_at   timestamptz,
    p_feedback         jsonb
)
RETURNS SETOF vocabulary_exercise_attempts
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_attempt vocabulary_exercise_attempts%ROWTYPE;
BEGIN
    SELECT * INTO v_attempt
      FROM vocabulary_exercise_attempts
     WHERE id = p_attempt_id
       AND user_id = auth.uid()
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'D1 attempt not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_attempt.post_processed_at IS NOT NULL THEN
        RETURN NEXT v_attempt;
        RETURN;
    END IF;

    IF p_vocab_id IS NOT NULL THEN
        IF p_interval IS NULL OR p_ease IS NULL
           OR p_last_reviewed_at IS NULL OR p_next_review_at IS NULL THEN
            RAISE EXCEPTION 'Incomplete D1 SRS payload' USING ERRCODE = '22023';
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM user_vocabulary
             WHERE id = p_vocab_id
               AND user_id = auth.uid()
               AND NOT is_archived
               AND NOT is_pending
        ) THEN
            RAISE EXCEPTION 'D1 target vocabulary is not reviewable' USING ERRCODE = '22023';
        END IF;

        INSERT INTO flashcard_reviews AS fr (
            user_id, vocabulary_id, interval_days, ease_factor,
            review_count, lapse_count, last_reviewed_at, next_review_at, updated_at
        ) VALUES (
            auth.uid(), p_vocab_id, p_interval, p_ease,
            1, GREATEST(COALESCE(p_lapse_delta, 0), 0),
            p_last_reviewed_at, p_next_review_at, p_last_reviewed_at
        )
        ON CONFLICT (user_id, vocabulary_id) DO UPDATE SET
            interval_days    = EXCLUDED.interval_days,
            ease_factor      = EXCLUDED.ease_factor,
            review_count     = fr.review_count + 1,
            lapse_count      = fr.lapse_count + GREATEST(COALESCE(p_lapse_delta, 0), 0),
            last_reviewed_at = EXCLUDED.last_reviewed_at,
            next_review_at   = EXCLUDED.next_review_at,
            updated_at       = EXCLUDED.updated_at;
    END IF;

    UPDATE vocabulary_exercise_attempts
       SET feedback = COALESCE(p_feedback, '{}'::jsonb),
           post_processed_at = NOW()
     WHERE id = p_attempt_id
       AND user_id = auth.uid()
     RETURNING * INTO v_attempt;

    RETURN NEXT v_attempt;
END;
$$;

REVOKE ALL ON FUNCTION fn_finalize_d1_attempt(
    uuid, uuid, integer, real, integer, timestamptz, timestamptz, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_finalize_d1_attempt(
    uuid, uuid, integer, real, integer, timestamptz, timestamptz, jsonb
) TO authenticated;

COMMENT ON FUNCTION fn_finalize_d1_attempt IS
    'Atomically applies at most one optional SRS update and seals a D1 attempt post-processing receipt; safe for lost-ACK retries.';

-- Rollback (manual):
-- DROP INDEX IF EXISTS uq_vocab_attempts_user_client_attempt;
-- DROP FUNCTION IF EXISTS fn_finalize_d1_attempt(uuid, uuid, integer, real, integer, timestamptz, timestamptz, jsonb);
-- ALTER TABLE vocabulary_exercise_attempts DROP COLUMN IF EXISTS post_processed_at;
-- ALTER TABLE vocabulary_exercise_attempts DROP COLUMN IF EXISTS client_attempt_id;
-- ALTER TABLE d1_sessions DROP COLUMN IF EXISTS exercise_snapshot;
