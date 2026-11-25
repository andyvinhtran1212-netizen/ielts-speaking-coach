-- G09-T24 / ADMINIA-0074 FR-102, FR-108, FR-113 (plan 5.3 row 441, 5.4).
-- One teacher per class (00 mục 2 điểm 23, Q18 closed): ONE column
-- cohorts.instructor_id, no teacher-class join table. services/staff_scope.py
-- is the only backend code that reads it to decide access. Also the class
-- schedule (weekly_schedule, start_date, class_lessons.starts_at) and the
-- class_action_log action 'cohort_teacher_change'.
--
-- Apply through the advisory-locked runner, staging first. Every apply needs
-- anh Andy's own typed approval for that window; this PR does not authorize
-- any hosted apply. Rollback: rollback/441_cohort_teacher_schedule.sql.
--
-- Drift note (class_action_log CHECK): 441 accepts exactly two known action
-- lists, the 198 original ('due_change','return_work') and that list plus
-- 378's ('exercise_book_assign','exercise_book_close'), and adds
-- 'cohort_teacher_change' to whichever it finds; any other CHECK is refused.
-- Hosted databases have the 198 list (378 is pending_feature and never applied
-- under the 18/11 team rule); the full-chain test harness applies 378 first.
-- 378 refuses any CHECK but its own predecessor, so 378 needs a forward update
-- before it could ever follow 441.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

ALTER TABLE public.cohorts
    ADD COLUMN IF NOT EXISTS instructor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS weekly_schedule jsonb,
    ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.cohorts DROP CONSTRAINT IF EXISTS cohorts_weekly_schedule_shape;
ALTER TABLE public.cohorts ADD CONSTRAINT cohorts_weekly_schedule_shape
    CHECK (weekly_schedule IS NULL OR jsonb_typeof(weekly_schedule) = 'array');
CREATE INDEX IF NOT EXISTS idx_cohorts_instructor_id
    ON public.cohorts (instructor_id) WHERE instructor_id IS NOT NULL;

ALTER TABLE public.class_lessons ADD COLUMN IF NOT EXISTS starts_at time;

-- class_action_log: add 'cohort_teacher_change' to the known action list.
DO $action_check$
DECLARE
    constraint_name name;
    definition text;
    found_count integer;
BEGIN
    SELECT count(*) INTO found_count FROM pg_constraint c
     WHERE c.conrelid = 'public.class_action_log'::regclass AND c.contype = 'c'
       AND (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'action') = ANY (c.conkey);
    SELECT c.conname, pg_get_constraintdef(c.oid) INTO constraint_name, definition FROM pg_constraint c
     WHERE c.conrelid = 'public.class_action_log'::regclass AND c.contype = 'c'
       AND (SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = 'action') = ANY (c.conkey);
    IF found_count = 1 AND definition IN (
       'CHECK ((action = ANY (ARRAY[''due_change''::text, ''return_work''::text, ''cohort_teacher_change''::text])))',
       'CHECK ((action = ANY (ARRAY[''due_change''::text, ''return_work''::text, ''exercise_book_assign''::text, ''exercise_book_close''::text, ''cohort_teacher_change''::text])))') THEN
        RETURN;  -- re-run of 441
    END IF;
    IF found_count = 1 AND definition =
       'CHECK ((action = ANY (ARRAY[''due_change''::text, ''return_work''::text])))' THEN
        EXECUTE format('ALTER TABLE public.class_action_log DROP CONSTRAINT %I', constraint_name);
        ALTER TABLE public.class_action_log ADD CONSTRAINT class_action_log_action_check
            CHECK (action IN ('due_change', 'return_work', 'cohort_teacher_change')) NOT VALID;
    ELSIF found_count = 1 AND definition =
       'CHECK ((action = ANY (ARRAY[''due_change''::text, ''return_work''::text, ''exercise_book_assign''::text, ''exercise_book_close''::text])))' THEN
        EXECUTE format('ALTER TABLE public.class_action_log DROP CONSTRAINT %I', constraint_name);
        ALTER TABLE public.class_action_log ADD CONSTRAINT class_action_log_action_check
            CHECK (action IN ('due_change', 'return_work', 'exercise_book_assign', 'exercise_book_close',
                              'cohort_teacher_change')) NOT VALID;
    ELSE
        RAISE EXCEPTION 'cohort_teacher_action_check_drift' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.class_action_log VALIDATE CONSTRAINT class_action_log_action_check;
END;
$action_check$;

-- Set a class teacher and log the change in one transaction (plan 5.4: every
-- change writes class_action_log). The caller has already checked that the new
-- teacher is an active instructor or admin; NULL removes the teacher. A repeat
-- of the current value writes nothing. Returns NULL for an unknown class.
CREATE OR REPLACE FUNCTION public.fn_set_cohort_teacher(
    p_cohort_id uuid, p_instructor_id uuid, p_actor_id uuid, p_actor_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    found_cohort boolean;
    previous uuid;
BEGIN
    SELECT true, c.instructor_id INTO found_cohort, previous
      FROM public.cohorts c WHERE c.id = p_cohort_id FOR UPDATE;
    IF found_cohort IS NULL THEN
        RETURN NULL;
    END IF;
    IF previous IS NOT DISTINCT FROM p_instructor_id THEN
        RETURN pg_catalog.jsonb_build_object('status', 'unchanged', 'instructor_id', previous);
    END IF;
    UPDATE public.cohorts SET instructor_id = p_instructor_id, updated_at = pg_catalog.now()
     WHERE id = p_cohort_id;
    INSERT INTO public.class_action_log (action, cohort_id, actor_user_id, actor_email, details)
    VALUES ('cohort_teacher_change', p_cohort_id, p_actor_id, p_actor_email,
            pg_catalog.jsonb_build_object('old_instructor_id', previous, 'new_instructor_id', p_instructor_id));
    RETURN pg_catalog.jsonb_build_object('status', 'changed', 'instructor_id', p_instructor_id,
                                         'previous_instructor_id', previous);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_set_cohort_teacher(uuid, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_set_cohort_teacher(uuid, uuid, uuid, text) TO service_role;

-- Fill existing classes (plan 5.3): for each live class still without a
-- teacher, the shared students.instructor_id of its active members when they
-- all agree; otherwise leave NULL (only admins see the class) and name the
-- class in a NOTICE. Nobody is assigned by default (Q35).
DO $backfill$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT c.id, c.name,
               count(DISTINCT s.instructor_id) AS teachers,
               min(s.instructor_id::text)::uuid AS teacher
          FROM public.cohorts c
          LEFT JOIN public.student_cohort_memberships m ON m.cohort_id = c.id AND m.is_active
          LEFT JOIN public.students s ON s.id = m.student_id
         WHERE c.is_active AND c.instructor_id IS NULL
         GROUP BY c.id, c.name
    LOOP
        IF r.teachers = 1 THEN
            UPDATE public.cohorts SET instructor_id = r.teacher WHERE id = r.id;
        ELSE
            RAISE NOTICE 'cohort_teacher_unset: % (% teachers among active members)', r.name, r.teachers;
        END IF;
    END LOOP;
END;
$backfill$;

COMMIT;
