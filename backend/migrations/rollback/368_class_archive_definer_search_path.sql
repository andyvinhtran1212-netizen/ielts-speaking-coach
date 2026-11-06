-- Rollback: 368_class_archive_definer_search_path.sql
-- PC-J619 / SA-2209: restores the exact five 337 bodies and the four guard
-- paths. This REOPENS the public-search_path owner-execution risk.
-- Guarded repair only: needs 337 (+365), refuses planted public shadows and
-- unexpected body drift, preserves owner/ACL/SECURITY DEFINER by catalog diff.
-- Run before any rollback of 337. No data, trigger, grant or owner change.
-- Staging first after SA review under the advisory lock; production only at
-- an explicitly authorised staging -> main promotion. No apply on merge.

BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
    catalog_functions CONSTANT text[] := ARRAY['aclexplode', 'array_agg', 'array_to_string', 'btrim', 'char_length', 'count', 'has_function_privilege', 'jsonb_array_elements_text', 'jsonb_build_object', 'md5', 'now', 'string_agg', 'to_jsonb', 'to_regclass', 'to_regprocedure'];
    catalog_operators CONSTANT text[] := ARRAY['=', '<>', '~', '~*', '||', '?', '->', '->>'];
    v_wrong text;
BEGIN
    IF pg_catalog.to_regclass('public._schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'migration_368_prerequisite_missing: no ledger row';
    END IF;
    IF (SELECT pg_catalog.count(*) FROM public._schema_migrations m
         WHERE m.filename OPERATOR(pg_catalog.=) ANY (ARRAY[
             '337_class_archive_enforcement.sql', '365_staff_security_chain_search_path.sql']))
       OPERATOR(pg_catalog.<>) 2 THEN
        RAISE EXCEPTION 'migration_368_prerequisite_missing: no ledger row';
    END IF;
    IF pg_catalog.to_regclass('public.cohorts') IS NULL
       OR pg_catalog.to_regclass('public.class_lifecycle_audit') IS NULL
       OR pg_catalog.to_regclass('public.students') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                       WHERE a.attrelid OPERATOR(pg_catalog.=) 'public.cohorts'::regclass
                         AND a.attname OPERATOR(pg_catalog.=) 'archived_at' AND NOT a.attisdropped)
       OR EXISTS (SELECT 1 FROM (VALUES ('public.fn_cohorts_archive_metadata()'), ('public.fn_cohort_archive_counts(uuid)'), ('public.fn_archive_cohort(uuid,uuid,text)'), ('public.fn_restore_cohort(uuid,uuid,text)'), ('public.fn_guard_membership_cohort_active()'), ('public.fn_guard_class_assignment_cohort_active()'), ('public.fn_guard_class_item_cohort_active()'), ('public.fn_guard_writing_give_cohort_active()'), ('public.fn_restore_student(uuid,uuid,text,boolean,boolean)')) f(sig)
                   WHERE pg_catalog.to_regprocedure(f.sig) IS NULL) THEN
        RAISE EXCEPTION 'migration_368_prerequisite_missing: objects';
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
    -- Fail rather than overwrite an unexpected later implementation. Accept
    -- only the 337 source or this file's catalog-qualified equivalent.
    SELECT pg_catalog.string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.fn_cohorts_archive_metadata()', 'd2323a3ae453ee137f830fd82242c5c1', '87bce806d1a6ef757e2a70efcc304aa2', 'cohorts', false),
                   ('public.fn_cohort_archive_counts(uuid)', '86024f100c55d10b9ebf68c5ba923e9a', '124c8ab7f2943e1aa30ce282ad4f2c73', 'cohorts', true),
                   ('public.fn_archive_cohort(uuid,uuid,text)', '7f16895ff6a9401aa0f6e9b065b81760', 'f1eb4ed909fbdbdf3036fbb21fc07995', 'cohorts', true),
                   ('public.fn_restore_cohort(uuid,uuid,text)', '76c8014ba28b71f8ffa5202485216823', '8b9e00f58f28258437f161eafcf45ae5', 'cohorts', true),
                   ('public.fn_guard_membership_cohort_active()', 'dcfed4cf3a7025fa4a42e8af4911fb48', 'dcfed4cf3a7025fa4a42e8af4911fb48', 'cohorts', false),
                   ('public.fn_guard_class_assignment_cohort_active()', '8f42ab4ed2faac3afef195beafdfedb4', '8f42ab4ed2faac3afef195beafdfedb4', 'cohorts', false),
                   ('public.fn_guard_class_item_cohort_active()', '0de6ad136253520a9e5f0d2e9157b3d0', '0de6ad136253520a9e5f0d2e9157b3d0', 'cohorts', false),
                   ('public.fn_guard_writing_give_cohort_active()', '9c4f989e4ff1d60a7ae4ba544f44f5f9', '9c4f989e4ff1d60a7ae4ba544f44f5f9', 'cohorts', false),
                   ('public.fn_restore_student(uuid,uuid,text,boolean,boolean)', 'a64182f42ee1250bc6f99799190d1652', '86e01fb611a802d3022d4656c31c50e6', 'students', true)) f(sig, old_hash, new_hash, tbl, service_exec)
      JOIN pg_catalog.pg_proc p ON p.oid OPERATOR(pg_catalog.=) f.sig::regprocedure
     WHERE pg_catalog.md5(p.prosrc) OPERATOR(pg_catalog.<>) f.old_hash
       AND pg_catalog.md5(p.prosrc) OPERATOR(pg_catalog.<>) f.new_hash;
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'class_archive_source_drift: %', v_wrong;
    END IF;
