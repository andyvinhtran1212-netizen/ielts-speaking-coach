-- 029_user_vocab_ipa_example.sql
-- Phase D Wave 2 — flashcard rich content.
--
-- Adds two AI-generated, display-only fields to user_vocabulary:
--   * ipa              — British English IPA pronunciation (e.g. "/ˈmɪtɪɡeɪt/")
--   * example_sentence — clean, blank-free example sentence at IELTS Band 7+
--
-- These are deliberately separate from `context_sentence`, which captures the
-- learner's own (potentially imperfect) speech.  The flashcard back face needs
-- a vetted reference example; reusing context_sentence taught wrong English.
--
-- No index — both fields are display-only, never filtered/sorted on.  Backfill
-- is handled by a Gemini batch job (see services/vocab_enrichment.py and
-- POST /admin/vocab/backfill-enrichment); the migration itself only widens
-- the schema.  Phase B's vocab extractor populates both fields on new inserts
-- going forward.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS lets re-application skip.

ALTER TABLE user_vocabulary
  ADD COLUMN IF NOT EXISTS ipa              VARCHAR(100),
  ADD COLUMN IF NOT EXISTS example_sentence TEXT;


-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (commented out, run manually if needed):
-- ────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE user_vocabulary
--   DROP COLUMN IF EXISTS example_sentence,
--   DROP COLUMN IF EXISTS ipa;
