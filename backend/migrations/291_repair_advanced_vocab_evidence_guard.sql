-- Migration 288 extended this function for Controlled Rewrite submissions but
-- accidentally omitted immutable Practice selections from migration 282.
-- Reinstall the complete union so every Advanced Vocabulary evidence store
-- continues to block assignment-item deletion on already-migrated databases.

BEGIN;

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

COMMENT ON FUNCTION protect_advanced_vocab_item_evidence() IS
    'Blocks deletion when any immutable Advanced Vocabulary learner evidence exists.';

COMMIT;
