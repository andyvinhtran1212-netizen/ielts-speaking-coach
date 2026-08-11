-- Read-only postcondition audit for reconcile_prod_gate_e_migrations.py.
--
-- This intentionally verifies durable FINAL contracts, not every superseded
-- intermediate function body from migrations 173-202.  Any missing anchor
-- aborts before the reconciliation procedure writes historical ledger rows.

DO $$
DECLARE
    missing   text[] := ARRAY[]::text[];
    item      text;
    tbl       text;
    col       text;
    fn_security boolean;
    fn_result text;
    fn_retset boolean;
    fn_arguments text;
    expected_check record;
    expected_column record;
    expected_evidence_fk record;
    expected_fk record;
    expected_index record;
    expected_pk record;
    expected_table record;
    expected_trigger record;
BEGIN
    -- Tables created by the audited history.
    FOREACH item IN ARRAY ARRAY[
        'courses',
        'class_lessons',
        'class_assignments',
        'class_assignment_items',
        'speaking_lesson_sets',
        'speaking_lesson_set_questions',
        'speaking_progress_marks',
        'course_writing_submissions',
        'course_writing_drafts',
        'class_action_log'
    ] LOOP
        IF to_regclass('public.' || item) IS NULL THEN
            missing := array_append(missing, 'table:' || item);
        END IF;
    END LOOP;

    -- Complete structural fingerprints for every table created by the audited
    -- range. Focused checks below provide readable diagnostics for operational
    -- contracts; these hashes close the residual gap by covering every column
    -- (order/name/type/nullability/default) and every table constraint. Both
    -- audited environments independently match this final 173-204 shape.
    FOR expected_table IN
        SELECT * FROM (VALUES
            ('class_action_log', 'e7f091fe1b1fd0dbf842576d5a1f5709', 11,
             '66055ecab39b450e11fc2a529c776c8d', 2),
            ('class_assignment_items', 'ce6ece6aed5694e124c88efe47de1319', 13,
             '2da9d3e9b38d7d709fd1469b54076154', 9),
            ('class_assignments', '93c0789e69084e8be087426f68136afa', 16,
             'c13ca7cf656bf783c7aa5cbed99486a1', 8),
            ('class_lessons', 'bafa54d302d3670c4ae2a39df210b8e8', 11,
             'bc7bcc611ae1fe97b1226a7d88fba7e9', 5),
            ('course_writing_drafts', 'f363a6f0056498516d4f061f2d9fccea', 7,
             '5f8960c8dc58ca5c830822799c9936cc', 3),
            ('course_writing_submissions', '1cd7c19eae1156745db96780cee2b3ec', 10,
             '576541f9ca975ff301f58643c0fd4411', 7),
            ('courses', '697a741779d2050d2607a78256c79298', 9,
             'ff83396dc07906bf6be243b42cec1fb0', 3),
            ('speaking_lesson_set_questions', 'dc84cd18618b95a7e5538b867fef71d3', 14,
             'dd0b5308ef38df8e821cfaf92c35930d', 5),
            ('speaking_lesson_sets', '6e7fc9c45565df4d477ced675e11b6bc', 10,
             '16c37494c9ef10bfaf5b6e0713f1c8d0', 6),
            ('speaking_progress_marks', '5938715f0be38ef6c7e8ac05ecadf099', 16,
             '6e538f05d20eceecc3b21c308dbd19bb', 3)
        ) AS expected(
            table_name, column_hash, column_count,
            constraint_hash, constraint_count
        )
    LOOP
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
    END LOOP;

    -- A relation name is not enough proof for tables created by the audited
    -- history. Every canonical table uses a server-authored UUID identity and
    -- a validated single-column primary key; pin both the column and its ready
    -- backing index before acknowledging the migrations in the ledger.
    FOR expected_pk IN
        SELECT table_name FROM (VALUES
            ('courses'),
            ('class_lessons'),
            ('class_assignments'),
            ('class_assignment_items'),
            ('speaking_lesson_sets'),
            ('speaking_lesson_set_questions'),
            ('speaking_progress_marks'),
            ('course_writing_submissions'),
            ('course_writing_drafts'),
            ('class_action_log')
        ) AS expected(table_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_attribute a
              JOIN pg_attrdef d
                ON d.adrelid = a.attrelid
               AND d.adnum = a.attnum
             WHERE a.attrelid = to_regclass(
                       format('public.%I', expected_pk.table_name)
                   )
               AND a.attname = 'id'
               AND NOT a.attisdropped
               AND format_type(a.atttypid, a.atttypmod) = 'uuid'
               AND a.attnotnull
               AND pg_get_expr(d.adbin, d.adrelid) = 'gen_random_uuid()'
        ) THEN
            missing := array_append(
                missing,
                'column-contract:' || expected_pk.table_name || '.id'
            );
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint con
              JOIN pg_index idx ON idx.indexrelid = con.conindid
             WHERE con.conrelid = to_regclass(
                       format('public.%I', expected_pk.table_name)
                   )
               AND con.conname = expected_pk.table_name || '_pkey'
               AND con.contype = 'p'
               AND con.convalidated
               AND idx.indrelid = con.conrelid
               AND idx.indisunique
               AND idx.indisvalid
               AND idx.indisready
               AND idx.indnkeyatts = 1
               AND idx.indnatts = 1
               AND idx.indexprs IS NULL
               AND idx.indpred IS NULL
               AND ARRAY(
                    SELECT att.attname
                      FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
                      JOIN pg_attribute att
                        ON att.attrelid = con.conrelid
                       AND att.attnum = key.attnum
                     ORDER BY key.ord
               ) = ARRAY['id']::name[]
        ) THEN
            missing := array_append(
                missing,
                'constraint-contract:' || expected_pk.table_name || '.primary-key'
            );
        END IF;
    END LOOP;

    -- Pin every direct FK introduced on the new course/assignment tables.
    -- Inline REFERENCES combined with ADD COLUMN IF NOT EXISTS cannot repair a
    -- hand-created column that omitted the relationship or chose CASCADE where
    -- canonical history preservation requires SET NULL.
    FOR expected_fk IN
        SELECT * FROM (VALUES
            ('courses', 'courses_created_by_fkey', ARRAY['created_by']::name[],
             'public.users', ARRAY['id']::name[], 'n'),
            ('cohorts', 'cohorts_course_id_fkey', ARRAY['course_id']::name[],
             'public.courses', ARRAY['id']::name[], 'n'),
            ('class_lessons', 'class_lessons_cohort_id_fkey', ARRAY['cohort_id']::name[],
             'public.cohorts', ARRAY['id']::name[], 'c'),
            ('class_lessons', 'class_lessons_created_by_fkey', ARRAY['created_by']::name[],
             'public.users', ARRAY['id']::name[], 'n'),
            ('class_assignments', 'class_assignments_cohort_id_fkey', ARRAY['cohort_id']::name[],
             'public.cohorts', ARRAY['id']::name[], 'c'),
            ('class_assignments', 'class_assignments_assigned_by_fkey', ARRAY['assigned_by']::name[],
             'public.users', ARRAY['id']::name[], 'n'),
            ('class_assignment_items', 'class_assignment_items_student_id_fkey', ARRAY['student_id']::name[],
             'public.students', ARRAY['id']::name[], 'c'),
            ('speaking_lesson_sets', 'speaking_lesson_sets_course_id_fkey', ARRAY['course_id']::name[],
             'public.courses', ARRAY['id']::name[], 'c'),
            ('speaking_lesson_sets', 'speaking_lesson_sets_created_by_fkey', ARRAY['created_by']::name[],
             'public.users', ARRAY['id']::name[], 'n'),
            ('speaking_lesson_set_questions', 'speaking_lesson_set_questions_set_id_fkey', ARRAY['set_id']::name[],
             'public.speaking_lesson_sets', ARRAY['id']::name[], 'c'),
            ('quiz_banks', 'quiz_banks_course_id_fkey', ARRAY['course_id']::name[],
             'public.courses', ARRAY['id']::name[], 'n'),
            ('course_writing_submissions', 'course_writing_submissions_bank_id_fkey', ARRAY['bank_id']::name[],
             'public.quiz_banks', ARRAY['id']::name[], 'c'),
            ('course_writing_submissions', 'course_writing_submissions_user_id_fkey', ARRAY['user_id']::name[],
             'auth.users', ARRAY['id']::name[], 'c'),
            ('course_writing_drafts', 'course_writing_drafts_class_assignment_item_id_fkey', ARRAY['class_assignment_item_id']::name[],
             'public.class_assignment_items', ARRAY['id']::name[], 'c'),
            ('course_writing_drafts', 'course_writing_drafts_user_id_fkey', ARRAY['user_id']::name[],
             'public.users', ARRAY['id']::name[], 'c')
        ) AS expected(
            table_name, constraint_name, local_columns,
            referenced_table, referenced_columns, delete_action
        )
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint con
             WHERE con.conrelid = to_regclass(
                       format('public.%I', expected_fk.table_name)
                   )
               AND con.conname = expected_fk.constraint_name
               AND con.contype = 'f'
               AND con.convalidated
               AND con.confrelid = to_regclass(expected_fk.referenced_table)
               AND con.confupdtype = 'a'
               AND con.confdeltype::text = expected_fk.delete_action
               AND con.confmatchtype = 's'
               AND con.confdelsetcols IS NULL
               AND ARRAY(
                    SELECT att.attname
                      FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
                      JOIN pg_attribute att
                        ON att.attrelid = con.conrelid
                       AND att.attnum = key.attnum
                     ORDER BY key.ord
               ) = expected_fk.local_columns
               AND ARRAY(
                    SELECT att.attname
                      FROM unnest(con.confkey) WITH ORDINALITY AS key(attnum, ord)
                      JOIN pg_attribute att
                        ON att.attrelid = con.confrelid
                       AND att.attnum = key.attnum
                     ORDER BY key.ord
               ) = expected_fk.referenced_columns
        ) THEN
            missing := array_append(
                missing,
                'constraint-contract:' || expected_fk.table_name || '.'
                    || expected_fk.constraint_name
            );
        END IF;
    END LOOP;

    -- Every column introduced on a pre-existing relation in the audited range,
    -- plus the payload columns on newly-created writing/audit relations, must
    -- keep its exact type, nullability and server default. ADD COLUMN IF NOT
    -- EXISTS cannot repair a hand-provisioned column with a different default;
    -- existence-only checks can therefore baseline a schema that silently
    -- changes ordinary inserts.
    FOR expected_column IN
        SELECT * FROM (VALUES
            ('cohorts', 'course_id', 'uuid', false, NULL::text),
            ('sessions', 'class_assignment_item_id', 'uuid', false, NULL::text),
            ('sessions', 'full_test_attempt_id', 'uuid', false, NULL::text),
            ('reading_test_attempts', 'class_assignment_item_id', 'uuid', false, NULL::text),
            ('listening_test_attempts', 'class_assignment_item_id', 'uuid', false, NULL::text),
            ('topic_questions', 'audio_url', 'text', false, NULL::text),
            ('topic_questions', 'audio_path', 'text', false, NULL::text),
            ('topic_questions', 'level', 'text', false, NULL::text),
            ('questions', 'audio_url', 'text', false, NULL::text),
            ('questions', 'listen_only', 'boolean', true, 'false'),
            ('quiz_questions', 'why_wrong', 'jsonb', false, NULL::text),
            ('quiz_banks', 'course_id', 'uuid', false, NULL::text),
            ('quiz_banks', 'lesson_no', 'integer', false, NULL::text),
            ('quiz_sessions', 'class_assignment_item_id', 'uuid', false, NULL::text),
            ('quiz_sessions', 'kind', 'text', true, '''run''::text'),
            ('responses', 'persisted_at', 'timestamp with time zone', true, 'now()'),
            ('user_feedback', 'anonymous_dedupe_key', 'text', false, NULL::text),
            ('class_assignments', 'status', 'text', true, '''published''::text'),
            ('course_writing_submissions', 'bank_id', 'uuid', true, NULL::text),
            ('course_writing_submissions', 'user_id', 'uuid', true, NULL::text),
            ('course_writing_submissions', 'class_assignment_item_id', 'uuid', false, NULL::text),
            ('course_writing_submissions', 'items', 'jsonb', true, NULL::text),
            ('course_writing_submissions', 'total', 'integer', true, NULL::text),
            ('course_writing_submissions', 'clean', 'integer', true, NULL::text),
            ('course_writing_submissions', 'graded_at', 'timestamp with time zone', true, 'now()'),
            ('course_writing_submissions', 'created_at', 'timestamp with time zone', true, 'now()'),
            ('course_writing_drafts', 'class_assignment_item_id', 'uuid', true, NULL::text),
            ('course_writing_drafts', 'user_id', 'uuid', true, NULL::text),
            ('course_writing_drafts', 'bank_id', 'uuid', true, NULL::text),
            ('course_writing_drafts', 'answers', 'jsonb', true, '''{}''::jsonb'),
            ('course_writing_drafts', 'updated_at', 'timestamp with time zone', true, 'now()'),
            ('course_writing_drafts', 'created_at', 'timestamp with time zone', true, 'now()'),
            ('class_action_log', 'action', 'text', true, NULL::text),
            ('class_action_log', 'cohort_id', 'uuid', true, NULL::text),
            ('class_action_log', 'assignment_id', 'uuid', false, NULL::text),
            ('class_action_log', 'student_id', 'uuid', false, NULL::text),
            ('class_action_log', 'assignment_title', 'text', false, NULL::text),
            ('class_action_log', 'student_name', 'text', false, NULL::text),
            ('class_action_log', 'actor_user_id', 'uuid', false, NULL::text),
            ('class_action_log', 'actor_email', 'text', false, NULL::text),
            ('class_action_log', 'details', 'jsonb', true, '''{}''::jsonb'),
            ('class_action_log', 'created_at', 'timestamp with time zone', true, 'now()')
        ) AS expected(
            table_name, column_name, formatted_type, not_null, default_expression
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
               AND NOT a.attisdropped
               AND format_type(a.atttypid, a.atttypmod) =
                   expected_column.formatted_type
               AND a.attnotnull = expected_column.not_null
               AND pg_get_expr(d.adbin, d.adrelid) IS NOT DISTINCT FROM
                   expected_column.default_expression
        ) THEN
            missing := array_append(
                missing,
                'column-contract:' || expected_column.table_name || '.'
                    || expected_column.column_name
            );
        END IF;
    END LOOP;

    -- Columns that survive the final state of 173-202.
    FOR tbl, col IN
        SELECT * FROM (VALUES
            ('cohorts', 'course_id'),
            ('sessions', 'class_assignment_item_id'),
            ('sessions', 'full_test_attempt_id'),
            ('reading_test_attempts', 'class_assignment_item_id'),
            ('listening_test_attempts', 'class_assignment_item_id'),
            ('topic_questions', 'audio_url'),
            ('topic_questions', 'audio_path'),
            ('topic_questions', 'level'),
            ('questions', 'audio_url'),
            ('questions', 'listen_only'),
            ('class_assignments', 'kind'),
            ('class_assignments', 'recipient_scope'),
            ('quiz_questions', 'why_wrong'),
            ('quiz_banks', 'course_id'),
            ('quiz_banks', 'lesson_no'),
            ('quiz_sessions', 'class_assignment_item_id'),
            ('quiz_sessions', 'kind'),
            ('class_assignment_items', 'passed_at'),
            ('class_assignment_items', 'mastery'),
            ('responses', 'persisted_at')
        ) AS expected(table_name, column_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = tbl
               AND column_name = col
        ) THEN
            missing := array_append(missing, 'column:' || tbl || '.' || col);
        END IF;
    END LOOP;

    -- The completed learner artifact must outlive deletion of an unsubmitted
    -- assignment. Migrations 177/181/188/190 therefore link every evidence
    -- table to the per-student ledger with ON DELETE SET NULL. Pin the complete
    -- FK shape: a missing FK can leave a dangling id, while CASCADE can destroy
    -- the canonical session/attempt/submission together with the assignment.
    FOR expected_evidence_fk IN
        SELECT * FROM (VALUES
            ('sessions', 'sessions_class_assignment_item_id_fkey'),
            ('reading_test_attempts', 'reading_test_attempts_class_assignment_item_id_fkey'),
            ('listening_test_attempts', 'listening_test_attempts_class_assignment_item_id_fkey'),
            ('quiz_sessions', 'quiz_sessions_class_assignment_item_id_fkey'),
            ('course_writing_submissions', 'course_writing_submissions_class_assignment_item_id_fkey')
        ) AS expected(table_name, constraint_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint con
             WHERE con.conrelid = to_regclass(
                       format('public.%I', expected_evidence_fk.table_name)
                   )
               AND con.conname = expected_evidence_fk.constraint_name
               AND con.contype = 'f'
               AND con.convalidated
               AND con.confrelid = 'public.class_assignment_items'::regclass
               AND con.confupdtype = 'a'
               AND con.confdeltype = 'n'
               AND con.confmatchtype = 's'
               AND con.confdelsetcols IS NULL
               AND ARRAY(
                    SELECT att.attname
                      FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
                      JOIN pg_attribute att
                        ON att.attrelid = con.conrelid
                       AND att.attnum = key.attnum
                     ORDER BY key.ord
               ) = ARRAY['class_assignment_item_id']::name[]
               AND ARRAY(
                    SELECT att.attname
                      FROM unnest(con.confkey) WITH ORDINALITY AS key(attnum, ord)
                      JOIN pg_attribute att
                        ON att.attrelid = con.confrelid
                       AND att.attnum = key.attnum
                     ORDER BY key.ord
               ) = ARRAY['id']::name[]
        ) THEN
            missing := array_append(
                missing,
                'constraint-contract:' || expected_evidence_fk.table_name
                    || '.class_assignment_item'
            );
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'course_writing_drafts'
           AND column_name = 'seq'
    ) THEN
        missing := array_append(missing, 'removed-column:course_writing_drafts.seq');
    END IF;

    IF to_regprocedure(
        'public.fn_save_course_writing_draft(uuid,uuid,uuid,jsonb,bigint)'
    ) IS NOT NULL THEN
        missing := array_append(
            missing,
            'removed-function:fn_save_course_writing_draft(uuid,uuid,uuid,jsonb,bigint)'
        );
    END IF;

    -- Migration 202 is a receipt/evidence contract, not just a column name.
    -- ADD COLUMN IF NOT EXISTS cannot repair a manually-created weaker column,
    -- so refuse to baseline unless type, nullability and server default match.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attrdef d
            ON d.adrelid = a.attrelid
           AND d.adnum = a.attnum
         WHERE n.nspname = 'public'
           AND c.relname = 'responses'
           AND a.attname = 'persisted_at'
           AND NOT a.attisdropped
           AND format_type(a.atttypid, a.atttypmod) = 'timestamp with time zone'
           AND a.attnotnull
           AND pg_get_expr(d.adbin, d.adrelid) = 'now()'
    ) THEN
        missing := array_append(missing, 'column-contract:responses.persisted_at');
    END IF;

    -- Migration 193's recipient scope controls whether a backfill may expand an
    -- assignment to the whole class. A nullable/default-less text column can
    -- make SQL's NULL comparison bypass the subset guard, so pin the complete
    -- column contract rather than accepting the surviving column name.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_attribute a
          JOIN pg_attrdef d
            ON d.adrelid = a.attrelid
           AND d.adnum = a.attnum
         WHERE a.attrelid = 'public.class_assignments'::regclass
           AND a.attname = 'recipient_scope'
           AND NOT a.attisdropped
           AND format_type(a.atttypid, a.atttypmod) = 'text'
           AND a.attnotnull
           AND pg_get_expr(d.adbin, d.adrelid) = '''class''::text'
    ) THEN
        missing := array_append(
            missing,
            'column-contract:class_assignments.recipient_scope'
        );
    END IF;

    -- Migration 177's assignment payload is a required JSON object consumed by
    -- every skill route and the atomic creation RPC. A surviving table with a
    -- missing, nullable or default-less column is not the migration contract.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_attribute a
          JOIN pg_attrdef d
            ON d.adrelid = a.attrelid
           AND d.adnum = a.attnum
         WHERE a.attrelid = 'public.class_assignments'::regclass
           AND a.attname = 'content_config'
           AND NOT a.attisdropped
           AND format_type(a.atttypid, a.atttypmod) = 'jsonb'
           AND a.attnotnull
           AND pg_get_expr(d.adbin, d.adrelid) = '''{}''::jsonb'
    ) THEN
        missing := array_append(
            missing,
            'column-contract:class_assignments.content_config'
        );
    END IF;

    -- Both assignment fan-out RPCs omit `state` deliberately and depend on
    -- migration 177's server-authored initial value. A nullable/default-less
    -- column either rejects every assignment or creates invisible ledger rows.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_attribute a
          JOIN pg_attrdef d
            ON d.adrelid = a.attrelid
           AND d.adnum = a.attnum
         WHERE a.attrelid = 'public.class_assignment_items'::regclass
           AND a.attname = 'state'
           AND NOT a.attisdropped
           AND format_type(a.atttypid, a.atttypmod) = 'text'
           AND a.attnotnull
           AND pg_get_expr(d.adbin, d.adrelid) = '''assigned''::text'
    ) THEN
        missing := array_append(
            missing,
            'column-contract:class_assignment_items.state'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conrelid = 'public.class_assignment_items'::regclass
           AND con.conname = 'class_assignment_items_state_check'
           AND con.contype = 'c'
           AND con.convalidated
           AND pg_get_constraintdef(con.oid) =
               'CHECK ((state = ANY (ARRAY[''assigned''::text, '
               '''opened''::text, ''submitted''::text, ''graded''::text])))'
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:class_assignment_items.state'
        );
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.class_assignment_items
         WHERE state IS NULL
            OR state NOT IN ('assigned', 'opened', 'submitted', 'graded')
    ) THEN
        missing := array_append(missing, 'data:class_assignment_items.state');
    END IF;

    -- Both the live grader and the repair backfill upsert progress marks on
    -- response_id. Pin the complete conflict-target contract; UNIQUE alone
    -- permits NULL, and a same-named ordinary index cannot service ON CONFLICT.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_attribute a
         WHERE a.attrelid = 'public.speaking_progress_marks'::regclass
           AND a.attname = 'response_id'
           AND NOT a.attisdropped
           AND format_type(a.atttypid, a.atttypmod) = 'uuid'
           AND a.attnotnull
           AND NOT EXISTS (
                SELECT 1
                  FROM pg_attrdef d
                 WHERE d.adrelid = a.attrelid
                   AND d.adnum = a.attnum
           )
    ) THEN
        missing := array_append(
            missing,
            'column-contract:speaking_progress_marks.response_id'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
          JOIN pg_index idx ON idx.indexrelid = con.conindid
         WHERE con.conrelid = 'public.speaking_progress_marks'::regclass
           AND con.conname = 'speaking_progress_marks_response_id_key'
           AND con.contype = 'u'
           AND con.convalidated
           AND idx.indrelid = con.conrelid
           AND idx.indisunique
           AND idx.indisvalid
           AND idx.indisready
           AND idx.indnkeyatts = 1
           AND idx.indnatts = 1
           AND idx.indexprs IS NULL
           AND idx.indpred IS NULL
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.conrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['response_id']::name[]
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:speaking_progress_marks.response-id-unique'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conrelid = 'public.speaking_progress_marks'::regclass
           AND con.conname = 'speaking_progress_marks_response_id_fkey'
           AND con.contype = 'f'
           AND con.convalidated
           AND con.confrelid = 'public.responses'::regclass
           AND con.confupdtype = 'a'
           AND con.confdeltype = 'c'
           AND con.confmatchtype = 's'
           AND con.confdelsetcols IS NULL
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.conrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['response_id']::name[]
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(con.confkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.confrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['id']::name[]
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:speaking_progress_marks.response-parent'
        );
    END IF;

    IF EXISTS (
        SELECT response_id
          FROM public.speaking_progress_marks
         GROUP BY response_id
        HAVING response_id IS NULL OR count(*) > 1
    ) THEN
        missing := array_append(
            missing,
            'data:speaking_progress_marks.response-id-duplicate'
        );
    END IF;

    -- Course code is the stable public/admin identity and the seed itself uses
    -- ON CONFLICT(code). The admin create/update routes rely on this exact key
    -- to reject a duplicate course with 409 instead of creating split truth.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_attribute a
         WHERE a.attrelid = 'public.courses'::regclass
           AND a.attname = 'code'
           AND NOT a.attisdropped
           AND format_type(a.atttypid, a.atttypmod) = 'text'
           AND a.attnotnull
           AND NOT EXISTS (
                SELECT 1
                  FROM pg_attrdef d
                 WHERE d.adrelid = a.attrelid
                   AND d.adnum = a.attnum
           )
    ) THEN
        missing := array_append(missing, 'column-contract:courses.code');
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
          JOIN pg_index idx ON idx.indexrelid = con.conindid
         WHERE con.conrelid = 'public.courses'::regclass
           AND con.conname = 'courses_code_key'
           AND con.contype = 'u'
           AND con.convalidated
           AND idx.indrelid = con.conrelid
           AND idx.indisunique
           AND idx.indisvalid
           AND idx.indisready
           AND idx.indnkeyatts = 1
           AND idx.indnatts = 1
           AND idx.indexprs IS NULL
           AND idx.indpred IS NULL
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.conrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['code']::name[]
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:courses.code-unique'
        );
    END IF;

    IF EXISTS (
        SELECT code
          FROM public.courses
         GROUP BY code
        HAVING code IS NULL OR count(*) > 1
    ) THEN
        missing := array_append(missing, 'data:courses.code-duplicate');
    END IF;

    -- Migration 189 widened score specifically so a perfect quiz percentage
    -- (100.0) remains representable. Constraint-name existence cannot prove
    -- either that typmod change or the validated canonical 0..100 domain.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_attribute a
         WHERE a.attrelid = 'public.class_assignment_items'::regclass
           AND a.attname = 'score'
           AND NOT a.attisdropped
           AND format_type(a.atttypid, a.atttypmod) = 'numeric(4,1)'
    ) THEN
        missing := array_append(
            missing,
            'column-contract:class_assignment_items.score'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conrelid = 'public.class_assignment_items'::regclass
           AND con.conname = 'class_assignment_items_score_check'
           AND con.contype = 'c'
           AND con.convalidated
           AND pg_get_constraintdef(con.oid) =
               'CHECK (((score IS NULL) OR ((score >= (0)::numeric) '
               'AND (score <= (100)::numeric))))'
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:class_assignment_items.score'
        );
    END IF;

    -- Final function signatures.  Intermediate overloads are intentionally not
    -- accepted as proof: the current callers depend on these exact signatures.
    FOREACH item IN ARRAY ARRAY[
        'public.fn_insert_listening_answer_once(uuid,integer,text)',
        'public.fn_create_class_assignment(uuid,text,text,uuid,jsonb,uuid,text,timestamp with time zone,timestamp with time zone,text,uuid,text,uuid[])',
        'public.fn_backfill_assignment_items(uuid,uuid[])',
        'public.fn_delete_class_assignment_if_unsubmitted(uuid,uuid)',
        'public.fn_bind_session_to_class_item(uuid,uuid,uuid)',
        'public.quiz_replace_questions(uuid,jsonb)',
        'public.fn_class_action_log_append_only()',
        'public.set_speaking_full_test_attempt_id()',
        'public.fn_create_session_daily_capped_v2(uuid,uuid,text,integer,text,timestamp with time zone,integer)'
    ] LOOP
        IF to_regprocedure(item) IS NULL THEN
            missing := array_append(missing, 'function:' || item);
        END IF;
    END LOOP;

    -- Migration 174's signature and ACL are not enough: the router depends on
    -- this exact SECURITY DEFINER implementation to preserve the first answer,
    -- distinguish TRUE/FALSE/NULL, and close concurrent retry races. Both
    -- audited environments carry this canonical body hash.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_proc p
          JOIN pg_language l ON l.oid = p.prolang
         WHERE p.oid = to_regprocedure(
                   'public.fn_insert_listening_answer_once(uuid,integer,text)'
               )
           AND l.lanname = 'plpgsql'
           AND p.prorettype = 'boolean'::regtype
           AND NOT p.proretset
           AND p.prokind = 'f'
           AND NOT p.proisstrict
           AND p.prosecdef
           AND p.provolatile = 'v'
           AND p.proparallel = 'u'
           AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
           AND md5(p.prosrc) = '856941cccd7f1e4a4df130f9286a189f'
    ) THEN
        missing := array_append(
            missing,
            'function-contract:fn_insert_listening_answer_once'
        );
    END IF;

    -- Migration 180 deliberately replaced migration 179's same-signature body
    -- to lock both the assignment item and its parent assignment. Signature and
    -- ACL checks cannot distinguish the stale one-row-lock implementation, so
    -- pin the audited final body and execution properties before baselining it.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_proc p
          JOIN pg_language l ON l.oid = p.prolang
         WHERE p.oid = to_regprocedure(
                   'public.fn_bind_session_to_class_item(uuid,uuid,uuid)'
               )
           AND l.lanname = 'plpgsql'
           AND p.prorettype = 'boolean'::regtype
           AND NOT p.proretset
           AND p.prokind = 'f'
           AND NOT p.proisstrict
           AND p.prosecdef
           AND p.provolatile = 'v'
           AND p.proparallel = 'u'
           AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
           AND md5(p.prosrc) = '804aff9dc563a6d6361efd8d1a511f4c'
    ) THEN
        missing := array_append(
            missing,
            'function-contract:fn_bind_session_to_class_item'
        );
    END IF;

    -- Migration 193's subgroup backfill must keep both the subset guard and the
    -- cohort-scoped recipient selection. Its signature and backend-only ACL do
    -- not distinguish an unsafe whole-class implementation, so pin the audited
    -- final body and execution properties before recording migration 193.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_proc p
          JOIN pg_language l ON l.oid = p.prolang
         WHERE p.oid = to_regprocedure(
                   'public.fn_backfill_assignment_items(uuid,uuid[])'
               )
           AND l.lanname = 'plpgsql'
           AND p.prorettype = 'record'::regtype
           AND p.proretset
           AND p.prokind = 'f'
           AND NOT p.proisstrict
           AND pg_get_function_result(p.oid) =
               'TABLE(added integer, student_count integer)'
           AND pg_get_function_arguments(p.oid) =
               'p_assignment_id uuid, p_student_ids uuid[] DEFAULT NULL::uuid[]'
           AND p.prosecdef
           AND p.provolatile = 'v'
           AND p.proparallel = 'u'
           AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
           AND md5(p.prosrc) = '578c2592304f1866bd26931384af8513'
    ) THEN
        missing := array_append(
            missing,
            'function-contract:fn_backfill_assignment_items'
        );
    END IF;

    -- These remaining RPCs are final-body replacements or atomicity/security
    -- boundaries. A signature, object name and ACL can all survive an older or
    -- hand-written implementation, so pin their canonical audited bodies and
    -- execution properties as a single exhaustive contract table.
    FOR item, col, tbl, fn_security, fn_result, fn_retset, fn_arguments IN
        SELECT * FROM (VALUES
            (
                'public.fn_create_class_assignment(uuid,text,text,uuid,jsonb,uuid,text,timestamp with time zone,timestamp with time zone,text,uuid,text,uuid[])',
                'ee2d9cb823b7bee3d953608ff9b8466b',
                'pg_catalog.record', true,
                'TABLE(assignment jsonb, student_count integer, unactivated_count integer)',
                true,
                'p_cohort_id uuid, p_skill text, p_title text, '
                'p_lesson_id uuid DEFAULT NULL::uuid, '
                'p_content_config jsonb DEFAULT ''{}''::jsonb, '
                'p_content_id uuid DEFAULT NULL::uuid, '
                'p_instructions text DEFAULT NULL::text, '
                'p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, '
                'p_publish_at timestamp with time zone DEFAULT NULL::timestamp with time zone, '
                'p_status text DEFAULT ''published''::text, '
                'p_assigned_by uuid DEFAULT NULL::uuid, '
                'p_kind text DEFAULT ''daily''::text, '
                'p_student_ids uuid[] DEFAULT NULL::uuid[]'
            ),
            (
                'public.fn_delete_class_assignment_if_unsubmitted(uuid,uuid)',
                '93753c50092f72543734884464d2f7ef',
                'boolean', true, 'boolean', false,
                'p_assignment_id uuid, p_cohort_id uuid'
            ),
            (
                'public.quiz_replace_questions(uuid,jsonb)',
                'c8098f0e3198f841ef1dc81124edbeb6',
                'integer', false, 'integer', false,
                'p_bank_id uuid, p_rows jsonb'
            ),
            (
                'public.set_speaking_full_test_attempt_id()',
                '118d4c2e7c69140ab7c5657f9f9cefd0',
                'pg_catalog.trigger', false, 'trigger', false, ''
            ),
            (
                'public.fn_create_session_daily_capped_v2(uuid,uuid,text,integer,text,timestamp with time zone,integer)',
                'ddb02c330107b985d6a5facfda95ffa9',
                'public.sessions', false, 'SETOF sessions', true,
                'p_session_id uuid, p_user_id uuid, p_mode text, '
                'p_part integer, p_topic text, '
                'p_day_start timestamp with time zone, p_max_daily integer'
            )
        ) AS expected(
            signature, body_md5, return_type, security_definer,
            result_shape, returns_set, arguments
        )
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_proc p
              JOIN pg_language l ON l.oid = p.prolang
             WHERE p.oid = to_regprocedure(item)
               AND l.lanname = 'plpgsql'
               AND p.prorettype = to_regtype(tbl)
               AND p.proretset = fn_retset
               AND p.prokind = 'f'
               AND NOT p.proisstrict
               AND pg_get_function_result(p.oid) = fn_result
               AND pg_get_function_arguments(p.oid) = fn_arguments
               AND p.prosecdef = fn_security
               AND p.provolatile = 'v'
               AND p.proparallel = 'u'
               AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
               AND md5(p.prosrc) = col
        ) THEN
            missing := array_append(
                missing,
                'function-contract:' || split_part(split_part(item, '(', 1), '.', 2)
            );
        END IF;
    END LOOP;

    -- The trigger OID only proves which function is called, not that the
    -- function still raises. Pin migration 198's canonical append-only body so
    -- service_role cannot bypass the audit guarantee through a RETURN OLD body.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_proc p
          JOIN pg_language l ON l.oid = p.prolang
         WHERE p.oid = to_regprocedure(
                   'public.fn_class_action_log_append_only()'
               )
           AND l.lanname = 'plpgsql'
           AND p.prorettype = 'trigger'::regtype
           AND NOT p.proretset
           AND p.prokind = 'f'
           AND NOT p.proisstrict
           AND NOT p.prosecdef
           AND p.provolatile = 'v'
           AND p.proparallel = 'u'
           AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[]
           AND md5(p.prosrc) = '3c0a0fbc7f3f6da45c1e47bda5d4e10d'
    ) THEN
        missing := array_append(
            missing,
            'function-contract:fn_class_action_log_append_only'
        );
    END IF;

    -- These RPCs either bypass RLS (SECURITY DEFINER) or perform destructive
    -- bulk replacement. Function existence is not proof that a manual provision
    -- also applied the mandatory REVOKE. A PUBLIC grant is inherited by both
    -- roles, so effective privilege checks catch direct and PUBLIC grants.
    FOREACH item IN ARRAY ARRAY[
        'public.fn_insert_listening_answer_once(uuid,integer,text)',
        'public.fn_create_class_assignment(uuid,text,text,uuid,jsonb,uuid,text,timestamp with time zone,timestamp with time zone,text,uuid,text,uuid[])',
        'public.fn_backfill_assignment_items(uuid,uuid[])',
        'public.fn_delete_class_assignment_if_unsubmitted(uuid,uuid)',
        'public.fn_bind_session_to_class_item(uuid,uuid,uuid)',
        'public.quiz_replace_questions(uuid,jsonb)'
    ] LOOP
        IF has_function_privilege('anon', item, 'EXECUTE')
           OR has_function_privilege('authenticated', item, 'EXECUTE')
           OR NOT has_function_privilege('service_role', item, 'EXECUTE') THEN
            missing := array_append(missing, 'service-only-acl:' || item);
        END IF;
    END LOOP;

    -- Pin the remaining CHECK constraints that are not covered by the focused
    -- contracts below. Name-only checks are unsafe here because every source
    -- migration uses IF NOT EXISTS or manual provisioning may have reused the
    -- canonical name with a weaker expression.
    FOR expected_check IN
        SELECT * FROM (VALUES
            (
                'class_assignments',
                'class_assignments_kind_check',
                $check$CHECK ((kind = ANY (ARRAY['daily'::text, 'lesson'::text])))$check$
            ),
            (
                'class_assignments',
                'class_assignments_status_check',
                $check$CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))$check$
            ),
            (
                'class_assignment_items',
                'class_assignment_items_artifact_pairing',
                $check$CHECK ((((artifact_kind IS NULL) AND (artifact_id IS NULL)) OR ((artifact_kind IS NOT NULL) AND (artifact_id IS NOT NULL))))$check$
            ),
            (
                'class_assignment_items',
                'class_assignment_items_submitted_at_required',
                $check$CHECK (((state <> ALL (ARRAY['submitted'::text, 'graded'::text])) OR (submitted_at IS NOT NULL)))$check$
            ),
            (
                'topic_questions',
                'topic_questions_level_check',
                $check$CHECK (((level IS NULL) OR (level = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text]))))$check$
            ),
            (
                'quiz_banks',
                'quiz_banks_lesson_no_check',
                $check$CHECK (((lesson_no IS NULL) OR (lesson_no >= 1)))$check$
            ),
            (
                'quiz_sessions',
                'quiz_sessions_kind_check',
                $check$CHECK ((kind = ANY (ARRAY['run'::text, 'retake'::text])))$check$
            ),
            (
                'sessions',
                'sessions_full_test_attempt_required',
                $check$CHECK (((mode <> 'test_full'::text) OR (full_test_attempt_id IS NOT NULL)))$check$
            ),
            (
                'course_writing_submissions',
                'course_writing_submissions_total_check',
                $check$CHECK ((total >= 0))$check$
            ),
            (
                'course_writing_submissions',
                'course_writing_submissions_clean_check',
                $check$CHECK ((clean >= 0))$check$
            ),
            (
                'course_writing_submissions',
                'course_writing_clean_within_total',
                $check$CHECK ((clean <= total))$check$
            ),
            (
                'class_action_log',
                'class_action_log_action_check',
                $check$CHECK ((action = ANY (ARRAY['due_change'::text, 'return_work'::text])))$check$
            ),
            (
                'user_feedback',
                'user_feedback_skill_check',
                $check$CHECK ((skill = ANY (ARRAY['reading'::text, 'listening'::text, 'vocabulary'::text])))$check$
            ),
            (
                'user_feedback',
                'user_feedback_anonymous_dedupe_scope',
                $check$CHECK (((anonymous_dedupe_key IS NULL) OR ((skill = 'vocabulary'::text) AND (type = 'report'::text) AND (created_by IS NULL))))$check$
            )
        ) AS expected(table_name, constraint_name, definition)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint con
             WHERE con.conname = expected_check.constraint_name
               AND con.conrelid = to_regclass(
                       format('public.%I', expected_check.table_name)
                   )
               AND con.contype = 'c'
               AND con.convalidated
               AND pg_get_constraintdef(con.oid) = expected_check.definition
        ) THEN
            missing := array_append(
                missing,
                'constraint-contract:' || expected_check.table_name || '.'
                    || expected_check.constraint_name
            );
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
          FROM public.class_assignments
         WHERE status IS NULL
            OR status NOT IN ('draft', 'published', 'archived')
    ) THEN
        missing := array_append(missing, 'data:class_assignments.status');
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.class_action_log
         WHERE action IS NULL
            OR action NOT IN ('due_change', 'return_work')
    ) THEN
        missing := array_append(missing, 'data:class_action_log.action');
    END IF;

    -- Migration 177 establishes the one-ledger-item-per-student invariant used
    -- by every assignment reader and by concurrent migration-193 backfills.
    -- Pin the constraint and its ready backing index, not merely an index name.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
          JOIN pg_index idx ON idx.indexrelid = con.conindid
         WHERE con.conrelid = 'public.class_assignment_items'::regclass
           AND con.conname =
               'class_assignment_items_assignment_id_student_id_key'
           AND con.contype = 'u'
           AND con.convalidated
           AND idx.indrelid = con.conrelid
           AND idx.indisunique
           AND idx.indisvalid
           AND idx.indisready
           AND idx.indnkeyatts = 2
           AND idx.indnatts = 2
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.conrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['assignment_id', 'student_id']::name[]
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:class_assignment_items.assignment-student'
        );
    END IF;

    -- Deleting an eligible assignment must remove its per-student ledger rows.
    -- Pin migration 177's parent FK rather than trusting the conventional name.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conrelid = 'public.class_assignment_items'::regclass
           AND con.conname = 'class_assignment_items_assignment_id_fkey'
           AND con.contype = 'f'
           AND con.convalidated
           AND con.confrelid = 'public.class_assignments'::regclass
           AND con.confupdtype = 'a'
           AND con.confdeltype = 'c'
           AND con.confmatchtype = 's'
           AND con.confdelsetcols IS NULL
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.conrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['assignment_id']::name[]
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(con.confkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.confrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['id']::name[]
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:class_assignment_items.assignment-parent'
        );
    END IF;

    -- Migration 178 replaces the unsafe independent lesson FK with a composite
    -- same-cohort relationship. Pin both sides and the PG15+ SET NULL column
    -- list; names alone could hide the old single-column constraint.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conrelid = 'public.class_lessons'::regclass
           AND con.conname = 'class_lessons_id_cohort_key'
           AND con.contype = 'u'
           AND con.convalidated
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.conrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['id', 'cohort_id']::name[]
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:class_lessons.id-cohort'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conrelid = 'public.class_assignments'::regclass
           AND con.conname = 'class_assignments_lesson_cohort_fkey'
           AND con.contype = 'f'
           AND con.convalidated
           AND con.confrelid = 'public.class_lessons'::regclass
           AND con.confupdtype = 'a'
           AND con.confdeltype = 'n'
           AND con.confmatchtype = 's'
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.conrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['lesson_id', 'cohort_id']::name[]
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(con.confkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.confrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['id', 'cohort_id']::name[]
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(con.confdelsetcols) WITH ORDINALITY
                       AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.conrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['lesson_id']::name[]
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:class_assignments.lesson-cohort'
        );
    END IF;

    -- The audit log's append-only guarantee must survive service_role bypassing
    -- RLS. A same-named disabled, statement-level, one-event, AFTER, or
    -- wrong-function trigger is not migration 198's contract. PostgreSQL tgtype
    -- 27 = ROW(1) | BEFORE(2) | DELETE(8) | UPDATE(16).
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger
         WHERE tgname = 'trg_class_action_log_append_only'
           AND tgrelid = 'public.class_action_log'::regclass
           AND NOT tgisinternal
           AND tgenabled = 'O'
           AND tgtype = 27
           AND tgfoid = to_regprocedure('public.fn_class_action_log_append_only()')
    ) THEN
        missing := array_append(
            missing,
            'trigger-contract:class_action_log.append-only'
        );
    END IF;

    -- Migration 198 deliberately keeps the append-only audit log detached from
    -- mutable entities. Any FK action would either erase/history-edit rows or
    -- collide with the trigger and make ordinary class/assignment deletion
    -- fail, so reject even an unvalidated foreign key.
    IF EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conrelid = 'public.class_action_log'::regclass
           AND con.contype = 'f'
    ) THEN
        missing := array_append(
            missing,
            'forbidden-foreign-key:class_action_log'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conname = 'listening_tests_test_type_check'
           AND con.conrelid = 'public.listening_tests'::regclass
           AND con.contype = 'c'
           AND con.convalidated
           AND pg_get_constraintdef(con.oid) =
               'CHECK ((test_type = ANY (ARRAY[''full''::text, ''mini''::text, '
               '''drill''::text, ''practice''::text])))'
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:listening_tests.test_type'
        );
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conname = 'class_assignments_recipient_scope_check'
           AND con.conrelid = 'public.class_assignments'::regclass
           AND con.contype = 'c'
           AND con.convalidated
           AND pg_get_constraintdef(con.oid) =
               'CHECK ((recipient_scope = ANY (ARRAY[''class''::text, '
               '''subset''::text])))'
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:class_assignments.recipient_scope'
        );
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conname = 'class_assignments_skill_check'
           AND con.conrelid = 'public.class_assignments'::regclass
           AND con.contype = 'c'
           AND con.convalidated
           AND pg_get_constraintdef(con.oid) =
               'CHECK ((skill = ANY (ARRAY[''speaking''::text, '
               '''writing''::text, ''reading''::text, ''listening''::text, '
               '''vocab''::text, ''grammar''::text, ''course''::text])))'
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:class_assignments.skill'
        );
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conname = 'class_assignment_items_artifact_kind_check'
           AND con.conrelid = 'public.class_assignment_items'::regclass
           AND con.contype = 'c'
           AND con.convalidated
           AND pg_get_constraintdef(con.oid) =
               'CHECK ((artifact_kind = ANY (ARRAY[''session''::text, '
               '''writing_assignment''::text, ''reading_attempt''::text, '
               '''listening_attempt''::text, ''quiz_session''::text, '
               '''course_writing''::text])))'
    ) THEN
        missing := array_append(
            missing,
            'constraint-contract:class_assignment_items.artifact_kind'
        );
    END IF;

    -- Query-path indexes used by the admin/student assignment surfaces.
    FOREACH item IN ARRAY ARRAY[
        'idx_listening_tests_practice_group',
        'idx_courses_active_order',
        'idx_cohorts_course_id',
        'idx_class_lessons_cohort_order',
        'idx_class_lessons_published',
        'idx_class_assignments_cohort_due',
        'idx_class_assignments_lesson',
        'idx_class_assignments_due_open',
        'idx_class_assignment_items_student',
        'idx_class_assignment_items_outstanding',
        'idx_class_assignment_items_artifact',
        'idx_sessions_class_assignment_item',
        'idx_reading_attempts_class_item',
        'idx_listening_attempts_class_item',
        'idx_topic_questions_part_level',
        'uq_class_assignment_speaking_topic_per_cohort',
        'uq_speaking_lesson_set',
        'idx_speaking_lesson_sets_course',
        'uq_slsq_order_active',
        'idx_slsq_set',
        'idx_spm_user_time',
        'idx_spm_class_item',
        'idx_spm_session',
        'uq_quiz_bank_course_lesson',
        'idx_quiz_banks_course',
        'idx_quiz_sessions_class_item',
        'idx_course_writing_user',
        'idx_course_writing_item',
        'uq_course_writing_per_item',
        'uq_course_writing_draft_per_item',
        'ix_course_writing_draft_user',
        'idx_class_action_log_cohort',
        'idx_class_action_log_assignment',
        'uq_sessions_full_test_attempt_part',
        'idx_sessions_full_test_attempt_id'
    ] LOOP
        IF to_regclass('public.' || item) IS NULL THEN
            missing := array_append(missing, 'index:' || item);
        END IF;
    END LOOP;

    -- Every index created by the audited range is part of the final contract,
    -- including non-unique query-path indexes. CREATE INDEX IF NOT EXISTS can
    -- silently preserve a same-named index with wrong keys, order or predicate;
    -- pin the complete normalized definition observed identically on staging
    -- and production instead of accepting the name alone.
    FOR expected_index IN
        SELECT * FROM (VALUES
            ('idx_class_action_log_assignment', 'class_action_log', '815e78dc0ac92856c3ada07bd8d2e7d4'),
            ('idx_class_action_log_cohort', 'class_action_log', 'edcb99ab1c31f8b2a12055a496678aaf'),
            ('idx_class_assignment_items_artifact', 'class_assignment_items', '6fbea9a8007be2ad62b36fd5bb494e8f'),
            ('idx_class_assignment_items_outstanding', 'class_assignment_items', 'bdaed6e860d6eab0a979b903ade65f27'),
            ('idx_class_assignment_items_student', 'class_assignment_items', 'c41263f3d1569fe8d9a9235b51f57177'),
            ('idx_class_assignments_cohort_due', 'class_assignments', 'a7c6dc611b76de0add93dd2a0d83474f'),
            ('idx_class_assignments_due_open', 'class_assignments', '1b97b4b8caf47e36eb233c728da5b6cf'),
            ('idx_class_assignments_lesson', 'class_assignments', 'b6018f69a8c6abe0ad4931ad98f12138'),
            ('idx_class_lessons_cohort_order', 'class_lessons', '1618e7135a89aa123fe6287d79f886f9'),
            ('idx_class_lessons_published', 'class_lessons', 'fc17f01d6b702e591f02b29598bbcff2'),
            ('idx_cohorts_course_id', 'cohorts', '90be787c20a40e5e573e95d1ec71d09c'),
            ('idx_course_writing_item', 'course_writing_submissions', '7b61ae0cc23a14b240afcb2d63b9490e'),
            ('idx_course_writing_user', 'course_writing_submissions', '9b5f42b2175f1df9f89925eab3eecfc7'),
            ('idx_courses_active_order', 'courses', '277bfc29b9347bb5d9d4e79ac5295d47'),
            ('idx_listening_attempts_class_item', 'listening_test_attempts', '254e99bf578e0c039942fae2bd6a6e4f'),
            ('idx_listening_tests_practice_group', 'listening_tests', '314c62782bd1da4eb7e3021134dd2612'),
            ('idx_quiz_banks_course', 'quiz_banks', '327690b27408e6d67ae9ab84a69007a1'),
            ('idx_quiz_sessions_class_item', 'quiz_sessions', '952f6bc0b982fe486f8c8c4abe3873b3'),
            ('idx_reading_attempts_class_item', 'reading_test_attempts', 'efeb7eff3bc757fa4cd7af5e5d7db5c4'),
            ('idx_sessions_class_assignment_item', 'sessions', 'f9b6a14ec35a9e2701fe5fa1ac7a6bdd'),
            ('idx_sessions_full_test_attempt_id', 'sessions', '37c15557265bf149da6460c80cbefcf7'),
            ('idx_slsq_set', 'speaking_lesson_set_questions', '92f035413fafee826a2cdd055f018c57'),
            ('idx_speaking_lesson_sets_course', 'speaking_lesson_sets', '1d42516a5ecde255bf9f0af589f09a62'),
            ('idx_spm_class_item', 'speaking_progress_marks', '0a37bb27d2fb49108ecc6caac83a32ef'),
            ('idx_spm_session', 'speaking_progress_marks', '23496cd7e9df65c466604c402f47f565'),
            ('idx_spm_user_time', 'speaking_progress_marks', 'd8c78ef7490fd06a97d9ed8b82548899'),
            ('idx_topic_questions_part_level', 'topic_questions', '0c9a31ecb25e52110255a0f97d4f5e2a'),
            ('ix_course_writing_draft_user', 'course_writing_drafts', '31305d32e251c539b771c9ba8c4a0286'),
            ('uq_class_assignment_speaking_topic_per_cohort', 'class_assignments', '26c0e6bcf0ef2c972e95036c63b24c36'),
            ('uq_course_writing_draft_per_item', 'course_writing_drafts', 'e7453741b4a98bcce9309cfc6cb66157'),
            ('uq_course_writing_per_item', 'course_writing_submissions', '06ffdbe62180b738ba79d2a37cf76cbc'),
            ('uq_feedback_anon_vocab_daily', 'user_feedback', '7656914d48c7625080646060e6b8757f'),
            ('uq_quiz_bank_course_lesson', 'quiz_banks', 'a97b80e35d4ceb19be581acd4ca1c515'),
            ('uq_sessions_full_test_attempt_part', 'sessions', '6601e72ee9d3ef2e4520c45c445287f7'),
            ('uq_slsq_order_active', 'speaking_lesson_set_questions', '609dc5ab83cf5358114fd574f9a62448'),
            ('uq_speaking_lesson_set', 'speaking_lesson_sets', '52787ee6a9e416cec50f85a8c05d9b59')
        ) AS expected(index_name, table_name, definition_hash)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_index i
              JOIN pg_class idx ON idx.oid = i.indexrelid
             WHERE i.indexrelid = to_regclass(
                       format('public.%I', expected_index.index_name)
                   )
               AND i.indrelid = to_regclass(
                       format('public.%I', expected_index.table_name)
                   )
               AND idx.relnamespace = 'public'::regnamespace
               AND i.indisvalid
               AND i.indisready
               AND md5(pg_get_indexdef(i.indexrelid)) =
                   expected_index.definition_hash
        ) THEN
            missing := array_append(
                missing,
                'index-fingerprint:' || expected_index.index_name
            );
        END IF;
    END LOOP;

    -- These standalone unique indexes are correctness/serialization contracts,
    -- not optional query accelerators. Every source migration uses IF NOT
    -- EXISTS, so a same-named ordinary, invalid, wrong-key or wrong-predicate
    -- index would otherwise survive while its migration is recorded.
    FOR expected_index IN
        SELECT * FROM (VALUES
            (
                'uq_class_assignment_speaking_topic_per_cohort',
                'class_assignments',
                ARRAY['cohort_id', 'content_id']::name[],
                '((skill = ''speaking''::text) AND (content_id IS NOT NULL))'
            ),
            (
                'uq_speaking_lesson_set',
                'speaking_lesson_sets',
                ARRAY['course_id', 'lesson_no', 'part']::name[],
                NULL::text
            ),
            (
                'uq_slsq_order_active',
                'speaking_lesson_set_questions',
                ARRAY['set_id', 'order_num']::name[],
                'is_active'
            ),
            (
                'uq_quiz_bank_course_lesson',
                'quiz_banks',
                ARRAY['course_id', 'lesson_no']::name[],
                '((course_id IS NOT NULL) AND (lesson_no IS NOT NULL))'
            ),
            (
                'uq_feedback_anon_vocab_daily',
                'user_feedback',
                ARRAY['anonymous_dedupe_key']::name[],
                '(anonymous_dedupe_key IS NOT NULL)'
            )
        ) AS expected(index_name, table_name, key_columns, predicate)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_index i
              JOIN pg_class idx ON idx.oid = i.indexrelid
              JOIN pg_am am ON am.oid = idx.relam
             WHERE i.indexrelid = to_regclass(
                       'public.' || expected_index.index_name
                   )
               AND i.indrelid = to_regclass(
                       'public.' || expected_index.table_name
                   )
               AND am.amname = 'btree'
               AND i.indisunique
               AND i.indisvalid
               AND i.indisready
               AND i.indnkeyatts = cardinality(expected_index.key_columns)
               AND i.indnatts = cardinality(expected_index.key_columns)
               AND i.indexprs IS NULL
               AND ARRAY(
                    SELECT att.attname
                      FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ord)
                      JOIN pg_attribute att
                        ON att.attrelid = i.indrelid
                       AND att.attnum = key.attnum
                     ORDER BY key.ord
               ) = expected_index.key_columns
               AND pg_get_expr(i.indpred, i.indrelid)
                   IS NOT DISTINCT FROM expected_index.predicate
        ) THEN
            missing := array_append(
                missing,
                'index-contract:' || expected_index.index_name
            );
        END IF;
    END LOOP;

    -- Migration 200 relies on this partial UNIQUE index to serialize one Part
    -- per full-test attempt. CREATE UNIQUE INDEX IF NOT EXISTS cannot repair a
    -- manually-created same-name ordinary/wrong index, so pin the complete
    -- contract before acknowledging the historical migration in the ledger.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_index i
         WHERE i.indexrelid = to_regclass(
                   'public.uq_sessions_full_test_attempt_part'
               )
           AND i.indrelid = 'public.sessions'::regclass
           AND i.indisunique
           AND i.indisvalid
           AND i.indisready
           AND i.indnatts = 2
           AND i.indnkeyatts = 2
           AND i.indexprs IS NULL
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = i.indrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['full_test_attempt_id', 'part']::name[]
           AND pg_get_expr(i.indpred, i.indrelid) =
               '((mode = ''test_full''::text) AND '
               '(full_test_attempt_id IS NOT NULL))'
    ) THEN
        missing := array_append(
            missing,
            'index-contract:uq_sessions_full_test_attempt_part'
        );
    END IF;

    -- Migrations 192/194 use these unique indexes as application-level conflict
    -- targets. A same-named ordinary, invalid, wrong-table, wrong-key or
    -- wrong-predicate index would either admit duplicate submissions or make
    -- draft ON CONFLICT saves fail after the ledger has been reconciled.
    IF NOT EXISTS (
        SELECT 1
          FROM pg_index i
         WHERE i.indexrelid = to_regclass(
                   'public.uq_course_writing_per_item'
               )
           AND i.indrelid = 'public.course_writing_submissions'::regclass
           AND i.indisunique
           AND i.indisvalid
           AND i.indisready
           AND i.indnatts = 1
           AND i.indnkeyatts = 1
           AND i.indexprs IS NULL
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = i.indrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['class_assignment_item_id']::name[]
           AND pg_get_expr(i.indpred, i.indrelid) =
               '(class_assignment_item_id IS NOT NULL)'
    ) THEN
        missing := array_append(
            missing,
            'index-contract:uq_course_writing_per_item'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_index i
         WHERE i.indexrelid = to_regclass(
                   'public.uq_course_writing_draft_per_item'
               )
           AND i.indrelid = 'public.course_writing_drafts'::regclass
           AND i.indisunique
           AND i.indisvalid
           AND i.indisready
           AND i.indnatts = 1
           AND i.indnkeyatts = 1
           AND i.indexprs IS NULL
           AND i.indpred IS NULL
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = i.indrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['class_assignment_item_id']::name[]
    ) THEN
        missing := array_append(
            missing,
            'index-contract:uq_course_writing_draft_per_item'
        );
    END IF;

    -- Trigger names alone cannot prove timing, event set, target function or
    -- enabled state. Pin every trigger introduced/recreated by the reconciled
    -- history so a disabled or same-named no-op trigger cannot be baselined.
    FOR expected_trigger IN
        SELECT * FROM (VALUES
            (
                'courses', 'update_courses_updated_at',
                'public.update_updated_at_column()',
                $trigger$CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()$trigger$
            ),
            (
                'class_lessons', 'update_class_lessons_updated_at',
                'public.update_updated_at_column()',
                $trigger$CREATE TRIGGER update_class_lessons_updated_at BEFORE UPDATE ON public.class_lessons FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()$trigger$
            ),
            (
                'class_assignments', 'update_class_assignments_updated_at',
                'public.update_updated_at_column()',
                $trigger$CREATE TRIGGER update_class_assignments_updated_at BEFORE UPDATE ON public.class_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()$trigger$
            ),
            (
                'class_assignment_items', 'update_class_assignment_items_updated_at',
                'public.update_updated_at_column()',
                $trigger$CREATE TRIGGER update_class_assignment_items_updated_at BEFORE UPDATE ON public.class_assignment_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()$trigger$
            ),
            (
                'speaking_lesson_sets', 'update_speaking_lesson_sets_updated_at',
                'public.update_updated_at_column()',
                $trigger$CREATE TRIGGER update_speaking_lesson_sets_updated_at BEFORE UPDATE ON public.speaking_lesson_sets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()$trigger$
            ),
            (
                'speaking_lesson_set_questions', 'update_slsq_updated_at',
                'public.update_updated_at_column()',
                $trigger$CREATE TRIGGER update_slsq_updated_at BEFORE UPDATE ON public.speaking_lesson_set_questions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()$trigger$
            ),
            (
                'class_action_log', 'trg_class_action_log_append_only',
                'public.fn_class_action_log_append_only()',
                $trigger$CREATE TRIGGER trg_class_action_log_append_only BEFORE DELETE OR UPDATE ON public.class_action_log FOR EACH ROW EXECUTE FUNCTION fn_class_action_log_append_only()$trigger$
            ),
            (
                'sessions', 'trg_sessions_full_test_attempt_id',
                'public.set_speaking_full_test_attempt_id()',
                $trigger$CREATE TRIGGER trg_sessions_full_test_attempt_id BEFORE INSERT OR UPDATE OF mode, full_test_attempt_id ON public.sessions FOR EACH ROW EXECUTE FUNCTION set_speaking_full_test_attempt_id()$trigger$
            )
        ) AS expected(table_name, trigger_name, function_signature, definition)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_trigger trg
             WHERE trg.tgname = expected_trigger.trigger_name
               AND trg.tgrelid = to_regclass(
                       format('public.%I', expected_trigger.table_name)
                   )
               AND trg.tgfoid = to_regprocedure(
                       expected_trigger.function_signature
                   )
               AND trg.tgenabled = 'O'
               AND NOT trg.tgisinternal
               AND pg_get_triggerdef(trg.oid) = expected_trigger.definition
        ) THEN
            missing := array_append(
                missing,
                'trigger-contract:' || expected_trigger.table_name || '.'
                    || expected_trigger.trigger_name
            );
        END IF;
    END LOOP;

    -- Every new data table is RLS-enabled.  course-writing tables deliberately
    -- expose no authenticated policies; backend service_role owns their IO.
    FOREACH item IN ARRAY ARRAY[
        'courses',
        'class_lessons',
        'class_assignments',
        'class_assignment_items',
        'speaking_lesson_sets',
        'speaking_lesson_set_questions',
        'speaking_progress_marks',
        'course_writing_submissions',
        'course_writing_drafts',
        'class_action_log'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relname = item
               AND c.relrowsecurity
        ) THEN
            missing := array_append(missing, 'rls:' || item);
        END IF;
    END LOOP;

    -- Migration 194 makes drafts backend-only at the table privilege layer in
    -- addition to RLS. RLS alone is insufficient proof because service_role
    -- bypasses it and still needs explicit ALL privileges to save/load drafts.
    IF has_table_privilege('anon', 'public.course_writing_drafts', 'SELECT')
       OR has_table_privilege('anon', 'public.course_writing_drafts', 'INSERT')
       OR has_table_privilege('anon', 'public.course_writing_drafts', 'UPDATE')
       OR has_table_privilege('anon', 'public.course_writing_drafts', 'DELETE')
       OR has_table_privilege('authenticated', 'public.course_writing_drafts', 'SELECT')
       OR has_table_privilege('authenticated', 'public.course_writing_drafts', 'INSERT')
       OR has_table_privilege('authenticated', 'public.course_writing_drafts', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.course_writing_drafts', 'DELETE')
       OR NOT has_table_privilege('service_role', 'public.course_writing_drafts', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.course_writing_drafts', 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.course_writing_drafts', 'UPDATE')
       OR NOT has_table_privilege('service_role', 'public.course_writing_drafts', 'DELETE')
       OR NOT has_table_privilege('service_role', 'public.course_writing_drafts', 'TRUNCATE')
       OR NOT has_table_privilege('service_role', 'public.course_writing_drafts', 'REFERENCES')
       OR NOT has_table_privilege('service_role', 'public.course_writing_drafts', 'TRIGGER') THEN
        missing := array_append(missing, 'service-only-table-acl:course_writing_drafts');
    END IF;

    -- A policy name is not an authorization contract. Compare the complete
    -- effective set for every table created by the reconciled migrations,
    -- including command, role, permissiveness, USING and WITH CHECK. The two
    -- course-writing tables intentionally have no policies, so any extra policy
    -- on them also appears in the symmetric difference and fails closed.
    IF EXISTS (
        WITH expected(
            tablename, policyname, permissive, roles, cmd, qual, with_check
        ) AS (
            VALUES
                (
                    'courses'::name, 'courses_admin_all'::name,
                    'PERMISSIVE'::text, ARRAY['authenticated']::name[],
                    'ALL'::text, 'is_current_user_admin()'::text,
                    'is_current_user_admin()'::text
                ),
                (
                    'class_lessons', 'class_lessons_admin_all',
                    'PERMISSIVE', ARRAY['authenticated']::name[],
                    'ALL', 'is_current_user_admin()',
                    'is_current_user_admin()'
                ),
                (
                    'class_assignments', 'class_assignments_admin_all',
                    'PERMISSIVE', ARRAY['authenticated']::name[],
                    'ALL', 'is_current_user_admin()',
                    'is_current_user_admin()'
                ),
                (
                    'class_assignment_items',
                    'class_assignment_items_admin_all',
                    'PERMISSIVE', ARRAY['authenticated']::name[],
                    'ALL', 'is_current_user_admin()',
                    'is_current_user_admin()'
                ),
                (
                    'speaking_lesson_sets',
                    'speaking_lesson_sets_admin_all',
                    'PERMISSIVE', ARRAY['authenticated']::name[],
                    'ALL', 'is_current_user_admin()',
                    'is_current_user_admin()'
                ),
                (
                    'speaking_lesson_set_questions', 'slsq_admin_all',
                    'PERMISSIVE', ARRAY['authenticated']::name[],
                    'ALL', 'is_current_user_admin()',
                    'is_current_user_admin()'
                ),
                (
                    'speaking_progress_marks', 'spm_admin_all',
                    'PERMISSIVE', ARRAY['authenticated']::name[],
                    'ALL', 'is_current_user_admin()',
                    'is_current_user_admin()'
                ),
                (
                    'class_action_log', 'cal_admin_read',
                    'PERMISSIVE', ARRAY['authenticated']::name[],
                    'SELECT', 'is_current_user_admin()', NULL
                ),
                (
                    'class_action_log', 'cal_admin_append',
                    'PERMISSIVE', ARRAY['authenticated']::name[],
                    'INSERT', NULL, 'is_current_user_admin()'
                )
        ),
        actual AS (
            SELECT p.tablename,
                   p.policyname,
                   p.permissive,
                   p.roles,
                   p.cmd,
                   p.qual,
                   p.with_check
              FROM pg_policies p
             WHERE p.schemaname = 'public'
               AND p.tablename = ANY (ARRAY[
                    'courses',
                    'class_lessons',
                    'class_assignments',
                    'class_assignment_items',
                    'speaking_lesson_sets',
                    'speaking_lesson_set_questions',
                    'speaking_progress_marks',
                    'course_writing_submissions',
                    'course_writing_drafts',
                    'class_action_log'
               ]::name[])
        ),
        policy_difference AS (
            (SELECT * FROM expected EXCEPT SELECT * FROM actual)
            UNION ALL
            (SELECT * FROM actual EXCEPT SELECT * FROM expected)
        )
        SELECT 1 FROM policy_difference
    ) THEN
        missing := array_append(
            missing,
            'policy-contract:reconciled-tables'
        );
    END IF;

    -- Durable seed/data invariants audited before the repair.
    IF (SELECT count(DISTINCT code) FROM courses WHERE code IN ('C1','C2','C3','C4','C5')) <> 5 THEN
        missing := array_append(missing, 'seed:courses.C1-C5');
    END IF;
    IF EXISTS (
        SELECT 1
          FROM class_assignments
         WHERE recipient_scope IS NULL
            OR recipient_scope NOT IN ('class', 'subset')
    ) THEN
        missing := array_append(
            missing,
            'data:class_assignments.recipient_scope'
        );
    END IF;
    IF EXISTS (
        SELECT 1
          FROM class_assignments
         WHERE skill IS NULL
            OR skill NOT IN (
                'speaking', 'writing', 'reading', 'listening',
                'vocab', 'grammar', 'course'
            )
    ) THEN
        missing := array_append(missing, 'data:class_assignments.skill');
    END IF;
    IF EXISTS (
        SELECT 1
          FROM listening_tests
         WHERE test_type IS NULL
            OR test_type NOT IN ('full', 'mini', 'drill', 'practice')
    ) THEN
        missing := array_append(missing, 'data:listening_tests.test_type');
    END IF;
    IF EXISTS (
        SELECT assignment_id, student_id
          FROM class_assignment_items
         GROUP BY assignment_id, student_id
        HAVING count(*) > 1
    ) THEN
        missing := array_append(
            missing,
            'data:class_assignment_items.assignment-student-duplicate'
        );
    END IF;
    IF EXISTS (
        SELECT 1 FROM class_assignment_items
         WHERE (artifact_kind IS NULL) <> (artifact_id IS NULL)
    ) THEN
        missing := array_append(missing, 'data:artifact-pairing');
    END IF;
    IF EXISTS (
        SELECT class_assignment_item_id
          FROM course_writing_submissions
         WHERE class_assignment_item_id IS NOT NULL
         GROUP BY class_assignment_item_id
        HAVING count(*) > 1
    ) THEN
        missing := array_append(missing, 'data:course-writing-duplicate-item');
    END IF;

    -- Migration 192 replaces the old one-submission-per-bank/user rule with
    -- one-submission-per-assignment-item. Detect the obsolete key by columns,
    -- not only by its historical name, so a renamed copy cannot pass.
    IF EXISTS (
        SELECT 1
          FROM pg_constraint con
         WHERE con.conrelid = 'public.course_writing_submissions'::regclass
           AND con.contype = 'u'
           AND ARRAY(
                SELECT att.attname
                  FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
                  JOIN pg_attribute att
                    ON att.attrelid = con.conrelid
                   AND att.attnum = key.attnum
                 ORDER BY key.ord
           ) = ARRAY['bank_id', 'user_id']::name[]
    ) THEN
        missing := array_append(
            missing,
            'obsolete-constraint:course_writing_submissions(bank_id,user_id)'
        );
    END IF;
    IF EXISTS (
        SELECT 1 FROM sessions
         WHERE mode = 'test_full' AND full_test_attempt_id IS NULL
    ) THEN
        missing := array_append(missing, 'data:full-test-attempt-id');
    END IF;

    IF cardinality(missing) > 0 THEN
        RAISE EXCEPTION 'prod_gate_e_reconcile_postconditions_failed'
            USING ERRCODE = 'P0001', DETAIL = array_to_string(missing, ', ');
    END IF;
END;
$$;
