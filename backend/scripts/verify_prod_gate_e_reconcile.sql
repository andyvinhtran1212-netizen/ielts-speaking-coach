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
    fn_source text;
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

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'course_writing_drafts'
           AND column_name = 'seq'
    ) THEN
        missing := array_append(missing, 'removed-column:course_writing_drafts.seq');
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

    -- Named constraints encode the cross-table and state invariants that mere
    -- column existence cannot prove.
    FOR tbl, item IN
        SELECT * FROM (VALUES
            ('listening_tests', 'listening_tests_test_type_check'),
            ('class_lessons', 'class_lessons_id_cohort_key'),
            ('class_assignments', 'class_assignments_lesson_cohort_fkey'),
            ('class_assignments', 'class_assignments_skill_check'),
            ('class_assignments', 'class_assignments_kind_check'),
            ('class_assignment_items', 'class_assignment_items_artifact_kind_check'),
            ('class_assignment_items', 'class_assignment_items_artifact_pairing'),
            ('class_assignment_items', 'class_assignment_items_submitted_at_required'),
            ('class_assignment_items', 'class_assignment_items_score_check'),
            ('topic_questions', 'topic_questions_level_check'),
            ('quiz_banks', 'quiz_banks_lesson_no_check'),
            ('quiz_sessions', 'quiz_sessions_kind_check'),
            ('sessions', 'sessions_full_test_attempt_required')
        ) AS expected(table_name, constraint_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint
             WHERE conname = item
               AND conrelid = to_regclass('public.' || tbl)
        ) THEN
            missing := array_append(missing, 'constraint:' || tbl || '.' || item);
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
         FROM pg_constraint
         WHERE conname = 'listening_tests_test_type_check'
           AND conrelid = 'public.listening_tests'::regclass
           AND pg_get_constraintdef(oid) LIKE '%practice%'
    ) THEN
        missing := array_append(missing, 'constraint-value:listening.practice');
    END IF;
    IF NOT EXISTS (
        SELECT 1
         FROM pg_constraint
         WHERE conname = 'class_assignments_skill_check'
           AND conrelid = 'public.class_assignments'::regclass
           AND pg_get_constraintdef(oid) LIKE '%course%'
    ) THEN
        missing := array_append(missing, 'constraint-value:assignment.course');
    END IF;
    IF NOT EXISTS (
        SELECT 1
         FROM pg_constraint
         WHERE conname = 'class_assignment_items_artifact_kind_check'
           AND conrelid = 'public.class_assignment_items'::regclass
           AND pg_get_constraintdef(oid) LIKE '%course_writing%'
    ) THEN
        missing := array_append(missing, 'constraint-value:artifact.course_writing');
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

    FOR tbl, item IN
        SELECT * FROM (VALUES
            ('courses', 'update_courses_updated_at'),
            ('class_lessons', 'update_class_lessons_updated_at'),
            ('class_assignments', 'update_class_assignments_updated_at'),
            ('class_assignment_items', 'update_class_assignment_items_updated_at'),
            ('speaking_lesson_sets', 'update_speaking_lesson_sets_updated_at'),
            ('speaking_lesson_set_questions', 'update_slsq_updated_at'),
            ('class_action_log', 'trg_class_action_log_append_only'),
            ('sessions', 'trg_sessions_full_test_attempt_id')
        ) AS expected(table_name, trigger_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_trigger
             WHERE tgname = item
               AND tgrelid = to_regclass('public.' || tbl)
               AND NOT tgisinternal
        ) THEN
            missing := array_append(missing, 'trigger:' || tbl || '.' || item);
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

    FOR tbl, item IN
        SELECT * FROM (VALUES
            ('courses', 'courses_admin_all'),
            ('class_lessons', 'class_lessons_admin_all'),
            ('class_assignments', 'class_assignments_admin_all'),
            ('class_assignment_items', 'class_assignment_items_admin_all'),
            ('speaking_lesson_sets', 'speaking_lesson_sets_admin_all'),
            ('speaking_lesson_set_questions', 'slsq_admin_all'),
            ('speaking_progress_marks', 'spm_admin_all'),
            ('class_action_log', 'cal_admin_read'),
            ('class_action_log', 'cal_admin_append')
        ) AS expected(table_name, policy_name)
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_policies
             WHERE schemaname = 'public'
               AND tablename = tbl
               AND policyname = item
        ) THEN
            missing := array_append(missing, 'policy:' || tbl || '.' || item);
        END IF;
    END LOOP;

    -- Durable seed/data invariants audited before the repair.
    IF (SELECT count(DISTINCT code) FROM courses WHERE code IN ('C1','C2','C3','C4','C5')) <> 5 THEN
        missing := array_append(missing, 'seed:courses.C1-C5');
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
    IF EXISTS (
        SELECT 1 FROM sessions
         WHERE mode = 'test_full' AND full_test_attempt_id IS NULL
    ) THEN
        missing := array_append(missing, 'data:full-test-attempt-id');
    END IF;

    -- Migration 196 is a final-body replacement.  Existence alone could leave
    -- the older three-evidence implementation in place, so pin both additions.
    SELECT prosrc INTO fn_source
      FROM pg_proc
     WHERE oid = to_regprocedure(
        'public.fn_delete_class_assignment_if_unsubmitted(uuid,uuid)'
     );
    IF fn_source IS NULL
       OR fn_source NOT LIKE '%quiz_sessions q%'
       OR fn_source NOT LIKE '%course_writing_submissions w%' THEN
        missing := array_append(missing, 'function-body:delete-course-evidence');
    END IF;

    IF cardinality(missing) > 0 THEN
        RAISE EXCEPTION 'prod_gate_e_reconcile_postconditions_failed'
            USING ERRCODE = 'P0001', DETAIL = array_to_string(missing, ', ');
    END IF;
END;
$$;
