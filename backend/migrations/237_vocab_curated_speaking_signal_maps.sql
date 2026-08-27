-- ============================================================================
-- Migration 237 — Structured Speaking signals -> curated vocabulary units
-- ============================================================================
--
-- Speaking recommendations must never be produced by keyword matching free-form
-- feedback. Editors define an exact signal, its positive trigger and its
-- exclusion guidance. The grader emits only generic original/corrected evidence;
-- application code matches it against this private catalog without exposing codes.
-- The replacement RPC re-checks ownership, active mapping and published-unit
-- state transactionally before a recommendation becomes canonical.
--
-- ADDITIVE + idempotent. Apply after migration 236.
-- ============================================================================

CREATE TABLE IF NOT EXISTS vocab_speaking_signal_maps (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_code             TEXT NOT NULL UNIQUE
                                CHECK (char_length(signal_code) BETWEEN 3 AND 120)
                                CHECK (signal_code ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
    unit_id                 UUID NOT NULL REFERENCES vocab_learning_units(id) ON DELETE CASCADE,
    trigger_description     TEXT NOT NULL
                                CHECK (char_length(trigger_description) BETWEEN 20 AND 500),
    exclusion_description   TEXT NOT NULL
                                CHECK (char_length(exclusion_description) BETWEEN 20 AND 500),
    match_spec              JSONB NOT NULL
                                CHECK (jsonb_typeof(match_spec) = 'object')
                                CHECK (match_spec ?& ARRAY[
                                    'issue_type', 'original_pattern', 'corrected_pattern'
                                ])
                                CHECK (match_spec->>'issue_type' IN (
                                    'meaning', 'word_choice', 'preposition',
                                    'verb_frame', 'parallelism'
                                ))
                                CHECK (char_length(match_spec->>'original_pattern') BETWEEN 1 AND 240)
                                CHECK (char_length(match_spec->>'corrected_pattern') BETWEEN 1 AND 240)
                                CHECK (
                                    NOT match_spec ? 'require_distinct_match'
                                    OR jsonb_typeof(match_spec->'require_distinct_match') = 'boolean'
                                ),
    reason_vi               TEXT NOT NULL
                                CHECK (char_length(reason_vi) BETWEEN 20 AND 500),
    priority                INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
    status                  TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'inactive')),
    created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vocab_speaking_signal_maps_unit_code_key UNIQUE (unit_id, signal_code)
);

CREATE INDEX IF NOT EXISTS idx_vocab_speaking_signal_maps_status
    ON vocab_speaking_signal_maps(status, signal_code);
CREATE INDEX IF NOT EXISTS idx_vocab_speaking_signal_maps_unit
    ON vocab_speaking_signal_maps(unit_id);
CREATE INDEX IF NOT EXISTS idx_vocab_speaking_signal_maps_creator
    ON vocab_speaking_signal_maps(created_by)
    WHERE created_by IS NOT NULL;

DROP TRIGGER IF EXISTS trg_vocab_speaking_signal_maps_updated_at
    ON vocab_speaking_signal_maps;
CREATE TRIGGER trg_vocab_speaking_signal_maps_updated_at
    BEFORE UPDATE ON vocab_speaking_signal_maps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE vocab_speaking_signal_maps ENABLE ROW LEVEL SECURITY;

