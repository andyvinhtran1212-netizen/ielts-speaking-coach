-- Migration: 066_listening_content_test_link.sql
-- Sprint 13.4 — extend listening_content with test bundle FK + section
-- ordinal + self-ref parent + raw metadata bag. Also extend source_type
-- CHECK to allow 'test_section' (this sprint) + 'exercise_snippet'
-- (Sprint 13.6 audio cutter). Forward-only.

ALTER TABLE listening_content
    ADD COLUMN IF NOT EXISTS test_id            UUID
        REFERENCES listening_tests(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS section_num        INTEGER
        CHECK (section_num >= 1 AND section_num <= 4),
    ADD COLUMN IF NOT EXISTS parent_content_id  UUID
        REFERENCES listening_content(id) ON DELETE SET NULL,
    -- Raw source metadata bag (speakers, register, raw_transcript with
    -- markers preserved, narrator_intro, context, word_count, etc.).
    -- Sprint 13.4 convert flow writes this so the cleaned transcript
    -- stays user-facing while admins retain the unstripped source.
    ADD COLUMN IF NOT EXISTS metadata           JSONB
        NOT NULL DEFAULT '{}'::jsonb;

-- Extend source_type CHECK constraint to accept the two new variants.
-- Legacy values ('ai_elevenlabs', 'upload_mp3', 'curated_external')
-- remain valid — existing rows are unaffected.
ALTER TABLE listening_content
    DROP CONSTRAINT IF EXISTS listening_content_source_type_check;

ALTER TABLE listening_content
    ADD CONSTRAINT listening_content_source_type_check
    CHECK (source_type IN (
        'ai_elevenlabs',
        'upload_mp3',
        'curated_external',
        'test_section',
        'exercise_snippet'
    ));

CREATE INDEX IF NOT EXISTS idx_listening_content_test
    ON listening_content (test_id)
    WHERE test_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listening_content_parent
    ON listening_content (parent_content_id)
    WHERE parent_content_id IS NOT NULL;

COMMENT ON COLUMN listening_content.test_id IS
    'FK to listening_tests. Set ONLY when source_type=test_section (Sprint 13.4) '
    'or exercise_snippet derived from a test (Sprint 13.6). NULL for standalone '
    'uploads/renders. ON DELETE CASCADE — deleting the parent test removes '
    'its 4 section rows.';

COMMENT ON COLUMN listening_content.section_num IS
    'Section ordinal 1-4 within a Cambridge test. Set when source_type=test_section. '
    'NULL otherwise.';

COMMENT ON COLUMN listening_content.parent_content_id IS
    'FK self-ref. Set when source_type=exercise_snippet (Sprint 13.6) — points '
    'back to the source test_section row (or any other content_id for future '
    'flexibility). NULL otherwise.';

COMMENT ON COLUMN listening_content.metadata IS
    'Raw source metadata bag (speakers, register, raw_transcript with markers, '
    'narrator_intro, context, word_count). Sprint 13.4 convert flow populates '
    'this so cleaned transcript stays user-facing while admins keep the source.';
