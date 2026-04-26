-- 022b_fix_attempts_rls_update_policy.sql
-- Phase D Wave 1 fix-forward: vocabulary_exercise_attempts was shipped without
-- an UPDATE policy.  This file adds it with both USING and WITH CHECK clauses
-- (the same shape Phase B's 019b applied to user_vocabulary).
--
-- Why a separate file (not an edit to 022): 022 has already been applied to
-- staging.  Fix-forward keeps the migration history monotonic and matches the
-- precedent set by 019 → 019b.
--
-- Idempotent: safe to re-apply.

DROP POLICY IF EXISTS vocab_attempts_update ON vocabulary_exercise_attempts;
CREATE POLICY vocab_attempts_update ON vocabulary_exercise_attempts
    FOR UPDATE
    USING      (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (commented out, run manually if needed):
-- ────────────────────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS vocab_attempts_update ON vocabulary_exercise_attempts;
