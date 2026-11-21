-- Roll back 441 only while no class_action_log row uses 'cohort_teacher_change'
-- (the log is append-only evidence) and no class has a schedule set. Teachers
-- set on classes are dropped with the column; the Writing path keeps using
-- students.instructor_id, which 441 never changed. Needs the same typed
-- approval as the forward apply.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

LOCK TABLE public.cohorts, public.class_lessons, public.class_action_log IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.class_action_log WHERE action = 'cohort_teacher_change')
       OR EXISTS (SELECT 1 FROM public.cohorts WHERE weekly_schedule IS NOT NULL OR start_date IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.class_lessons WHERE starts_at IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE =
            'class teacher or schedule evidence exists; keep schema 441 and roll forward';
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.fn_set_cohort_teacher(uuid, uuid, uuid, text);
-- Back to the list 441 found: the 198 original, or 198 plus 378's two actions.
DO $restore$
DECLARE
    had_378 boolean := EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.class_action_log'::regclass
           AND conname = 'class_action_log_action_check'
           AND pg_get_constraintdef(oid) LIKE '%exercise_book_assign%');
BEGIN
    ALTER TABLE public.class_action_log DROP CONSTRAINT class_action_log_action_check;
    IF had_378 THEN
        ALTER TABLE public.class_action_log ADD CONSTRAINT class_action_log_action_check
            CHECK (action IN ('due_change', 'return_work', 'exercise_book_assign', 'exercise_book_close'));
    ELSE
        ALTER TABLE public.class_action_log ADD CONSTRAINT class_action_log_action_check
            CHECK (action IN ('due_change', 'return_work'));
    END IF;
END;
$restore$;

ALTER TABLE public.class_lessons DROP COLUMN IF EXISTS starts_at;
DROP INDEX IF EXISTS public.idx_cohorts_instructor_id;
ALTER TABLE public.cohorts DROP CONSTRAINT IF EXISTS cohorts_weekly_schedule_shape;
ALTER TABLE public.cohorts
    DROP COLUMN IF EXISTS instructor_id,
    DROP COLUMN IF EXISTS weekly_schedule,
    DROP COLUMN IF EXISTS start_date;

COMMIT;
