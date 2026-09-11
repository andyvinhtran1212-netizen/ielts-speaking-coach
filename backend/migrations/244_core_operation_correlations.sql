-- Private retry-hint correlation, not admission control or attempt deduplication.
-- Requires 240/242. No source writes, event rewrites, backfill or activation.
-- Writer RPC: standalone READ COMMITTED, never in a learner-write transaction.
BEGIN;

CREATE TABLE IF NOT EXISTS public.core_operation_correlations (
    operation_id UUID PRIMARY KEY,
    surface TEXT NOT NULL CHECK (surface IN ('speaking','reading_exam','listening_test','listening_dictation','writing_assignment')),
    attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('default','speaking_session','speaking_full_test')),
    CHECK ((surface='speaking') = (attempt_kind <> 'default')),
    canonical_attempt_id UUID NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('start','save','submit','grade','finalize')),
    client_operation_id UUID NOT NULL,
    input_digest TEXT NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- One server observation operation can have multiple event rows, or lose all
-- receipts. There is no unique event FK target. Readers match full scope, not
-- arbitrary operation UUID alone. Unbound pre-insert failures are not joined.
CREATE INDEX IF NOT EXISTS idx_core_operation_correlation_attempt
    ON public.core_operation_correlations(surface, attempt_kind, canonical_attempt_id);
ALTER TABLE public.core_operation_correlations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.core_operation_correlations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.core_operation_correlations TO service_role;

CREATE OR REPLACE FUNCTION public.fn_record_core_operation_correlation(
    p_operation_id UUID, p_surface TEXT, p_attempt_kind TEXT, p_canonical_attempt_id UUID,
    p_operation TEXT, p_client_operation_id UUID, p_input_digest TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE existing public.core_operation_correlations%ROWTYPE;
BEGIN
    INSERT INTO public.core_operation_correlations(
        operation_id,surface,attempt_kind,canonical_attempt_id,operation,client_operation_id,input_digest
    ) VALUES (
        p_operation_id,p_surface,p_attempt_kind,p_canonical_attempt_id,p_operation,p_client_operation_id,p_input_digest
    ) ON CONFLICT (operation_id) DO NOTHING;
    SELECT * INTO STRICT existing FROM public.core_operation_correlations WHERE operation_id=p_operation_id;
    IF ROW(existing.surface,existing.attempt_kind,existing.canonical_attempt_id,existing.operation,
           existing.client_operation_id,existing.input_digest)
       IS DISTINCT FROM ROW(p_surface,p_attempt_kind,p_canonical_attempt_id,p_operation,p_client_operation_id,p_input_digest) THEN
        RAISE EXCEPTION 'core_operation_correlation_conflict' USING ERRCODE='23505';
    END IF;
    RETURN p_operation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_core_operation_correlation_summary(p_attempt_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
    WITH observed AS (
        SELECT DISTINCT e.operation_id, e.operation
        FROM public.core_attempt_evidence_events e WHERE e.attempt_id=p_attempt_id
    ), matched AS (
        SELECT o.*, c.client_operation_id, c.input_digest
        FROM observed o JOIN public.core_attempt_evidence a ON a.id=p_attempt_id
        LEFT JOIN public.core_operation_correlations c ON c.operation_id=o.operation_id
          AND c.operation=o.operation AND c.surface=a.surface AND c.attempt_kind=a.attempt_kind
          AND c.canonical_attempt_id=a.canonical_attempt_id
    ), reused AS (
        SELECT operation, client_operation_id FROM matched WHERE client_operation_id IS NOT NULL
        GROUP BY operation,client_operation_id HAVING count(DISTINCT input_digest)>1
    )
    SELECT jsonb_build_object(
        'observed_operations', count(*),
        'correlated_operations', count(client_operation_id),
        'uncorrelated_operations', count(*) FILTER (WHERE client_operation_id IS NULL),
        'client_input_groups', count(DISTINCT (operation,client_operation_id,input_digest)) FILTER (WHERE client_operation_id IS NOT NULL),
        'client_ids_with_multiple_fingerprints', (SELECT count(*) FROM reused)
    ) FROM matched;
$$;

-- The v1 history RPC remains available to old deployments. v2 adds diagnostic
-- groups in the SAME statement snapshot, not an application-side second read.
CREATE OR REPLACE FUNCTION public.fn_inspect_core_attempt_evidence_v2(
    p_surface TEXT, p_attempt_kind TEXT, p_canonical_attempt_id UUID
) RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
    SELECT public.fn_inspect_core_attempt_evidence(p_surface,p_attempt_kind,p_canonical_attempt_id)
        || jsonb_build_object('operation_correlation', public.fn_core_operation_correlation_summary(a.id))
    FROM public.core_attempt_evidence a
    WHERE a.surface=p_surface AND a.attempt_kind=p_attempt_kind AND a.canonical_attempt_id=p_canonical_attempt_id;
$$;

REVOKE ALL ON FUNCTION public.fn_record_core_operation_correlation(UUID,TEXT,TEXT,UUID,TEXT,UUID,TEXT),
    public.fn_core_operation_correlation_summary(UUID),
    public.fn_inspect_core_attempt_evidence_v2(TEXT,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_core_operation_correlation(UUID,TEXT,TEXT,UUID,TEXT,UUID,TEXT),
    public.fn_core_operation_correlation_summary(UUID),
    public.fn_inspect_core_attempt_evidence_v2(TEXT,TEXT,UUID) TO service_role;

COMMENT ON TABLE public.core_operation_correlations IS
    'Client hints plus server-computed owner/input fingerprints, not identity,
     organic-use or coverage certificates. Fingerprints are pseudonymous, not
     anonymous. Retention/erasure approval is required before capture activation.';
COMMIT;
