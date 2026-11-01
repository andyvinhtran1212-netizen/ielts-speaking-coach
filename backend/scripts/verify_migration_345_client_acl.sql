-- Read-only postcondition audit for migration 345 (PC-J169; Security Auditor
-- 2026-10-29, after the PC-J161 retest of #1934).
--
-- 345 revokes every client privilege on user_feedback, lemma_overrides and
-- access_codes. Its own postcondition (step 6) checks the result with
-- has_table_privilege for SELECT … TRIGGER at table level, plus column SELECT
-- on access_codes. Two kinds of grant survive both the REVOKE and that check:
--   · a grant made by a role other than the one running 345 (a role holding
--     the privilege WITH GRANT OPTION passed it on): REVOKE removes only what
--     the current role granted;
--   · on such a grant, column-level INSERT, UPDATE or REFERENCES (attacl) and,
--     on PostgreSQL 17, MAINTAIN, which step 6 never names.
-- The runner's own column grants are gone after 345: a table-level REVOKE also
-- revokes that grantor's column privileges.
--
-- 345 is approved and its sha256 is pinned, so the check lives here. Every ACL
-- entry on these tables and their columns is read with aclexplode(relacl /
-- attacl), whatever the grantor and the privilege. Run it after applying 345
-- on staging and production (backend/migrations/README.md, 345). It has no
-- psql meta-command, so it also runs through the Management API with
-- "read_only": true. It writes nothing and ends with one "ok" row; any client
-- privilege left RAISEs. Proof: test_migration_345_admin_inline_policies.py.

DO $$
DECLARE
    -- Same list as revoked_tables in 345.
    revoked_tables CONSTANT TEXT[] := ARRAY['user_feedback', 'lemma_overrides', 'access_codes'];
    client_roles CONSTANT TEXT[] := ARRAY['public', 'anon', 'authenticated'];
    table_privileges TEXT[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                     'REFERENCES', 'TRIGGER'];
    gaps TEXT;
BEGIN
    IF current_setting('server_version_num')::int >= 170000 THEN
        table_privileges := table_privileges || 'MAINTAIN'::text;
    END IF;

    SELECT string_agg(t, ', ' ORDER BY t) INTO gaps
      FROM unnest(revoked_tables) t
     WHERE to_regclass('public.' || t) IS NULL;
    IF gaps IS NOT NULL THEN
        RAISE EXCEPTION 'revoked_table_missing: %', gaps;
    END IF;

    -- 1. Direct grants: any ACL entry, table or column, any grantor, whose
    --    grantee is PUBLIC (oid 0), anon or authenticated.
    WITH entry AS (
        SELECT c.relname || COALESCE('.' || e.attname, '') AS object,
               CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE e.grantee::regrole::text END AS grantee,
               e.privilege_type, e.grantor::regrole::text AS grantor
          FROM pg_class c
         CROSS JOIN LATERAL (
                SELECT NULL::name AS attname, a.grantee, a.grantor, a.privilege_type
                  FROM aclexplode(c.relacl) a
                UNION ALL
                SELECT att.attname, a.grantee, a.grantor, a.privilege_type
                  FROM pg_attribute att
                 CROSS JOIN LATERAL aclexplode(att.attacl) a
                 WHERE att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped) e
         WHERE c.relnamespace = 'public'::regnamespace
           AND c.relname = ANY (revoked_tables)
           AND (e.grantee = 0 OR e.grantee IN (SELECT oid FROM pg_roles WHERE rolname = ANY (client_roles))))
    SELECT string_agg(format('%s:%s:%s/%s', object, grantee, privilege_type, grantor), ', '
                      ORDER BY object, grantee, privilege_type, grantor)
      INTO gaps
      FROM entry;
    IF gaps IS NOT NULL THEN
        RAISE EXCEPTION 'client_acl_entry_remains: %', gaps;
    END IF;

    -- 2. Effective privileges, which also count a role anon or authenticated
    --    is a member of.
    SELECT string_agg(format('%s:%s:%s', c.relname, CASE r WHEN 'public' THEN 'PUBLIC' ELSE r END, priv), ', '
                      ORDER BY c.relname, r, priv)
      INTO gaps
      FROM pg_class c
     CROSS JOIN unnest(client_roles) r
     CROSS JOIN unnest(table_privileges) priv
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname = ANY (revoked_tables)
       AND (has_table_privilege(r, c.oid, priv)
            OR (priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                AND has_any_column_privilege(r, c.oid, priv)));
    IF gaps IS NOT NULL THEN
        RAISE EXCEPTION 'client_privilege_effective_remains: %', gaps;
    END IF;
END $$;

SELECT 'verify_345_client_acl: ok' AS result;
