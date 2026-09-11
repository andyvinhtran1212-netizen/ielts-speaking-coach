-- Private diagnostic aggregation only. Requires 240; no activation/backfill.
-- Renumbered before commit from local 245 to avoid the Cambridge branch's 245.
-- Receipt-window counts are NOT an all-eligible-attempt denominator.
BEGIN;

-- PL/pgSQL otherwise defers table/column resolution until the first call.
-- Validate the read dependency now, without scanning or modifying any rows.
DO $$
BEGIN
    PERFORM a.id, a.surface, a.attempt_kind, a.start_observed
        FROM public.core_attempt_evidence a LIMIT 0;
    PERFORM e.attempt_id, e.surface, e.attempt_kind, e.operation_id,
            e.operation, e.outcome, e.renderer, e.traffic_class, e.release_id, e.created_at
        FROM public.core_attempt_evidence_events e LIMIT 0;
EXCEPTION WHEN undefined_table OR undefined_column THEN
    RAISE EXCEPTION 'core_aggregate_requires_migration_240' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_core_attempt_observation_aggregate(
    p_window_start TIMESTAMPTZ, p_window_end TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
    result JSONB;
    unclassified_receipts BIGINT;
    selected_receipts BIGINT;
BEGIN
    -- Resolve omitted cutoff once using the same authoritative DB clock used
    -- for future-window validation. App/DB skew must not break default reads.
    p_window_end := coalesce(p_window_end, statement_timestamp());
    IF p_window_start IS NULL
       OR NOT isfinite(p_window_start) OR NOT isfinite(p_window_end)
       OR p_window_start >= p_window_end
       OR p_window_end - p_window_start > interval '31 days'
       OR p_window_end > statement_timestamp() THEN
        RAISE EXCEPTION 'invalid_observation_window' USING ERRCODE = 'ZC003';
    END IF;

    -- A 31-day interval alone does not bound count/distinct work. Reject an
    -- oversized cohort; never return a truncated success. STABLE queries share
    -- the caller's snapshot, including this precheck and the aggregate below.
    -- This is a query resource ceiling, NOT an evidence floor or soak rule.
    SELECT count(*) INTO selected_receipts FROM (
        SELECT 1 FROM public.core_attempt_evidence_events e
        WHERE e.created_at >= p_window_start AND e.created_at < p_window_end
        LIMIT 100001
    ) bounded;
    IF selected_receipts > 100000 THEN
        RAISE EXCEPTION 'observation_window_too_large' USING ERRCODE = 'ZC001';
    END IF;

    WITH streams(surface, attempt_kind) AS (VALUES
        ('speaking', 'speaking_session'), ('speaking', 'speaking_full_test'),
        ('reading_exam', 'default'), ('listening_test', 'default'),
        ('listening_dictation', 'default'), ('writing_assignment', 'default')
    ), window_events AS MATERIALIZED (
        SELECT e.attempt_id, e.surface, e.attempt_kind, e.operation_id,
               e.operation, e.outcome, e.renderer, e.traffic_class, e.release_id
        FROM public.core_attempt_evidence_events e
        WHERE e.created_at >= p_window_start AND e.created_at < p_window_end
    ), event_counts AS (
        SELECT surface, attempt_kind, count(*) AS receipts,
            count(DISTINCT (attempt_id, operation_id, operation)) FILTER (WHERE attempt_id IS NOT NULL) AS bound_attempt_operations,
            count(DISTINCT operation_id) FILTER (WHERE attempt_id IS NULL) AS unbound_start_failure_operations,
            count(DISTINCT (operation_id, operation)) AS server_observation_operations,
            count(*) FILTER (WHERE renderer = 'next') AS renderer_next_receipts,
            count(*) FILTER (WHERE renderer = 'legacy') AS renderer_legacy_receipts,
            count(*) FILTER (WHERE renderer IS NULL) AS renderer_unknown_receipts,
            count(*) FILTER (WHERE traffic_class = 'organic') AS organic_receipts,
            count(*) FILTER (WHERE traffic_class = 'synthetic') AS synthetic_receipts,
            count(*) FILTER (WHERE traffic_class = 'unknown') AS traffic_unknown_receipts,
            count(*) FILTER (WHERE release_id IS NOT NULL) AS release_known_receipts,
            count(*) FILTER (WHERE release_id IS NULL) AS release_unknown_receipts
        FROM window_events GROUP BY surface, attempt_kind
    ), per_attempt AS (
        SELECT e.surface, e.attempt_kind, e.attempt_id,
            bool_or(a.start_observed) AS start_known,
            count(DISTINCT e.outcome) AS outcome_kinds,
            bool_or(e.outcome = 'pending') AS saw_pending,
            bool_or(e.outcome = 'success') AS saw_success,
            bool_or(e.outcome = 'failed') AS saw_failed,
            bool_or(e.outcome = 'abandoned') AS saw_abandoned,
            bool_or(e.outcome = 'unknown') AS saw_unknown
        FROM window_events e JOIN public.core_attempt_evidence a
          ON a.id = e.attempt_id AND a.surface = e.surface AND a.attempt_kind = e.attempt_kind
        GROUP BY e.surface, e.attempt_kind, e.attempt_id
    ), attempt_counts AS (
        SELECT surface, attempt_kind, count(*) AS canonical_attempts,
            count(*) FILTER (WHERE start_known) AS start_known_at_registration,
            count(*) FILTER (WHERE NOT start_known) AS start_unknown_at_registration,
            count(*) FILTER (WHERE outcome_kinds = 0) AS without_outcome_attempts,
            count(*) FILTER (WHERE outcome_kinds > 1) AS mixed_outcome_attempts,
            count(*) FILTER (WHERE saw_pending) AS attempts_with_pending,
            count(*) FILTER (WHERE saw_success) AS attempts_with_success,
            count(*) FILTER (WHERE saw_failed) AS attempts_with_failed,
            count(*) FILTER (WHERE saw_abandoned) AS attempts_with_abandoned,
            count(*) FILTER (WHERE saw_unknown) AS attempts_with_unknown
        FROM per_attempt GROUP BY surface, attempt_kind
    ) SELECT jsonb_build_object(
        'contract', 'core-attempt-observations-v1',
        'window_start', p_window_start, 'window_end', p_window_end,
        'snapshot_scope', 'single_receipt_snapshot',
        'rows', jsonb_agg(jsonb_build_object(
            'surface', s.surface, 'attempt_kind', s.attempt_kind,
            'canonical_attempts', coalesce(a.canonical_attempts, 0),
            'start_known_at_registration', coalesce(a.start_known_at_registration, 0),
            'start_unknown_at_registration', coalesce(a.start_unknown_at_registration, 0),
            'without_outcome_attempts', coalesce(a.without_outcome_attempts, 0),
            'mixed_outcome_attempts', coalesce(a.mixed_outcome_attempts, 0),
            'attempts_with_pending', coalesce(a.attempts_with_pending, 0),
            'attempts_with_success', coalesce(a.attempts_with_success, 0),
            'attempts_with_failed', coalesce(a.attempts_with_failed, 0),
            'attempts_with_abandoned', coalesce(a.attempts_with_abandoned, 0),
            'attempts_with_unknown', coalesce(a.attempts_with_unknown, 0),
            'receipts', coalesce(e.receipts, 0),
            'bound_attempt_operations', coalesce(e.bound_attempt_operations, 0),
            'unbound_start_failure_operations', coalesce(e.unbound_start_failure_operations, 0),
            'server_observation_operations', coalesce(e.server_observation_operations, 0),
            'renderer_next_receipts', coalesce(e.renderer_next_receipts, 0),
            'renderer_legacy_receipts', coalesce(e.renderer_legacy_receipts, 0),
            'renderer_unknown_receipts', coalesce(e.renderer_unknown_receipts, 0),
            'organic_receipts', coalesce(e.organic_receipts, 0),
            'synthetic_receipts', coalesce(e.synthetic_receipts, 0),
            'traffic_unknown_receipts', coalesce(e.traffic_unknown_receipts, 0),
            'release_known_receipts', coalesce(e.release_known_receipts, 0),
            'release_unknown_receipts', coalesce(e.release_unknown_receipts, 0)
        ) ORDER BY s.surface, s.attempt_kind)
    ), (SELECT count(*) FROM window_events w WHERE NOT EXISTS (
        SELECT 1 FROM streams supported
        WHERE supported.surface = w.surface AND supported.attempt_kind = w.attempt_kind
    )) INTO result, unclassified_receipts
    FROM streams s LEFT JOIN event_counts e USING (surface, attempt_kind)
    LEFT JOIN attempt_counts a USING (surface, attempt_kind);
    IF unclassified_receipts > 0 THEN
        RAISE EXCEPTION 'unsupported_observation_stream' USING ERRCODE = 'ZC002';
    END IF;
    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_core_attempt_observation_aggregate(TIMESTAMPTZ, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_core_attempt_observation_aggregate(TIMESTAMPTZ, TIMESTAMPTZ)
    TO service_role;
COMMIT;
