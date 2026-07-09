-- ============================================================================
-- Migration 140 — seed the grammar-for-reading content topic
-- ============================================================================
-- `grammar-for-reading` is a NEW grammar category (14 decode articles, shipped
-- in #663) added AFTER the grammar-topic seed (mig 120). Its content_topics row
-- was therefore never created, so import_grammar_banks.grammar_topic_map() has no
-- topic_id for it — every `G-grammar-for-reading-*` quiz bank would be SKIPPED on
-- import (category_of resolves, topic_id does not). This seeds the missing row so
-- the grammar-for-reading Quick-Check banks can import.
--
-- Slug mirrors the content/grammar-for-reading/ directory; title matches
-- grammar_content._prettify ('grammar-for-reading' → 'Grammar For Reading').
-- Idempotent (ON CONFLICT DO NOTHING) — safe to re-run. No schema change.
--
-- ADDITIVE. Apply by hand BEFORE merge.
-- ============================================================================

INSERT INTO content_topics (slug, skill_area, title) VALUES
    ('grammar-for-reading', 'grammar', 'Grammar For Reading')
ON CONFLICT (skill_area, slug) DO NOTHING;

-- ── Reverse (run manually if needed) ────────────────────────────────────────
-- DELETE FROM content_topics WHERE skill_area = 'grammar' AND slug = 'grammar-for-reading';
