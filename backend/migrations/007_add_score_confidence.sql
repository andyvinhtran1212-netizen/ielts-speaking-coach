-- Migration 007: Add score_confidence column to responses
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Purpose:
--   Stores a single consolidated confidence label (high / medium / low) that
--   reflects the overall trustworthiness of the AI band scores for a response.
--   Computed server-side in grading.py from transcript reliability + audio duration.
--   Exposed to the frontend so it can surface appropriate hedging language to users.
--
-- Inputs to computation (see grading.py _compute_score_confidence):
--   transcript_reliability (from migration 006) + audio duration_seconds
--
-- Values:
--   "high"   — reliable transcript + normal speaking duration (20–180s)
--   "medium" — medium reliability OR unusual duration
--   "low"    — low reliability OR very short audio (< 10s)

ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS score_confidence TEXT;

-- Index for admin queries and monitoring
CREATE INDEX IF NOT EXISTS idx_responses_score_confidence
  ON responses (score_confidence)
  WHERE score_confidence IS NOT NULL;