ALTER TABLE vocab_unit_recommendations
    ADD COLUMN IF NOT EXISTS speaking_signal_map_id UUID
        REFERENCES vocab_speaking_signal_maps(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_response_id UUID
        REFERENCES responses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS match_confidence TEXT
        CHECK (match_confidence IS NULL OR match_confidence IN ('high', 'medium', 'low'));

CREATE INDEX IF NOT EXISTS idx_vocab_unit_recommendations_response
    ON vocab_unit_recommendations(source_response_id)
    WHERE source_response_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vocab_unit_recommendations_signal_map
    ON vocab_unit_recommendations(speaking_signal_map_id)
    WHERE speaking_signal_map_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_replace_speaking_vocab_recommendations(
    p_user      UUID,
    p_response  UUID,
    p_rows      JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_unit_ids UUID[] := ARRAY[]::UUID[];
    v_result   JSONB;
BEGIN
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'speaking_vocab_rows_must_be_array';
    END IF;
    IF jsonb_array_length(p_rows) > 2 THEN
        RAISE EXCEPTION 'speaking_vocab_rows_exceed_limit';
    END IF;

    PERFORM 1
      FROM responses response
      JOIN sessions session ON session.id = response.session_id
     WHERE response.id = p_response
       AND session.user_id = p_user
     FOR SHARE OF response, session;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'speaking_response_not_owned';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_rows) payload
          LEFT JOIN vocab_speaking_signal_maps mapping
            ON mapping.id = (payload->>'mapping_id')::UUID
           AND mapping.signal_code = payload->>'signal_code'
           AND mapping.unit_id = (payload->>'unit_id')::UUID
           AND mapping.status = 'active'
          LEFT JOIN vocab_learning_units unit ON unit.id = mapping.unit_id
         WHERE mapping.id IS NULL
            OR unit.status <> 'published'
            OR unit.current_published_version_id IS NULL
            OR payload->>'confidence' <> 'high'
            OR NULLIF(payload->>'id', '') IS NULL
    ) THEN
        RAISE EXCEPTION 'speaking_vocab_mapping_not_publishable';
    END IF;

    IF (
        SELECT COUNT(DISTINCT (payload->>'unit_id')::UUID)
          FROM jsonb_array_elements(p_rows) payload
    ) <> jsonb_array_length(p_rows) THEN
        RAISE EXCEPTION 'speaking_vocab_duplicate_unit';
    END IF;

    SELECT COALESCE(array_agg((payload->>'unit_id')::UUID), ARRAY[]::UUID[])
      INTO v_unit_ids
      FROM jsonb_array_elements(p_rows) payload;

    -- A re-grade replaces only still-actionable derived rows from this response.
    -- Completed/dismissed history is immutable evidence and is never reopened;
    -- stale pending/opened rows are deleted so the same signal may legitimately
    -- reappear after a later recording without inheriting an automatic dismissal.
    DELETE FROM vocab_unit_recommendations
     WHERE user_id = p_user
       AND source_kind = 'speaking_feedback'
       AND source_id = p_response::TEXT
       AND status IN ('pending', 'opened')
       AND NOT (unit_id = ANY(v_unit_ids));

    INSERT INTO vocab_unit_recommendations (
        id, user_id, unit_id, source_kind, source_id, reason_vi, status,
        speaking_signal_map_id, source_response_id, match_confidence
    )
    SELECT
        (payload->>'id')::UUID,
        p_user,
        mapping.unit_id,
        'speaking_feedback',
        p_response::TEXT,
        mapping.reason_vi,
        'pending',
        mapping.id,
        p_response,
        'high'
      FROM jsonb_array_elements(p_rows) payload
      JOIN vocab_speaking_signal_maps mapping
        ON mapping.id = (payload->>'mapping_id')::UUID
       AND mapping.signal_code = payload->>'signal_code'
       AND mapping.unit_id = (payload->>'unit_id')::UUID
       AND mapping.status = 'active'
    ON CONFLICT (user_id, unit_id, source_kind, source_id)
    DO UPDATE SET
        reason_vi = EXCLUDED.reason_vi,
        speaking_signal_map_id = EXCLUDED.speaking_signal_map_id,
        source_response_id = EXCLUDED.source_response_id,
        match_confidence = EXCLUDED.match_confidence,
        updated_at = NOW();

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'rec_id', recommendation.id,
        'unit_id', recommendation.unit_id,
        'unit_slug', unit.unit_slug,
        'title', unit.display_headword,
        'signal_code', mapping.signal_code,
        'reason_vi', recommendation.reason_vi,
        'status', recommendation.status,
        'confidence', recommendation.match_confidence
    ) ORDER BY recommendation.created_at DESC), '[]'::JSONB)
      INTO v_result
      FROM vocab_unit_recommendations recommendation
      JOIN vocab_learning_units unit ON unit.id = recommendation.unit_id
      JOIN vocab_speaking_signal_maps mapping
        ON mapping.id = recommendation.speaking_signal_map_id
     WHERE recommendation.user_id = p_user
       AND recommendation.source_kind = 'speaking_feedback'
       AND recommendation.source_id = p_response::TEXT
       AND recommendation.status IN ('pending', 'opened')
       AND recommendation.unit_id = ANY(v_unit_ids);

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION fn_replace_speaking_vocab_recommendations(UUID, UUID, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_replace_speaking_vocab_recommendations(UUID, UUID, JSONB)
    TO service_role;
