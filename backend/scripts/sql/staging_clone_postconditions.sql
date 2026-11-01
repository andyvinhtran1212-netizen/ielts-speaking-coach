-- Clone acceptance checks adapted from migration 320 step 8.
-- Runs before COMMIT in the reset/restore transaction; never repairs ACLs.
-- staging_clone_reset.sql recorded the restore role before the dump ran.
SELECT set_config('staging_clone.restore_role', :'clone_restore_role', true);

-- A role switch hidden in a routine body is invisible to preflight: the
-- restore must end as the role it started as, owning everything it restored.
DO $$
DECLARE
    restore_role CONSTANT NAME := current_setting('staging_clone.restore_role');
    leaks TEXT;
BEGIN
    IF current_user <> restore_role OR session_user <> restore_role THEN
        RAISE EXCEPTION 'restore_role_changed: current_user %, session_user %, expected %',
            current_user, session_user, restore_role;
    END IF;

    WITH owned(catalog, oid, label, owner) AS (
        SELECT 'pg_namespace'::regclass, n.oid, 'schema ' || n.nspname, n.nspowner
          FROM pg_namespace n WHERE n.nspname = 'public'
        UNION ALL
        SELECT 'pg_class'::regclass, c.oid, c.oid::regclass::text, c.relowner
          FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
        UNION ALL
        SELECT 'pg_proc'::regclass, p.oid, p.oid::regprocedure::text, p.proowner
          FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        UNION ALL
        SELECT 'pg_type'::regclass, t.oid, t.oid::regtype::text, t.typowner
          FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace
        UNION ALL
        SELECT 'pg_operator'::regclass, o.oid, o.oid::regoperator::text, o.oprowner
          FROM pg_operator o WHERE o.oprnamespace = 'public'::regnamespace
        UNION ALL
        SELECT 'pg_collation'::regclass, c.oid, c.collname::text, c.collowner
          FROM pg_collation c WHERE c.collnamespace = 'public'::regnamespace
        UNION ALL
        SELECT 'pg_conversion'::regclass, c.oid, c.conname::text, c.conowner
          FROM pg_conversion c WHERE c.connamespace = 'public'::regnamespace
        UNION ALL
        SELECT 'pg_opfamily'::regclass, f.oid, f.opfname::text, f.opfowner
          FROM pg_opfamily f WHERE f.opfnamespace = 'public'::regnamespace
        UNION ALL
        SELECT 'pg_opclass'::regclass, c.oid, c.opcname::text, c.opcowner
          FROM pg_opclass c WHERE c.opcnamespace = 'public'::regnamespace
        UNION ALL
        SELECT 'pg_ts_config'::regclass, c.oid, c.cfgname::text, c.cfgowner
          FROM pg_ts_config c WHERE c.cfgnamespace = 'public'::regnamespace
        UNION ALL
        SELECT 'pg_ts_dict'::regclass, d.oid, d.dictname::text, d.dictowner
          FROM pg_ts_dict d WHERE d.dictnamespace = 'public'::regnamespace
        UNION ALL
        SELECT 'pg_statistic_ext'::regclass, s.oid, s.stxname::text, s.stxowner
          FROM pg_statistic_ext s WHERE s.stxnamespace = 'public'::regnamespace)
    SELECT string_agg(format('%s:%s', label, pg_get_userbyid(owner)), ', ' ORDER BY label)
      INTO leaks
      FROM owned o
     WHERE pg_get_userbyid(o.owner) <> restore_role
       -- Extension members keep their extension-managed ownership.
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = o.catalog AND d.objid = o.oid AND d.deptype = 'e');
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'restored_object_not_owned_by_restore_role: %', leaks;
    END IF;
END $$;

-- ── 8. Postcondition: fail the release instead of leaving a silent hole ────
-- A REVOKE issued by a role that did not grant the privilege only warns, so
-- check the effective privileges rather than trusting the steps above.
DO $$
DECLARE
    client_write_tables CONSTANT TEXT[] := ARRAY[
        'user_vocabulary', 'flashcard_stacks', 'flashcard_cards',
        'flashcard_reviews', 'flashcard_review_log'];
    -- MAINTAIN only exists on PG 17+; has_table_privilege rejects it on PG 16.
    checked_privileges CONSTANT TEXT[] := ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
        || CASE WHEN current_setting('server_version_num')::int >= 170000
                THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::TEXT[] END;
    leaks TEXT;
    unrevocable TEXT;
