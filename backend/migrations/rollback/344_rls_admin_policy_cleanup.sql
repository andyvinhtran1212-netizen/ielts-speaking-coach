-- Manual policy-only rollback for 344 / RLSCLEANUP-0039.
-- Set aver.allow_rls_admin_policy_rollback = 'on' in this session first.
-- Refuse if any client table/column privilege or helper EXECUTE is present:
-- restoring policies must never reopen direct access. No privilege restoration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;
DO $rollback$
DECLARE
    target_tables CONSTANT TEXT[] := ARRAY[
        'access_codes',
        'class_action_log',
        'class_assignment_items',
        'class_assignments',
        'class_lessons',
        'cohorts',
        'courses',
        'error_logs',
        'essay_regrade_requests',
        'mock_exam_assignments',
        'speaking_lesson_set_questions',
        'speaking_lesson_sets',
        'speaking_progress_marks',
        'students',
        'writing_assignment_requests',
        'writing_assignments',
        'writing_drafts',
        'writing_essays',
        'writing_feedback',
        'writing_prompts',
        'writing_tips'];
    privileges CONSTANT TEXT[] := ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
        || CASE WHEN current_setting('server_version_num')::int >= 170000
                THEN ARRAY['MAINTAIN'] ELSE ARRAY[]::TEXT[] END;
    t TEXT;
    leaks TEXT;
