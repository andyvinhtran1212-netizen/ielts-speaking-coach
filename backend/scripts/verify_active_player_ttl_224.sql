-- Read-only postcondition audit for migration 224_active_player_resume_ttl.sql.
-- Intended to be included by the locked production verifier after migration
-- execution. It is also safe to run directly inside a read-only transaction.

\set ON_ERROR_STOP on

DO $$
DECLARE
    missing text[] := ARRAY[]::text[];
    expected record;
    function_oid oid;
    function_source text;
BEGIN
    FOR expected IN
        SELECT * FROM (VALUES
            ('sessions', 'resume_expires_at'),
            ('reading_test_attempts', 'resume_expires_at'),
            ('listening_test_attempts', 'resume_expires_at'),
            ('dictation_attempts', 'resume_expires_at'),
            ('writing_assignments', 'renderer_affinity_claimed_at'),
            ('writing_assignments', 'renderer_affinity_expires_at')
        ) AS contract(table_name, column_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_attribute a
             WHERE a.attrelid = to_regclass(format('public.%I', expected.table_name))
               AND a.attname = expected.column_name
               AND a.attnum > 0
               AND NOT a.attisdropped
               AND format_type(a.atttypid, a.atttypmod) = 'timestamp with time zone'
               AND (
                    expected.table_name = 'writing_assignments'
                    OR a.attnotnull
               )
        ) THEN
            missing := array_append(
                missing,
                'column-contract:' || expected.table_name || '.' || expected.column_name
            );
        END IF;
    END LOOP;

    FOR expected IN
        SELECT * FROM (VALUES
            ('sessions', 'resume_expires_at'),
            ('reading_test_attempts', 'resume_expires_at'),
            ('listening_test_attempts', 'resume_expires_at'),
            ('dictation_attempts', 'resume_expires_at')
        ) AS contract(table_name, column_name)
    LOOP
        IF EXISTS (
            SELECT 1
              FROM pg_attribute a
              JOIN pg_attrdef d
                ON d.adrelid = a.attrelid
               AND d.adnum = a.attnum
             WHERE a.attrelid = to_regclass(format('public.%I', expected.table_name))
               AND a.attname = expected.column_name
        ) THEN
            missing := array_append(
                missing,
                'column-default-must-be-triggered:' || expected.table_name || '.' ||
                expected.column_name
            );
        END IF;
    END LOOP;

    FOR expected IN
        SELECT * FROM (VALUES
            ('sessions', 'sessions_resume_expiry_within_ttl',
             ARRAY['resume_expires_at > started_at', 'resume_expires_at <=', '24:00:00']),
            ('reading_test_attempts', 'reading_attempt_resume_expiry_within_ttl',
             ARRAY['resume_expires_at > started_at', 'resume_expires_at <=', '24:00:00']),
            ('listening_test_attempts', 'listening_attempt_resume_expiry_within_ttl',
             ARRAY['resume_expires_at >', 'resume_expires_at <=',
                   'COALESCE(started_at, created_at)', '24:00:00']),
            ('dictation_attempts', 'dictation_attempt_resume_expiry_within_ttl',
             ARRAY['resume_expires_at > started_at', 'resume_expires_at <=', '24:00:00']),
            ('writing_assignments', 'writing_renderer_lease_pair',
             ARRAY['renderer_affinity_claimed_at IS NULL',
                   'renderer_affinity_expires_at IS NULL']),
            ('writing_assignments', 'writing_renderer_lease_order',
             ARRAY['renderer_affinity_expires_at IS NULL',
                   'renderer_affinity_expires_at > renderer_affinity_claimed_at'])
        ) AS contract(table_name, constraint_name, required_fragments)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint con
             WHERE con.conrelid = to_regclass(
                       format('public.%I', expected.table_name)
                   )
               AND con.conname = expected.constraint_name
               AND con.contype = 'c'
               AND con.convalidated
               AND NOT EXISTS (
                   SELECT 1
                     FROM unnest(expected.required_fragments) fragment
                    WHERE strpos(pg_get_constraintdef(con.oid), fragment) = 0
               )
        ) THEN
            missing := array_append(
                missing, 'constraint-contract:' || expected.constraint_name
            );
        END IF;
    END LOOP;

    FOR expected IN
        SELECT * FROM (VALUES
            ('sessions', 'ix_sessions_active_resume_expiry', 'resume_expires_at'),
            ('reading_test_attempts', 'ix_reading_attempts_active_resume_expiry',
             'resume_expires_at'),
            ('listening_test_attempts', 'ix_listening_attempts_active_resume_expiry',
             'resume_expires_at'),
            ('dictation_attempts', 'ix_dictation_attempts_active_resume_expiry',
             'resume_expires_at'),
            ('writing_assignments', 'ix_writing_assignments_active_renderer_lease',
             'renderer_affinity_expires_at')
        ) AS contract(table_name, index_name, indexed_column)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_index idx
             WHERE idx.indexrelid = to_regclass(format('public.%I', expected.index_name))
               AND idx.indrelid = to_regclass(format('public.%I', expected.table_name))
               AND idx.indisvalid
               AND idx.indisready
               AND idx.indpred IS NOT NULL
               AND strpos(pg_get_indexdef(idx.indexrelid), expected.indexed_column) > 0
        ) THEN
            missing := array_append(missing, 'index-contract:' || expected.index_name);
        END IF;
    END LOOP;

    FOR expected IN
        SELECT * FROM (VALUES
            ('fn_claim_session_renderer_affinity(uuid,uuid,text)', false, true,
             ARRAY['active_player_expired', 'resume_expires_at > now()']),
            ('fn_claim_reading_attempt_renderer_affinity(uuid,uuid,text,text)', false, true,
             ARRAY['active_player_expired', 'resume_expires_at > now()']),
            ('fn_claim_listening_attempt_renderer_affinity(uuid,uuid,text)', false, true,
             ARRAY['active_player_expired', 'resume_expires_at > now()']),
            ('fn_claim_dictation_attempt_renderer_affinity(uuid,uuid,text)', false, true,
             ARRAY['active_player_expired', 'resume_expires_at > now()']),
            ('fn_claim_writing_assignment_renderer_affinity(uuid,uuid,text)', false, true,
             ARRAY['renderer_affinity_expires_at <= now()', 'INTERVAL ''24 hours''']),
            ('fn_upsert_listening_answer(uuid,integer,text)', true, true,
             ARRAY['resume_expires_at > now()', 'status = ''in_progress''']),
            ('fn_insert_listening_answer_once(uuid,integer,text)', true, true,
             ARRAY['resume_expires_at > now()', 'status = ''in_progress''']),
            ('fn_guard_reading_attempt_answer_mutation()', false, false,
             ARRAY['active_player_expired', 'resume_expires_at']),
            ('fn_guard_speaking_question_mutation()', false, false,
             ARRAY['active_player_expired', 'resume_expires_at',
                   'parent_status IS DISTINCT FROM ''in_progress''']),
            ('fn_guard_speaking_response_mutation()', false, false,
             ARRAY['active_player_expired', 'resume_expires_at',
                   'TG_OP = ''INSERT''', 'parent_status = ''in_progress''',
                   'NEW.audio_storage_path IS DISTINCT FROM OLD.audio_storage_path',
                   'NEW.raw_transcript_text IS DISTINCT FROM OLD.raw_transcript_text']),
            ('fn_guard_dictation_attempt_answer_mutation()', false, false,
             ARRAY['active_player_expired', 'resume_expires_at']),
            ('fn_guard_dictation_session_completion()', false, false,
             ARRAY['active_player_expired', 'resume_expires_at',
                   'parent_status = ''in_progress''', 'NEW.attempt_id IS NULL']),
            ('fn_guard_writing_draft_mutation()', false, false,
             ARRAY['active_player_expired', 'renderer_affinity_expires_at',
                   'parent_student_id IS DISTINCT FROM NEW.student_id',
                   'parent_affinity IS NULL AND parent_expiry IS NULL',
                   'INTERVAL ''24 hours''']),
            ('fn_guard_active_player_terminal_mutation()', false, false,
             ARRAY['active_player_expired', 'active_player_state_conflict',
                   'TG_TABLE_NAME = ''writing_assignments''',
                   'renderer_affinity_expires_at', 'resume_expires_at',
                   'leaves_open_player', 'links_learner_artifact',
                   'essay_id']),
            ('fn_set_active_player_resume_expiry()', false, false,
             ARRAY['TG_TABLE_NAME = ''listening_test_attempts''',
                   'NEW.resume_expires_at := NEW.started_at'])
        ) AS contract(
            signature,
            security_definer,
            service_role_execute_required,
            required_fragments
        )
    LOOP
        function_oid := to_regprocedure('public.' || expected.signature);
        IF function_oid IS NULL THEN
            missing := array_append(missing, 'function:' || expected.signature);
            CONTINUE;
        END IF;
        SELECT pg_get_functiondef(function_oid) INTO function_source;
        IF NOT EXISTS (
            SELECT 1 FROM pg_proc p
             WHERE p.oid = function_oid
               AND p.prosecdef = expected.security_definer
        ) THEN
            missing := array_append(missing, 'function-security:' || expected.signature);
        END IF;
        IF EXISTS (
            SELECT 1 FROM unnest(expected.required_fragments) fragment
             WHERE strpos(function_source, fragment) = 0
        ) THEN
            missing := array_append(missing, 'function-body:' || expected.signature);
        END IF;
        IF EXISTS (
            SELECT 1
              FROM pg_proc p
              CROSS JOIN LATERAL aclexplode(
                  COALESCE(p.proacl, acldefault('f', p.proowner))
              ) acl
             WHERE p.oid = function_oid
               AND acl.privilege_type = 'EXECUTE'
               AND acl.grantee IN (
                   0,
                   (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
                   (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
               )
        ) OR (
            expected.service_role_execute_required
            AND NOT has_function_privilege('service_role', function_oid, 'EXECUTE')
        ) THEN
            missing := array_append(missing, 'function-acl:' || expected.signature);
        END IF;
    END LOOP;

    FOR expected IN
        SELECT * FROM (VALUES
            ('sessions', 'trg_set_session_resume_expiry',
             'fn_set_active_player_resume_expiry()', 'BEFORE INSERT'),
            ('reading_test_attempts', 'trg_set_reading_attempt_resume_expiry',
             'fn_set_active_player_resume_expiry()', 'BEFORE INSERT'),
            ('listening_test_attempts', 'trg_set_listening_attempt_resume_expiry',
             'fn_set_active_player_resume_expiry()', 'BEFORE INSERT'),
            ('dictation_attempts', 'trg_set_dictation_attempt_resume_expiry',
             'fn_set_active_player_resume_expiry()', 'BEFORE INSERT'),
            ('questions', 'trg_guard_speaking_question_mutation',
             'fn_guard_speaking_question_mutation()', 'BEFORE INSERT OR UPDATE'),
            ('responses', 'trg_guard_speaking_response_mutation',
             'fn_guard_speaking_response_mutation()', 'BEFORE INSERT OR UPDATE'),
            ('reading_attempt_answers', 'trg_guard_reading_attempt_answer_mutation',
             'fn_guard_reading_attempt_answer_mutation()', 'BEFORE INSERT OR UPDATE'),
            ('dictation_attempt_answers', 'trg_guard_dictation_attempt_answer_mutation',
             'fn_guard_dictation_attempt_answer_mutation()', 'BEFORE INSERT OR UPDATE'),
            ('dictation_sessions', 'trg_00_guard_dictation_session_completion',
             'fn_guard_dictation_session_completion()', 'BEFORE INSERT'),
            ('writing_drafts', 'trg_guard_writing_draft_mutation',
             'fn_guard_writing_draft_mutation()', 'BEFORE INSERT OR UPDATE'),
            ('sessions', 'trg_guard_session_terminal_mutation',
             'fn_guard_active_player_terminal_mutation()', 'BEFORE UPDATE OF status'),
            ('reading_test_attempts', 'trg_guard_reading_attempt_terminal_mutation',
             'fn_guard_active_player_terminal_mutation()', 'BEFORE UPDATE OF status'),
            ('listening_test_attempts', 'trg_guard_listening_attempt_terminal_mutation',
             'fn_guard_active_player_terminal_mutation()', 'BEFORE UPDATE OF status'),
            ('writing_assignments', 'trg_guard_writing_assignment_terminal_mutation',
             'fn_guard_active_player_terminal_mutation()', 'BEFORE UPDATE OF status')
        ) AS contract(table_name, trigger_name, function_signature, event_contract)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_trigger trg
             WHERE trg.tgrelid = to_regclass(format('public.%I', expected.table_name))
               AND trg.tgname = expected.trigger_name
               AND trg.tgfoid = to_regprocedure(
                   'public.' || expected.function_signature
               )
               AND NOT trg.tgisinternal
               AND trg.tgenabled = 'O'
               AND strpos(pg_get_triggerdef(trg.oid), expected.event_contract) > 0
        ) THEN
            missing := array_append(missing, 'trigger-contract:' || expected.trigger_name);
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1 FROM public.sessions
         WHERE resume_expires_at <= started_at
            OR resume_expires_at > started_at + INTERVAL '24 hours'
        UNION ALL
        SELECT 1 FROM public.reading_test_attempts
         WHERE resume_expires_at <= started_at
            OR resume_expires_at > started_at + INTERVAL '24 hours'
        UNION ALL
        SELECT 1 FROM public.listening_test_attempts
         WHERE resume_expires_at <= COALESCE(started_at, created_at)
            OR resume_expires_at > COALESCE(started_at, created_at) + INTERVAL '24 hours'
        UNION ALL
        SELECT 1 FROM public.dictation_attempts
         WHERE resume_expires_at <= started_at
            OR resume_expires_at > started_at + INTERVAL '24 hours'
    ) THEN
        missing := array_append(missing, 'data:resume-expiry-outside-hard-ttl');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.writing_assignments
         WHERE (renderer_affinity_claimed_at IS NULL) <>
               (renderer_affinity_expires_at IS NULL)
            OR renderer_affinity_expires_at <= renderer_affinity_claimed_at
    ) THEN
        missing := array_append(missing, 'data:writing-renderer-lease-invalid');
    END IF;

    IF array_length(missing, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'migration 224 verification failed: %',
            array_to_string(missing, ', ');
    END IF;
END;
$$;

SELECT 'verified active-player TTL migration contract 224' AS result;
