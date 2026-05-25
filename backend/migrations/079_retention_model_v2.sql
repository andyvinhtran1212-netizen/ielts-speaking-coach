-- Migration: 079_retention_model_v2.sql
-- Sprint 16.2.1 — Storage lifecycle, retention model v2 (Andy 2026-05-25 pivot).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Decouples the single-threshold v1 model (078: hidden_at @7d, purged_at @30d)
-- into two independent retention clocks:
--   audio_purged_at    — set by the 16.4 sweep when the recording is deleted (15d)
--   content_purged_at  — set by the 16.4 sweep when feedback/content is scrubbed (60d)
--                        (also the visibility boundary: content-purged ⇒ hidden)
--
-- The v1 columns hidden_at and purged_at were never written (the sweep job ships
-- in 16.4), so dropping them is LOSSLESS — pure schema reshape, no data loss.
-- last_accessed_at (the activity timer + its 078 grace backfill) is retained.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP COLUMN IF EXISTS + CREATE/DROP
-- INDEX IF [NOT] EXISTS.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS audio_purged_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS content_purged_at TIMESTAMPTZ,
  DROP COLUMN IF EXISTS hidden_at,
  DROP COLUMN IF EXISTS purged_at;

-- Replace the 078 partial index (was keyed on hidden_at) with a v2 one keyed on
-- content_purged_at — supports the soft-hide list filter + the 16.4 sweep scan.
DROP INDEX IF EXISTS idx_sessions_retention;
CREATE INDEX IF NOT EXISTS idx_sessions_retention_v2
  ON sessions (last_accessed_at, started_at)
  WHERE content_purged_at IS NULL;

-- ── Reverse (run manually if needed) ───────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_sessions_retention_v2;
-- CREATE INDEX IF NOT EXISTS idx_sessions_retention
--   ON sessions (last_accessed_at, started_at) WHERE hidden_at IS NULL;
-- ALTER TABLE sessions
--   ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ,
--   ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ,
--   DROP COLUMN IF EXISTS content_purged_at,
--   DROP COLUMN IF EXISTS audio_purged_at;
