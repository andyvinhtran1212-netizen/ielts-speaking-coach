-- Validated Writing transaction A. Requires 247–249; no capture activation.
-- HTTP verifies JWT + Writing entitlement before calling this private RPC.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_prepare_writing_admission(
    p_user_id UUID,p_student_id UUID,p_assignment_id UUID,p_nonce_digest TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.core_admission_commands%ROWTYPE;
    scope public.core_admission_scopes%ROWTYPE;
    a public.writing_assignments%ROWTYPE;
    origin public.core_writing_origins%ROWTYPE;
    binding public.core_admission_bindings%ROWTYPE;
    semantic TEXT; prepared JSONB; result JSONB;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'writing_admission_requires_read_committed' USING ERRCODE='ZA001';
    END IF;
    IF p_user_id IS NULL OR p_student_id IS NULL OR p_assignment_id IS NULL
       OR p_nonce_digest IS NULL OR p_nonce_digest !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'admission_invalid_input' USING ERRCODE='ZA001';
    END IF;
    -- Fixed intent: enter this assignment, whether its existing episode has
    -- started or not. Never derive a different fingerprint from mutable status.
    semantic := encode(sha256(convert_to('writing-admission-v1:' || p_assignment_id::text,'UTF8')),'hex');
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'core-admission-nonce:' || p_user_id::text || ':' || p_nonce_digest,0));
    SELECT * INTO c FROM public.core_admission_commands
        WHERE principal_id=p_user_id AND protocol='admission-v1' AND nonce_digest=p_nonce_digest;
    IF FOUND THEN
        SELECT s.* INTO scope FROM public.core_admission_scopes s
            JOIN public.core_attempt_episodes e ON e.scope_id=s.id WHERE e.id=c.episode_id;
        IF c.domain <> 'writing_assignment' OR c.action <> 'start'
           OR c.semantic_digest <> semantic OR scope.scope_key <> p_assignment_id
           OR scope.resource_id <> p_assignment_id THEN
            RAISE EXCEPTION 'admission_replay_conflict' USING ERRCODE='ZA002';
        END IF;
    ELSE
        -- Scope allocation is provisional: every validation failure rolls it
        -- back with the transaction. No eligible episode/command exists yet.
        INSERT INTO public.core_admission_scopes(principal_id,domain,scope_key,resource_id)
            VALUES(p_user_id,'writing_assignment',p_assignment_id,p_assignment_id)
            ON CONFLICT (principal_id,domain,scope_key) DO NOTHING;
        SELECT * INTO scope FROM public.core_admission_scopes
            WHERE principal_id=p_user_id AND domain='writing_assignment' AND scope_key=p_assignment_id;
        IF scope.resource_id <> p_assignment_id THEN
            RAISE EXCEPTION 'admission_scope_conflict' USING ERRCODE='ZA002';
        END IF;
    END IF;
    -- Same order as B; no source trigger may acquire scope/nonce locks.
    PERFORM id FROM public.core_admission_scopes WHERE id=scope.id FOR UPDATE;
    PERFORM id FROM public.students WHERE id=p_student_id AND user_id=p_user_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005'; END IF;
    SELECT * INTO a FROM public.writing_assignments
        WHERE id=p_assignment_id AND student_id=p_student_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005'; END IF;

    IF c.id IS NOT NULL THEN
        -- Recovery acknowledges the durable decision, even after epoch closure,
        -- command expiry or source submission. B still revalidates before writes.
        result := public.fn_get_writing_admission(p_user_id,p_student_id,p_assignment_id,c.id);
        IF result IS NULL THEN RAISE EXCEPTION 'writing_admission_binding_conflict' USING ERRCODE='ZA004'; END IF;
        RETURN result;
    END IF;
    IF NOT a.core_admission_tracked THEN
        RAISE EXCEPTION 'writing_admission_baseline_conflict' USING ERRCODE='ZA007';
    END IF;
    PERFORM public.fn_assert_writing_origin(a.id,a.student_id);
    SELECT * INTO origin FROM public.core_writing_origins WHERE assignment_id=a.id;
    SELECT * INTO binding FROM public.core_admission_bindings
        WHERE domain='writing_assignment' AND canonical_id=a.id;
    IF origin.first_activity IS NULL THEN
        IF binding.id IS NOT NULL THEN
            RAISE EXCEPTION 'writing_admission_binding_conflict' USING ERRCODE='ZA004';
        END IF;
        IF a.status <> 'pending' OR a.started_at IS NOT NULL OR a.essay_id IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.writing_drafts WHERE assignment_id=a.id) THEN
            RAISE EXCEPTION 'writing_admission_baseline_conflict' USING ERRCODE='ZA007';
        END IF;
    ELSE
        IF binding.id IS NULL OR binding.principal_id <> p_user_id OR a.started_at IS NULL
           OR NOT EXISTS (SELECT 1 FROM public.core_attempt_episodes
                WHERE id=binding.episode_id AND scope_id=scope.id) THEN
            RAISE EXCEPTION 'writing_admission_binding_conflict' USING ERRCODE='ZA004';
        END IF;
        IF a.status NOT IN ('pending','in_progress') THEN
            RAISE EXCEPTION 'writing_admission_state_conflict' USING ERRCODE='ZA002';
        END IF;
    END IF;
    -- Eligibility is now validated under locks BEFORE A. A reuses these nonce
    -- and scope locks, then acquires the open epoch. No timer/draft mutation here.
    -- Two minutes bounds this command only, not the learner's existing timer or
    -- renderer lease. Exact replay above never extends it.
    prepared := public.fn_prepare_core_admission(p_user_id,p_nonce_digest,semantic,
        'writing_assignment',p_assignment_id,p_assignment_id,'start',clock_timestamp()+interval '2 minutes');
    RETURN public.fn_get_writing_admission(p_user_id,p_student_id,p_assignment_id,(prepared->>'command_id')::uuid);
END $$;

REVOKE ALL ON FUNCTION public.fn_prepare_writing_admission(UUID,UUID,UUID,TEXT)
    FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_prepare_writing_admission(UUID,UUID,UUID,TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
