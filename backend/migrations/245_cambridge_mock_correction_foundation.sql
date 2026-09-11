-- ============================================================================
-- Migration 245 — Cambridge mock/practice correction foundation
-- ============================================================================
-- Keeps four contracts separate:
--   1. immutable source questions (existing reading/listening tables),
--   2. versioned web explanations,
--   3. append-only learner observations,
--   4. derived correction/diagnosis state.
--
-- Additive and idempotent. No existing question, answer or attempt is rewritten.
-- Migrations 240–244 are reserved by the active Gate-F manifest worktree.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS web_explanation_objects (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id           TEXT NOT NULL,
    content_version     TEXT NOT NULL,
    source_test_key     TEXT NOT NULL,
    skill               TEXT NOT NULL CHECK (skill IN ('reading', 'listening')),
    book_number         INTEGER NOT NULL CHECK (book_number BETWEEN 13 AND 21),
    test_number         INTEGER NOT NULL CHECK (test_number BETWEEN 1 AND 4),
    question_number     INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 40),
    reading_test_id     UUID REFERENCES reading_tests(id) ON DELETE SET NULL,
    listening_test_id   UUID REFERENCES listening_tests(id) ON DELETE SET NULL,
    payload             JSONB NOT NULL,
    source_hash         TEXT NOT NULL,
    audit_verdict       TEXT NOT NULL,
    rights_status       TEXT NOT NULL,
    editorial_status    TEXT NOT NULL,
    serving_status      TEXT NOT NULL,
    is_current          BOOLEAN NOT NULL DEFAULT FALSE,
    import_batch_id     UUID NOT NULL DEFAULT gen_random_uuid(),
    imported_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (object_id, content_version),
    CONSTRAINT web_explanation_object_identity CHECK (
        object_id ~ '^cambridge-(1[3-9]|20|21)-test-[1-4]-(reading|listening)-q[0-9]{2}$'
    ),
    CONSTRAINT web_explanation_test_link CHECK (
        (skill = 'reading' AND reading_test_id IS NOT NULL AND listening_test_id IS NULL)
        OR
        (skill = 'listening' AND listening_test_id IS NOT NULL AND reading_test_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_web_explanation_current_object
    ON web_explanation_objects (object_id)
    WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_web_explanation_reading_test
    ON web_explanation_objects (reading_test_id, question_number)
    WHERE reading_test_id IS NOT NULL AND is_current;
CREATE INDEX IF NOT EXISTS idx_web_explanation_listening_test
    ON web_explanation_objects (listening_test_id, question_number)
    WHERE listening_test_id IS NOT NULL AND is_current;
CREATE INDEX IF NOT EXISTS idx_web_explanation_release_queue
    ON web_explanation_objects (content_version, rights_status, editorial_status, serving_status);

CREATE OR REPLACE FUNCTION fn_activate_web_explanation_version(
    p_content_version TEXT,
    p_expected_count INTEGER DEFAULT 2880
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Count separately so duplicate object ids can never make a partial version
    -- look complete. The UNIQUE constraint catches duplicates inside a version;
    -- this guard documents and enforces the 36 x 2 x 40 collection contract.
    IF (SELECT COUNT(*) FROM web_explanation_objects WHERE content_version = p_content_version)
       <> p_expected_count
       OR (SELECT COUNT(DISTINCT object_id) FROM web_explanation_objects
            WHERE content_version = p_content_version) <> p_expected_count THEN
        RAISE EXCEPTION 'web_explanation_version_incomplete' USING ERRCODE = '23514';
    END IF;

    UPDATE web_explanation_objects SET is_current = FALSE
     WHERE is_current AND content_version <> p_content_version;
    UPDATE web_explanation_objects SET is_current = TRUE
     WHERE content_version = p_content_version AND NOT is_current;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Admin-selected delivery/release policy. Defaults preserve current behaviour:
-- Cambridge papers remain reserved and web explanations remain hidden.
ALTER TABLE reading_tests
    ADD COLUMN IF NOT EXISTS public_practice_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS web_explanation_mode TEXT NOT NULL DEFAULT 'disabled',
    ADD COLUMN IF NOT EXISTS web_explanations_released_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS web_explanations_released_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS web_explanation_content_version TEXT;

ALTER TABLE listening_tests
    ADD COLUMN IF NOT EXISTS public_practice_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS web_explanation_mode TEXT NOT NULL DEFAULT 'disabled',
    ADD COLUMN IF NOT EXISTS web_explanations_released_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS web_explanations_released_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS web_explanation_content_version TEXT;

ALTER TABLE mock_exams
    ADD COLUMN IF NOT EXISTS web_explanation_mode TEXT NOT NULL DEFAULT 'with_result',
    ADD COLUMN IF NOT EXISTS web_explanations_released_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS web_explanations_released_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS web_explanation_content_version TEXT,
    ADD COLUMN IF NOT EXISTS post_test_capture_required BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'reading_tests_web_explanation_mode_check'
    ) THEN
        ALTER TABLE reading_tests ADD CONSTRAINT reading_tests_web_explanation_mode_check
            CHECK (web_explanation_mode IN ('disabled', 'immediate_after_capture', 'admin_release'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'listening_tests_web_explanation_mode_check'
    ) THEN
        ALTER TABLE listening_tests ADD CONSTRAINT listening_tests_web_explanation_mode_check
            CHECK (web_explanation_mode IN ('disabled', 'immediate_after_capture', 'admin_release'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'mock_exams_web_explanation_mode_check'
    ) THEN
        ALTER TABLE mock_exams ADD CONSTRAINT mock_exams_web_explanation_mode_check
            CHECK (web_explanation_mode IN ('disabled', 'with_result', 'admin_release'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS mock_item_attempts (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learner_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill                       TEXT NOT NULL CHECK (skill IN ('reading', 'listening')),
    reading_attempt_id          UUID REFERENCES reading_test_attempts(id) ON DELETE CASCADE,
    listening_attempt_id        UUID REFERENCES listening_test_attempts(id) ON DELETE CASCADE,
    object_id                   TEXT,
    question_number             INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 40),
    first_committed_answer      JSONB,
    final_submitted_answer      JSONB,
    first_answer_at             TIMESTAMPTZ,
    last_answer_at              TIMESTAMPTZ,
    revision_count              INTEGER NOT NULL DEFAULT 0 CHECK (revision_count >= 0),
    flagged                     BOOLEAN NOT NULL DEFAULT FALSE,
    post_test_confidence        SMALLINT CHECK (post_test_confidence BETWEEN 1 AND 5),
    pre_reveal_self_attribution JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_correct                  BOOLEAN,
    score_awarded               NUMERIC,
    explanation_content_version TEXT,
    submitted_at                TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (reading_attempt_id, question_number),
    UNIQUE (listening_attempt_id, question_number),
    CONSTRAINT mock_item_attempt_link CHECK (
        (skill = 'reading' AND reading_attempt_id IS NOT NULL AND listening_attempt_id IS NULL)
        OR
        (skill = 'listening' AND listening_attempt_id IS NOT NULL AND reading_attempt_id IS NULL)
    ),
    CONSTRAINT mock_item_attribution_array CHECK (
        jsonb_typeof(pre_reveal_self_attribution) = 'array'
        AND jsonb_array_length(pre_reveal_self_attribution) <= 2
    )
);

CREATE INDEX IF NOT EXISTS idx_mock_item_attempts_learner
    ON mock_item_attempts (learner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mock_item_attempts_object
    ON mock_item_attempts (object_id) WHERE object_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_mock_item_attempts_updated_at ON mock_item_attempts;
CREATE TRIGGER update_mock_item_attempts_updated_at
    BEFORE UPDATE ON mock_item_attempts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS mock_post_test_captures (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learner_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill                 TEXT NOT NULL CHECK (skill IN ('reading', 'listening')),
    reading_attempt_id    UUID REFERENCES reading_test_attempts(id) ON DELETE CASCADE,
    listening_attempt_id  UUID REFERENCES listening_test_attempts(id) ON DELETE CASCADE,
    status                TEXT NOT NULL CHECK (status IN ('completed', 'skipped')),
    payload_hash          TEXT NOT NULL,
    item_count            INTEGER NOT NULL DEFAULT 0 CHECK (item_count BETWEEN 0 AND 40),
    skipped_reason        TEXT,
    completed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (reading_attempt_id),
    UNIQUE (listening_attempt_id),
    CONSTRAINT mock_post_test_capture_link CHECK (
        (skill = 'reading' AND reading_attempt_id IS NOT NULL AND listening_attempt_id IS NULL)
        OR
        (skill = 'listening' AND listening_attempt_id IS NOT NULL AND reading_attempt_id IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS mock_runtime_events (
    event_id             UUID PRIMARY KEY,
    event_name           TEXT NOT NULL,
    schema_version       TEXT NOT NULL DEFAULT 'runtime-event/1.0',
    learner_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mock_session_id      UUID,
    reading_attempt_id   UUID REFERENCES reading_test_attempts(id) ON DELETE CASCADE,
    listening_attempt_id UUID REFERENCES listening_test_attempts(id) ON DELETE CASCADE,
    object_id            TEXT,
    sequence_no          BIGINT,
    client_occurred_at   TIMESTAMPTZ,
    server_received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_version       TEXT,
    payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT mock_runtime_event_attempt_link CHECK (
        NOT (reading_attempt_id IS NOT NULL AND listening_attempt_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_mock_runtime_events_reading
    ON mock_runtime_events (reading_attempt_id, server_received_at)
    WHERE reading_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mock_runtime_events_listening
    ON mock_runtime_events (listening_attempt_id, server_received_at)
    WHERE listening_attempt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mock_runtime_event_sequence
    ON mock_runtime_events (mock_session_id, sequence_no)
    WHERE mock_session_id IS NOT NULL AND sequence_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS mock_correction_sessions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learner_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_attempt_id       UUID NOT NULL REFERENCES mock_item_attempts(id) ON DELETE CASCADE,
    state                 TEXT NOT NULL DEFAULT 'RESULT_ONLY' CHECK (state IN (
        'RESULT_ONLY', 'EVIDENCE_ATTEMPTED', 'LOCATION_HINT_SEEN',
        'DECISIVE_HINT_SEEN', 'FULL_EXPLANATION_SEEN',
        'CORRECTION_OUTPUT_SUBMITTED', 'CORRECTION_VERIFIED',
        'TRANSFER_PASSED', 'RETEST_SCHEDULED', 'MASTERED', 'REOPENED'
    )),
    evidence_response     TEXT,
    corrected_answer      TEXT,
    error_mechanism       TEXT,
    next_action           TEXT,
    same_source_passed    BOOLEAN,
    transfer_passed       BOOLEAN,
    delayed_retest_at     TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (item_attempt_id)
);

DROP TRIGGER IF EXISTS update_mock_correction_sessions_updated_at ON mock_correction_sessions;
CREATE TRIGGER update_mock_correction_sessions_updated_at
    BEFORE UPDATE ON mock_correction_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS mock_error_hypotheses (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learner_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_code            TEXT NOT NULL,
    error_subtype_code    TEXT NOT NULL,
    state                 TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (state IN (
        'PROPOSED', 'SUPPORTED', 'CONFIRMED', 'REJECTED',
        'INSUFFICIENT_EVIDENCE', 'MASTERED_PROVISIONAL',
        'MASTERED_STABLE', 'REOPENED'
    )),
    classification_confidence NUMERIC(4,3) CHECK (
        classification_confidence IS NULL
        OR (classification_confidence >= 0 AND classification_confidence <= 1)
    ),
    evidence_ids          JSONB NOT NULL DEFAULT '[]'::jsonb,
    rule_id               TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mock_error_hypotheses_learner
    ON mock_error_hypotheses (learner_id, state, updated_at DESC);

DROP TRIGGER IF EXISTS update_mock_error_hypotheses_updated_at ON mock_error_hypotheses;
CREATE TRIGGER update_mock_error_hypotheses_updated_at
    BEFORE UPDATE ON mock_error_hypotheses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS mock_correction_release_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type      TEXT NOT NULL CHECK (scope_type IN (
        'class_assignment', 'mock_exam', 'reading_test', 'listening_test', 'content_version'
    )),
    scope_id        TEXT NOT NULL,
    action          TEXT NOT NULL,
    previous_state  JSONB NOT NULL DEFAULT '{}'::jsonb,
    new_state       JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason          TEXT,
    actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mock_correction_release_scope
    ON mock_correction_release_events (scope_type, scope_id, created_at DESC);

-- Atomic first/final answer observation. Canonical answer persistence remains
-- in the existing domain table; this RPC records learning evidence only.
CREATE OR REPLACE FUNCTION fn_record_mock_item_answer(
    p_skill TEXT,
    p_attempt_id UUID,
    p_learner_id UUID,
    p_question_number INTEGER,
    p_answer TEXT,
    p_client_occurred_at TIMESTAMPTZ DEFAULT NULL,
    p_event_id UUID DEFAULT gen_random_uuid()
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := COALESCE(p_client_occurred_at, NOW());
    v_existing mock_item_attempts%ROWTYPE;
BEGIN
    IF p_skill NOT IN ('reading', 'listening') OR p_question_number NOT BETWEEN 1 AND 40 THEN
        RAISE EXCEPTION 'mock_item_answer_invalid' USING ERRCODE = '22023';
    END IF;

    IF p_skill = 'reading' THEN
        IF NOT EXISTS (
            SELECT 1 FROM reading_test_attempts
             WHERE id = p_attempt_id AND user_id = p_learner_id AND status = 'in_progress'
        ) THEN
            RETURN FALSE;
        END IF;
        SELECT * INTO v_existing FROM mock_item_attempts
         WHERE reading_attempt_id = p_attempt_id AND question_number = p_question_number
         FOR UPDATE;
        IF NOT FOUND THEN
            INSERT INTO mock_item_attempts (
                learner_id, skill, reading_attempt_id, question_number,
                first_committed_answer, final_submitted_answer,
                first_answer_at, last_answer_at
            ) VALUES (
                p_learner_id, p_skill, p_attempt_id, p_question_number,
                to_jsonb(p_answer), to_jsonb(p_answer), v_now, v_now
            );
        ELSE
            UPDATE mock_item_attempts SET
                final_submitted_answer = to_jsonb(p_answer),
                last_answer_at = v_now,
                revision_count = revision_count +
                    CASE WHEN final_submitted_answer IS DISTINCT FROM to_jsonb(p_answer) THEN 1 ELSE 0 END
             WHERE id = v_existing.id;
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM listening_test_attempts
             WHERE id = p_attempt_id AND user_id = p_learner_id AND status = 'in_progress'
        ) THEN
            RETURN FALSE;
        END IF;
        SELECT * INTO v_existing FROM mock_item_attempts
         WHERE listening_attempt_id = p_attempt_id AND question_number = p_question_number
         FOR UPDATE;
        IF NOT FOUND THEN
            INSERT INTO mock_item_attempts (
                learner_id, skill, listening_attempt_id, question_number,
                first_committed_answer, final_submitted_answer,
                first_answer_at, last_answer_at
            ) VALUES (
                p_learner_id, p_skill, p_attempt_id, p_question_number,
                to_jsonb(p_answer), to_jsonb(p_answer), v_now, v_now
            );
        ELSE
            UPDATE mock_item_attempts SET
                final_submitted_answer = to_jsonb(p_answer),
                last_answer_at = v_now,
                revision_count = revision_count +
                    CASE WHEN final_submitted_answer IS DISTINCT FROM to_jsonb(p_answer) THEN 1 ELSE 0 END
             WHERE id = v_existing.id;
        END IF;
    END IF;

    INSERT INTO mock_runtime_events (
        event_id, event_name, learner_id, reading_attempt_id,
        listening_attempt_id, client_occurred_at, payload
    ) VALUES (
        p_event_id, 'answer_committed', p_learner_id,
        CASE WHEN p_skill = 'reading' THEN p_attempt_id END,
        CASE WHEN p_skill = 'listening' THEN p_attempt_id END,
        p_client_occurred_at,
        jsonb_build_object('question_number', p_question_number, 'answer', p_answer)
    ) ON CONFLICT (event_id) DO NOTHING;
    RETURN TRUE;
END;
$$;

-- Service-role only. Student-facing APIs validate ownership before calling the
-- security-definer RPC; clients never receive direct table access.
ALTER TABLE web_explanation_objects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_item_attempts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_post_test_captures          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_runtime_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_correction_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_error_hypotheses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_correction_release_events   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'web_explanation_objects', 'mock_item_attempts',
        'mock_post_test_captures', 'mock_runtime_events',
        'mock_correction_sessions', 'mock_error_hypotheses',
        'mock_correction_release_events'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS deny_client_roles_%I ON %I', t, t);
        EXECUTE format(
            'CREATE POLICY deny_client_roles_%I ON %I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
            t, t
        );
    END LOOP;
END $$;

GRANT ALL ON TABLE
    web_explanation_objects,
    mock_item_attempts,
    mock_post_test_captures,
    mock_runtime_events,
    mock_correction_sessions,
    mock_error_hypotheses,
    mock_correction_release_events
TO service_role;

REVOKE ALL ON FUNCTION fn_record_mock_item_answer(TEXT, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_record_mock_item_answer(TEXT, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ, UUID)
    TO service_role;
REVOKE ALL ON FUNCTION fn_activate_web_explanation_version(TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_activate_web_explanation_version(TEXT, INTEGER)
    TO service_role;

COMMIT;
