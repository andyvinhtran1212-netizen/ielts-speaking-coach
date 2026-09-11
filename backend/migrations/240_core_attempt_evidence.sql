-- Additive foundation only: no backfill, triggers, or capture activation.
-- Runtime writers must be deployed with CORE_ATTEMPT_EVIDENCE_ENABLED=false
-- until this migration and their coverage have been verified separately.
-- Supabase/PostgreSQL >=13, existing anon/authenticated/service_role required.
-- Invoke ONLY as a standalone READ COMMITTED RPC, never in a learner-write
-- transaction. Owner/superuser maintenance is outside service-role immutability.
-- Retention/erasure of these pseudonymous join keys must be approved before use.
BEGIN;

CREATE TABLE IF NOT EXISTS public.core_attempt_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    surface TEXT NOT NULL CONSTRAINT core_evidence_surface_check CHECK (surface IN (
        'speaking', 'reading_exam', 'listening_test',
        'listening_dictation', 'writing_assignment'
    )),
    canonical_attempt_id UUID NOT NULL,
    attempt_kind TEXT NOT NULL,
    CONSTRAINT core_evidence_attempt_kind_check CHECK (
        (surface = 'speaking' AND attempt_kind IN ('speaking_session', 'speaking_full_test'))
        OR (surface <> 'speaking' AND attempt_kind = 'default')
    ),
    -- This is an observation, not the historical source row's started_at.
    start_observed BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT core_evidence_canonical_key UNIQUE (surface, attempt_kind, canonical_attempt_id),
    CONSTRAINT core_evidence_id_surface_key UNIQUE (id, surface, attempt_kind)
);

