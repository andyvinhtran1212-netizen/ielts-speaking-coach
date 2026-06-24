-- ============================================================================
-- Migration 111 — vocab_cards.syllables (Slice-2: orthographic stress specimen)
-- ============================================================================
--
-- Optional orthographic syllabification for the stress specimen, e.g.
-- "me-TROP-o-lis" (hyphen-separated; the UPPERCASE token is the primary stress).
-- When present the card renders an orthographic specimen (me·TROP·o·lis,
-- "trọng âm 2"); when absent it falls back to the IPA-derived parser (#554).
--
-- NULLABLE / no default — existing rows stay NULL and render via the IPA fallback
-- (nothing breaks). The new content batch can carry `syllables:` in frontmatter
-- so it lands directly without a re-upload.
--
-- ADDITIVE. Apply by hand in the Supabase SQL editor BEFORE merge.
-- ============================================================================

ALTER TABLE vocab_cards ADD COLUMN IF NOT EXISTS syllables TEXT;

-- ── Reverse (run manually if needed) ─────────────────────────────────────────
-- ALTER TABLE vocab_cards DROP COLUMN IF EXISTS syllables;
