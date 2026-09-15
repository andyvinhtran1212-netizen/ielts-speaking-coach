-- Migration 272 — freeze the class deadline once a timed Course item starts.
--
-- A timed learner cutoff is min(opened_at + time_limit, due_at).  Mutating the
-- assignment due_at after opened_at exists lets a browser that loaded the old
-- boundary and the server applying the new boundary disagree.  Keep a marker
-- on the assignment row so the start path and a concurrent due update serialize
-- on the same row; a cross-table existence check alone would retain an MVCC
-- snapshot race after waiting for that row lock.

ALTER TABLE public.class_assignments
    ADD COLUMN IF NOT EXISTS timed_started_at TIMESTAMPTZ;

UPDATE public.class_assignments AS ca
   SET timed_started_at = started.first_opened_at
  FROM (
      SELECT cai.assignment_id, MIN(cai.opened_at) AS first_opened_at
        FROM public.class_assignment_items AS cai
       WHERE cai.opened_at IS NOT NULL
       GROUP BY cai.assignment_id
  ) AS started
 WHERE ca.id = started.assignment_id
   AND ca.skill = 'course'
   AND ca.content_config ? 'time_limit_minutes'
   AND ca.timed_started_at IS NULL;

CREATE OR REPLACE FUNCTION public.mark_timed_course_assignment_started()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.opened_at IS NULL AND NEW.opened_at IS NOT NULL THEN
        UPDATE public.class_assignments
           SET timed_started_at = CASE
               WHEN timed_started_at IS NULL THEN NEW.opened_at
               ELSE LEAST(timed_started_at, NEW.opened_at)
           END
         WHERE id = NEW.assignment_id
           AND skill = 'course'
           AND content_config ? 'time_limit_minutes';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_timed_course_assignment_started
    ON public.class_assignment_items;
CREATE TRIGGER trg_mark_timed_course_assignment_started
AFTER UPDATE OF opened_at ON public.class_assignment_items
FOR EACH ROW
EXECUTE FUNCTION public.mark_timed_course_assignment_started();

CREATE OR REPLACE FUNCTION public.guard_started_timed_course_due_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.due_at IS DISTINCT FROM OLD.due_at
       AND OLD.skill = 'course'
       AND OLD.content_config ? 'time_limit_minutes'
       AND OLD.timed_started_at IS NOT NULL THEN
        RAISE EXCEPTION 'timed_course_due_locked_after_start'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_started_timed_course_due_change
    ON public.class_assignments;
CREATE TRIGGER trg_guard_started_timed_course_due_change
BEFORE UPDATE OF due_at ON public.class_assignments
FOR EACH ROW
EXECUTE FUNCTION public.guard_started_timed_course_due_change();

COMMENT ON COLUMN public.class_assignments.timed_started_at IS
'First opened_at observed for a timed Course item; freezes due_at against browser/server cutoff drift.';

NOTIFY pgrst, 'reload schema';