CREATE TABLE IF NOT EXISTS public.core_attempt_evidence_events (
    id UUID PRIMARY KEY,
    attempt_id UUID,
    surface TEXT NOT NULL CONSTRAINT core_evidence_events_surface_check CHECK (surface IN (
        'speaking', 'reading_exam', 'listening_test',
        'listening_dictation', 'writing_assignment'
    )),
    operation_id UUID NOT NULL,
    attempt_kind TEXT NOT NULL,
    CONSTRAINT core_evidence_events_attempt_kind_check CHECK (
        (surface = 'speaking' AND attempt_kind IN ('speaking_session', 'speaking_full_test'))
        OR (surface <> 'speaking' AND attempt_kind = 'default')
    ),
    operation TEXT NOT NULL CONSTRAINT core_evidence_events_operation_check CHECK (operation IN ('start', 'save', 'submit', 'grade', 'finalize')),
    event_kind TEXT NOT NULL CONSTRAINT core_evidence_events_kind_check CHECK (event_kind IN (
        'started', 'operation_succeeded', 'operation_failed', 'outcome_observed'
    )),
    start_observed BOOLEAN NOT NULL,
    outcome TEXT CONSTRAINT core_evidence_events_outcome_check CHECK (outcome IN ('pending', 'success', 'failed', 'abandoned', 'unknown')),
    renderer TEXT CONSTRAINT core_evidence_events_renderer_check CHECK (renderer IN ('legacy', 'next')),
    -- Never inferred from request headers, provider mode, or absence of a test label.
    traffic_class TEXT NOT NULL DEFAULT 'unknown'
        CONSTRAINT core_evidence_events_traffic_check CHECK (traffic_class IN ('unknown', 'organic', 'synthetic')),
    release_id TEXT CONSTRAINT core_evidence_events_release_check CHECK (release_id ~ '^[a-f0-9]{40}$'),
    -- Fixed machine codes only. No exception text, answers, URLs, or learner data.
    error_code TEXT CONSTRAINT core_evidence_events_error_check CHECK (error_code IN (
        'timeout', 'transport', 'conflict', 'rejected', 'server_error', 'unknown'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT core_evidence_events_outcome_kind_check CHECK ((event_kind = 'outcome_observed') = (outcome IS NOT NULL)),
    CONSTRAINT core_evidence_events_error_kind_check CHECK ((event_kind = 'operation_failed') = (error_code IS NOT NULL)),
    CONSTRAINT core_evidence_events_unbound_check CHECK (attempt_id IS NOT NULL OR (operation = 'start' AND event_kind = 'operation_failed')),
    CONSTRAINT core_evidence_events_start_operation_check CHECK (event_kind <> 'started' OR operation = 'start'),
    CONSTRAINT core_evidence_events_start_known_check CHECK ((event_kind = 'started') = start_observed),
    CONSTRAINT core_evidence_events_parent_key FOREIGN KEY (attempt_id, surface, attempt_kind)
        REFERENCES public.core_attempt_evidence(id, surface, attempt_kind) ON DELETE CASCADE
);

-- IF NOT EXISTS is not proof that a pre-existing table has the constraints
-- this writer requires. Fail loudly on missing/unvalidated safety constraints.
DO $$
DECLARE expected RECORD;
BEGIN
    FOR expected IN SELECT * FROM (VALUES
        ('core_attempt_evidence', 'core_evidence_surface_check', 'c'),
        ('core_attempt_evidence', 'core_evidence_attempt_kind_check', 'c'),
        ('core_attempt_evidence', 'core_evidence_canonical_key', 'u'),
        ('core_attempt_evidence', 'core_evidence_id_surface_key', 'u'),
        ('core_attempt_evidence_events', 'core_evidence_events_surface_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_attempt_kind_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_operation_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_kind_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_outcome_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_renderer_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_traffic_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_release_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_error_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_outcome_kind_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_error_kind_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_unbound_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_start_operation_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_start_known_check', 'c'),
        ('core_attempt_evidence_events', 'core_evidence_events_parent_key', 'f')
    ) AS required(table_name, constraint_name, constraint_type)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = ('public.' || expected.table_name)::regclass
              AND conname = expected.constraint_name
              AND contype::text = expected.constraint_type AND convalidated
        ) THEN
            RAISE EXCEPTION 'core_evidence_schema_incomplete: %', expected.constraint_name;
        END IF;
    END LOOP;
    FOR expected IN SELECT * FROM (VALUES
        ('core_attempt_evidence', 'id', 'uuid', true, 'gen_random_uuid()'),
        ('core_attempt_evidence', 'surface', 'text', true, NULL),
        ('core_attempt_evidence', 'canonical_attempt_id', 'uuid', true, NULL),
        ('core_attempt_evidence', 'attempt_kind', 'text', true, NULL),
        ('core_attempt_evidence', 'start_observed', 'boolean', true, NULL),
        ('core_attempt_evidence', 'created_at', 'timestamp with time zone', true, 'clock_timestamp()'),
        ('core_attempt_evidence_events', 'id', 'uuid', true, NULL),
        ('core_attempt_evidence_events', 'attempt_id', 'uuid', false, NULL),
        ('core_attempt_evidence_events', 'surface', 'text', true, NULL),
        ('core_attempt_evidence_events', 'operation_id', 'uuid', true, NULL),
        ('core_attempt_evidence_events', 'attempt_kind', 'text', true, NULL),
        ('core_attempt_evidence_events', 'operation', 'text', true, NULL),
        ('core_attempt_evidence_events', 'event_kind', 'text', true, NULL),
        ('core_attempt_evidence_events', 'start_observed', 'boolean', true, NULL),
        ('core_attempt_evidence_events', 'outcome', 'text', false, NULL),
        ('core_attempt_evidence_events', 'renderer', 'text', false, NULL),
        ('core_attempt_evidence_events', 'traffic_class', 'text', true, '''unknown''::text'),
        ('core_attempt_evidence_events', 'release_id', 'text', false, NULL),
        ('core_attempt_evidence_events', 'error_code', 'text', false, NULL),
        ('core_attempt_evidence_events', 'created_at', 'timestamp with time zone', true, 'clock_timestamp()')
    ) AS required(table_name, column_name, type_name, not_null, default_expression)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_attribute a
            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = ('public.' || expected.table_name)::regclass
              AND a.attname = expected.column_name AND NOT a.attisdropped
              AND a.atttypid = expected.type_name::regtype
              AND a.attnotnull = expected.not_null
              AND pg_get_expr(d.adbin, d.adrelid) IS NOT DISTINCT FROM expected.default_expression
        ) THEN
            RAISE EXCEPTION 'core_evidence_column_drift: %.%', expected.table_name, expected.column_name;
        END IF;
    END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_core_attempt_evidence_events_attempt
    ON public.core_attempt_evidence_events(attempt_id, created_at);
CREATE INDEX IF NOT EXISTS idx_core_attempt_evidence_events_window
    ON public.core_attempt_evidence_events(created_at, id);
CREATE INDEX IF NOT EXISTS idx_core_attempt_evidence_events_operation
    ON public.core_attempt_evidence_events(operation_id);

ALTER TABLE public.core_attempt_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_attempt_evidence_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.core_attempt_evidence, public.core_attempt_evidence_events
    FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.core_attempt_evidence, public.core_attempt_evidence_events
    TO service_role;

-- One atomic receipt. Retrying its event UUID is safe; a different event UUID
-- represents another observation, NOT another learner attempt. A replay with
-- different facts is rejected, rather than silently overwriting evidence.
CREATE OR REPLACE FUNCTION public.fn_record_core_attempt_evidence(
    p_event_id UUID,
    p_operation_id UUID,
    p_surface TEXT,
    p_canonical_attempt_id UUID,
    p_start_observed BOOLEAN,
    p_operation TEXT,
    p_event_kind TEXT,
    p_outcome TEXT,
    p_renderer TEXT,
    p_traffic_class TEXT,
    p_release_id TEXT,
    p_error_code TEXT,
    p_attempt_kind TEXT
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    ledger_id UUID;
    existing public.core_attempt_evidence_events%ROWTYPE;
BEGIN
    IF p_start_observed IS NULL
       OR (p_event_kind = 'started' AND NOT p_start_observed)
       OR (p_start_observed AND (p_event_kind <> 'started' OR p_canonical_attempt_id IS NULL)) THEN
        RAISE EXCEPTION 'invalid_start_evidence' USING ERRCODE = '22023';
    END IF;

    IF p_canonical_attempt_id IS NOT NULL THEN
        INSERT INTO public.core_attempt_evidence
            (surface, attempt_kind, canonical_attempt_id, start_observed)
        VALUES (p_surface, p_attempt_kind, p_canonical_attempt_id, p_start_observed)
        ON CONFLICT (surface, attempt_kind, canonical_attempt_id) DO NOTHING;

        SELECT id INTO STRICT ledger_id FROM public.core_attempt_evidence
        WHERE surface = p_surface AND attempt_kind = p_attempt_kind AND canonical_attempt_id = p_canonical_attempt_id;
        -- Deliberately do not upgrade a late first observation to a known start.
        -- Out-of-order/missing evidence remains incomplete, even after a retry.
    END IF;

    INSERT INTO public.core_attempt_evidence_events (
        id, attempt_id, surface, operation_id, operation, event_kind, start_observed,
        outcome, renderer, traffic_class, release_id, error_code, attempt_kind
    ) VALUES (
        p_event_id, ledger_id, p_surface, p_operation_id, p_operation, p_event_kind, p_start_observed,
        p_outcome, p_renderer, p_traffic_class, p_release_id, p_error_code, p_attempt_kind
    ) ON CONFLICT (id) DO NOTHING;

    SELECT * INTO STRICT existing FROM public.core_attempt_evidence_events WHERE id = p_event_id;
    IF ROW(existing.attempt_id, existing.surface, existing.operation_id, existing.operation,
           existing.event_kind, existing.start_observed, existing.outcome, existing.renderer, existing.traffic_class,
           existing.release_id, existing.error_code, existing.attempt_kind)
       IS DISTINCT FROM
       ROW(ledger_id, p_surface, p_operation_id, p_operation, p_event_kind, p_start_observed, p_outcome,
           p_renderer, p_traffic_class, p_release_id, p_error_code, p_attempt_kind) THEN
        RAISE EXCEPTION 'evidence_event_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN existing.id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_core_attempt_evidence(
    UUID, UUID, TEXT, UUID, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_core_attempt_evidence(
    UUID, UUID, TEXT, UUID, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

-- Private computed field: return only the expected sentence count in the same
-- PostgREST snapshot as the attempt/report/answers, never snapshot content.
-- Migration 220 provides the composite table type; no product rows are changed.
CREATE OR REPLACE FUNCTION public.core_evidence_unit_count(public.dictation_attempts)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
    SELECT CASE WHEN jsonb_typeof(($1).units_snapshot) = 'array'
                THEN jsonb_array_length(($1).units_snapshot) END;
$$;
REVOKE ALL ON FUNCTION public.core_evidence_unit_count(public.dictation_attempts)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.core_evidence_unit_count(public.dictation_attempts)
    TO service_role;

COMMIT;
