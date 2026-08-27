-- ============================================================================
-- Migration 235 — Curated vocab tasks, idempotent attempts and 3-D mastery
-- ============================================================================
--
-- The browser never declares an answer correct. It submits a UUID attempt_id and
-- raw response; the backend grades against the private answer_key, then this RPC
-- atomically persists the attempt and updates one mastery dimension. Replaying
-- the same attempt_id returns the original result without double-counting.
-- ============================================================================

CREATE TABLE IF NOT EXISTS vocab_unit_tasks (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id     UUID NOT NULL REFERENCES vocab_unit_versions(id) ON DELETE CASCADE,
    sequence       INTEGER NOT NULL CHECK (sequence > 0),
    task_type      TEXT NOT NULL CHECK (task_type IN (
                         'meaning_recall', 'error_repair', 'controlled_gap',
                         'productive_transfer'
                     )),
    dimension      TEXT NOT NULL CHECK (dimension IN (
                         'meaning_recall', 'usage_control', 'productive_transfer'
                     )),
    prompt         TEXT NOT NULL,
    options        JSONB NOT NULL DEFAULT '[]'::jsonb,
    answer_key     JSONB NOT NULL,
    explanation_vi TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'active', 'archived')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vocab_unit_tasks_sequence_key UNIQUE (version_id, sequence)
);

CREATE TABLE IF NOT EXISTS vocab_unit_attempts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id     UUID NOT NULL,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id        UUID NOT NULL REFERENCES vocab_unit_tasks(id) ON DELETE RESTRICT,
    version_id     UUID NOT NULL REFERENCES vocab_unit_versions(id) ON DELETE RESTRICT,
    response       JSONB NOT NULL,
    result         JSONB NOT NULL,
    score          NUMERIC NOT NULL CHECK (score >= 0 AND score <= 1),
    is_correct     BOOLEAN NOT NULL,
    grader_version TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vocab_unit_attempts_idempotency_key UNIQUE (user_id, attempt_id)
);

CREATE TABLE IF NOT EXISTS user_kp_dimension_mastery (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kp_id          UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
    dimension      TEXT NOT NULL CHECK (dimension IN (
                         'meaning_recall', 'usage_control', 'productive_transfer'
                     )),
    state          TEXT NOT NULL DEFAULT 'acquiring' CHECK (state IN (
                         'acquiring', 'controlled', 'transfer_ready',
                         'retained', 'needs_refresh'
                     )),
    attempt_count  INTEGER NOT NULL DEFAULT 0,
    success_count  INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    next_review_at TIMESTAMPTZ,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, kp_id, dimension)
);

CREATE INDEX IF NOT EXISTS idx_vocab_unit_tasks_version_status
    ON vocab_unit_tasks(version_id, status);
CREATE INDEX IF NOT EXISTS idx_vocab_unit_attempts_user_created
    ON vocab_unit_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vocab_unit_attempts_task
    ON vocab_unit_attempts(task_id);
CREATE INDEX IF NOT EXISTS idx_user_kp_dimension_mastery_due
    ON user_kp_dimension_mastery(user_id, next_review_at);

DROP TRIGGER IF EXISTS trg_vocab_unit_tasks_updated_at ON vocab_unit_tasks;
CREATE TRIGGER trg_vocab_unit_tasks_updated_at
    BEFORE UPDATE ON vocab_unit_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION fn_guard_published_vocab_task()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_version_id UUID;
    v_version_status TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_version_id := OLD.version_id;
    ELSE
        v_version_id := NEW.version_id;
    END IF;
    SELECT status INTO v_version_status
      FROM vocab_unit_versions
     WHERE id = v_version_id
     FOR SHARE;
    IF v_version_status = 'published' THEN
        RAISE EXCEPTION 'published_vocab_task_is_immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_published_vocab_task ON vocab_unit_tasks;
CREATE TRIGGER trg_guard_published_vocab_task
    BEFORE INSERT OR UPDATE OR DELETE ON vocab_unit_tasks
    FOR EACH ROW EXECUTE FUNCTION fn_guard_published_vocab_task();

