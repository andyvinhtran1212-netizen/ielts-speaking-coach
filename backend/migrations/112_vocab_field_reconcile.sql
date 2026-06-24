-- ============================================================================
-- Migration 112 — vocab_cards field reconcile (close the audit gaps)
-- ============================================================================
--
-- Two curated fields the upload format promised but the schema lacked (the audit
-- found them GHOST — authored but silently dropped):
--
--   definition_vi  — a CURATED Vietnamese definition. The card renders it in the
--                    VN line, falling back to gloss_vi (the body's first paragraph)
--                    when absent, so existing rows (NULL) keep their gloss line.
--   word_family    — morphological family (e.g. ["metropolitan (adj)","metro (n)"]),
--                    rendered under "Họ từ" — DISTINCT from related_words, which
--                    now correctly renders under "Từ liên quan".
--
-- ADDITIVE / nullable-or-empty: existing rows get NULL / '[]' → nothing breaks.
-- Apply by hand in the Supabase SQL editor BEFORE merge.
-- ============================================================================

ALTER TABLE vocab_cards ADD COLUMN IF NOT EXISTS definition_vi TEXT;
ALTER TABLE vocab_cards ADD COLUMN IF NOT EXISTS word_family   JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── Reverse (run manually if needed) ─────────────────────────────────────────
-- ALTER TABLE vocab_cards DROP COLUMN IF EXISTS definition_vi;
-- ALTER TABLE vocab_cards DROP COLUMN IF EXISTS word_family;
