-- Advanced Vocabulary persistence gate.
--
-- Migration 281 introduced the evidence stores.  This additive migration closes
-- the database boundary before the learner runtime is promoted:
--   * Practice question sets are selected once and then immutable;
--   * every evidence write rechecks membership, assignment publication and due
--     state while holding membership -> assignment -> item row locks;
--   * Advanced Reading/Listening are attempt 1 only and immutable;
--   * any permissive quiz_banks SELECT policy is still restricted from exposing
--     Advanced banks; and
--   * immutable Advanced banks cannot be hard-deleted.

BEGIN;

CREATE TABLE IF NOT EXISTS public.advanced_vocab_practice_selections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id UUID NOT NULL REFERENCES public.quiz_banks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    class_assignment_item_id UUID NOT NULL
        REFERENCES public.class_assignment_items(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('practice_1', 'practice_2')),
    qids JSONB NOT NULL CHECK (jsonb_typeof(qids) = 'array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (class_assignment_item_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_advanced_vocab_selection_user_bank
    ON public.advanced_vocab_practice_selections (user_id, bank_id, created_at);
CREATE INDEX IF NOT EXISTS idx_advanced_vocab_selection_bank
    ON public.advanced_vocab_practice_selections (bank_id);

ALTER TABLE public.advanced_vocab_practice_selections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.advanced_vocab_practice_selections
    FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.advanced_vocab_practice_selections TO service_role;

-- A restrictive policy is an AND gate across every permissive SELECT policy.
-- This remains safe if a later migration adds another broad public/admin policy.
DROP POLICY IF EXISTS quiz_banks_advanced_vocab_select_gate
    ON public.quiz_banks;
CREATE POLICY quiz_banks_advanced_vocab_select_gate
    ON public.quiz_banks AS RESTRICTIVE
    FOR SELECT TO anon, authenticated
    USING (COALESCE(meta -> 'runtime' ->> 'kind', '') <> 'advanced_vocab');

-- Resolve the immutable assignment snapshot, then serialize learner access in
-- the canonical order: active membership, parent assignment, assignment item.
-- Submitted work may cross its deadline only for idempotent/review behavior;
-- all incomplete work is rejected after due_at.
CREATE OR REPLACE FUNCTION public.advanced_vocab_lock_open_item(
    p_item_id UUID,
    p_user_id UUID,
    p_bank_id UUID
) RETURNS public.class_assignment_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_student_id UUID;
    v_assignment_id UUID;
    v_cohort_id UUID;
    v_assignment public.class_assignments%ROWTYPE;
    v_item public.class_assignment_items%ROWTYPE;
BEGIN
    SELECT i.student_id, a.id, a.cohort_id
      INTO v_student_id, v_assignment_id, v_cohort_id
      FROM public.class_assignment_items AS i
      JOIN public.class_assignments AS a ON a.id = i.assignment_id
      JOIN public.students AS s ON s.id = i.student_id
     WHERE i.id = p_item_id
       AND s.user_id = p_user_id
       AND a.skill = 'course'
       AND a.content_id = p_bank_id
       AND COALESCE(a.content_config -> 'runtime' ->> 'kind', '') = 'advanced_vocab';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'advanced_vocab_item_not_accessible'
            USING ERRCODE = '42501';
    END IF;

    PERFORM 1
      FROM public.student_cohort_memberships AS m
     WHERE m.student_id = v_student_id
       AND m.cohort_id = v_cohort_id
       AND m.is_active
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'advanced_vocab_membership_inactive'
            USING ERRCODE = '42501';
    END IF;

    SELECT a.* INTO v_assignment
      FROM public.class_assignments AS a
     WHERE a.id = v_assignment_id
       AND a.cohort_id = v_cohort_id
       AND a.skill = 'course'
       AND a.content_id = p_bank_id
       AND COALESCE(a.content_config -> 'runtime' ->> 'kind', '') = 'advanced_vocab'
     FOR UPDATE;
    IF NOT FOUND
       OR v_assignment.status <> 'published'
       OR (v_assignment.publish_at IS NOT NULL
           AND v_assignment.publish_at > clock_timestamp()) THEN
        RAISE EXCEPTION 'advanced_vocab_assignment_closed'
            USING ERRCODE = '42501';
    END IF;

    SELECT i.* INTO v_item
      FROM public.class_assignment_items AS i
     WHERE i.id = p_item_id
       AND i.assignment_id = v_assignment_id
       AND i.student_id = v_student_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'advanced_vocab_item_not_accessible'
            USING ERRCODE = '42501';
    END IF;

    IF v_item.submitted_at IS NULL
       AND v_assignment.due_at IS NOT NULL
       AND v_assignment.due_at < clock_timestamp() THEN
        RAISE EXCEPTION 'advanced_vocab_assignment_expired'
            USING ERRCODE = '55000';
    END IF;

    RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.advanced_vocab_lock_open_item(UUID, UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advanced_vocab_lock_open_item(UUID, UUID, UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION public.advanced_vocab_validate_selection(
    p_stage TEXT,
    p_qids JSONB
) RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_expected INTEGER;
    v_count INTEGER;
    v_distinct INTEGER;
    v_strings INTEGER;
BEGIN
    v_expected := CASE p_stage
        WHEN 'practice_1' THEN 28
        WHEN 'practice_2' THEN 20
        ELSE NULL
    END;
    IF v_expected IS NULL OR jsonb_typeof(p_qids) <> 'array' THEN
        RAISE EXCEPTION 'advanced_vocab_selection_invalid'
            USING ERRCODE = '22023';
    END IF;

    SELECT count(*), count(DISTINCT value),
           count(*) FILTER (WHERE jsonb_typeof(value) = 'string')
      INTO v_count, v_distinct, v_strings
      FROM jsonb_array_elements(p_qids) AS q(value);
    IF v_count <> v_expected OR v_distinct <> v_expected
       OR v_strings <> v_expected THEN
        RAISE EXCEPTION 'advanced_vocab_selection_invalid'
            USING ERRCODE = '22023';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.advanced_vocab_validate_selection(TEXT, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advanced_vocab_validate_selection(TEXT, JSONB)
    TO service_role;

-- quiz_questions is the database-side canonical copy of the deterministic
-- 48-question practice set written by the content importer.  Deriving the two
-- stage selections here lets both the current RPC and the pre-selection
-- backend safely use the same immutable set during a migration-first rollout.
CREATE OR REPLACE FUNCTION public.advanced_vocab_canonical_practice_qids(
    p_bank_id UUID,
    p_stage TEXT
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_qids JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(q.qid ORDER BY q.position), '[]'::JSONB)
      INTO v_qids
      FROM (
          SELECT qq.qid,
                 row_number() OVER (
                     ORDER BY qq."order", qq.qid, qq.id
                 ) AS position
            FROM public.quiz_questions AS qq
           WHERE qq.bank_id = p_bank_id
      ) AS q
     WHERE (p_stage = 'practice_1' AND q.position BETWEEN 1 AND 28)
        OR (p_stage = 'practice_2' AND q.position BETWEEN 29 AND 48);

    PERFORM public.advanced_vocab_validate_selection(p_stage, v_qids);
    RETURN v_qids;
END;
$$;

REVOKE ALL ON FUNCTION public.advanced_vocab_canonical_practice_qids(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advanced_vocab_canonical_practice_qids(UUID, TEXT)
    TO service_role;

CREATE OR REPLACE FUNCTION public.advanced_vocab_guard_selection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'advanced_vocab_selection_immutable'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.bank_id IS NOT DISTINCT FROM OLD.bank_id
           AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
           AND NEW.class_assignment_item_id IS NOT DISTINCT FROM OLD.class_assignment_item_id
           AND NEW.stage IS NOT DISTINCT FROM OLD.stage
           AND NEW.qids IS NOT DISTINCT FROM OLD.qids THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'advanced_vocab_selection_immutable'
            USING ERRCODE = '55000';
    END IF;

    PERFORM public.advanced_vocab_lock_open_item(
        NEW.class_assignment_item_id, NEW.user_id, NEW.bank_id
    );
    PERFORM public.advanced_vocab_validate_selection(NEW.stage, NEW.qids);
    IF NEW.qids IS DISTINCT FROM
       public.advanced_vocab_canonical_practice_qids(NEW.bank_id, NEW.stage) THEN
        RAISE EXCEPTION 'advanced_vocab_selection_not_canonical'
            USING ERRCODE = '22023';
    END IF;

    IF NEW.stage = 'practice_1' AND NOT EXISTS (
        SELECT 1 FROM public.advanced_vocab_stage_progress AS p
         WHERE p.class_assignment_item_id = NEW.class_assignment_item_id
           AND p.stage = 'vocabulary' AND p.status = 'completed'
    ) THEN
        RAISE EXCEPTION 'advanced_vocab_prerequisite_incomplete'
            USING ERRCODE = '55000';
    ELSIF NEW.stage = 'practice_2' AND NOT EXISTS (
        SELECT 1 FROM public.advanced_vocab_stage_progress AS p
         WHERE p.class_assignment_item_id = NEW.class_assignment_item_id
           AND p.stage = 'practice_1' AND p.status = 'completed'
    ) THEN
        RAISE EXCEPTION 'advanced_vocab_prerequisite_incomplete'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advanced_vocab_guard_selection
    ON public.advanced_vocab_practice_selections;
CREATE TRIGGER trg_advanced_vocab_guard_selection
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.advanced_vocab_practice_selections
    FOR EACH ROW EXECUTE FUNCTION public.advanced_vocab_guard_selection();

CREATE OR REPLACE FUNCTION public.start_advanced_vocab_practice(
    p_item_id UUID,
    p_user_id UUID,
    p_bank_id UUID,
    p_stage TEXT,
    p_qids JSONB
) RETURNS public.advanced_vocab_practice_selections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing public.advanced_vocab_practice_selections%ROWTYPE;
    v_canonical_qids JSONB;
BEGIN
    PERFORM public.advanced_vocab_lock_open_item(p_item_id, p_user_id, p_bank_id);

    SELECT s.* INTO v_existing
      FROM public.advanced_vocab_practice_selections AS s
     WHERE s.class_assignment_item_id = p_item_id
       AND s.stage = p_stage;
    IF FOUND THEN
        RETURN v_existing;
    END IF;

    PERFORM public.advanced_vocab_validate_selection(p_stage, p_qids);
    v_canonical_qids := public.advanced_vocab_canonical_practice_qids(
        p_bank_id, p_stage
    );
    IF p_qids IS DISTINCT FROM v_canonical_qids THEN
        RAISE EXCEPTION 'advanced_vocab_selection_not_canonical'
            USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.advanced_vocab_practice_selections (
        bank_id, user_id, class_assignment_item_id, stage, qids
    ) VALUES (p_bank_id, p_user_id, p_item_id, p_stage, v_canonical_qids)
    RETURNING * INTO v_existing;
    RETURN v_existing;
END;
$$;

REVOKE ALL ON FUNCTION public.start_advanced_vocab_practice(
    UUID, UUID, UUID, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_advanced_vocab_practice(
    UUID, UUID, UUID, TEXT, JSONB
) TO service_role;

CREATE OR REPLACE FUNCTION public.advanced_vocab_guard_stage_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_expected INTEGER;
    v_attempted INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'advanced_vocab_stage_immutable'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.bank_id IS NOT DISTINCT FROM OLD.bank_id
           AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
           AND NEW.class_assignment_item_id IS NOT DISTINCT FROM OLD.class_assignment_item_id
           AND NEW.stage IS NOT DISTINCT FROM OLD.stage
           AND NEW.status IS NOT DISTINCT FROM OLD.status
           AND NEW.evidence IS NOT DISTINCT FROM OLD.evidence THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'advanced_vocab_stage_immutable'
            USING ERRCODE = '55000';
    END IF;

    PERFORM public.advanced_vocab_lock_open_item(
        NEW.class_assignment_item_id, NEW.user_id, NEW.bank_id
    );
    IF NEW.status <> 'completed' THEN
        RAISE EXCEPTION 'advanced_vocab_stage_invalid'
            USING ERRCODE = '22023';
    END IF;

    IF NEW.stage = 'vocabulary' THEN
        IF jsonb_typeof(NEW.evidence -> 'seen_lexeme_ids') <> 'array'
           OR jsonb_array_length(NEW.evidence -> 'seen_lexeme_ids') <> 24 THEN
            RAISE EXCEPTION 'advanced_vocab_vocabulary_evidence_invalid'
                USING ERRCODE = '22023';
        END IF;
    ELSIF NEW.stage IN ('practice_1', 'practice_2') THEN
        SELECT jsonb_array_length(s.qids)
          INTO v_expected
          FROM public.advanced_vocab_practice_selections AS s
         WHERE s.class_assignment_item_id = NEW.class_assignment_item_id
           AND s.stage = NEW.stage;
        SELECT count(DISTINCT a.qid)
          INTO v_attempted
          FROM public.advanced_vocab_question_attempts AS a
         WHERE a.class_assignment_item_id = NEW.class_assignment_item_id
           AND a.stage = NEW.stage;
        IF v_expected IS NULL OR v_attempted <> v_expected THEN
            RAISE EXCEPTION 'advanced_vocab_practice_incomplete'
                USING ERRCODE = '55000';
        END IF;
    ELSIF NEW.stage = 'controlled_rewrite' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.course_section_submissions AS c
             WHERE c.class_assignment_item_id = NEW.class_assignment_item_id
               AND c.section = 'reading' AND c.attempt_no = 1
        ) OR jsonb_typeof(NEW.evidence -> 'submitted_item_ids') <> 'array'
             OR jsonb_array_length(NEW.evidence -> 'submitted_item_ids') <> 20
             OR COALESCE((NEW.evidence ->> 'response_count')::INTEGER, -1) <> 20 THEN
            RAISE EXCEPTION 'advanced_vocab_rewrite_evidence_invalid'
                USING ERRCODE = '55000';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advanced_vocab_guard_stage_progress
    ON public.advanced_vocab_stage_progress;
CREATE TRIGGER trg_advanced_vocab_guard_stage_progress
    BEFORE INSERT OR UPDATE OR DELETE ON public.advanced_vocab_stage_progress
    FOR EACH ROW EXECUTE FUNCTION public.advanced_vocab_guard_stage_progress();

CREATE OR REPLACE FUNCTION public.advanced_vocab_guard_question_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_qids JSONB;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'advanced_vocab_attempt_immutable'
            USING ERRCODE = '55000';
    END IF;
    PERFORM public.advanced_vocab_lock_open_item(
        NEW.class_assignment_item_id, NEW.user_id, NEW.bank_id
    );
    SELECT s.qids INTO v_qids
      FROM public.advanced_vocab_practice_selections AS s
     WHERE s.class_assignment_item_id = NEW.class_assignment_item_id
       AND s.stage = NEW.stage;
    IF NOT FOUND THEN
        v_qids := public.advanced_vocab_canonical_practice_qids(
            NEW.bank_id, NEW.stage
        );
        INSERT INTO public.advanced_vocab_practice_selections (
            bank_id, user_id, class_assignment_item_id, stage, qids
        ) VALUES (
            NEW.bank_id, NEW.user_id, NEW.class_assignment_item_id,
            NEW.stage, v_qids
        ) ON CONFLICT (class_assignment_item_id, stage) DO NOTHING;
        SELECT s.qids INTO v_qids
          FROM public.advanced_vocab_practice_selections AS s
         WHERE s.class_assignment_item_id = NEW.class_assignment_item_id
           AND s.stage = NEW.stage;
    END IF;
    IF NOT EXISTS (
        SELECT 1 WHERE v_qids @> jsonb_build_array(NEW.qid)
    ) THEN
        RAISE EXCEPTION 'advanced_vocab_question_not_selected'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advanced_vocab_guard_question_attempt
    ON public.advanced_vocab_question_attempts;
CREATE TRIGGER trg_advanced_vocab_guard_question_attempt
    BEFORE INSERT OR UPDATE OR DELETE ON public.advanced_vocab_question_attempts
    FOR EACH ROW EXECUTE FUNCTION public.advanced_vocab_guard_question_attempt();

CREATE OR REPLACE FUNCTION public.advanced_vocab_complete_practice_after_answer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_expected INTEGER;
    v_attempted INTEGER;
BEGIN
    SELECT jsonb_array_length(s.qids)
      INTO v_expected
      FROM public.advanced_vocab_practice_selections AS s
     WHERE s.class_assignment_item_id = NEW.class_assignment_item_id
       AND s.stage = NEW.stage;
    SELECT count(DISTINCT a.qid)
      INTO v_attempted
      FROM public.advanced_vocab_question_attempts AS a
     WHERE a.class_assignment_item_id = NEW.class_assignment_item_id
       AND a.stage = NEW.stage;
    IF v_expected IS NOT NULL AND v_attempted = v_expected THEN
        INSERT INTO public.advanced_vocab_stage_progress (
            bank_id, user_id, class_assignment_item_id, stage, status, evidence
        ) VALUES (
            NEW.bank_id, NEW.user_id, NEW.class_assignment_item_id, NEW.stage,
            'completed', jsonb_build_object('question_count', v_expected)
        ) ON CONFLICT (class_assignment_item_id, stage) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advanced_vocab_complete_practice_after_answer
    ON public.advanced_vocab_question_attempts;
CREATE TRIGGER trg_advanced_vocab_complete_practice_after_answer
    AFTER INSERT ON public.advanced_vocab_question_attempts
    FOR EACH ROW EXECUTE FUNCTION public.advanced_vocab_complete_practice_after_answer();

CREATE OR REPLACE FUNCTION public.advanced_vocab_guard_listening_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'advanced_vocab_listening_attempt_immutable'
            USING ERRCODE = '55000';
    END IF;
    PERFORM public.advanced_vocab_lock_open_item(
        NEW.class_assignment_item_id, NEW.user_id, NEW.bank_id
    );
    IF NOT EXISTS (
        SELECT 1 FROM public.advanced_vocab_stage_progress AS p
         WHERE p.class_assignment_item_id = NEW.class_assignment_item_id
           AND p.stage = 'controlled_rewrite' AND p.status = 'completed'
    ) THEN
        RAISE EXCEPTION 'advanced_vocab_prerequisite_incomplete'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advanced_vocab_guard_listening_attempt
    ON public.advanced_vocab_listening_attempts;
CREATE TRIGGER trg_advanced_vocab_guard_listening_attempt
    BEFORE INSERT OR UPDATE OR DELETE ON public.advanced_vocab_listening_attempts
    FOR EACH ROW EXECUTE FUNCTION public.advanced_vocab_guard_listening_attempt();

CREATE OR REPLACE FUNCTION public.advanced_vocab_guard_course_section()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_advanced BOOLEAN;
BEGIN
    SELECT COALESCE(a.content_config -> 'runtime' ->> 'kind', '') = 'advanced_vocab'
      INTO v_is_advanced
      FROM public.class_assignment_items AS i
      JOIN public.class_assignments AS a ON a.id = i.assignment_id
     WHERE i.id = COALESCE(NEW.class_assignment_item_id,
                            OLD.class_assignment_item_id);
    IF v_is_advanced IS NOT TRUE THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'advanced_vocab_section_immutable'
            USING ERRCODE = '55000';
    END IF;

    PERFORM public.advanced_vocab_lock_open_item(
        NEW.class_assignment_item_id, NEW.user_id, NEW.bank_id
    );
    IF NEW.attempt_no <> 1 THEN
        RAISE EXCEPTION 'advanced_vocab_attempt_must_be_one'
            USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.course_section_submissions AS c
         WHERE c.class_assignment_item_id = NEW.class_assignment_item_id
           AND c.section = NEW.section
    ) THEN
        RAISE EXCEPTION 'advanced_vocab_section_already_submitted'
            USING ERRCODE = '23505';
    END IF;
    IF NEW.section = 'reading' AND NOT EXISTS (
        SELECT 1 FROM public.advanced_vocab_stage_progress AS p
         WHERE p.class_assignment_item_id = NEW.class_assignment_item_id
           AND p.stage = 'practice_2' AND p.status = 'completed'
    ) THEN
        RAISE EXCEPTION 'advanced_vocab_prerequisite_incomplete'
            USING ERRCODE = '55000';
    ELSIF NEW.section = 'listening' AND NOT EXISTS (
        SELECT 1 FROM public.advanced_vocab_stage_progress AS p
         WHERE p.class_assignment_item_id = NEW.class_assignment_item_id
           AND p.stage = 'controlled_rewrite' AND p.status = 'completed'
    ) THEN
        RAISE EXCEPTION 'advanced_vocab_prerequisite_incomplete'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_advanced_vocab_guard_course_section
    ON public.course_section_submissions;
CREATE TRIGGER trg_advanced_vocab_guard_course_section
    BEFORE INSERT OR UPDATE OR DELETE ON public.course_section_submissions
    FOR EACH ROW EXECUTE FUNCTION public.advanced_vocab_guard_course_section();

-- Replace migration 281's finalizer so direct invocation is protected by the
-- same persistence-time gate, not only by the section trigger.
CREATE OR REPLACE FUNCTION public.finalize_advanced_vocab_assignment(
    p_item_id UUID,
    p_user_id UUID,
    p_bank_id UUID,
    p_mastery JSONB
) RETURNS public.class_assignment_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_item public.class_assignment_items%ROWTYPE;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    v_item := public.advanced_vocab_lock_open_item(
        p_item_id, p_user_id, p_bank_id
    );

    IF (SELECT COUNT(*) FROM public.advanced_vocab_stage_progress AS p
         WHERE p.class_assignment_item_id = p_item_id
           AND p.user_id = p_user_id AND p.bank_id = p_bank_id
           AND p.stage IN ('vocabulary', 'practice_1', 'practice_2',
                           'controlled_rewrite')
           AND p.status = 'completed') <> 4 THEN
        RAISE EXCEPTION 'advanced vocabulary stages incomplete'
            USING ERRCODE = 'P0001';
    END IF;

    IF (SELECT COUNT(DISTINCT c.section)
          FROM public.course_section_submissions AS c
         WHERE c.class_assignment_item_id = p_item_id
           AND c.user_id = p_user_id AND c.bank_id = p_bank_id
           AND c.attempt_no = 1
           AND c.section IN ('reading', 'listening')) <> 2 THEN
        RAISE EXCEPTION 'advanced vocabulary sections incomplete'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.class_assignment_items
       SET state = 'submitted',
           submitted_at = COALESCE(submitted_at, v_now),
           passed_at = COALESCE(passed_at, v_now),
           score = NULL,
           artifact_kind = 'advanced_vocab_progress',
           artifact_id = p_item_id,
           mastery = COALESCE(p_mastery, '{}'::jsonb),
           updated_at = v_now
     WHERE id = p_item_id
     RETURNING * INTO v_item;
    RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_advanced_vocab_assignment(
    UUID, UUID, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_advanced_vocab_assignment(
    UUID, UUID, UUID, JSONB
) TO service_role;

-- One Advanced bank always owns a committed immutable file/media revision.  It
-- may be unpublished, but hard deletion would make its FK-backed evidence and
-- assignment history unresolvable.
CREATE OR REPLACE FUNCTION public.protect_advanced_vocab_bank()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF COALESCE(OLD.meta -> 'runtime' ->> 'kind', '') = 'advanced_vocab' THEN
        RAISE EXCEPTION 'cannot delete immutable advanced vocabulary bank; unpublish it instead'
            USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_advanced_vocab_bank ON public.quiz_banks;
CREATE TRIGGER trg_protect_advanced_vocab_bank
    BEFORE DELETE ON public.quiz_banks
    FOR EACH ROW EXECUTE FUNCTION public.protect_advanced_vocab_bank();

-- Assignment issuance already shares the quiz_banks row lock with Course-bank
-- replacement (migration 269).  This trigger adds the Advanced-specific final
-- publication and frozen-runtime revalidation inside that same transaction.
CREATE OR REPLACE FUNCTION public.guard_advanced_vocab_assignment_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bank public.quiz_banks%ROWTYPE;
    v_runtime JSONB;
BEGIN
    IF NEW.skill <> 'course' OR NEW.content_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT qb.* INTO v_bank
      FROM public.quiz_banks AS qb
     WHERE qb.id = NEW.content_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    v_runtime := COALESCE(v_bank.meta -> 'runtime', '{}'::JSONB);
    IF COALESCE(v_runtime ->> 'kind', '') <> 'advanced_vocab' THEN
        RETURN NEW;
    END IF;

    IF v_bank.is_published IS NOT TRUE THEN
        RAISE EXCEPTION 'advanced_vocab_bank_unpublished'
            USING ERRCODE = '55000';
    END IF;
    IF COALESCE(NEW.content_config -> 'runtime', '{}'::JSONB)
           IS DISTINCT FROM v_runtime
       OR NULLIF(v_runtime ->> 'content_checksum', '') IS NULL
       OR NULLIF(v_runtime ->> 'lesson_id', '') IS NULL THEN
        RAISE EXCEPTION 'advanced_vocab_assignment_snapshot_mismatch'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_advanced_vocab_assignment_snapshot
    ON public.class_assignments;
CREATE TRIGGER trg_guard_advanced_vocab_assignment_snapshot
    BEFORE INSERT OR UPDATE OF content_id, content_config
    ON public.class_assignments
    FOR EACH ROW EXECUTE FUNCTION public.guard_advanced_vocab_assignment_snapshot();

CREATE OR REPLACE FUNCTION public.protect_advanced_vocab_item_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.advanced_vocab_practice_selections
                WHERE class_assignment_item_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.advanced_vocab_stage_progress
                   WHERE class_assignment_item_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.advanced_vocab_question_attempts
                   WHERE class_assignment_item_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.advanced_vocab_listening_attempts
                   WHERE class_assignment_item_id = OLD.id) THEN
        RAISE EXCEPTION 'cannot delete assignment item with advanced vocabulary evidence'
            USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_advanced_vocab_item_evidence
    ON public.class_assignment_items;
CREATE TRIGGER trg_protect_advanced_vocab_item_evidence
    BEFORE DELETE ON public.class_assignment_items
    FOR EACH ROW EXECUTE FUNCTION public.protect_advanced_vocab_item_evidence();

COMMENT ON TABLE public.advanced_vocab_practice_selections IS
'Immutable server-selected Practice question IDs for one Advanced Vocabulary assignment item and stage.';
COMMENT ON FUNCTION public.advanced_vocab_lock_open_item(UUID, UUID, UUID) IS
'Locks active membership, parent assignment, then assignment item and rechecks the Advanced persistence-time access boundary.';

NOTIFY pgrst, 'reload schema';

COMMIT;
