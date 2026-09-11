-- ============================================================================
-- Migration 257 — durable mock-correction events and canonical state machine
-- ============================================================================
-- Event ids are idempotency keys. State advances are server validated and the
-- event ledger is append-only for the service role. Opening an explanation is
-- deliberately not equivalent to completing a correction.
-- Rollback: remove the RPC/index/columns only before QA events exist; once the
-- ledger contains events this state-machine migration is forward-only.
-- ============================================================================

BEGIN;

-- Environments that already ran the first revision of migration 245 need the
-- same explicit inventory-only state as fresh installs. This never makes an
-- unbound object eligible for learner delivery.
ALTER TABLE web_explanation_objects
    ADD COLUMN IF NOT EXISTS binding_status TEXT NOT NULL DEFAULT 'BOUND';
ALTER TABLE web_explanation_objects
    DROP CONSTRAINT IF EXISTS web_explanation_test_link;
ALTER TABLE web_explanation_objects
    ADD CONSTRAINT web_explanation_test_link CHECK (
        (binding_status = 'UNBOUND_INTERNAL_QA'
            AND reading_test_id IS NULL AND listening_test_id IS NULL)
        OR
        (binding_status = 'BOUND' AND skill = 'reading'
            AND reading_test_id IS NOT NULL AND listening_test_id IS NULL)
        OR
        (binding_status = 'BOUND' AND skill = 'listening'
            AND listening_test_id IS NOT NULL AND reading_test_id IS NULL)
    );

