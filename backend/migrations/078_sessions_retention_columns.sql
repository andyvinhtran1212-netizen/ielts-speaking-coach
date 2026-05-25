-- Migration: 078_sessions_retention_columns.sql
-- Sprint 16.2 — Storage lifecycle, Direction A part 1 (soft-hide schema).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Adds retention timestamps to `sessions`. Sprint 16.2 only READS these lazily
-- (read-time expiry compute in services/retention.py). The persistent sweep that
-- WRITES hidden_at/purged_at and scrubs audio + heavy response columns ships in
-- Sprint 16.4 — this migration just lays the schema + a grace backfill.
--
--   last_accessed_at — refreshed on GET /sessions/{id}; second retention timer
--   hidden_at        — set by the 16.4 sweep when soft-hidden  (NULL until then)
--   purged_at        — set by the 16.4 sweep when audio/heavy cols scrubbed
--
-- (The session-age anchor is the existing `started_at` column — there is no
--  `created_at` on sessions.)
--
-- Backfill grace (Discovery Risk #3): every existing session is already older
-- than 7 days, so without a grace stamp they would all vanish from the history
-- list on the first read after deploy. Seed last_accessed_at = NOW() so existing
-- sessions stay visible for a fresh 7-day window.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded backfill (only NULL rows) +
-- CREATE INDEX IF NOT EXISTS.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hidden_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purged_at        TIMESTAMPTZ;

-- Grace backfill — only stamps rows not yet stamped (re-running is a no-op).
UPDATE sessions SET last_accessed_at = NOW() WHERE last_accessed_at IS NULL;

-- Partial index supports the soft-hide list filter and the future 16.4 sweep scan.
CREATE INDEX IF NOT EXISTS idx_sessions_retention
  ON sessions (last_accessed_at, started_at)
  WHERE hidden_at IS NULL;

-- ── Reverse (run manually if needed) ───────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_sessions_retention;
-- ALTER TABLE sessions
--   DROP COLUMN IF EXISTS purged_at,
--   DROP COLUMN IF EXISTS hidden_at,
--   DROP COLUMN IF EXISTS last_accessed_at;
