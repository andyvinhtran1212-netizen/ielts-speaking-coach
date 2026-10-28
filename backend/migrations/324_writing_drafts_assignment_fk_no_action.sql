-- Migration: 324_writing_drafts_assignment_fk_no_action.sql
--
-- A-08B / ASSIGNDRAFT-0027. writing_drafts.assignment_id was ON DELETE CASCADE
-- (037:17): deleting a writing assignment silently erased the learner's draft
-- (admin check-then-delete race, instructor route with no status check).
-- NO ACTION makes Postgres refuse any assignment delete while a draft exists;
-- the backend maps 23503 to 409. NO ACTION (not RESTRICT) so a single-statement
-- student purge that removes both rows through student_id CASCADE still works.
-- No data change. Idempotent.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Precheck: VALIDATE would fail on orphans; refuse to guess.
DO $$
DECLARE
    v_orphans BIGINT;
BEGIN
    SELECT count(*) INTO v_orphans
      FROM public.writing_drafts d
     WHERE NOT EXISTS (SELECT 1 FROM public.writing_assignments a WHERE a.id = d.assignment_id);
    IF v_orphans > 0 THEN
        RAISE EXCEPTION 'writing_drafts_orphans_exist'
            USING DETAIL = format('%s drafts reference a missing assignment', v_orphans);
    END IF;
END $$;

-- 2. Replace the FK only when it is still the 037 CASCADE (catalog fields, not
--    pg_get_constraintdef text, so search_path cannot change the comparison).
DO $$
DECLARE
    v_deltype "char";
BEGIN
    SELECT c.confdeltype INTO v_deltype
      FROM pg_constraint c
     WHERE c.conrelid = 'public.writing_drafts'::regclass
       AND c.conname = 'writing_drafts_assignment_id_fkey'
       AND c.contype = 'f'
       AND c.confrelid = 'public.writing_assignments'::regclass;

    IF v_deltype = 'a' THEN
        RETURN;                                   -- already NO ACTION (re-run)
    ELSIF v_deltype = 'c' OR v_deltype IS NULL THEN
        ALTER TABLE public.writing_drafts
            DROP CONSTRAINT IF EXISTS writing_drafts_assignment_id_fkey;
        ALTER TABLE public.writing_drafts
            ADD CONSTRAINT writing_drafts_assignment_id_fkey
            FOREIGN KEY (assignment_id) REFERENCES public.writing_assignments(id)
            ON DELETE NO ACTION NOT VALID;
    ELSE
        RAISE EXCEPTION 'writing_drafts_assignment_fk_unexpected'
            USING DETAIL = format('confdeltype=%s; review before changing', v_deltype);
    END IF;
END $$;

ALTER TABLE public.writing_drafts VALIDATE CONSTRAINT writing_drafts_assignment_id_fkey;

-- 3. Postcondition
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conrelid = 'public.writing_drafts'::regclass
           AND c.conname = 'writing_drafts_assignment_id_fkey'
           AND c.confrelid = 'public.writing_assignments'::regclass
           AND c.confdeltype = 'a'
           AND c.convalidated
    ) THEN
        RAISE EXCEPTION 'writing_drafts_assignment_fk_postcondition_failed';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.contype = 'f'
           AND c.confrelid = 'public.writing_assignments'::regclass
           AND c.confdeltype = 'c'
    ) THEN
        RAISE EXCEPTION 'writing_assignments_still_has_cascading_child';
    END IF;
END $$;

COMMIT;
