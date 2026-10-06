-- Complete original MASTER30 banks. Legacy snapshots/results remain unchanged.
-- All practice/diagnostic mutation entry points take the same user advisory lock
-- before row locks. Trigger backstops do not establish row-lock ordering alone.
BEGIN;
ALTER TABLE public.grammar_lesson_attempts
    DROP CONSTRAINT IF EXISTS grammar_lesson_attempts_full_objective_count_check;
ALTER TABLE public.grammar_lesson_attempts
    DROP CONSTRAINT IF EXISTS grammar_lesson_attempts_question_count_check;
ALTER TABLE public.grammar_lesson_attempts
    ADD CONSTRAINT grammar_lesson_attempts_question_count_check CHECK (
        question_count BETWEEN 8 AND 20 OR
        (content_version = 'v3' AND question_count BETWEEN 100 AND 120)
    );
ALTER TABLE public.grammar_lesson_attempts
    ADD CONSTRAINT grammar_lesson_attempts_full_objective_count_check
    CHECK (content_version <> 'v3' OR correct_count <= 90);

INSERT INTO public.runtime_flags(key, enabled, note)
VALUES ('master30_original_full_banks', FALSE,
        'Full original 90 MCQ + 10 core writing, preserved additions; exact senior gate')
ON CONFLICT (key) DO NOTHING;


CREATE OR REPLACE FUNCTION public.master30_full_practice_exposure(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_attempt public.grammar_lesson_attempts%ROWTYPE;
    v_map JSONB;
    v_ids JSONB := '[]'::JSONB;
    v_families JSONB := '[]'::JSONB;
    v_parallel JSONB := '[]'::JSONB;
BEGIN
    FOR v_attempt IN SELECT * FROM public.grammar_lesson_attempts
        WHERE user_id = p_user_id AND content_version = 'v3'
    LOOP
        v_map := v_attempt.content_snapshot -> 'practice_exposure';
        IF jsonb_typeof(v_map) IS DISTINCT FROM 'object'
           OR jsonb_typeof(v_map -> 'item_ids') IS DISTINCT FROM 'array'
           OR jsonb_typeof(v_map -> 'stimulus_families') IS DISTINCT FROM 'array'
           OR jsonb_typeof(v_map -> 'parallel_set_ids') IS DISTINCT FROM 'array'
           OR jsonb_typeof(v_attempt.content_snapshot -> 'questions') IS DISTINCT FROM 'array'
           OR COALESCE(v_map ->> 'mapping_sha256', '') !~ '^[0-9a-f]{64}$' THEN
            RAISE EXCEPTION 'grammar_practice_history_invalid' USING ERRCODE = '55000';
        END IF;
        IF jsonb_array_length(v_map -> 'stimulus_families') = 0
           OR EXISTS (
               SELECT 1 FROM jsonb_array_elements(
                   (v_map -> 'item_ids') || (v_map -> 'stimulus_families') ||
                   (v_map -> 'parallel_set_ids')) value
               WHERE jsonb_typeof(value) <> 'string' OR value #>> '{}' = ''
           )
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_attempt.content_snapshot -> 'questions') q
                      WHERE NOT (v_map -> 'item_ids' ? (q ->> 'id'))) THEN
            RAISE EXCEPTION 'grammar_practice_history_invalid' USING ERRCODE = '55000';
        END IF;
        v_ids := v_ids || (v_map -> 'item_ids');
        v_families := v_families || (v_map -> 'stimulus_families');
        v_parallel := v_parallel || (v_map -> 'parallel_set_ids');
    END LOOP;
    RETURN jsonb_build_object('item_ids', v_ids,
           'stimulus_families', v_families, 'parallel_set_ids', v_parallel);
