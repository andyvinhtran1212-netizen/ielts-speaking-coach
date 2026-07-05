-- ============================================================================
-- Migration 135 — vocab_cards KP-enrichment columns (Phase B2)
-- ============================================================================
--
-- Adds the four fields the KP plan (§B2) needs on top of the existing
-- word_family (mig 112): richer word cards that cross-link to grammar and carry
-- exam-list membership.
--
--   confusable_with  [{"slug":"economical","note_vi":"…"}]        vocab→vocab
--   related_grammar  [{"slug":"word-formation-noun-suffixes","anchor":"…"}]  vocab→grammar KP
--   tested_in        ["toeic_rc","ielts_reading","thpt_qg"]        exam sources
--   lists            ["awl-sublist-1","toeic-core"]               exam-list membership
--
-- All JSONB arrays, NOT NULL DEFAULT '[]' so a card omitting them is safe and the
-- importer can always spread them. A GIN index on `lists` supports "filter cards
-- by exam list" (the flashcard-by-target-exam use case).
--
-- Each column is its OWN ALTER … ADD COLUMN statement so the schema-contract test
-- (test_vocab_cards_schema_contract) picks all four up. ADDITIVE + idempotent.
-- Apply by hand in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE vocab_cards ADD COLUMN IF NOT EXISTS confusable_with JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE vocab_cards ADD COLUMN IF NOT EXISTS related_grammar JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE vocab_cards ADD COLUMN IF NOT EXISTS tested_in       JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE vocab_cards ADD COLUMN IF NOT EXISTS lists           JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_vocab_cards_lists ON vocab_cards USING GIN (lists);