BEGIN
    SELECT string_agg(format('%s:%s:%s', c.relname, r.rolname, p.priv), ', '
                      ORDER BY c.relname, r.rolname, p.priv)
      INTO leaks
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
     CROSS JOIN unnest(checked_privileges) p(priv)
     WHERE ns.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND CASE WHEN p.priv IN ('INSERT', 'UPDATE')
                THEN has_any_column_privilege(r.rolname, c.oid, p.priv)
                ELSE has_table_privilege(r.rolname, c.oid, p.priv) END
       AND NOT (r.rolname = 'authenticated'
                AND c.relname = ANY (client_write_tables)
                AND p.priv NOT IN ('TRUNCATE', 'MAINTAIN'))
       AND NOT (r.rolname = 'authenticated' AND c.relname = 'user_d1_questions'
                AND p.priv = 'UPDATE');
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'client_write_privilege_lockdown_incomplete: %', leaks;
    END IF;

    SELECT string_agg(format('%s.%s:%s', a.attrelid::regclass, a.attname, r.rolname), ', '
                      ORDER BY a.attrelid::regclass::text, a.attname, r.rolname)
      INTO leaks
      FROM pg_attribute a
     CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
     WHERE a.attrelid IN ('public.users'::regclass, 'public.user_d1_questions'::regclass)
       AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege(r.rolname, a.attrelid, a.attnum, 'UPDATE')
       AND NOT (r.rolname = 'authenticated'
                AND a.attrelid = 'public.user_d1_questions'::regclass
                AND a.attname = 'is_active');
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'server_owned_column_still_client_writable: %', leaks;
    END IF;

    SELECT string_agg(format('%s:%s', c.relname, r.rolname), ', ' ORDER BY c.relname, r.rolname)
      INTO leaks
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
     WHERE ns.nspname = 'public' AND c.relkind = 'S'
       AND has_sequence_privilege(r.rolname, c.oid, 'UPDATE');
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'client_sequence_update_survives: %', leaks;
    END IF;

    -- Default ACLs of owners the runner can act for were revoked in step 2 and
    -- must be clean. An owner it cannot act for (supabase_admin on hosted
    -- Supabase) needs a Supabase superuser; its ACL only affects objects that
    -- role creates later, and every existing relation was checked above.
    SELECT string_agg(entry, ', ' ORDER BY entry) FILTER (WHERE can_act),
           string_agg(entry, ', ' ORDER BY entry) FILTER (WHERE NOT can_act)
      INTO leaks, unrevocable
      FROM (SELECT format('%s:%s:%s:%s', pg_get_userbyid(d.defaclrole), d.defaclobjtype,
                          CASE a.grantee WHEN 0 THEN 'PUBLIC'
                               ELSE pg_get_userbyid(a.grantee) END,
                          a.privilege_type) AS entry,
                   (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
                   OR pg_has_role(current_user, d.defaclrole, 'MEMBER') AS can_act
              FROM pg_default_acl d
             CROSS JOIN LATERAL aclexplode(d.defaclacl) a
             WHERE (d.defaclnamespace = 0
                    OR d.defaclnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
               AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))
               AND ((d.defaclobjtype = 'r' AND a.privilege_type <> 'SELECT')
                    OR (d.defaclobjtype = 'S' AND a.privilege_type = 'UPDATE'))) acl;
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'client_default_write_privilege_survives: %', leaks;
    END IF;
    IF unrevocable IS NOT NULL THEN
        RAISE WARNING 'client_default_write_privilege_not_revocable_by_runner: %', unrevocable
            USING DETAIL = format('Runner %s is neither superuser nor a member of these owner roles. '
                                  'Their default ACLs apply only to objects they create later, which '
                                  'app migrations never do; existing relations were verified.',
                                  current_user),
                  HINT = 'Optional follow-up: a Supabase superuser (support) revokes them for '
                         'that owner; statements in the migration 320 header and '
                         'specs/0022-client-write-privilege-lockdown/rollout.md.';
    END IF;

    SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
      INTO leaks
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       -- Extension routines keep their extension-managed access contract.
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                          AND d.deptype = 'e')
       AND (p.prosecdef OR p.proname IN ('fn_finalize_d1_attempt',
                                         'fn_finalize_d1_attempt_for_user'))
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'client_executable_privileged_function: %', leaks;
    END IF;

    -- Migration 204's append-only log also excludes service maintenance.
    IF to_regclass('public.class_action_log') IS NULL THEN
        RAISE EXCEPTION 'class_action_log_missing';
    END IF;
    IF has_table_privilege('service_role', 'public.class_action_log', 'TRUNCATE')
       OR has_table_privilege('service_role', 'public.class_action_log', 'MAINTAIN') THEN
        RAISE EXCEPTION 'service_role_can_maintain_or_truncate_class_action_log';
    END IF;

    -- SVCPRIV-0042 FR-007: reset.sql grants service_role USAGE only, but the
    -- dump replays the source's schema ACL, so check the effective privilege.
    IF has_schema_privilege('service_role', 'public', 'CREATE') THEN
        RAISE EXCEPTION 'service_role_can_create_in_public';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'users'
                  AND policyname = 'Users can update own data'
                  AND (roles <> ARRAY['authenticated']::name[] OR with_check IS NULL)) THEN
        RAISE EXCEPTION 'users_update_policy_not_hardened';
    END IF;
END $$;
