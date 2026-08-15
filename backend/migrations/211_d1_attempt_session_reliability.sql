-- Migration: 211_d1_attempt_session_reliability.sql
-- Make learner-supplied D1 attempt retries idempotent and preserve the exact
-- learner-facing session payload. Historical rows remain valid: both columns
-- are nullable and existing clients may omit the idempotency key.

ALTER TABLE vocabulary_exercise_attempts
    ADD COLUMN IF NOT EXISTS client_attempt_id UUID;

ALTER TABLE d1_sessions
    ADD COLUMN IF NOT EXISTS exercise_snapshot JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vocab_attempts_user_client_attempt
    ON vocabulary_exercise_attempts (user_id, client_attempt_id)
    WHERE client_attempt_id IS NOT NULL;

COMMENT ON COLUMN vocabulary_exercise_attempts.client_attempt_id IS
    'Client-generated idempotency key. Reusing a key with the same answer returns the persisted attempt; reusing it for different input is rejected.';

COMMENT ON COLUMN d1_sessions.exercise_snapshot IS
    'Immutable learner-facing exercise payload captured at session start so resume and completion do not depend on later pool edits.';

-- Rollback (manual):
-- DROP INDEX IF EXISTS uq_vocab_attempts_user_client_attempt;
-- ALTER TABLE vocabulary_exercise_attempts DROP COLUMN IF EXISTS client_attempt_id;
-- ALTER TABLE d1_sessions DROP COLUMN IF EXISTS exercise_snapshot;
