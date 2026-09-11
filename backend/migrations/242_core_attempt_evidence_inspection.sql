-- Read-only, single-attempt diagnostic; NOT an eligibility/coverage report.
-- Requires 240. No capture activation, backfill, learner writes or new grants
-- on source data. All history aggregates share one SQL statement snapshot.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_inspect_core_attempt_evidence(
    p_surface TEXT, p_attempt_kind TEXT, p_canonical_attempt_id UUID
) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object(
        'start_observed', a.start_observed,
        'first_registered_at', a.created_at,
        'receipts', count(e.id),
        'first_receipt_at', min(e.created_at),
        'last_receipt_at', max(e.created_at),
        'started', count(*) FILTER (WHERE e.event_kind = 'started'),
        'operation_succeeded', count(*) FILTER (WHERE e.event_kind = 'operation_succeeded'),
        'operation_failed', count(*) FILTER (WHERE e.event_kind = 'operation_failed'),
        'outcome_observed', count(*) FILTER (WHERE e.event_kind = 'outcome_observed'),
        'pending', count(*) FILTER (WHERE e.outcome = 'pending'),
        'success', count(*) FILTER (WHERE e.outcome = 'success'),
        'failed', count(*) FILTER (WHERE e.outcome = 'failed'),
        'abandoned', count(*) FILTER (WHERE e.outcome = 'abandoned'),
        'unknown', count(*) FILTER (WHERE e.outcome = 'unknown'),
        'renderer_next', count(*) FILTER (WHERE e.renderer = 'next'),
        'renderer_legacy', count(*) FILTER (WHERE e.renderer = 'legacy'),
        'renderer_unknown', count(e.id) FILTER (WHERE e.renderer IS NULL),
        'traffic_organic', count(*) FILTER (WHERE e.traffic_class = 'organic'),
        'traffic_synthetic', count(*) FILTER (WHERE e.traffic_class = 'synthetic'),
        'traffic_unknown', count(*) FILTER (WHERE e.traffic_class = 'unknown'),
        'release_unknown', count(e.id) FILTER (WHERE e.release_id IS NULL),
        'distinct_known_releases', count(DISTINCT e.release_id)
    )
    FROM public.core_attempt_evidence a
    LEFT JOIN public.core_attempt_evidence_events e ON e.attempt_id = a.id
    WHERE a.surface = p_surface AND a.attempt_kind = p_attempt_kind
      AND a.canonical_attempt_id = p_canonical_attempt_id
    GROUP BY a.id;
$$;

REVOKE ALL ON FUNCTION public.fn_inspect_core_attempt_evidence(TEXT, TEXT, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inspect_core_attempt_evidence(TEXT, TEXT, UUID)
    TO service_role;

COMMENT ON FUNCTION public.fn_inspect_core_attempt_evidence(TEXT, TEXT, UUID) IS
    'Bounded metadata response for one canonical identity. Counts are receipts,
     not attempts or logical operations. Timestamps are not commit-order export
     watermarks. NULL means no observed registry, not no canonical attempt.';

-- PostgREST computed metadata, embedded in the same essay snapshot. An empty
-- client-side jobs list cannot prove absence when nested rows may be capped.
CREATE OR REPLACE FUNCTION public.core_evidence_job_summary(essay public.writing_essays)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object(
        'total', count(*),
        'active_analyze', count(*) FILTER (WHERE j.job_type = 'analyze' AND j.status IN ('queued', 'running'))
    ) FROM public.writing_jobs j WHERE j.essay_id = essay.id;
$$;

REVOKE ALL ON FUNCTION public.core_evidence_job_summary(public.writing_essays)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.core_evidence_job_summary(public.writing_essays)
    TO service_role;

COMMIT;
