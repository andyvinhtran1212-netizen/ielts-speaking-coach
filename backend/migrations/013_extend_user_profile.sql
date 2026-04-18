-- Migration 013: Extend users table with display profile fields
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS timezone            VARCHAR(50)  DEFAULT 'Asia/Ho_Chi_Minh',
  ADD COLUMN IF NOT EXISTS weekly_goal         INTEGER      DEFAULT 5,
  ADD COLUMN IF NOT EXISTS notification_email  BOOLEAN      DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS joined_at           TIMESTAMPTZ;

-- Back-fill joined_at from created_at where it exists
UPDATE users SET joined_at = created_at WHERE joined_at IS NULL AND created_at IS NOT NULL;

COMMENT ON COLUMN users.weekly_goal IS 'Target number of practice sessions per week, set by user (1–14)';
COMMENT ON COLUMN users.timezone    IS 'IANA timezone string, e.g. Asia/Ho_Chi_Minh';
