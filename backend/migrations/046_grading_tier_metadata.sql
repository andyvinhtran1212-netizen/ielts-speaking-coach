-- Migration 046: writing_essays.grading_tier_metadata
-- Sprint 2.7b — track per-pass timing/cost/refinement metadata for the
-- Deep tier 3-pass flow (Pass 1 Standard → Pass 2 Refine → Pass 3
-- Rewrite). Standard tier writes nothing (the existing flat columns
-- on writing_feedback already cover model_used / tokens / cost /
-- duration_ms for single-pass grading); Deep tier writes the per-pass
-- breakdown so cost analysis + degradation monitoring don't have to
-- reverse-engineer wall-clock vs API-call splits.

ALTER TABLE writing_essays
    ADD COLUMN IF NOT EXISTS grading_tier_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN writing_essays.grading_tier_metadata IS
'Tier-specific grading metadata. Standard tier: empty {} (existing
 writing_feedback columns cover the data). Deep tier shape (Sprint 2.7b):
   {
     "pass1": {"duration_ms": int, "tokens_input": int, "tokens_output": int, "cost_usd": float},
     "pass2": {"duration_ms": int, "tokens_input": int, "tokens_output": int, "cost_usd": float,
               "refinements_count": int, "added_mistakes": int, "removed_mistakes": int},
     "pass3": {"duration_ms": int, "tokens_input": int, "tokens_output": int, "cost_usd": float,
               "rewrites_count": int},
     "degraded_at": "pass2" | "pass3" | null,   -- which pass failed (graceful fallback marker)
     "degraded_error": str | null
   }
 Existing rows backfill to {} via DEFAULT.';
