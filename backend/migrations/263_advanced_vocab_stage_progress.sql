-- Advanced Vocabulary self-paced evidence ledger (core ADV-T01…ADV-T30).
-- Apply before importing or assigning any Advanced Vocabulary core bank.

BEGIN;

CREATE TABLE IF NOT EXISTS advanced_vocab_stage_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id UUID NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    class_assignment_item_id UUID NOT NULL
        REFERENCES class_assignment_items(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status = 'completed'),
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (class_assignment_item_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_advanced_vocab_stage_user_bank
    ON advanced_vocab_stage_progress (user_id, bank_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_advanced_vocab_stage_bank
    ON advanced_vocab_stage_progress (bank_id);

-- A rerun also upgrades an early pilot copy of this migration whose anonymous
-- CHECK allowed only the first three stages.
DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'advanced_vocab_stage_progress'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%stage%'
    LOOP
        EXECUTE format(
            'ALTER TABLE advanced_vocab_stage_progress DROP CONSTRAINT %I', c.conname
        );
    END LOOP;
END $$;

ALTER TABLE advanced_vocab_stage_progress
    ADD CONSTRAINT advanced_vocab_stage_progress_stage_check CHECK (
        stage IN ('vocabulary', 'practice_1', 'practice_2', 'controlled_rewrite')
    );

CREATE TABLE IF NOT EXISTS advanced_vocab_question_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id UUID NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    class_assignment_item_id UUID NOT NULL
        REFERENCES class_assignment_items(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('practice_1', 'practice_2')),
    qid TEXT NOT NULL,
    answer_given JSONB NOT NULL,
    is_correct BOOLEAN NOT NULL,
    response_time_ms INTEGER CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (class_assignment_item_id, qid)
);

CREATE INDEX IF NOT EXISTS idx_advanced_vocab_attempt_user_bank
    ON advanced_vocab_question_attempts (user_id, bank_id, created_at);
CREATE INDEX IF NOT EXISTS idx_advanced_vocab_attempt_bank
    ON advanced_vocab_question_attempts (bank_id);

ALTER TABLE advanced_vocab_stage_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE advanced_vocab_question_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.advanced_vocab_stage_progress
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.advanced_vocab_question_attempts
    FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.advanced_vocab_stage_progress TO service_role;
GRANT ALL ON TABLE public.advanced_vocab_question_attempts TO service_role;

-- Replace the enumerated artifact check without guessing its generated name.
DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'class_assignment_items'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%artifact_kind%IN%'
    LOOP
        EXECUTE format(
            'ALTER TABLE class_assignment_items DROP CONSTRAINT %I', c.conname
        );
    END LOOP;
END $$;

ALTER TABLE class_assignment_items
    ADD CONSTRAINT class_assignment_items_artifact_kind_check CHECK (
        artifact_kind IN ('session', 'writing_assignment', 'reading_attempt',
                          'listening_attempt', 'quiz_session', 'course_writing',
                          'advanced_vocab_progress'));

-- Finalization is a single transaction: no partially submitted assignment can
-- be created between the evidence checks and the ledger update.
CREATE OR REPLACE FUNCTION finalize_advanced_vocab_assignment(
    p_item_id UUID,
    p_user_id UUID,
    p_bank_id UUID,
    p_mastery JSONB
) RETURNS class_assignment_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_item class_assignment_items%ROWTYPE;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    SELECT i.* INTO v_item
      FROM class_assignment_items i
      JOIN students s ON s.id = i.student_id
      JOIN class_assignments a ON a.id = i.assignment_id
     WHERE i.id = p_item_id
       AND s.user_id = p_user_id
       AND a.skill = 'course'
       AND a.content_id = p_bank_id
     FOR UPDATE OF i;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'advanced vocabulary assignment item not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF (SELECT COUNT(*) FROM advanced_vocab_stage_progress p
         WHERE p.class_assignment_item_id = p_item_id
           AND p.user_id = p_user_id AND p.bank_id = p_bank_id
           AND p.stage IN ('vocabulary', 'practice_1', 'practice_2',
                           'controlled_rewrite')
           AND p.status = 'completed') <> 4 THEN
        RAISE EXCEPTION 'advanced vocabulary stages incomplete'
            USING ERRCODE = 'P0001';
    END IF;

    IF (SELECT COUNT(DISTINCT c.section) FROM course_section_submissions c
         WHERE c.class_assignment_item_id = p_item_id
           AND c.user_id = p_user_id AND c.bank_id = p_bank_id
           AND c.section IN ('reading', 'listening')) <> 2 THEN
        RAISE EXCEPTION 'advanced vocabulary sections incomplete'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE class_assignment_items
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

