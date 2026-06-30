-- ============================================================================
-- Migration 121 — quiz analytics RPCs ("từ dễ sai", Pha 5a)
-- ============================================================================
-- Class-wide error-rate aggregation per bank. PostgREST can't GROUP BY from the
-- client, so expose two stable SQL functions the admin analytics endpoint calls
-- via supabase_admin.rpc. error_rate = wrong / total over ALL learners' attempts.
--
-- Read-only aggregates over quiz_attempts (mig 119). CREATE OR REPLACE →
-- re-runnable. ADDITIVE. Apply by hand BEFORE merge.
-- ============================================================================

-- Per-word (item_key) error rate, worst first.
CREATE OR REPLACE FUNCTION quiz_item_error_rates(p_bank_id UUID)
RETURNS TABLE (item_key TEXT, total BIGINT, wrong BIGINT, error_rate NUMERIC)
LANGUAGE sql STABLE AS $$
    SELECT item_key,
           COUNT(*)                                  AS total,
           COUNT(*) FILTER (WHERE NOT is_correct)    AS wrong,
           ROUND(COUNT(*) FILTER (WHERE NOT is_correct)::numeric
                 / NULLIF(COUNT(*), 0), 3)           AS error_rate
    FROM quiz_attempts
    WHERE bank_id = p_bank_id
    GROUP BY item_key
    ORDER BY error_rate DESC NULLS LAST, wrong DESC;
$$;

-- Per-skill error rate (where is the cohort weakest?).
CREATE OR REPLACE FUNCTION quiz_skill_error_rates(p_bank_id UUID)
RETURNS TABLE (skill TEXT, total BIGINT, wrong BIGINT, error_rate NUMERIC)
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(skill, '(none)')                 AS skill,
           COUNT(*)                                  AS total,
           COUNT(*) FILTER (WHERE NOT is_correct)    AS wrong,
           ROUND(COUNT(*) FILTER (WHERE NOT is_correct)::numeric
                 / NULLIF(COUNT(*), 0), 3)           AS error_rate
    FROM quiz_attempts
    WHERE bank_id = p_bank_id
    GROUP BY COALESCE(skill, '(none)')
    ORDER BY error_rate DESC NULLS LAST, wrong DESC;
$$;

-- Per-learner, per-bank mastery counts — aggregated in SQL so a learner with
-- more word_stats rows than the PostgREST page cap is counted fully (a plain
-- unpaginated select would only see the first page).
CREATE OR REPLACE FUNCTION quiz_user_bank_progress(p_user_id UUID)
RETURNS TABLE (bank_id UUID, mastered BIGINT, in_progress BIGINT)
LANGUAGE sql STABLE AS $$
    SELECT bank_id,
           COUNT(*) FILTER (WHERE status =  'mastered') AS mastered,
           COUNT(*) FILTER (WHERE status <> 'mastered') AS in_progress
    FROM quiz_word_stats
    WHERE user_id = p_user_id
    GROUP BY bank_id;
$$;

-- ── Reverse (run manually if needed) ────────────────────────────────────────
-- DROP FUNCTION IF EXISTS quiz_item_error_rates(UUID);
-- DROP FUNCTION IF EXISTS quiz_skill_error_rates(UUID);
-- DROP FUNCTION IF EXISTS quiz_user_bank_progress(UUID);
