-- Owned on-demand command fencing. Requires 247–250; no epoch/capture activation.
-- This closes expired-command recovery when the periodic reconciler is absent.
-- It cannot start/restart work, renew a lease, fail an episode, or erase content.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_reconcile_writing_admission(
    p_user_id UUID,p_student_id UUID,p_assignment_id UUID,p_command_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.core_admission_commands%ROWTYPE; result JSONB;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'writing_admission_requires_read_committed' USING ERRCODE='ZA001';
    END IF;
    IF p_user_id IS NULL OR p_student_id IS NULL OR p_assignment_id IS NULL OR p_command_id IS NULL THEN
        RAISE EXCEPTION 'admission_invalid_input' USING ERRCODE='ZA001';
    END IF;
    -- COMMAND ONLY: B may hold scope/source while waiting here. Never acquire
    -- either of those locks from this function (including through a helper).
    SELECT * INTO c FROM public.core_admission_commands
        WHERE id=p_command_id AND principal_id=p_user_id AND domain='writing_assignment'
        FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005'; END IF;
    -- Nonlocking coherent read validates the current owned student/assignment,
    -- scope and binding. A missing source or another owner's work is not exposed.
    result := public.fn_get_writing_admission(p_user_id,p_student_id,p_assignment_id,p_command_id);
    IF result IS NULL THEN RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005'; END IF;
    -- Database clock AFTER lock waits is authoritative. Early requests are safe
    -- no-ops; bound commands remain bound, even past their original deadline.
    IF c.phase='accepted' AND c.execute_before <= clock_timestamp() THEN
        UPDATE public.core_admission_commands SET phase='unstarted_expired',generation=generation+1
            WHERE id=c.id AND phase='accepted' AND generation=c.generation;
        -- The existing journal trigger commits atomically with this marker.
        result := public.fn_get_writing_admission(p_user_id,p_student_id,p_assignment_id,p_command_id);
        IF result IS NULL THEN RAISE EXCEPTION 'writing_admission_not_found' USING ERRCODE='ZA005'; END IF;
    END IF;
    RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.fn_reconcile_writing_admission(UUID,UUID,UUID,UUID)
    FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_writing_admission(UUID,UUID,UUID,UUID) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
