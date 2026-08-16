-- Migration: 206_writing_assignment_idempotency.sql
-- Mô tả: idempotent admin Writing fan-out. A retry with the same client
-- request UUID returns the first receipt instead of inserting the Cartesian
-- product a second time. Additive; legacy callers without request_id keep the
-- existing route path.

CREATE TABLE IF NOT EXISTS writing_assignment_requests (
    id              UUID PRIMARY KEY,
    assigned_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    request_payload JSONB NOT NULL,
    receipt         JSONB,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_writing_assignment_requests_assigned_by
    ON writing_assignment_requests(assigned_by, created_at DESC);

ALTER TABLE writing_assignment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS writing_assignment_requests_admin_all ON writing_assignment_requests;
CREATE POLICY writing_assignment_requests_admin_all ON writing_assignment_requests
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

CREATE OR REPLACE FUNCTION public.fn_create_writing_assignments_idempotent(
    p_request_id UUID,
    p_assigned_by UUID,
    p_request_payload JSONB,
    p_prompt_ids UUID[],
    p_student_ids UUID[],
    p_name TEXT DEFAULT NULL,
    p_allow_soft_check BOOLEAN DEFAULT FALSE,
    p_deadline TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_instructions TEXT DEFAULT NULL,
    p_is_timed BOOLEAN DEFAULT FALSE,
    p_time_limit_minutes INTEGER DEFAULT NULL,
    p_analysis_level INTEGER DEFAULT 3
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing_assigned_by UUID;
    v_existing_payload JSONB;
    v_receipt JSONB;
    v_group_id UUID := gen_random_uuid();
    v_duplicates JSONB := '[]'::JSONB;
    v_created JSONB := '[]'::JSONB;
BEGIN
    IF p_request_id IS NULL OR p_assigned_by IS NULL OR p_request_payload IS NULL THEN
        RAISE EXCEPTION 'writing_assignment_request_invalid' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(array_length(p_prompt_ids, 1), 0) < 1
       OR COALESCE(array_length(p_prompt_ids, 1), 0) > 20
       OR COALESCE(array_length(p_student_ids, 1), 0) < 1
       OR COALESCE(array_length(p_student_ids, 1), 0) > 10000 THEN
        RAISE EXCEPTION 'writing_assignment_request_cardinality_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_analysis_level NOT BETWEEN 1 AND 5
       OR (p_is_timed AND (p_time_limit_minutes IS NULL OR p_time_limit_minutes NOT BETWEEN 1 AND 180))
       OR (NOT p_is_timed AND p_time_limit_minutes IS NOT NULL) THEN
        RAISE EXCEPTION 'writing_assignment_request_options_invalid' USING ERRCODE = '22023';
    END IF;

    INSERT INTO writing_assignment_requests(id, assigned_by, request_payload)
    VALUES (p_request_id, p_assigned_by, p_request_payload)
    ON CONFLICT (id) DO NOTHING;

    IF NOT FOUND THEN
        SELECT assigned_by, request_payload, receipt
          INTO v_existing_assigned_by, v_existing_payload, v_receipt
          FROM writing_assignment_requests
         WHERE id = p_request_id
         FOR UPDATE;
        IF NOT FOUND OR v_existing_assigned_by IS DISTINCT FROM p_assigned_by THEN
            RAISE EXCEPTION 'writing_assignment_request_owned_by_other_admin' USING ERRCODE = '42501';
        END IF;
        IF v_existing_payload IS DISTINCT FROM p_request_payload THEN
            RAISE EXCEPTION 'writing_assignment_request_payload_mismatch' USING ERRCODE = '22023';
        END IF;
        IF v_receipt IS NULL THEN
            RAISE EXCEPTION 'writing_assignment_request_incomplete' USING ERRCODE = '55000';
        END IF;
        RETURN v_receipt || jsonb_build_object('replayed', TRUE);
    END IF;

    SELECT COALESCE(jsonb_agg(DISTINCT student_id::TEXT), '[]'::JSONB)
      INTO v_duplicates
      FROM writing_assignments
     WHERE prompt_id = ANY(p_prompt_ids)
       AND student_id = ANY(p_student_ids);

    WITH inserted AS (
        INSERT INTO writing_assignments(
            prompt_id, student_id, assignment_group_id, name,
            allow_soft_check, assigned_by, deadline, instructions,
            is_timed, time_limit_minutes, analysis_level
        )
        SELECT prompt_id, student_id, v_group_id, p_name,
               p_allow_soft_check, p_assigned_by, p_deadline, p_instructions,
               p_is_timed, p_time_limit_minutes, p_analysis_level
          FROM unnest(p_student_ids) AS student_rows(student_id)
          CROSS JOIN unnest(p_prompt_ids) AS prompt_rows(prompt_id)
        RETURNING id
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(inserted)), '[]'::JSONB)
      INTO v_created
      FROM inserted;

    v_receipt := jsonb_build_object(
        'created', v_created,
        'assignment_ids', (SELECT COALESCE(jsonb_agg(item->>'id'), '[]'::JSONB) FROM jsonb_array_elements(v_created) AS item),
        'created_count', jsonb_array_length(v_created),
        'student_count', array_length(p_student_ids, 1),
        'group_id', v_group_id,
        'duplicates_warning', v_duplicates,
        'replayed', FALSE
    );

    UPDATE writing_assignment_requests
       SET receipt = v_receipt, updated_at = NOW()
     WHERE id = p_request_id;
    RETURN v_receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_verify_writing_assignment_request(
    p_request_id UUID,
    p_assigned_by UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_owner UUID;
    v_receipt JSONB;
    v_group_id UUID;
    v_expected_count INTEGER;
    v_current_ids JSONB;
BEGIN
    SELECT assigned_by, receipt
      INTO v_owner, v_receipt
      FROM writing_assignment_requests
     WHERE id = p_request_id;

    IF NOT FOUND OR v_owner IS DISTINCT FROM p_assigned_by THEN
        RAISE EXCEPTION 'writing_assignment_request_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_receipt IS NULL
       OR jsonb_typeof(v_receipt->'assignment_ids') IS DISTINCT FROM 'array'
       OR jsonb_typeof(v_receipt->'created_count') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_receipt->'group_id') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'writing_assignment_request_receipt_malformed' USING ERRCODE = '22023';
    END IF;

    v_group_id := (v_receipt->>'group_id')::UUID;
    v_expected_count := (v_receipt->>'created_count')::INTEGER;
    SELECT COALESCE(jsonb_agg(expected.assignment_id ORDER BY expected.assignment_id), '[]'::JSONB)
      INTO v_current_ids
      FROM jsonb_array_elements_text(v_receipt->'assignment_ids') AS expected(assignment_id)
      JOIN writing_assignments AS assignment
        ON assignment.id = expected.assignment_id::UUID
       AND assignment.assignment_group_id = v_group_id;

    RETURN jsonb_build_object(
        'request_id', p_request_id,
        'group_id', v_group_id,
        'expected_count', v_expected_count,
        'assignment_ids', v_current_ids
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_writing_assignments_idempotent(
    UUID, UUID, JSONB, UUID[], UUID[], TEXT, BOOLEAN, TIMESTAMP WITH TIME ZONE,
    TEXT, BOOLEAN, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_writing_assignments_idempotent(
    UUID, UUID, JSONB, UUID[], UUID[], TEXT, BOOLEAN, TIMESTAMP WITH TIME ZONE,
    TEXT, BOOLEAN, INTEGER, INTEGER
) TO service_role;

REVOKE ALL ON FUNCTION public.fn_verify_writing_assignment_request(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_verify_writing_assignment_request(UUID, UUID)
    TO service_role;

COMMENT ON TABLE writing_assignment_requests IS
    'Idempotency ledger for admin Writing assignment fan-out. Receipt and request payload are immutable evidence for safe POST retries.';
