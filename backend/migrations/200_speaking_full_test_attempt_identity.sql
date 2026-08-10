-- Migration: 200_speaking_full_test_attempt_identity.sql
-- Give every Speaking Full Test chain a canonical server-owned identity.
--
-- Existing standalone rows cannot be reconstructed into reliable chains from
-- database state alone, so each is backfilled with its own UUID. This fails
-- closed for an already-open legacy chain instead of allowing unrelated parts
-- to be combined. New Part 2/3 rows inherit the predecessor's identifier in
-- POST /sessions before they are returned to the learner.

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS full_test_attempt_id UUID;

UPDATE sessions
SET full_test_attempt_id = gen_random_uuid()
WHERE mode = 'test_full'
  AND full_test_attempt_id IS NULL;

CREATE OR REPLACE FUNCTION set_speaking_full_test_attempt_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.mode = 'test_full' AND NEW.full_test_attempt_id IS NULL THEN
        NEW.full_test_attempt_id := gen_random_uuid();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_full_test_attempt_id ON sessions;
CREATE TRIGGER trg_sessions_full_test_attempt_id
    BEFORE INSERT OR UPDATE OF mode, full_test_attempt_id ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION set_speaking_full_test_attempt_id();

CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_full_test_attempt_part
    ON sessions (full_test_attempt_id, part)
    WHERE mode = 'test_full' AND full_test_attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_full_test_attempt_id
    ON sessions (full_test_attempt_id)
    WHERE full_test_attempt_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sessions_full_test_attempt_required'
          AND conrelid = 'sessions'::regclass
    ) THEN
        ALTER TABLE sessions
            ADD CONSTRAINT sessions_full_test_attempt_required
            CHECK (mode <> 'test_full' OR full_test_attempt_id IS NOT NULL)
            NOT VALID;
    END IF;
END;
$$;

ALTER TABLE sessions
    VALIDATE CONSTRAINT sessions_full_test_attempt_required;

COMMENT ON COLUMN sessions.full_test_attempt_id IS
    'Server-owned identity shared by exactly one Speaking Full Test Part 1/2/3 chain.';
