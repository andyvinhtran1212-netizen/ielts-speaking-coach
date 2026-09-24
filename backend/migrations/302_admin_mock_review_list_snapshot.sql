-- Migration 302: return every admin Mock exam row and its actionable Review
-- decision from one PostgreSQL statement. Migration 298 remains immutable.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_admin_mock_exams_with_review_eligibility()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'exams', COALESCE(
            pg_catalog.jsonb_agg(
                pg_catalog.to_jsonb(exam) || pg_catalog.jsonb_build_object(
                    'review_eligible',
                    (
                        (exam.status <> 'published' OR exam.exam_mode = 'retake'
                         OR (exam.is_open IS FALSE AND exam.active_section = 'done'))
                        AND EXISTS (
                            SELECT 1
                              FROM public.mock_exam_sittings AS sitting
                              JOIN public.mock_exam_reviews AS review
                                ON review.sitting_id = sitting.id
                             WHERE sitting.mock_exam_id = exam.id
                               AND sitting.status IN ('all_submitted', 'under_review', 'reviewed')
                               AND review.status IN ('queued', 'claimed', 'edited', 'reviewed')
                        )
                    )
                )
                ORDER BY exam.created_at DESC, exam.id DESC
            ),
            '[]'::jsonb
        )
    )
      FROM public.mock_exams AS exam;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_mock_exams_with_review_eligibility()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_mock_exams_with_review_eligibility()
    TO service_role;

COMMENT ON FUNCTION public.fn_admin_mock_exams_with_review_eligibility() IS
'Backend-only admin Mock exam list. Full persisted rows, stable order and actionable Review decisions share one statement snapshot.';

COMMIT;