ALTER TABLE vocab_unit_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_unit_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_kp_dimension_mastery ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fn_create_vocab_unit_version(
    p_unit        UUID,
    p_content     JSONB,
    p_content_hash TEXT,
    p_sources     JSONB,
    p_tasks       JSONB,
    p_change_note TEXT,
    p_authored_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_version_number INTEGER;
    v_version vocab_unit_versions%ROWTYPE;
    v_task RECORD;
    v_task_count INTEGER := 0;
BEGIN
    -- Lock the parent so two editors cannot both compute the same next version.
    PERFORM 1 FROM vocab_learning_units WHERE id = p_unit FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit_not_found';
    END IF;
    IF jsonb_typeof(p_tasks) <> 'array' THEN
        RAISE EXCEPTION 'tasks_must_be_array';
    END IF;

    SELECT COALESCE(MAX(version_number), 0) + 1
      INTO v_version_number
      FROM vocab_unit_versions
     WHERE unit_id = p_unit;

    INSERT INTO vocab_unit_versions (
        unit_id, version_number, schema_version, status, content, content_hash,
        sources, change_note, authored_by
    ) VALUES (
        p_unit, v_version_number, 1, 'draft', p_content, p_content_hash,
        COALESCE(p_sources, '[]'::jsonb), p_change_note, p_authored_by
    ) RETURNING * INTO v_version;

    FOR v_task IN
        SELECT value, ordinality
          FROM jsonb_array_elements(p_tasks) WITH ORDINALITY
    LOOP
        INSERT INTO vocab_unit_tasks (
            version_id, sequence, task_type, dimension, prompt, options,
            answer_key, explanation_vi, status
        ) VALUES (
            v_version.id,
            v_task.ordinality,
            v_task.value->>'task_type',
            v_task.value->>'dimension',
            v_task.value->>'prompt',
            COALESCE(v_task.value->'options', '[]'::jsonb),
            v_task.value->'answer_key',
            v_task.value->>'explanation_vi',
            'active'
        );
        v_task_count := v_task_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'version', to_jsonb(v_version),
        'task_count', v_task_count
    );
END;
$$;

