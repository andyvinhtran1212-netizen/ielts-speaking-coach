# Research: who writes public tables as the owner (repository only)

PC-J357, 2026-10-30. **Repository only**: no staging or production
connection, no live catalog read. Base `origin/staging` at `672cd02b1`.
The live catalog (SA: 147 of 166 public tables grant `service_role` TRIGGER on
staging) remains SA's read-only check (`rollout.md` → Preconditions).

## 1. Method and limits

- The scan read every file in `backend/migrations/*.sql`, in number order,
  with comments stripped. For each function it kept the last definition and
  recorded:
  - whether it is `SECURITY DEFINER`;
  - whether it returns `trigger`;
  - its `INSERT INTO` / `UPDATE` / `DELETE FROM` / `MERGE INTO` / `TRUNCATE`
    targets;
  - the function's `GRANT` and `REVOKE … EXECUTE` history.
- A definer function counts as callable by `service_role` unless a migration
  runs `REVOKE … FROM … service_role` without a later grant. Supabase's
  default ACL grants EXECUTE to `service_role` directly, so revoking EXECUTE
  from PUBLIC alone does not remove it.
- From those writes, the scan followed two kinds of indirect write and kept
  following them until no new tables appeared:
  - triggers on the written tables (`CREATE TRIGGER … ON t … EXECUTE FUNCTION
    f`) and the writes of those trigger functions;
  - `ON DELETE CASCADE` and `SET NULL` foreign keys, followed only from
    DELETE writes.
- The dynamic writers `fn_ai_patch_row` and `fn_ai_insert_row` (333) were
  resolved by hand to the tables named at their call sites.
- Result: 139 definer RPCs callable by `service_role`, 48 definer trigger
  functions, and **83 public tables** written with owner identity.
