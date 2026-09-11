-- Private durable capture -> finalize, default OFF. No learner writes/backfill.
BEGIN;

CREATE TABLE IF NOT EXISTS public.core_writing_report_control (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    policy_digest TEXT CHECK (policy_digest ~ '^[a-f0-9]{64}$'),
    CHECK (NOT enabled OR policy_digest IS NOT NULL)
);
INSERT INTO public.core_writing_report_control(singleton) VALUES(true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.core_writing_cohort_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Historical identity, deliberately not a cascading source FK: erasing an
    -- epoch must not silently erase an artifact before a reviewed erasure flow.
    epoch_id UUID NOT NULL,
    classifier_profile TEXT NOT NULL DEFAULT 'writing-current-v1' CHECK (classifier_profile='writing-current-v1'),
    policy_digest TEXT NOT NULL CHECK (policy_digest ~ '^[a-f0-9]{64}$'),
    source_snapshot JSONB NOT NULL,
    snapshot_digest TEXT NOT NULL CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
    summary JSONB,
    summary_digest TEXT CHECK (summary_digest ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    finalized_at TIMESTAMPTZ,
    CHECK ((summary IS NULL) = (summary_digest IS NULL)),
    CHECK ((summary IS NULL) = (finalized_at IS NULL))
);
CREATE INDEX IF NOT EXISTS core_writing_reports_epoch ON public.core_writing_cohort_reports(epoch_id,created_at);
ALTER TABLE public.core_writing_report_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.core_writing_cohort_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.core_writing_report_control,public.core_writing_cohort_reports FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_guard_writing_cohort_report()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
    IF TG_TABLE_NAME='core_writing_report_control' THEN
        NEW.created_at:=OLD.created_at; NEW.updated_at:=clock_timestamp(); RETURN NEW;
    END IF;
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'writing_report_immutable' USING ERRCODE='ZA002'; END IF;
    IF (to_jsonb(NEW)-ARRAY['summary','summary_digest','finalized_at','updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['summary','summary_digest','finalized_at','updated_at'])
       OR OLD.summary IS NOT NULL OR NEW.summary IS NULL THEN
        RAISE EXCEPTION 'writing_report_immutable' USING ERRCODE='ZA002';
    END IF;
    NEW.updated_at:=clock_timestamp();
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_writing_cohort_report ON public.core_writing_cohort_reports;
CREATE TRIGGER trg_guard_writing_cohort_report BEFORE UPDATE OR DELETE ON public.core_writing_cohort_reports
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_writing_cohort_report();
DROP TRIGGER IF EXISTS trg_touch_writing_report_control ON public.core_writing_report_control;
CREATE TRIGGER trg_touch_writing_report_control BEFORE UPDATE ON public.core_writing_report_control
    FOR EACH ROW EXECUTE FUNCTION public.fn_guard_writing_cohort_report();

CREATE OR REPLACE FUNCTION public.fn_get_writing_cohort_report(p_report_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    SELECT to_jsonb(r) FROM public.core_writing_cohort_reports r WHERE r.id=p_report_id;
$$;

CREATE OR REPLACE FUNCTION public.fn_capture_writing_cohort_report(p_report_id UUID,p_epoch_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.core_writing_cohort_reports%ROWTYPE; control public.core_writing_report_control%ROWTYPE; source JSONB;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' OR p_report_id IS NULL OR p_epoch_id IS NULL THEN
        RAISE EXCEPTION 'admission_invalid_input' USING ERRCODE='ZA001';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('core-writing-report:'||p_report_id::text,0));
    SELECT * INTO r FROM public.core_writing_cohort_reports WHERE id=p_report_id;
    IF FOUND THEN
        IF r.epoch_id <> p_epoch_id THEN RAISE EXCEPTION 'writing_report_conflict' USING ERRCODE='ZA002'; END IF;
        RETURN to_jsonb(r); -- exact replay, even after capture is disabled
    END IF;
    SELECT * INTO control FROM public.core_writing_report_control WHERE singleton FOR SHARE;
    IF NOT FOUND OR NOT control.enabled OR control.policy_digest IS NULL THEN
        RAISE EXCEPTION 'writing_report_capture_disabled' USING ERRCODE='ZA003';
    END IF;
    source := public.fn_read_writing_admission_cohort(p_epoch_id);
    IF source IS NULL OR octet_length(source::text)>8388608 THEN
        RAISE EXCEPTION 'writing_report_snapshot_unavailable' USING ERRCODE='ZA004';
    END IF;
    INSERT INTO public.core_writing_cohort_reports(id,epoch_id,policy_digest,source_snapshot,snapshot_digest)
        VALUES(p_report_id,p_epoch_id,control.policy_digest,source,encode(sha256(convert_to(source::text,'UTF8')),'hex'))
        RETURNING * INTO r;
    RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.fn_finalize_writing_cohort_report(p_report_id UUID,p_snapshot_digest TEXT,p_summary JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.core_writing_cohort_reports%ROWTYPE; item RECORD; state_total BIGINT:=0; reason_total BIGINT:=0;
BEGIN
    IF p_report_id IS NULL OR p_snapshot_digest IS NULL OR p_summary IS NULL THEN
        RAISE EXCEPTION 'admission_invalid_input' USING ERRCODE='ZA001';
    END IF;
    SELECT * INTO r FROM public.core_writing_cohort_reports WHERE id=p_report_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'writing_report_not_found' USING ERRCODE='ZA005'; END IF;
    IF r.snapshot_digest <> p_snapshot_digest THEN RAISE EXCEPTION 'writing_report_snapshot_conflict' USING ERRCODE='ZA002'; END IF;
    IF r.summary IS NOT NULL THEN
        IF r.summary <> p_summary THEN RAISE EXCEPTION 'writing_report_result_conflict' USING ERRCODE='ZA002'; END IF;
        RETURN to_jsonb(r);
    END IF;
    -- Trusted classifier output, NOT arbitrary public analytics ingestion.
    -- Only fixed summary fields/counts, no free text/content/learner identifiers.
    IF jsonb_typeof(p_summary)<>'object' OR
       (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_summary) key) <>
       ARRAY['admitted_episode_count','closed_at','coverage','epoch_id','gate_f','reasons','snapshot_at','states','version']::text[]
       OR p_summary->'version' IS DISTINCT FROM '1'::jsonb
       OR p_summary->>'epoch_id' IS DISTINCT FROM r.epoch_id::text
       OR p_summary->>'coverage' IS DISTINCT FROM 'unknown'
       OR p_summary->>'gate_f' IS DISTINCT FROM 'not_assessed'
       OR p_summary->'admitted_episode_count' IS DISTINCT FROM r.source_snapshot->'episode_count'
       OR (p_summary->>'closed_at')::timestamptz IS DISTINCT FROM (r.source_snapshot->>'closed_at')::timestamptz
       OR (p_summary->>'snapshot_at')::timestamptz IS DISTINCT FROM (r.source_snapshot->>'snapshot_at')::timestamptz
       OR jsonb_typeof(p_summary->'states') IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_summary->'reasons') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'writing_report_invalid_summary' USING ERRCODE='ZA001';
    END IF;
    IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_summary->'states') key) IS DISTINCT FROM
       ARRAY['failed','pending','success','unknown','unresumable','unstarted','unstarted_expired']::text[] THEN
        RAISE EXCEPTION 'writing_report_invalid_summary' USING ERRCODE='ZA001';
    END IF;
    FOR item IN SELECT key,value FROM jsonb_each(p_summary->'states') LOOP
        IF jsonb_typeof(item.value)<>'number' OR item.value::text !~ '^[0-9]{1,4}$' THEN
            RAISE EXCEPTION 'writing_report_invalid_count' USING ERRCODE='ZA001';
        END IF;
        state_total:=state_total+(item.value::text)::bigint;
    END LOOP;
    FOR item IN SELECT key,value FROM jsonb_each(p_summary->'reasons') LOOP
        IF item.key NOT IN ('scope_inconsistent','source_missing_or_owner_changed','provenance_missing_or_invalidated',
            'command_history_incomplete','unbound_source_activity','command_awaits_execution_or_fencing',
            'commands_fenced_without_start','binding_inconsistent','job_metadata_incomplete','renderer_metadata_invalid',
            'writing_renderer_lease_expired','source_metadata_invalid','writing_state_incomplete','writing_not_submitted',
            'writing_current_feedback_persisted','writing_grading_pending','writing_retry_pending','writing_grading_failed')
           OR jsonb_typeof(item.value)<>'number' OR item.value::text !~ '^[0-9]{1,4}$' THEN
            RAISE EXCEPTION 'writing_report_invalid_reason' USING ERRCODE='ZA001';
        END IF;
        reason_total:=reason_total+(item.value::text)::bigint;
    END LOOP;
    IF state_total<>(r.source_snapshot->>'episode_count')::bigint OR reason_total<>state_total THEN
        RAISE EXCEPTION 'writing_report_incomplete_counts' USING ERRCODE='ZA001';
    END IF;
    UPDATE public.core_writing_cohort_reports SET summary=p_summary,
        summary_digest=encode(sha256(convert_to(p_summary::text,'UTF8')),'hex'),finalized_at=clock_timestamp()
        WHERE id=r.id RETURNING * INTO r;
    RETURN to_jsonb(r);
END $$;

REVOKE ALL ON FUNCTION public.fn_get_writing_cohort_report(UUID),public.fn_capture_writing_cohort_report(UUID,UUID),
    public.fn_finalize_writing_cohort_report(UUID,TEXT,JSONB),public.fn_guard_writing_cohort_report()
    FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_writing_cohort_report(UUID),public.fn_capture_writing_cohort_report(UUID,UUID),
    public.fn_finalize_writing_cohort_report(UUID,TEXT,JSONB) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
