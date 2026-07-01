-- ============================================================================
-- Migration 123 — admin per-student quiz rollup (observe practice results)
-- ============================================================================
-- The admin console can already see class-wide "từ dễ sai" (mig 121), but had no
-- way to observe INDIVIDUAL learners' practice. This RPC aggregates, per learner,
-- their sessions / practice time / avg accuracy / words mastered / last-active for
-- one skill_area (e.g. 'vocab'), so the admin analytics endpoint can list students
-- without a client-side GROUP BY (PostgREST can't) and without an N+1 per user.
--
-- Read-only aggregate over quiz_sessions + quiz_word_stats, joined to quiz_banks
-- to scope by skill_area. CREATE OR REPLACE → re-runnable. ADDITIVE. Apply by hand
-- BEFORE merge. Called via supabase_admin.rpc (service role) from the admin route.
-- ============================================================================

CREATE OR REPLACE FUNCTION quiz_admin_student_rollup(p_skill_area TEXT)
RETURNS TABLE (
    user_id         UUID,
    sessions        BIGINT,
    graded_sessions BIGINT,
    total_time_sec  BIGINT,
    avg_accuracy    NUMERIC,
    words_mastered  BIGINT,
    last_active     TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
    WITH sess AS (
        -- Only FINALIZED sessions: start_session inserts a row on quiz open, so an
        -- ended_at-less row is a "opened and left" abandonment (0 time), not real
        -- practice. graded_sessions = those with a non-NULL accuracy, so the caller
        -- can weight the class average by graded (not started) sessions.
        SELECT s.user_id,
               COUNT(*)                                          AS sessions,
               COUNT(*) FILTER (WHERE s.accuracy IS NOT NULL)    AS graded_sessions,
               COALESCE(SUM(s.duration_sec), 0)                  AS total_time_sec,
               AVG(s.accuracy)                                   AS avg_accuracy,
               MAX(s.started_at)                                 AS last_active
        FROM quiz_sessions s
        JOIN quiz_banks b ON b.id = s.bank_id
        WHERE b.skill_area = p_skill_area AND s.ended_at IS NOT NULL
        GROUP BY s.user_id
    ),
    mastered AS (
        SELECT ws.user_id, COUNT(*) AS words_mastered
        FROM quiz_word_stats ws
        JOIN quiz_banks b ON b.id = ws.bank_id
        WHERE b.skill_area = p_skill_area AND ws.status = 'mastered'
        GROUP BY ws.user_id
    )
    SELECT sess.user_id,
           sess.sessions,
           sess.graded_sessions,
           sess.total_time_sec,
           -- accuracy is REAL, so AVG() is double precision; ROUND(double, int)
           -- doesn't exist in Postgres — cast to numeric for the 2-arg ROUND.
           ROUND(sess.avg_accuracy::numeric, 3)     AS avg_accuracy,
           COALESCE(mastered.words_mastered, 0)     AS words_mastered,
           sess.last_active
    FROM sess
    LEFT JOIN mastered ON mastered.user_id = sess.user_id
    ORDER BY sess.last_active DESC NULLS LAST;
$$;

-- ── Reverse (run manually if needed) ────────────────────────────────────────
-- DROP FUNCTION IF EXISTS quiz_admin_student_rollup(TEXT);
