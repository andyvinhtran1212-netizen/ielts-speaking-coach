-- ============================================================================
-- Migration 110 — vocab_cards (M3 content pipeline, Slice-1)
-- ============================================================================
--
-- Admin-runtime upload needs content to PERSIST (Railway fs is ephemeral), so
-- the vocabulary word library moves from in-memory markdown (content_vocab/**)
-- into this table. vocab_content.vocab_service reads it (markdown stays as a
-- fallback for one release — G3). The 20 existing words are migrated in by
-- scripts/migrate_vocab_to_cards.py (idempotent, upsert-by-slug).
--
-- Audio columns (audio_headword/audio_example/audio_status) are created NULLABLE
-- now so Slice-2 (TTS pre-gen → vocab-audio bucket → stamp) needs 0 migration.
--
-- ADDITIVE. Apply by hand in the Supabase SQL editor BEFORE merge.
-- ============================================================================

CREATE TABLE IF NOT EXISTS vocab_cards (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity (the importer upserts by slug; all three are required).
    slug            TEXT NOT NULL UNIQUE,
    headword        TEXT NOT NULL,
    category        TEXT NOT NULL,

    -- Scalar frontmatter.
    level           TEXT,
    part_of_speech  TEXT,
    pronunciation   TEXT,
    definition_en   TEXT,
    gloss_vi        TEXT,           -- VN gloss; importer extracts body 1st paragraph (single source)
    example         TEXT,
    register        TEXT,
    common_error    TEXT,
    memory_hook     TEXT,
    source          TEXT,
    "group"         TEXT,           -- reserved word → quoted

    -- List frontmatter (JSONB arrays, default empty so a missing key is safe).
    synonyms        JSONB NOT NULL DEFAULT '[]'::jsonb,
    antonyms        JSONB NOT NULL DEFAULT '[]'::jsonb,
    collocations    JSONB NOT NULL DEFAULT '[]'::jsonb,
    related_words   JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Rendered body (markdown → html at import; mirrors the in-memory "html").
    body_html       TEXT,

    -- Audio (Slice-2; nullable now).
    audio_headword  TEXT,
    audio_example   TEXT,
    audio_status    TEXT NOT NULL DEFAULT 'pending',

    import_batch_id TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vocab_cards_category ON vocab_cards (category);
CREATE INDEX IF NOT EXISTS idx_vocab_cards_updated_at ON vocab_cards (updated_at DESC);

-- updated_at auto-bump (reuses the project-wide trigger fn from mig 033).
DROP TRIGGER IF EXISTS trg_vocab_cards_updated_at ON vocab_cards;
CREATE TRIGGER trg_vocab_cards_updated_at
    BEFORE UPDATE ON vocab_cards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: SELECT public (the library is public content); writes are service-role
-- only (no write policy → only the service-role key, which bypasses RLS, writes).
ALTER TABLE vocab_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vocab_cards_public_read ON vocab_cards;
CREATE POLICY vocab_cards_public_read ON vocab_cards
    FOR SELECT USING (true);

-- ── Reverse (run manually if needed) ─────────────────────────────────────────
-- DROP TABLE IF EXISTS vocab_cards;
