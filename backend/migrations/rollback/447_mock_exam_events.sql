-- Rollback of 447_mock_exam_events.sql (MOCKORG-0086 G09-T33).
-- Refuses after 448 is applied, or while any event, room message or extra time
-- exists (the timeline is the audit trail of real exams). Otherwise drops what
-- 447 added.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $guard$
BEGIN
    IF to_regclass('public.mock_exam_score_edits') IS NOT NULL THEN
        RAISE EXCEPTION 'rollback 447 refused: 448 is applied (roll it back first)' USING ERRCODE = '55000';
    END IF;
    IF to_regclass('public.mock_exam_events') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.mock_exam_events) THEN
        RAISE EXCEPTION 'rollback 447 refused: mock_exam_events has rows' USING ERRCODE = '55000';
    END IF;
    IF to_regclass('public.mock_exam_room_messages') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.mock_exam_room_messages) THEN
        RAISE EXCEPTION 'rollback 447 refused: mock_exam_room_messages has rows' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'mock_exam_sittings'
                  AND column_name = 'extra_seconds')
       AND EXISTS (SELECT 1 FROM public.mock_exam_sittings WHERE extra_seconds <> '{}'::jsonb) THEN
        RAISE EXCEPTION 'rollback 447 refused: sittings carry extra time' USING ERRCODE = '55000';
    END IF;
END;
$guard$;

DROP TABLE IF EXISTS public.mock_exam_room_messages;
DROP TABLE IF EXISTS public.mock_exam_events;
ALTER TABLE public.mock_exam_sittings DROP CONSTRAINT IF EXISTS mock_exam_sittings_extra_seconds_shape;
ALTER TABLE public.mock_exam_sittings DROP COLUMN IF EXISTS extra_seconds;

DO $post$
BEGIN
    IF to_regclass('public.mock_exam_events') IS NOT NULL
       OR EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'mock_exam_sittings'
                     AND column_name = 'extra_seconds') THEN
        RAISE EXCEPTION 'rollback 447 incomplete';
    END IF;
END;
$post$;

COMMIT;

NOTIFY pgrst, 'reload schema';
