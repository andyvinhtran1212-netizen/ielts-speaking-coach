-- Migration 228 — restore idempotent individual Writing assignment creation.
--
-- Migration 227 added optional cohort provenance to the shared idempotency
-- RPC, but incorrectly required every request payload to contain cohort_id.
-- Individual gives intentionally have no cohort origin. Keep cohort_id NULL
-- for those requests and run roster locking only for cohort fan-outs.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_create_writing_assignments_idempotent(
    p_request_id uuid,
    p_assigned_by uuid,
    p_request_payload jsonb,
    p_prompt_ids uuid[],
    p_student_ids uuid[],
    p_name text DEFAULT NULL,
    p_allow_soft_check boolean DEFAULT false,
    p_deadline timestamptz DEFAULT NULL,
    p_instructions text DEFAULT NULL,
    p_is_timed boolean DEFAULT false,
    p_time_limit_minutes integer DEFAULT NULL,
    p_analysis_level integer DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing_assigned_by uuid;
    v_existing_payload jsonb;
    v_receipt jsonb;
    v_group_id uuid := gen_random_uuid();
    v_duplicates jsonb := '[]'::jsonb;
    v_created jsonb := '[]'::jsonb;
    v_cohort_id uuid;
BEGIN
    IF p_request_id IS NULL OR p_assigned_by IS NULL OR p_request_payload IS NULL THEN
        RAISE EXCEPTION 'writing_assignment_request_invalid' USING ERRCODE = '22023';
    END IF;
    BEGIN
        v_cohort_id := NULLIF(p_request_payload->>'cohort_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'writing_assignment_request_cohort_invalid' USING ERRCODE = '22023';
    END;
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
        RETURN v_receipt || jsonb_build_object('replayed', true);
    END IF;

    -- Only cohort fan-outs have a roster contract. Individual gives preserve
    -- NULL cohort provenance and validate only their explicit student_ids.
    IF v_cohort_id IS NOT NULL THEN
        PERFORM m.id
          FROM student_cohort_memberships m
          JOIN unnest(p_student_ids) AS wanted(student_id)
            ON wanted.student_id = m.student_id
         WHERE m.cohort_id = v_cohort_id AND m.is_active
         FOR SHARE OF m;
        IF EXISTS (
            SELECT 1 FROM unnest(p_student_ids) AS wanted(student_id)
             WHERE NOT EXISTS (
                 SELECT 1 FROM student_cohort_memberships m
                  WHERE m.student_id = wanted.student_id
                    AND m.cohort_id = v_cohort_id AND m.is_active
             )
        ) THEN
            RAISE EXCEPTION 'writing_assignment_request_roster_changed' USING ERRCODE = '40001';
        END IF;
    END IF;

    SELECT COALESCE(jsonb_agg(DISTINCT student_id::text), '[]'::jsonb)
      INTO v_duplicates
      FROM writing_assignments
     WHERE prompt_id = ANY(p_prompt_ids)
       AND student_id = ANY(p_student_ids);

    WITH inserted AS (
        INSERT INTO writing_assignments(
            prompt_id, student_id, cohort_id, assignment_group_id, name,
            allow_soft_check, assigned_by, deadline, instructions,
            is_timed, time_limit_minutes, analysis_level
        )
        SELECT prompt_id, student_id, v_cohort_id, v_group_id, p_name,
               p_allow_soft_check, p_assigned_by, p_deadline, p_instructions,
               p_is_timed, p_time_limit_minutes, p_analysis_level
          FROM unnest(p_student_ids) AS student_rows(student_id)
          CROSS JOIN unnest(p_prompt_ids) AS prompt_rows(prompt_id)
        RETURNING id
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
      INTO v_created FROM inserted;

    v_receipt := jsonb_build_object(
        'created', v_created,
        'assignment_ids', (SELECT COALESCE(jsonb_agg(item->>'id'), '[]'::jsonb)
                             FROM jsonb_array_elements(v_created) AS item),
        'created_count', jsonb_array_length(v_created),
        'student_count', array_length(p_student_ids, 1),
        'group_id', v_group_id,
        'duplicates_warning', v_duplicates,
        'replayed', false
    );

    UPDATE writing_assignment_requests
       SET receipt = v_receipt, updated_at = now()
     WHERE id = p_request_id;
    RETURN v_receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_writing_assignments_idempotent(
    uuid, uuid, jsonb, uuid[], uuid[], text, boolean, timestamptz,
    text, boolean, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_writing_assignments_idempotent(
    uuid, uuid, jsonb, uuid[], uuid[], text, boolean, timestamptz,
    text, boolean, integer, integer
) TO service_role;

COMMIT;
