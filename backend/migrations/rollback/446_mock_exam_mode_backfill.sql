-- Rollback of 446_mock_exam_mode_backfill.sql (MOCKORG-0086 G09-T31 PR 2).
-- Puts the legacy names back and restores the migration-169 fn_set_exam_mode.
-- Kept on purpose:
--   * the dual-name rewrites of fn_mock_section_valid, fn_mock_paper_dependencies,
--     fn_guard_mock_paper_policy, fn_guard_owned_mock_attempt and
--     fn_admin_mock_exams_with_review_eligibility: they accept the legacy names,
--     so they are correct after this rollback too;
--   * mock_exam_audiences rows (445 owns the table; its rollback decides).
-- The backend must still be the two-name build (rollout.md: the lowest safe
-- backend after 446 is the one with the compatibility layer).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DROP TRIGGER IF EXISTS trg_mock_exams_new_mode_name ON public.mock_exams;
DROP FUNCTION IF EXISTS public.fn_mock_exams_new_mode_name();

ALTER TABLE public.mock_exams ALTER COLUMN exam_mode SET DEFAULT 'sequential';

UPDATE public.mock_exams
   SET exam_mode = CASE exam_mode WHEN 'live' THEN 'sequential' ELSE 'retake' END
 WHERE exam_mode IN ('live', 'self_paced');

-- fn_set_exam_mode exactly as migration 169.
CREATE OR REPLACE FUNCTION public.fn_set_exam_mode(
    p_exam_id uuid,
    p_mode    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_out jsonb;
BEGIN
    IF p_mode NOT IN ('sequential', 'retake') THEN
        RAISE EXCEPTION 'invalid exam_mode: %', p_mode;
    END IF;

    UPDATE mock_exams e
       SET exam_mode = p_mode
     WHERE e.id = p_exam_id
       AND COALESCE(e.exam_mode, 'sequential') IS DISTINCT FROM p_mode
       AND NOT EXISTS (
               SELECT 1 FROM mock_exam_sittings s
                WHERE s.mock_exam_id = e.id
                  AND s.status <> 'void'
           )
       AND NOT EXISTS (
               SELECT 1 FROM mock_exam_assignments a
                WHERE a.exam_id = e.id
           )
    RETURNING to_jsonb(e) INTO v_out;

    RETURN v_out;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_set_exam_mode(uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_set_exam_mode(uuid, text)
    TO service_role;

DO $post$
BEGIN
    IF EXISTS (SELECT 1 FROM public.mock_exams WHERE exam_mode IN ('live', 'self_paced')) THEN
        RAISE EXCEPTION 'rollback_446_new_names_left';
    END IF;
END;
$post$;

COMMIT;

NOTIFY pgrst, 'reload schema';