END $$;

-- Catalog only: no learner/class data is copied or changed.
CREATE TEMP TABLE m368_function_identity ON COMMIT DROP AS
SELECT p.oid, p.proowner, p.proacl, p.prosecdef
  FROM pg_catalog.pg_proc p
 WHERE p.oid OPERATOR(pg_catalog.=) ANY (ARRAY[
               'public.fn_cohorts_archive_metadata()',
               'public.fn_cohort_archive_counts(uuid)',
               'public.fn_archive_cohort(uuid,uuid,text)',
               'public.fn_restore_cohort(uuid,uuid,text)',
               'public.fn_guard_membership_cohort_active()',
               'public.fn_guard_class_assignment_cohort_active()',
               'public.fn_guard_class_item_cohort_active()',
               'public.fn_guard_writing_give_cohort_active()',
               'public.fn_restore_student(uuid,uuid,text,boolean,boolean)']::regprocedure[]);

CREATE OR REPLACE FUNCTION public.fn_cohorts_archive_metadata()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.is_active THEN
        NEW.archived_at := NULL;
    ELSIF TG_OP = 'INSERT' OR OLD.is_active THEN
        NEW.archived_at := COALESCE(NEW.archived_at, now());           -- every new archive is enforced
    ELSE
        NEW.archived_at := COALESCE(NEW.archived_at, OLD.archived_at);  -- cannot un-enforce
    END IF;
    IF NEW.archived_at IS NULL THEN
        NEW.archived_by := NULL;
        NEW.archive_reason := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cohort_archive_counts(p_cohort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.cohorts WHERE id = p_cohort_id) THEN
        RETURN NULL;                                   -- caller 404s
    END IF;
    RETURN jsonb_build_object(
        'active_members',
            (SELECT count(*) FROM public.student_cohort_memberships m
              WHERE m.cohort_id = p_cohort_id AND m.is_active),
        'open_writing_gives',
            (SELECT count(*) FROM public.writing_assignments w
              WHERE w.cohort_id = p_cohort_id AND w.status IN ('pending', 'in_progress')),
        'open_class_items',
            (SELECT count(*) FROM public.class_assignment_items i
               JOIN public.class_assignments a ON a.id = i.assignment_id
              WHERE a.cohort_id = p_cohort_id AND a.status <> 'archived'
                AND i.state IN ('assigned', 'opened')),
        'unused_class_codes',
            (SELECT count(*) FROM public.access_codes c
              WHERE c.cohort_id = p_cohort_id AND c.is_active
                AND NOT COALESCE(c.is_used, false) AND NOT COALESCE(c.is_revoked, false)));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_archive_cohort(
    p_cohort_id uuid,
    p_actor     uuid,
    p_reason    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_c      public.cohorts%ROWTYPE;
    v_reason text := NULLIF(btrim(p_reason), '');
    v_legacy boolean;
    v_counts jsonb;
    v_at     timestamptz;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'archive_actor_required';
    END IF;
    IF char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'archive_reason_too_long' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_c FROM public.cohorts WHERE id = p_cohort_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;                                   -- caller 404s
    END IF;
    IF NOT v_c.is_active AND v_c.archived_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'already_archived', 'archived_at', v_c.archived_at);
    END IF;

    v_legacy := NOT v_c.is_active;                     -- "Áp dụng lưu trữ" on a legacy class
    v_counts := public.fn_cohort_archive_counts(p_cohort_id);

    UPDATE public.cohorts
       SET is_active = false, archived_at = now(), archived_by = p_actor,
           archive_reason = v_reason, updated_at = now()
     WHERE id = p_cohort_id
    RETURNING archived_at INTO v_at;

    INSERT INTO public.class_lifecycle_audit (cohort_id, action, actor_user_id, reason, detail)
    VALUES (p_cohort_id, 'archive', p_actor, v_reason,
            v_counts || jsonb_build_object('legacy_upgrade', v_legacy));

    RETURN jsonb_build_object('status', 'archived', 'archived_at', v_at,
                              'counts', v_counts, 'legacy_upgrade', v_legacy);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_restore_cohort(
    p_cohort_id uuid,
    p_actor     uuid,
    p_reason    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_c          public.cohorts%ROWTYPE;
    v_reason     text := NULLIF(btrim(p_reason), '');
    v_was_legacy boolean;
    v_counts     jsonb;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'restore_actor_required';
    END IF;
    IF char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'archive_reason_too_long' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_c FROM public.cohorts WHERE id = p_cohort_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF v_c.is_active THEN
        RETURN jsonb_build_object('status', 'not_archived');
    END IF;

    v_was_legacy := v_c.archived_at IS NULL;
    v_counts := public.fn_cohort_archive_counts(p_cohort_id);

    -- The metadata trigger clears archived_at/by/reason.
    UPDATE public.cohorts SET is_active = true, updated_at = now() WHERE id = p_cohort_id;

    INSERT INTO public.class_lifecycle_audit (cohort_id, action, actor_user_id, reason, detail)
    VALUES (p_cohort_id, 'restore', p_actor, v_reason,
            v_counts || jsonb_build_object('was_legacy', v_was_legacy,
                                           'previous_archived_at', v_c.archived_at,
                                           'previous_archived_by', v_c.archived_by,
                                           'previous_archive_reason', v_c.archive_reason));

    RETURN jsonb_build_object('status', 'restored', 'counts', v_counts, 'was_legacy', v_was_legacy);
END;
$$;

ALTER FUNCTION public.fn_guard_membership_cohort_active() SET search_path = public, pg_temp;

ALTER FUNCTION public.fn_guard_class_assignment_cohort_active() SET search_path = public, pg_temp;

ALTER FUNCTION public.fn_guard_class_item_cohort_active() SET search_path = public, pg_temp;

ALTER FUNCTION public.fn_guard_writing_give_cohort_active() SET search_path = public, pg_temp;

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
    v_skipped  uuid[] := '{}';
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
        PERFORM 1 FROM public.cohorts c WHERE c.id = ANY (v_cohorts)
         ORDER BY c.id FOR SHARE;
        SELECT COALESCE(array_agg(c.id ORDER BY c.id), '{}') INTO v_skipped
          FROM public.cohorts c
         WHERE c.id = ANY (v_cohorts) AND NOT c.is_active AND c.archived_at IS NOT NULL;
        WITH back AS (
            UPDATE public.student_cohort_memberships m
               SET is_active = true, left_at = NULL, updated_at = now()
             WHERE m.student_id = p_student_id AND m.cohort_id = ANY (v_cohorts)
               AND NOT m.is_active
               AND EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = m.cohort_id
                              AND (c.is_active OR c.archived_at IS NULL))
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
                               'skipped_archived_cohort_ids', to_jsonb(v_skipped),
                               'account_reactivated', v_reactivated));

    RETURN jsonb_build_object('status', 'restored', 'restored_cohort_ids', to_jsonb(v_restored),
                              'skipped_archived_cohort_ids', to_jsonb(v_skipped),
                              'account_reactivated', v_reactivated);
