-- Migration: 064_listening_render_placeholders.sql
-- Sprint 13.3.1 — race-condition hotfix.
--
-- Background: Sprint 13.3 ships POST /admin/listening/render. The
-- frontend redirects to content-detail.html?id=<content_id>
-- immediately. The renderer (services/listening_renderer.py) runs as a
-- FastAPI BackgroundTask which only INSERTs the listening_content row
-- *after* ElevenLabs returns (~10-30s). Result: the detail page
-- 404'd because the row didn't exist yet.
--
-- Fix: POST /render INSERTs a placeholder row synchronously (with
-- audio_storage_path=NULL, duration=0, size=0) and the BackgroundTask
-- UPDATEs that same row when the render completes. The frontend
-- treats `audio_storage_path IS NULL` as the canonical "rendering"
-- sentinel.
--
-- This migration relaxes three constraints to allow placeholder rows:
--   1. listening_content.audio_storage_path: NOT NULL → NULL allowed
--   2. listening_content.audio_duration_seconds: CHECK > 0 → CHECK >= 0
--   3. listening_content.audio_size_bytes: CHECK > 0 → CHECK >= 0
--
-- All three relaxations are backward-compatible: existing rows
-- (Sprint 11.x and Sprint 13.2 uploads) all satisfy the looser
-- predicates, and the router still rejects user-visible state with
-- the same 422 message the validator surfaces. A placeholder row is
-- only created via POST /render, never via /upload or /upload/bulk.

ALTER TABLE listening_content
    ALTER COLUMN audio_storage_path DROP NOT NULL;

ALTER TABLE listening_content
    DROP CONSTRAINT IF EXISTS listening_content_audio_duration_seconds_check;

ALTER TABLE listening_content
    ADD CONSTRAINT listening_content_audio_duration_seconds_check
        CHECK (audio_duration_seconds >= 0);

ALTER TABLE listening_content
    DROP CONSTRAINT IF EXISTS listening_content_audio_size_bytes_check;

ALTER TABLE listening_content
    ADD CONSTRAINT listening_content_audio_size_bytes_check
        CHECK (audio_size_bytes >= 0);

COMMENT ON COLUMN listening_content.audio_storage_path IS
    'Bucket-relative path. NULL indicates an AI render in progress '
    '(source_type=ai_elevenlabs only) — the BackgroundTask populates '
    'this when ElevenLabs returns. The router-side validator gates '
    'user-facing reads; user routes never serve rows with NULL path.';
