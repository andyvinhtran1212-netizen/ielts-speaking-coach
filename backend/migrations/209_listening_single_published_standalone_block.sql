-- Migration: 209_listening_single_published_standalone_block.sql
-- Purpose: make the learner-reachability rule atomic for standalone
-- Listening exercises. Gist, True/False and MCQ pages resolve one published
-- block per content/type, so the database must reject a second live block even
-- when two admin requests race past the application preflight.
--
-- Production and staging preflight on 2026-08-14: 0 duplicate published
-- groups for the constrained exercise types. Fail closed if that changes
-- before rollout; do not silently choose or archive pedagogical content.
-- Apply after migration 208 and before deploying the T/F authoring batch.
-- Rollback: DROP INDEX IF EXISTS idx_listening_exercises_single_published_standalone;

SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM listening_exercises
        WHERE status = 'published'
          AND exercise_type IN ('gist', 'true_false', 'mcq')
        GROUP BY content_id, exercise_type
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce one published standalone Listening block: duplicate content/type groups exist';
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_listening_exercises_single_published_standalone
    ON listening_exercises (content_id, exercise_type)
    WHERE status = 'published'
      AND exercise_type IN ('gist', 'true_false', 'mcq');
