-- Private, optional evidence after canonical Reading/Listening submission.
-- No learner-table change, backfill, trigger or capture activation.
-- A proof verifies the persisted result against the submission-time question
-- numbers, NOT the authored answer key's correctness or organic eligibility.
BEGIN;

CREATE TABLE IF NOT EXISTS public.core_exam_result_proofs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    surface TEXT NOT NULL CONSTRAINT core_exam_proof_surface CHECK (surface IN ('reading_exam', 'listening_test')),
    -- Polymorphic canonical identity: deliberately not a misleading FK to one
    -- surface's table. Retention/erasure requires approval before activation.
    canonical_attempt_id UUID NOT NULL,
    result_digest TEXT NOT NULL CONSTRAINT core_exam_proof_digest CHECK (result_digest ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT core_exam_proof_identity UNIQUE (surface, canonical_attempt_id, result_digest)
);
ALTER TABLE public.core_exam_result_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.core_exam_result_proofs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.core_exam_result_proofs TO service_role;

-- One normalization implementation for the UPDATE-returning witness and later
-- canonical readback. Score representation (1 vs 1.0), JSON object key order,
-- grading-row order and timezone spelling do not change semantic identity.
CREATE OR REPLACE FUNCTION public.fn_core_exam_result_digest(
    p_id UUID, p_status TEXT, p_submitted_at TIMESTAMPTZ,
    p_score NUMERIC, p_band NUMERIC, p_details JSONB
) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
SET timezone = 'UTC'
AS $$
DECLARE normalized JSONB; question_count BIGINT; correct_count BIGINT;
BEGIN
    IF p_id IS NULL OR p_status IS DISTINCT FROM 'submitted' OR p_submitted_at IS NULL
       OR NOT isfinite(p_submitted_at) OR p_score IS NULL OR p_score < 0 OR p_score > 40
       OR (p_band IS NOT NULL AND NOT (p_band >= 0 AND p_band <= 9))
       OR jsonb_typeof(p_details) IS DISTINCT FROM 'array' THEN
        RETURN NULL;
    END IF;
    IF jsonb_array_length(p_details) = 0 THEN RETURN NULL; END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_details) d
        WHERE jsonb_typeof(d) IS DISTINCT FROM 'object'
          OR jsonb_typeof(d->'q_num') IS DISTINCT FROM 'number'
          OR jsonb_typeof(d->'correct') IS DISTINCT FROM 'boolean'
    ) THEN RETURN NULL; END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_details) d
        WHERE (d->>'q_num')::numeric < 1
           OR (d->>'q_num')::numeric <> trunc((d->>'q_num')::numeric)
    ) THEN RETURN NULL; END IF;
    SELECT count(*), count(*) FILTER (WHERE (d->>'correct')::boolean),
           jsonb_agg(jsonb_build_array((d->>'q_num')::integer, (d->>'correct')::boolean)
                     ORDER BY (d->>'q_num')::integer)
      INTO question_count, correct_count, normalized
      FROM jsonb_array_elements(p_details) d;
    IF question_count <> (SELECT count(DISTINCT (d->>'q_num')::integer) FROM jsonb_array_elements(p_details) d)
       OR p_score <> correct_count THEN RETURN NULL; END IF;
    RETURN encode(sha256(convert_to(jsonb_build_object(
        'contract', 'core-exam-result-v1', 'id', p_id,
        'submitted_epoch', trim_scale(extract(epoch FROM p_submitted_at)),
        'score', trim_scale(p_score), 'band', trim_scale(p_band),
        'questions', normalized
    )::text, 'UTF8')), 'hex');
