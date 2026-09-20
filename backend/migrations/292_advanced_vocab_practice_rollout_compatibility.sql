-- Keep Advanced Vocabulary practice safe across a migration-first rollout.
--
-- Migration 282 required an explicit practice-selection row before every
-- answer.  The pre-selection backend writes the first answer directly, so an
-- old application instance could be rejected between the database migration
-- and application promotion.  This repair derives the canonical 28/20 split
-- from quiz_questions, backfills legacy evidence, and lets the attempt guard
-- create that immutable canonical selection atomically for old writers.

BEGIN;

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

-- Fail closed before touching legacy data.  Existing selections must already
-- match the canonical imported set, and every legacy attempt must belong to it.
DO $$
DECLARE
    v_row RECORD;
    v_canonical JSONB;
BEGIN
    FOR v_row IN
        SELECT bank_id, class_assignment_item_id, stage, qids
          FROM public.advanced_vocab_practice_selections
    LOOP
        v_canonical := public.advanced_vocab_canonical_practice_qids(
            v_row.bank_id, v_row.stage
        );
        IF v_row.qids IS DISTINCT FROM v_canonical THEN
            RAISE EXCEPTION
                'advanced_vocab_existing_selection_not_canonical item=% stage=%',
                v_row.class_assignment_item_id, v_row.stage
                USING ERRCODE = '22023';
        END IF;
    END LOOP;

    FOR v_row IN
        SELECT DISTINCT bank_id, class_assignment_item_id, stage, qid
          FROM public.advanced_vocab_question_attempts
    LOOP
        v_canonical := public.advanced_vocab_canonical_practice_qids(
            v_row.bank_id, v_row.stage
        );
        IF NOT v_canonical @> jsonb_build_array(v_row.qid) THEN
            RAISE EXCEPTION
                'advanced_vocab_legacy_attempt_not_canonical item=% stage=% qid=%',
                v_row.class_assignment_item_id, v_row.stage, v_row.qid
                USING ERRCODE = '22023';
        END IF;
    END LOOP;
END;
$$;

-- Historical assignments can be submitted, expired, or have inactive
-- membership.  Their evidence is immutable, so backfill only the deterministic
-- reconstruction while temporarily bypassing the new-work access trigger.
ALTER TABLE public.advanced_vocab_practice_selections DISABLE TRIGGER USER;

INSERT INTO public.advanced_vocab_practice_selections (
    bank_id, user_id, class_assignment_item_id, stage, qids
)
SELECT evidence.bank_id,
       evidence.user_id,
       evidence.class_assignment_item_id,
       evidence.stage,
       public.advanced_vocab_canonical_practice_qids(
           evidence.bank_id, evidence.stage
       )
  FROM (
      SELECT DISTINCT bank_id, user_id, class_assignment_item_id, stage
        FROM public.advanced_vocab_question_attempts
  ) AS evidence
ON CONFLICT (class_assignment_item_id, stage) DO NOTHING;

ALTER TABLE public.advanced_vocab_practice_selections ENABLE TRIGGER USER;

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

COMMENT ON FUNCTION public.advanced_vocab_canonical_practice_qids(UUID, TEXT) IS
'Returns the immutable database-side 28/20 Advanced Vocabulary practice split.';

NOTIFY pgrst, 'reload schema';

COMMIT;
