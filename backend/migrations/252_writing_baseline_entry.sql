-- Owned baseline compatibility, separate from prospective admission (247–251).
-- No enrollment, retrospective episode/command, epoch rotation or activation.
BEGIN;

CREATE INDEX IF NOT EXISTS core_admission_scopes_resource
    ON public.core_admission_scopes(domain,resource_id);

-- Advisory UI classification only. The mutating entry revalidates under locks;
-- callers must not treat a stale read as permission to use old /start.
CREATE OR REPLACE FUNCTION public.fn_get_writing_entry(
    p_user_id UUID,p_student_id UUID,p_assignment_id UUID
) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    WITH source AS (
        SELECT a.*,o.id AS origin_id,o.student_id AS origin_student,
            o.first_activity,o.invalidated_at,o.deleted_at,
            EXISTS(SELECT 1 FROM public.core_attempt_episodes e
                JOIN public.core_admission_scopes s ON s.id=e.scope_id
                WHERE s.domain='writing_assignment' AND s.resource_id=a.id) AS has_episode,
            EXISTS(SELECT 1 FROM public.core_attempt_episodes e
                JOIN public.core_admission_scopes s ON s.id=e.scope_id
                WHERE s.domain='writing_assignment' AND s.resource_id=a.id
                  AND s.principal_id<>p_user_id) AS has_foreign_episode,
            EXISTS(SELECT 1 FROM public.core_admission_bindings b
                WHERE b.domain='writing_assignment' AND b.canonical_id=a.id) AS has_binding,
            EXISTS(SELECT 1 FROM public.core_admission_bindings b
                JOIN public.core_attempt_episodes e ON e.id=b.episode_id
                JOIN public.core_admission_scopes s ON s.id=e.scope_id
                WHERE b.domain='writing_assignment' AND b.canonical_id=a.id
                  AND b.principal_id=p_user_id AND s.scope_key=a.id AND s.resource_id=a.id) AS own_binding,
            EXISTS(SELECT 1 FROM public.writing_drafts d WHERE d.assignment_id=a.id) AS has_draft
        FROM public.writing_assignments a
        JOIN public.students student ON student.id=a.student_id AND student.user_id=p_user_id
        LEFT JOIN public.core_writing_origins o ON o.assignment_id=a.id
        WHERE a.id=p_assignment_id AND a.student_id=p_student_id
    ), classified AS (
        SELECT source.*,CASE
            WHEN status IN ('submitted','graded','delivered') THEN 'terminal'
            WHEN status NOT IN ('pending','in_progress') THEN 'blocked'
            WHEN has_foreign_episode THEN 'blocked'
            WHEN NOT core_admission_tracked AND origin_id IS NULL
                AND NOT has_episode AND NOT has_binding THEN 'baseline_untracked'
            WHEN core_admission_tracked AND origin_id IS NOT NULL AND origin_student=student_id
                AND invalidated_at IS NULL AND deleted_at IS NULL THEN
                CASE
                    WHEN first_activity='unclaimed' AND NOT has_episode AND NOT has_binding THEN 'baseline_unclaimed'
                    WHEN first_activity='admitted' AND own_binding AND started_at IS NOT NULL THEN 'admitted'
                    WHEN first_activity IS NULL AND NOT has_binding AND status='pending'
                        AND started_at IS NULL AND essay_id IS NULL AND NOT has_draft THEN 'eligible'
                    ELSE 'blocked'
                END
            ELSE 'blocked'
        END AS entry_kind FROM source
    )
    SELECT jsonb_build_object('kind',entry_kind,
        'assignment',jsonb_build_object('id',id,'status',status,'is_timed',is_timed,
            'time_limit_minutes',time_limit_minutes,'started_at',started_at,'auto_submitted',auto_submitted))
    FROM classified;
$$;

