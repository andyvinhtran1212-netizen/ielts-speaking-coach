-- Align the persistence gate already present on staging with the immutable
-- answer evidence written by the one-shot Controlled Rewrite claim RPC.

BEGIN;

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

REVOKE ALL ON FUNCTION public.advanced_vocab_guard_stage_progress()
    FROM PUBLIC, anon, authenticated;

COMMIT;
