-- Migration: 038_writing_prompts_image.sql
-- Mô tả: Phase 2.3c-1 — image upload support for Task 1 Academic.
--
-- Adds two columns to writing_prompts (migration 035):
--   • prompt_image_url       — Cloudinary `secure_url` for the chart /
--                              graph / diagram. NULL for text-only
--                              prompts (Task 1 General + Task 2).
--   • prompt_image_public_id — Cloudinary `public_id`, kept so the
--                              admin DELETE / soft-delete can clean
--                              up the asset rather than orphan it.
--
-- Both columns are NULL-able + idempotent ADD — re-running this
-- migration is a no-op on top of an already-applied schema. The
-- "only task1_academic may have an image" constraint is enforced at
-- the application layer (admin UI hides the field unless task_type
-- = task1_academic); a future migration can tighten with a CHECK
-- once we're sure no edge content needs the column on other types.

ALTER TABLE writing_prompts
    ADD COLUMN IF NOT EXISTS prompt_image_url       TEXT,
    ADD COLUMN IF NOT EXISTS prompt_image_public_id TEXT;

COMMENT ON COLUMN writing_prompts.prompt_image_url IS
    'Cloudinary secure_url for Task 1 Academic chart/diagram. NULL for text-only prompts.';
COMMENT ON COLUMN writing_prompts.prompt_image_public_id IS
    'Cloudinary public_id, used to delete the asset when the prompt is soft-deleted or its image is replaced.';
