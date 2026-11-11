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

-- ── Migration ACL invariants (PC-J498, SVCPRIV-0042 FR-007) ────────────────
-- --baseline records every prod-active migration as applied without running
-- it, so each REVOKE those migrations made on PUBLIC/anon/authenticated/
-- service_role must still hold in the restored dump. A row means: none of
-- ROLES holds any of PRIVILEGES on OBJECT. MIGRATIONS lists the files whose
-- revokes the row pins; test_clone_postconditions_cover_acl_migrations makes
-- every prod-active migration with such a REVOKE appear here or name a check
-- above. Privileges a later migration re-granted are left out of the row; an
-- object a later migration dropped or renamed is pinned by its successor of
-- the same name (e.g. 263-266 by 270's quiz_start_timed_course_session).
--   kind: relation | function (regprocedure) | function_name (every public
--         overload) | function_like (public proname LIKE object) | schema
--   'public' is the PUBLIC pseudo-role, read from the ACL itself; the other
--   roles use effective privileges. Relation ALL = SELECT, INSERT, UPDATE,
--   DELETE, TRUNCATE, REFERENCES, TRIGGER and, on PG 17+, MAINTAIN; rows that
--   a REVOKE ALL left partly re-granted list MAINTAIN too. MAINTAIN is
--   skipped below PG 17, where it does not exist.
--   exempt (function_like only): regprocedures a later migration re-granted.
-- A missing object fails as well: the ledger would then claim a migration
-- whose objects the clone does not have.
DO $$
DECLARE
    missing TEXT;
    leaks TEXT;
BEGIN
    -- One statement without DDL, so the block also runs in BEGIN READ ONLY.
    WITH invariant(kind, object, roles, privileges, migrations, exempt) AS (VALUES
        ('function', 'public.fn_guard_blackeye_admission()', 'public anon authenticated', 'EXECUTE', '376', NULL),
        ('function', 'public.fn_acquire_blackeye_attempt(uuid,uuid,jsonb,text)', 'public anon authenticated', 'EXECUTE', '376', NULL),
        ('function', 'public.append_paste_event(uuid,uuid,jsonb)', 'public anon authenticated', 'EXECUTE', '108', NULL),
        ('function', 'public.is_current_user_admin()', 'public anon authenticated', 'EXECUTE', '108', NULL),
        ('function', 'public.is_current_user_instructor()', 'public anon authenticated', 'EXECUTE', '108', NULL),
        ('function', 'public.fn_upsert_listening_answer(uuid,int4,text)', 'public anon authenticated', 'EXECUTE', '161 224', NULL),
        ('function', 'public.fn_merge_sitting_integrity(uuid,int4,int4,int4,int4,timestamptz)', 'public anon authenticated', 'EXECUTE', '163', NULL),
        ('function', 'public.fn_void_sitting(uuid,text,text)', 'public anon authenticated', 'EXECUTE', '168', NULL),
        ('function', 'public.fn_set_exam_mode(uuid,text)', 'public anon authenticated', 'EXECUTE', '169', NULL),
        ('function', 'public.fn_set_exam_content_cohorts(text,uuid,uuid[],uuid)', 'public anon authenticated', 'EXECUTE', '172', NULL),
        ('function', 'public.fn_insert_listening_answer_once(uuid,int4,text)', 'public anon authenticated', 'EXECUTE', '174 224', NULL),
        ('function', 'public.fn_bind_session_to_class_item(uuid,uuid,uuid)', 'public anon authenticated', 'EXECUTE', '179 180', NULL),
        ('function', 'public.fn_create_class_assignment(uuid,text,text,uuid,jsonb,uuid,text,timestamptz,timestamptz,text,uuid,text,uuid[])', 'public anon authenticated', 'EXECUTE', '179 184 193 227 269', NULL),
        ('function', 'public.fn_delete_class_assignment_if_unsubmitted(uuid,uuid)', 'public anon authenticated', 'EXECUTE', '179 180 181 196 226 278 283', NULL),
        ('function', 'public.quiz_replace_questions(uuid,jsonb)', 'public anon authenticated', 'EXECUTE', '186 309', NULL),
        ('function', 'public.quiz_replace_unmanaged_306(uuid,jsonb)', 'public anon authenticated service_role', 'EXECUTE', '186 309', NULL),
        ('function', 'public.fn_backfill_assignment_items(uuid,uuid[])', 'public anon authenticated', 'EXECUTE', '193 227', NULL),
        ('relation', 'public.course_writing_drafts', 'public anon authenticated', 'ALL', '194', NULL),
        ('relation', 'public.class_action_log', 'public anon authenticated service_role', 'TRUNCATE', '204', NULL),
        ('function', 'public.fn_action_writing_regrade_request(uuid,uuid,text,text)', 'public anon authenticated', 'EXECUTE', '205', NULL),
        ('function', 'public.fn_deliver_writing_essay(uuid,text,bool)', 'public anon authenticated', 'EXECUTE', '205', NULL),
        ('function', 'public.fn_fulfil_writing_regrade_on_delivery()', 'public anon authenticated', 'EXECUTE', '205', NULL),
        ('function', 'public.fn_list_writing_regrade_requests(text,uuid)', 'public anon authenticated', 'EXECUTE', '205 227', NULL),
        ('function', 'public.fn_create_writing_assignments_idempotent(uuid,uuid,jsonb,uuid[],uuid[],text,bool,timestamptz,text,bool,int4,int4)', 'public anon authenticated', 'EXECUTE', '206 227 228', NULL),
        ('function', 'public.fn_verify_writing_assignment_request(uuid,uuid)', 'public anon authenticated', 'EXECUTE', '206', NULL),
        ('function', 'public.fn_finalize_d1_attempt(uuid,uuid,int4,float4,int4,timestamptz,timestamptz,jsonb)', 'public', 'EXECUTE', '211', NULL),
        ('function', 'public.fn_apply_srs_review_idempotent(uuid,uuid,text,int4,float4,int4,timestamptz,timestamptz)', 'public', 'EXECUTE', '212', NULL),
        ('function', 'public.fn_claim_session_renderer_affinity(uuid,uuid,text)', 'public anon authenticated', 'EXECUTE', '215 224', NULL),
        ('function', 'public.fn_create_session_daily_capped_v3(uuid,uuid,text,int4,text,timestamptz,int4,text)', 'public anon authenticated', 'EXECUTE', '216', NULL),
        ('function', 'public.fn_claim_reading_attempt_renderer_affinity(uuid,uuid,text,text)', 'public anon authenticated', 'EXECUTE', '218 224', NULL),
        ('function', 'public.fn_claim_listening_attempt_renderer_affinity(uuid,uuid,text)', 'public anon authenticated', 'EXECUTE', '219 224', NULL),
        ('function', 'public.fn_claim_dictation_attempt_renderer_affinity(uuid,uuid,text)', 'public anon authenticated', 'EXECUTE', '220 224', NULL),
        ('function', 'public.fn_finalize_dictation_attempt_from_session()', 'public anon authenticated', 'EXECUTE', '220', NULL),
        ('function', 'public.fn_guard_dictation_attempt_answer_mutation()', 'public anon authenticated', 'EXECUTE', '220 224', NULL),
        ('function', 'public.fn_claim_writing_assignment_renderer_affinity(uuid,uuid,text)', 'public anon authenticated', 'EXECUTE', '221 224', NULL),
        ('relation', 'public.course_pronunciation_sets', 'public anon authenticated', 'ALL', '223', NULL),
        ('relation', 'public.course_pronunciation_submissions', 'public anon authenticated', 'ALL', '223', NULL),
        ('function', 'public.fn_guard_active_player_terminal_mutation()', 'public anon authenticated', 'EXECUTE', '224', NULL),
        ('function', 'public.fn_guard_dictation_session_completion()', 'public anon authenticated', 'EXECUTE', '224', NULL),
        ('function', 'public.fn_guard_reading_attempt_answer_mutation()', 'public anon authenticated', 'EXECUTE', '224', NULL),
        ('function', 'public.fn_guard_speaking_question_mutation()', 'public anon authenticated', 'EXECUTE', '224', NULL),
        ('function', 'public.fn_guard_speaking_response_mutation()', 'public anon authenticated', 'EXECUTE', '224 225', NULL),
        ('function', 'public.fn_guard_writing_draft_mutation()', 'public anon authenticated', 'EXECUTE', '224', NULL),
        ('function', 'public.fn_set_active_player_resume_expiry()', 'public anon authenticated', 'EXECUTE', '224', NULL),
        ('relation', 'public.course_section_submissions', 'public anon authenticated', 'ALL', '226', NULL),
        ('function', 'public.fn_add_student_cohort_membership(uuid,uuid,uuid)', 'public anon authenticated', 'EXECUTE', '227', NULL),
        ('function', 'public.fn_add_students_cohort_membership(uuid[],uuid,uuid)', 'public anon authenticated', 'EXECUTE', '227', NULL),
        ('function', 'public.fn_remove_student_cohort_membership(uuid,uuid)', 'public anon authenticated', 'EXECUTE', '227', NULL),
        ('function', 'public.fn_sync_legacy_student_cohort_membership()', 'public anon authenticated', 'EXECUTE', '227', NULL),
        ('relation', 'public.student_cohort_memberships', 'public anon authenticated', 'ALL', '227', NULL),
        ('function', 'public.fn_activate_web_explanation_version(text,int4)', 'public anon authenticated', 'EXECUTE', '245 315', NULL),
        ('function', 'public.fn_record_mock_item_answer(text,uuid,uuid,int4,text,timestamptz,uuid)', 'public anon authenticated', 'EXECUTE', '245', NULL),
        ('relation', 'public.mock_correction_release_events', 'public anon authenticated', 'ALL', '245 257', NULL),
        ('relation', 'public.mock_correction_sessions', 'public anon authenticated', 'ALL', '245 257', NULL),
        ('relation', 'public.mock_error_hypotheses', 'public anon authenticated', 'ALL', '245 257', NULL),
        ('relation', 'public.mock_item_attempts', 'public anon authenticated', 'ALL', '245 257', NULL),
        ('relation', 'public.mock_post_test_captures', 'public anon authenticated', 'ALL', '245 257', NULL),
        ('relation', 'public.mock_runtime_events', 'public anon authenticated', 'ALL', '245 257', NULL),
        ('relation', 'public.mock_runtime_events', 'service_role', 'UPDATE DELETE TRUNCATE', '245 257', NULL),
        ('relation', 'public.web_explanation_objects', 'public anon authenticated', 'ALL', '245 257', NULL),
        ('function', 'public.fn_record_mock_correction_event(uuid,text,uuid,uuid,int4,text,jsonb,timestamptz,text)', 'public anon authenticated', 'EXECUTE', '257', NULL),
        ('function', 'public.fn_create_scoped_exam_class_assignment(uuid,text,text,text,uuid,jsonb,uuid,text,timestamptz,timestamptz,text,uuid,text,uuid[])', 'public anon authenticated', 'EXECUTE', '259 260', NULL),
        ('function', 'public.fn_approve_web_explanation_paper(text,uuid,uuid,text,text)', 'public anon authenticated', 'EXECUTE', '260 319', NULL),
        ('function', 'public.fn_update_class_assignment_explanation_policy(uuid,jsonb,uuid)', 'public anon authenticated', 'EXECUTE', '260', NULL),
        ('function', 'public.fn_update_mock_exam_with_explanation_approval(uuid,jsonb,uuid)', 'public anon authenticated', 'EXECUTE', '260 306', NULL),
        ('function', 'public.fn_update_public_test_explanation_policy(text,uuid,jsonb,uuid)', 'public anon authenticated', 'EXECUTE', '261 306', NULL),
        ('function', 'public.quiz_start_timed_course_session(uuid,uuid,uuid,text,text,bool)', 'public anon authenticated', 'EXECUTE', '263 264 265 266 270', NULL),
        ('function', 'public.quiz_insert_timed_course_attempts(uuid,uuid,jsonb)', 'public anon authenticated', 'EXECUTE', '265 279', NULL),
        ('function', 'public.quiz_replace_course_assessment_bank(uuid,jsonb,jsonb)', 'public anon authenticated', 'EXECUTE', '267 268', NULL),
        ('function', 'public.quiz_course_bank_assignment_revision(uuid)', 'public anon authenticated', 'EXECUTE', '269', NULL),
        ('function', 'public.quiz_create_course_assessment_bank(jsonb,jsonb)', 'public anon authenticated', 'EXECUTE', '271', NULL),
        ('function', 'public.quiz_finalize_timed_course_session(uuid,uuid,jsonb,jsonb)', 'public anon authenticated', 'EXECUTE', '273 274 275 276', NULL),
        ('function', 'public.quiz_close_expired_course_retry(uuid)', 'public anon authenticated', 'EXECUTE', '277', NULL),
        ('relation', 'public.advanced_vocab_listening_attempts', 'public anon authenticated', 'ALL', '281', NULL),
        ('relation', 'public.advanced_vocab_question_attempts', 'public anon authenticated', 'ALL', '281', NULL),
        ('relation', 'public.advanced_vocab_stage_progress', 'public anon authenticated', 'ALL', '281', NULL),
        ('function', 'public.finalize_advanced_vocab_assignment(uuid,uuid,uuid,jsonb)', 'public anon authenticated', 'EXECUTE', '281 282', NULL),
        ('function', 'public.finalize_advanced_vocab_on_listening()', 'public anon authenticated', 'EXECUTE', '281', NULL),
        ('function', 'public.advanced_vocab_canonical_practice_qids(uuid,text)', 'public anon authenticated', 'EXECUTE', '282 292', NULL),
        ('function', 'public.advanced_vocab_lock_open_item(uuid,uuid,uuid)', 'public anon authenticated', 'EXECUTE', '282', NULL),
        ('relation', 'public.advanced_vocab_practice_selections', 'public anon authenticated', 'ALL', '282', NULL),
        ('function', 'public.advanced_vocab_validate_selection(text,jsonb)', 'public anon authenticated', 'EXECUTE', '282', NULL),
        ('function', 'public.start_advanced_vocab_practice(uuid,uuid,uuid,text,jsonb)', 'public anon authenticated', 'EXECUTE', '282 292', NULL),
        ('function', 'public.assert_grammar_assignment_accepting(uuid)', 'public anon authenticated', 'EXECUTE', '283', NULL),
        ('function', 'public.create_assigned_grammar_diagnostic_session(uuid,uuid,uuid,text,text,text,int4)', 'public anon authenticated', 'EXECUTE', '283', NULL),
        ('function', 'public.finalize_grammar_diagnostic_session(uuid,uuid,text,jsonb,jsonb)', 'public anon authenticated', 'EXECUTE', '283', NULL),
        ('relation', 'public.grammar_content_releases', 'public anon authenticated', 'ALL', '283', NULL),
        ('relation', 'public.grammar_diagnostic_reports', 'public anon authenticated', 'ALL', '283', NULL),
        ('relation', 'public.grammar_diagnostic_responses', 'public anon authenticated', 'ALL', '283', NULL),
        ('relation', 'public.grammar_diagnostic_sessions', 'public anon authenticated', 'ALL', '283', NULL),
        ('relation', 'public.grammar_exposure_events', 'public anon authenticated', 'ALL', '283', NULL),
        ('relation', 'public.grammar_item_qmatrix', 'public anon authenticated', 'ALL', '283', NULL),
        ('relation', 'public.grammar_items', 'public anon authenticated', 'ALL', '283', NULL),
        ('relation', 'public.grammar_lessons', 'public anon authenticated', 'ALL', '283', NULL),
        ('relation', 'public.grammar_misconceptions', 'public anon authenticated', 'ALL', '283', NULL),
        ('relation', 'public.grammar_productive_tasks', 'public anon authenticated', 'ALL', '283', NULL),
        ('relation', 'public.grammar_remediation_routes', 'public anon authenticated', 'ALL', '283', NULL),
        ('function', 'public.promote_grammar_content_release(uuid)', 'public anon authenticated', 'EXECUTE', '283', NULL),
        ('function', 'public.record_and_finalize_grammar_diagnostic_session(uuid,uuid,text,int4,bool,int4,text,jsonb,jsonb)', 'public anon authenticated', 'EXECUTE', '283', NULL),
        ('function', 'public.guard_single_attempt_course_answer()', 'public anon authenticated', 'EXECUTE', '284 285', NULL),
        ('function', 'public.guard_single_attempt_course_session()', 'public anon authenticated', 'EXECUTE', '284 285', NULL),
        ('relation', 'public.advanced_vocab_rewrite_submissions', 'public anon authenticated', 'ALL', '288', NULL),
        ('function', 'public.claim_advanced_vocab_rewrite_submission(uuid,uuid,uuid,jsonb,jsonb,text)', 'public anon authenticated', 'EXECUTE', '288 289', NULL),
        ('function', 'public.advanced_vocab_guard_stage_progress()', 'public anon authenticated', 'EXECUTE', '290', NULL),
        ('function', 'public.upsert_advanced_vocab_bank(jsonb,jsonb,bool)', 'public anon authenticated', 'EXECUTE', '293', NULL),
        ('function', 'public.import_quiz_bank_atomic(jsonb,jsonb,text)', 'public anon authenticated', 'EXECUTE', '294 309', NULL),
        ('function', 'public.import_quiz_bank_unmanaged_306(jsonb,jsonb,text)', 'public anon authenticated service_role', 'EXECUTE', '294 309', NULL),
        ('function', 'public.fn_acquire_listening_programme_attempt(uuid,uuid,text)', 'public anon authenticated', 'EXECUTE', '295', NULL),
        ('function', 'public.import_listening_content_package_atomic(jsonb,jsonb,jsonb,jsonb)', 'public anon authenticated', 'EXECUTE', '295', NULL),
        ('relation', 'public.listening_content_packages', 'public anon authenticated', 'ALL', '295', NULL),
        ('relation', 'public.listening_exercises', 'public anon authenticated', 'ALL', '295', NULL),
        ('relation', 'public.listening_form_stimuli', 'public anon authenticated', 'ALL', '295', NULL),
        ('relation', 'public.listening_lessons', 'public anon authenticated', 'ALL', '295', NULL),
        ('relation', 'public.listening_package_stimuli', 'public anon authenticated', 'ALL', '295', NULL),
        ('function', 'public.set_listening_content_package_status(text,text,text,uuid)', 'public anon authenticated', 'EXECUTE', '295', NULL),
        ('function', 'public.fn_guard_listening_programme_feedback_reveal()', 'public anon authenticated', 'EXECUTE', '296', NULL),
        ('function', 'public.fn_record_listening_programme_feedback_reveal(uuid,uuid,int4)', 'public anon authenticated', 'EXECUTE', '296', NULL),
        ('relation', 'public.listening_programme_feedback_reveals', 'public anon authenticated', 'ALL', '296', NULL),
        ('function', 'public.fn_admin_writing_queue_page(text,uuid,bool,text,bool,int4,int4)', 'public anon authenticated', 'EXECUTE', '297 300', NULL),
        ('function', 'public.fn_admin_mock_actionable_review_exam_ids(uuid[])', 'public anon authenticated', 'EXECUTE', '298', NULL),
        ('function', 'public.fn_admin_exam_content_levels(text)', 'public anon authenticated', 'EXECUTE', '299', NULL),
        ('function', 'public.fn_admin_exam_content_page_ids(text,text,uuid,bool,bool,text,text,int4,int4)', 'public anon authenticated', 'EXECUTE', '299 301', NULL),
        ('function', 'public.fn_admin_mock_exams_with_review_eligibility()', 'public anon authenticated', 'EXECUTE', '302', NULL),
        ('function', 'public.fn_guard_listening_programme_start_drain()', 'public anon authenticated', 'EXECUTE', '303', NULL),
        ('relation', 'public.listening_programme_start_drain_gates', 'public anon authenticated service_role', 'ALL', '303', NULL),
        ('function', 'public.fn_guard_listening_source_provenance()', 'public anon authenticated', 'EXECUTE', '304', NULL),
        ('function', 'public.fn_dictation_has_lexical_words(text)', 'public anon authenticated', 'EXECUTE', '305', NULL),
        ('function', 'public.fn_dictation_reference_sha256(jsonb)', 'public anon authenticated', 'EXECUTE', '305', NULL),
        ('function', 'public.fn_dictation_segments_valid(text,jsonb)', 'public anon authenticated', 'EXECUTE', '305', NULL),
        ('function', 'public.fn_guard_dictation_answer_policy()', 'public anon authenticated', 'EXECUTE', '305', NULL),
        ('function', 'public.fn_guard_dictation_frozen_policy()', 'public anon authenticated', 'EXECUTE', '305', NULL),
        ('function', 'public.fn_guard_dictation_report_policy()', 'public anon authenticated', 'EXECUTE', '305', NULL),
        ('function_name', 'fn_acquire_listening_programme_attempt_v2', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_admit_mock_paper_attempt', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_capture_mock_paper_snapshot', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_create_mock_exam_with_paper_policy', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_guard_mock_paper_attempt', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_guard_mock_paper_policy', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_guard_mock_paper_reference', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_guard_mock_paper_source', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_guard_mock_reading_answer', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_guard_owned_mock_attempt', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_immutable_mock_paper_snapshot', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_inspect_mock_paper_policy', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_lock_mock_paper', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_mock_admission_contract_active', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_mock_overlap_valid', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_mock_paper_dependencies', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_mock_paper_error', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_mock_paper_row', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_mock_policy_snapshot', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_mock_protected_references', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_mock_public_practice_allowed', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_mock_section_valid', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_mutate_mock_paper_policy', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('function_name', 'fn_resolve_mock_paper_access', 'public anon authenticated', 'EXECUTE', '306', NULL),
        ('relation', 'public.listening_public_practice_catalog', 'public anon authenticated', 'ALL', '306', NULL),
        ('relation', 'public.listening_test_attempts', 'public anon', 'ALL', '306', NULL),
        ('relation', 'public.listening_test_attempts', 'authenticated', 'INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN', '306', NULL),
        -- 306 grants authenticated SELECT on these columns only (expected answers stay sealed).
        ('relation', 'public.listening_test_attempts', 'authenticated', 'SELECT', '306', 'id test_id user_id status answers started_at resume_expires_at renderer_affinity sitting_id class_assignment_item_id attempt_purpose paper_revision policy_revision'),
        ('relation', 'public.mock_paper_attempt_snapshots', 'public anon authenticated', 'ALL', '306', NULL),
        ('relation', 'public.reading_public_practice_catalog', 'public anon authenticated', 'ALL', '306', NULL),
        ('relation', 'public.reading_test_attempts', 'public anon', 'ALL', '306', NULL),
        ('relation', 'public.reading_test_attempts', 'authenticated', 'INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN', '306', NULL),
        -- 306 grants authenticated SELECT on these columns only (expected answers stay sealed).
        ('relation', 'public.reading_test_attempts', 'authenticated', 'SELECT', '306', 'id test_id user_id status answers started_at resume_expires_at renderer_affinity sitting_id class_assignment_item_id attempt_purpose paper_revision policy_revision'),
        ('function', 'public.fn_patch_mock_attempt_review_flag(text,uuid,uuid,text,int4,bool,int8,uuid)', 'public anon authenticated', 'EXECUTE', '307', NULL),
        ('relation', 'public.mock_attempt_review_flags', 'public anon authenticated', 'ALL', '307', NULL),
        ('relation', 'public.mock_attempt_review_flags', 'service_role', 'INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN', '307', NULL),
        ('function_like', 'grammar_quiz_%', 'public anon authenticated', 'EXECUTE', '309 314 339', NULL),
        ('function_like', 'grammar_quiz_%', 'service_role', 'EXECUTE', '309 314 339', 'public.grammar_quiz_start_service(uuid,uuid,text,text) public.grammar_quiz_start_service(uuid,uuid,text,text,text) public.grammar_quiz_progress_service(uuid,uuid,jsonb,jsonb) public.grammar_quiz_end_service(uuid,uuid,jsonb) public.grammar_quiz_reset_service(uuid,uuid) public.grammar_quiz_state(uuid,uuid)'),
        ('function', 'public.create_assigned_grammar_lesson_attempt(uuid,uuid,uuid,text,text,text,jsonb)', 'public anon authenticated', 'EXECUTE', '312 313', NULL),
        ('relation', 'public.grammar_lesson_attempts', 'public anon authenticated', 'ALL', '312', NULL),
        ('function', 'public.record_assigned_grammar_lesson_answer(uuid,uuid,text,int4)', 'public anon authenticated', 'EXECUTE', '312 313', NULL),
        ('function', 'public.guard_diagnostic_full_practice_exposure()', 'public anon authenticated', 'EXECUTE', '313', NULL),
        ('function', 'public.guard_diagnostic_full_practice_report()', 'public anon authenticated', 'EXECUTE', '313', NULL),
        ('function', 'public.guard_full_grammar_practice_start()', 'public anon authenticated', 'EXECUTE', '313', NULL),
        ('function', 'public.master30_full_practice_exposure(uuid)', 'public anon authenticated', 'EXECUTE', '313', NULL),
        ('function', 'public.master30_practice_overlaps(uuid,text,text,text)', 'public anon authenticated', 'EXECUTE', '313', NULL),
        ('function', 'public.protect_full_grammar_lesson_history()', 'public anon authenticated', 'EXECUTE', '313', NULL),
        ('function', 'public.record_assigned_grammar_lesson_response(uuid,uuid,text,int4,text)', 'public anon authenticated', 'EXECUTE', '313', NULL),
        ('function', 'public.record_assigned_grammar_lesson_writing_answer(uuid,uuid,text,text)', 'public anon authenticated', 'EXECUTE', '313', NULL),
        ('function', 'public.fn_copy_mock_draft_paper(text,uuid,uuid,uuid)', 'public anon authenticated', 'EXECUTE', '315 316', NULL),
        ('function', 'public.fn_create_mock_exam_with_paper_policy(jsonb,uuid)', 'public anon authenticated', 'EXECUTE', '315', NULL),
        ('function', 'public.fn_resolve_mock_paper_access(text,uuid,uuid,text,uuid,uuid,bool)', 'public anon authenticated', 'EXECUTE', '316', NULL),
        ('function', 'public.fn_finalize_d1_attempt_for_user(uuid,uuid,uuid,int4,float4,int4,timestamptz,timestamptz,jsonb)', 'public anon authenticated', 'EXECUTE', '320', NULL),
        ('function', 'public.fn_guard_users_privileged_columns()', 'public anon authenticated', 'EXECUTE', '320', NULL),
        ('relation', 'public.ai_model_override_audit', 'public anon authenticated', 'ALL', '322', NULL),
        ('relation', 'public.ai_model_override_audit', 'service_role', 'UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN', '322', NULL),
        ('relation', 'public.ai_model_overrides', 'public anon authenticated', 'ALL', '322', NULL),
        ('relation', 'public.ai_model_overrides', 'service_role', 'TRUNCATE REFERENCES TRIGGER MAINTAIN', '322', NULL),
        ('relation', 'public.ai_provider_failures', 'public anon authenticated', 'ALL', '322', NULL),
        ('relation', 'public.ai_provider_failures', 'service_role', 'UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN', '322', NULL),
        ('function', 'public.fn_admin_ai_failure_rollup(timestamptz,timestamptz)', 'public anon authenticated', 'EXECUTE', '322', NULL),
        ('function', 'public.fn_admin_ai_usage_rollup(timestamptz,timestamptz)', 'public anon authenticated', 'EXECUTE', '322', NULL),
        ('function', 'public.fn_ai_model_override_audit()', 'public anon authenticated', 'EXECUTE', '322', NULL),
        ('function', 'public.fn_ai_model_override_audit_append_only()', 'public anon authenticated', 'EXECUTE', '322', NULL),
        ('function', 'public.fn_archive_student(uuid,uuid,text,bool)', 'public anon authenticated', 'EXECUTE', '326', NULL),
        ('function', 'public.fn_restore_student(uuid,uuid,text,bool,bool)', 'public anon authenticated', 'EXECUTE', '326', NULL),
        ('relation', 'public.student_lifecycle_audit', 'public anon authenticated', 'ALL', '326', NULL),
        ('relation', 'public.student_lifecycle_audit', 'service_role', 'UPDATE DELETE TRUNCATE', '326', NULL),
        ('function', 'public.fn_guard_writing_assignment_student_archived()', 'public anon authenticated', 'EXECUTE', '331', NULL),
        ('relation', 'public.staff_security_audit', 'public anon authenticated', 'ALL', '332', NULL),
        ('relation', 'public.staff_security_audit', 'service_role', 'UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN', '332', NULL),
        ('relation', 'public.owner_alert_outbox', 'public anon authenticated', 'ALL', '332', NULL),
        ('relation', 'public.owner_alert_outbox', 'service_role', 'DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN', '332', NULL),
        ('relation', 'public.staff_mfa_factor_snapshot', 'public anon authenticated', 'ALL', '332', NULL),
        ('relation', 'public.staff_mfa_factor_snapshot', 'service_role', 'TRUNCATE REFERENCES TRIGGER MAINTAIN', '332', NULL),
        ('relation', 'public.staff_security_sweep_cursor', 'public anon authenticated', 'ALL', '332', NULL),
        ('relation', 'public.staff_security_sweep_cursor', 'service_role', 'TRUNCATE REFERENCES TRIGGER MAINTAIN', '332', NULL),
        ('function', 'public.fn_users_suspension_guard()', 'public anon authenticated service_role', 'EXECUTE', '332', NULL),
        ('function', 'public.fn_staff_security_audit_append_only()', 'public anon authenticated service_role', 'EXECUTE', '332', NULL),
        ('function', 'public.fn_staff_security_record(uuid,text,uuid,uuid,text,jsonb,jsonb,text,text,jsonb,bool)', 'public anon authenticated service_role', 'EXECUTE', '332', NULL),
        ('function', 'public.fn_users_privilege_audit()', 'public anon authenticated service_role', 'EXECUTE', '332', NULL),
        ('function', 'public.fn_set_staff_privilege(uuid,uuid,text,bool,text,text)', 'public anon authenticated', 'EXECUTE', '332', NULL),
        ('function', 'public.fn_bootstrap_admin_recovery(uuid,text,text)', 'public anon authenticated service_role', 'EXECUTE', '332', NULL),
        ('relation', 'public.activation_attempts', 'public anon authenticated', 'ALL', '334', NULL),
        ('relation', 'public.activation_attempts', 'service_role', 'INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN', '334', NULL),
        ('function', 'public.fn_activate_attempt_check(uuid)', 'public anon authenticated', 'EXECUTE', '334', NULL),
        ('schema', 'app_private', 'public anon', 'USAGE CREATE', '335', NULL),
        ('function', 'app_private.is_current_user_active()', 'public anon', 'EXECUTE', '335', NULL),
        ('function', 'public.fn_users_suspension_role_guard()', 'public anon authenticated service_role', 'EXECUTE', '336', NULL)
    ), target AS (
        SELECT i.*, o.oid, o.label, o.objtype, o.acl
          FROM invariant i
          LEFT JOIN LATERAL (
              SELECT c.oid, c.oid::regclass::text, 'r'::"char",
                     COALESCE(c.relacl, acldefault('r', c.relowner))
                FROM pg_class c
               WHERE i.kind = 'relation' AND c.oid = to_regclass(i.object)
              UNION ALL
              SELECT p.oid, p.oid::regprocedure::text, 'f'::"char",
                     COALESCE(p.proacl, acldefault('f', p.proowner))
                FROM pg_proc p
               WHERE (i.kind = 'function' AND p.oid = to_regprocedure(i.object))
                  OR (i.kind IN ('function_name', 'function_like')
                      AND p.pronamespace = 'public'::regnamespace
                      AND CASE WHEN i.kind = 'function_name' THEN p.proname = i.object
                               ELSE p.proname LIKE i.object END
                      AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(i.exempt, ' ')) e
                                       WHERE to_regprocedure(e) = p.oid))
              UNION ALL
              SELECT n.oid, n.nspname::text, 'n'::"char",
                     COALESCE(n.nspacl, acldefault('n', n.nspowner))
                FROM pg_namespace n
               WHERE i.kind = 'schema' AND n.nspname = i.object
          ) o(oid, label, objtype, acl) ON TRUE
    ), unresolved AS (
        SELECT kind, object, migrations FROM target WHERE oid IS NULL
        UNION ALL
        -- An exempt signature that no longer resolves would widen the row silently.
        SELECT i.kind, e, i.migrations
          FROM invariant i
         CROSS JOIN unnest(string_to_array(i.exempt, ' ')) e
         WHERE i.kind = 'function_like' AND to_regprocedure(e) IS NULL
    ), leak AS (
        SELECT format('%s:%s:%s [%s]', t.label, r.role, p.privilege, t.migrations) AS entry
          FROM target t
         CROSS JOIN unnest(string_to_array(t.roles, ' ')) r(role)
         CROSS JOIN unnest(CASE WHEN t.privileges = 'ALL'
                                THEN ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE',
                                           'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
                                ELSE string_to_array(t.privileges, ' ') END) p(privilege)
         WHERE t.oid IS NOT NULL
           AND CASE WHEN p.privilege = 'MAINTAIN'
                         AND current_setting('server_version_num')::int < 170000 THEN false
                    -- Column grants (GRANT UPDATE (col) ...) live in attacl, not relacl.
                    WHEN r.role = 'public'
                    THEN EXISTS (SELECT 1 FROM aclexplode(t.acl) a
                                  WHERE a.grantee = 0 AND a.privilege_type = p.privilege)
                      OR EXISTS (SELECT 1 FROM pg_attribute att
                                  CROSS JOIN aclexplode(att.attacl) a
                                  WHERE t.objtype = 'r' AND att.attrelid = t.oid
                                    AND att.attnum > 0 AND NOT att.attisdropped
                                    AND a.grantee = 0 AND a.privilege_type = p.privilege)
                    -- A relation row's exempt columns may carry this column privilege.
                    WHEN t.objtype = 'r' AND p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                    THEN has_table_privilege(r.role, t.oid, p.privilege)
                      OR EXISTS (SELECT 1 FROM pg_attribute att
                                  WHERE att.attrelid = t.oid AND att.attnum > 0 AND NOT att.attisdropped
                                    AND NOT att.attname::text = ANY (string_to_array(COALESCE(t.exempt, ''), ' '))
                                    AND has_column_privilege(r.role, t.oid, att.attnum, p.privilege))
                    WHEN t.objtype = 'r' THEN has_table_privilege(r.role, t.oid, p.privilege)
                    WHEN t.objtype = 'f' THEN has_function_privilege(r.role, t.oid, p.privilege)
                    ELSE has_schema_privilege(r.role, t.oid, p.privilege) END
    )
    SELECT (SELECT string_agg(DISTINCT format('%s %s [%s]', kind, object, migrations), ', ')
              FROM unresolved),
           (SELECT string_agg(entry, ', ' ORDER BY entry) FROM leak)
      INTO missing, leaks;
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'migration_acl_invariant_object_missing: %', missing;
    END IF;
    IF leaks IS NOT NULL THEN
        RAISE EXCEPTION 'migration_acl_invariant_violated: %', leaks;
    END IF;
END $$;
