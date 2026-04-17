-- Migration 011: Fix duration_seconds column type (INTEGER → FLOAT)
-- Run once in the Supabase SQL editor.
--
-- Problem:
--   The duration_seconds column was created as INTEGER (likely via the Supabase
--   Table Editor or an earlier implicit schema). Migration 010 used
--   ADD COLUMN IF NOT EXISTS, so it silently skipped the existing INTEGER column.
--   Every grading.py save then failed with:
--     "invalid input syntax for type integer: '12.66'"
--   causing ALL responses to not be persisted — empty result pages, missing dashboard data.
--
-- Fix:
--   Cast the column to FLOAT (DOUBLE PRECISION). Existing integer values (0, 30, etc.)
--   are promoted losslessly. NULL rows remain NULL.

ALTER TABLE responses
  ALTER COLUMN duration_seconds TYPE FLOAT USING duration_seconds::FLOAT;