ALTER TABLE mock_runtime_events
    ADD COLUMN IF NOT EXISTS item_attempt_id UUID
        REFERENCES mock_item_attempts(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS correction_session_id UUID
        REFERENCES mock_correction_sessions(id) ON DELETE CASCADE;

ALTER TABLE mock_correction_sessions
    ADD COLUMN IF NOT EXISTS last_sequence_no BIGINT NOT NULL DEFAULT 0
        CHECK (last_sequence_no >= 0);

DROP INDEX IF EXISTS uq_mock_runtime_event_sequence;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mock_runtime_event_correction_sequence
    ON mock_runtime_events (correction_session_id, sequence_no)
    WHERE correction_session_id IS NOT NULL AND sequence_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mock_runtime_events_item_timeline
    ON mock_runtime_events (item_attempt_id, server_received_at, sequence_no)
    WHERE item_attempt_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_record_mock_correction_event(
    p_event_id UUID,
    p_skill TEXT,
    p_attempt_id UUID,
    p_learner_id UUID,
    p_question_number INTEGER,
    p_event_name TEXT,
    p_payload JSONB DEFAULT '{}'::jsonb,
    p_client_occurred_at TIMESTAMPTZ DEFAULT NULL,
    p_client_version TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_item mock_item_attempts%ROWTYPE;
    v_session mock_correction_sessions%ROWTYPE;
    v_existing mock_runtime_events%ROWTYPE;
    v_mock_session_id UUID;
    v_old_rank INTEGER;
    v_target_rank INTEGER;
    v_new_state TEXT;
    v_action_sequence BIGINT;
    v_state_sequence BIGINT;
BEGIN
    IF p_skill NOT IN ('reading', 'listening')
       OR p_question_number NOT BETWEEN 1 AND 40
       OR p_event_name NOT IN (
            'correction_result_seen',
            'evidence_attempt_submitted',
            'hint_revealed',
            'full_explanation_opened',
            'correction_output_submitted'
       ) THEN
        RAISE EXCEPTION 'mock_correction_event_invalid' USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
        RAISE EXCEPTION 'mock_correction_payload_invalid' USING ERRCODE = '22023';
    END IF;

    IF p_skill = 'reading' THEN
        SELECT mia.*
          INTO v_item
          FROM mock_item_attempts mia
          JOIN reading_test_attempts rta ON rta.id = mia.reading_attempt_id
         WHERE mia.reading_attempt_id = p_attempt_id
           AND mia.question_number = p_question_number
           AND mia.learner_id = p_learner_id
           AND mia.skill = p_skill
           AND rta.user_id = p_learner_id
           AND rta.status = 'submitted'
         LIMIT 1;
        SELECT sitting_id INTO v_mock_session_id
          FROM reading_test_attempts WHERE id = p_attempt_id;
    ELSE
        SELECT mia.*
          INTO v_item
          FROM mock_item_attempts mia
          JOIN listening_test_attempts lta ON lta.id = mia.listening_attempt_id
         WHERE mia.listening_attempt_id = p_attempt_id
           AND mia.question_number = p_question_number
           AND mia.learner_id = p_learner_id
           AND mia.skill = p_skill
           AND lta.user_id = p_learner_id
           AND lta.status = 'submitted'
         LIMIT 1;
        SELECT sitting_id INTO v_mock_session_id
          FROM listening_test_attempts WHERE id = p_attempt_id;
    END IF;

    IF v_item.id IS NULL OR v_item.object_id IS NULL THEN
        RAISE EXCEPTION 'mock_correction_item_not_found' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_existing FROM mock_runtime_events WHERE event_id = p_event_id;
    IF FOUND THEN
        IF v_existing.learner_id = p_learner_id
           AND v_existing.item_attempt_id = v_item.id
           AND v_existing.event_name = p_event_name
           AND v_existing.payload = COALESCE(p_payload, '{}'::jsonb) THEN
            SELECT * INTO v_session
              FROM mock_correction_sessions
             WHERE id = v_existing.correction_session_id;
            RETURN jsonb_build_object(
                'replayed', TRUE,
                'event_id', v_existing.event_id,
                'sequence_no', v_existing.sequence_no,
                'state', v_session.state,
                'evidence_response', v_session.evidence_response,
                'correction_session_id', v_session.id
            );
        END IF;
        RAISE EXCEPTION 'mock_correction_event_id_conflict' USING ERRCODE = '23505';
    END IF;

    INSERT INTO mock_correction_sessions (learner_id, item_attempt_id)
    VALUES (p_learner_id, v_item.id)
    ON CONFLICT (item_attempt_id) DO NOTHING;

    SELECT * INTO v_session
      FROM mock_correction_sessions
     WHERE item_attempt_id = v_item.id
     FOR UPDATE;

    v_old_rank := CASE v_session.state
        WHEN 'RESULT_ONLY' THEN 0
        WHEN 'EVIDENCE_ATTEMPTED' THEN 1
        WHEN 'LOCATION_HINT_SEEN' THEN 2
        WHEN 'DECISIVE_HINT_SEEN' THEN 3
        WHEN 'FULL_EXPLANATION_SEEN' THEN 4
        WHEN 'CORRECTION_OUTPUT_SUBMITTED' THEN 5
        WHEN 'CORRECTION_VERIFIED' THEN 6
        WHEN 'TRANSFER_PASSED' THEN 7
        WHEN 'RETEST_SCHEDULED' THEN 8
        WHEN 'MASTERED' THEN 9
        WHEN 'REOPENED' THEN 0
        ELSE 0
    END;
    v_target_rank := v_old_rank;

    IF p_event_name = 'evidence_attempt_submitted' THEN
        IF length(btrim(COALESCE(p_payload->>'evidence_response', ''))) NOT BETWEEN 1 AND 2000 THEN
            RAISE EXCEPTION 'mock_correction_evidence_required' USING ERRCODE = '22023';
        END IF;
        v_target_rank := GREATEST(v_old_rank, 1);
    ELSIF p_event_name = 'hint_revealed' THEN
        IF p_payload->>'hint_type' = 'location' THEN
            IF v_old_rank < 1 THEN
                RAISE EXCEPTION 'mock_correction_transition_requires_evidence' USING ERRCODE = '23514';
            END IF;
            v_target_rank := GREATEST(v_old_rank, 2);
        ELSIF p_payload->>'hint_type' = 'decisive' THEN
            IF v_old_rank < 2 THEN
                RAISE EXCEPTION 'mock_correction_transition_requires_location' USING ERRCODE = '23514';
            END IF;
            v_target_rank := GREATEST(v_old_rank, 3);
        ELSE
            RAISE EXCEPTION 'mock_correction_hint_type_invalid' USING ERRCODE = '22023';
        END IF;
    ELSIF p_event_name = 'full_explanation_opened' THEN
        IF v_old_rank < 3 THEN
            RAISE EXCEPTION 'mock_correction_transition_requires_decisive_hint' USING ERRCODE = '23514';
        END IF;
        v_target_rank := GREATEST(v_old_rank, 4);
    ELSIF p_event_name = 'correction_output_submitted' THEN
        IF v_old_rank < 4 THEN
            RAISE EXCEPTION 'mock_correction_transition_requires_explanation' USING ERRCODE = '23514';
        END IF;
        IF length(btrim(COALESCE(p_payload->>'corrected_answer', ''))) NOT BETWEEN 1 AND 2000
           OR length(btrim(COALESCE(p_payload->>'evidence_response', ''))) NOT BETWEEN 1 AND 2000
           OR length(btrim(COALESCE(p_payload->>'error_mechanism', ''))) NOT BETWEEN 1 AND 1000
           OR length(btrim(COALESCE(p_payload->>'next_action', ''))) NOT BETWEEN 1 AND 1000 THEN
            RAISE EXCEPTION 'mock_correction_output_incomplete' USING ERRCODE = '22023';
        END IF;
        v_target_rank := GREATEST(v_old_rank, 5);
    END IF;

    v_new_state := CASE v_target_rank
        WHEN 0 THEN 'RESULT_ONLY'
        WHEN 1 THEN 'EVIDENCE_ATTEMPTED'
        WHEN 2 THEN 'LOCATION_HINT_SEEN'
        WHEN 3 THEN 'DECISIVE_HINT_SEEN'
        WHEN 4 THEN 'FULL_EXPLANATION_SEEN'
        WHEN 5 THEN 'CORRECTION_OUTPUT_SUBMITTED'
        WHEN 6 THEN 'CORRECTION_VERIFIED'
        WHEN 7 THEN 'TRANSFER_PASSED'
        WHEN 8 THEN 'RETEST_SCHEDULED'
        ELSE 'MASTERED'
    END;

    v_action_sequence := v_session.last_sequence_no + 1;
    INSERT INTO mock_runtime_events (
        event_id, event_name, learner_id, mock_session_id,
        reading_attempt_id, listening_attempt_id, object_id,
        item_attempt_id, correction_session_id, sequence_no,
        client_occurred_at, client_version, payload
    ) VALUES (
        p_event_id, p_event_name, p_learner_id, v_mock_session_id,
        CASE WHEN p_skill = 'reading' THEN p_attempt_id END,
        CASE WHEN p_skill = 'listening' THEN p_attempt_id END,
        v_item.object_id, v_item.id, v_session.id, v_action_sequence,
        p_client_occurred_at, NULLIF(btrim(p_client_version), ''), COALESCE(p_payload, '{}'::jsonb)
    );

    IF p_event_name = 'evidence_attempt_submitted' THEN
        UPDATE mock_correction_sessions
           SET state = v_new_state,
               evidence_response = p_payload->>'evidence_response',
               last_sequence_no = v_action_sequence
         WHERE id = v_session.id;
    ELSIF p_event_name = 'correction_output_submitted' THEN
        UPDATE mock_correction_sessions
           SET state = v_new_state,
               evidence_response = p_payload->>'evidence_response',
               corrected_answer = p_payload->>'corrected_answer',
               error_mechanism = p_payload->>'error_mechanism',
               next_action = p_payload->>'next_action',
               last_sequence_no = v_action_sequence
         WHERE id = v_session.id;
    ELSE
        UPDATE mock_correction_sessions
           SET state = v_new_state,
               last_sequence_no = v_action_sequence
         WHERE id = v_session.id;
    END IF;

    IF v_new_state IS DISTINCT FROM v_session.state THEN
        v_state_sequence := v_action_sequence + 1;
        INSERT INTO mock_runtime_events (
            event_id, event_name, learner_id, mock_session_id,
            reading_attempt_id, listening_attempt_id, object_id,
            item_attempt_id, correction_session_id, sequence_no,
            client_occurred_at, client_version, payload
        ) VALUES (
            gen_random_uuid(), 'correction_state_changed', p_learner_id, v_mock_session_id,
            CASE WHEN p_skill = 'reading' THEN p_attempt_id END,
            CASE WHEN p_skill = 'listening' THEN p_attempt_id END,
            v_item.object_id, v_item.id, v_session.id, v_state_sequence,
            p_client_occurred_at, NULLIF(btrim(p_client_version), ''),
            jsonb_build_object('from_state', v_session.state, 'to_state', v_new_state,
                               'trigger_event_id', p_event_id)
        );
        UPDATE mock_correction_sessions SET last_sequence_no = v_state_sequence
         WHERE id = v_session.id;
    ELSE
        v_state_sequence := v_action_sequence;
    END IF;

    RETURN jsonb_build_object(
        'replayed', FALSE,
        'event_id', p_event_id,
        'sequence_no', v_action_sequence,
        'last_sequence_no', v_state_sequence,
        'state', v_new_state,
        'evidence_response', COALESCE(p_payload->>'evidence_response', v_session.evidence_response),
        'correction_session_id', v_session.id
    );
END;
$$;

REVOKE UPDATE, DELETE, TRUNCATE ON mock_runtime_events FROM service_role;
GRANT SELECT, INSERT ON mock_runtime_events TO service_role;

REVOKE ALL ON TABLE
    web_explanation_objects,
    mock_item_attempts,
    mock_post_test_captures,
    mock_runtime_events,
    mock_correction_sessions,
    mock_error_hypotheses,
    mock_correction_release_events
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION fn_record_mock_correction_event(
    UUID, TEXT, UUID, UUID, INTEGER, TEXT, JSONB, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_record_mock_correction_event(
    UUID, TEXT, UUID, UUID, INTEGER, TEXT, JSONB, TIMESTAMPTZ, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
