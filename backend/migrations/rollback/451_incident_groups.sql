-- Roll back 451 only while nobody has acted on an incident group: once a
-- group row or a note exists, the decisions and their history are evidence;
-- keep the schema and roll forward instead. Needs the same typed approval as
-- the forward apply.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

LOCK TABLE public.incident_groups, public.incident_group_notes IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.incident_group_notes)
       OR EXISTS (SELECT 1 FROM public.incident_groups) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE =
            'incident groups were acted on; keep schema 451 and roll forward';
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.fn_incident_group_transition(text, text, text, uuid, timestamptz, text, boolean);
DROP TABLE public.incident_group_notes;
DROP TABLE public.incident_groups;
DROP FUNCTION IF EXISTS public.fn_incident_group_notes_append_only();

COMMIT;