REVOKE ALL ON FUNCTION finalize_advanced_vocab_assignment(UUID, UUID, UUID, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalize_advanced_vocab_assignment(UUID, UUID, UUID, JSONB)
    TO service_role;

-- Listening is the final required interaction.  Finalize from the same
-- database transaction as its canonical submission so a process/network
-- failure can never leave Listening persisted while the assignment remains
-- open.  Generic course listening rows pass through unchanged.
CREATE OR REPLACE FUNCTION finalize_advanced_vocab_on_listening()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_runtime JSONB;
    v_lesson_id TEXT;
    v_mastery JSONB;
BEGIN
    IF NEW.section <> 'listening' THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(q.meta -> 'runtime', '{}'::jsonb)
      INTO v_runtime
      FROM quiz_banks q
     WHERE q.id = NEW.bank_id;
    IF COALESCE(v_runtime ->> 'kind', '') <> 'advanced_vocab' THEN
        RETURN NEW;
    END IF;

    v_lesson_id := v_runtime ->> 'lesson_id';
    v_mastery := jsonb_build_object(
        'runtime', 'advanced_vocab_v1',
        'lesson_id', v_lesson_id,
        'completed_stages', jsonb_build_array(
            'vocabulary', 'practice_1', 'practice_2', 'reading',
            'controlled_rewrite', 'listening'
        ),
        'completion_policy', 'required_interactions'
    );
    PERFORM finalize_advanced_vocab_assignment(
        NEW.class_assignment_item_id, NEW.user_id, NEW.bank_id, v_mastery
    );
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION finalize_advanced_vocab_on_listening()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalize_advanced_vocab_on_listening()
    TO service_role;

DROP TRIGGER IF EXISTS trg_finalize_advanced_vocab_on_listening
    ON course_section_submissions;
CREATE TRIGGER trg_finalize_advanced_vocab_on_listening
    AFTER INSERT ON course_section_submissions
    FOR EACH ROW EXECUTE FUNCTION finalize_advanced_vocab_on_listening();

-- Repair any complete pilot row produced before the atomic trigger existed.
UPDATE class_assignment_items i
   SET state = 'submitted',
       submitted_at = COALESCE(i.submitted_at, evidence.completed_at),
       passed_at = COALESCE(i.passed_at, evidence.completed_at),
       score = NULL,
       artifact_kind = 'advanced_vocab_progress',
       artifact_id = i.id,
       mastery = evidence.mastery,
       updated_at = NOW()
  FROM (
      SELECT i2.id AS item_id,
             MAX(c.submitted_at) AS completed_at,
             jsonb_build_object(
                 'runtime', 'advanced_vocab_v1',
                 'lesson_id', MAX(q.meta -> 'runtime' ->> 'lesson_id'),
                 'completed_stages', jsonb_build_array(
                     'vocabulary', 'practice_1', 'practice_2', 'reading',
                     'controlled_rewrite', 'listening'
                 ),
                 'completion_policy', 'required_interactions'
             ) AS mastery
        FROM class_assignment_items i2
        JOIN class_assignments a ON a.id = i2.assignment_id
        JOIN quiz_banks q ON q.id = a.content_id
        JOIN course_section_submissions c
          ON c.class_assignment_item_id = i2.id
        WHERE q.meta -> 'runtime' ->> 'kind' = 'advanced_vocab'
          AND EXISTS (
              SELECT 1 FROM advanced_vocab_stage_progress p
               WHERE p.class_assignment_item_id = i2.id
               GROUP BY p.class_assignment_item_id
              HAVING COUNT(DISTINCT p.stage) FILTER (
                  WHERE p.status = 'completed'
                    AND p.stage IN ('vocabulary', 'practice_1', 'practice_2',
                                    'controlled_rewrite')
              ) = 4
          )
        GROUP BY i2.id
       HAVING COUNT(DISTINCT c.section) FILTER (
           WHERE c.section IN ('reading', 'listening')
       ) = 2
  ) evidence
 WHERE i.id = evidence.item_id
   AND i.submitted_at IS NULL;

-- The generic assignment-delete RPC predates this ledger.  Protect partial
-- self-paced work too: otherwise an item with 47 answers but no submitted_at
-- would still look "unsubmitted" to that RPC and cascade-delete its evidence.
CREATE OR REPLACE FUNCTION protect_advanced_vocab_item_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM advanced_vocab_stage_progress
                WHERE class_assignment_item_id = OLD.id)
       OR EXISTS (SELECT 1 FROM advanced_vocab_question_attempts
                   WHERE class_assignment_item_id = OLD.id) THEN
        RAISE EXCEPTION 'cannot delete assignment item with advanced vocabulary evidence'
            USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_advanced_vocab_item_evidence
    ON class_assignment_items;
CREATE TRIGGER trg_protect_advanced_vocab_item_evidence
    BEFORE DELETE ON class_assignment_items
    FOR EACH ROW EXECUTE FUNCTION protect_advanced_vocab_item_evidence();

COMMIT;
