-- Migration: 326_student_archive.sql
--
-- STUDENTARCHIVE-0029 (specs/0029-student-archive). DELETE /admin/students/{id}
-- hard-deleted the roster row and, through ON DELETE CASCADE, every Writing
-- assignment, draft, essay, feedback and class item of the learner (and failed
-- with a 500 when grammar_diagnostic_sessions RESTRICT or the Advanced Vocab
-- evidence trigger blocked it). Replace it with an archive:
-- archived_at/by/reason on students, every active class membership ended (so no
-- class fan-out reaches the learner), optional account deactivation, and an
-- append-only audit row — all in one locked transaction. No learner evidence is
-- changed. Functions are service_role-only (320 left function EXECUTE defaults
-- open, so this migration revokes them explicitly).
-- The 227 membership writers are re-created with an archive guard so that no
-- later class add or legacy cohort_id write can reactivate a membership of an
-- archived learner.
--
-- T002a (read-only, staging zjphffoujxkpltixsbzj, 2026-10-27): the live bodies
-- of fn_add_student_cohort_membership, fn_add_students_cohort_membership,
-- fn_sync_legacy_student_cohort_membership and fn_remove_student_cohort_membership
-- equal 227; fn_create_class_assignment equals 269 and
-- fn_create_writing_assignments_idempotent equals 228 (whitespace aside). Class
-- fan-out (fn_create_class_assignment, fn_backfill_assignment_items) reads only
-- `is_active` memberships, so ending them is enough. The idempotent Writing RPC
-- checks memberships only for cohort gives; individual gives to an archived
-- learner are refused by the backend before the call. Live ACL of every 227
-- function: postgres + service_role EXECUTE only.
--
-- Order: apply before the backend that calls fn_archive_student. The pre-0029
-- admin student list validates rows with extra="forbid", so it rejects the new
-- columns: deploy the 0029 backend right after applying this file.
--
-- ROLLBACK (a new forward migration, never an edit of this file). Roll the
-- backend back first (specs/0029-student-archive/rollout.md); with archived
-- learners present a plain backend revert is not allowed. The schema rollback
-- is safe only with zero archived learners and an empty audit table:
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DO $$
--   BEGIN
--       IF EXISTS (SELECT 1 FROM public.students WHERE archived_at IS NOT NULL) THEN
--           RAISE EXCEPTION 'rollback_unsafe_archived_students_exist';
--       END IF;
--       IF EXISTS (SELECT 1 FROM public.student_lifecycle_audit) THEN
--           RAISE EXCEPTION 'rollback_unsafe_audit_rows_exist';
--       END IF;
--   END $$;
--   -- Re-create the unguarded 227 bodies of fn_sync_legacy_student_cohort_membership,
--   -- fn_add_student_cohort_membership and fn_add_students_cohort_membership
--   -- FIRST (verbatim from 227_student_cohort_memberships.sql; CREATE OR
--   -- REPLACE keeps the grants): the guarded bodies below read
--   -- students.archived_at and would fail once the column is dropped.
--   DROP FUNCTION IF EXISTS public.fn_restore_student(uuid, uuid, text, boolean, boolean);
--   DROP FUNCTION IF EXISTS public.fn_archive_student(uuid, uuid, text, boolean);
--   DROP TABLE IF EXISTS public.student_lifecycle_audit;
--   DROP INDEX IF EXISTS public.idx_students_archived_at;
--   ALTER TABLE public.students DROP CONSTRAINT IF EXISTS chk_students_archive_fields;
--   ALTER TABLE public.students
--       DROP COLUMN IF EXISTS archive_reason,
--       DROP COLUMN IF EXISTS archived_by,
--       DROP COLUMN IF EXISTS archived_at;
--   COMMIT;
-- With archived learners, restore each with fn_restore_student (or get Vinh's
-- decision) first; dropping the columns would re-list them and lose the audit.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 0. Preconditions (abort if unsafe)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'students'
                  AND ((column_name = 'archived_at'    AND data_type <> 'timestamp with time zone')
                    OR (column_name = 'archived_by'    AND data_type <> 'uuid')
                    OR (column_name = 'archive_reason' AND data_type <> 'text'))) THEN
        RAISE EXCEPTION 'students_archive_columns_conflict';
    END IF;
    IF to_regclass('public.student_lifecycle_audit') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'student_lifecycle_audit'
                          AND column_name = 'detail') THEN
        RAISE EXCEPTION 'student_lifecycle_audit_conflict';
    END IF;
    -- Account deactivation relies on 320 keeping is_active server-owned.
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.users'::regclass
                      AND tgname = 'trg_users_guard_privileged_columns' AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'migration_320_guard_missing';
    END IF;
