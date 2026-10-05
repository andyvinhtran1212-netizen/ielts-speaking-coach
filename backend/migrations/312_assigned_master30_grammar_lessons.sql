-- Targeted MASTER30 lesson practice. Renumbered before hosted application;
-- deployed Mock and Grammar revisions occupy 306–311. No applied ledger rename.
-- Additive schema and a default-off runtime flag. No learner data is rewritten.

CREATE TABLE IF NOT EXISTS public.grammar_lesson_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_assignment_item_id UUID NOT NULL UNIQUE
        REFERENCES public.class_assignment_items(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    release_id UUID NOT NULL REFERENCES public.grammar_content_releases(id),
    lesson_id TEXT NOT NULL CHECK (lesson_id ~ '^M30-B(0[1-9]|[12][0-9]|30)$'),
    content_version TEXT NOT NULL,
    content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    -- Frozen at start, including answer keys. Service-role only; never SELECT
    -- this column into a learner response without removing unsubmitted keys.
    content_snapshot JSONB NOT NULL CHECK (jsonb_typeof(content_snapshot) = 'object'),
    question_count INTEGER NOT NULL CHECK (question_count BETWEEN 8 AND 20),
    answers JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
    correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
    status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (correct_count <= question_count),
    CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_grammar_lesson_attempts_user
    ON public.grammar_lesson_attempts(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_grammar_lesson_attempts_release
    ON public.grammar_lesson_attempts(release_id, lesson_id);

ALTER TABLE public.grammar_lesson_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.grammar_lesson_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.grammar_lesson_attempts TO service_role;

-- The class ledger already supports skill='grammar'. Add only its new artifact.
ALTER TABLE public.class_assignment_items
    DROP CONSTRAINT IF EXISTS class_assignment_items_artifact_kind_check;
ALTER TABLE public.class_assignment_items
    ADD CONSTRAINT class_assignment_items_artifact_kind_check CHECK (
        artifact_kind IN (
            'session', 'writing_assignment', 'reading_attempt',
            'listening_attempt', 'quiz_session', 'course_writing',
            'advanced_vocab_progress', 'grammar_diagnostic',
            'grammar_lesson_attempt'
        )
    );

-- A lost create response can be retried with the same UUID. The existing
-- assignment RPC remains the single atomic fan-out; this index prevents a
-- second assignment/recipient set even under simultaneous identical requests.
CREATE UNIQUE INDEX IF NOT EXISTS uq_grammar_lesson_give_request
    ON public.class_assignments (
        cohort_id, (content_config ->> 'give_request_id')
    )
    WHERE skill = 'grammar'
      AND content_config ->> 'assignment_type' = 'grammar_lesson'
      AND content_config ? 'give_request_id';

CREATE OR REPLACE FUNCTION public.create_assigned_grammar_lesson_attempt(
    p_user_id UUID,
    p_item_id UUID,
    p_release_id UUID,
    p_lesson_id TEXT,
    p_content_version TEXT,
    p_content_sha256 TEXT,
    p_content_snapshot JSONB
) RETURNS public.grammar_lesson_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_status TEXT;
    v_publish_at TIMESTAMPTZ;
    v_due_at TIMESTAMPTZ;
    v_config JSONB;
    v_attempt public.grammar_lesson_attempts%ROWTYPE;
    v_now TIMESTAMPTZ;
    v_count INTEGER;
BEGIN
    SELECT ca.status, ca.publish_at, ca.due_at, ca.content_config
      INTO v_status, v_publish_at, v_due_at, v_config
      FROM public.class_assignment_items AS cai
      JOIN public.class_assignments AS ca ON ca.id = cai.assignment_id
      JOIN public.students AS student ON student.id = cai.student_id
      JOIN public.student_cohort_memberships AS membership
        ON membership.student_id = student.id
       AND membership.cohort_id = ca.cohort_id
       AND membership.is_active IS TRUE
     WHERE cai.id = p_item_id
       AND student.user_id = p_user_id
       AND ca.skill = 'grammar'
     FOR UPDATE OF cai, ca, membership;
    IF NOT FOUND OR v_config ->> 'assignment_type' <> 'grammar_lesson' THEN
        RAISE EXCEPTION 'grammar_lesson_not_accessible' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_attempt FROM public.grammar_lesson_attempts
     WHERE class_assignment_item_id = p_item_id FOR UPDATE;
    IF FOUND THEN
        IF v_attempt.user_id IS DISTINCT FROM p_user_id THEN
            RAISE EXCEPTION 'grammar_lesson_not_accessible' USING ERRCODE = '42501';
        END IF;
        RETURN v_attempt;
    END IF;

    v_now := clock_timestamp();
    v_count := jsonb_array_length(COALESCE(p_content_snapshot -> 'questions', '[]'::jsonb));
    IF v_status <> 'published'
       OR (v_publish_at IS NOT NULL AND v_publish_at > v_now)
       OR (v_due_at IS NOT NULL AND v_due_at <= v_now)
       OR v_config ->> 'release_id' <> p_release_id::TEXT
       OR v_config ->> 'lesson_id' <> p_lesson_id
       OR v_config ->> 'content_version' <> p_content_version
       OR v_config ->> 'content_sha256' <> p_content_sha256
       OR p_content_snapshot ->> 'lesson_id' <> p_lesson_id
       OR p_content_snapshot ->> 'version' <> p_content_version
       OR v_count NOT BETWEEN 8 AND 20 THEN
        RAISE EXCEPTION 'grammar_lesson_not_accepting' USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.grammar_lesson_attempts (
        class_assignment_item_id, user_id, release_id, lesson_id,
        content_version, content_sha256, content_snapshot, question_count
    ) VALUES (
        p_item_id, p_user_id, p_release_id, p_lesson_id,
        p_content_version, p_content_sha256, p_content_snapshot, v_count
    ) RETURNING * INTO v_attempt;
    UPDATE public.class_assignment_items
       SET state = 'opened', opened_at = COALESCE(opened_at, v_now),
           updated_at = v_now
     WHERE id = p_item_id AND state = 'assigned';
    RETURN v_attempt;
END;
$$;
REVOKE ALL ON FUNCTION public.create_assigned_grammar_lesson_attempt(
    UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_assigned_grammar_lesson_attempt(
    UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB
) TO service_role;

CREATE OR REPLACE FUNCTION public.record_assigned_grammar_lesson_answer(
    p_user_id UUID,
    p_item_id UUID,
    p_question_id TEXT,
    p_selected_index INTEGER
) RETURNS public.grammar_lesson_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_status TEXT;
    v_publish_at TIMESTAMPTZ;
    v_due_at TIMESTAMPTZ;
    v_config JSONB;
    v_attempt public.grammar_lesson_attempts%ROWTYPE;
    v_question JSONB;
    v_saved JSONB;
    v_answers JSONB;
    v_answered INTEGER;
    v_correct INTEGER;
    v_now TIMESTAMPTZ;
BEGIN
    SELECT ca.status, ca.publish_at, ca.due_at, ca.content_config
      INTO v_status, v_publish_at, v_due_at, v_config
      FROM public.class_assignment_items AS cai
      JOIN public.class_assignments AS ca ON ca.id = cai.assignment_id
      JOIN public.students AS student ON student.id = cai.student_id
      JOIN public.student_cohort_memberships AS membership
        ON membership.student_id = student.id
       AND membership.cohort_id = ca.cohort_id
       AND membership.is_active IS TRUE
     WHERE cai.id = p_item_id
       AND student.user_id = p_user_id
       AND ca.skill = 'grammar'
     FOR UPDATE OF cai, ca, membership;
    IF NOT FOUND OR v_config ->> 'assignment_type' <> 'grammar_lesson' THEN
        RAISE EXCEPTION 'grammar_lesson_not_accessible' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_attempt FROM public.grammar_lesson_attempts
     WHERE class_assignment_item_id = p_item_id AND user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_lesson_not_started' USING ERRCODE = 'P0002';
    END IF;

    SELECT q.value INTO v_question
      FROM jsonb_array_elements(v_attempt.content_snapshot -> 'questions') AS q(value)
     WHERE q.value ->> 'id' = p_question_id;
    IF NOT FOUND OR p_selected_index IS NULL
       OR p_selected_index < 0
       OR p_selected_index >= jsonb_array_length(v_question -> 'options') THEN
        RAISE EXCEPTION 'grammar_lesson_invalid_answer' USING ERRCODE = '22023';
    END IF;

    v_saved := v_attempt.answers -> p_question_id;
    IF v_saved IS NOT NULL THEN
        IF (v_saved ->> 'selected_index')::INTEGER = p_selected_index THEN
            RETURN v_attempt;
        END IF;
        RAISE EXCEPTION 'grammar_lesson_answer_conflict' USING ERRCODE = '23505';
    END IF;

    v_now := clock_timestamp();
    IF v_attempt.status <> 'in_progress'
       OR v_status <> 'published'
       OR (v_publish_at IS NOT NULL AND v_publish_at > v_now)
       OR (v_due_at IS NOT NULL AND v_due_at <= v_now) THEN
        RAISE EXCEPTION 'grammar_lesson_not_accepting' USING ERRCODE = '55000';
    END IF;

    v_answers := v_attempt.answers || jsonb_build_object(
        p_question_id, jsonb_build_object(
            'selected_index', p_selected_index,
            'is_correct', p_selected_index = (v_question ->> 'correct_index')::INTEGER
        )
    );
    SELECT COUNT(*) INTO v_answered FROM jsonb_object_keys(v_answers);
    SELECT COUNT(*) INTO v_correct
      FROM jsonb_each(v_answers) AS answer(key, value)
     WHERE (answer.value ->> 'is_correct')::BOOLEAN IS TRUE;

    UPDATE public.grammar_lesson_attempts
       SET answers = v_answers, correct_count = v_correct,
           status = CASE WHEN v_answered = question_count
                         THEN 'completed' ELSE 'in_progress' END,
           completed_at = CASE WHEN v_answered = question_count
                               THEN v_now ELSE NULL END,
           updated_at = v_now
     WHERE id = v_attempt.id RETURNING * INTO v_attempt;

    IF v_attempt.status = 'completed' THEN
        UPDATE public.class_assignment_items
           SET state = 'submitted',
               submitted_at = COALESCE(submitted_at, v_now),
               score = NULL,
               artifact_kind = 'grammar_lesson_attempt',
               artifact_id = v_attempt.id,
               mastery = jsonb_build_object(
                   'profile_kind', 'grammar_lesson',
                   'lesson_id', v_attempt.lesson_id,
                   'correct_count', v_correct,
                   'question_count', v_attempt.question_count,
                   'percent', ROUND(100.0 * v_correct / v_attempt.question_count, 1)
               ),
               updated_at = v_now
         WHERE id = p_item_id;
    END IF;
    RETURN v_attempt;
END;
$$;
REVOKE ALL ON FUNCTION public.record_assigned_grammar_lesson_answer(
    UUID, UUID, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_assigned_grammar_lesson_answer(
    UUID, UUID, TEXT, INTEGER
) TO service_role;

INSERT INTO public.runtime_flags(key, enabled, note)
VALUES (
    'master30_grammar_lesson_assignments', FALSE,
    'Targeted Bxx lesson assignments; enable after reviewed practice and staging smoke'
)
ON CONFLICT (key) DO NOTHING;