REVOKE ALL ON FUNCTION fn_create_vocab_unit_version(
    UUID, JSONB, TEXT, JSONB, JSONB, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_create_vocab_unit_version(
    UUID, JSONB, TEXT, JSONB, JSONB, TEXT, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION fn_record_vocab_unit_attempt(
    p_user           UUID,
    p_task           UUID,
    p_attempt        UUID,
    p_response       JSONB,
    p_result         JSONB,
    p_score          NUMERIC,
    p_is_correct     BOOLEAN,
    p_grader_version TEXT,
    p_now            TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_task          RECORD;
    v_attempt       vocab_unit_attempts%ROWTYPE;
    v_mastery       user_kp_dimension_mastery%ROWTYPE;
    v_inserted      BOOLEAN;
    v_attempts      INTEGER;
    v_successes     INTEGER;
    v_state         TEXT;
    v_last_success  TIMESTAMPTZ;
    v_next_review   TIMESTAMPTZ;
BEGIN
    IF p_score < 0 OR p_score > 1 THEN
        RAISE EXCEPTION 'score_out_of_range';
    END IF;

    SELECT t.id, t.version_id, t.dimension, u.kp_id
      INTO v_task
      FROM vocab_unit_tasks t
      JOIN vocab_unit_versions v ON v.id = t.version_id
      JOIN vocab_learning_units u ON u.id = v.unit_id
     WHERE t.id = p_task
       AND t.status = 'active'
       AND v.status = 'published'
       AND u.status = 'published'
       AND u.current_published_version_id = v.id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'task_not_active';
    END IF;

    INSERT INTO vocab_unit_attempts (
        attempt_id, user_id, task_id, version_id, response, result,
        score, is_correct, grader_version, created_at
    ) VALUES (
        p_attempt, p_user, p_task, v_task.version_id, p_response, p_result,
        p_score, p_is_correct, p_grader_version, p_now
    )
    ON CONFLICT (user_id, attempt_id) DO NOTHING
    RETURNING * INTO v_attempt;
    v_inserted := FOUND;

    IF NOT v_inserted THEN
        SELECT * INTO v_attempt
          FROM vocab_unit_attempts
         WHERE user_id = p_user AND attempt_id = p_attempt;
        IF v_attempt.task_id <> p_task THEN
            RAISE EXCEPTION 'attempt_id_reused_for_different_task';
        END IF;
        IF v_attempt.response <> p_response THEN
            RAISE EXCEPTION 'attempt_id_reused_for_different_payload';
        END IF;
        SELECT * INTO v_mastery
          FROM user_kp_dimension_mastery
         WHERE user_id = p_user
           AND kp_id = v_task.kp_id
           AND dimension = v_task.dimension;
        RETURN jsonb_build_object(
            'duplicate', TRUE,
            'attempt', to_jsonb(v_attempt),
            'mastery', CASE WHEN v_mastery.user_id IS NULL THEN NULL ELSE to_jsonb(v_mastery) END
        );
    END IF;

    -- Serialise different attempt UUIDs that land concurrently for the same
    -- learner/KP/dimension. A row lock alone cannot protect the first insert
    -- because there is no mastery row to lock yet.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(p_user::text || ':' || v_task.kp_id::text || ':' || v_task.dimension, 0)
    );

    SELECT * INTO v_mastery
      FROM user_kp_dimension_mastery
     WHERE user_id = p_user
       AND kp_id = v_task.kp_id
       AND dimension = v_task.dimension
     FOR UPDATE;

    v_attempts := COALESCE(v_mastery.attempt_count, 0) + 1;
    v_successes := COALESCE(v_mastery.success_count, 0) + CASE WHEN p_is_correct THEN 1 ELSE 0 END;
    v_last_success := CASE WHEN p_is_correct THEN p_now ELSE v_mastery.last_success_at END;

    IF NOT p_is_correct THEN
        v_state := CASE
            WHEN v_mastery.state IN ('controlled', 'transfer_ready', 'retained') THEN 'needs_refresh'
            ELSE 'acquiring'
        END;
        v_next_review := p_now + INTERVAL '1 day';
    ELSIF v_successes >= 4
          AND v_mastery.last_success_at IS NOT NULL
          AND p_now - v_mastery.last_success_at >= INTERVAL '7 days' THEN
        v_state := 'retained';
        v_next_review := p_now + INTERVAL '28 days';
    ELSIF v_task.dimension = 'productive_transfer' AND v_successes >= 2 THEN
        v_state := 'transfer_ready';
        v_next_review := p_now + INTERVAL '7 days';
    ELSIF v_successes >= 2 THEN
        v_state := 'controlled';
        v_next_review := p_now + INTERVAL '7 days';
    ELSE
        v_state := 'acquiring';
        v_next_review := p_now + INTERVAL '2 days';
    END IF;

    INSERT INTO user_kp_dimension_mastery (
        user_id, kp_id, dimension, state, attempt_count, success_count,
        last_attempt_at, last_success_at, next_review_at, updated_at
    ) VALUES (
        p_user, v_task.kp_id, v_task.dimension, v_state, v_attempts, v_successes,
        p_now, v_last_success, v_next_review, p_now
    )
    ON CONFLICT (user_id, kp_id, dimension) DO UPDATE SET
        state = EXCLUDED.state,
        attempt_count = EXCLUDED.attempt_count,
        success_count = EXCLUDED.success_count,
        last_attempt_at = EXCLUDED.last_attempt_at,
        last_success_at = EXCLUDED.last_success_at,
        next_review_at = EXCLUDED.next_review_at,
        updated_at = EXCLUDED.updated_at
    RETURNING * INTO v_mastery;

    RETURN jsonb_build_object(
        'duplicate', FALSE,
        'attempt', to_jsonb(v_attempt),
        'mastery', to_jsonb(v_mastery)
    );
END;
$$;

REVOKE ALL ON FUNCTION fn_record_vocab_unit_attempt(
    UUID, UUID, UUID, JSONB, JSONB, NUMERIC, BOOLEAN, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_record_vocab_unit_attempt(
    UUID, UUID, UUID, JSONB, JSONB, NUMERIC, BOOLEAN, TEXT, TIMESTAMPTZ
) TO service_role;

CREATE OR REPLACE FUNCTION fn_publish_vocab_unit_version(
    p_version      UUID,
    p_published_by UUID,
    p_now          TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_version vocab_unit_versions%ROWTYPE;
    v_unit    vocab_learning_units%ROWTYPE;
    v_review_type TEXT;
BEGIN
    SELECT * INTO v_version
      FROM vocab_unit_versions
     WHERE id = p_version
       AND status IN ('draft', 'in_review')
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'version_not_publishable';
    END IF;

    FOREACH v_review_type IN ARRAY ARRAY['language', 'pedagogy', 'assessment']
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM vocab_unit_version_reviews
             WHERE version_id = p_version
               AND review_type = v_review_type
               AND decision = 'approved'
        ) THEN
            RAISE EXCEPTION 'missing_approval:%', v_review_type;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM vocab_unit_version_reviews
         WHERE version_id = p_version AND decision = 'changes_requested'
    ) THEN
        RAISE EXCEPTION 'changes_requested';
    END IF;

    -- Require an actual one-to-one assignment between the three review gates
    -- and three people. Merely seeing three distinct IDs somewhere in the
    -- approval set is insufficient when one person owns multiple required gates.
    IF NOT EXISTS (
        SELECT 1
          FROM vocab_unit_version_reviews language
          JOIN vocab_unit_version_reviews pedagogy
            ON pedagogy.version_id = language.version_id
           AND pedagogy.review_type = 'pedagogy'
           AND pedagogy.decision = 'approved'
           AND pedagogy.reviewer_id <> language.reviewer_id
          JOIN vocab_unit_version_reviews assessment
            ON assessment.version_id = language.version_id
           AND assessment.review_type = 'assessment'
           AND assessment.decision = 'approved'
           AND assessment.reviewer_id <> language.reviewer_id
           AND assessment.reviewer_id <> pedagogy.reviewer_id
         WHERE language.version_id = p_version
           AND language.review_type = 'language'
           AND language.decision = 'approved'
    ) THEN
        RAISE EXCEPTION 'reviewers_must_be_distinct';
    END IF;

    IF (SELECT COUNT(*) FROM vocab_unit_tasks
         WHERE version_id = p_version AND status = 'active') < 4 THEN
        RAISE EXCEPTION 'missing_task_count';
    END IF;

    IF (SELECT COUNT(DISTINCT dimension) FROM vocab_unit_tasks
         WHERE version_id = p_version AND status = 'active') <> 3 THEN
        RAISE EXCEPTION 'missing_task_dimension';
    END IF;

    IF EXISTS (
        SELECT 1 FROM vocab_unit_tasks
         WHERE version_id = p_version
           AND status = 'active'
           AND dimension <> CASE task_type
               WHEN 'meaning_recall' THEN 'meaning_recall'
               WHEN 'error_repair' THEN 'usage_control'
               WHEN 'controlled_gap' THEN 'usage_control'
               WHEN 'productive_transfer' THEN 'productive_transfer'
           END
    ) THEN
        RAISE EXCEPTION 'task_dimension_mismatch';
    END IF;

    UPDATE vocab_unit_versions
       SET status = 'published', published_by = p_published_by,
           published_at = p_now, updated_at = p_now
     WHERE id = p_version
    RETURNING * INTO v_version;

    UPDATE vocab_learning_units
       SET status = 'published', current_published_version_id = p_version,
           updated_at = p_now
     WHERE id = v_version.unit_id
    RETURNING * INTO v_unit;

    INSERT INTO vocab_unit_publication_events
        (unit_id, version_id, action, actor_id, created_at)
    VALUES (v_unit.id, p_version, 'publish', p_published_by, p_now);

    RETURN jsonb_build_object('unit', to_jsonb(v_unit), 'version', to_jsonb(v_version));
END;
$$;

REVOKE ALL ON FUNCTION fn_publish_vocab_unit_version(UUID, UUID, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_publish_vocab_unit_version(UUID, UUID, TIMESTAMPTZ)
    TO service_role;

CREATE OR REPLACE FUNCTION fn_rollback_vocab_unit_version(
    p_unit       UUID,
    p_version    UUID,
    p_updated_by UUID,
    p_now        TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_unit vocab_learning_units%ROWTYPE;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM vocab_unit_versions
         WHERE id = p_version AND unit_id = p_unit AND status = 'published'
    ) THEN
        RAISE EXCEPTION 'published_version_not_found';
    END IF;

    UPDATE vocab_learning_units
       SET current_published_version_id = p_version,
           status = 'published', updated_at = p_now
     WHERE id = p_unit
    RETURNING * INTO v_unit;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit_not_found';
    END IF;

    INSERT INTO vocab_unit_publication_events
        (unit_id, version_id, action, actor_id, created_at)
    VALUES (p_unit, p_version, 'rollback', p_updated_by, p_now);

    RETURN to_jsonb(v_unit);
END;
$$;

REVOKE ALL ON FUNCTION fn_rollback_vocab_unit_version(UUID, UUID, UUID, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_rollback_vocab_unit_version(UUID, UUID, UUID, TIMESTAMPTZ)
    TO service_role;
