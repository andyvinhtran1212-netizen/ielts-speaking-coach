-- Writing execution B for already validated/prepared admission-v1 commands.
-- Requires 247 + Writing schema/lease guard 224. No enrollment or activation.
-- Prepare remains internal until prospective baseline/writer coverage is proved.
BEGIN;

DO $$ BEGIN
    PERFORM id,student_id,status,started_at,is_timed,time_limit_minutes,
        auto_submitted,renderer_affinity,renderer_affinity_expires_at,
        renderer_affinity_claimed_at FROM public.writing_assignments LIMIT 0;
    PERFORM id,user_id FROM public.students LIMIT 0;
    PERFORM assignment_id FROM public.writing_drafts LIMIT 0;
    PERFORM episode_id,phase,generation FROM public.core_admission_commands LIMIT 0;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
        WHERE tgrelid='public.writing_drafts'::regclass
          AND tgname='trg_guard_writing_draft_mutation' AND NOT tgisinternal
          AND tgenabled IN ('O','A') AND tgtype=23 -- ROW + BEFORE + INSERT + UPDATE
          AND tgfoid='public.fn_guard_writing_draft_mutation()'::regprocedure) THEN
        RAISE EXCEPTION 'writing_admission_requires_draft_guard' USING ERRCODE='ZA004';
    END IF;
END $$;

-- One coherent, content-free, ownership-filtered read. Bound readback is allowed
-- after submit/lease expiry; it never reopens or restarts a completed assignment.
CREATE OR REPLACE FUNCTION public.fn_get_writing_admission(
    p_user_id UUID,p_student_id UUID,p_assignment_id UUID,p_command_id UUID
) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    SELECT jsonb_build_object('command',public.fn_get_core_admission(p_user_id,c.id),
        'assignment',jsonb_build_object('id',a.id,'status',a.status,'is_timed',a.is_timed,
            'time_limit_minutes',a.time_limit_minutes,'started_at',a.started_at,
            'auto_submitted',a.auto_submitted))
    FROM public.core_admission_commands c
    JOIN public.core_attempt_episodes e ON e.id=c.episode_id
    JOIN public.core_admission_scopes scope ON scope.id=e.scope_id
    JOIN public.writing_assignments a ON a.id=scope.resource_id
    JOIN public.students student ON student.id=a.student_id
    WHERE c.id=p_command_id AND c.principal_id=p_user_id AND c.domain='writing_assignment'
      AND scope.scope_key=p_assignment_id AND scope.resource_id=p_assignment_id
      AND a.student_id=p_student_id AND student.user_id=p_user_id
      AND (c.phase <> 'bound' OR EXISTS (
          SELECT 1 FROM public.core_admission_bindings b
          WHERE b.episode_id=e.id AND b.canonical_id=a.id
            AND b.domain='writing_assignment' AND b.principal_id=p_user_id));
$$;

