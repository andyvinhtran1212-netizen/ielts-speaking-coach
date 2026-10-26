-- Migration 319 — name the cause when a paper has no single current
-- web-explanation content version.
--
-- 260 raised one opaque code for three different states: the paper has no
-- current objects bound to it (e.g. a MOCK0016 REVxx copy whose objects are
-- still bound to the original Cambridge paper), more than one current version,
-- or a pinned version that is no longer current. Admins saw the same message
-- for all three. Behaviour is unchanged otherwise: the function still refuses
-- every ambiguous case and never chooses a version itself. The shared prefix
-- `web_explanation_content_version_unavailable` is kept so existing callers
-- that match on it keep working.
--
-- Signature, grants and every later step are identical to migration 260.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_approve_web_explanation_paper(
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

    -- Name WHICH ambiguity blocked the paper. Callers still match the shared
    -- prefix; the suffix lets admins see the cause instead of guessing, and
    -- the function still never picks a version on their behalf.
    IF v_version_count = 0 OR v_version IS NULL THEN
        IF p_content_version IS NOT NULL AND EXISTS (
            SELECT 1 FROM web_explanation_objects
             WHERE skill = p_skill
               AND is_current IS TRUE
               AND (
                    (p_skill = 'reading' AND reading_test_id = p_test_id)
                 OR (p_skill = 'listening' AND listening_test_id = p_test_id)
               )
        ) THEN
            RAISE EXCEPTION 'web_explanation_content_version_unavailable:pinned_not_current';
        END IF;
        RAISE EXCEPTION 'web_explanation_content_version_unavailable:none';
    END IF;
    IF v_version_count > 1 THEN
        RAISE EXCEPTION 'web_explanation_content_version_unavailable:multiple:%', v_version_count;
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

REVOKE ALL ON FUNCTION public.fn_approve_web_explanation_paper(
    TEXT, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_approve_web_explanation_paper(
    TEXT, UUID, UUID, TEXT, TEXT
) TO service_role;

COMMIT;
