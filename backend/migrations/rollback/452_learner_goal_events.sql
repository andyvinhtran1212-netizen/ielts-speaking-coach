-- Roll back 452 only while no goal was resolved: once the event table has a
-- row, it is the history of a change to two learner rows; keep the schema and
-- roll forward instead. Needs the same typed approval as the forward apply.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

LOCK TABLE public.learner_goal_events IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.learner_goal_events) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE =
            'learner goals were resolved; keep schema 452 and roll forward';
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.fn_learner_goal_resolve(uuid, uuid, text, uuid);
DROP TABLE public.learner_goal_events;
DROP FUNCTION IF EXISTS public.fn_learner_goal_events_append_only();

COMMIT;