BEGIN
    IF COALESCE(current_setting('aver.allow_rls_admin_policy_rollback', true), '') <> 'on' THEN
        RAISE EXCEPTION 'rls344_rollback_requires_explicit_opt_in';
    END IF;
    FOREACH t IN ARRAY target_tables LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND c.relname = t AND c.relkind IN ('r', 'p')) THEN
            RAISE EXCEPTION 'rls344_missing_table: %', t;
        END IF;
        EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', t);
        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN
            RAISE EXCEPTION 'rls344_rls_disabled: %', t;
        END IF;
    END LOOP;
    SELECT string_agg(format('%s:%s:%s', c.relname, r.name, p.name), ', '
                      ORDER BY c.relname, r.name, p.name)
      INTO leaks
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) r(name)
     CROSS JOIN unnest(privileges) p(name)
     WHERE n.nspname = 'public' AND c.relname = ANY (target_tables)
       AND (has_table_privilege(r.name, c.oid, p.name)
            OR CASE WHEN p.name IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                    THEN has_any_column_privilege(r.name, c.oid, p.name) ELSE false END);
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'rls344_client_privilege_remains: %', leaks;
    END IF;
    IF to_regprocedure('public.is_current_user_admin()') IS NULL
       OR to_regprocedure('public.is_current_user_instructor()') IS NULL THEN
        RAISE EXCEPTION 'rls344_missing_helper';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN (VALUES ('anon'), ('authenticated')) r(name)
                WHERE p.oid IN (to_regprocedure('public.is_current_user_admin()'),
                                to_regprocedure('public.is_current_user_instructor()'))
                  AND has_function_privilege(r.name, p.oid, 'EXECUTE')) THEN
        RAISE EXCEPTION 'rls344_rollback_helper_executable_by_client';
    END IF;
    -- Original: 106_instructor_role_foundation.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'access_codes' AND policyname = 'access_codes_admin_all') THEN
        CREATE POLICY access_codes_admin_all ON public.access_codes
            FOR ALL
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 106_instructor_role_foundation.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'access_codes' AND policyname = 'access_codes_instructor_own') THEN
        CREATE POLICY access_codes_instructor_own ON public.access_codes
            FOR ALL
            USING      (issued_by = auth.uid() AND public.is_current_user_instructor())
            WITH CHECK (issued_by = auth.uid() AND public.is_current_user_instructor());
    END IF;
    -- Original: 198_class_action_log.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'class_action_log' AND policyname = 'cal_admin_append') THEN
        CREATE POLICY cal_admin_append ON public.class_action_log
            FOR INSERT TO authenticated
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 198_class_action_log.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'class_action_log' AND policyname = 'cal_admin_read') THEN
        CREATE POLICY cal_admin_read ON public.class_action_log
            FOR SELECT TO authenticated
            USING (public.is_current_user_admin());
    END IF;
    -- Original: 177_class_assignments.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'class_assignment_items' AND policyname = 'class_assignment_items_admin_all') THEN
        CREATE POLICY class_assignment_items_admin_all ON public.class_assignment_items
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 177_class_assignments.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'class_assignments' AND policyname = 'class_assignments_admin_all') THEN
        CREATE POLICY class_assignments_admin_all ON public.class_assignments
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 176_class_lessons.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'class_lessons' AND policyname = 'class_lessons_admin_all') THEN
        CREATE POLICY class_lessons_admin_all ON public.class_lessons
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 060_cohorts_table.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'cohorts' AND policyname = 'Admins manage cohorts') THEN
        CREATE POLICY "Admins manage cohorts" ON public.cohorts
            FOR ALL USING (is_current_user_admin());
    END IF;
    -- Original: 060_cohorts_table.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'cohorts' AND policyname = 'Admins read all cohorts') THEN
        CREATE POLICY "Admins read all cohorts" ON public.cohorts
            FOR SELECT USING (is_current_user_admin());
    END IF;
    -- Original: 106_instructor_role_foundation.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'cohorts' AND policyname = 'cohorts_instructor_own') THEN
        CREATE POLICY cohorts_instructor_own ON public.cohorts
            FOR ALL
            USING      (created_by = auth.uid() AND public.is_current_user_instructor())
            WITH CHECK (created_by = auth.uid() AND public.is_current_user_instructor());
    END IF;
    -- Original: 175_courses.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'courses' AND policyname = 'courses_admin_all') THEN
        CREATE POLICY courses_admin_all ON public.courses
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 061_error_logs.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'error_logs' AND policyname = 'Admins dismiss error logs') THEN
        CREATE POLICY "Admins dismiss error logs" ON public.error_logs
            FOR UPDATE USING (is_current_user_admin());
    END IF;
    -- Original: 061_error_logs.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'error_logs' AND policyname = 'Admins read all error logs') THEN
        CREATE POLICY "Admins read all error logs" ON public.error_logs
            FOR SELECT USING (is_current_user_admin());
    END IF;
    -- Original: 084_essay_regrade_requests.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'essay_regrade_requests' AND policyname = 'regrade_requests_admin_all') THEN
        CREATE POLICY regrade_requests_admin_all ON public.essay_regrade_requests
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 154_mock_exam_retake_mode.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'mock_exam_assignments' AND policyname = 'mock_exam_assignments_admin_all') THEN
        CREATE POLICY mock_exam_assignments_admin_all ON public.mock_exam_assignments
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 183_speaking_lesson_sets.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'speaking_lesson_set_questions' AND policyname = 'slsq_admin_all') THEN
        CREATE POLICY slsq_admin_all ON public.speaking_lesson_set_questions
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 183_speaking_lesson_sets.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'speaking_lesson_sets' AND policyname = 'speaking_lesson_sets_admin_all') THEN
        CREATE POLICY speaking_lesson_sets_admin_all ON public.speaking_lesson_sets
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 185_speaking_progress_marks.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'speaking_progress_marks' AND policyname = 'spm_admin_all') THEN
        CREATE POLICY spm_admin_all ON public.speaking_progress_marks
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 033_writing_coach_tables.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'students' AND policyname = 'students_admin_all') THEN
        CREATE POLICY students_admin_all ON public.students
            FOR ALL
            USING (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 106_instructor_role_foundation.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'students' AND policyname = 'students_instructor_own') THEN
        CREATE POLICY students_instructor_own ON public.students
            FOR ALL
            USING      (instructor_id = auth.uid() AND public.is_current_user_instructor())
            WITH CHECK (instructor_id = auth.uid() AND public.is_current_user_instructor());
    END IF;
    -- Original: 206_writing_assignment_idempotency.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'writing_assignment_requests' AND policyname = 'writing_assignment_requests_admin_all') THEN
        CREATE POLICY writing_assignment_requests_admin_all ON public.writing_assignment_requests
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 036_writing_assignments.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'writing_assignments' AND policyname = 'writing_assignments_admin_all') THEN
        CREATE POLICY writing_assignments_admin_all ON public.writing_assignments
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 106_instructor_role_foundation.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'writing_assignments' AND policyname = 'writing_assignments_instructor_own') THEN
        CREATE POLICY writing_assignments_instructor_own ON public.writing_assignments
            FOR ALL
            USING      (assigned_by = auth.uid() AND public.is_current_user_instructor())
            WITH CHECK (assigned_by = auth.uid() AND public.is_current_user_instructor());
    END IF;
    -- Original: 037_writing_drafts.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'writing_drafts' AND policyname = 'writing_drafts_admin_all') THEN
        CREATE POLICY writing_drafts_admin_all ON public.writing_drafts
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 033_writing_coach_tables.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'writing_essays' AND policyname = 'writing_essays_admin_all') THEN
        CREATE POLICY writing_essays_admin_all ON public.writing_essays
            FOR ALL
            USING (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 033_writing_coach_tables.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'writing_feedback' AND policyname = 'writing_feedback_admin_all') THEN
        CREATE POLICY writing_feedback_admin_all ON public.writing_feedback
            FOR ALL
            USING (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 035_writing_prompts_library.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'writing_prompts' AND policyname = 'writing_prompts_admin_all') THEN
        CREATE POLICY writing_prompts_admin_all ON public.writing_prompts
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 106_instructor_role_foundation.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'writing_prompts' AND policyname = 'writing_prompts_instructor_own') THEN
        CREATE POLICY writing_prompts_instructor_own ON public.writing_prompts
            FOR ALL
            USING      (created_by = auth.uid() AND public.is_current_user_instructor())
            WITH CHECK (created_by = auth.uid() AND public.is_current_user_instructor());
    END IF;
    -- Original: 082_writing_tips.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'writing_tips' AND policyname = 'writing_tips_admin_all') THEN
        CREATE POLICY writing_tips_admin_all ON public.writing_tips
            FOR ALL TO authenticated
            USING      (public.is_current_user_admin())
            WITH CHECK (public.is_current_user_admin());
    END IF;
    -- Original: 061_error_logs.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'error_logs' AND policyname = 'Authenticated users can report own errors') THEN
        CREATE POLICY "Authenticated users can report own errors" ON public.error_logs
            FOR INSERT
            TO authenticated
            WITH CHECK (
                source = 'frontend'
                AND (user_id IS NULL OR user_id = auth.uid())
            );
    END IF;
    -- Original: 084_essay_regrade_requests.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'essay_regrade_requests' AND policyname = 'regrade_requests_student_insert') THEN
        CREATE POLICY regrade_requests_student_insert ON public.essay_regrade_requests
            FOR INSERT TO authenticated
            WITH CHECK (student_id IN (SELECT id FROM students WHERE user_id = auth.uid()));
    END IF;
    -- Original: 037_writing_drafts.sql.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                    AND tablename = 'writing_drafts' AND policyname = 'writing_drafts_student_own') THEN
        CREATE POLICY writing_drafts_student_own ON public.writing_drafts
            FOR ALL TO authenticated
            USING (
                student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
            )
            WITH CHECK (
                student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
            );
    END IF;
END;
$rollback$;
COMMIT;
