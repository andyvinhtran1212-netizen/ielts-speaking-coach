-- Migration 298: canonical row-backed exam eligibility for the admin Review default.
-- Every exam mode requires persisted review work. Published sequential exams
-- additionally require a closed, completed section clock in the service.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_mock_sittings_admin_review_eligibility
    ON public.mock_exam_sittings (mock_exam_id, id)
    WHERE status IN ('all_submitted', 'under_review', 'reviewed');

CREATE OR REPLACE FUNCTION public.fn_admin_mock_actionable_review_exam_ids(
    p_exam_ids uuid[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'exam_ids', COALESCE(
            (SELECT pg_catalog.jsonb_agg(eligible.id ORDER BY eligible.id)
               FROM (
                    SELECT DISTINCT exam.id
                      FROM public.mock_exams AS exam
                      JOIN public.mock_exam_sittings AS sitting
                        ON sitting.mock_exam_id = exam.id
                      JOIN public.mock_exam_reviews AS review
                        ON review.sitting_id = sitting.id
                     WHERE exam.id = ANY(p_exam_ids)
                       AND sitting.status IN ('all_submitted', 'under_review', 'reviewed')
                       AND review.status IN ('queued', 'claimed', 'edited', 'reviewed')
               ) AS eligible),
            '[]'::jsonb
        )
    );
$$;

REVOKE ALL ON FUNCTION public.fn_admin_mock_actionable_review_exam_ids(uuid[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_mock_actionable_review_exam_ids(uuid[])
    TO service_role;

COMMENT ON FUNCTION public.fn_admin_mock_actionable_review_exam_ids(uuid[]) IS
'Backend-only actionable Review scope for every exam mode with persisted review work; released and void sittings do not qualify.';

COMMIT;