END;
$$;

DO $$
DECLARE
    v_wrong text;
BEGIN
    SELECT pg_catalog.string_agg(f.sig, ', ' ORDER BY f.sig) INTO v_wrong
      FROM (VALUES ('public.fn_cohorts_archive_metadata()', 'd2323a3ae453ee137f830fd82242c5c1', '87bce806d1a6ef757e2a70efcc304aa2', 'cohorts', false),
                   ('public.fn_cohort_archive_counts(uuid)', '86024f100c55d10b9ebf68c5ba923e9a', '124c8ab7f2943e1aa30ce282ad4f2c73', 'cohorts', true),
                   ('public.fn_archive_cohort(uuid,uuid,text)', '7f16895ff6a9401aa0f6e9b065b81760', 'f1eb4ed909fbdbdf3036fbb21fc07995', 'cohorts', true),
                   ('public.fn_restore_cohort(uuid,uuid,text)', '76c8014ba28b71f8ffa5202485216823', '8b9e00f58f28258437f161eafcf45ae5', 'cohorts', true),
                   ('public.fn_guard_membership_cohort_active()', 'dcfed4cf3a7025fa4a42e8af4911fb48', 'dcfed4cf3a7025fa4a42e8af4911fb48', 'cohorts', false),
                   ('public.fn_guard_class_assignment_cohort_active()', '8f42ab4ed2faac3afef195beafdfedb4', '8f42ab4ed2faac3afef195beafdfedb4', 'cohorts', false),
                   ('public.fn_guard_class_item_cohort_active()', '0de6ad136253520a9e5f0d2e9157b3d0', '0de6ad136253520a9e5f0d2e9157b3d0', 'cohorts', false),
                   ('public.fn_guard_writing_give_cohort_active()', '9c4f989e4ff1d60a7ae4ba544f44f5f9', '9c4f989e4ff1d60a7ae4ba544f44f5f9', 'cohorts', false),
                   ('public.fn_restore_student(uuid,uuid,text,boolean,boolean)', 'a64182f42ee1250bc6f99799190d1652', '86e01fb611a802d3022d4656c31c50e6', 'students', true)) f(sig, old_hash, new_hash, tbl, service_exec)
      JOIN pg_catalog.pg_proc p ON p.oid OPERATOR(pg_catalog.=) f.sig::regprocedure
      JOIN pg_catalog.pg_class c ON c.oid OPERATOR(pg_catalog.=) ('public.' OPERATOR(pg_catalog.||) f.tbl)::regclass
     WHERE NOT p.prosecdef
        OR p.proconfig IS NULL
        OR pg_catalog.array_to_string(p.proconfig, '|') OPERATOR(pg_catalog.<>) 'search_path=public, pg_temp'
        OR pg_catalog.md5(p.prosrc) OPERATOR(pg_catalog.<>) f.old_hash
        OR p.proowner OPERATOR(pg_catalog.<>) c.relowner
        OR p.proacl IS NULL
        OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
                    WHERE a.grantee OPERATOR(pg_catalog.=) 0::oid)
        OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR (f.service_exec AND NOT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'));
    IF v_wrong IS NOT NULL THEN
        RAISE EXCEPTION 'class_archive_search_path_wrong: %', v_wrong;
    END IF;

END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_temp.m368_function_identity b
                LEFT JOIN pg_catalog.pg_proc p ON p.oid OPERATOR(pg_catalog.=) b.oid
                WHERE p.oid IS NULL
                   OR p.proowner IS DISTINCT FROM b.proowner
                   OR p.proacl IS DISTINCT FROM b.proacl
                   OR p.prosecdef IS DISTINCT FROM b.prosecdef) THEN
        RAISE EXCEPTION 'class_archive_function_identity_changed';
    END IF;
END $$;

COMMIT;