- Limits:
  - The base schema predates migration 001 and is out of band, so its tables
    and functions are not visible here. Examples include any `auth.users`
    trigger that writes `public.users`.
  - The regex scan can miss writes built with `EXECUTE format(…)` beyond the
    two resolved by hand.
  - Open PRs are not included: 341 (#2050, `staff_privilege_evidence`) and
    356 (#2045, `class_action_log`).
  - This list is for **ordering and test fixtures only**. FR-001 covers every
    public relation, so a table the scan missed is still covered.
- Owner identity has more sources than definer RPCs:
  - **Owner sessions:** migrations, backfills and the `postgres` direct
    connections used by `staff_security_sweep.py`, the owner-alert outbox
    and `restore_into_project.sh`.
  - **Foreign-key cascades:** a referential action runs as the owner of the
    referencing table, so its BEFORE row triggers run as that owner. This
    is PostgreSQL's RI implementation (`ri_triggers.c` switches user ID to
    the referencing relation's owner). T001's test should confirm it with a
    negative control. If confirmed, a direct `service_role` DELETE on a
    parent table is enough to run a planted trigger on a child as the owner.

  Both are reasons Q-J357-2 recommends all tables.

## 2. Priority group 1: identity, privilege, lifecycle, enrolment and their audit

These are the tables where code running as the owner decides who is staff,
suspended, archived or enrolled, or writes the audit of it. A planted trigger
here defeats 326/332/336/337/341 directly.

| Table | Written with owner identity by | Repository ACL for `service_role` (before NNN) |
| --- | --- | --- |
| `users` | `fn_set_staff_privilege` (332), `fn_archive_student` (326), `fn_restore_student` (337), `fn_set_vocab_curated_cohort` (238); triggers `fn_users_privilege_audit` (definer), `fn_users_suspension_guard`, `fn_users_suspension_role_guard`, `fn_guard_users_privileged_columns` | default ACL only; no migration revokes TRIGGER (P2-SA-1) |
| `students` | `fn_archive_student`, `fn_restore_student`, `fn_add_student_cohort_membership`, `fn_add_students_cohort_membership`, `fn_remove_student_cohort_membership` (227/326/337); trigger `fn_sync_legacy_student_cohort_membership` (definer) | default ACL only |
| `student_cohort_memberships` | same five RPCs, and `fn_sync_legacy_student_cohort_membership` fired by `students` writes; trigger `fn_guard_membership_cohort_active` (337) | explicit `GRANT ALL` (227:482) |
| `student_lifecycle_audit` | `fn_archive_student`, `fn_restore_student` | 326 revokes UPDATE, DELETE, TRUNCATE; TRIGGER/REFERENCES/MAINTAIN remain |
| `cohorts` | `fn_archive_cohort`, `fn_restore_cohort` (337); trigger `fn_cohorts_archive_metadata` (definer) | default ACL only |
| `class_lifecycle_audit` | `fn_archive_cohort`, `fn_restore_cohort` | 337 revokes UPDATE, DELETE, TRUNCATE; TRIGGER/REFERENCES/MAINTAIN remain |
| `vocab_curated_cohort_events` | `fn_set_vocab_curated_cohort` (238; also writes `users`) | default ACL only |
| `staff_security_audit` | `fn_users_privilege_audit` (definer trigger on `users`), i.e. every staff-privilege, archive and restore write above | 332 `REVOKE ALL` then `GRANT SELECT, INSERT` → expected none; SA confirm on staging |
| `owner_alert_outbox` | `fn_users_privilege_audit` | 332 `REVOKE ALL` then `GRANT SELECT, INSERT, UPDATE` → expected none; SA confirm |
| `activation_attempts` | `fn_activate_attempt_check` (334) | 334 `REVOKE ALL` then `GRANT SELECT` → expected none; SA confirm |
| `staff_privilege_evidence` (341, #2050, not on staging base) | `fn_set_staff_privilege`, `fn_users_privilege_audit` | 341 `REVOKE ALL` from every API role → expected none |
| `class_action_log` (356, #2045/#2054) | backend INSERT as `service_role`, not a definer path | CALAPPEND-0041 FR-002 revokes TRIGGER/REFERENCES/MAINTAIN in 356 |

## 3. Compatibility: does anything need these privileges as `service_role`?

Searched (repository grep, 2026-10-30): `backend/` excluding tests,
`backend/scripts/`, `scripts/` and `.github/`. Patterns: `TRUNCATE`,
`CREATE [CONSTRAINT] TRIGGER`, `ENABLE|DISABLE TRIGGER`, `REFERENCES` in
DDL, `MAINTAIN`, `VACUUM`, `ANALYZE`, `CLUSTER`, `REINDEX`,
`REFRESH MATERIALIZED`, `LOCK TABLE`.

- **No runtime or script use.** Matches are prose only ("truncate a
  message", "references", "Maintain one active attempt", `WOULD ANALYZE` in a
  print). The backend reaches the DB as `service_role` only through PostgREST
  and RPC (supabase-py, 60 distinct `.rpc(...)` names). PostgREST cannot run
  DDL, TRUNCATE, VACUUM or LOCK.
- **The only `LOCK TABLE` is owner-run.** It is in migration 345:202, inside
  the migration's own `DO` block. There are no materialized views and no
  `REFRESH`.
- **Direct connections are `postgres`, not `service_role`.** These are the
  `DATABASE_URL` / `BACKUP_DATABASE_URL` users: `staff_security_sweep.py`
  (docstring: "the `postgres` role; `service_role` cannot read it"), the
  owner-alert outbox, the async DB client, `verify_prod_nextjs_migrations.py`,
  `apply_migrations.sh`, `offsite_backup.sh`, `restore_drill.sh` and
  `restore_into_project.sh`. `pg_dump` needs only SELECT.
- **Test harnesses are unaffected.** Several PG suites emulate the Supabase
  default ACL with `GRANT ALL ON TABLES TO anon, authenticated, service_role`
  (322, 326, 333, 345, `test_client_write_invariant_postgres.py`, …). They do
  not apply NNN, so they keep passing. No test runs `TRUNCATE` or
  `CREATE TRIGGER` as `service_role`.
- **One test reads a historical grant.** `test_course_pronunciation.py:283`
  checks the text of migration 223 (`GRANT ALL ON TABLE … TO service_role`).
  That is history and stays true; FR-006 exempts migrations at or below NNN.
- **Conclusion.** Revoking TRIGGER, REFERENCES, TRUNCATE and MAINTAIN from
  `service_role` breaks no known path. T001 still runs the full backend suite,
  and staging smoke and E2E after the apply (`rollout.md`).

## 4. Existing per-table revokes (repository)

These migrations already run `REVOKE ALL` (or `UPDATE, DELETE, TRUNCATE`) on
specific tables for `service_role`:

- 204: `class_action_log` TRUNCATE.
- 243, 244: core proofs and correlations.
- 247: core admission tables.
- 249, 255: core writing tables.
- 257: `mock_runtime_events` U/D/T.
- 303: `listening_programme_start_drain_gates`.
- 307: `mock_attempt_review_flags`.
- 322: AI override tables.
- 326: `student_lifecycle_audit` U/D/T.
- 332: the staff security tables.
- 333: the AI budget tables.
- 334: `activation_attempts`.
- 337: `class_lifecycle_audit` U/D/T.
- 352: `staff_mfa_status_throttle`.

This roughly matches SA's 19 staging tables without TRIGGER. NNN is a
no-op on them, and FR-002 keeps their remaining grants.

## 5. Clone script (PC-J350, PR #2055)

The base clone script `backend/scripts/staging_clone_schema_from_prod.sh`
causes two problems:

- Line 28 dumps with `--no-privileges`.
- Lines 58–63 then run `GRANT ALL ON ALL TABLES …` and `ALTER DEFAULT
  PRIVILEGES … GRANT ALL ON TABLES TO anon, authenticated, service_role`. Any
  clone therefore undoes NNN, 320 and 204.

PR #2055 (head `33be7ca80`, open) fixes this:

- It keeps object ACLs in the dump.
- It drops only the `supabase_admin` default-ACL lines.
- It removes lines 58–63.
- It adds `test_staging_clone_acl_policy.py`, which bans blanket ALL grants.

This spec only references #2055 (FR-007). After #2055, a clone copies the
source's ACLs and `postgres` default ACLs. Once NNN is applied on the source,
the clone keeps the revoked state; before that, it inherits the source's
grants and NNN is applied again. Line 53 (`GRANT ALL ON SCHEMA public TO
postgres, service_role`) stays and is Q-J357-3.

## 6. Other public tables written with owner identity (priority 2: definer RPC writes directly)

| Table | Definer RPCs callable by `service_role` that write it |
| --- | --- |
| `advanced_vocab_practice_selections` | `start_advanced_vocab_practice` |
| `advanced_vocab_rewrite_submissions` | `claim_advanced_vocab_rewrite_submission` |
| `advanced_vocab_stage_progress` | `claim_advanced_vocab_rewrite_submission` |
| `ai_budget_alerts` | `fn_ai_budget_close_scope`, `fn_ai_budget_raise_grant`, `fn_ai_budget_reserve` |
| `ai_budget_counters` | `fn_ai_budget_close_scope`, `fn_ai_budget_expire`, `fn_ai_budget_release`, `fn_ai_budget_reserve`, `fn_ai_budget_settle` |
| `ai_budget_raise_events` | `fn_ai_budget_raise_grant` |
| `ai_budget_raises` | `fn_ai_budget_raise_grant` |
| `ai_budget_reservations` | `fn_ai_budget_expire`, `fn_ai_budget_release`, `fn_ai_budget_reserve`, `fn_ai_budget_settle` |
| `ai_deferred_grading_jobs` | `fn_ai_deferred_claim`, `fn_ai_deferred_commit`, `fn_ai_deferred_save` |
| `ai_deferred_session_refresh` | `fn_ai_class_sync`, `fn_ai_deferred_aggregate_write`, `fn_ai_session_bands_write` |
| `class_assignment_items` | `create_assigned_grammar_diagnostic_session`, `create_assigned_grammar_lesson_attempt`, `finalize_advanced_vocab_assignment`, `finalize_grammar_diagnostic_session`, `fn_ai_class_sync`, `fn_backfill_assignment_items`, `fn_create_class_assignment`, `quiz_close_expired_course_retry`, `quiz_start_timed_course_session`, `record_assigned_grammar_lesson_response` |
| `class_assignments` | `fn_create_class_assignment`, `fn_delete_class_assignment_if_unsubmitted`, `fn_update_class_assignment_explanation_policy` |
| `core_admission_commands` | `fn_prepare_core_admission`, `fn_reconcile_core_admission`, `fn_reconcile_writing_admission` |
| `core_admission_epochs` | `fn_rotate_core_admission_epoch` |
| `core_admission_scopes` | `fn_enter_writing_baseline`, `fn_prepare_core_admission`, `fn_prepare_writing_admission` |
| `core_attempt_episodes` | `fn_prepare_core_admission` |
| `core_writing_cohort_reports` | `fn_capture_writing_cohort_report`, `fn_finalize_writing_cohort_report` |
| `essay_regrade_requests` | `fn_action_writing_regrade_request` |
| `exam_content_cohorts` | `fn_create_scoped_exam_class_assignment`, `fn_set_exam_content_cohorts` |
| `grammar_content_releases` | `promote_grammar_content_release` |
| `grammar_diagnostic_reports` | `finalize_grammar_diagnostic_session` |
| `grammar_diagnostic_responses` | `record_and_finalize_grammar_diagnostic_session` |
| `grammar_diagnostic_sessions` | `create_assigned_grammar_diagnostic_session`, `finalize_grammar_diagnostic_session` |
| `grammar_lesson_attempts` | `create_assigned_grammar_lesson_attempt`, `record_assigned_grammar_lesson_response` |
| `grammar_recommendations` | `fn_ai_deferred_commit` |
| `listening_content` | `fn_copy_mock_draft_paper`, `import_listening_content_package_atomic`, `set_listening_content_package_status` |
| `listening_content_packages` | `import_listening_content_package_atomic`, `set_listening_content_package_status` |
| `listening_exercises` | `fn_copy_mock_draft_paper`, `import_listening_content_package_atomic`, `set_listening_content_package_status` |
| `listening_form_stimuli` | `import_listening_content_package_atomic` |
| `listening_lessons` | `import_listening_content_package_atomic`, `set_listening_content_package_status` |
| `listening_package_stimuli` | `import_listening_content_package_atomic` |
| `listening_programme_feedback_reveals` | `fn_record_listening_programme_feedback_reveal` |
| `listening_test_attempts` | `fn_admit_mock_paper_attempt`, `fn_insert_listening_answer_once`, `fn_upsert_listening_answer` |
| `listening_tests` | `fn_mutate_mock_paper_policy`, `fn_update_mock_exam_with_explanation_approval`, `fn_update_public_test_explanation_policy`, `import_listening_content_package_atomic`, `set_listening_content_package_status` |
| `mock_attempt_review_flags` | `fn_patch_mock_attempt_review_flag` |
| `mock_correction_release_events` | `fn_approve_web_explanation_paper`, `fn_update_class_assignment_explanation_policy`, `fn_update_mock_exam_with_explanation_approval`, `fn_update_public_test_explanation_policy` |
| `mock_correction_sessions` | `fn_record_mock_correction_event` |
| `mock_exam_sittings` | `fn_admit_mock_paper_attempt`, `fn_merge_sitting_integrity`, `fn_void_sitting` |
| `mock_exams` | `fn_create_mock_exam_with_paper_policy`, `fn_set_exam_mode`, `fn_update_mock_exam_with_explanation_approval` |
| `mock_item_attempts` | `fn_record_mock_item_answer` |
| `mock_runtime_events` | `fn_record_mock_correction_event`, `fn_record_mock_item_answer` |
| `quiz_attempts` | `grammar_quiz_progress_service`, `quiz_insert_timed_course_attempts` |
| `quiz_banks` | `quiz_create_course_assessment_bank`, `quiz_replace_course_assessment_bank`, `upsert_advanced_vocab_bank` |
| `quiz_sessions` | `grammar_quiz_end_service`, `grammar_quiz_progress_service`, `grammar_quiz_reset_service`, `quiz_finalize_timed_course_session`, `quiz_start_timed_course_session` |
| `quiz_word_stats` | `grammar_quiz_progress_service`, `grammar_quiz_reset_service` |
| `reading_passages` | `fn_copy_mock_draft_paper` |
| `reading_questions` | `fn_copy_mock_draft_paper` |
| `reading_test_attempts` | `fn_admit_mock_paper_attempt` |
| `reading_tests` | `fn_mutate_mock_paper_policy`, `fn_update_mock_exam_with_explanation_approval`, `fn_update_public_test_explanation_policy` |
| `responses` | `fn_ai_deferred_commit`, `fn_ai_deferred_save` |
| `sessions` | `fn_ai_deferred_aggregate_write`, `fn_ai_session_bands_write`, `fn_bind_session_to_class_item` |
| `vocab_unit_recommendations` | `fn_open_vocab_unit_recommendation`, `fn_replace_speaking_vocab_recommendations` |
| `vocabulary_set_receipts` | `fn_answer_vocabulary_session` |
| `vocabulary_set_revisions` | `fn_save_vocabulary_set` |
| `vocabulary_set_sessions` | `fn_answer_vocabulary_session`, `fn_start_vocabulary_session` |
| `vocabulary_sets` | `fn_save_vocabulary_set` |
| `vocabulary_shared_progress` | `fn_answer_vocabulary_session` |
| `web_explanation_objects` | `fn_activate_web_explanation_version`, `fn_approve_web_explanation_paper`, `fn_copy_mock_draft_paper` |
| `writing_assignment_requests` | `fn_create_writing_assignments_idempotent` |
| `writing_assignments` | `fn_create_writing_assignments_idempotent`, `fn_enter_writing_baseline` |
| `writing_drafts` | `append_paste_event` |
| `writing_essays` | `fn_action_writing_regrade_request`, `fn_ai_deferred_commit_writing`, `fn_deliver_writing_essay` |
| `writing_feedback` | `fn_ai_deferred_commit_writing` |
| `writing_jobs` | `fn_ai_deferred_claim_writing`, `fn_ai_deferred_commit_writing` |

## 7. Reached only through a trigger or a foreign-key cascade (priority 3)

| Table | Path (from a `service_role`-callable definer RPC) |
| --- | --- |
| `advanced_vocab_listening_attempts` | `fn_delete_class_assignment_if_unsubmitted` → FK(class_assignments cascade) → FK(class_assignment_items cascade) |
| `advanced_vocab_question_attempts` | `fn_delete_class_assignment_if_unsubmitted` → FK(class_assignments cascade) → FK(class_assignment_items cascade) |
| `core_admission_journal` | `fn_prepare_core_admission` → trg(core_admission_commands) |
| `core_writing_origins` | `append_paste_event` → trg(writing_drafts) → trg(writing_assignments) |
| `course_pronunciation_submissions` | `fn_delete_class_assignment_if_unsubmitted` → FK(class_assignments cascade) → FK(class_assignment_items set null) |
| `course_section_submissions` | `fn_delete_class_assignment_if_unsubmitted` → FK(class_assignments cascade) → FK(class_assignment_items set null) |
| `course_writing_drafts` | `fn_delete_class_assignment_if_unsubmitted` → FK(class_assignments cascade) → FK(class_assignment_items cascade) |
| `course_writing_submissions` | `fn_delete_class_assignment_if_unsubmitted` → FK(class_assignments cascade) → FK(class_assignment_items set null) |
| `mock_paper_attempt_snapshots` | `fn_admit_mock_paper_attempt` → trg(reading_test_attempts) |

Every other `public` relation is priority 4. That includes `access_codes`,
`user_code_assignments` and other base-schema tables not visible here. They
are covered by FR-001 because owner sessions, cascades and future definer
functions can reach them.
