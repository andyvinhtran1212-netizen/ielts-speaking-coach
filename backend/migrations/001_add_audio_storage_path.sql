-- Migration 001: add audio_storage_path to responses
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Purpose:
--   Stores the bucket-relative path for each uploaded audio file so the backend
--   can generate short-lived signed URLs instead of exposing the raw public URL.
--   Column is nullable — existing rows without audio will simply remain NULL.
--
-- Bucket layout (audio-responses):
--   <user_id>/<session_id>/<question_id><ext>
--   e.g. a1b2.../c3d4.../e5f6...webm

ALTER TABLE responses
  ADD COLUMN IF NOT EXISTS audio_storage_path TEXT;

-- Optional: index for fast lookup (not required — queries always filter by session_id first)
-- CREATE INDEX IF NOT EXISTS responses_audio_storage_path_idx ON responses (audio_storage_path);
