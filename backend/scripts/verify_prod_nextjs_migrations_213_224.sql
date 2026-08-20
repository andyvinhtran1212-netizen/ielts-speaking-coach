-- Read-only production postcondition audit for migrations 213-224.
--
-- The standard forward runner remains the only writer. This verifier runs in
-- a read-only transaction, reuses the exact 215-221 schema fingerprints, then
-- proves the production-only ledger, Mock collection and course pronunciation
-- contracts before a deployment can depend on them.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

\set REQUIRE_GAP_CLOSED 0
\set REQUIRE_ACTIVE_PLAYER_TTL 1
\ir verify_staging_nextjs_reconcile.sql

DO $$
DECLARE
    missing text[] := ARRAY[]::text[];
    expected_column record;
    expected_constraint record;
    expected_index record;
    expected_ledger record;
    expected_privilege record;
    expected_table record;
BEGIN
    FOR expected_ledger IN
        SELECT * FROM (VALUES
            ('213_mock_collection_flush_ack.sql'),
            ('214_mock_collection_sweep_completion.sql'),
            ('215_speaking_session_renderer_affinity.sql'),
            ('216_version_session_renderer_affinity_create.sql'),
            ('217_backfill_renderer_affinity_migration_gap.sql'),
            ('218_reading_attempt_renderer_affinity.sql'),
            ('219_listening_attempt_renderer_affinity.sql'),
            ('220_dictation_attempt_affinity.sql'),
            ('221_writing_assignment_renderer_affinity.sql'),
            ('222_course_pronunciation_submissions.sql'),
            ('223_course_pronunciation_service_role_grants.sql'),
            ('224_active_player_resume_ttl.sql')
        ) AS expected(filename)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM public._schema_migrations ledger
             WHERE ledger.filename = expected_ledger.filename
        ) THEN
            missing := array_append(missing, 'ledger:' || expected_ledger.filename);
        END IF;
    END LOOP;

    FOR expected_column IN
        SELECT * FROM (VALUES
            ('mock_exam_sittings', 'collection_flush_acks', 'jsonb', true,
             '''{}''::jsonb'),
            ('mock_exams', 'collection_sweep_completed_section', 'text', false,
             NULL::text)
        ) AS expected(
            table_name, column_name, data_type, not_null, column_default
        )
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_attribute a
              LEFT JOIN pg_attrdef d
                ON d.adrelid = a.attrelid
               AND d.adnum = a.attnum
             WHERE a.attrelid = to_regclass(
                       format('public.%I', expected_column.table_name)
                   )
               AND a.attname = expected_column.column_name
               AND a.attnum > 0
               AND NOT a.attisdropped
               AND format_type(a.atttypid, a.atttypmod) = expected_column.data_type
               AND a.attnotnull = expected_column.not_null
               AND pg_get_expr(d.adbin, d.adrelid) IS NOT DISTINCT FROM
                   expected_column.column_default
        ) THEN
            missing := array_append(
                missing,
                'column-contract:' || expected_column.table_name || '.' ||
                expected_column.column_name
            );
        END IF;
    END LOOP;

    FOR expected_constraint IN
        SELECT * FROM (VALUES
            ('mock_exam_sittings',
             'mock_exam_sittings_collection_flush_acks_object',
             'CHECK ((jsonb_typeof(collection_flush_acks) = ''object''::text))'),
            ('mock_exams',
             'mock_exams_collection_sweep_completed_section_check',
             'CHECK (((collection_sweep_completed_section IS NULL) OR ' ||
             '(collection_sweep_completed_section = ANY ' ||
             '(ARRAY[''listening''::text, ''reading''::text, ''writing''::text]))))')
        ) AS expected(table_name, constraint_name, definition)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint con
             WHERE con.conrelid = to_regclass(
                       format('public.%I', expected_constraint.table_name)
                   )
               AND con.conname = expected_constraint.constraint_name
               AND con.contype = 'c'
               AND con.convalidated
               AND pg_get_constraintdef(con.oid) = expected_constraint.definition
        ) THEN
            missing := array_append(
                missing,
                'constraint-contract:' || expected_constraint.constraint_name
            );
        END IF;
    END LOOP;

    FOR expected_table IN
        SELECT * FROM (VALUES
            ('course_pronunciation_sets',
             'aa2821b60270a8cdf1cd6ba681a2d5d7', 13,
             'f1296210d743d00f453fc207e3b6d4ef', 5),
            ('course_pronunciation_submissions',
             'e3b79744593b14b14e081a353974099a', 20,
             '591d2668e5dafedd25bc45ac7297f7b7', 9)
        ) AS expected(
            table_name, column_hash, column_count,
            constraint_hash, constraint_count
        )
    LOOP
        IF to_regclass('public.' || expected_table.table_name) IS NULL THEN
            missing := array_append(missing, 'table:' || expected_table.table_name);
            CONTINUE;
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM (
                    SELECT md5(string_agg(
                               format('%s|%s|%s|%s',
                                      a.attname,
                                      format_type(a.atttypid, a.atttypmod),
                                      a.attnotnull,
                                      COALESCE(pg_get_expr(d.adbin, d.adrelid), '<null>')),
                               E'\n' ORDER BY a.attnum
                           )) AS fingerprint,
                           count(*) AS item_count
                      FROM pg_attribute a
                      LEFT JOIN pg_attrdef d
                        ON d.adrelid = a.attrelid
                       AND d.adnum = a.attnum
                     WHERE a.attrelid = to_regclass(
                               format('public.%I', expected_table.table_name)
                           )
                       AND a.attnum > 0
                       AND NOT a.attisdropped
              ) actual
             WHERE actual.fingerprint = expected_table.column_hash
               AND actual.item_count = expected_table.column_count
        ) THEN
            missing := array_append(
                missing,
                'table-column-fingerprint:' || expected_table.table_name
            );
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM (
                    SELECT md5(string_agg(
                               format('%s|%s|%s|%s',
                                      con.conname,
                                      con.contype,
                                      con.convalidated,
                                      pg_get_constraintdef(con.oid)),
                               E'\n' ORDER BY con.conname
                           )) AS fingerprint,
                           count(*) AS item_count
                      FROM pg_constraint con
                     WHERE con.conrelid = to_regclass(
                               format('public.%I', expected_table.table_name)
                           )
                       -- PostgreSQL 18 materializes NOT NULL constraints in
                       -- pg_constraint; a.attnotnull already fingerprints them.
                       AND con.contype <> 'n'
              ) actual
             WHERE actual.fingerprint = expected_table.constraint_hash
               AND actual.item_count = expected_table.constraint_count
        ) THEN
            missing := array_append(
                missing,
                'table-constraint-fingerprint:' || expected_table.table_name
            );
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM pg_class c
             WHERE c.oid = to_regclass(format('public.%I', expected_table.table_name))
               AND c.relrowsecurity
        ) THEN
            missing := array_append(missing, 'rls-enabled:' || expected_table.table_name);
        END IF;

        IF EXISTS (
            SELECT 1
              FROM pg_policies p
             WHERE p.schemaname = 'public'
               AND p.tablename = expected_table.table_name
        ) THEN
            missing := array_append(
                missing,
                'unexpected-client-policy:' || expected_table.table_name
            );
        END IF;

        IF EXISTS (
            SELECT 1
              FROM pg_class c
              CROSS JOIN LATERAL aclexplode(
                   COALESCE(c.relacl, acldefault('r', c.relowner))
              ) acl
             WHERE c.oid = to_regclass(format('public.%I', expected_table.table_name))
               AND acl.grantee IN (
                   0,
                   (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
                   (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
               )
        ) THEN
            missing := array_append(
                missing,
                'direct-client-table-grant:' || expected_table.table_name
            );
        END IF;

        FOR expected_privilege IN
            SELECT * FROM (VALUES
                ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
            ) AS expected(privilege_name)
        LOOP
            IF NOT has_table_privilege(
                'service_role',
                format('public.%I', expected_table.table_name),
                expected_privilege.privilege_name
            ) THEN
                missing := array_append(
                    missing,
                    'service-role-' || lower(expected_privilege.privilege_name) ||
                    ':' || expected_table.table_name
                );
            END IF;
        END LOOP;
    END LOOP;

    FOR expected_index IN
        SELECT * FROM (VALUES
            ('idx_course_pronunciation_sets_active',
             '35b9e5ec872abb239d3167c0c74ebe83'),
            ('idx_course_pronunciation_submissions_assignment',
             '4959772bbc2c8b454d9ac698083a3dec'),
            ('idx_course_pronunciation_submissions_bank',
             '02dd83289040faae882c6b190e7da919'),
            ('idx_course_pronunciation_submissions_set',
             '6739971ed1d28b3d68e6823205cee726'),
            ('idx_course_pronunciation_submissions_user_bank',
             'e5ee93cb47f36af7a57eb5d2dca8d805')
        ) AS expected(index_name, definition_md5)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_index idx
             WHERE idx.indexrelid = to_regclass(
                       format('public.%I', expected_index.index_name)
                   )
               AND idx.indisvalid
               AND idx.indisready
               AND md5(pg_get_indexdef(idx.indexrelid)) = expected_index.definition_md5
        ) THEN
            missing := array_append(
                missing,
                'index-contract:' || expected_index.index_name
            );
        END IF;
    END LOOP;

    IF array_length(missing, 1) IS NOT NULL THEN
        RAISE EXCEPTION
            'production Next.js migrations 213-224 verification failed: %',
            array_to_string(missing, ', ');
    END IF;
END;
$$;

\ir verify_active_player_ttl_224.sql

SELECT 'verified production Next.js migration contracts 213-224' AS result;

COMMIT;
