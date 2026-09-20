-- One immutable, batch-graded Controlled Rewrite submission per learner/unit.

BEGIN;

CREATE TABLE IF NOT EXISTS advanced_vocab_rewrite_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id UUID NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    class_assignment_item_id UUID NOT NULL
        REFERENCES class_assignment_items(id) ON DELETE CASCADE,
    answers JSONB NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
    content_snapshot JSONB NOT NULL CHECK (jsonb_typeof(content_snapshot) = 'object'),
    feedback JSONB CHECK (feedback IS NULL OR jsonb_typeof(feedback) = 'object'),
    status TEXT NOT NULL DEFAULT 'processing'
        CHECK (status IN ('processing', 'completed', 'failed')),
    model TEXT,
    prompt_version TEXT NOT NULL DEFAULT 'advanced-vocab-rewrite-v1',
    error_code TEXT,
    provider_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (class_assignment_item_id)
);

CREATE INDEX IF NOT EXISTS idx_advanced_vocab_rewrite_user_bank
    ON advanced_vocab_rewrite_submissions (user_id, bank_id, created_at DESC);

ALTER TABLE advanced_vocab_rewrite_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.advanced_vocab_rewrite_submissions
    FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.advanced_vocab_rewrite_submissions TO service_role;

CREATE OR REPLACE FUNCTION claim_advanced_vocab_rewrite_submission(
    p_item_id UUID,
    p_user_id UUID,
    p_bank_id UUID,
    p_answers JSONB,
    p_content_snapshot JSONB,
    p_prompt_version TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_publish_at TIMESTAMPTZ;
    v_due_at TIMESTAMPTZ;
    v_now TIMESTAMPTZ;
    v_submission advanced_vocab_rewrite_submissions%ROWTYPE;
BEGIN
    SELECT assignment.status, assignment.publish_at, assignment.due_at
      INTO v_status, v_publish_at, v_due_at
      FROM class_assignment_items AS item
      JOIN class_assignments AS assignment ON assignment.id = item.assignment_id
      JOIN students AS student ON student.id = item.student_id
      JOIN student_cohort_memberships AS membership
        ON membership.student_id = student.id
       AND membership.cohort_id = assignment.cohort_id
       AND membership.is_active IS TRUE
      JOIN quiz_banks AS bank ON bank.id = assignment.content_id
     WHERE item.id = p_item_id
       AND student.user_id = p_user_id
       AND assignment.content_id = p_bank_id
       AND assignment.skill = 'course'
       AND bank.meta -> 'runtime' ->> 'kind' = 'advanced_vocab'
     FOR UPDATE OF membership, assignment, item;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'advanced_vocab_assignment_not_accessible'
            USING ERRCODE = '42501';
    END IF;

    v_now := clock_timestamp();
    IF v_status <> 'published'
       OR (v_publish_at IS NOT NULL AND v_publish_at > v_now)
       OR (v_due_at IS NOT NULL AND v_due_at <= v_now) THEN
        RAISE EXCEPTION 'advanced_vocab_assignment_not_accepting'
            USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM course_section_submissions
         WHERE class_assignment_item_id = p_item_id
           AND user_id = p_user_id AND bank_id = p_bank_id
           AND section = 'reading'
    ) THEN
        RAISE EXCEPTION 'advanced_vocab_reading_incomplete'
            USING ERRCODE = '55000';
    END IF;

    SELECT * INTO v_submission
      FROM advanced_vocab_rewrite_submissions
     WHERE class_assignment_item_id = p_item_id
     FOR UPDATE;
    IF FOUND THEN
        IF v_submission.user_id IS DISTINCT FROM p_user_id
           OR v_submission.bank_id IS DISTINCT FROM p_bank_id
           OR v_submission.answers IS DISTINCT FROM p_answers THEN
            RAISE EXCEPTION 'advanced_vocab_rewrite_already_submitted'
                USING ERRCODE = '23505';
        END IF;
        RETURN jsonb_build_object(
            'should_grade', FALSE, 'submission', to_jsonb(v_submission)
        );
    END IF;

    INSERT INTO advanced_vocab_rewrite_submissions (
        bank_id, user_id, class_assignment_item_id, answers,
        content_snapshot, prompt_version
    ) VALUES (
        p_bank_id, p_user_id, p_item_id, p_answers,
        p_content_snapshot, p_prompt_version
    ) RETURNING * INTO v_submission;

    INSERT INTO advanced_vocab_stage_progress (
        bank_id, user_id, class_assignment_item_id, stage, status, evidence
    ) VALUES (
        p_bank_id, p_user_id, p_item_id, 'controlled_rewrite', 'completed',
        jsonb_build_object(
            'submitted_item_ids', (SELECT jsonb_agg(value ORDER BY value)
                                     FROM jsonb_object_keys(p_answers) AS keys(value)),
            'response_count', (SELECT count(*) FROM jsonb_object_keys(p_answers))
        )
    ) ON CONFLICT (class_assignment_item_id, stage) DO UPDATE
          SET evidence = EXCLUDED.evidence,
              status = 'completed',
              completed_at = NOW(),
              updated_at = NOW();

    RETURN jsonb_build_object(
        'should_grade', TRUE, 'submission', to_jsonb(v_submission)
    );
END;
$$;

REVOKE ALL ON FUNCTION claim_advanced_vocab_rewrite_submission(
    UUID, UUID, UUID, JSONB, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_advanced_vocab_rewrite_submission(
    UUID, UUID, UUID, JSONB, JSONB, TEXT
) TO service_role;

-- Partial work is evidence too and must not disappear through assignment
-- deletion. Extend the guard introduced by migration 281.
CREATE OR REPLACE FUNCTION protect_advanced_vocab_item_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM advanced_vocab_practice_selections
                WHERE class_assignment_item_id = OLD.id)
       OR EXISTS (SELECT 1 FROM advanced_vocab_stage_progress
                WHERE class_assignment_item_id = OLD.id)
       OR EXISTS (SELECT 1 FROM advanced_vocab_question_attempts
                   WHERE class_assignment_item_id = OLD.id)
       OR EXISTS (SELECT 1 FROM advanced_vocab_listening_attempts
                   WHERE class_assignment_item_id = OLD.id)
       OR EXISTS (SELECT 1 FROM advanced_vocab_rewrite_submissions
                   WHERE class_assignment_item_id = OLD.id) THEN
        RAISE EXCEPTION 'cannot delete assignment item with advanced vocabulary evidence'
            USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
END;
$$;

COMMIT;
