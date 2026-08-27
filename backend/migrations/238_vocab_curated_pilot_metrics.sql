-- ============================================================================
-- Migration 238 — Curated vocab recommendation lifecycle and pilot metrics
-- ============================================================================
--
-- Recommendation state is canonical server data. Opening is an authenticated,
-- idempotent mutation; completion is derived in the same transaction as the
-- attempt insert by an AFTER INSERT trigger. Admin metrics are anonymised
-- aggregates computed in PostgreSQL so learner-level rows never leave the DB.
-- ============================================================================

ALTER TABLE vocab_unit_recommendations
    ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

UPDATE vocab_unit_recommendations
   SET opened_at = COALESCE(opened_at, updated_at)
 WHERE status = 'opened'
   AND opened_at IS NULL;

UPDATE vocab_unit_recommendations
   SET completed_at = COALESCE(completed_at, updated_at)
 WHERE status = 'completed'
   AND completed_at IS NULL;

UPDATE vocab_unit_recommendations
   SET dismissed_at = COALESCE(dismissed_at, updated_at)
 WHERE status = 'dismissed'
   AND dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vocab_unit_recommendations_created_status
    ON vocab_unit_recommendations(created_at DESC, status);

CREATE TABLE IF NOT EXISTS vocab_curated_cohort_events (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vocab_curated_cohort_events_user_created
    ON vocab_curated_cohort_events(user_id, created_at DESC);

ALTER TABLE vocab_curated_cohort_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fn_set_vocab_curated_cohort(
    p_user UUID,
    p_enabled BOOLEAN,
    p_changed_by UUID,
    p_now TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_flags JSONB;
BEGIN
    SELECT COALESCE(feature_flags, '{}'::jsonb)
      INTO v_flags
      FROM users
     WHERE id = p_user
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'user_not_found';
    END IF;

    v_flags := jsonb_set(
        v_flags,
        '{vocab_curated_enabled}',
        to_jsonb(p_enabled),
        TRUE
    );
    UPDATE users SET feature_flags = v_flags WHERE id = p_user;

    INSERT INTO vocab_curated_cohort_events (
        user_id, enabled, changed_by, created_at
    ) VALUES (
        p_user, p_enabled, p_changed_by, p_now
    );

    RETURN jsonb_build_object(
        'user_id', p_user,
        'vocab_curated_enabled', p_enabled,
        'changed_at', p_now
    );
END;
$$;

REVOKE ALL ON FUNCTION fn_set_vocab_curated_cohort(
    UUID, BOOLEAN, UUID, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_set_vocab_curated_cohort(
    UUID, BOOLEAN, UUID, TIMESTAMPTZ
) TO service_role;

CREATE OR REPLACE FUNCTION fn_open_vocab_unit_recommendation(
    p_user UUID,
    p_recommendation UUID,
    p_unit_slug TEXT,
    p_now TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_recommendation vocab_unit_recommendations%ROWTYPE;
BEGIN
    SELECT recommendation.*
      INTO v_recommendation
      FROM vocab_unit_recommendations recommendation
      JOIN vocab_learning_units unit ON unit.id = recommendation.unit_id
     WHERE recommendation.id = p_recommendation
       AND recommendation.user_id = p_user
       AND unit.unit_slug = p_unit_slug
     FOR UPDATE OF recommendation;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'recommendation_not_found';
    END IF;

    IF v_recommendation.status = 'pending' THEN
        UPDATE vocab_unit_recommendations
           SET status = 'opened',
               opened_at = COALESCE(opened_at, p_now)
         WHERE id = p_recommendation
         RETURNING * INTO v_recommendation;
    END IF;

    RETURN jsonb_build_object(
        'recommendation_id', v_recommendation.id,
        'status', v_recommendation.status,
        'opened_at', v_recommendation.opened_at,
        'completed_at', v_recommendation.completed_at
    );
END;
$$;

REVOKE ALL ON FUNCTION fn_open_vocab_unit_recommendation(
    UUID, UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_open_vocab_unit_recommendation(
    UUID, UUID, TEXT, TIMESTAMPTZ
) TO service_role;

CREATE OR REPLACE FUNCTION fn_complete_vocab_recommendations_after_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_unit_id UUID;
    v_task_count INTEGER;
    v_attempted_task_count INTEGER;
BEGIN
    SELECT version.unit_id
      INTO v_unit_id
      FROM vocab_unit_versions version
     WHERE version.id = NEW.version_id;
    IF v_unit_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Serialize completion decisions for one learner/unit. Without a shared
    -- transaction lock, concurrent final attempts (or a recommendation insert)
    -- can each miss the other's uncommitted row and leave lifecycle state stale.
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'vocab-recommendation:' || NEW.user_id::text || ':' || v_unit_id::text,
        0
    ));

    SELECT COUNT(*)
      INTO v_task_count
      FROM vocab_unit_tasks task
     WHERE task.version_id = NEW.version_id
       AND task.status = 'active';

    SELECT COUNT(DISTINCT attempt.task_id)
      INTO v_attempted_task_count
      FROM vocab_unit_attempts attempt
      JOIN vocab_unit_tasks task ON task.id = attempt.task_id
     WHERE attempt.user_id = NEW.user_id
       AND attempt.version_id = NEW.version_id
       AND task.status = 'active';

    IF v_task_count > 0 AND v_attempted_task_count >= v_task_count THEN
        UPDATE vocab_unit_recommendations
           SET status = 'completed',
               completed_at = COALESCE(completed_at, NEW.created_at)
         WHERE user_id = NEW.user_id
           AND unit_id = v_unit_id
           AND status IN ('pending', 'opened');
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION fn_complete_vocab_recommendations_after_attempt()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_complete_vocab_recommendations_after_attempt
    ON vocab_unit_attempts;
CREATE TRIGGER trg_complete_vocab_recommendations_after_attempt
    AFTER INSERT ON vocab_unit_attempts
    FOR EACH ROW EXECUTE FUNCTION fn_complete_vocab_recommendations_after_attempt();

CREATE OR REPLACE FUNCTION fn_complete_vocab_recommendation_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_version_id UUID;
    v_task_count INTEGER;
    v_attempted_task_count INTEGER;
BEGIN
    -- Use the same learner/unit lock as the attempt trigger so either side that
    -- runs second observes the first transaction after it commits.
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'vocab-recommendation:' || NEW.user_id::text || ':' || NEW.unit_id::text,
        0
    ));

    SELECT current_published_version_id
      INTO v_version_id
      FROM vocab_learning_units
     WHERE id = NEW.unit_id
       AND status = 'published';
    IF v_version_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT COUNT(*)
      INTO v_task_count
      FROM vocab_unit_tasks task
     WHERE task.version_id = v_version_id
       AND task.status = 'active';

    SELECT COUNT(DISTINCT attempt.task_id)
      INTO v_attempted_task_count
      FROM vocab_unit_attempts attempt
      JOIN vocab_unit_tasks task ON task.id = attempt.task_id
     WHERE attempt.user_id = NEW.user_id
       AND attempt.version_id = v_version_id
       AND task.status = 'active';

    IF v_task_count > 0 AND v_attempted_task_count >= v_task_count THEN
        UPDATE vocab_unit_recommendations
           SET status = 'completed',
               completed_at = COALESCE(completed_at, NEW.created_at)
         WHERE id = NEW.id
           AND status IN ('pending', 'opened');
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION fn_complete_vocab_recommendation_on_insert()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_complete_vocab_recommendation_on_insert
    ON vocab_unit_recommendations;
CREATE TRIGGER trg_complete_vocab_recommendation_on_insert
    AFTER INSERT ON vocab_unit_recommendations
    FOR EACH ROW EXECUTE FUNCTION fn_complete_vocab_recommendation_on_insert();

CREATE OR REPLACE FUNCTION fn_vocab_curated_pilot_metrics(
    p_days INTEGER,
    p_as_of TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF p_days NOT IN (30, 90, 180) THEN
        RAISE EXCEPTION 'invalid_period_days';
    END IF;

    WITH attempt_facts AS (
        SELECT attempt.id,
               attempt.user_id,
               attempt.task_id,
               attempt.version_id,
               version.unit_id,
               task.dimension,
               attempt.is_correct,
               attempt.created_at
          FROM vocab_unit_attempts attempt
          JOIN vocab_unit_tasks task ON task.id = attempt.task_id
          JOIN vocab_unit_versions version ON version.id = attempt.version_id
         WHERE attempt.created_at <= p_as_of
    ),
    starts AS (
        SELECT DISTINCT ON (fact.user_id, fact.unit_id)
               fact.user_id,
               fact.unit_id,
               fact.version_id,
               fact.created_at AS started_at
          FROM attempt_facts fact
         ORDER BY fact.user_id, fact.unit_id, fact.created_at, fact.id
    ),
    cohorts AS (
        SELECT start.*
          FROM starts start
         WHERE start.started_at >= p_as_of - make_interval(days => p_days)
    ),
    task_counts AS (
        SELECT task.version_id, COUNT(*)::INTEGER AS task_count
          FROM vocab_unit_tasks task
         WHERE task.status = 'active'
         GROUP BY task.version_id
    ),
    per_cohort AS (
        SELECT cohort.user_id,
               cohort.unit_id,
               cohort.version_id,
               cohort.started_at,
               COALESCE(task_count.task_count, 0) AS task_count,
               COUNT(fact.id) FILTER (
                   WHERE fact.created_at < cohort.started_at + INTERVAL '1 day'
               )::INTEGER AS immediate_attempts,
               COUNT(fact.id) FILTER (
                   WHERE fact.created_at < cohort.started_at + INTERVAL '1 day'
                     AND fact.is_correct
               )::INTEGER AS immediate_correct,
               COUNT(DISTINCT fact.task_id) FILTER (
                   WHERE fact.version_id = cohort.version_id
                     AND fact.created_at < cohort.started_at + INTERVAL '1 day'
               )::INTEGER AS immediate_distinct_tasks,
               COUNT(fact.id) FILTER (
                   WHERE fact.created_at >= cohort.started_at + INTERVAL '6 days'
                     AND fact.created_at < cohort.started_at + INTERVAL '10 days'
               )::INTEGER AS day7_attempts,
               COUNT(fact.id) FILTER (
                   WHERE fact.created_at >= cohort.started_at + INTERVAL '6 days'
                     AND fact.created_at < cohort.started_at + INTERVAL '10 days'
                     AND fact.is_correct
               )::INTEGER AS day7_correct,
               COUNT(fact.id) FILTER (
                   WHERE fact.created_at >= cohort.started_at + INTERVAL '6 days'
                     AND fact.created_at < cohort.started_at + INTERVAL '10 days'
                     AND fact.dimension = 'productive_transfer'
               )::INTEGER AS day7_transfer_attempts,
               COUNT(fact.id) FILTER (
                   WHERE fact.created_at >= cohort.started_at + INTERVAL '6 days'
                     AND fact.created_at < cohort.started_at + INTERVAL '10 days'
                     AND fact.dimension = 'productive_transfer'
                     AND fact.is_correct
               )::INTEGER AS day7_transfer_correct,
               COUNT(fact.id) FILTER (
                   WHERE fact.created_at >= cohort.started_at + INTERVAL '25 days'
                     AND fact.created_at < cohort.started_at + INTERVAL '35 days'
               )::INTEGER AS day28_attempts,
               COUNT(fact.id) FILTER (
                   WHERE fact.created_at >= cohort.started_at + INTERVAL '25 days'
                     AND fact.created_at < cohort.started_at + INTERVAL '35 days'
                     AND fact.is_correct
               )::INTEGER AS day28_correct,
               COUNT(fact.id) FILTER (
                   WHERE fact.created_at >= cohort.started_at + INTERVAL '25 days'
                     AND fact.created_at < cohort.started_at + INTERVAL '35 days'
                     AND fact.dimension = 'productive_transfer'
               )::INTEGER AS day28_transfer_attempts,
               COUNT(fact.id) FILTER (
                   WHERE fact.created_at >= cohort.started_at + INTERVAL '25 days'
                     AND fact.created_at < cohort.started_at + INTERVAL '35 days'
                     AND fact.dimension = 'productive_transfer'
                     AND fact.is_correct
               )::INTEGER AS day28_transfer_correct
          FROM cohorts cohort
          LEFT JOIN task_counts task_count ON task_count.version_id = cohort.version_id
          LEFT JOIN attempt_facts fact
            ON fact.user_id = cohort.user_id
           AND fact.unit_id = cohort.unit_id
           AND fact.created_at >= cohort.started_at
         GROUP BY cohort.user_id, cohort.unit_id, cohort.version_id,
                  cohort.started_at, task_count.task_count
    ),
    per_unit AS (
        SELECT unit.id,
               unit.unit_slug,
               unit.display_headword,
               COUNT(*)::INTEGER AS started,
               COUNT(*) FILTER (
                   WHERE cohort.started_at <= p_as_of - INTERVAL '1 day'
               )::INTEGER AS immediate_eligible,
               COUNT(*) FILTER (
                   WHERE cohort.started_at <= p_as_of - INTERVAL '1 day'
                     AND cohort.task_count > 0
                     AND cohort.immediate_distinct_tasks >= cohort.task_count
               )::INTEGER AS immediate_completed,
               COUNT(*) FILTER (
                   WHERE cohort.started_at <= p_as_of - INTERVAL '10 days'
               )::INTEGER AS day7_eligible,
               COUNT(*) FILTER (
                   WHERE cohort.started_at <= p_as_of - INTERVAL '10 days'
                     AND cohort.day7_attempts > 0
               )::INTEGER AS day7_assessed,
               COALESCE(SUM(cohort.day7_attempts) FILTER (
                   WHERE cohort.started_at <= p_as_of - INTERVAL '10 days'
               ), 0)::INTEGER AS day7_attempts,
               COALESCE(SUM(cohort.day7_correct) FILTER (
                   WHERE cohort.started_at <= p_as_of - INTERVAL '10 days'
               ), 0)::INTEGER AS day7_correct,
               COUNT(*) FILTER (
                   WHERE cohort.started_at <= p_as_of - INTERVAL '35 days'
               )::INTEGER AS day28_eligible,
               COUNT(*) FILTER (
                   WHERE cohort.started_at <= p_as_of - INTERVAL '35 days'
                     AND cohort.day28_attempts > 0
               )::INTEGER AS day28_assessed,
               COALESCE(SUM(cohort.day28_attempts) FILTER (
                   WHERE cohort.started_at <= p_as_of - INTERVAL '35 days'
               ), 0)::INTEGER AS day28_attempts,
               COALESCE(SUM(cohort.day28_correct) FILTER (
                   WHERE cohort.started_at <= p_as_of - INTERVAL '35 days'
               ), 0)::INTEGER AS day28_correct
          FROM per_cohort cohort
          JOIN vocab_learning_units unit ON unit.id = cohort.unit_id
         GROUP BY unit.id, unit.unit_slug, unit.display_headword
    )
    SELECT jsonb_build_object(
        'period_days', p_days,
        'computed_at', p_as_of,
        'cohort', jsonb_build_object(
            'enabled_users', (
                SELECT COUNT(*) FROM users
                 WHERE COALESCE(feature_flags, '{}'::jsonb)
                       @> '{"vocab_curated_enabled": true}'::jsonb
            ),
            'learners_started', (SELECT COUNT(DISTINCT user_id) FROM per_cohort),
            'unit_starts', (SELECT COUNT(*) FROM per_cohort)
        ),
        'runtime_flags', COALESCE((
            SELECT jsonb_object_agg(flag.key, flag.enabled)
              FROM runtime_flags flag
             WHERE flag.key IN (
                 'vocab_units_read', 'vocab_unit_attempts_write',
                 'vocab_unit_recommendations', 'vocab_ai_scoring'
             )
        ), '{}'::jsonb),
        'immediate', (
            SELECT jsonb_build_object(
                'eligible_unit_starts', COUNT(*) FILTER (
                    WHERE started_at <= p_as_of - INTERVAL '1 day'
                ),
                'completed_unit_starts', COUNT(*) FILTER (
                    WHERE started_at <= p_as_of - INTERVAL '1 day'
                      AND task_count > 0
                      AND immediate_distinct_tasks >= task_count
                ),
                'completion_rate_percent', ROUND(
                    100.0 * COUNT(*) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '1 day'
                          AND task_count > 0
                          AND immediate_distinct_tasks >= task_count
                    ) / NULLIF(COUNT(*) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '1 day'
                    ), 0), 1
                ),
                'attempts', COALESCE(SUM(immediate_attempts) FILTER (
                    WHERE started_at <= p_as_of - INTERVAL '1 day'
                ), 0),
                'accuracy_percent', ROUND(
                    100.0 * COALESCE(SUM(immediate_correct) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '1 day'
                    ), 0) / NULLIF(COALESCE(SUM(immediate_attempts) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '1 day'
                    ), 0), 0), 1
                )
            ) FROM per_cohort
        ),
        'day7', (
            SELECT jsonb_build_object(
                'eligible_unit_starts', COUNT(*) FILTER (
                    WHERE started_at <= p_as_of - INTERVAL '10 days'
                ),
                'assessed_unit_starts', COUNT(*) FILTER (
                    WHERE started_at <= p_as_of - INTERVAL '10 days'
                      AND day7_attempts > 0
                ),
                'followup_rate_percent', ROUND(
                    100.0 * COUNT(*) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '10 days'
                          AND day7_attempts > 0
                    ) / NULLIF(COUNT(*) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '10 days'
                    ), 0), 1
                ),
                'attempts', COALESCE(SUM(day7_attempts) FILTER (
                    WHERE started_at <= p_as_of - INTERVAL '10 days'
                ), 0),
                'accuracy_percent', ROUND(
                    100.0 * COALESCE(SUM(day7_correct) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '10 days'
                    ), 0) / NULLIF(COALESCE(SUM(day7_attempts) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '10 days'
                    ), 0), 0), 1
                ),
                'transfer_attempts', COALESCE(SUM(day7_transfer_attempts) FILTER (
                    WHERE started_at <= p_as_of - INTERVAL '10 days'
                ), 0),
                'transfer_success_percent', ROUND(
                    100.0 * COALESCE(SUM(day7_transfer_correct) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '10 days'
                    ), 0) / NULLIF(COALESCE(SUM(day7_transfer_attempts) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '10 days'
                    ), 0), 0), 1
                )
            ) FROM per_cohort
        ),
        'day28', (
            SELECT jsonb_build_object(
                'eligible_unit_starts', COUNT(*) FILTER (
                    WHERE started_at <= p_as_of - INTERVAL '35 days'
                ),
                'assessed_unit_starts', COUNT(*) FILTER (
                    WHERE started_at <= p_as_of - INTERVAL '35 days'
                      AND day28_attempts > 0
                ),
                'followup_rate_percent', ROUND(
                    100.0 * COUNT(*) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '35 days'
                          AND day28_attempts > 0
                    ) / NULLIF(COUNT(*) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '35 days'
                    ), 0), 1
                ),
                'attempts', COALESCE(SUM(day28_attempts) FILTER (
                    WHERE started_at <= p_as_of - INTERVAL '35 days'
                ), 0),
                'accuracy_percent', ROUND(
                    100.0 * COALESCE(SUM(day28_correct) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '35 days'
                    ), 0) / NULLIF(COALESCE(SUM(day28_attempts) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '35 days'
                    ), 0), 0), 1
                ),
                'transfer_attempts', COALESCE(SUM(day28_transfer_attempts) FILTER (
                    WHERE started_at <= p_as_of - INTERVAL '35 days'
                ), 0),
                'transfer_success_percent', ROUND(
                    100.0 * COALESCE(SUM(day28_transfer_correct) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '35 days'
                    ), 0) / NULLIF(COALESCE(SUM(day28_transfer_attempts) FILTER (
                        WHERE started_at <= p_as_of - INTERVAL '35 days'
                    ), 0), 0), 1
                )
            ) FROM per_cohort
        ),
        'recommendations', (
            SELECT jsonb_build_object(
                'created', COUNT(*),
                'opened', COUNT(*) FILTER (WHERE opened_at IS NOT NULL),
                'completed', COUNT(*) FILTER (WHERE completed_at IS NOT NULL),
                'dismissed', COUNT(*) FILTER (WHERE dismissed_at IS NOT NULL),
                'open_rate_percent', ROUND(
                    100.0 * COUNT(*) FILTER (WHERE opened_at IS NOT NULL)
                    / NULLIF(COUNT(*), 0), 1
                ),
                'completion_rate_percent', ROUND(
                    100.0 * COUNT(*) FILTER (WHERE completed_at IS NOT NULL)
                    / NULLIF(COUNT(*), 0), 1
                )
            )
              FROM vocab_unit_recommendations
             WHERE created_at >= p_as_of - make_interval(days => p_days)
               AND created_at <= p_as_of
        ),
        'units', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'unit_slug', unit_slug,
                'display_headword', display_headword,
                'started', started,
                'immediate_eligible', immediate_eligible,
                'immediate_completed', immediate_completed,
                'day7_eligible', day7_eligible,
                'day7_assessed', day7_assessed,
                'day7_accuracy_percent', ROUND(
                    100.0 * day7_correct / NULLIF(day7_attempts, 0), 1
                ),
                'day28_eligible', day28_eligible,
                'day28_assessed', day28_assessed,
                'day28_accuracy_percent', ROUND(
                    100.0 * day28_correct / NULLIF(day28_attempts, 0), 1
                )
            ) ORDER BY started DESC, unit_slug)
              FROM per_unit
        ), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION fn_vocab_curated_pilot_metrics(
    INTEGER, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_vocab_curated_pilot_metrics(
    INTEGER, TIMESTAMPTZ
) TO service_role;
