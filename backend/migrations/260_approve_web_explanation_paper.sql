-- Migration 260 — atomically approve one Reading/Listening explanation paper.
-- Admin enabling web explanation is the editorial/rights approval decision for
-- that paper. Exposure timing remains controlled by class/mock/public policy.

BEGIN;

CREATE OR REPLACE FUNCTION fn_approve_web_explanation_paper(
    p_skill TEXT,
    p_test_id UUID,
    p_actor_id UUID,
    p_content_version TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_version TEXT;
    v_version_count INTEGER;
    v_object_count INTEGER;
    v_question_count INTEGER;
    v_min_question INTEGER;
    v_max_question INTEGER;
    v_blocked_object TEXT;
    v_needs_approval BOOLEAN;
    v_updated INTEGER := 0;
    v_rights_statuses JSONB;
    v_editorial_statuses JSONB;
BEGIN
    IF p_skill NOT IN ('reading', 'listening') THEN
        RAISE EXCEPTION 'unsupported_web_explanation_skill';
    END IF;

    SELECT COUNT(DISTINCT content_version), MIN(content_version)
      INTO v_version_count, v_version
      FROM web_explanation_objects
     WHERE skill = p_skill
       AND is_current IS TRUE
       AND (p_content_version IS NULL OR content_version = p_content_version)
       AND (
            (p_skill = 'reading' AND reading_test_id = p_test_id)
         OR (p_skill = 'listening' AND listening_test_id = p_test_id)
       );

    IF v_version_count <> 1 OR v_version IS NULL THEN
        RAISE EXCEPTION 'web_explanation_content_version_unavailable';
    END IF;

    -- Serialize concurrent enable actions for this paper. After waiting for a
    -- first approver, the second caller observes the approved rows and does
    -- not write a duplicate release event.
    PERFORM 1
      FROM web_explanation_objects
     WHERE skill = p_skill
       AND content_version = v_version
       AND is_current IS TRUE
       AND (
            (p_skill = 'reading' AND reading_test_id = p_test_id)
         OR (p_skill = 'listening' AND listening_test_id = p_test_id)
       )
     ORDER BY question_number
     FOR UPDATE;

    SELECT COUNT(*), COUNT(DISTINCT question_number),
           MIN(question_number), MAX(question_number),
           BOOL_OR(
               rights_status NOT IN ('APPROVED', 'RIGHTS_APPROVED')
               OR editorial_status NOT IN ('APPROVED', 'EDITORIAL_APPROVED')
           ),
           TO_JSONB(ARRAY_AGG(DISTINCT rights_status ORDER BY rights_status)),
           TO_JSONB(ARRAY_AGG(DISTINCT editorial_status ORDER BY editorial_status))
      INTO v_object_count, v_question_count, v_min_question, v_max_question,
           v_needs_approval, v_rights_statuses, v_editorial_statuses
      FROM web_explanation_objects
     WHERE skill = p_skill
       AND content_version = v_version
       AND is_current IS TRUE
       AND (
            (p_skill = 'reading' AND reading_test_id = p_test_id)
         OR (p_skill = 'listening' AND listening_test_id = p_test_id)
       );

    IF v_object_count <> 40 OR v_question_count <> 40
       OR v_min_question <> 1 OR v_max_question <> 40 THEN
        RAISE EXCEPTION 'web_explanation_paper_requires_q01_q40';
    END IF;

    SELECT object_id
      INTO v_blocked_object
      FROM web_explanation_objects
     WHERE skill = p_skill
       AND content_version = v_version
       AND is_current IS TRUE
       AND serving_status <> 'ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES'
       AND (
            (p_skill = 'reading' AND reading_test_id = p_test_id)
         OR (p_skill = 'listening' AND listening_test_id = p_test_id)
       )
     ORDER BY question_number
     LIMIT 1;

    IF v_blocked_object IS NOT NULL THEN
        RAISE EXCEPTION 'web_explanation_serving_blocked:%', v_blocked_object;
    END IF;

    SELECT BOOL_OR(
               rights_status NOT IN ('APPROVED', 'RIGHTS_APPROVED')
               OR editorial_status NOT IN ('APPROVED', 'EDITORIAL_APPROVED')
           )
      INTO v_needs_approval
      FROM web_explanation_objects
     WHERE skill = p_skill
       AND content_version = v_version
       AND is_current IS TRUE
       AND (
            (p_skill = 'reading' AND reading_test_id = p_test_id)
         OR (p_skill = 'listening' AND listening_test_id = p_test_id)
       );

    IF v_needs_approval THEN
        UPDATE web_explanation_objects
           SET rights_status = 'APPROVED',
               editorial_status = 'APPROVED'
         WHERE skill = p_skill
           AND content_version = v_version
           AND is_current IS TRUE
           AND (
                (p_skill = 'reading' AND reading_test_id = p_test_id)
             OR (p_skill = 'listening' AND listening_test_id = p_test_id)
           );
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated <> 40 THEN
            RAISE EXCEPTION 'web_explanation_approval_count_mismatch:%', v_updated;
        END IF;

        INSERT INTO mock_correction_release_events (
            scope_type, scope_id, action, previous_state, new_state,
            reason, actor_id
        ) VALUES (
            p_skill || '_test',
            p_test_id::TEXT,
            'paper_content_approved',
            JSONB_BUILD_OBJECT(
                'objects', 40,
                'content_version', v_version,
                'rights_statuses', v_rights_statuses,
                'editorial_statuses', v_editorial_statuses
            ),
            JSONB_BUILD_OBJECT(
                'objects', 40,
                'content_version', v_version,
                'rights_status', 'APPROVED',
                'editorial_status', 'APPROVED'
            ),
            p_reason,
            p_actor_id
        );
    END IF;

    RETURN JSONB_BUILD_OBJECT(
        'content_version', v_version,
        'object_count', 40,
        'approved_now', v_needs_approval
    );
END;
$$;

REVOKE ALL ON FUNCTION fn_approve_web_explanation_paper(
    TEXT, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_approve_web_explanation_paper(
    TEXT, UUID, UUID, TEXT, TEXT
) TO service_role;

-- Replace migration 259's wrapper without changing its signature. The paper
-- approval, class scope, assignment row and recipient fan-out now share the
-- transaction opened by this function call.
CREATE OR REPLACE FUNCTION public.fn_create_scoped_exam_class_assignment(
    p_cohort_id      uuid,
    p_skill          text,
    p_title          text,
    p_scope_kind     text,
    p_lesson_id      uuid        DEFAULT NULL,
    p_content_config jsonb       DEFAULT '{}'::jsonb,
    p_content_id     uuid        DEFAULT NULL,
    p_instructions   text        DEFAULT NULL,
    p_due_at         timestamptz DEFAULT NULL,
    p_publish_at     timestamptz DEFAULT NULL,
    p_status         text        DEFAULT 'published',
    p_assigned_by    uuid        DEFAULT NULL,
    p_kind           text        DEFAULT 'daily',
    p_student_ids    uuid[]      DEFAULT NULL
)
RETURNS TABLE (
    assignment jsonb, student_count integer, unactivated_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_config JSONB := COALESCE(p_content_config, '{}'::JSONB);
    v_policy JSONB := COALESCE(v_config -> 'correction_policy', '{}'::JSONB);
    v_mode TEXT := COALESCE(v_policy ->> 'web_explanation_mode', 'disabled');
    v_approval JSONB;
BEGIN
    IF p_scope_kind NOT IN ('reading', 'listening')
       OR p_skill IS DISTINCT FROM p_scope_kind
       OR p_content_id IS NULL THEN
        RAISE EXCEPTION 'invalid_exam_scope';
    END IF;

    IF p_scope_kind = 'reading' THEN
        PERFORM 1 FROM public.reading_tests
         WHERE id = p_content_id AND status = 'published';
    ELSE
        PERFORM 1 FROM public.listening_tests
         WHERE id = p_content_id AND status = 'published';
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exam_content_not_published';
    END IF;

    IF v_mode <> 'disabled' THEN
        v_approval := public.fn_approve_web_explanation_paper(
            p_scope_kind,
            p_content_id,
            p_assigned_by,
            v_policy ->> 'content_version',
            'enabled_for_class:' || p_cohort_id::TEXT
        );
        v_policy := JSONB_SET(
            v_policy,
            '{content_version}',
            TO_JSONB(v_approval ->> 'content_version'),
            TRUE
        );
        v_config := JSONB_SET(v_config, '{correction_policy}', v_policy, TRUE);
    END IF;

    INSERT INTO public.exam_content_cohorts (
        content_kind, content_id, cohort_id, created_by
    ) VALUES (
        p_scope_kind, p_content_id, p_cohort_id, p_assigned_by
    ) ON CONFLICT (content_kind, content_id, cohort_id) DO NOTHING;

    RETURN QUERY
    SELECT * FROM public.fn_create_class_assignment(
        p_cohort_id      => p_cohort_id,
        p_skill          => p_skill,
        p_title          => p_title,
        p_lesson_id      => p_lesson_id,
        p_content_config => v_config,
        p_content_id     => p_content_id,
        p_instructions   => p_instructions,
        p_due_at         => p_due_at,
        p_publish_at     => p_publish_at,
        p_status         => p_status,
        p_assigned_by    => p_assigned_by,
        p_kind           => p_kind,
        p_student_ids    => p_student_ids
    );
END;
$$;

COMMENT ON FUNCTION public.fn_create_scoped_exam_class_assignment(
    uuid, text, text, text, uuid, jsonb, uuid, text, timestamptz,
    timestamptz, text, uuid, text, uuid[]
) IS 'Atomically approve an enabled Reading/Listening paper, add its class scope, and create the assignment fan-out.';

REVOKE ALL ON FUNCTION public.fn_create_scoped_exam_class_assignment(
    uuid, text, text, text, uuid, jsonb, uuid, text, timestamptz,
    timestamptz, text, uuid, text, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_scoped_exam_class_assignment(
    uuid, text, text, text, uuid, jsonb, uuid, text, timestamptz,
    timestamptz, text, uuid, text, uuid[]
) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_update_class_assignment_explanation_policy(
    p_assignment_id UUID,
    p_patch JSONB,
    p_actor_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_assignment public.class_assignments%ROWTYPE;
    v_config JSONB;
    v_before JSONB;
    v_after JSONB;
    v_mode TEXT;
    v_approval JSONB;
    v_result JSONB;
BEGIN
    SELECT * INTO v_assignment
      FROM public.class_assignments
     WHERE id = p_assignment_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'class_assignment_not_found';
    END IF;
    IF v_assignment.skill NOT IN ('reading', 'listening') THEN
        RAISE EXCEPTION 'unsupported_class_explanation_skill';
    END IF;

    v_config := COALESCE(v_assignment.content_config, '{}'::JSONB);
    v_before := COALESCE(v_config -> 'correction_policy', '{}'::JSONB);
    v_after := v_before || COALESCE(p_patch, '{}'::JSONB);
    v_mode := COALESCE(v_after ->> 'web_explanation_mode', 'disabled');
    IF v_mode NOT IN ('disabled', 'immediate_after_capture', 'admin_release') THEN
        RAISE EXCEPTION 'invalid_class_explanation_mode';
    END IF;

    IF v_mode <> 'disabled' THEN
        v_approval := public.fn_approve_web_explanation_paper(
            v_assignment.skill,
            v_assignment.content_id,
            p_actor_id,
            v_after ->> 'content_version',
            'enabled_for_class_assignment:' || p_assignment_id::TEXT
        );
        v_after := JSONB_SET(
            v_after, '{content_version}',
            TO_JSONB(v_approval ->> 'content_version'), TRUE
        );
    END IF;

    IF COALESCE((p_patch ->> 'release_now')::BOOLEAN, FALSE) THEN
        IF v_mode <> 'admin_release' THEN
            RAISE EXCEPTION 'class_release_requires_admin_release_mode';
        END IF;
        v_after := JSONB_SET(v_after, '{released_at}', TO_JSONB(NOW()), TRUE);
        v_after := JSONB_SET(
            v_after, '{released_by}', TO_JSONB(p_actor_id::TEXT), TRUE
        );
    ELSIF v_mode = 'admin_release' AND (
        v_before ->> 'web_explanation_mode' IS DISTINCT FROM 'admin_release'
        OR v_before ->> 'content_version'
           IS DISTINCT FROM v_after ->> 'content_version'
    ) THEN
        v_after := v_after - 'released_at' - 'released_by';
    END IF;
    v_after := v_after - 'release_now';
    v_config := JSONB_SET(v_config, '{correction_policy}', v_after, TRUE);

    UPDATE public.class_assignments AS a
       SET content_config = v_config
     WHERE a.id = p_assignment_id
     RETURNING TO_JSONB(a.*) INTO v_result;

    INSERT INTO public.mock_correction_release_events (
        scope_type, scope_id, action, previous_state, new_state, actor_id
    ) VALUES (
        'class_assignment', p_assignment_id::TEXT, 'policy_updated',
        v_before, v_after, p_actor_id
    );
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_class_assignment_explanation_policy(
    UUID, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_class_assignment_explanation_policy(
    UUID, JSONB, UUID
) TO service_role;

-- Save the complete mock-exam patch and approve every selected paper in the
-- same transaction. `reading_is_public` and `listening_is_public` are command
-- fields for the source paper, not mock_exams columns.
CREATE OR REPLACE FUNCTION public.fn_update_mock_exam_with_explanation_approval(
    p_exam_id UUID,
    p_patch JSONB,
    p_actor_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_exam public.mock_exams%ROWTYPE;
    v_mode TEXT;
    v_reading_id UUID;
    v_listening_id UUID;
    v_version TEXT;
    v_approval JSONB;
    v_result JSONB;
    v_updated INTEGER;
    v_previous_policy JSONB;
    v_next_released_at TIMESTAMPTZ;
    v_next_released_by UUID;
BEGIN
    SELECT * INTO v_exam
      FROM public.mock_exams
     WHERE id = p_exam_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'mock_exam_not_found';
    END IF;

    v_mode := CASE WHEN p_patch ? 'web_explanation_mode'
        THEN p_patch ->> 'web_explanation_mode'
        ELSE v_exam.web_explanation_mode END;
    v_reading_id := CASE WHEN p_patch ? 'reading_test_id'
        THEN NULLIF(p_patch ->> 'reading_test_id', '')::UUID
        ELSE v_exam.reading_test_id END;
    v_listening_id := CASE WHEN p_patch ? 'listening_test_id'
        THEN NULLIF(p_patch ->> 'listening_test_id', '')::UUID
        ELSE v_exam.listening_test_id END;
    v_version := CASE WHEN p_patch ? 'web_explanation_content_version'
        THEN NULLIF(p_patch ->> 'web_explanation_content_version', '')
        ELSE v_exam.web_explanation_content_version END;

    IF v_mode NOT IN ('disabled', 'with_result', 'admin_release') THEN
        RAISE EXCEPTION 'invalid_mock_explanation_mode';
    END IF;

    v_previous_policy := JSONB_BUILD_OBJECT(
        'web_explanation_mode', v_exam.web_explanation_mode,
        'web_explanations_released_at', v_exam.web_explanations_released_at,
        'web_explanation_content_version', v_exam.web_explanation_content_version,
        'post_test_capture_required', v_exam.post_test_capture_required
    );
    v_next_released_at := v_exam.web_explanations_released_at;
    v_next_released_by := v_exam.web_explanations_released_by;

    IF v_mode <> 'disabled' THEN
        IF v_listening_id IS NOT NULL THEN
            v_approval := public.fn_approve_web_explanation_paper(
                'listening', v_listening_id, p_actor_id, v_version,
                'enabled_for_mock_exam:' || p_exam_id::TEXT
            );
            v_version := v_approval ->> 'content_version';
        END IF;
        IF v_reading_id IS NOT NULL THEN
            v_approval := public.fn_approve_web_explanation_paper(
                'reading', v_reading_id, p_actor_id, v_version,
                'enabled_for_mock_exam:' || p_exam_id::TEXT
            );
            v_version := v_approval ->> 'content_version';
        END IF;
    END IF;

    IF p_patch ? 'reading_is_public' AND v_reading_id IS NOT NULL THEN
        UPDATE public.reading_tests
           SET is_public = (p_patch ->> 'reading_is_public')::BOOLEAN,
               exam_only = FALSE
         WHERE id = v_reading_id;
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated <> 1 THEN
            RAISE EXCEPTION 'mock_reading_visibility_update_failed';
        END IF;
    END IF;
    IF p_patch ? 'listening_is_public' AND v_listening_id IS NOT NULL THEN
        UPDATE public.listening_tests
           SET is_public = (p_patch ->> 'listening_is_public')::BOOLEAN,
               exam_only = FALSE
         WHERE id = v_listening_id;
        GET DIAGNOSTICS v_updated = ROW_COUNT;
        IF v_updated <> 1 THEN
            RAISE EXCEPTION 'mock_listening_visibility_update_failed';
        END IF;
    END IF;

    IF COALESCE((p_patch ->> 'release_now')::BOOLEAN, FALSE) THEN
        IF v_mode <> 'admin_release' THEN
            RAISE EXCEPTION 'mock_release_requires_admin_release_mode';
        END IF;
        v_next_released_at := NOW();
        v_next_released_by := p_actor_id;
    ELSIF v_mode = 'admin_release' AND (
        v_exam.web_explanation_mode IS DISTINCT FROM 'admin_release'
        OR v_exam.web_explanation_content_version IS DISTINCT FROM v_version
    ) THEN
        v_next_released_at := NULL;
        v_next_released_by := NULL;
    END IF;

    UPDATE public.mock_exams AS m
       SET code = CASE WHEN p_patch ? 'code' THEN p_patch ->> 'code' ELSE m.code END,
           title = CASE WHEN p_patch ? 'title' THEN p_patch ->> 'title' ELSE m.title END,
           listening_test_id = v_listening_id,
           reading_test_id = v_reading_id,
           writing_task1_prompt_id = CASE WHEN p_patch ? 'writing_task1_prompt_id' THEN NULLIF(p_patch ->> 'writing_task1_prompt_id', '')::UUID ELSE m.writing_task1_prompt_id END,
           writing_task2_prompt_id = CASE WHEN p_patch ? 'writing_task2_prompt_id' THEN NULLIF(p_patch ->> 'writing_task2_prompt_id', '')::UUID ELSE m.writing_task2_prompt_id END,
           speaking_topic_set = CASE WHEN p_patch ? 'speaking_topic_set' THEN p_patch -> 'speaking_topic_set' ELSE m.speaking_topic_set END,
           total_minutes = CASE WHEN p_patch ? 'total_minutes' THEN (p_patch ->> 'total_minutes')::INTEGER ELSE m.total_minutes END,
           reading_minutes = CASE WHEN p_patch ? 'reading_minutes' THEN (p_patch ->> 'reading_minutes')::INTEGER ELSE m.reading_minutes END,
           writing_minutes = CASE WHEN p_patch ? 'writing_minutes' THEN (p_patch ->> 'writing_minutes')::INTEGER ELSE m.writing_minutes END,
           open_from = CASE WHEN p_patch ? 'open_from' THEN NULLIF(p_patch ->> 'open_from', '')::TIMESTAMPTZ ELSE m.open_from END,
           open_until = CASE WHEN p_patch ? 'open_until' THEN NULLIF(p_patch ->> 'open_until', '')::TIMESTAMPTZ ELSE m.open_until END,
           cohort_id = CASE WHEN p_patch ? 'cohort_id' THEN NULLIF(p_patch ->> 'cohort_id', '')::UUID ELSE m.cohort_id END,
           review_sla_days = CASE WHEN p_patch ? 'review_sla_days' THEN (p_patch ->> 'review_sla_days')::INTEGER ELSE m.review_sla_days END,
           status = CASE WHEN p_patch ? 'status' THEN p_patch ->> 'status' ELSE m.status END,
           web_explanation_mode = v_mode,
           web_explanation_content_version = v_version,
           web_explanations_released_at = v_next_released_at,
           web_explanations_released_by = v_next_released_by,
           post_test_capture_required = CASE WHEN p_patch ? 'post_test_capture_required' THEN (p_patch ->> 'post_test_capture_required')::BOOLEAN ELSE m.post_test_capture_required END
     WHERE m.id = p_exam_id
     RETURNING TO_JSONB(m.*) INTO v_result;

    INSERT INTO public.mock_correction_release_events (
        scope_type, scope_id, action, previous_state, new_state, actor_id
    ) VALUES (
        'mock_exam', p_exam_id::TEXT, 'policy_updated', v_previous_policy,
        JSONB_BUILD_OBJECT(
            'web_explanation_mode', v_mode,
            'web_explanations_released_at', v_next_released_at,
            'web_explanation_content_version', v_version,
            'post_test_capture_required',
                COALESCE((v_result ->> 'post_test_capture_required')::BOOLEAN, TRUE)
        ),
        p_actor_id
    );

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_mock_exam_with_explanation_approval(
    UUID, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_mock_exam_with_explanation_approval(
    UUID, JSONB, UUID
) TO service_role;

COMMIT;
