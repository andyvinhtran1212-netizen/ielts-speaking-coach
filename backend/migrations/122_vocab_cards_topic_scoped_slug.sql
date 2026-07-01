-- 122_vocab_cards_topic_scoped_slug.sql
-- Let the SAME headword (slug) live in MULTIPLE categories/topics at once.
--
-- Before: vocab_cards.slug was GLOBALLY UNIQUE (mig 110). Because the importer
-- upserts by slug, uploading a word that already existed under another category
-- UPDATED (moved) that single row instead of adding it to the new topic — so the
-- word silently vanished from its original topic and the library count never
-- grew. Scope identity to (category, slug) so a word can belong to several topics
-- simultaneously; the importer now upserts by (category, slug).
--
-- Safe & idempotent: while slug was globally unique, every (category, slug) pair
-- was already unique too, so adding the composite constraint can never conflict
-- with existing rows. category is NOT NULL (mig 110), so the pair is well-formed.

ALTER TABLE vocab_cards DROP CONSTRAINT IF EXISTS vocab_cards_slug_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vocab_cards_category_slug_key'
    ) THEN
        ALTER TABLE vocab_cards
            ADD CONSTRAINT vocab_cards_category_slug_key UNIQUE (category, slug);
    END IF;
END $$;