CREATE OR REPLACE FUNCTION public.fn_execute_writing_admission(
    p_user_id UUID,p_student_id UUID,p_assignment_id UUID,p_command_id UUID,p_generation INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.core_admission_commands%ROWTYPE;
    a public.writing_assignments%ROWTYPE; scope_id UUID;
    binding public.core_admission_bindings%ROWTYPE;
    observed_at TIMESTAMPTZ;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'writing_admission_requires_read_committed' USING ERRCODE='ZA001';
    END IF;
    IF p_user_id IS NULL OR p_student_id IS NULL OR p_assignment_id IS NULL
       OR p_command_id IS NULL OR p_generation IS NULL OR p_generation < 0 THEN
        RAISE EXCEPTION 'admission_invalid_input' USING ERRCODE='ZA001';
    END IF;
    -- Immutable IDs may be located without locks, then revalidated after the
    -- required order: scope -> student -> assignment -> command. No provider I/O.
    SELECT scope.id INTO scope_id FROM public.core_admission_commands command
        JOIN public.core_attempt_episodes e ON e.id=command.episode_id
        JOIN public.core_admission_scopes scope ON scope.id=e.scope_id
        WHERE command.id=p_command_id AND command.principal_id=p_user_id
          AND command.domain='writing_assignment'
          AND scope.resource_id=p_assignment_id AND scope.scope_key=p_assignment_id;
    IF scope_id IS NULL THEN
        RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005';
    END IF;
    PERFORM id FROM public.core_admission_scopes WHERE id=scope_id FOR UPDATE;
    PERFORM id FROM public.students WHERE id=p_student_id AND user_id=p_user_id FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005';
    END IF;
    SELECT * INTO a FROM public.writing_assignments
        WHERE id=p_assignment_id AND student_id=p_student_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005';
    END IF;
    SELECT * INTO c FROM public.core_admission_commands
        WHERE id=p_command_id AND principal_id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005';
    END IF;
    IF c.generation <> p_generation OR c.phase='unstarted_expired' THEN
        RAISE EXCEPTION 'writing_admission_fenced' USING ERRCODE='ZA002';
    END IF;
    SELECT * INTO binding FROM public.core_admission_bindings WHERE episode_id=c.episode_id;
    IF FOUND AND (binding.canonical_id <> a.id OR binding.domain <> 'writing_assignment'
        OR binding.principal_id <> p_user_id) THEN
        RAISE EXCEPTION 'writing_admission_binding_conflict' USING ERRCODE='ZA004';
    END IF;
    IF c.phase='bound' THEN
        IF binding.id IS NULL OR a.started_at IS NULL THEN
            RAISE EXCEPTION 'writing_admission_binding_conflict' USING ERRCODE='ZA004';
        END IF;
        RETURN public.fn_get_writing_admission(p_user_id,p_student_id,p_assignment_id,p_command_id);
    END IF;
    observed_at := clock_timestamp(); -- after lock waits, never transaction-start time
    IF c.execute_before <= observed_at THEN
        RAISE EXCEPTION 'writing_admission_expired' USING ERRCODE='ZA006';
    END IF;
    IF a.status NOT IN ('pending','in_progress') THEN
        RAISE EXCEPTION 'writing_admission_state_conflict' USING ERRCODE='ZA002';
    END IF;
    IF a.renderer_affinity IS NULL OR a.renderer_affinity NOT IN ('legacy','next')
       OR a.renderer_affinity_expires_at IS NULL OR a.renderer_affinity_expires_at <= observed_at THEN
        RAISE EXCEPTION 'writing_admission_lease_expired' USING ERRCODE='ZA006';
    END IF;
    IF binding.id IS NULL THEN
        -- Known prior activity is a baseline conflict, never adopted as a new
        -- observed start. Absence here is NOT proof of complete historical
        -- inactivity; prospective eligibility is still the prepare caller's duty.
        -- Guard 224 serializes draft inserts against this assignment lock.
        IF a.started_at IS NOT NULL OR a.status <> 'pending' OR EXISTS (
            SELECT 1 FROM public.writing_drafts WHERE assignment_id=a.id
        ) THEN
            RAISE EXCEPTION 'writing_admission_baseline_conflict' USING ERRCODE='ZA007';
        END IF;
        INSERT INTO public.core_admission_bindings(episode_id,principal_id,domain,canonical_id)
            VALUES(c.episode_id,p_user_id,'writing_assignment',a.id);
    ELSIF a.started_at IS NULL THEN
        -- A bound row with its clock cleared is source drift, not a fresh start.
        RAISE EXCEPTION 'writing_admission_binding_conflict' USING ERRCODE='ZA004';
    END IF;
    UPDATE public.writing_assignments SET
        started_at=COALESCE(started_at,observed_at),
        status=CASE WHEN status='pending' THEN 'in_progress' ELSE status END,
        renderer_affinity_claimed_at=observed_at,
        renderer_affinity_expires_at=observed_at+interval '24 hours'
        WHERE id=a.id AND student_id=p_student_id;
    UPDATE public.core_admission_commands SET phase='bound'
        WHERE id=c.id AND generation=p_generation AND phase='accepted';
    -- The source UPDATE, binding, command marker and journal all roll back on
    -- any failure. No best-effort completion write is outside this transaction.
    RETURN public.fn_get_writing_admission(p_user_id,p_student_id,p_assignment_id,p_command_id);
END $$;

REVOKE ALL ON FUNCTION public.fn_get_writing_admission(UUID,UUID,UUID,UUID),
    public.fn_execute_writing_admission(UUID,UUID,UUID,UUID,INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_writing_admission(UUID,UUID,UUID,UUID),
    public.fn_execute_writing_admission(UUID,UUID,UUID,UUID,INTEGER) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
