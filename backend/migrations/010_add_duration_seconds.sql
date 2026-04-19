-- Migration 010: add duration_seconds to responses
-- Run once in the Supabase SQL editor.
--
-- Purpose:
--   Stores the audio duration (from Whisper STT) directly on each response row.
--   Previously this was only embedded in the feedback JSON, making it invisible
--   when grading failed (feedback = null).  This column makes it always queryable.
--
-- Applies to: all parts, but most important for Part 2 (long-turn, ~2 min).

ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS duration_seconds FLOAT;