EXCEPTION WHEN data_exception THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_record_core_exam_result_proof(
    p_surface TEXT, p_canonical_attempt_id UUID, p_metadata JSONB, p_expected_qnums INTEGER[]
) RETURNS TEXT
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE fingerprint TEXT; observed_numbers INTEGER[]; expected_numbers INTEGER[];
BEGIN
    IF p_surface NOT IN ('reading_exam', 'listening_test') OR p_surface IS NULL
       OR p_canonical_attempt_id IS NULL OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_metadata->'score') IS DISTINCT FROM 'number'
       OR (p_metadata->'band_estimate' IS NOT NULL AND p_metadata->'band_estimate' <> 'null'::jsonb
           AND jsonb_typeof(p_metadata->'band_estimate') <> 'number')
       OR COALESCE(p_metadata->>'submitted_at', '') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
       OR p_expected_qnums IS NULL OR cardinality(p_expected_qnums) = 0 THEN
        RAISE EXCEPTION 'invalid_core_exam_proof' USING ERRCODE = '22023';
    END IF;
    -- The client sends only this allowlist, never raw grading details/answers.
    IF p_metadata - ARRAY['status','submitted_at','score','band_estimate','grading_details'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'invalid_core_exam_proof' USING ERRCODE = '22023';
    END IF;
    fingerprint := public.fn_core_exam_result_digest(p_canonical_attempt_id,
        p_metadata->>'status', (p_metadata->>'submitted_at')::timestamptz,
        (p_metadata->>'score')::numeric, (p_metadata->>'band_estimate')::numeric,
        p_metadata->'grading_details');
    IF fingerprint IS NULL THEN
        RAISE EXCEPTION 'invalid_core_exam_proof' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_metadata->'grading_details') d
               WHERE d - ARRAY['q_num','correct'] <> '{}'::jsonb) THEN
        RAISE EXCEPTION 'invalid_core_exam_proof' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg((d->>'q_num')::integer ORDER BY (d->>'q_num')::integer)
      INTO observed_numbers FROM jsonb_array_elements(p_metadata->'grading_details') d;
    SELECT array_agg(q ORDER BY q) INTO expected_numbers FROM unnest(p_expected_qnums) q;
    IF observed_numbers IS DISTINCT FROM expected_numbers THEN
        RAISE EXCEPTION 'invalid_core_exam_proof' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.core_exam_result_proofs(surface, canonical_attempt_id, result_digest)
    VALUES (p_surface, p_canonical_attempt_id, fingerprint)
    ON CONFLICT (surface, canonical_attempt_id, result_digest) DO NOTHING;
    RETURN fingerprint;
END;
$$;

-- Computed fields see source result + its proof in the same SELECT snapshot;
-- they neither return answer text nor depend on the current editable test.
CREATE OR REPLACE FUNCTION public.core_evidence_result_check(attempt public.reading_test_attempts)
RETURNS TEXT LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
    WITH result AS (SELECT public.fn_core_exam_result_digest(attempt.id, attempt.status,
        attempt.submitted_at, attempt.score, attempt.band_estimate, attempt.grading_details) AS digest)
    SELECT CASE WHEN digest IS NULL THEN 'invalid'
        WHEN EXISTS (SELECT 1 FROM public.core_exam_result_proofs p WHERE p.surface='reading_exam'
          AND p.canonical_attempt_id=attempt.id AND p.result_digest=result.digest) THEN 'verified'
        ELSE 'unverified' END FROM result;
$$;
CREATE OR REPLACE FUNCTION public.core_evidence_result_check(attempt public.listening_test_attempts)
RETURNS TEXT LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
    WITH result AS (SELECT public.fn_core_exam_result_digest(attempt.id, attempt.status,
        attempt.submitted_at, attempt.score, attempt.band_estimate, attempt.grading_details) AS digest)
    SELECT CASE WHEN digest IS NULL THEN 'invalid'
        WHEN EXISTS (SELECT 1 FROM public.core_exam_result_proofs p WHERE p.surface='listening_test'
          AND p.canonical_attempt_id=attempt.id AND p.result_digest=result.digest) THEN 'verified'
        ELSE 'unverified' END FROM result;
$$;

REVOKE ALL ON FUNCTION public.fn_core_exam_result_digest(UUID,TEXT,TIMESTAMPTZ,NUMERIC,NUMERIC,JSONB),
    public.fn_record_core_exam_result_proof(TEXT,UUID,JSONB,INTEGER[]),
    public.core_evidence_result_check(public.reading_test_attempts),
    public.core_evidence_result_check(public.listening_test_attempts)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_core_exam_result_digest(UUID,TEXT,TIMESTAMPTZ,NUMERIC,NUMERIC,JSONB),
    public.fn_record_core_exam_result_proof(TEXT,UUID,JSONB,INTEGER[]),
    public.core_evidence_result_check(public.reading_test_attempts),
    public.core_evidence_result_check(public.listening_test_attempts)
    TO service_role;

COMMIT;
