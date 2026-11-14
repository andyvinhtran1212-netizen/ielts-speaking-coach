-- Roll back only before Skill Drills homework has been given or recorded.
BEGIN;
SET LOCAL lock_timeout = '5s';

LOCK TABLE public.class_assignments, public.dictation_attempts, public.dictation_sessions,
           public.listening_drill_playback IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.class_assignments WHERE content_config ? 'skill_drill')
       OR EXISTS (SELECT 1 FROM public.dictation_attempts WHERE class_assignment_item_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.dictation_sessions WHERE class_assignment_item_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.listening_drill_playback) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Skill Drill homework evidence exists; keep schema and roll forward';
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.fn_listening_drill_homework_ready();
DROP FUNCTION IF EXISTS public.fn_record_listening_drill_playback_v2(uuid,text,uuid,uuid,integer,integer);
DROP FUNCTION IF EXISTS public.fn_record_listening_drill_playback(uuid,text,uuid,uuid,integer,integer);
DROP TABLE public.listening_drill_playback;
DROP INDEX public.uq_dictation_attempts_one_active_section;
DROP INDEX public.uq_dictation_attempts_one_active_homework_section;
DROP INDEX public.ix_dictation_sessions_class_item;
ALTER TABLE public.dictation_attempts DROP COLUMN class_assignment_item_id;
ALTER TABLE public.dictation_sessions DROP COLUMN class_assignment_item_id;
CREATE UNIQUE INDEX uq_dictation_attempts_one_active_section
    ON public.dictation_attempts (user_id, test_id, section_num) WHERE status = 'in_progress';

DO $$
BEGIN
    IF to_regclass('public.listening_drill_playback') IS NOT NULL
       OR to_regclass('public.uq_dictation_attempts_one_active_homework_section') IS NOT NULL
       OR to_regclass('public.ix_dictation_sessions_class_item') IS NOT NULL
       OR to_regprocedure('public.fn_listening_drill_homework_ready()') IS NOT NULL
       OR to_regprocedure('public.fn_record_listening_drill_playback(uuid,text,uuid,uuid,integer,integer)') IS NOT NULL
       OR to_regprocedure('public.fn_record_listening_drill_playback_v2(uuid,text,uuid,uuid,integer,integer)') IS NOT NULL
       OR EXISTS (
           SELECT 1 FROM pg_catalog.pg_attribute
            WHERE attrelid IN ('public.dictation_attempts'::regclass, 'public.dictation_sessions'::regclass)
              AND attname = 'class_assignment_item_id' AND NOT attisdropped
       ) OR NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_index
            WHERE indexrelid = to_regclass('public.uq_dictation_attempts_one_active_section')
              AND indrelid = 'public.dictation_attempts'::regclass AND indisunique AND indisvalid
              AND pg_get_expr(indpred, indrelid) = '(status = ''in_progress''::text)'
       ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '380 rollback postcondition failed';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
