-- PC-J286 / CALAPPEND-0041 FR-001..004. No data or policy changes.
-- Apply AFTER 344 through the advisory-locked runner, staging first with
-- separate Leader authorization. This PR does not authorize a hosted apply.
-- The down script is a separate 0042 task per Leader's PC-J401 addendum;
-- it must never restore revoked privileges or policies.

BEGIN;
SET LOCAL lock_timeout = '5s';
-- service_role can CREATE in public; exclude it from builtin resolution.
SET LOCAL search_path = pg_catalog, pg_temp;

-- Fail before DDL/ACL changes on a managed database. A ledger-free legacy
-- fixture is supported only to prove independence from the old policies.
DO $prerequisite$
BEGIN
    IF to_regclass('public._schema_migrations') IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public._schema_migrations
                        WHERE filename LIKE '344\_%' ESCAPE '\')
           OR EXISTS (SELECT 1 FROM pg_policy
                       WHERE polrelid = 'public.class_action_log'::regclass
                         AND polname IN ('cal_admin_append', 'cal_admin_read')) THEN
            RAISE EXCEPTION 'class_action_log_356_requires_344';
        END IF;
    END IF;
END;
$prerequisite$;

-- A dedicated message identifies the statement trigger, rather than telling
-- an operator to disable 198's unrelated row trigger.
CREATE OR REPLACE FUNCTION public.fn_class_action_log_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE =
        'class_action_log chỉ THÊM: không TRUNCATE (mig 356). Cần dọn thì '
        'tắt trigger trg_class_action_log_no_truncate một cách có ý thức.';
END;
$$;

-- Supabase default privileges grant EXECUTE on new public functions to anon,
-- authenticated and service_role (mig 341 pattern): revoke each explicitly.
REVOKE EXECUTE ON FUNCTION public.fn_class_action_log_no_truncate()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER trg_class_action_log_no_truncate
    BEFORE TRUNCATE ON public.class_action_log
    FOR EACH STATEMENT EXECUTE FUNCTION public.fn_class_action_log_no_truncate();

REVOKE TRIGGER, REFERENCES ON public.class_action_log FROM service_role, PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON public.class_action_log
    FROM service_role, PUBLIC, anon, authenticated;

DO $maintain$
BEGIN
    IF current_setting('server_version_num')::int >= 170000 THEN
        EXECUTE 'REVOKE MAINTAIN ON public.class_action_log FROM service_role, PUBLIC';
    END IF;
END;
$maintain$;

DO $postcondition$
DECLARE
    table_owner oid;
    privilege text;
    role_name text;
    via_role name;
    denied text[] := ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES']
        || CASE WHEN current_setting('server_version_num')::int >= 170000
                THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::text[] END;
