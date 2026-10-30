-- CLASSARCHIVE-0030 FR-002/FR-008, PC-J447 / #2059.
-- One transaction owns activation + enrollment + claim. No persisted
-- provisional users/student state and no application-side undo window.
-- No 337/346 dependency: optional cohort archive metadata is read as JSON.
-- Does not install/replace archive columns, functions or triggers.
-- Forward: pending_feature activation_serialize; Leader applies on staging
-- in the freeze window AFTER SA-DESIGN-359 APPROVE, via the advisory-locked
-- runner. Production only at an authorised staging→main promotion.
-- Additive, re-runnable; no seed or existing-row changes at apply time.
-- Rollback: deploy the preceding backend, then rollback/359_activation_serialize.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_activation_serialize(
    p_user_id uuid, p_code_id uuid, p_code text, p_email text, p_metadata jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout = '3s'
SET statement_timeout = '15s'
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_code public.access_codes%ROWTYPE;
    v_student public.students%ROWTYPE;
    v_by_code public.students%ROWTYPE;
    v_cohort jsonb;
    v_owner uuid;
    v_enroll_owner uuid;
    v_student_id uuid;
    v_has_linked boolean;
    v_has_active boolean;
    v_promote text;
    v_phase text := 'activation';
    v_message text;
BEGIN
    -- Single-bigint activation keys and the runner's two-int (173204,1)
    -- advisory keys occupy distinct PostgreSQL lock namespaces.
    -- Everything in this subtransaction, including trigger writes, rolls back
    -- before its EXCEPTION handler returns a safe error receipt.
    BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended('activate:' || p_user_id::text, 0));
        SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
        SELECT * INTO v_code FROM public.access_codes
         WHERE id = p_code_id AND code = p_code FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('status', 'invalid_code');
        END IF;
        IF to_jsonb(v_user)->>'suspended_at' IS NOT NULL THEN
            RETURN jsonb_build_object('status', 'account_suspended');
        END IF;
        IF lower(btrim(coalesce(v_code.grants_role, ''))) = 'instructor' THEN
            IF nullif(lower(btrim(v_code.intended_email)), '') IS NULL
               OR lower(btrim(v_code.intended_email)) IS DISTINCT FROM lower(btrim(p_email)) THEN
                RETURN jsonb_build_object('status', 'promote_email_mismatch',
                                          'intended_email', v_code.intended_email);
            END IF;
            v_promote := 'instructor';
        END IF;

        IF v_code.is_used THEN
            IF v_code.used_by = p_user_id THEN
                -- Another same-user submit finished while we waited. Its
                -- account, enrollment and permissions are already committed.
                RETURN jsonb_build_object('status', 'ok', 'role', v_user.role,
                    'promote_role', v_promote, 'cohort_id', v_code.cohort_id,
                    'student_id', (SELECT id FROM public.students
                                   WHERE user_id = p_user_id AND archived_at IS NULL
                                   ORDER BY id LIMIT 1));
            END IF;
            RETURN jsonb_build_object('status', 'lost_claim');
        END IF;
        IF coalesce((to_jsonb(v_code)->>'is_revoked')::boolean, false)
           OR (to_jsonb(v_code)->>'expires_at')::timestamptz <= statement_timestamp() THEN
            RETURN jsonb_build_object('status', 'invalid_code');
        END IF;

        -- Lock all candidate profiles in a stable order before selecting one.
        -- The code row also serializes linking its previously unlinked bridge
        -- from different user ids.
        PERFORM s.id FROM public.students s
         WHERE s.user_id = p_user_id OR s.student_code = p_code
         ORDER BY s.id FOR UPDATE;
        SELECT EXISTS (SELECT 1 FROM public.students WHERE user_id = p_user_id),
               EXISTS (SELECT 1 FROM public.students WHERE user_id = p_user_id AND archived_at IS NULL)
          INTO v_has_linked, v_has_active;
        SELECT * INTO v_student FROM public.students
         WHERE user_id = p_user_id AND archived_at IS NULL ORDER BY id LIMIT 1;
        SELECT * INTO v_by_code FROM public.students WHERE student_code = p_code ORDER BY id LIMIT 1;
        IF v_student.id IS NULL AND (v_by_code.user_id IS NULL OR v_by_code.user_id = p_user_id) THEN
            v_student := v_by_code;
        END IF;
        IF (v_has_linked AND NOT v_has_active) OR v_student.archived_at IS NOT NULL THEN
            RETURN jsonb_build_object('status', 'student_archived');
        END IF;

        SELECT id INTO v_owner FROM public.users
         WHERE id = v_code.issued_by AND role = 'instructor';
        IF v_student.instructor_id IS NOT NULL AND v_owner IS NOT NULL
           AND v_student.instructor_id <> v_owner THEN
            RETURN jsonb_build_object('status', 'enroll_reassign_rejected',
                                      'current_owner', v_student.instructor_id, 'attempted_owner', v_owner);
        END IF;
        IF v_code.cohort_id IS NOT NULL THEN
            -- FOR SHARE prevents archive from committing between this check
            -- and enrollment/claim, even when 337's guards are not installed.
            SELECT to_jsonb(c) INTO v_cohort FROM public.cohorts c
             WHERE c.id = v_code.cohort_id FOR SHARE;
            IF v_cohort->>'is_active' = 'false' AND v_cohort->>'archived_at' IS NOT NULL THEN
                RETURN jsonb_build_object('status', 'cohort_archived');
            END IF;
        END IF;
        v_enroll_owner := coalesce(v_owner, (v_cohort->>'created_by')::uuid);

        INSERT INTO public.users (id, email, display_name, avatar_url, role, is_active)
        VALUES (p_user_id, p_email,
                coalesce(p_metadata->>'full_name', p_metadata->>'name'),
                p_metadata->>'avatar_url', 'user', false)
        ON CONFLICT (id) DO NOTHING;
        IF v_user.id IS NULL THEN
            SELECT * INTO STRICT v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
        END IF;
        UPDATE public.users SET is_active = true, access_code_used = v_code.code,
            permissions = coalesce(nullif(nullif(to_jsonb(v_code)->'permissions', 'null'::jsonb), '[]'::jsonb),
                                   '["practice_single","practice_part","practice_full"]'::jsonb)
         WHERE id = p_user_id;

        v_phase := 'enrollment';
        IF v_student.id IS NOT NULL AND v_code.cohort_id IS NOT NULL THEN
            UPDATE public.students
               SET user_id = coalesce(user_id, p_user_id),
                   cohort_id = v_code.cohort_id,
                   instructor_id = coalesce(instructor_id, v_enroll_owner)
             WHERE id = v_student.id;
            v_student_id := v_student.id;
        ELSIF v_student.id IS NOT NULL THEN
            -- A class-less code never names cohort_id: 227's sync fires on
            -- UPDATE OF cohort_id even when unchanged, and 337 then refuses
            -- the archived old class (Codex r4426581235; staging router parity).
            UPDATE public.students
               SET user_id = coalesce(user_id, p_user_id),
                   instructor_id = coalesce(instructor_id, v_enroll_owner)
             WHERE id = v_student.id
               AND (user_id IS NULL OR (instructor_id IS NULL AND v_enroll_owner IS NOT NULL));
            v_student_id := v_student.id;
        ELSIF v_by_code.id IS NULL AND (v_owner IS NOT NULL OR v_code.cohort_id IS NOT NULL) THEN
            INSERT INTO public.students (user_id, student_code, full_name, created_by, instructor_id, cohort_id)
            VALUES (p_user_id, v_code.code,
                    coalesce(nullif(p_metadata->>'full_name', ''), nullif(p_metadata->>'name', ''),
                             nullif(split_part(p_email, '@', 1), ''), 'Học viên'),
                    v_code.issued_by, v_enroll_owner, v_code.cohort_id)
            RETURNING id INTO v_student_id;
        END IF;

        v_phase := 'claim';
        UPDATE public.access_codes SET is_used = true, used_by = p_user_id, used_at = statement_timestamp()
         WHERE id = v_code.id AND NOT is_used;
        IF NOT FOUND THEN
            -- Raising (rather than returning) rolls back the provisional user
            -- and membership writes in the enclosing subtransaction.
            RAISE EXCEPTION USING MESSAGE = 'activation_conflict', ERRCODE = 'P0001';
        END IF;
        RETURN jsonb_build_object('status', 'ok', 'role', v_user.role,
                                  'student_id', v_student_id, 'cohort_id', v_code.cohort_id,
                                  'promote_role', v_promote);
    EXCEPTION
        WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
            IF v_message = 'cohort_archived' THEN
                RETURN jsonb_build_object('status', 'cohort_archived');
            ELSIF v_message IN ('account_suspended', 'account_suspended_role_change') THEN
                RETURN jsonb_build_object('status', 'account_suspended');
            ELSIF v_message = 'student_archived' THEN
                RETURN jsonb_build_object('status', 'student_archived');
            ELSIF SQLSTATE IN ('55P03', '40P01') OR v_message = 'activation_conflict' THEN
                RETURN jsonb_build_object('status', 'activation_conflict');
            END IF;
            -- No exception text or database values leave the function.
            RETURN jsonb_build_object('status', 'activation_error', 'phase', v_phase, 'sqlstate', SQLSTATE);
    END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_activation_serialize(uuid, uuid, text, text, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_activation_serialize(uuid, uuid, text, text, jsonb) TO service_role;

DO $$
DECLARE
    v_oid oid := 'public.fn_activation_serialize(uuid,uuid,text,text,jsonb)'::regprocedure;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef
                   AND proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp',
                                          'lock_timeout=3s', 'statement_timeout=15s']) THEN
        RAISE EXCEPTION 'activation_serialize_configuration_invalid';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p,
                      LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_oid AND a.privilege_type = 'EXECUTE' AND a.grantee = 0)
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'activation_serialize_acl_invalid';
    END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