END;
$$;
REVOKE ALL ON FUNCTION public.master30_full_practice_exposure(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.master30_full_practice_exposure(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.master30_practice_overlaps(
    p_user_id UUID, p_item_id TEXT, p_family TEXT, p_parallel TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_history JSONB;
BEGIN
    v_history := public.master30_full_practice_exposure(p_user_id);
    RETURN COALESCE(v_history -> 'item_ids' ? p_item_id, FALSE)
        OR COALESCE(v_history -> 'stimulus_families' ? NULLIF(p_family, ''), FALSE)
        OR COALESCE(v_history -> 'parallel_set_ids' ? NULLIF(p_parallel, ''), FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.master30_practice_overlaps(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.master30_practice_overlaps(UUID, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.guard_full_grammar_practice_start()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.content_version <> 'v3' THEN RETURN NEW; END IF;
    -- The start RPC holds this lock before assignment/item/membership locks.
    PERFORM pg_advisory_xact_lock(hashtextextended('master30-full-bank:' || NEW.user_id::TEXT, 0));
    PERFORM public.master30_full_practice_exposure(NEW.user_id);
    UPDATE public.grammar_diagnostic_sessions s
       SET status = 'exhausted', updated_at = clock_timestamp()
     WHERE s.user_id = NEW.user_id AND s.status = 'in_progress'
       AND EXISTS (
           SELECT 1 FROM public.grammar_exposure_events e
            JOIN public.grammar_items item
              ON item.release_id=e.release_id AND item.item_id=e.item_id
            WHERE e.session_id = s.id
              AND public.master30_practice_overlaps(NEW.user_id, e.item_id,
                                                    item.stimulus_family, item.parallel_set_id)
       );
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS grammar_full_practice_started ON public.grammar_lesson_attempts;
CREATE TRIGGER grammar_full_practice_started
    AFTER INSERT ON public.grammar_lesson_attempts
    FOR EACH ROW EXECUTE FUNCTION public.guard_full_grammar_practice_start();
REVOKE ALL ON FUNCTION public.guard_full_grammar_practice_start() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_diagnostic_full_practice_exposure()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item public.grammar_items%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('master30-full-bank:' || NEW.user_id::TEXT, 0));
    SELECT * INTO v_item FROM public.grammar_items
     WHERE release_id = NEW.release_id AND item_id = NEW.item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_item_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF public.master30_practice_overlaps(NEW.user_id, NEW.item_id,
                                        v_item.stimulus_family, v_item.parallel_set_id) THEN
        RAISE EXCEPTION 'grammar_practice_exposed' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
-- Ordered ahead of the existing assignment gate, which takes the session lock.
DROP TRIGGER IF EXISTS aaa_grammar_full_practice_exposure ON public.grammar_exposure_events;
CREATE TRIGGER aaa_grammar_full_practice_exposure
    BEFORE INSERT ON public.grammar_exposure_events
    FOR EACH ROW EXECUTE FUNCTION public.guard_diagnostic_full_practice_exposure();
DROP TRIGGER IF EXISTS aaa_grammar_full_practice_response ON public.grammar_diagnostic_responses;
CREATE TRIGGER aaa_grammar_full_practice_response
    BEFORE INSERT ON public.grammar_diagnostic_responses
    FOR EACH ROW EXECUTE FUNCTION public.guard_diagnostic_full_practice_exposure();
REVOKE ALL ON FUNCTION public.guard_diagnostic_full_practice_exposure() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_diagnostic_full_practice_report()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('master30-full-bank:' || NEW.user_id::TEXT, 0));
    -- A report may never certify any pending or answered evidence now practised.
    IF EXISTS (SELECT 1 FROM public.grammar_exposure_events e
               JOIN public.grammar_items item
                 ON item.release_id=e.release_id AND item.item_id=e.item_id
               WHERE e.session_id = NEW.session_id AND e.user_id = NEW.user_id
                 AND public.master30_practice_overlaps(NEW.user_id, e.item_id,
                                                      item.stimulus_family, item.parallel_set_id)) THEN
        RAISE EXCEPTION 'grammar_practice_exposed' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS aaa_grammar_full_practice_report ON public.grammar_diagnostic_reports;
CREATE TRIGGER aaa_grammar_full_practice_report
    BEFORE INSERT ON public.grammar_diagnostic_reports
    FOR EACH ROW EXECUTE FUNCTION public.guard_diagnostic_full_practice_report();
REVOKE ALL ON FUNCTION public.guard_diagnostic_full_practice_report() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.protect_full_grammar_lesson_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF OLD.content_version <> 'v3' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        -- Explicit owner erasure may cascade; assignment deletion may not erase
        -- actual served evidence while that owner still exists.
        IF EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
            RAISE EXCEPTION 'grammar_full_history_immutable' USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;
    IF (NEW.id, NEW.class_assignment_item_id, NEW.user_id, NEW.release_id, NEW.lesson_id,
        NEW.content_version, NEW.content_sha256, NEW.content_snapshot, NEW.question_count, NEW.started_at)
        IS DISTINCT FROM
       (OLD.id, OLD.class_assignment_item_id, OLD.user_id, OLD.release_id, OLD.lesson_id,
        OLD.content_version, OLD.content_sha256, OLD.content_snapshot, OLD.question_count, OLD.started_at)
       OR NOT (NEW.answers @> OLD.answers)
       OR (OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD) THEN
        RAISE EXCEPTION 'grammar_full_history_immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS grammar_full_lesson_history_immutable ON public.grammar_lesson_attempts;
CREATE TRIGGER grammar_full_lesson_history_immutable
    BEFORE UPDATE OR DELETE ON public.grammar_lesson_attempts
    FOR EACH ROW EXECUTE FUNCTION public.protect_full_grammar_lesson_history();
REVOKE ALL ON FUNCTION public.protect_full_grammar_lesson_history() FROM PUBLIC, anon, authenticated;

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
    PERFORM pg_advisory_xact_lock(hashtextextended('master30-full-bank:' || p_user_id::TEXT, 0));
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
    IF NOT FOUND OR v_config ->> 'assignment_type' IS DISTINCT FROM 'grammar_lesson' THEN
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
    IF v_status IS DISTINCT FROM 'published'
       OR (v_publish_at IS NOT NULL AND v_publish_at > v_now)
       OR (v_due_at IS NOT NULL AND v_due_at <= v_now)
       OR v_config ->> 'release_id' IS DISTINCT FROM p_release_id::TEXT
       OR v_config ->> 'lesson_id' IS DISTINCT FROM p_lesson_id
       OR v_config ->> 'content_version' IS DISTINCT FROM p_content_version
       OR v_config ->> 'content_sha256' IS DISTINCT FROM p_content_sha256
       OR p_content_snapshot ->> 'lesson_id' IS DISTINCT FROM p_lesson_id
       OR p_content_snapshot ->> 'version' IS DISTINCT FROM p_content_version
       OR NOT ((p_content_version <> 'v3' AND v_count BETWEEN 8 AND 20)
               OR (p_content_version = 'v3' AND v_count BETWEEN 100 AND 120)) THEN
        RAISE EXCEPTION 'grammar_lesson_not_accepting' USING ERRCODE = '55000';
    END IF;

    IF p_content_version = 'v3' THEN
        IF NOT COALESCE((SELECT enabled FROM public.runtime_flags
                         WHERE key = 'master30_original_full_banks'), FALSE)
           OR (SELECT COUNT(*) FROM jsonb_array_elements(p_content_snapshot -> 'questions') q
               WHERE q ->> 'type' = 'mcq') <> 90
           OR (SELECT COUNT(*) FROM jsonb_array_elements(p_content_snapshot -> 'questions') q
               WHERE q ->> 'type' = 'writing') <> v_count - 90
           OR v_config ->> 'question_count' IS DISTINCT FROM v_count::TEXT THEN
            RAISE EXCEPTION 'grammar_lesson_not_accepting' USING ERRCODE = '55000';
        END IF;
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


CREATE OR REPLACE FUNCTION public.record_assigned_grammar_lesson_response(
    p_user_id UUID,
    p_item_id UUID,
    p_question_id TEXT,
    p_selected_index INTEGER,
    p_answer_text TEXT
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
    v_objective INTEGER;
    v_writing INTEGER;
    v_writing_answered INTEGER;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('master30-full-bank:' || p_user_id::TEXT, 0));
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
    IF NOT FOUND OR v_config ->> 'assignment_type' IS DISTINCT FROM 'grammar_lesson' THEN
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
    IF NOT FOUND OR (p_selected_index IS NULL) = (p_answer_text IS NULL) THEN
        RAISE EXCEPTION 'grammar_lesson_invalid_answer' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(v_question ->> 'type', 'mcq') = 'writing' THEN
        IF v_attempt.content_version <> 'v3' OR p_answer_text IS NULL
           OR p_answer_text !~ '[^[:space:]]' OR char_length(p_answer_text) > 8000 THEN
            RAISE EXCEPTION 'grammar_lesson_invalid_answer' USING ERRCODE = '22023';
        END IF;
    ELSIF p_selected_index IS NULL OR p_selected_index < 0
       OR p_selected_index >= jsonb_array_length(v_question -> 'options') THEN
        RAISE EXCEPTION 'grammar_lesson_invalid_answer' USING ERRCODE = '22023';
    END IF;

    v_saved := v_attempt.answers -> p_question_id;
    IF v_saved IS NOT NULL THEN
        IF (p_answer_text IS NOT NULL AND v_saved ->> 'answer_text' = p_answer_text)
           OR (p_selected_index IS NOT NULL
               AND (v_saved ->> 'selected_index')::INTEGER = p_selected_index) THEN
            RETURN v_attempt;
        END IF;
        RAISE EXCEPTION 'grammar_lesson_answer_conflict' USING ERRCODE = '23505';
    END IF;

    v_now := clock_timestamp();
    IF (v_attempt.content_version = 'v3' AND NOT COALESCE(
           (SELECT enabled FROM public.runtime_flags WHERE key = 'master30_original_full_banks'), FALSE))
       OR v_attempt.status <> 'in_progress'
       OR v_status IS DISTINCT FROM 'published'
       OR (v_publish_at IS NOT NULL AND v_publish_at > v_now)
       OR (v_due_at IS NOT NULL AND v_due_at <= v_now) THEN
        RAISE EXCEPTION 'grammar_lesson_not_accepting' USING ERRCODE = '55000';
    END IF;

    v_answers := v_attempt.answers || jsonb_build_object(
        p_question_id, CASE WHEN p_answer_text IS NOT NULL
            THEN jsonb_build_object('answer_text', p_answer_text)
            ELSE jsonb_build_object('selected_index', p_selected_index,
                 'is_correct', p_selected_index = (v_question ->> 'correct_index')::INTEGER)
            END
    );
    SELECT COUNT(*) FILTER (WHERE COALESCE(q ->> 'type', 'mcq') = 'mcq'),
           COUNT(*) FILTER (WHERE q ->> 'type' = 'writing')
      INTO v_objective, v_writing
      FROM jsonb_array_elements(v_attempt.content_snapshot -> 'questions') q;
    SELECT COUNT(*) INTO v_writing_answered FROM jsonb_each(v_answers) a
     WHERE a.value ? 'answer_text';
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
                   'objective_count', v_objective,
                   'writing_count', v_writing,
                   'writing_answered_count', v_writing_answered,
                   'writing_status', 'ungraded',
                   'percent', ROUND(100.0 * v_correct / NULLIF(v_objective, 0), 1)
               ),
               updated_at = v_now
         WHERE id = p_item_id;
    END IF;
    RETURN v_attempt;
END;
$$;
REVOKE ALL ON FUNCTION public.record_assigned_grammar_lesson_response(
    UUID, UUID, TEXT, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_assigned_grammar_lesson_response(
    UUID, UUID, TEXT, INTEGER, TEXT
) TO service_role;



CREATE OR REPLACE FUNCTION public.record_assigned_grammar_lesson_answer(
    p_user_id UUID, p_item_id UUID, p_question_id TEXT, p_selected_index INTEGER
) RETURNS public.grammar_lesson_attempts
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT public.record_assigned_grammar_lesson_response(p_user_id, p_item_id,
                                                        p_question_id, p_selected_index, NULL);
$$;
REVOKE ALL ON FUNCTION public.record_assigned_grammar_lesson_answer(UUID, UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_assigned_grammar_lesson_answer(UUID, UUID, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.record_assigned_grammar_lesson_writing_answer(
    p_user_id UUID, p_item_id UUID, p_question_id TEXT, p_answer_text TEXT
) RETURNS public.grammar_lesson_attempts
LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT public.record_assigned_grammar_lesson_response(p_user_id, p_item_id,
                                                        p_question_id, NULL, p_answer_text);
$$;
REVOKE ALL ON FUNCTION public.record_assigned_grammar_lesson_writing_answer(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_assigned_grammar_lesson_writing_answer(UUID, UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION create_assigned_grammar_diagnostic_session(
    p_user_id UUID,
    p_release_id UUID,
    p_item_id UUID,
    p_mode TEXT,
    p_module TEXT,
    p_test_length TEXT,
    p_objective_limit INTEGER
) RETURNS grammar_diagnostic_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_status TEXT;
    v_publish_at TIMESTAMPTZ;
    v_due_at TIMESTAMPTZ;
    v_content_config JSONB;
    v_session grammar_diagnostic_sessions%ROWTYPE;
    v_now TIMESTAMPTZ;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('master30-full-bank:' || p_user_id::TEXT, 0));
    SELECT ca.status, ca.publish_at, ca.due_at, ca.content_config
      INTO v_status, v_publish_at, v_due_at, v_content_config
      FROM class_assignment_items AS cai
      JOIN class_assignments AS ca ON ca.id = cai.assignment_id
      JOIN students AS student ON student.id = cai.student_id
      JOIN student_cohort_memberships AS membership
        ON membership.student_id = student.id
       AND membership.cohort_id = ca.cohort_id
       AND membership.is_active IS TRUE
     WHERE cai.id = p_item_id
       AND student.user_id = p_user_id
       AND ca.skill = 'grammar'
     FOR UPDATE OF cai, ca, membership;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_assignment_not_accessible' USING ERRCODE = '42501';
    END IF;

    v_now := clock_timestamp();
    IF v_status <> 'published'
       OR (v_publish_at IS NOT NULL AND v_publish_at > v_now)
       OR (v_due_at IS NOT NULL AND v_due_at <= v_now)
       OR COALESCE(v_content_config ->> 'release_id', '') <> p_release_id::TEXT
       OR UPPER(COALESCE(v_content_config ->> 'mode', '')) <> p_mode
       OR UPPER(COALESCE(v_content_config ->> 'module', '')) <> p_module
       OR UPPER(COALESCE(v_content_config ->> 'test_length', '')) <> p_test_length THEN
        RAISE EXCEPTION 'grammar_assignment_not_accepting' USING ERRCODE = '55000';
    END IF;

    SELECT * INTO v_session
      FROM grammar_diagnostic_sessions
     WHERE class_assignment_item_id = p_item_id
     FOR UPDATE;
    IF FOUND THEN
        IF v_session.user_id IS DISTINCT FROM p_user_id THEN
            RAISE EXCEPTION 'grammar_assignment_not_accessible' USING ERRCODE = '42501';
        END IF;
        RETURN v_session;
    END IF;

    INSERT INTO grammar_diagnostic_sessions (
        user_id, release_id, class_assignment_item_id, mode, module,
        test_length, objective_limit
    ) VALUES (
        p_user_id, p_release_id, p_item_id, p_mode, p_module,
        p_test_length, p_objective_limit
    ) RETURNING * INTO v_session;

    UPDATE class_assignment_items
       SET state = 'opened', opened_at = COALESCE(opened_at, v_now),
           updated_at = v_now
     WHERE id = p_item_id AND state = 'assigned';
    RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_grammar_diagnostic_session(
    p_session_id UUID,
    p_user_id UUID,
    p_evidence_sha256 TEXT,
    p_learner_report JSONB,
    p_educator_report JSONB
) RETURNS grammar_diagnostic_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_session grammar_diagnostic_sessions%ROWTYPE;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('master30-full-bank:' || p_user_id::TEXT, 0));
    SELECT * INTO v_session FROM grammar_diagnostic_sessions
     WHERE id = p_session_id AND user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_session_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- A second completion request may have waited behind the request that
    -- committed the immutable report. Treat that canonical completed state as
    -- success instead of passing it to the write gate, which correctly rejects
    -- any further mutations of a completed session.
    IF v_session.status = 'completed' THEN
        IF EXISTS (
            SELECT 1 FROM grammar_diagnostic_reports
             WHERE session_id = v_session.id AND user_id = v_session.user_id
        ) THEN
            RETURN v_session;
        END IF;
        RAISE EXCEPTION 'completed grammar session has no report'
            USING ERRCODE = '55000';
    END IF;

    -- Recheck under the assignment/item lock in the same transaction that
    -- writes the immutable report and class ledger terminal state.
    PERFORM assert_grammar_assignment_accepting(v_session.id);

    IF (SELECT COUNT(*) FROM grammar_diagnostic_responses
         WHERE session_id = v_session.id AND user_id = v_session.user_id)
       <> v_session.objective_limit THEN
        RAISE EXCEPTION 'grammar_session_incomplete' USING ERRCODE = '55000';
    END IF;

    INSERT INTO grammar_diagnostic_reports (
        session_id, user_id, release_id, evidence_sha256,
        learner_report, educator_report
    ) VALUES (
        v_session.id, v_session.user_id, v_session.release_id,
        p_evidence_sha256, p_learner_report, p_educator_report
    ) ON CONFLICT (session_id) DO NOTHING;

    UPDATE grammar_diagnostic_sessions
       SET status = 'completed', current_phase = 'COMPLETED',
           completed_at = COALESCE(completed_at, v_now), updated_at = v_now
     WHERE id = v_session.id RETURNING * INTO v_session;

    IF v_session.class_assignment_item_id IS NOT NULL THEN
        UPDATE class_assignment_items AS item
           SET state = 'submitted',
               submitted_at = COALESCE(item.submitted_at, v_now),
               score = NULL,
               artifact_kind = 'grammar_diagnostic',
               artifact_id = v_session.id,
               mastery = jsonb_build_object(
                   'profile_kind', 'grammar_readiness',
                   'report_id', v_session.id,
                   'calibration', 'structural_alpha'
               ),
               updated_at = v_now
         WHERE item.id = v_session.class_assignment_item_id;
    END IF;
    RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION record_and_finalize_grammar_diagnostic_session(
    p_session_id UUID,
    p_user_id UUID,
    p_item_id TEXT,
    p_selected_option INTEGER,
    p_assistance_used BOOLEAN,
    p_response_time_ms INTEGER,
    p_evidence_sha256 TEXT,
    p_learner_report JSONB,
    p_educator_report JSONB
) RETURNS grammar_diagnostic_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_session grammar_diagnostic_sessions%ROWTYPE;
    v_existing grammar_diagnostic_responses%ROWTYPE;
    v_item grammar_items%ROWTYPE;
    v_phase TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('master30-full-bank:' || p_user_id::TEXT, 0));
    SELECT * INTO v_session
      FROM grammar_diagnostic_sessions
     WHERE id = p_session_id AND user_id = p_user_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_session_not_found' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_existing
      FROM grammar_diagnostic_responses
     WHERE session_id = p_session_id AND item_id = p_item_id;
    IF FOUND THEN
        IF v_existing.selected_option IS DISTINCT FROM p_selected_option
           OR v_existing.assistance_used IS DISTINCT FROM p_assistance_used THEN
            RAISE EXCEPTION 'grammar_response_conflict' USING ERRCODE = '23505';
        END IF;
        IF v_session.status = 'completed' AND EXISTS (
            SELECT 1 FROM grammar_diagnostic_reports
             WHERE session_id = v_session.id AND user_id = v_session.user_id
        ) THEN
            RETURN v_session;
        END IF;
        RAISE EXCEPTION 'grammar_final_response_without_report' USING ERRCODE = '55000';
    END IF;

    PERFORM assert_grammar_assignment_accepting(v_session.id);

    SELECT * INTO v_item
      FROM grammar_items
     WHERE release_id = v_session.release_id AND item_id = p_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_item_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF p_selected_option < 0
       OR p_selected_option >= jsonb_array_length(v_item.options) THEN
        RAISE EXCEPTION 'grammar_option_invalid' USING ERRCODE = '22023';
    END IF;

    SELECT phase INTO v_phase
      FROM grammar_exposure_events
     WHERE session_id = v_session.id
       AND user_id = v_session.user_id
       AND item_id = p_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grammar_item_not_exposed' USING ERRCODE = '55000';
    END IF;

    INSERT INTO grammar_diagnostic_responses (
        session_id, user_id, release_id, item_id, attribute_id,
        process_facet, subdomain, phase, selected_option, is_correct,
        assistance_used, response_time_ms
    ) VALUES (
        v_session.id, v_session.user_id, v_session.release_id, v_item.item_id,
        v_item.attribute_id, v_item.process_facet, v_item.subdomain, v_phase,
        p_selected_option, p_selected_option = v_item.correct_index,
        p_assistance_used, p_response_time_ms
    );

    SELECT * INTO v_session FROM finalize_grammar_diagnostic_session(
        v_session.id, v_session.user_id, p_evidence_sha256,
        p_learner_report, p_educator_report
    );
    RETURN v_session;
END;
$$;

COMMIT;
