-- 019b_fix_rls_update_policy.sql
-- Fixes: RLS UPDATE policy on user_vocabulary lacked WITH CHECK,
-- allowing a row owner to potentially mutate user_id to another user's ID.

DROP POLICY IF EXISTS user_vocabulary_update ON user_vocabulary;
CREATE POLICY user_vocabulary_update ON user_vocabulary
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
