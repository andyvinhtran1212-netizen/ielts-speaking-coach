-- Migration 006: Add transcript reliability and assessment confidence columns to responses
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Purpose:
--   Stores per-response STT metadata so the grading pipeline can be audited
--   and confidence-aware feedback can be surfaced to users and admins.
--
-- New columns:
--   raw_transcript_text         — verbatim transcript copy (reserved for future cleaning pass)
--   transcript_model            — model used for STT, e.g. "whisper-1"
--   transcript_reliability      — "high" | "medium" | "low"
--   transcript_reliability_score — 0.0–1.0 weighted reliability score
--   transcript_logprobs         — JSONB array of per-segment metadata (start, end, avg_logprob, no_speech_prob)
--   assessment_confidence       — "high" | "medium" | "low" (same as reliability; exposed to frontend)

ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS raw_transcript_text          TEXT,
  ADD COLUMN IF NOT EXISTS transcript_model             TEXT,
  ADD COLUMN IF NOT EXISTS transcript_reliability       TEXT,
  ADD COLUMN IF NOT EXISTS transcript_reliability_score FLOAT,
  ADD COLUMN IF NOT EXISTS transcript_logprobs          JSONB,
  ADD COLUMN IF NOT EXISTS assessment_confidence        TEXT;

-- Index for admin queries filtering by reliability tier
CREATE INDEX IF NOT EXISTS idx_responses_transcript_reliability
  ON responses (transcript_reliability)
  WHERE transcript_reliability IS NOT NULL;
