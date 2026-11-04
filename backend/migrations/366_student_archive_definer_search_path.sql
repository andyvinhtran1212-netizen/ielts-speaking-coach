-- Migration: 366_student_archive_definer_search_path.sql
--
-- PC-J611 (Security Auditor SA-2209, residual P2; STUDENTARCHIVE-0029 FR-002
-- and FR-004, GIVEARCHIVE-0031). 364 is held by PC-J544 and 365 by PC-J603
-- (#2238), so this takes 366. 326 and 331 are never edited: this forward file
-- pins the search_path of their SECURITY DEFINER functions, the way 363 and
-- 365 pinned the staff-security chain.
--
--   SA-2209  These five definers run as their owner with
--         search_path = public, pg_temp. A role with CREATE on public
--         (service_role before 357) can add an exact typed overload, for
--         example public.to_jsonb(uuid[]) or an array_agg(uuid) aggregate,
--         that beats the catalog's polymorphic version and runs as the owner:
--           fn_archive_student                 RPC, EXECUTE for service_role
--                                              (jsonb_build_object, to_jsonb,
--                                              array_agg, now).
--           fn_add_student_cohort_membership,  RPCs, EXECUTE for service_role;
--           fn_add_students_cohort_membership  unqualified students, cohorts,
--                                              student_cohort_memberships and
--                                              now, array_agg, unnest, count.
--           fn_sync_legacy_student_cohort_membership
--                                              trigger on students (now,
--                                              student_cohort_memberships).
--           fn_guard_writing_assignment_student_archived
--                                              trigger on writing_assignments;
--                                              calls no function and reads only
--                                              public.students.
--
-- Four functions are recreated with their 326 bodies (equal to the live
-- staging bodies, read-only check 2026-11-04), unchanged except for
-- SET search_path = pg_catalog, pg_temp, pg_catalog.<fn> for every catalog
-- function they call and public.<table> for every table they name. With
-- public off the path an unqualified table would resolve to pg_temp, so every
-- table is qualified. fn_guard_writing_assignment_student_archived already
-- names public.students and calls no function, so its body stays as 331 wrote
-- it and only ALTER FUNCTION ... SET search_path changes it. Operators need no
-- qualification: with public off the path no schema but pg_catalog can supply
-- one. Owner, SECURITY DEFINER and the ACLs stay as they are: CREATE OR
-- REPLACE and ALTER keep them, and this file grants and revokes nothing
-- (service_role keeps EXECUTE on the three RPCs). The DO blocks run under the
-- same pinned path and also qualify every function and operator.
--
-- Not in this file (other definers with search_path = public[, pg_temp], see
-- SA-2209): the 333, 337, 339 and 340 groups (fn_restore_student is 337's)
-- and the older definers. They need their own ticket, review and migration.
--
-- Order and compatibility. Needs 326, 331 and 365 in public._schema_migrations
-- (`migration_366_prerequisite_missing: no ledger row`), the 326/331 objects
-- (`...: objects`), and no function or operator in public named like one the
-- file or the bodies use (`catalog_name_shadowed_in_public`): a shadow already
-- planted is an incident to remove before this runs. 331's precondition still
-- finds `students WHERE id = p_student_id FOR UPDATE` in fn_archive_student.
-- On staging 366 runs on top of the applied 363 and 365; on production after
-- 365 at the same promotion. Held by forward-policy.tsv as
-- pending_feature admin_aal2, the group of 363 and 365: apply only with
-- MIGRATION_FEATURES=admin_aal2 through the advisory-locked runner, staging
-- first after SA review, production only at an explicitly authorised
-- staging -> main promotion after 365. No backend change. One transaction,
-- lock_timeout 5s, re-runnable (a second run changes nothing), runs as the
-- NOSUPERUSER owner, no business data read or written.
-- Re-running 326 or 331 after 366 restores search_path = public on the
-- functions it replaces: re-run 366 after it.
--
-- ROLLBACK: backend/migrations/rollback/366_student_archive_definer_search_path.sql
-- restores the 326 bodies verbatim and the 331 path of the guard, reopens
-- SA-2209 for these five functions and grants nothing. It refuses to run while
-- public holds a shadow of a name those bodies call.

BEGIN;

SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';

-- 0. Preconditions: 326, 331 and 365 are recorded; the five functions, their
-- tables and students.archived_at exist; nothing in public shadows a catalog
-- name this file or the bodies use. The postcondition checks the triggers.
DO $$
DECLARE
    catalog_functions CONSTANT text[] := ARRAY[
        'aclexplode', 'array_agg', 'array_to_string', 'count', 'has_function_privilege', 'jsonb_build_object',
        'now', 'string_agg', 'to_jsonb', 'to_regclass', 'to_regprocedure', 'unnest'];
    catalog_operators CONSTANT text[] := ARRAY['=', '<>', '~', '~*', '||'];
    v_wrong text;
BEGIN
    -- Two statements: PL/pgSQL plans a whole condition, so the ledger
    -- query must not be parsed when the table is missing.
    IF pg_catalog.to_regclass('public._schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'migration_366_prerequisite_missing: no ledger row';
    END IF;
    IF (SELECT pg_catalog.count(*) FROM public._schema_migrations m
         WHERE m.filename OPERATOR(pg_catalog.=) ANY (ARRAY[
               '326_student_archive.sql',
               '331_writing_assignment_archived_student_guard.sql',
               '365_staff_security_chain_search_path.sql']))
       OPERATOR(pg_catalog.<>) 3 THEN
        RAISE EXCEPTION 'migration_366_prerequisite_missing: no ledger row';
    END IF;
    IF pg_catalog.to_regclass('public.students') IS NULL
       OR pg_catalog.to_regclass('public.cohorts') IS NULL
       OR pg_catalog.to_regclass('public.student_cohort_memberships') IS NULL
       OR pg_catalog.to_regclass('public.student_lifecycle_audit') IS NULL
       OR pg_catalog.to_regclass('public.users') IS NULL
       OR pg_catalog.to_regclass('public.writing_assignments') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_archive_student(uuid,uuid,text,boolean)') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_add_student_cohort_membership(uuid,uuid,uuid)') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_add_students_cohort_membership(uuid[],uuid,uuid)') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_sync_legacy_student_cohort_membership()') IS NULL
       OR pg_catalog.to_regprocedure('public.fn_guard_writing_assignment_student_archived()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                       WHERE a.attrelid OPERATOR(pg_catalog.=) 'public.students'::regclass
                         AND a.attname OPERATOR(pg_catalog.=) 'archived_at' AND NOT a.attisdropped) THEN
        RAISE EXCEPTION 'migration_366_prerequisite_missing: objects';
    END IF;
    SELECT pg_catalog.string_agg(k.kind OPERATOR(pg_catalog.||) ' ' OPERATOR(pg_catalog.||) k.name, ', '
                                 ORDER BY k.kind, k.name) INTO v_wrong
      FROM (SELECT 'function'::text, p.proname::text FROM pg_catalog.pg_proc p
             WHERE p.pronamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
               AND p.proname::text OPERATOR(pg_catalog.=) ANY (catalog_functions)
            UNION
            SELECT 'operator'::text, o.oprname::text FROM pg_catalog.pg_operator o
             WHERE o.oprnamespace OPERATOR(pg_catalog.=) 'public'::regnamespace
               AND o.oprname::text OPERATOR(pg_catalog.=) ANY (catalog_operators)) k(kind, name);
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'catalog_name_shadowed_in_public: %', v_wrong;
    END IF;
END $$;

-- 1. 326 section 3: archive RPC (service_role).
CREATE OR REPLACE FUNCTION public.fn_archive_student(
    p_student_id         uuid,
    p_actor              uuid,
    p_reason             text DEFAULT NULL,
    p_deactivate_account boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
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
        RETURN pg_catalog.jsonb_build_object('status', 'already_archived', 'archived_at', v_s.archived_at);
    END IF;

    -- Same effect as fn_remove_student_cohort_membership (227), for every class.
    WITH ended AS (
        UPDATE public.student_cohort_memberships
           SET is_active = false, left_at = pg_catalog.now(), updated_at = pg_catalog.now()
         WHERE student_id = p_student_id AND is_active
        RETURNING cohort_id
    )
    SELECT COALESCE(pg_catalog.array_agg(cohort_id), '{}') INTO v_cohorts FROM ended;

    UPDATE public.students
       SET archived_at = pg_catalog.now(), archived_by = p_actor, archive_reason = p_reason,
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
            pg_catalog.jsonb_build_object('ended_cohort_ids', pg_catalog.to_jsonb(v_cohorts),
                                          'previous_cohort_id', v_s.cohort_id,
                                          'instructor_id', v_s.instructor_id,
                                          'account_deactivated', v_deactivated));

    RETURN pg_catalog.jsonb_build_object('status', 'archived', 'ended_cohort_ids', pg_catalog.to_jsonb(v_cohorts),
                                         'account_deactivated', v_deactivated);
END;
$$;

-- 2. 326 section 4b: single add RPC (service_role).
CREATE OR REPLACE FUNCTION public.fn_add_student_cohort_membership(
    p_student_id uuid,
    p_cohort_id  uuid,
    p_added_by   uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_archived_at timestamptz;
BEGIN
    SELECT archived_at INTO v_archived_at
      FROM public.students WHERE id = p_student_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'student_not_found';
    END IF;
    IF v_archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'student_archived';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cohorts WHERE id = p_cohort_id) THEN
        RAISE EXCEPTION 'cohort_not_found';
    END IF;

    INSERT INTO public.student_cohort_memberships (
        student_id, cohort_id, is_active, left_at, added_by, updated_at
    ) VALUES (p_student_id, p_cohort_id, true, NULL, p_added_by, pg_catalog.now())
    ON CONFLICT (student_id, cohort_id) DO UPDATE
          SET is_active = true,
              left_at = NULL,
              added_by = COALESCE(EXCLUDED.added_by,
                                  student_cohort_memberships.added_by),
              updated_at = pg_catalog.now();

    -- Preserve an existing primary pointer. It is compatibility metadata, not
    -- the canonical roster and must never turn an additive action into a move.
    UPDATE public.students
       SET cohort_id = COALESCE(cohort_id, p_cohort_id)
     WHERE id = p_student_id;
    RETURN true;
END;
$$;

-- 3. 326 section 4b: bulk add RPC (service_role).
CREATE OR REPLACE FUNCTION public.fn_add_students_cohort_membership(
    p_student_ids uuid[],
    p_cohort_id   uuid,
    p_added_by    uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_count    integer;
    v_archived uuid[];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.cohorts WHERE id = p_cohort_id) THEN
        RAISE EXCEPTION 'cohort_not_found';
    END IF;

    -- Lock in id order (no deadlock between bulk calls), then refuse the whole
    -- batch if any requested learner is archived: no partial add.
    PERFORM 1 FROM public.students
      WHERE id = ANY (COALESCE(p_student_ids, '{}'::uuid[]))
      ORDER BY id FOR NO KEY UPDATE;
    SELECT pg_catalog.array_agg(id ORDER BY id) INTO v_archived
      FROM public.students
     WHERE id = ANY (COALESCE(p_student_ids, '{}'::uuid[]))
       AND archived_at IS NOT NULL;
    IF v_archived IS NOT NULL THEN
        RAISE EXCEPTION 'student_archived'
            USING DETAIL = pg_catalog.array_to_string(v_archived, ',');
    END IF;

    WITH wanted AS (
        SELECT DISTINCT pg_catalog.unnest(COALESCE(p_student_ids, '{}'::uuid[])) AS id
    ), valid AS (
        SELECT s.id, EXISTS (
            SELECT 1 FROM public.student_cohort_memberships current
             WHERE current.student_id = s.id
               AND current.cohort_id = p_cohort_id AND current.is_active
        ) AS was_active
          FROM public.students s JOIN wanted w ON w.id = s.id
    ), upserted AS (
        INSERT INTO public.student_cohort_memberships (
            student_id, cohort_id, is_active, left_at, added_by, updated_at
        )
        SELECT id, p_cohort_id, true, NULL, p_added_by, pg_catalog.now() FROM valid
        ON CONFLICT (student_id, cohort_id) DO UPDATE
              SET is_active = true,
                  left_at = NULL,
                  added_by = COALESCE(EXCLUDED.added_by,
                                      student_cohort_memberships.added_by),
                  updated_at = pg_catalog.now()
        RETURNING student_id
    )
    SELECT pg_catalog.count(*) FILTER (WHERE NOT was_active) INTO v_count FROM valid;

    UPDATE public.students s
       SET cohort_id = p_cohort_id
     WHERE s.cohort_id IS NULL
       AND s.id = ANY(COALESCE(p_student_ids, '{}'::uuid[]));
    RETURN v_count;
END;
$$;

-- 4. 326 section 4b: legacy cohort_id trigger on students.
CREATE OR REPLACE FUNCTION public.fn_sync_legacy_student_cohort_membership()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.cohort_id IS NOT NULL THEN
        IF NEW.archived_at IS NOT NULL THEN
            RAISE EXCEPTION 'student_archived';
        END IF;
        INSERT INTO public.student_cohort_memberships (
            student_id, cohort_id, is_active, left_at, updated_at
        ) VALUES (NEW.id, NEW.cohort_id, true, NULL, pg_catalog.now())
        ON CONFLICT (student_id, cohort_id) DO UPDATE
              SET is_active = true, left_at = NULL, updated_at = pg_catalog.now();
    END IF;
    RETURN NEW;
END;
$$;

-- 5. 331 section 1: the give guard calls no function and names only
-- public.students; only its path changes.
ALTER FUNCTION public.fn_guard_writing_assignment_student_archived() SET search_path = pg_catalog, pg_temp;

-- 6. Postconditions: fail the release instead of leaving a silent hole.
DO $$
DECLARE
    v_wrong text;
BEGIN
    -- Exactly the pinned path, no unqualified catalog call or table left in a
    -- body, SECURITY DEFINER, the owner of the table each writes or guards, no
    -- EXECUTE for PUBLIC (grantee 0) or a client role, and service_role
    -- EXECUTE on the three RPCs the backend calls.
    SELECT pg_catalog.string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.fn_archive_student(uuid,uuid,text,boolean)', true, 'public.students'),
                   ('public.fn_add_student_cohort_membership(uuid,uuid,uuid)', true,
                    'public.student_cohort_memberships'),
                   ('public.fn_add_students_cohort_membership(uuid[],uuid,uuid)', true,
                    'public.student_cohort_memberships'),
                   ('public.fn_sync_legacy_student_cohort_membership()', false,
                    'public.student_cohort_memberships'),
                   ('public.fn_guard_writing_assignment_student_archived()', false, 'public.students')
           ) f(sig, service_exec, tbl)
      JOIN pg_catalog.pg_proc p ON p.oid OPERATOR(pg_catalog.=) f.sig::regprocedure
      JOIN pg_catalog.pg_class c ON c.oid OPERATOR(pg_catalog.=) f.tbl::regclass
     WHERE NOT p.prosecdef
        OR p.proconfig IS NULL
        OR pg_catalog.array_to_string(p.proconfig, '|') OPERATOR(pg_catalog.<>) 'search_path=pg_catalog, pg_temp'
        OR p.prosrc OPERATOR(pg_catalog.~)
           '(^|[^.[:alnum:]_])(array_agg|array_to_string|count|jsonb_build_object|now|to_jsonb|unnest)\s*\('
        OR p.prosrc OPERATOR(pg_catalog.~*)
           '(from|join|into|update)\s+(students|cohorts|student_cohort_memberships|student_lifecycle_audit|users|writing_assignments)([^.[:alnum:]_]|$)'
        OR p.proowner OPERATOR(pg_catalog.<>) c.relowner
        OR p.proacl IS NULL   -- NULL = default ACL, which includes PUBLIC EXECUTE
        OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
                    WHERE a.grantee OPERATOR(pg_catalog.=) 0::oid)
        OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR (f.service_exec AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'student_archive_search_path_wrong: %', v_wrong;
    END IF;

    -- The two triggers are on and call the functions above.
    SELECT pg_catalog.string_agg(t.name, ', ' ORDER BY t.name) INTO v_wrong
      FROM (VALUES ('public.students', 'trg_sync_legacy_student_cohort_membership',
                    'public.fn_sync_legacy_student_cohort_membership()'),
                   ('public.writing_assignments', 'archive_guard_writing_assignment_student',
                    'public.fn_guard_writing_assignment_student_archived()')
           ) t(tbl, name, fn)
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g
                        WHERE g.tgrelid OPERATOR(pg_catalog.=) t.tbl::regclass
                          AND g.tgname OPERATOR(pg_catalog.=) t.name
                          AND g.tgfoid OPERATOR(pg_catalog.=) t.fn::regprocedure
                          AND g.tgenabled OPERATOR(pg_catalog.<>) 'D'
                          AND g.tgenabled OPERATOR(pg_catalog.<>) 'R');
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'student_archive_trigger_missing: %', v_wrong;
    END IF;
END $$;

COMMIT;
