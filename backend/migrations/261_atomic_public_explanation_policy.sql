-- Migration 261 — make public visibility + explanation approval one decision.
-- The central admin action must not approve a paper and then fail before the
-- selected public policy is persisted (or vice versa).

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_update_public_test_explanation_policy(
    p_skill TEXT,
    p_test_id UUID,
    p_patch JSONB,
    p_actor_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_patch JSONB := COALESCE(p_patch, '{}'::JSONB);
    v_before JSONB;
    v_result JSONB;
    v_mode TEXT;
    v_version TEXT;
    v_released_at TIMESTAMPTZ;
    v_released_by UUID;
    v_approval JSONB;
    v_enabling BOOLEAN;
BEGIN
    IF p_skill NOT IN ('reading', 'listening') THEN
        RAISE EXCEPTION 'unsupported_public_explanation_skill';
    END IF;

    IF p_skill = 'reading' THEN
        SELECT TO_JSONB(t.*)
          INTO v_before
          FROM public.reading_tests AS t
         WHERE t.id = p_test_id
         FOR UPDATE;
    ELSE
        SELECT TO_JSONB(t.*)
          INTO v_before
          FROM public.listening_tests AS t
         WHERE t.id = p_test_id
         FOR UPDATE;
    END IF;

    IF v_before IS NULL THEN
        RAISE EXCEPTION 'public_test_not_found';
    END IF;

    v_mode := CASE
        WHEN v_patch ? 'web_explanation_mode'
            THEN v_patch ->> 'web_explanation_mode'
        ELSE COALESCE(v_before ->> 'web_explanation_mode', 'disabled')
    END;
    IF v_mode NOT IN ('disabled', 'immediate_after_capture', 'admin_release') THEN
        RAISE EXCEPTION 'invalid_public_explanation_mode';
    END IF;

    v_version := COALESCE(
        NULLIF(v_patch ->> 'web_explanation_content_version', ''),
        NULLIF(v_before ->> 'web_explanation_content_version', '')
    );
    v_enabling := v_mode <> 'disabled' AND (
           v_patch ? 'web_explanation_mode'
        OR COALESCE((v_patch ->> 'public_practice_enabled')::BOOLEAN, FALSE)
        OR COALESCE((v_patch ->> 'release_now')::BOOLEAN, FALSE)
    );

    IF v_enabling THEN
        v_approval := public.fn_approve_web_explanation_paper(
            p_skill,
            p_test_id,
            p_actor_id,
            v_version,
            'enabled_for_public_practice'
        );
        v_version := v_approval ->> 'content_version';
    END IF;

    v_released_at := NULLIF(v_before ->> 'web_explanations_released_at', '')::TIMESTAMPTZ;
    v_released_by := NULLIF(v_before ->> 'web_explanations_released_by', '')::UUID;
    IF COALESCE((v_patch ->> 'release_now')::BOOLEAN, FALSE) THEN
        v_released_at := NOW();
        v_released_by := p_actor_id;
    ELSIF v_mode = 'admin_release' AND (
           COALESCE(v_before ->> 'web_explanation_mode', 'disabled') <> 'admin_release'
        OR v_version IS DISTINCT FROM NULLIF(
            v_before ->> 'web_explanation_content_version', ''
        )
    ) THEN
        v_released_at := NULL;
        v_released_by := NULL;
    END IF;

    IF p_skill = 'reading' THEN
        UPDATE public.reading_tests AS t
           SET is_public = CASE
                   WHEN v_patch ? 'is_public'
                       THEN (v_patch ->> 'is_public')::BOOLEAN
                   ELSE t.is_public
               END,
               exam_only = CASE
                   WHEN v_patch ? 'is_public' THEN FALSE
                   ELSE t.exam_only
               END,
               public_practice_enabled = CASE
                   WHEN v_patch ? 'public_practice_enabled'
                       THEN (v_patch ->> 'public_practice_enabled')::BOOLEAN
                   ELSE t.public_practice_enabled
               END,
               web_explanation_mode = v_mode,
               web_explanation_content_version = v_version,
               web_explanations_released_at = v_released_at,
               web_explanations_released_by = v_released_by
         WHERE t.id = p_test_id
         RETURNING TO_JSONB(t.*) INTO v_result;
    ELSE
        UPDATE public.listening_tests AS t
           SET is_public = CASE
                   WHEN v_patch ? 'is_public'
                       THEN (v_patch ->> 'is_public')::BOOLEAN
                   ELSE t.is_public
               END,
               exam_only = CASE
                   WHEN v_patch ? 'is_public' THEN FALSE
                   ELSE t.exam_only
               END,
               public_practice_enabled = CASE
                   WHEN v_patch ? 'public_practice_enabled'
                       THEN (v_patch ->> 'public_practice_enabled')::BOOLEAN
                   ELSE t.public_practice_enabled
               END,
               web_explanation_mode = v_mode,
               web_explanation_content_version = v_version,
               web_explanations_released_at = v_released_at,
               web_explanations_released_by = v_released_by
         WHERE t.id = p_test_id
         RETURNING TO_JSONB(t.*) INTO v_result;
    END IF;

    INSERT INTO public.mock_correction_release_events (
        scope_type, scope_id, action, previous_state, new_state, actor_id
    ) VALUES (
        p_skill || '_test',
        p_test_id::TEXT,
        'public_policy_updated',
        JSONB_BUILD_OBJECT(
            'is_public', v_before -> 'is_public',
            'public_practice_enabled', v_before -> 'public_practice_enabled',
            'web_explanation_mode', v_before -> 'web_explanation_mode',
            'web_explanations_released_at',
                v_before -> 'web_explanations_released_at',
            'web_explanation_content_version',
                v_before -> 'web_explanation_content_version'
        ),
        JSONB_BUILD_OBJECT(
            'is_public', v_result -> 'is_public',
            'public_practice_enabled', v_result -> 'public_practice_enabled',
            'web_explanation_mode', v_result -> 'web_explanation_mode',
            'web_explanations_released_at',
                v_result -> 'web_explanations_released_at',
            'web_explanation_content_version',
                v_result -> 'web_explanation_content_version'
        ),
        p_actor_id
    );

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_update_public_test_explanation_policy(
    TEXT, UUID, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_public_test_explanation_policy(
    TEXT, UUID, JSONB, UUID
) TO service_role;

COMMIT;
