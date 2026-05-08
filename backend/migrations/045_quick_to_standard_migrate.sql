-- Migration 045: migrate any existing 'quick' tier rows to 'standard'
-- Sprint 2.7a.1 — Quick tier removed due to orthogonality conflict with
-- persona Levels L1-L5 (Levels L3-L5 target sections that Quick drops).
--
-- Migration semantics
--   - Idempotent. Both UPDATEs are no-ops when 0 'quick' rows exist
--     (which is the expected state since 2.7a was just merged and not
--     smoke-tested before this revert). Safe to run regardless.
--   - Does NOT drop the 'quick' value from grading_tier_enum. Removing
--     enum values in Postgres is a destructive multi-step operation
--     (CREATE new type, ALTER TABLE, DROP old) — complexity outweighs
--     benefit. The application layer (admin_writing router) returns 400
--     when grading_tier='quick' is submitted, and the grader raises
--     ValueError as defence-in-depth. See TECH_DEBT #36.
--   - Does NOT rewrite feedback_json. Quick-shape feedback rows (if
--     any) keep their 5-section JSON; only the tier label + the
--     prompt_version stamp change. Export pipelines may still 500 on
--     such rows because the WritingFeedback Pydantic schema validates
--     strictly — that's an acceptable corner case post-2.7a.1 since
--     the expected migrated count is 0.

UPDATE writing_essays
   SET grading_tier = 'standard'
 WHERE grading_tier = 'quick';

-- Strip the '-quick' suffix from any prompt_version stamp produced by
-- the Sprint 2.7a Quick code path (e.g. 'v2.1-quick' → 'v2.1'). Without
-- this, A/B SQL queries that pivot on prompt_version would treat
-- migrated rows as a third bucket.
UPDATE writing_feedback
   SET prompt_version = REPLACE(prompt_version, '-quick', '')
 WHERE prompt_version LIKE '%-quick';

-- Refresh the column comment to reflect the post-2.7a.1 state.
COMMENT ON COLUMN writing_essays.grading_tier IS
'Grading depth tier. standard=Pro 12-section (default; the only live
 tier today), deep=Pro multi-pass (Sprint 2.7b, reserved),
 instructor=human-reviewed (Sprint 2.7c, reserved). The quick value is
 retained in grading_tier_enum for legacy rows — Quick was removed in
 Sprint 2.7a.1 (orthogonality conflict with persona Levels L1-L5);
 application layer rejects new quick submissions with 400.';
