-- Rollback of 445_mock_exam_audiences.sql (MOCKORG-0086 G09-T31).
-- Only before 446 and before any audience is stored: refuses while any exam
-- uses a new mode name, any audience row exists, or a new mock_exams column
-- carries data. Otherwise drops what 445 added and restores the two-name CHECK.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM public.mock_exams WHERE exam_mode IN ('live', 'self_paced')) THEN
        RAISE EXCEPTION 'rollback 445 refused: exams use live/self_paced (446 ran)' USING ERRCODE = '55000';
    END IF;
    IF to_regclass('public.mock_exam_audiences') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.mock_exam_audiences) THEN
        RAISE EXCEPTION 'rollback 445 refused: mock_exam_audiences has rows' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'mock_exams' AND column_name = 'skills')
       AND EXISTS (SELECT 1 FROM public.mock_exams
                    WHERE skills IS NOT NULL OR allow_early_advance OR starts_at IS NOT NULL
                       OR draft_state IS NOT NULL) THEN
        RAISE EXCEPTION 'rollback 445 refused: mock_exams new columns hold data' USING ERRCODE = '55000';
    END IF;
END;
$guard$;

DROP TABLE IF EXISTS public.mock_exam_audiences;

ALTER TABLE public.mock_exams DROP CONSTRAINT IF EXISTS mock_exams_exam_mode_chk;
ALTER TABLE public.mock_exams ADD CONSTRAINT mock_exams_exam_mode_chk
    CHECK (exam_mode IN ('sequential', 'retake'));
ALTER TABLE public.mock_exams DROP CONSTRAINT IF EXISTS mock_exams_skills_valid;
ALTER TABLE public.mock_exams DROP CONSTRAINT IF EXISTS mock_exams_draft_state_shape;
ALTER TABLE public.mock_exams
    DROP COLUMN IF EXISTS draft_state,
    DROP COLUMN IF EXISTS starts_at,
    DROP COLUMN IF EXISTS allow_early_advance,
    DROP COLUMN IF EXISTS skills;

COMMIT;

NOTIFY pgrst, 'reload schema';
