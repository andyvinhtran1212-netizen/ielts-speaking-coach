-- Rollback of 448_mock_exam_release_parts.sql (MOCKORG-0086 G09-T33).
-- Refuses while any sitting has a partial release or any score edit exists.
-- Otherwise drops what 448 added; full releases (mock_exam_reviews) are untouched.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $guard$
BEGIN
    IF to_regclass('public.mock_exam_score_edits') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.mock_exam_score_edits) THEN
        RAISE EXCEPTION 'rollback 448 refused: mock_exam_score_edits has rows' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'mock_exam_sittings'
                  AND column_name = 'released_skills')
       AND EXISTS (SELECT 1 FROM public.mock_exam_sittings WHERE released_skills <> '{}'::text[]) THEN
        RAISE EXCEPTION 'rollback 448 refused: sittings have partial releases' USING ERRCODE = '55000';
    END IF;
END;
$guard$;

DROP FUNCTION IF EXISTS public.fn_mock_exam_score_edit(uuid, uuid, text, text, uuid, jsonb, jsonb);
DROP INDEX IF EXISTS public.uq_mock_exam_events_release_key;
DROP TABLE IF EXISTS public.mock_exam_score_edits;
ALTER TABLE public.mock_exam_sittings DROP CONSTRAINT IF EXISTS mock_exam_sittings_released_skills_valid;
ALTER TABLE public.mock_exam_sittings DROP COLUMN IF EXISTS released_skills;

DO $post$
BEGIN
    IF to_regclass('public.mock_exam_score_edits') IS NOT NULL
       OR to_regclass('public.uq_mock_exam_events_release_key') IS NOT NULL THEN
        RAISE EXCEPTION 'rollback 448 incomplete';
    END IF;
END;
$post$;

COMMIT;

NOTIFY pgrst, 'reload schema';
