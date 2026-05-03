-- Rollback for Migration 032
-- Drops the recommended_anchor column added by 032_add_recommended_anchor_to_grammar_recommendations.sql.
--
-- Run this only if Sprint 4 production rollout fails and we need to revert.
-- Application code (Sprint 4 commit 7e65d72) sets the column when present
-- but the persistence path uses .get('anchor') in a dict comprehension —
-- removing the column will cause INSERT to fail unless the application
-- code is also reverted to the pre-Sprint-4 schema (commit b07a175 or
-- earlier).
--
-- Safe sequence for rollback:
--   1. Revert application deploy to pre-Sprint-4 commit
--   2. Run this rollback migration
--
-- DO NOT run this rollback while Sprint 4 application code is live in
-- production — INSERTs on grammar_recommendations will fail.
--
-- Idempotent: DROP COLUMN IF EXISTS — safe to re-run.

ALTER TABLE grammar_recommendations
    DROP COLUMN IF EXISTS recommended_anchor;
