-- Rollback for 366_student_archive_definer_search_path.sql (PC-J611). Manual
-- only, never run by the migration runner; a rollback is applied as a new
-- forward migration after SA review.
--
-- It restores, verbatim, the 326 bodies of public.fn_archive_student,
-- public.fn_add_student_cohort_membership,
-- public.fn_add_students_cohort_membership and
-- public.fn_sync_legacy_student_cohort_membership, all with
-- search_path = public, pg_temp, and sets that path again on
-- public.fn_guard_writing_assignment_student_archived (331).
-- That REOPENS SA-2209 for these five functions: a typed overload in public
-- (for example to_jsonb(uuid[]) or array_agg(uuid)) runs as the function
-- owner on the next archive or bulk class add while any role holds CREATE on
-- public. 365 is not touched. Owner, SECURITY DEFINER and the
-- ACLs are kept (service_role keeps EXECUTE on the three RPCs); it grants and
-- revokes nothing. It refuses to run while public already holds a function
-- named like one the restored bodies call, because that code would run at
-- once.

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    v_wrong text;
BEGIN
    SELECT pg_catalog.string_agg(DISTINCT p.proname::text, ', ') INTO v_wrong
      FROM pg_catalog.pg_proc p
     WHERE p.pronamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
       AND p.proname::text OPERATOR(pg_catalog.=) ANY (ARRAY[
           'array_agg', 'array_to_string', 'count', 'jsonb_build_object', 'now', 'to_jsonb', 'unnest']);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'catalog_name_shadowed_in_public: %', v_wrong;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_archive_student(
    p_student_id         uuid,
    p_actor              uuid,
    p_reason             text DEFAULT NULL,
    p_deactivate_account boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_s           public.students%ROWTYPE;
    v_cohorts     uuid[];
    v_deactivated boolean := false;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'archive_actor_required';
    END IF;

    SELECT * INTO v_s FROM public.students WHERE id = p_student_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;                                   -- caller 404s
    END IF;
    IF v_s.archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'already_archived', 'archived_at', v_s.archived_at);
    END IF;

    -- Same effect as fn_remove_student_cohort_membership (227), for every class.
    WITH ended AS (
        UPDATE public.student_cohort_memberships
           SET is_active = false, left_at = now(), updated_at = now()
         WHERE student_id = p_student_id AND is_active
        RETURNING cohort_id
    )
    SELECT COALESCE(array_agg(cohort_id), '{}') INTO v_cohorts FROM ended;

    UPDATE public.students
       SET archived_at = now(), archived_by = p_actor, archive_reason = p_reason,
           cohort_id = NULL
     WHERE id = p_student_id;

    IF p_deactivate_account AND v_s.user_id IS NOT NULL THEN
        -- Runs as the function owner with the service_role JWT: allowed by the
        -- 320 guard; a client JWT cannot reach this function (EXECUTE revoked).
        UPDATE public.users SET is_active = false
         WHERE id = v_s.user_id AND is_active;
        v_deactivated := FOUND;
    END IF;

    INSERT INTO public.student_lifecycle_audit
        (student_id, user_id, action, actor_user_id, reason, detail)
    VALUES (p_student_id, v_s.user_id, 'archive', p_actor, p_reason,
            jsonb_build_object('ended_cohort_ids', to_jsonb(v_cohorts),
                               'previous_cohort_id', v_s.cohort_id,
                               'instructor_id', v_s.instructor_id,
                               'account_deactivated', v_deactivated));

    RETURN jsonb_build_object('status', 'archived', 'ended_cohort_ids', to_jsonb(v_cohorts),
                              'account_deactivated', v_deactivated);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_add_student_cohort_membership(
    p_student_id uuid,
    p_cohort_id  uuid,
    p_added_by   uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_archived_at timestamptz;
BEGIN
    SELECT archived_at INTO v_archived_at
      FROM students WHERE id = p_student_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'student_not_found';
    END IF;
    IF v_archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'student_archived';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cohorts WHERE id = p_cohort_id) THEN
        RAISE EXCEPTION 'cohort_not_found';
    END IF;

    INSERT INTO student_cohort_memberships (
        student_id, cohort_id, is_active, left_at, added_by, updated_at
    ) VALUES (p_student_id, p_cohort_id, true, NULL, p_added_by, now())
    ON CONFLICT (student_id, cohort_id) DO UPDATE
          SET is_active = true,
              left_at = NULL,
              added_by = COALESCE(EXCLUDED.added_by,
                                  student_cohort_memberships.added_by),
              updated_at = now();

    -- Preserve an existing primary pointer. It is compatibility metadata, not
    -- the canonical roster and must never turn an additive action into a move.
    UPDATE students
       SET cohort_id = COALESCE(cohort_id, p_cohort_id)
     WHERE id = p_student_id;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_add_students_cohort_membership(
    p_student_ids uuid[],
    p_cohort_id   uuid,
    p_added_by    uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_count    integer;
    v_archived uuid[];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cohorts WHERE id = p_cohort_id) THEN
        RAISE EXCEPTION 'cohort_not_found';
    END IF;

    -- Lock in id order (no deadlock between bulk calls), then refuse the whole
    -- batch if any requested learner is archived: no partial add.
    PERFORM 1 FROM students
      WHERE id = ANY (COALESCE(p_student_ids, '{}'::uuid[]))
      ORDER BY id FOR NO KEY UPDATE;
    SELECT array_agg(id ORDER BY id) INTO v_archived
      FROM students
     WHERE id = ANY (COALESCE(p_student_ids, '{}'::uuid[]))
       AND archived_at IS NOT NULL;
    IF v_archived IS NOT NULL THEN
        RAISE EXCEPTION 'student_archived'
            USING DETAIL = array_to_string(v_archived, ',');
    END IF;

    WITH wanted AS (
        SELECT DISTINCT unnest(COALESCE(p_student_ids, '{}'::uuid[])) AS id
    ), valid AS (
        SELECT s.id, EXISTS (
            SELECT 1 FROM student_cohort_memberships current
             WHERE current.student_id = s.id
               AND current.cohort_id = p_cohort_id AND current.is_active
        ) AS was_active
          FROM students s JOIN wanted w ON w.id = s.id
    ), upserted AS (
        INSERT INTO student_cohort_memberships (
            student_id, cohort_id, is_active, left_at, added_by, updated_at
        )
        SELECT id, p_cohort_id, true, NULL, p_added_by, now() FROM valid
        ON CONFLICT (student_id, cohort_id) DO UPDATE
              SET is_active = true,
                  left_at = NULL,
                  added_by = COALESCE(EXCLUDED.added_by,
                                      student_cohort_memberships.added_by),
                  updated_at = now()
        RETURNING student_id
    )
    SELECT count(*) FILTER (WHERE NOT was_active) INTO v_count FROM valid;

    UPDATE students s
       SET cohort_id = p_cohort_id
     WHERE s.cohort_id IS NULL
       AND s.id = ANY(COALESCE(p_student_ids, '{}'::uuid[]));
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_legacy_student_cohort_membership()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.cohort_id IS NOT NULL THEN
        IF NEW.archived_at IS NOT NULL THEN
            RAISE EXCEPTION 'student_archived';
        END IF;
        INSERT INTO student_cohort_memberships (
            student_id, cohort_id, is_active, left_at, updated_at
        ) VALUES (NEW.id, NEW.cohort_id, true, NULL, now())
        ON CONFLICT (student_id, cohort_id) DO UPDATE
              SET is_active = true, left_at = NULL, updated_at = now();
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.fn_guard_writing_assignment_student_archived() SET search_path = public, pg_temp;

COMMIT;
