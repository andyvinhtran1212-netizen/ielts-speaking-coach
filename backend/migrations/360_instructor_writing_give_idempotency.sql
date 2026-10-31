-- INSTRUCTORGIVE-0044 (PC-J192, step b of PC-J100): idempotent /instructor
-- Writing gives. Number 360 allocated by the Leader on 2026-10-31.
--
-- POST /instructor/assignments (one prompt -> one learner) and
-- POST /instructor/assignments/fan-out (prompts -> a class) gain a required
-- client request_id. This RPC owns the request ledger and the insert in ONE
-- transaction: a retry with the same request_id returns the first receipt and
-- writes nothing, the same id with another body is refused, and an id is
-- bound to the instructor (assigned_by) that first used it.
--
-- Deliberately a separate ledger, not writing_assignment_requests (206/228):
-- a receipt there carrying the give's group_id is the W-05 marker for "given
-- from the admin Writing tools" (routers/writing_student.py
-- _admin_gave_via_instructor_workflow). An admin teaching from /instructor
-- must keep the 'instructor' tier, so /instructor receipts never go there.
-- The 228 RPC is not touched (it has no grading_tier either).
--
-- Ownership is re-checked inside the transaction (defence in depth behind the
-- route's own W-3 checks): every prompt created_by = owner; a fan-out's class
-- created_by = owner and no active member owned by another instructor; an
-- individual give's learner instructor_id = owner. The class roster is the
-- active memberships, locked FOR SHARE as in 228. The 331 (archived learner)
-- and 337 (archived class) triggers on writing_assignments still apply; any
-- refusal rolls back the ledger row too, so a retry can run again.
--
-- Forward policy: pending_feature, group instructor_give_idempotency. It does
-- not apply on merge. Staging first through the advisory-locked runner with
-- MIGRATION_FEATURES=instructor_give_idempotency, BEFORE the backend that
-- calls the RPC; production only at an authorised staging -> main promotion.
-- One transaction, additive, re-runnable; no existing data is changed.
--
-- Rollback (deploy the pre-0044 backend first; then a new forward migration):
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DROP FUNCTION IF EXISTS public.fn_create_instructor_writing_give_idempotent(
--       uuid, uuid, text, jsonb, uuid[], uuid, uuid, text, boolean,
--       timestamptz, text, integer, text);
--   DROP TABLE IF EXISTS public.instructor_writing_assignment_requests;
--   COMMIT;
-- Dropping the ledger loses only replay receipts; every writing_assignments
-- row it created stays.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
    IF to_regclass('public.writing_assignments') IS NULL
       OR to_regclass('public.writing_prompts') IS NULL
       OR to_regclass('public.cohorts') IS NULL
       OR to_regclass('public.students') IS NULL
       OR to_regclass('public.student_cohort_memberships') IS NULL
       OR to_regclass('public.users') IS NULL
       OR to_regtype('public.grading_tier_enum') IS NULL THEN
        RAISE EXCEPTION 'instructor_give_prerequisite_missing';
    END IF;
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (table_name, column_name) IN (
               ('writing_assignments', 'grading_tier'),
               ('writing_assignments', 'cohort_id'),
               ('writing_assignments', 'assignment_group_id'),
               ('writing_assignments', 'analysis_level'),
               ('writing_prompts', 'created_by'),
               ('cohorts', 'created_by'),
               ('students', 'instructor_id'))) <> 7 THEN
        RAISE EXCEPTION 'instructor_give_prerequisite_column_missing';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.instructor_writing_assignment_requests (
    id              uuid PRIMARY KEY,
    -- CASCADE, not 206's RESTRICT: writing_assignments.assigned_by is
    -- ON DELETE SET NULL, so a receipt must not start blocking a user delete.
    assigned_by     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    give_kind       text NOT NULL CHECK (give_kind IN ('individual', 'fan_out')),
    request_payload jsonb NOT NULL,
    receipt         jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instructor_writing_assignment_requests_assigned_by
    ON public.instructor_writing_assignment_requests (assigned_by, created_at DESC);

ALTER TABLE public.instructor_writing_assignment_requests ENABLE ROW LEVEL SECURITY;
-- No policy: clients never read or write it. The backend reads a receipt with
-- service_role (SELECT only); only the definer RPC writes.
REVOKE ALL ON public.instructor_writing_assignment_requests
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.instructor_writing_assignment_requests TO service_role;

COMMENT ON TABLE public.instructor_writing_assignment_requests IS
    'INSTRUCTORGIVE-0044: idempotency ledger for /instructor Writing gives. '
    'Kept apart from the admin-tools ledger of migration 206, whose receipts mark admin-tool gives (W-05).';

CREATE OR REPLACE FUNCTION public.fn_create_instructor_writing_give_idempotent(
    p_request_id uuid,
    p_owner uuid,
    p_give_kind text,
    p_request_payload jsonb,
    p_prompt_ids uuid[],
    p_cohort_id uuid DEFAULT NULL,
    p_student_id uuid DEFAULT NULL,
    p_name text DEFAULT NULL,
    p_allow_soft_check boolean DEFAULT false,
    p_deadline timestamptz DEFAULT NULL,
    p_instructions text DEFAULT NULL,
    p_analysis_level integer DEFAULT 3,
    p_grading_tier text DEFAULT 'standard'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prompt_count integer := COALESCE(array_length(p_prompt_ids, 1), 0);
    v_existing_owner uuid;
    v_existing_kind text;
    v_existing_payload jsonb;
    v_receipt jsonb;
    v_group_id uuid;
    v_student_ids uuid[];
    v_duplicates jsonb := '[]'::jsonb;
    v_created jsonb := '[]'::jsonb;
BEGIN
    IF p_request_id IS NULL OR p_owner IS NULL OR p_request_payload IS NULL
       OR jsonb_typeof(p_request_payload) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'instructor_give_request_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_give_kind = 'individual' THEN
        IF p_student_id IS NULL OR p_cohort_id IS NOT NULL OR v_prompt_count <> 1 THEN
            RAISE EXCEPTION 'instructor_give_request_invalid' USING ERRCODE = '22023';
        END IF;
    ELSIF p_give_kind = 'fan_out' THEN
        IF p_cohort_id IS NULL OR p_student_id IS NOT NULL OR v_prompt_count NOT BETWEEN 1 AND 20 THEN
            RAISE EXCEPTION 'instructor_give_request_invalid' USING ERRCODE = '22023';
        END IF;
    ELSE
        RAISE EXCEPTION 'instructor_give_request_invalid' USING ERRCODE = '22023';
    END IF;
    IF array_position(p_prompt_ids, NULL) IS NOT NULL
       OR (SELECT count(DISTINCT prompt_id) FROM unnest(p_prompt_ids) AS prompt_id) <> v_prompt_count
       OR p_analysis_level IS NULL OR p_analysis_level NOT BETWEEN 1 AND 5
       OR p_grading_tier IS NULL OR p_grading_tier NOT IN ('standard', 'deep') THEN
        RAISE EXCEPTION 'instructor_give_request_invalid' USING ERRCODE = '22023';
    END IF;

    -- A concurrent request with the same id waits here on the primary key
    -- until the first one commits (then replays) or rolls back (then runs).
    INSERT INTO instructor_writing_assignment_requests (id, assigned_by, give_kind, request_payload)
    VALUES (p_request_id, p_owner, p_give_kind, p_request_payload)
    ON CONFLICT (id) DO NOTHING;

    IF NOT FOUND THEN
        SELECT assigned_by, give_kind, request_payload, receipt
          INTO v_existing_owner, v_existing_kind, v_existing_payload, v_receipt
          FROM instructor_writing_assignment_requests
         WHERE id = p_request_id
         FOR UPDATE;
        IF NOT FOUND OR v_existing_owner IS DISTINCT FROM p_owner THEN
            RAISE EXCEPTION 'instructor_give_request_owned_by_other' USING ERRCODE = '42501';
        END IF;
        IF v_existing_kind IS DISTINCT FROM p_give_kind
           OR v_existing_payload IS DISTINCT FROM p_request_payload THEN
            RAISE EXCEPTION 'instructor_give_request_payload_mismatch' USING ERRCODE = '22023';
        END IF;
        IF v_receipt IS NULL THEN
            RAISE EXCEPTION 'instructor_give_request_incomplete' USING ERRCODE = '55000';
        END IF;
        RETURN v_receipt || jsonb_build_object('replayed', true);
    END IF;

    IF (SELECT count(*) FROM writing_prompts
         WHERE id = ANY (p_prompt_ids) AND created_by = p_owner) <> v_prompt_count THEN
        RAISE EXCEPTION 'instructor_give_not_owned' USING ERRCODE = '42501';
    END IF;

    IF p_give_kind = 'individual' THEN
        IF NOT EXISTS (SELECT 1 FROM students
                        WHERE id = p_student_id AND instructor_id = p_owner) THEN
            RAISE EXCEPTION 'instructor_give_not_owned' USING ERRCODE = '42501';
        END IF;
        v_student_ids := ARRAY[p_student_id];
        -- As before 0044: a named individual give gets its own group so the
        -- learner dashboard, which shows `name` on group headers, displays it.
        IF COALESCE(p_name, '') <> '' THEN
            v_group_id := gen_random_uuid();
        END IF;
    ELSE
        IF NOT EXISTS (SELECT 1 FROM cohorts
                        WHERE id = p_cohort_id AND created_by = p_owner) THEN
            RAISE EXCEPTION 'instructor_give_not_owned' USING ERRCODE = '42501';
        END IF;
        -- Same roster lock as the 228 cohort branch: a membership cannot end
        -- between this read and the insert.
        PERFORM m.id
           FROM student_cohort_memberships m
          WHERE m.cohort_id = p_cohort_id AND m.is_active
          FOR SHARE OF m;
        SELECT array_agg(DISTINCT m.student_id ORDER BY m.student_id)
          INTO v_student_ids
          FROM student_cohort_memberships m
         WHERE m.cohort_id = p_cohort_id AND m.is_active;
        IF v_student_ids IS NULL THEN
            RAISE EXCEPTION 'instructor_give_roster_empty' USING ERRCODE = '22023';
        END IF;
        -- W-3 student branch: a member owned by ANOTHER instructor is refused;
        -- an unowned (NULL) member of my own class is allowed, as before.
        IF EXISTS (SELECT 1 FROM students
                    WHERE id = ANY (v_student_ids)
                      AND instructor_id IS NOT NULL AND instructor_id <> p_owner) THEN
            RAISE EXCEPTION 'instructor_give_not_owned' USING ERRCODE = '42501';
        END IF;
        v_group_id := gen_random_uuid();
    END IF;

    -- Allow + warn: learners who already hold any of these prompts.
    SELECT COALESCE(jsonb_agg(DISTINCT student_id::text ORDER BY student_id::text), '[]'::jsonb)
      INTO v_duplicates
      FROM writing_assignments
     WHERE prompt_id = ANY (p_prompt_ids)
       AND student_id = ANY (v_student_ids);

    WITH inserted AS (
        INSERT INTO writing_assignments (
            prompt_id, student_id, cohort_id, assignment_group_id, name,
            allow_soft_check, assigned_by, deadline, instructions,
            analysis_level, grading_tier
        )
        SELECT prompt_rows.prompt_id, student_rows.student_id, p_cohort_id, v_group_id, p_name,
               COALESCE(p_allow_soft_check, false), p_owner, p_deadline, p_instructions,
               p_analysis_level, p_grading_tier::grading_tier_enum
          FROM unnest(v_student_ids) AS student_rows(student_id)
         CROSS JOIN unnest(p_prompt_ids) AS prompt_rows(prompt_id)
        RETURNING *
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
      INTO v_created
      FROM inserted;

    IF p_give_kind = 'individual' THEN
        -- The route answers an individual give with the created row itself.
        v_receipt := jsonb_build_object('assignment', v_created->0);
    ELSE
        v_receipt := jsonb_build_object(
            'student_count', array_length(v_student_ids, 1),
            'created_count', jsonb_array_length(v_created),
            'group_id', v_group_id,
            'duplicates_warning', v_duplicates,
            'assignment_ids', (SELECT COALESCE(jsonb_agg(item->>'id'), '[]'::jsonb)
                                 FROM jsonb_array_elements(v_created) AS item)
        );
    END IF;

    UPDATE instructor_writing_assignment_requests
       SET receipt = v_receipt, updated_at = now()
     WHERE id = p_request_id;
    RETURN v_receipt || jsonb_build_object('replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_instructor_writing_give_idempotent(
    uuid, uuid, text, jsonb, uuid[], uuid, uuid, text, boolean,
    timestamptz, text, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_instructor_writing_give_idempotent(
    uuid, uuid, text, jsonb, uuid[], uuid, uuid, text, boolean,
    timestamptz, text, integer, text
) TO service_role;

DO $$
DECLARE
    v_role text;
    v_privilege text;
    v_fn regprocedure := 'public.fn_create_instructor_writing_give_idempotent(uuid, uuid, text, jsonb, uuid[], uuid, uuid, text, boolean, timestamptz, text, integer, text)'::regprocedure;
BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_class
             WHERE oid = 'public.instructor_writing_assignment_requests'::regclass)
       OR EXISTS (SELECT 1 FROM pg_policy
                   WHERE polrelid = 'public.instructor_writing_assignment_requests'::regclass) THEN
        RAISE EXCEPTION 'instructor_give_ledger_not_private';
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
            IF has_table_privilege(v_role, 'public.instructor_writing_assignment_requests', v_privilege) THEN
                RAISE EXCEPTION 'instructor_give_ledger_client_grant: % %', v_role, v_privilege;
            END IF;
        END LOOP;
        IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
            RAISE EXCEPTION 'instructor_give_rpc_client_executable: %', v_role;
        END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
        IF has_table_privilege('service_role', 'public.instructor_writing_assignment_requests', v_privilege) THEN
            RAISE EXCEPTION 'instructor_give_ledger_service_write: %', v_privilege;
        END IF;
    END LOOP;
    IF NOT has_table_privilege('service_role', 'public.instructor_writing_assignment_requests', 'SELECT')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'instructor_give_service_role_missing';
    END IF;
    IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
              FROM pg_proc WHERE oid = v_fn) THEN
        RAISE EXCEPTION 'instructor_give_rpc_not_pinned_security_definer';
    END IF;
END $$;

COMMIT;
