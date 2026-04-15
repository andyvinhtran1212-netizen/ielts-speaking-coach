-- Migration 005: Add onboarding / profile columns to users table
-- Apply in: Supabase SQL Editor (Settings → SQL Editor → Run)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS target_band          DECIMAL(2,1),
  ADD COLUMN IF NOT EXISTS exam_date            DATE,
  ADD COLUMN IF NOT EXISTS self_level           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS preferred_topics     TEXT[];

-- self_level values: 'beginner' | 'intermediate' | 'upper_intermediate' | 'advanced'
COMMENT ON COLUMN users.self_level IS 'beginner | intermediate | upper_intermediate | advanced';
