-- Read-only postcondition audit for reconcile_staging_nextjs_migrations.py.
--
-- Verify the durable final contracts of migrations 215-221 before recording
-- their missing staging ledger rows.  This script deliberately does not replay
-- migration 217: NULL is now a legitimate transient claim-v1 session state.

DO $$
DECLARE
    missing text[] := ARRAY[]::text[];
    expected_column record;
    expected_constraint record;
    expected_function record;
    expected_index record;
    expected_table record;
    expected_policy record;
    expected_trigger record;
BEGIN
    -- Affinity columns on existing canonical tables.  Speaking/Reading/
    -- Listening default unversioned inserts to Legacy; Writing intentionally
    -- has no default because historical ownership cannot be inferred.
    FOR expected_column IN
        SELECT * FROM (VALUES
            ('sessions', 'renderer_affinity', '''legacy''::text'),
            ('reading_test_attempts', 'renderer_affinity', '''legacy''::text'),
            ('listening_test_attempts', 'renderer_affinity', '''legacy''::text'),
            ('writing_assignments', 'renderer_affinity', NULL::text),
            ('dictation_sessions', 'attempt_id', NULL::text)
        ) AS expected(table_name, column_name, column_default)
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
               AND NOT a.attisdropped
               AND NOT a.attnotnull
               AND format_type(a.atttypid, a.atttypmod) = CASE
                     WHEN expected_column.column_name = 'attempt_id' THEN 'uuid'
                     ELSE 'text'
                   END
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
            ('sessions', 'sessions_renderer_affinity_valid'),
            ('reading_test_attempts', 'reading_test_attempts_renderer_affinity_valid'),
            ('listening_test_attempts', 'listening_test_attempts_renderer_affinity_valid'),
            ('writing_assignments', 'writing_assignments_renderer_affinity_valid')
        ) AS expected(table_name, constraint_name)
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
               AND pg_get_constraintdef(con.oid) =
                   'CHECK ((renderer_affinity = ANY (ARRAY[' ||
                   '''legacy''::text, ''next''::text])))'
        ) THEN
            missing := array_append(
                missing,
                'constraint-contract:' || expected_constraint.constraint_name
            );
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM public.sessions
         WHERE renderer_affinity IS NOT NULL
           AND renderer_affinity NOT IN ('legacy', 'next')
        UNION ALL
        SELECT 1 FROM public.reading_test_attempts
         WHERE renderer_affinity IS NOT NULL
           AND renderer_affinity NOT IN ('legacy', 'next')
        UNION ALL
        SELECT 1 FROM public.listening_test_attempts
         WHERE renderer_affinity IS NOT NULL
           AND renderer_affinity NOT IN ('legacy', 'next')
        UNION ALL
        SELECT 1 FROM public.writing_assignments
         WHERE renderer_affinity IS NOT NULL
           AND renderer_affinity NOT IN ('legacy', 'next')
    ) THEN
        missing := array_append(missing, 'data:invalid-renderer-affinity');
    END IF;

    -- Pin signatures, return shapes, security posture and exact PL/pgSQL bodies.
    FOR expected_function IN
        SELECT * FROM (VALUES
            ('fn_claim_session_renderer_affinity',
             'p_session_id uuid, p_user_id uuid, p_renderer_affinity text',
             'TABLE(session_id uuid, renderer_affinity text)',
             '2f5b6519d526254965c8bfb529b213f7'),
            ('fn_create_session_daily_capped_v3',
             'p_session_id uuid, p_user_id uuid, p_mode text, p_part integer, p_topic text, p_day_start timestamp with time zone, p_max_daily integer, p_renderer_affinity text',
             'SETOF sessions',
             'e46027336e1600d9c5d047a43c925745'),
            ('fn_claim_reading_attempt_renderer_affinity',
             'p_attempt_id uuid, p_user_id uuid, p_anon_id text, p_renderer_affinity text',
             'TABLE(attempt_id uuid, renderer_affinity text)',
             'b4a4c894e90bcb2a32fd7bb259163ee3'),
            ('fn_claim_listening_attempt_renderer_affinity',
             'p_attempt_id uuid, p_user_id uuid, p_renderer_affinity text',
             'TABLE(attempt_id uuid, renderer_affinity text)',
             '2842017df386c84b2e5238f775b69974'),
            ('fn_claim_dictation_attempt_renderer_affinity',
             'p_attempt_id uuid, p_user_id uuid, p_renderer_affinity text',
             'TABLE(attempt_id uuid, renderer_affinity text)',
             '85bb3019c78d7bfbacc654fb318417f2'),
            ('fn_guard_dictation_attempt_answer_mutation', '', 'trigger',
             '896b94c98cc824f176d62b10698c4a90'),
            ('fn_finalize_dictation_attempt_from_session', '', 'trigger',
             '3fd91fe4608ed893d6ce91137ba3c663'),
            ('fn_claim_writing_assignment_renderer_affinity',
             'p_assignment_id uuid, p_student_id uuid, p_renderer_affinity text',
             'TABLE(assignment_id uuid, renderer_affinity text)',
             'ec67178c7a6ad9ec03d87270585ba61d')
        ) AS expected(function_name, arguments, result, body_md5)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
              JOIN pg_language l ON l.oid = p.prolang
             WHERE n.nspname = 'public'
               AND p.proname = expected_function.function_name
               AND pg_get_function_identity_arguments(p.oid) =
                   expected_function.arguments
               AND pg_get_function_result(p.oid) = expected_function.result
               AND l.lanname = 'plpgsql'
               AND NOT p.prosecdef
               AND p.provolatile = 'v'
               AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
               AND md5(p.prosrc) = expected_function.body_md5
               AND has_function_privilege('service_role', p.oid, 'EXECUTE')
               AND NOT EXISTS (
                    SELECT 1
                      FROM aclexplode(
                           COALESCE(p.proacl, acldefault('f', p.proowner))
                      ) acl
                     WHERE acl.privilege_type = 'EXECUTE'
                       AND acl.grantee IN (
                           0,
                           (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
                           (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
                       )
               )
        ) THEN
            missing := array_append(
                missing,
                'function-contract:' || expected_function.function_name
            );
        END IF;
    END LOOP;

    -- Complete structural fingerprints for the two canonical tables created
    -- by migration 220.
    FOR expected_table IN
        SELECT * FROM (VALUES
            ('dictation_attempts',
             '1b1ec073699bddbfd88da5e3b82d11c7', 11,
             'a68315b6726e5ed106db70cb304bf115', 7),
            ('dictation_attempt_answers',
             '40bd9cc729c7a1a5900b6d044216ad03', 10,
             '1305679b183dfbd99043c6e012f4d6f1', 9)
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
            SELECT 1 FROM pg_class c
             WHERE c.oid = to_regclass(format('public.%I', expected_table.table_name))
               AND c.relrowsecurity
        ) THEN
            missing := array_append(
                missing,
                'rls-enabled:' || expected_table.table_name
            );
        END IF;
    END LOOP;

    FOR expected_index IN
        SELECT * FROM (VALUES
            ('uq_dictation_attempts_one_active_section',
             '9a16cb53141465e0ad5c2b84317d9599'),
            ('ix_dictation_attempts_user_updated',
             'a7a4059ebef73d423e08734b4b040631'),
            ('uq_dictation_sessions_attempt',
             '8a1cbe7b41e69fff573046bd05c5ae7a')
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
               AND md5(pg_get_indexdef(idx.indexrelid)) =
                   expected_index.definition_md5
        ) THEN
            missing := array_append(
                missing,
                'index-contract:' || expected_index.index_name
            );
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint con
         WHERE con.conrelid = 'public.dictation_sessions'::regclass
           AND con.conname = 'dictation_sessions_attempt_id_fkey'
           AND con.contype = 'f'
           AND con.convalidated
           AND pg_get_constraintdef(con.oid) =
               'FOREIGN KEY (attempt_id) REFERENCES dictation_attempts(id) ON DELETE SET NULL'
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:dictation_sessions_attempt_id_fkey'
        );
    END IF;

    FOR expected_policy IN
        SELECT * FROM (VALUES
            ('dictation_attempts', 'cba30ef52b5f579617c0938ee4f319e2', 2),
            ('dictation_attempt_answers', '05bd383e1a90665e3d9994a99bc3b78d', 2)
        ) AS expected(table_name, policy_hash, policy_count)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM (
                    SELECT md5(string_agg(
                               format('%s|%s|%s|%s|%s',
                                      policyname, cmd, roles, qual, with_check),
                               E'\n' ORDER BY policyname
                           )) AS fingerprint,
                           count(*) AS item_count
                      FROM pg_policies
                     WHERE schemaname = 'public'
                       AND tablename = expected_policy.table_name
              ) actual
             WHERE actual.fingerprint = expected_policy.policy_hash
               AND actual.item_count = expected_policy.policy_count
        ) THEN
            missing := array_append(
                missing,
                'policy-contract:' || expected_policy.table_name
            );
        END IF;
    END LOOP;

    FOR expected_trigger IN
        SELECT * FROM (VALUES
            ('trg_finalize_dictation_attempt_from_session',
             '9c638e92f8be279a688460b9a60cc198'),
            ('trg_guard_dictation_attempt_answer_mutation',
             'aae793150b152115978685c6d2da5b58')
        ) AS expected(trigger_name, definition_md5)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_trigger trg
             WHERE trg.tgname = expected_trigger.trigger_name
               AND NOT trg.tgisinternal
               AND trg.tgenabled = 'O'
               AND md5(pg_get_triggerdef(trg.oid)) =
                   expected_trigger.definition_md5
        ) THEN
            missing := array_append(
                missing,
                'trigger-contract:' || expected_trigger.trigger_name
            );
        END IF;
    END LOOP;

    IF array_length(missing, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'staging Next.js migration verification failed: %',
            array_to_string(missing, ', ');
    END IF;
END;
$$;

-- Migration 217 was a one-time bounded-gap backfill.  Require zero remaining
-- NULLs only while its ledger row is absent.  Once acknowledged, future
-- claim-v1 sessions may legitimately be NULL until their first player boot.
\if :REQUIRE_GAP_CLOSED
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.sessions WHERE renderer_affinity IS NULL
    ) THEN
        RAISE EXCEPTION
            'staging Next.js migration verification failed: data:speaking-gap-null';
    END IF;
END;
$$;
\endif

SELECT 'verified staging Next.js migration contracts 215-221' AS result;
