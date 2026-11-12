BEGIN;

ALTER TABLE public.dictation_attempts ADD COLUMN class_assignment_item_id uuid
    REFERENCES public.class_assignment_items(id) ON DELETE CASCADE;
ALTER TABLE public.dictation_sessions ADD COLUMN class_assignment_item_id uuid
    REFERENCES public.class_assignment_items(id) ON DELETE CASCADE;

DROP INDEX public.uq_dictation_attempts_one_active_section;
CREATE UNIQUE INDEX uq_dictation_attempts_one_active_section
    ON public.dictation_attempts (user_id, test_id, section_num)
    WHERE status = 'in_progress' AND class_assignment_item_id IS NULL;
CREATE UNIQUE INDEX uq_dictation_attempts_one_active_homework_section
    ON public.dictation_attempts (class_assignment_item_id, user_id, test_id, section_num)
    WHERE status = 'in_progress' AND class_assignment_item_id IS NOT NULL;
CREATE INDEX ix_dictation_sessions_class_item
    ON public.dictation_sessions (class_assignment_item_id, section_num, completed_at)
    WHERE class_assignment_item_id IS NOT NULL;

CREATE TABLE public.listening_drill_playback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    class_assignment_item_id uuid NOT NULL REFERENCES public.class_assignment_items(id) ON DELETE CASCADE,
    stage text NOT NULL CHECK (stage IN ('listening', 'dictation')),
    attempt_id uuid NOT NULL,
    page_id uuid NOT NULL,
    plays integer NOT NULL CHECK (plays BETWEEN 0 AND 10000),
    played_ms integer NOT NULL CHECK (played_ms BETWEEN 0 AND 86400000),
    UNIQUE (class_assignment_item_id, stage, attempt_id, page_id)
);

ALTER TABLE public.listening_drill_playback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listening_drill_playback FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.listening_drill_playback TO service_role;

CREATE FUNCTION public.fn_record_listening_drill_playback(
    p_item_id uuid, p_stage text, p_attempt_id uuid, p_page_id uuid,
    p_plays integer, p_played_ms integer
) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
    INSERT INTO public.listening_drill_playback AS recorded
        (class_assignment_item_id, stage, attempt_id, page_id, plays, played_ms)
    VALUES (p_item_id, p_stage, p_attempt_id, p_page_id, p_plays, p_played_ms)
    ON CONFLICT (class_assignment_item_id, stage, attempt_id, page_id) DO UPDATE
    SET plays = GREATEST(recorded.plays, EXCLUDED.plays),
        played_ms = GREATEST(recorded.played_ms, EXCLUDED.played_ms);
$$;
REVOKE ALL ON FUNCTION public.fn_record_listening_drill_playback(uuid,text,uuid,uuid,integer,integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_listening_drill_playback(uuid,text,uuid,uuid,integer,integer)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
