-- Migration: 331_writing_assignment_archived_student_guard.sql
--
-- GIVEARCHIVE-0031 (specs/0031-archived-learner-give-guard). STUDENTARCHIVE-0029
-- refuses Writing gives to archived learners only with a Python pre-check that
-- runs in its own statement before the insert, so an archive committing in
-- between still created a writing_assignments row for the archived learner
-- (PR #1746 Codex P2). The same check-then-write gap exists on the legacy class
-- fan-out and the late-joiner backfill. Guard every insert (and every change of
-- student_id) in the database instead, for every caller: the idempotent RPC,
-- PostgREST inserts, scripts and manual SQL.
--
-- The trigger locks the learner row FOR KEY SHARE — the lock the student_id FK
-- check already takes — which conflicts only with the FOR UPDATE that
-- fn_archive_student / fn_restore_student (326) take first. Under READ
-- COMMITTED a give that waits on an archive re-reads the committed row, sees
-- archived_at and is refused (the whole statement rolls back: no partial bulk
-- insert, no idempotency ledger row); a give that locked first commits before
-- the archive runs and is kept as history (0029 FR-005). No data changes.
--
-- Invariant: students.archived_at is written only by the 326 functions (FOR
-- UPDATE); the precondition below checks it. A raw UPDATE of archived_at would
-- not conflict with FOR KEY SHARE — always archive through fn_archive_student.
-- A-10 / migration 330 (and any later migration) must not drop, replace or
-- disable this trigger or its function, and must not insert into
-- writing_assignments with triggers disabled.
--
-- Order: independent of the backend. Without the 0031 backend a refused give
-- returns 500 and creates no row (fails closed); the backend 409 mapping is
-- dormant without this trigger.
--
-- ROLLBACK (a new forward migration, never an edit of this file). Safe at any
-- time, no data to repair; it only reopens the 0029 race:
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DROP TRIGGER IF EXISTS archive_guard_writing_assignment_student ON public.writing_assignments;
--   DROP FUNCTION IF EXISTS public.fn_guard_writing_assignment_student_archived();
--   COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 0. Preconditions (abort if unsafe)
DO $$
DECLARE
    v_fn regprocedure;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'students'
                      AND column_name = 'archived_at') THEN
        RAISE EXCEPTION 'migration_326_missing';
    END IF;
    IF to_regclass('public.writing_assignments') IS NULL THEN
        RAISE EXCEPTION 'writing_assignments_missing';
    END IF;
    -- The guard serializes against archive/restore only because both lock the
    -- learner row FOR UPDATE before writing archived_at.
    FOREACH v_fn IN ARRAY ARRAY[
        to_regprocedure('public.fn_archive_student(uuid,uuid,text,boolean)'),
        to_regprocedure('public.fn_restore_student(uuid,uuid,text,boolean,boolean)')]
    LOOP
        IF v_fn IS NULL
           OR position('students WHERE id = p_student_id FOR UPDATE' IN pg_get_functiondef(v_fn)) = 0 THEN
            RAISE EXCEPTION 'student_lifecycle_functions_must_lock_for_update';
        END IF;
    END LOOP;
END $$;

-- 1. Guard
CREATE OR REPLACE FUNCTION public.fn_guard_writing_assignment_student_archived()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_archived_at timestamptz;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.student_id IS NOT DISTINCT FROM OLD.student_id THEN
        RETURN NEW;                 -- status, deadline, claim, ... writes: unchanged
    END IF;
    -- SECURITY DEFINER: a row lock needs UPDATE privilege on students, which 320
    -- revoked from client roles; the lock must hold whoever inserts.
    SELECT archived_at INTO v_archived_at
      FROM public.students WHERE id = NEW.student_id
       FOR KEY SHARE;
    IF FOUND AND v_archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'student_archived'
            USING DETAIL = NEW.student_id::text,
                  HINT = 'GIVEARCHIVE-0031: restore the learner before giving new Writing work.';
    END IF;
    RETURN NEW;                     -- unknown learner: the FK raises 23503 as before
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guard_writing_assignment_student_archived()
    FROM PUBLIC, anon, authenticated;

-- BEFORE ROW triggers fire in name order: this name sorts before
-- core_capture_writing_origin (249) and A-10's trg_guard_writing_give_cohort_active,
-- so the refusal fires before any side-effect insert.
CREATE OR REPLACE TRIGGER archive_guard_writing_assignment_student
    BEFORE INSERT OR UPDATE OF student_id ON public.writing_assignments
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_writing_assignment_student_archived();

COMMENT ON TRIGGER archive_guard_writing_assignment_student ON public.writing_assignments IS
    'GIVEARCHIVE-0031: no new give for an archived learner. Archive/restore only via fn_archive_student / fn_restore_student.';

-- 2. Postconditions
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.writing_assignments'::regclass
                      AND tgname = 'archive_guard_writing_assignment_student'
                      AND tgfoid = 'public.fn_guard_writing_assignment_student_archived()'::regprocedure
                      AND tgenabled = 'O' AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'archive_guard_trigger_missing';
    END IF;
    IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
              FROM pg_proc
             WHERE oid = 'public.fn_guard_writing_assignment_student_archived()'::regprocedure) THEN
        RAISE EXCEPTION 'archive_guard_not_pinned_security_definer';
    END IF;
    IF has_function_privilege('anon', 'public.fn_guard_writing_assignment_student_archived()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_guard_writing_assignment_student_archived()', 'EXECUTE') THEN
        RAISE EXCEPTION 'archive_guard_client_executable';
    END IF;
    IF has_table_privilege('authenticated', 'public.students', 'UPDATE') THEN
        RAISE EXCEPTION 'students_client_update_privilege';   -- 320 invariant
    END IF;
END $$;

COMMIT;
