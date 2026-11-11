BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.dictation_attempts ADD COLUMN IF NOT EXISTS class_assignment_item_id uuid;
ALTER TABLE public.dictation_attempts DROP CONSTRAINT IF EXISTS dictation_attempts_class_assignment_item_id_fkey;
ALTER TABLE public.dictation_attempts ADD CONSTRAINT dictation_attempts_class_assignment_item_id_fkey
    FOREIGN KEY (class_assignment_item_id) REFERENCES public.class_assignment_items(id) ON DELETE RESTRICT;
ALTER TABLE public.dictation_sessions ADD COLUMN IF NOT EXISTS class_assignment_item_id uuid;
ALTER TABLE public.dictation_sessions DROP CONSTRAINT IF EXISTS dictation_sessions_class_assignment_item_id_fkey;
ALTER TABLE public.dictation_sessions ADD CONSTRAINT dictation_sessions_class_assignment_item_id_fkey
    FOREIGN KEY (class_assignment_item_id) REFERENCES public.class_assignment_items(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS public.uq_dictation_attempts_one_active_section;
CREATE UNIQUE INDEX uq_dictation_attempts_one_active_section
    ON public.dictation_attempts (user_id, test_id, section_num)
    WHERE status = 'in_progress' AND class_assignment_item_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dictation_attempts_one_active_homework_section
    ON public.dictation_attempts (class_assignment_item_id, user_id, test_id, section_num)
    WHERE status = 'in_progress' AND class_assignment_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_dictation_sessions_class_item
    ON public.dictation_sessions (class_assignment_item_id, section_num, completed_at)
    WHERE class_assignment_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.listening_drill_playback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    class_assignment_item_id uuid NOT NULL,
    stage text NOT NULL CHECK (stage IN ('listening', 'dictation')),
    attempt_id uuid NOT NULL,
    page_id uuid NOT NULL,
    plays integer NOT NULL CHECK (plays BETWEEN 0 AND 10000),
    played_ms integer NOT NULL CHECK (played_ms BETWEEN 0 AND 86400000),
    UNIQUE (class_assignment_item_id, stage, attempt_id, page_id)
);
ALTER TABLE public.listening_drill_playback DROP CONSTRAINT IF EXISTS listening_drill_playback_class_assignment_item_id_fkey;
ALTER TABLE public.listening_drill_playback ADD CONSTRAINT listening_drill_playback_class_assignment_item_id_fkey
    FOREIGN KEY (class_assignment_item_id) REFERENCES public.class_assignment_items(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_listening_drill_playback_page
    ON public.listening_drill_playback (page_id);
ALTER TABLE public.listening_drill_playback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listening_drill_playback FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.listening_drill_playback TO service_role;

DROP FUNCTION IF EXISTS public.fn_record_listening_drill_playback(uuid,text,uuid,uuid,integer,integer);
CREATE OR REPLACE FUNCTION public.fn_record_listening_drill_playback_v2(
    p_item_id uuid, p_stage text, p_attempt_id uuid, p_page_id uuid,
    p_plays integer, p_played_ms integer
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    began_at timestamptz;
    elapsed_ms bigint;
    total_plays bigint;
    total_ms bigint;
    attempt_plays bigint;
    attempt_ms bigint;
    page_plays integer;
    page_ms integer;
    page_count bigint;
BEGIN
    IF p_stage = 'listening' THEN
        SELECT started_at INTO began_at FROM public.listening_test_attempts
         WHERE id = p_attempt_id AND class_assignment_item_id = p_item_id
           AND status = 'in_progress' FOR SHARE;
    ELSIF p_stage = 'dictation' THEN
        SELECT started_at INTO began_at FROM public.dictation_attempts
         WHERE id = p_attempt_id AND class_assignment_item_id = p_item_id
           AND status = 'in_progress' FOR SHARE;
    END IF;
    IF began_at IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'skill_drill_attempt_inactive';
    END IF;

    -- The client generates a UUID per page. Its first accepted checkpoint
    -- binds that UUID to the verified attempt and therefore to its paper.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_page_id::text, 381));
    IF EXISTS (
        SELECT 1 FROM public.listening_drill_playback
         WHERE page_id = p_page_id
           AND (class_assignment_item_id, stage, attempt_id)
               IS DISTINCT FROM (p_item_id, p_stage, p_attempt_id)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'skill_drill_checkpoint_scope';
    END IF;

    -- Serialize all pages and retries for the same homework and stage.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_item_id::text || ':' || p_stage, 380));
    elapsed_ms := GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - began_at)) * 1000));
    SELECT COALESCE(sum(plays), 0), COALESCE(sum(played_ms), 0),
           COALESCE(sum(plays) FILTER (WHERE attempt_id = p_attempt_id), 0),
           COALESCE(sum(played_ms) FILTER (WHERE attempt_id = p_attempt_id), 0),
           max(plays) FILTER (WHERE attempt_id = p_attempt_id AND page_id = p_page_id),
           max(played_ms) FILTER (WHERE attempt_id = p_attempt_id AND page_id = p_page_id),
           count(*)
      INTO total_plays, total_ms, attempt_plays, attempt_ms, page_plays, page_ms, page_count
      FROM public.listening_drill_playback
     WHERE class_assignment_item_id = p_item_id AND stage = p_stage;

    IF page_plays IS NULL AND page_count >= 64 THEN RETURN; END IF;
    page_plays := COALESCE(page_plays, 0);
    page_ms := COALESCE(page_ms, 0);
    INSERT INTO public.listening_drill_playback AS saved
        (class_assignment_item_id, stage, attempt_id, page_id, plays, played_ms)
    VALUES (
        p_item_id, p_stage, p_attempt_id, p_page_id,
        page_plays + GREATEST(0, LEAST(p_plays - page_plays, 120 - total_plays,
                                      1 + elapsed_ms / 1000 - attempt_plays)),
        page_ms + GREATEST(0, LEAST(p_played_ms - page_ms, 3600000 - total_ms,
                                  elapsed_ms - attempt_ms))
    )
    ON CONFLICT (class_assignment_item_id, stage, attempt_id, page_id) DO UPDATE
    SET plays = EXCLUDED.plays, played_ms = EXCLUDED.played_ms
    WHERE (saved.plays, saved.played_ms) IS DISTINCT FROM (EXCLUDED.plays, EXCLUDED.played_ms);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_record_listening_drill_playback_v2(uuid,text,uuid,uuid,integer,integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_listening_drill_playback_v2(uuid,text,uuid,uuid,integer,integer)
    TO service_role;

CREATE OR REPLACE FUNCTION public.fn_listening_drill_homework_ready() RETURNS boolean
    LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS 'SELECT true';
REVOKE ALL ON FUNCTION public.fn_listening_drill_homework_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_listening_drill_homework_ready() TO service_role;

DO $$
DECLARE
    playback oid := 'public.listening_drill_playback'::regclass;
    item oid := 'public.class_assignment_items'::regclass;
    child oid;
    routine oid;
    role_name text;
    privilege text;
BEGIN
    FOREACH child IN ARRAY ARRAY[
        'public.dictation_attempts'::regclass::oid,
        'public.dictation_sessions'::regclass::oid, playback
    ] LOOP
        IF (SELECT array_agg(c.confdeltype) FROM pg_catalog.pg_constraint c
            JOIN pg_catalog.pg_attribute a ON a.attrelid = child AND a.attname = 'class_assignment_item_id'
            JOIN pg_catalog.pg_attribute pk ON pk.attrelid = item AND pk.attname = 'id'
            WHERE c.conrelid = child AND c.confrelid = item AND c.contype = 'f'
              AND c.conkey = ARRAY[a.attnum] AND c.confkey = ARRAY[pk.attnum])
            IS DISTINCT FROM ARRAY['r'::"char"] THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '380 requires one RESTRICT homework FK on each evidence table';
        END IF;
    END LOOP;

    IF to_regprocedure('public.fn_record_listening_drill_playback(uuid,text,uuid,uuid,integer,integer)') IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '380 legacy playback RPC still exists';
    END IF;

    FOREACH routine IN ARRAY ARRAY[
        to_regprocedure('public.fn_record_listening_drill_playback_v2(uuid,text,uuid,uuid,integer,integer)')::oid,
        to_regprocedure('public.fn_listening_drill_homework_ready()')::oid
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc
             WHERE oid = routine AND NOT prosecdef AND proconfig = ARRAY['search_path=""']
        ) OR has_function_privilege('anon', routine, 'EXECUTE')
          OR has_function_privilege('authenticated', routine, 'EXECUTE')
          OR NOT has_function_privilege('service_role', routine, 'EXECUTE') THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '380 playback RPC security postcondition failed';
        END IF;
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = playback AND relrowsecurity)
       OR (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type)
             FROM pg_catalog.pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
            WHERE c.oid = playback AND a.grantee <> c.relowner)
          IS DISTINCT FROM ARRAY['INSERT','SELECT','UPDATE']::text[]
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
                   WHERE c.oid = playback AND a.grantee <> c.relowner
                     AND (a.grantee <> 'service_role'::regrole OR a.is_grantable)) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '380 playback table RLS or grants postcondition failed';
    END IF;
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege('service_role', playback, privilege)
           IS DISTINCT FROM (privilege IN ('SELECT','INSERT','UPDATE')) THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '380 service role playback table access is incorrect';
        END IF;
    END LOOP;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
        FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
            IF has_table_privilege(role_name, playback, privilege) THEN
                RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '380 browser role has playback table access';
            END IF;
        END LOOP;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
