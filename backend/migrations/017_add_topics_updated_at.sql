-- Migration: 017_add_topics_updated_at.sql
-- Purpose: add a durable updated_at timestamp for admin topic management.

ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE topics
SET updated_at = COALESCE(updated_at, last_rotated_at, NOW())
WHERE updated_at IS NULL;

