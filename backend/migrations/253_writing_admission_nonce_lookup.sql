-- Owned read-only recovery after a lost preparation ACK. No capture/activation.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_find_writing_admission(
    p_user_id UUID,p_student_id UUID,p_assignment_id UUID,p_nonce_digest TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE command_id UUID; result JSONB;
BEGIN
    IF p_user_id IS NULL OR p_student_id IS NULL OR p_assignment_id IS NULL
       OR p_nonce_digest IS NULL OR p_nonce_digest !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'admission_invalid_input' USING ERRCODE='ZA001';
    END IF;
    PERFORM a.id FROM public.writing_assignments a
        JOIN public.students s ON s.id=a.student_id
        WHERE a.id=p_assignment_id AND a.student_id=p_student_id AND s.user_id=p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005'; END IF;
    -- Existing principal/protocol/nonce uniqueness supplies a bounded lookup.
    -- The canonical getter validates domain, resource, current ownership and
    -- binding in this STABLE function's single statement snapshot.
    SELECT c.id INTO command_id FROM public.core_admission_commands c
        WHERE c.principal_id=p_user_id AND c.protocol='admission-v1'
          AND c.nonce_digest=p_nonce_digest;
    IF command_id IS NULL THEN RETURN NULL; END IF;
    result := public.fn_get_writing_admission(p_user_id,p_student_id,p_assignment_id,command_id);
    IF result IS NULL THEN
        -- A nonce exists but is not this owned resource. Do not return a false
        -- absence that a caller could mistake for permission to mint/prepare.
        RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005';
    END IF;
    RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.fn_find_writing_admission(UUID,UUID,UUID,TEXT)
    FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_find_writing_admission(UUID,UUID,UUID,TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
