-- Migration 020: Vocab Bank dogfood improvements
-- Adds evidence_substring, suggestion, definition_en columns to user_vocabulary.
--
-- Rollback:
--   ALTER TABLE user_vocabulary DROP COLUMN IF EXISTS evidence_substring;
--   ALTER TABLE user_vocabulary DROP COLUMN IF EXISTS suggestion;
--   ALTER TABLE user_vocabulary DROP COLUMN IF EXISTS definition_en;

ALTER TABLE user_vocabulary
  ADD COLUMN IF NOT EXISTS evidence_substring TEXT,
  ADD COLUMN IF NOT EXISTS suggestion         TEXT,
  ADD COLUMN IF NOT EXISTS definition_en      TEXT;

COMMENT ON COLUMN user_vocabulary.evidence_substring IS
  'Verbatim substring from transcript proving headword presence (Guard 8 source of truth)';
COMMENT ON COLUMN user_vocabulary.suggestion IS
  'Corrected/better phrasing for needs_review items';
COMMENT ON COLUMN user_vocabulary.definition_en IS
  'Concise English definition, max ~10 words';