BEGIN
    SELECT relowner INTO table_owner FROM pg_class
     WHERE oid = 'public.class_action_log'::regclass AND relrowsecurity;
    IF table_owner IS NULL THEN
        RAISE EXCEPTION 'class_action_log_356_rls_disabled';
    END IF;
    IF pg_has_role('service_role', table_owner, 'MEMBER')
       OR (SELECT rolsuper FROM pg_roles WHERE rolname = 'service_role') THEN
        RAISE EXCEPTION 'class_action_log_356_unsafe_owner_or_service_role';
    END IF;
    -- Membership-aware (see the table checks below): SET ROLE reaches these too.
    IF EXISTS (SELECT 1 FROM pg_roles m
                WHERE pg_has_role('service_role'::name, m.oid, 'MEMBER')
                  AND has_parameter_privilege(m.oid, 'session_replication_role', 'SET')) THEN
        RAISE EXCEPTION 'class_action_log_356_replication_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.class_action_log'::regclass
                      AND tgname = 'trg_class_action_log_append_only'
                      AND NOT tgisinternal AND tgenabled IN ('O', 'A') AND tgtype = 27
                      AND tgfoid = 'public.fn_class_action_log_append_only()'::regprocedure) THEN
        RAISE EXCEPTION 'class_action_log_356_row_trigger_missing_or_disabled';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.class_action_log'::regclass
                      AND tgname = 'trg_class_action_log_no_truncate'
                      AND NOT tgisinternal AND tgenabled = 'O' AND tgtype = 34
                      AND tgfoid = 'public.fn_class_action_log_no_truncate()'::regprocedure) THEN
        RAISE EXCEPTION 'class_action_log_356_truncate_trigger_missing_or_disabled';
    END IF;
    -- P3: the trigger function is not client-executable, directly or through
    -- a membership that SET ROLE reaches (Supabase default ACL grants EXECUTE).
    IF EXISTS (SELECT 1 FROM pg_proc p
                WHERE p.oid = 'public.fn_class_action_log_no_truncate()'::regprocedure
                  AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                                                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))) THEN
        RAISE EXCEPTION 'class_action_log_356_trigger_function_public_execute';
    END IF;
    SELECT r.rolname, m.rolname INTO role_name, via_role
      FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
      JOIN pg_roles m ON pg_has_role(r.rolname::name, m.oid, 'MEMBER')
     WHERE has_function_privilege(m.oid, 'public.fn_class_action_log_no_truncate()', 'EXECUTE')
     ORDER BY 1, 2 LIMIT 1;
    IF via_role IS NOT NULL THEN
        RAISE EXCEPTION 'class_action_log_356_trigger_function_execute: % via %', role_name, via_role;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.class_action_log', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.class_action_log', 'INSERT') THEN
        RAISE EXCEPTION 'class_action_log_356_backend_privilege_missing';
    END IF;
    -- SA-R4-1 (mig 341 pattern): has_table_privilege(role) ignores privileges
    -- reached through NOINHERIT memberships, which SET ROLE still grants. Check
    -- every role service_role can become (MEMBER, fail-closed), not only itself.
    SELECT m.rolname, p.priv INTO via_role, privilege
      FROM pg_roles m CROSS JOIN unnest(denied) p(priv)
     WHERE pg_has_role('service_role'::name, m.oid, 'MEMBER')
       AND (has_table_privilege(m.oid, 'public.class_action_log', p.priv)
            OR (p.priv IN ('UPDATE', 'REFERENCES')
                AND has_any_column_privilege(m.oid, 'public.class_action_log', p.priv)))
     ORDER BY m.rolname, p.priv LIMIT 1;
    IF via_role IS NOT NULL THEN
        RAISE EXCEPTION 'class_action_log_356_service_privilege: % via %', privilege, via_role;
    END IF;
    -- Inspect PUBLIC directly too; has_table_privilege cannot name pseudo-role PUBLIC.
    IF EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
                WHERE c.oid = 'public.class_action_log'::regclass AND a.grantee = 0)
       OR EXISTS (SELECT 1 FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a
                   WHERE c.attrelid = 'public.class_action_log'::regclass AND a.grantee = 0) THEN
        RAISE EXCEPTION 'class_action_log_356_public_privilege';
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        -- Membership-aware as above: check every role role_name can become.
        IF EXISTS (SELECT 1 FROM pg_roles m
                    WHERE pg_has_role(role_name::name, m.oid, 'MEMBER')
                      AND (has_table_privilege(m.oid, 'public.class_action_log', 'UPDATE,DELETE')
                           OR has_any_column_privilege(m.oid, 'public.class_action_log', 'UPDATE'))) THEN
            RAISE EXCEPTION 'class_action_log_356_client_write_privilege: %', role_name;
        END IF;
        IF to_regclass('public._schema_migrations') IS NOT NULL THEN
            FOREACH privilege IN ARRAY ARRAY['SELECT', 'INSERT'] || denied LOOP
                IF EXISTS (SELECT 1 FROM pg_roles m
                            WHERE pg_has_role(role_name::name, m.oid, 'MEMBER')
                              AND (has_table_privilege(m.oid, 'public.class_action_log', privilege)
                                   OR (privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') AND
                                       has_any_column_privilege(m.oid, 'public.class_action_log', privilege)))) THEN
                    RAISE EXCEPTION 'class_action_log_356_client_privilege: % %', role_name, privilege;
                END IF;
            END LOOP;
        END IF;
    END LOOP;
END;
$postcondition$;

COMMIT;
