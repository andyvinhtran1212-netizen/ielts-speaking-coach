-- Migration 227 — one student may actively belong to more than one class.
--
-- Additive compatibility migration: students.cohort_id remains the legacy
-- primary-class pointer. The normalized table below is the canonical roster.
-- Existing rows are backfilled and legacy writes are mirrored as additive
-- memberships, so rolling backend deploys do not drop a learner from a class.

BEGIN;

CREATE TABLE IF NOT EXISTS student_cohort_memberships (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    cohort_id   uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    is_active   boolean NOT NULL DEFAULT true,
    joined_at   timestamptz NOT NULL DEFAULT now(),
    left_at     timestamptz,
    added_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_student_cohort_membership UNIQUE (student_id, cohort_id),
    CONSTRAINT membership_left_state CHECK (
        (is_active AND left_at IS NULL) OR (NOT is_active)
    )
);

CREATE INDEX IF NOT EXISTS idx_memberships_active_student
    ON student_cohort_memberships (student_id, cohort_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_memberships_active_cohort
    ON student_cohort_memberships (cohort_id, student_id) WHERE is_active;

-- A learner can now be in two cohorts, so deriving a Writing give's cohort
-- from the learner is no longer truthful. New cohort fan-outs stamp their
-- origin; NULL remains the explicit legacy/individual-assignment state.
ALTER TABLE writing_assignments
    ADD COLUMN IF NOT EXISTS cohort_id uuid REFERENCES cohorts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_writing_assignments_cohort_created
    ON writing_assignments (cohort_id, created_at DESC)
    WHERE cohort_id IS NOT NULL;

COMMENT ON COLUMN writing_assignments.cohort_id IS
'Origin cohort for cohort fan-out. NULL means a legacy or direct individual give.';

COMMENT ON TABLE student_cohort_memberships IS
'Canonical class roster. A student can have multiple active cohort memberships;
students.cohort_id remains a temporary legacy primary-class pointer.';

INSERT INTO student_cohort_memberships (student_id, cohort_id, is_active)
SELECT id, cohort_id, true
  FROM students
 WHERE cohort_id IS NOT NULL
ON CONFLICT (student_id, cohort_id) DO UPDATE
      SET is_active = true, left_at = NULL, updated_at = now();

-- A rolling/legacy backend may still set students.cohort_id. Mirror that write
-- as an ADD, never as a transfer: clearing or changing the pointer must not
-- silently revoke another valid class membership.
CREATE OR REPLACE FUNCTION fn_sync_legacy_student_cohort_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.cohort_id IS NOT NULL THEN
        INSERT INTO student_cohort_memberships (
            student_id, cohort_id, is_active, left_at, updated_at
        ) VALUES (NEW.id, NEW.cohort_id, true, NULL, now())
        ON CONFLICT (student_id, cohort_id) DO UPDATE
              SET is_active = true, left_at = NULL, updated_at = now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_legacy_student_cohort_membership ON students;
CREATE TRIGGER trg_sync_legacy_student_cohort_membership
AFTER INSERT OR UPDATE OF cohort_id ON students
FOR EACH ROW
EXECUTE FUNCTION fn_sync_legacy_student_cohort_membership();

CREATE OR REPLACE FUNCTION fn_add_student_cohort_membership(
    p_student_id uuid,
    p_cohort_id  uuid,
    p_added_by   uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
        RAISE EXCEPTION 'student_not_found';
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

CREATE OR REPLACE FUNCTION fn_add_students_cohort_membership(
    p_student_ids uuid[],
    p_cohort_id   uuid,
    p_added_by    uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cohorts WHERE id = p_cohort_id) THEN
        RAISE EXCEPTION 'cohort_not_found';
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

CREATE OR REPLACE FUNCTION fn_remove_student_cohort_membership(
    p_student_id uuid,
    p_cohort_id  uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_changed boolean;
    v_primary uuid;
BEGIN
    UPDATE student_cohort_memberships
       SET is_active = false, left_at = now(), updated_at = now()
     WHERE student_id = p_student_id
       AND cohort_id = p_cohort_id
       AND is_active
    RETURNING true INTO v_changed;

    IF v_changed IS NOT TRUE THEN
        RETURN false;
    END IF;

    SELECT cohort_id INTO v_primary
      FROM student_cohort_memberships
     WHERE student_id = p_student_id AND is_active
     ORDER BY joined_at, cohort_id
     LIMIT 1;

    UPDATE students
       SET cohort_id = v_primary
     WHERE id = p_student_id AND cohort_id = p_cohort_id;
    RETURN true;
END;
$$;

-- Keep the idempotent Writing path atomic while stamping the same cohort
-- provenance as the non-idempotent fan-out service. The signature stays
-- unchanged; cohort_id is already part of the immutable request payload.
CREATE OR REPLACE FUNCTION public.fn_create_writing_assignments_idempotent(
    p_request_id uuid,
    p_assigned_by uuid,
    p_request_payload jsonb,
    p_prompt_ids uuid[],
    p_student_ids uuid[],
    p_name text DEFAULT NULL,
    p_allow_soft_check boolean DEFAULT false,
    p_deadline timestamptz DEFAULT NULL,
    p_instructions text DEFAULT NULL,
    p_is_timed boolean DEFAULT false,
    p_time_limit_minutes integer DEFAULT NULL,
    p_analysis_level integer DEFAULT 3
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing_assigned_by uuid;
    v_existing_payload jsonb;
    v_receipt jsonb;
    v_group_id uuid := gen_random_uuid();
    v_duplicates jsonb := '[]'::jsonb;
    v_created jsonb := '[]'::jsonb;
    v_cohort_id uuid;
BEGIN
    IF p_request_id IS NULL OR p_assigned_by IS NULL OR p_request_payload IS NULL THEN
        RAISE EXCEPTION 'writing_assignment_request_invalid' USING ERRCODE = '22023';
    END IF;
    BEGIN
        v_cohort_id := NULLIF(p_request_payload->>'cohort_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'writing_assignment_request_cohort_invalid' USING ERRCODE = '22023';
    END;
    IF v_cohort_id IS NULL THEN
        RAISE EXCEPTION 'writing_assignment_request_cohort_invalid' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(array_length(p_prompt_ids, 1), 0) < 1
       OR COALESCE(array_length(p_prompt_ids, 1), 0) > 20
       OR COALESCE(array_length(p_student_ids, 1), 0) < 1
       OR COALESCE(array_length(p_student_ids, 1), 0) > 10000 THEN
        RAISE EXCEPTION 'writing_assignment_request_cardinality_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_analysis_level NOT BETWEEN 1 AND 5
       OR (p_is_timed AND (p_time_limit_minutes IS NULL OR p_time_limit_minutes NOT BETWEEN 1 AND 180))
       OR (NOT p_is_timed AND p_time_limit_minutes IS NOT NULL) THEN
        RAISE EXCEPTION 'writing_assignment_request_options_invalid' USING ERRCODE = '22023';
    END IF;

    INSERT INTO writing_assignment_requests(id, assigned_by, request_payload)
    VALUES (p_request_id, p_assigned_by, p_request_payload)
    ON CONFLICT (id) DO NOTHING;

    IF NOT FOUND THEN
        SELECT assigned_by, request_payload, receipt
          INTO v_existing_assigned_by, v_existing_payload, v_receipt
          FROM writing_assignment_requests
         WHERE id = p_request_id
         FOR UPDATE;
        IF NOT FOUND OR v_existing_assigned_by IS DISTINCT FROM p_assigned_by THEN
            RAISE EXCEPTION 'writing_assignment_request_owned_by_other_admin' USING ERRCODE = '42501';
        END IF;
        IF v_existing_payload IS DISTINCT FROM p_request_payload THEN
            RAISE EXCEPTION 'writing_assignment_request_payload_mismatch' USING ERRCODE = '22023';
        END IF;
        IF v_receipt IS NULL THEN
            RAISE EXCEPTION 'writing_assignment_request_incomplete' USING ERRCODE = '55000';
        END IF;
        RETURN v_receipt || jsonb_build_object('replayed', true);
    END IF;

    -- Only a NEW request validates and locks its selected roster. A replay must
    -- return the immutable first receipt even if the student later leaves.
    -- A concurrent remove waits; a stale first request fails before inserting.
    PERFORM m.id
      FROM student_cohort_memberships m
      JOIN unnest(p_student_ids) AS wanted(student_id)
        ON wanted.student_id = m.student_id
     WHERE m.cohort_id = v_cohort_id AND m.is_active
     FOR SHARE OF m;
    IF EXISTS (
        SELECT 1 FROM unnest(p_student_ids) AS wanted(student_id)
         WHERE NOT EXISTS (
             SELECT 1 FROM student_cohort_memberships m
              WHERE m.student_id = wanted.student_id
                AND m.cohort_id = v_cohort_id AND m.is_active
         )
    ) THEN
        RAISE EXCEPTION 'writing_assignment_request_roster_changed' USING ERRCODE = '40001';
    END IF;

    SELECT COALESCE(jsonb_agg(DISTINCT student_id::text), '[]'::jsonb)
      INTO v_duplicates
      FROM writing_assignments
     WHERE prompt_id = ANY(p_prompt_ids)
       AND student_id = ANY(p_student_ids);

    WITH inserted AS (
        INSERT INTO writing_assignments(
            prompt_id, student_id, cohort_id, assignment_group_id, name,
            allow_soft_check, assigned_by, deadline, instructions,
            is_timed, time_limit_minutes, analysis_level
        )
        SELECT prompt_id, student_id, v_cohort_id, v_group_id, p_name,
               p_allow_soft_check, p_assigned_by, p_deadline, p_instructions,
               p_is_timed, p_time_limit_minutes, p_analysis_level
          FROM unnest(p_student_ids) AS student_rows(student_id)
          CROSS JOIN unnest(p_prompt_ids) AS prompt_rows(prompt_id)
        RETURNING id
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
      INTO v_created FROM inserted;

    v_receipt := jsonb_build_object(
        'created', v_created,
        'assignment_ids', (SELECT COALESCE(jsonb_agg(item->>'id'), '[]'::jsonb)
                             FROM jsonb_array_elements(v_created) AS item),
        'created_count', jsonb_array_length(v_created),
        'student_count', array_length(p_student_ids, 1),
        'group_id', v_group_id,
        'duplicates_warning', v_duplicates,
        'replayed', false
    );

    UPDATE writing_assignment_requests
       SET receipt = v_receipt, updated_at = now()
     WHERE id = p_request_id;
    RETURN v_receipt;
END;
$$;

-- Replace the latest mig-193 fan-out with the same signature and semantics,
-- changing only its roster source from students.cohort_id to active membership.
CREATE OR REPLACE FUNCTION fn_create_class_assignment(
    p_cohort_id      uuid,
    p_skill          text,
    p_title          text,
    p_lesson_id      uuid        DEFAULT NULL,
    p_content_config jsonb       DEFAULT '{}'::jsonb,
    p_content_id     uuid        DEFAULT NULL,
    p_instructions   text        DEFAULT NULL,
    p_due_at         timestamptz DEFAULT NULL,
    p_publish_at     timestamptz DEFAULT NULL,
    p_status         text        DEFAULT 'published',
    p_assigned_by    uuid        DEFAULT NULL,
    p_kind           text        DEFAULT 'daily',
    p_student_ids    uuid[]      DEFAULT NULL
)
RETURNS TABLE (
    assignment jsonb, student_count integer, unactivated_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_id uuid; v_ids uuid[]; v_total integer; v_unactive integer;
    v_row class_assignments%ROWTYPE;
BEGIN
    SELECT array_agg(t.id), count(*), count(*) FILTER (WHERE t.user_id IS NULL)
      INTO v_ids, v_total, v_unactive
      FROM (
        SELECT s.id, s.user_id
          FROM student_cohort_memberships m
          JOIN students s ON s.id = m.student_id
         WHERE m.cohort_id = p_cohort_id AND m.is_active
           AND (p_student_ids IS NULL OR s.id = ANY(p_student_ids))
         FOR UPDATE OF m, s
      ) t;

    IF v_total = 0 THEN
        RAISE EXCEPTION 'empty_roster'
            USING HINT = 'Không có học viên nào nhận bài này.';
    END IF;

    INSERT INTO class_assignments (
        cohort_id, lesson_id, skill, content_id, content_config, title,
        instructions, due_at, publish_at, status, assigned_by, kind,
        recipient_scope
    ) VALUES (
        p_cohort_id, p_lesson_id, p_skill, p_content_id,
        COALESCE(p_content_config, '{}'::jsonb), p_title, p_instructions,
        p_due_at, p_publish_at, COALESCE(p_status, 'published'), p_assigned_by,
        COALESCE(p_kind, 'daily'),
        CASE WHEN p_student_ids IS NULL THEN 'class' ELSE 'subset' END
    ) RETURNING * INTO v_row;

    v_id := v_row.id;
    INSERT INTO class_assignment_items (assignment_id, student_id)
    SELECT v_id, unnest(v_ids);

    assignment := to_jsonb(v_row);
    student_count := v_total;
    unactivated_count := v_unactive;
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION fn_backfill_assignment_items(
    p_assignment_id uuid,
    p_student_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (added integer, student_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cohort uuid; v_scope text; v_added integer; v_total integer;
BEGIN
    SELECT cohort_id, recipient_scope INTO v_cohort, v_scope
      FROM class_assignments WHERE id = p_assignment_id FOR UPDATE;
    IF v_cohort IS NULL THEN RAISE EXCEPTION 'assignment_not_found'; END IF;
    IF v_scope = 'subset' AND p_student_ids IS NULL THEN
        RAISE EXCEPTION 'subset_needs_explicit_students';
    END IF;

    WITH ins AS (
        INSERT INTO class_assignment_items (assignment_id, student_id)
        SELECT p_assignment_id, m.student_id
          FROM student_cohort_memberships m
         WHERE m.cohort_id = v_cohort AND m.is_active
           AND (p_student_ids IS NULL OR m.student_id = ANY(p_student_ids))
           AND NOT EXISTS (
               SELECT 1 FROM class_assignment_items i
                WHERE i.assignment_id = p_assignment_id
                  AND i.student_id = m.student_id)
        RETURNING 1
    ) SELECT count(*) INTO v_added FROM ins;

    SELECT count(*) INTO v_total
      FROM class_assignment_items WHERE assignment_id = p_assignment_id;
    added := v_added; student_count := v_total; RETURN NEXT;
END;
$$;

-- Keep the admin regrade cohort filter aligned with the same canonical roster.
CREATE OR REPLACE FUNCTION fn_list_writing_regrade_requests(
    p_status text DEFAULT NULL,
    p_cohort_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH ranked AS (
        SELECT r.*,
               row_number() OVER (
                   PARTITION BY r.status ORDER BY r.created_at DESC, r.id DESC
               ) AS lane_rank,
               count(*) OVER (PARTITION BY r.status) AS lane_total
          FROM essay_regrade_requests r
         WHERE (p_status IS NULL OR r.status = p_status)
           AND (p_cohort_id IS NULL OR EXISTS (
               SELECT 1 FROM student_cohort_memberships m
                WHERE m.student_id = r.student_id
                  AND m.cohort_id = p_cohort_id
                  AND m.is_active
           ))
    )
    SELECT jsonb_build_object(
        'requests', COALESCE(
            jsonb_agg(to_jsonb(ranked) - 'lane_rank' - 'lane_total'
                      ORDER BY created_at DESC, id DESC)
                FILTER (WHERE lane_rank <= 300),
            '[]'::jsonb
        ),
        'capped', COALESCE(bool_or(lane_total > 300), false)
    ) FROM ranked;
$$;

ALTER TABLE student_cohort_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE student_cohort_memberships FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE student_cohort_memberships TO service_role;

REVOKE EXECUTE ON FUNCTION fn_sync_legacy_student_cohort_membership()
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_add_student_cohort_membership(uuid, uuid, uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_add_students_cohort_membership(uuid[], uuid, uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_remove_student_cohort_membership(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_create_writing_assignments_idempotent(uuid, uuid, jsonb, uuid[], uuid[], text, boolean, timestamptz, text, boolean, integer, integer)
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_create_class_assignment(uuid, text, text, uuid, jsonb, uuid, text, timestamptz, timestamptz, text, uuid, text, uuid[])
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_backfill_assignment_items(uuid, uuid[])
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_list_writing_regrade_requests(text, uuid)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION fn_add_student_cohort_membership(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION fn_add_students_cohort_membership(uuid[], uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION fn_remove_student_cohort_membership(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION fn_create_writing_assignments_idempotent(uuid, uuid, jsonb, uuid[], uuid[], text, boolean, timestamptz, text, boolean, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION fn_create_class_assignment(uuid, text, text, uuid, jsonb, uuid, text, timestamptz, timestamptz, text, uuid, text, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION fn_backfill_assignment_items(uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION fn_list_writing_regrade_requests(text, uuid) TO service_role;

COMMIT;
