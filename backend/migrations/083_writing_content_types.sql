-- Migration: 083_writing_content_types.sql
-- Sprint 19.1C — content import pipeline.
--
-- Extends writing_tips (migration 082) into a 4-type content store
-- without renaming the table (rename → writing_content deferred to Phase
-- B per Andy 2026-05-26). A `content_type` discriminator + a flexible
-- `type_data` JSONB carry the per-type extras (sample: target_band /
-- word_count / prompt_id; outline: structure). type_data is validated at
-- the API layer (Pydantic per content_type) — NOT a DB CHECK — so the
-- shape can evolve without a migration.
--
-- Backfill: every existing 19.1B row is a plain tip, which the column
-- DEFAULTs handle automatically (ADD COLUMN ... DEFAULT backfills in
-- place). Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE writing_tips
    ADD COLUMN IF NOT EXISTS content_type TEXT  NOT NULL DEFAULT 'tip'
        CHECK (content_type IN ('tip', 'knowledge', 'sample', 'outline')),
    ADD COLUMN IF NOT EXISTS type_data    JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The user-side "Mẹo viết" tab filters published rows by content_type
-- (and task_type). Extend the published hot-path index to lead with
-- content_type. Partial — drafts stay out of the index.
CREATE INDEX IF NOT EXISTS idx_writing_tips_content_type
    ON writing_tips (content_type, task_type, display_order)
    WHERE published = TRUE;

COMMENT ON COLUMN writing_tips.content_type IS
    'Content discriminator: tip | knowledge | sample | outline. Sprint 19.1C. Existing rows backfilled to tip.';
COMMENT ON COLUMN writing_tips.type_data IS
    'Per-type extras (JSONB). sample: {target_band, word_count, prompt_id?}. outline: {structure: [{heading, points[]}]}. tip/knowledge: {}. Validated at the API layer, not the DB.';