CREATE OR REPLACE FUNCTION public.fn_enter_writing_baseline(
    p_user_id UUID,p_student_id UUID,p_assignment_id UUID,p_nonce_digest TEXT,p_allow_start BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.writing_assignments%ROWTYPE;
    scope public.core_admission_scopes%ROWTYPE;
    result JSONB; observed_at TIMESTAMPTZ;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'writing_admission_requires_read_committed' USING ERRCODE='ZA001';
    END IF;
    IF p_user_id IS NULL OR p_student_id IS NULL OR p_assignment_id IS NULL
       OR p_nonce_digest IS NULL OR p_nonce_digest !~ '^[a-f0-9]{64}$' OR p_allow_start IS NULL THEN
        RAISE EXCEPTION 'admission_invalid_input' USING ERRCODE='ZA001';
    END IF;
    -- Same nonce -> scope -> student -> assignment -> origin order as Writing A.
    -- A possibly accepted command must be resolved by its own protocol, even if
    -- the browser lost its command ID or now sees different source metadata.
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'core-admission-nonce:' || p_user_id::text || ':' || p_nonce_digest,0));
    IF EXISTS(SELECT 1 FROM public.core_admission_commands
        WHERE principal_id=p_user_id AND protocol='admission-v1' AND nonce_digest=p_nonce_digest) THEN
        RAISE EXCEPTION 'writing_baseline_has_admission' USING ERRCODE='ZA002';
    END IF;
    INSERT INTO public.core_admission_scopes(principal_id,domain,scope_key,resource_id)
        VALUES(p_user_id,'writing_assignment',p_assignment_id,p_assignment_id)
        ON CONFLICT (principal_id,domain,scope_key) DO NOTHING;
    SELECT * INTO scope FROM public.core_admission_scopes
        WHERE principal_id=p_user_id AND domain='writing_assignment' AND scope_key=p_assignment_id FOR UPDATE;
    IF scope.resource_id <> p_assignment_id THEN
        RAISE EXCEPTION 'admission_scope_conflict' USING ERRCODE='ZA002';
    END IF;
    PERFORM id FROM public.students WHERE id=p_student_id AND user_id=p_user_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005'; END IF;
    SELECT * INTO a FROM public.writing_assignments WHERE id=p_assignment_id AND student_id=p_student_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005'; END IF;
    PERFORM id FROM public.core_writing_origins WHERE assignment_id=a.id FOR UPDATE;
    result := public.fn_get_writing_entry(p_user_id,p_student_id,p_assignment_id);
    IF result IS NULL THEN RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005'; END IF;
    -- Even terminal source data cannot authorize bypassing an existing ledger
    -- episode. This also rejects commands belonging to a prior source owner.
    IF EXISTS(SELECT 1 FROM public.core_attempt_episodes e
        JOIN public.core_admission_scopes s ON s.id=e.scope_id
        WHERE s.domain='writing_assignment' AND s.resource_id=a.id)
       OR EXISTS(SELECT 1 FROM public.core_admission_bindings WHERE domain='writing_assignment' AND canonical_id=a.id) THEN
        RAISE EXCEPTION 'writing_baseline_has_admission' USING ERRCODE='ZA002';
    END IF;
    IF result->>'kind'='terminal' THEN RETURN result; END IF;
    IF result->>'kind' NOT IN ('baseline_untracked','baseline_unclaimed') THEN
        RAISE EXCEPTION 'writing_baseline_ineligible' USING ERRCODE='ZA007';
    END IF;
    observed_at := clock_timestamp();
    IF a.renderer_affinity IS NULL OR a.renderer_affinity NOT IN ('legacy','next')
       OR a.renderer_affinity_expires_at IS NULL OR a.renderer_affinity_expires_at <= observed_at THEN
        RAISE EXCEPTION 'writing_admission_lease_expired' USING ERRCODE='ZA006';
    END IF;
    IF a.started_at IS NULL AND NOT p_allow_start THEN
        RAISE EXCEPTION 'writing_baseline_explicit_start_required' USING ERRCODE='ZA008';
    END IF;
    IF a.started_at IS NULL OR a.status='pending' THEN
        UPDATE public.writing_assignments SET started_at=COALESCE(started_at,observed_at),
            status=CASE WHEN status='pending' THEN 'in_progress' ELSE status END
            WHERE id=a.id AND student_id=p_student_id;
    END IF;
    -- Source assignment identity + its persisted clock are baseline replay
    -- authority. The nonce only guards against crossing an existing admission;
    -- it is not claimed to be an observed eligible-start receipt.
    RETURN public.fn_get_writing_entry(p_user_id,p_student_id,p_assignment_id);
END $$;

REVOKE ALL ON FUNCTION public.fn_get_writing_entry(UUID,UUID,UUID),
    public.fn_enter_writing_baseline(UUID,UUID,UUID,TEXT,BOOLEAN)
    FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_writing_entry(UUID,UUID,UUID),
    public.fn_enter_writing_baseline(UUID,UUID,UUID,TEXT,BOOLEAN) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
