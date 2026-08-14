-- Migration: 208_listening_exercise_block_identity.sql
-- Purpose: make the existing logical exercise-block identity enforceable so
-- concurrent admin editors cannot create two rows for the same content/type/order.
-- Multiple blocks per type remain valid through distinct order_num values.
-- order_num is NOT NULL in migration 056. Do not silently renumber duplicates:
-- their semantic order must be resolved by an admin before this constraint lands.
-- Production preflight on 2026-08-14: 666 rows, 0 NULL updated_at values, and
-- 0 duplicate identity groups. Plain CREATE UNIQUE INDEX is intentional: the
-- migration helper may execute the file transactionally, where CONCURRENTLY is
-- invalid, and this table size keeps the one-time lock bounded.
-- Apply: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/208_listening_exercise_block_identity.sql
-- Rollback: DROP INDEX IF EXISTS idx_listening_exercises_block_identity;
-- Keep the updated_at DEFAULT / NOT NULL invariant: migration 056 owns that
-- original schema contract, and the statements below only reassert it.
-- Rollout order: apply this migration before deploying the backend/frontend
-- changes that expose expected_absent block creation. The unique index is the
-- atomic backstop between the preflight SELECT and INSERT.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- Reassert the version-token invariant for databases created before the full
-- migration chain was standardized. Migration 056 already defines this shape;
-- these statements are idempotent and make this concurrency migration complete.
ALTER TABLE listening_exercises
    ALTER COLUMN updated_at SET DEFAULT NOW();

UPDATE listening_exercises
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;

ALTER TABLE listening_exercises
    ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM listening_exercises
        GROUP BY content_id, exercise_type, order_num
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce listening exercise block identity: duplicate content/type/order rows exist';
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_listening_exercises_block_identity
    ON listening_exercises (content_id, exercise_type, order_num);
