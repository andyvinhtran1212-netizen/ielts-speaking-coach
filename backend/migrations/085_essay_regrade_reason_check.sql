-- Migration: 085_essay_regrade_reason_check.sql
-- Sprint 19.5 — make the regrade-reason length contract canonical at the DB
-- layer (Codex audit follow-through).
--
-- Migration 084 documented "reason 50–500 (API-enforced)" but added no DB
-- CHECK, so a direct insert (admin script, debug, future migration) could
-- bypass the Pydantic bound. This adds the constraint. The table is new in
-- 084 so no historical rows can violate it; the guarded DO block makes the
-- ADD idempotent (Postgres has no ADD CONSTRAINT IF NOT EXISTS).

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'essay_regrade_reason_length'
          AND conrelid = 'essay_regrade_requests'::regclass
    ) THEN
        ALTER TABLE essay_regrade_requests
            ADD CONSTRAINT essay_regrade_reason_length
            CHECK (char_length(reason) BETWEEN 50 AND 500);
    END IF;
END$$;

COMMENT ON CONSTRAINT essay_regrade_reason_length ON essay_regrade_requests IS
    'Sprint 19.5 — reason must be 50–500 chars (was API-only in 084). Rollback: DROP CONSTRAINT essay_regrade_reason_length.';
