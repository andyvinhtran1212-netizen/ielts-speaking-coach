-- Private coherent source read for one CLOSED Writing membership epoch.
-- No report persistence, learner mutation, epoch rotation or capture activation.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_read_writing_admission_cohort(p_epoch_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE epoch public.core_admission_epochs%ROWTYPE; total BIGINT; rows JSONB;
    observed_at TIMESTAMPTZ := clock_timestamp(); -- after any caller's lock waits
BEGIN
    IF p_epoch_id IS NULL THEN RAISE EXCEPTION 'admission_invalid_input' USING ERRCODE='ZA001'; END IF;
    SELECT * INTO epoch FROM public.core_admission_epochs
        WHERE id=p_epoch_id AND domain='writing_assignment';
    IF NOT FOUND THEN RAISE EXCEPTION 'writing_cohort_not_found' USING ERRCODE='ZA005'; END IF;
    IF epoch.state <> 'closed' OR epoch.closed_at IS NULL THEN
        RAISE EXCEPTION 'writing_cohort_membership_open' USING ERRCODE='ZA002';
    END IF;
    SELECT count(*) INTO total FROM public.core_attempt_episodes
        WHERE first_admission_epoch_id=p_epoch_id AND domain='writing_assignment';
    -- Safety ceiling, NOT an eligibility/sample threshold. Refuse rather than
    -- paginate live snapshots or silently drop the rest of a larger cohort.
    IF total > 1000 THEN RAISE EXCEPTION 'writing_cohort_requires_materialization' USING ERRCODE='ZA004'; END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'episode_id',e.id,'principal_id',e.principal_id,'first_epoch_id',e.first_admission_epoch_id,
        'resource_id',s.resource_id,'scope_key',s.scope_key,
        'binding',CASE WHEN b.id IS NOT NULL THEN jsonb_build_object(
            'canonical_id',b.canonical_id,'principal_id',b.principal_id,'domain',b.domain) END,
        'commands',jsonb_build_object('accepted',c.accepted,'bound',c.bound,'fenced',c.fenced),
        'source_owner_id',student.user_id,
        'origin',CASE WHEN o.id IS NOT NULL THEN jsonb_build_object('student_id',o.student_id,
            'first_activity',o.first_activity,'invalidated_at',o.invalidated_at,'deleted_at',o.deleted_at) END,
        'source',CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id',a.id,'student_id',a.student_id,
            'status',a.status,'essay_id',a.essay_id,'renderer_affinity',a.renderer_affinity,
            'renderer_affinity_expires_at',a.renderer_affinity_expires_at,'started_at',a.started_at,
            'essay',CASE WHEN essay.id IS NOT NULL THEN jsonb_build_object('id',essay.id,
                'student_id',essay.student_id,'status',essay.status,'is_flagged',essay.is_flagged,
                'current_version',essay.current_version,'deleted_at',essay.deleted_at,
                'feedback',feedback.rows,'jobs',jobs.rows) END) END
    ) ORDER BY e.id),'[]'::jsonb) INTO rows
    FROM public.core_attempt_episodes e
    JOIN public.core_admission_scopes s ON s.id=e.scope_id
    LEFT JOIN public.core_admission_bindings b ON b.episode_id=e.id
    LEFT JOIN public.writing_assignments a ON a.id=s.resource_id
    LEFT JOIN public.students student ON student.id=a.student_id
    LEFT JOIN public.core_writing_origins o ON o.assignment_id=s.resource_id
    LEFT JOIN public.writing_essays essay ON essay.id=a.essay_id
    LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE phase='accepted') AS accepted,
        count(*) FILTER (WHERE phase='bound') AS bound,
        count(*) FILTER (WHERE phase='unstarted_expired') AS fenced
        FROM public.core_admission_commands WHERE episode_id=e.id) c ON true
    LEFT JOIN LATERAL (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) AS rows FROM (
        SELECT version,overall_band_score FROM public.writing_feedback_current
        WHERE essay_id=essay.id ORDER BY version LIMIT 2) x) feedback ON true
    LEFT JOIN LATERAL (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) AS rows FROM (
        SELECT job_type,status,created_at,completed_at FROM public.writing_jobs
        WHERE essay_id=essay.id AND job_type='analyze' ORDER BY created_at DESC,id LIMIT 1001) x) jobs ON true
    WHERE e.first_admission_epoch_id=p_epoch_id AND e.domain='writing_assignment';
    RETURN jsonb_build_object('epoch_id',epoch.id,'closed_at',epoch.closed_at,
        'snapshot_at',observed_at,'episode_count',total,'episodes',rows);
END $$;

REVOKE ALL ON FUNCTION public.fn_read_writing_admission_cohort(UUID)
    FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_read_writing_admission_cohort(UUID) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
