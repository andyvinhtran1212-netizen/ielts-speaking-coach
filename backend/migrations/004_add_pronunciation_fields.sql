-- Migration 002: Add pronunciation assessment columns to responses table
-- Apply in: Supabase SQL Editor (Settings → SQL Editor → Run)

ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS pronunciation_score        FLOAT,
  ADD COLUMN IF NOT EXISTS pronunciation_fluency      FLOAT,
  ADD COLUMN IF NOT EXISTS pronunciation_accuracy     FLOAT,
  ADD COLUMN IF NOT EXISTS pronunciation_completeness FLOAT,
  ADD COLUMN IF NOT EXISTS pronunciation_status       TEXT,
  ADD COLUMN IF NOT EXISTS pronunciation_payload      JSONB,
  ADD COLUMN IF NOT EXISTS pronunciation_provider     TEXT,
  ADD COLUMN IF NOT EXISTS pronunciation_locale       TEXT;

-- Optional index for admin queries filtering by assessment status
CREATE INDEX IF NOT EXISTS idx_responses_pronunciation_status
  ON responses (pronunciation_status)
  WHERE pronunciation_status IS NOT NULL;
