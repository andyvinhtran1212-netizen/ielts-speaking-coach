-- Migration: 058_listening_alignment.sql
-- Sprint 11.4 — ElevenLabs word-level alignment (DEBT-LISTENING-MODULE 4/5
-- bonus). Sprint 11.3.1 char-proportional timestamps drift ±0.5-1s per
-- segment — user-visible when a segment audio starts mid-word. The
-- ElevenLabs `/v1/text-to-speech/{voice_id}/with-timestamps` endpoint
-- returns per-character start/end times; persisting that JSON lets the
-- segment editor compute precise sentence boundaries by looking up the
-- character index of each sentence-end punctuation in the alignment.
--
-- Shape (verbatim from ElevenLabs response — Sprint 11.0 §3C reference):
--   {
--     "characters":                       ["G", "o", "o", "d", " ", ...],
--     "character_start_times_seconds":    [0.0, 0.046, 0.092, ...],
--     "character_end_times_seconds":      [0.046, 0.092, 0.138, ...]
--   }
--
-- NULL by default — admin-uploaded MP3s + Sprint 11.1/11.2 renders
-- predate the with-timestamps switch and have no alignment. The editor
-- falls back to char-proportional when this column is NULL.
--
-- Idempotent.


ALTER TABLE listening_content
    ADD COLUMN IF NOT EXISTS alignment_data JSONB NULL;

COMMENT ON COLUMN listening_content.alignment_data IS
    'Sprint 11.4 — ElevenLabs /with-timestamps per-character alignment. '
    'NULL for legacy renders + admin MP3 uploads (editor falls back to '
    'char-proportional). Shape: '
    '{characters[], character_start_times_seconds[], character_end_times_seconds[]}.';


-- payload JSONB already exists on listening_exercises (created in
-- migration 056). Sprint 11.4 reuses it for gist + true_false:
--   gist payload:        {"prompt_text": "...", "model_answer": "...",
--                          "rubric_keywords": ["..."]}
--   true_false payload:  {"statements": [{"idx": 0, "text": "...",
--                                          "answer": "T"|"F"|"NG"}]}
-- No DDL change needed — validation lives in the router (Sprint 11.3
-- precedent: per-shape rules can't be cleanly expressed as CHECK
-- constraints).
