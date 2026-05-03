-- Migration 032: Add recommended_anchor column to grammar_recommendations
-- Purpose: Sprint 4 Phase 5 — persist the deep-link anchor id resolved by
--   GrammarContentService.find_best_anchor() so the Result page can render
--   /grammar/<category>/<slug>#<anchor> URLs and the analytics layer can
--   later attribute click-through to specific anchored sections.
--
-- Schema impact:
--   - Adds nullable TEXT column. Old rows have NULL (frontend falls back
--     to article-level URL — backward compatible).
--   - No data backfill needed; new column populated only by future grading
--     calls after the application code (commit 7e65d72) is deployed.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS — safe to re-run.

ALTER TABLE grammar_recommendations
    ADD COLUMN IF NOT EXISTS recommended_anchor TEXT;
