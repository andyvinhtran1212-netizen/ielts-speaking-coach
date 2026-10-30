-- Migration 344: RLSCLEANUP-0039 / PC-J131R (RLS-ADMIN + BL-11).
-- Drop the 29 policies calling helpers whose client EXECUTE was revoked by
-- 108, plus three dead learner write policies. All 21 tables are backend-only.
-- No application row reads/writes, new privileges, helper changes or learner read-policy
-- changes. Keep the non-uniform service_role ACL exactly as found (T001).
-- 345 already revokes access_codes client privileges; repeating that is safe.
-- Do not recreate its drifted "Admin only" policy. No dependency on 345.
-- Apply only through the advisory-locked runner: staging first after the
-- Leader lifts STAGING_FREEZE; production only at Vinh's approved promotion.
-- Rollback: rollback/344_rls_admin_policy_cleanup.sql restores only policies,
-- guarded by aver.allow_rls_admin_policy_rollback = 'on' and closed client ACLs.
-- It never restores table privileges or helper EXECUTE. See README.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, pg_temp;

DO $cleanup$
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
    -- First 29: T001 helper policies. Last three: BL-11 (not own-read).
    target_policies CONSTANT TEXT[] := ARRAY[
        'access_codes.access_codes_admin_all',
        'access_codes.access_codes_instructor_own',
        'class_action_log.cal_admin_append',
        'class_action_log.cal_admin_read',
        'class_assignment_items.class_assignment_items_admin_all',
        'class_assignments.class_assignments_admin_all',
        'class_lessons.class_lessons_admin_all',
        'cohorts.Admins manage cohorts',
        'cohorts.Admins read all cohorts',
        'cohorts.cohorts_instructor_own',
        'courses.courses_admin_all',
        'error_logs.Admins dismiss error logs',
        'error_logs.Admins read all error logs',
        'essay_regrade_requests.regrade_requests_admin_all',
        'mock_exam_assignments.mock_exam_assignments_admin_all',
        'speaking_lesson_set_questions.slsq_admin_all',
        'speaking_lesson_sets.speaking_lesson_sets_admin_all',
        'speaking_progress_marks.spm_admin_all',
        'students.students_admin_all',
        'students.students_instructor_own',
        'writing_assignment_requests.writing_assignment_requests_admin_all',
        'writing_assignments.writing_assignments_admin_all',
        'writing_assignments.writing_assignments_instructor_own',
        'writing_drafts.writing_drafts_admin_all',
        'writing_essays.writing_essays_admin_all',
        'writing_feedback.writing_feedback_admin_all',
        'writing_prompts.writing_prompts_admin_all',
        'writing_prompts.writing_prompts_instructor_own',
        'writing_tips.writing_tips_admin_all',
        'error_logs.Authenticated users can report own errors',
        'essay_regrade_requests.regrade_requests_student_insert',
        'writing_drafts.writing_drafts_student_own'];
    t TEXT;
    policy_key TEXT;
    leaks TEXT;
    before_service JSONB;
    before_helpers JSONB;
    before_kept JSONB;
    after_catalog JSONB;
BEGIN
    IF to_regclass('public._schema_migrations') IS NULL THEN
        RAISE EXCEPTION 'rls344_requires_migration_320';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public._schema_migrations
                    WHERE filename = '320_client_write_privilege_lockdown.sql') THEN
        RAISE EXCEPTION 'rls344_requires_migration_320';
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
    IF to_regprocedure('public.is_current_user_admin()') IS NULL
       OR to_regprocedure('public.is_current_user_instructor()') IS NULL THEN
        RAISE EXCEPTION 'rls344_missing_helper';
    END IF;

    SELECT jsonb_object_agg(c.relname, COALESCE(
               (SELECT jsonb_agg(a::text ORDER BY a::text)
                  FROM unnest(c.relacl) a WHERE a::text LIKE 'service_role=%'), '[]'::jsonb))
      INTO before_service
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY (target_tables);
    SELECT jsonb_agg(jsonb_build_array(p.oid, p.proacl) ORDER BY p.oid)
      INTO before_helpers
      FROM pg_proc p
     WHERE p.oid IN (to_regprocedure('public.is_current_user_admin()'),
                     to_regprocedure('public.is_current_user_instructor()'));
    SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY schemaname, tablename, policyname), '[]'::jsonb)
      INTO before_kept
      FROM pg_policies p
     WHERE NOT (schemaname = 'public' AND tablename || '.' || policyname = ANY (target_policies));

    FOREACH policy_key IN ARRAY target_policies LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',
                       split_part(policy_key, '.', 2), split_part(policy_key, '.', 1));
    END LOOP;
    FOREACH t IN ARRAY target_tables LOOP
        EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
                       ' ON public.%I FROM anon, authenticated', t);
        IF current_setting('server_version_num')::int >= 170000 THEN
            EXECUTE format('REVOKE MAINTAIN ON public.%I FROM anon, authenticated', t);
        END IF;
    END LOOP;

    -- All schemas, including unexpected policies outside the reviewed 21.
    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE concat_ws(' ', qual, with_check) ~* 'is_current_user_(admin|instructor)') THEN
        RAISE EXCEPTION 'rls344_helper_policy_remains';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                AND tablename || '.' || policyname = ANY (target_policies)) THEN
        RAISE EXCEPTION 'rls344_target_policy_remains';
    END IF;
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
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relname = ANY (target_tables)
                  AND NOT c.relrowsecurity) THEN
        RAISE EXCEPTION 'rls344_rls_disabled';
    END IF;

    SELECT jsonb_object_agg(c.relname, COALESCE(
               (SELECT jsonb_agg(a::text ORDER BY a::text)
                  FROM unnest(c.relacl) a WHERE a::text LIKE 'service_role=%'), '[]'::jsonb))
      INTO after_catalog
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY (target_tables);
    IF after_catalog IS DISTINCT FROM before_service THEN
        RAISE EXCEPTION 'rls344_service_role_acl_changed';
    END IF;
    SELECT jsonb_agg(jsonb_build_array(p.oid, p.proacl) ORDER BY p.oid)
      INTO after_catalog
      FROM pg_proc p
     WHERE p.oid IN (to_regprocedure('public.is_current_user_admin()'),
                     to_regprocedure('public.is_current_user_instructor()'));
    IF after_catalog IS DISTINCT FROM before_helpers THEN
        RAISE EXCEPTION 'rls344_helper_acl_changed';
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY schemaname, tablename, policyname), '[]'::jsonb)
      INTO after_catalog
      FROM pg_policies p
     WHERE NOT (schemaname = 'public' AND tablename || '.' || policyname = ANY (target_policies));
    IF after_catalog IS DISTINCT FROM before_kept THEN
        RAISE EXCEPTION 'rls344_non_target_policy_changed';
    END IF;
END;
$cleanup$;

COMMIT;