END $$;

-- 1. Archive state on the roster row
ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS archived_at    timestamptz,
    ADD COLUMN IF NOT EXISTS archived_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS archive_reason text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.students'::regclass
                      AND conname = 'chk_students_archive_fields') THEN
        ALTER TABLE public.students ADD CONSTRAINT chk_students_archive_fields
            CHECK (archived_at IS NOT NULL OR (archived_by IS NULL AND archive_reason IS NULL));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_students_archived_at
    ON public.students (archived_at) WHERE archived_at IS NOT NULL;

COMMENT ON COLUMN public.students.archived_at IS
    'STUDENTARCHIVE-0029: NULL = active. Set only by fn_archive_student (service_role).';

-- 2. Append-only audit (no FK to students so it survives a later purge)
CREATE TABLE IF NOT EXISTS public.student_lifecycle_audit (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id    uuid NOT NULL,
    user_id       uuid,
    action        text NOT NULL CHECK (action IN ('archive', 'restore')),
    actor_user_id uuid NOT NULL,
    reason        text,
    detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_student_lifecycle_audit_student
    ON public.student_lifecycle_audit (student_id, created_at DESC);
ALTER TABLE public.student_lifecycle_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_lifecycle_audit FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.student_lifecycle_audit FROM service_role;
GRANT SELECT, INSERT ON public.student_lifecycle_audit TO service_role;

-- 3. Archive
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

-- 4. Restore
CREATE OR REPLACE FUNCTION public.fn_restore_student(
    p_student_id         uuid,
    p_actor              uuid,
    p_reason             text DEFAULT NULL,
    p_restore_cohorts    boolean DEFAULT true,
    p_reactivate_account boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_s        public.students%ROWTYPE;
    v_detail   jsonb;
    v_cohorts  uuid[] := '{}';
    v_restored uuid[] := '{}';
    v_primary  uuid;
    v_reactivated boolean := false;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'restore_actor_required';
    END IF;
    SELECT * INTO v_s FROM public.students WHERE id = p_student_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF v_s.archived_at IS NULL THEN
        RETURN jsonb_build_object('status', 'not_archived');
    END IF;

    SELECT detail INTO v_detail FROM public.student_lifecycle_audit
     WHERE student_id = p_student_id AND action = 'archive'
     ORDER BY created_at DESC LIMIT 1;

    IF p_restore_cohorts AND v_detail ? 'ended_cohort_ids' THEN
        SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_cohorts
          FROM jsonb_array_elements_text(v_detail -> 'ended_cohort_ids') AS x;
        WITH back AS (
            UPDATE public.student_cohort_memberships m
               SET is_active = true, left_at = NULL, updated_at = now()
             WHERE m.student_id = p_student_id AND m.cohort_id = ANY (v_cohorts)
               AND NOT m.is_active
               AND EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = m.cohort_id)
            RETURNING m.cohort_id
        )
        SELECT COALESCE(array_agg(cohort_id), '{}') INTO v_restored FROM back;
        v_primary := CASE
            WHEN (v_detail ->> 'previous_cohort_id')::uuid = ANY (v_restored)
                THEN (v_detail ->> 'previous_cohort_id')::uuid
            ELSE v_restored[1] END;
    END IF;

    UPDATE public.students
       SET archived_at = NULL, archived_by = NULL, archive_reason = NULL,
           cohort_id = COALESCE(v_primary, cohort_id)
     WHERE id = p_student_id;

    IF p_reactivate_account AND v_s.user_id IS NOT NULL THEN
        UPDATE public.users SET is_active = true WHERE id = v_s.user_id AND NOT is_active;
        v_reactivated := FOUND;
    END IF;

    INSERT INTO public.student_lifecycle_audit
        (student_id, user_id, action, actor_user_id, reason, detail)
    VALUES (p_student_id, v_s.user_id, 'restore', p_actor, p_reason,
            jsonb_build_object('restored_cohort_ids', to_jsonb(v_restored),
                               'account_reactivated', v_reactivated));

    RETURN jsonb_build_object('status', 'restored', 'restored_cohort_ids', to_jsonb(v_restored),
                              'account_reactivated', v_reactivated);
END;
$$;

-- 4b. Archive guards on the 227 membership writers (FR-002). Ending memberships
-- at archive time is not enough: fn_add_student(s)_cohort_membership (cohorts.py
-- single/bulk add, admin.py direct-code bridge) and the legacy cohort_id trigger
-- (/auth/activate fold, rolling backends) would otherwise reactivate a class
-- membership and let fan-out reach an archived learner. Bodies are the live
-- (= 227) bodies plus the guard; signatures, SECURITY DEFINER, search_path and
-- the 227 grants are unchanged (CREATE OR REPLACE keeps the ACL). The student
-- row lock conflicts with fn_archive_student's FOR UPDATE, so an add either
-- commits before the archive (and the archive then ends that membership) or
-- sees archived_at and refuses.
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

-- The trigger fires inside the UPDATE that already holds the row lock.
-- fn_archive_student writes cohort_id = NULL and fn_restore_student clears
-- archived_at in the same UPDATE, so neither trips the guard.
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

REVOKE ALL ON FUNCTION public.fn_archive_student(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_restore_student(uuid, uuid, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_archive_student(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_restore_student(uuid, uuid, text, boolean, boolean) TO service_role;

-- 5. Postconditions
DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'students'
           AND column_name IN ('archived_at', 'archived_by', 'archive_reason')) <> 3 THEN
        RAISE EXCEPTION 'students_archive_columns_missing';
    END IF;
    IF has_function_privilege('anon', 'public.fn_archive_student(uuid,uuid,text,boolean)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_archive_student(uuid,uuid,text,boolean)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_restore_student(uuid,uuid,text,boolean,boolean)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_restore_student(uuid,uuid,text,boolean,boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'student_archive_functions_client_executable';
    END IF;
    IF has_table_privilege('anon', 'public.student_lifecycle_audit', 'SELECT')
       OR has_table_privilege('authenticated', 'public.student_lifecycle_audit', 'SELECT')
       OR has_table_privilege('authenticated', 'public.student_lifecycle_audit', 'INSERT')
       OR has_table_privilege('service_role', 'public.student_lifecycle_audit', 'UPDATE')
       OR has_table_privilege('service_role', 'public.student_lifecycle_audit', 'DELETE')
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.student_lifecycle_audit'::regclass) THEN
        RAISE EXCEPTION 'student_lifecycle_audit_privileges_wrong';
    END IF;
    IF has_function_privilege('authenticated', 'public.fn_add_student_cohort_membership(uuid,uuid,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_add_students_cohort_membership(uuid[],uuid,uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_add_student_cohort_membership(uuid,uuid,uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.fn_add_students_cohort_membership(uuid[],uuid,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'membership_functions_client_executable';   -- 227 grants kept
    END IF;
    IF NOT has_function_privilege('service_role', 'public.fn_add_student_cohort_membership(uuid,uuid,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.fn_add_students_cohort_membership(uuid[],uuid,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'membership_functions_service_grant_missing';   -- 227 grants kept
    END IF;
    IF has_table_privilege('authenticated', 'public.students', 'UPDATE') THEN
        RAISE EXCEPTION 'students_client_update_privilege';   -- 320 invariant
    END IF;
END $$;

COMMIT;
