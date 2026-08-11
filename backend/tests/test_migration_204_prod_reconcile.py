"""Contracts for production schema reconciliation migration 204.

The production audit found a partially provisioned 173–203 range.  This guard
keeps the repair additive/idempotent and pins the four final contracts that must
exist before the historical ledger can be reconciled.  It also exercises the
dedicated deployment procedure so the normal forward runner never replays the
unledgered historical files before reaching 204.
"""

import importlib.util
from pathlib import Path
import subprocess

import pytest


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "204_reconcile_course_and_gate_e_schema.sql"
).read_text(encoding="utf-8")

BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = BACKEND_ROOT / "scripts" / "reconcile_prod_gate_e_migrations.py"
VERIFY_PATH = BACKEND_ROOT / "scripts" / "verify_prod_gate_e_reconcile.sql"
GRADING_PATH = BACKEND_ROOT / "routers" / "grading.py"
PROGRESS_BACKFILL_PATH = BACKEND_ROOT / "scripts" / "backfill_speaking_progress.py"
ADMIN_COURSES_PATH = BACKEND_ROOT / "routers" / "admin_courses.py"

_SPEC = importlib.util.spec_from_file_location("prod_gate_e_reconcile", SCRIPT_PATH)
assert _SPEC and _SPEC.loader
RECONCILE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(RECONCILE)


def test_pairing_constraint_fails_closed_before_validation():
    assert "class_assignment_items_artifact_pairing_violation" in SQL
    assert "(artifact_kind IS NULL) <> (artifact_id IS NULL)" in SQL
    assert "DROP CONSTRAINT IF EXISTS class_assignment_items_artifact_pairing" in SQL
    assert "ADD CONSTRAINT class_assignment_items_artifact_pairing" in SQL
    assert "VALIDATE CONSTRAINT class_assignment_items_artifact_pairing" in SQL


def test_full_test_identity_contract_is_reconciled():
    assert "ADD COLUMN IF NOT EXISTS full_test_attempt_id UUID" in SQL
    assert "WHERE mode = 'test_full'" in SQL
    assert "CREATE TRIGGER trg_sessions_full_test_attempt_id" in SQL
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_full_test_attempt_part" in SQL
    assert "CHECK (mode <> 'test_full' OR full_test_attempt_id IS NOT NULL)" in SQL


def test_session_create_retry_remains_idempotent_and_conflict_safe():
    assert "CREATE OR REPLACE FUNCTION fn_create_session_daily_capped_v2(" in SQL
    assert "pg_advisory_xact_lock(hashtext(p_session_id::text)::bigint)" in SQL
    assert "RAISE EXCEPTION 'session_id_conflict'" in SQL
    assert "RETURN NEXT v_existing" in SQL
    assert "RAISE EXCEPTION 'daily_quota_exceeded'" in SQL


def test_response_timestamp_is_server_authored_and_stable():
    assert (
        "ADD COLUMN IF NOT EXISTS persisted_at TIMESTAMP WITH TIME ZONE "
        "NOT NULL DEFAULT NOW()"
    ) in SQL


def test_reconciliation_is_atomic_and_does_not_drop_schema():
    assert SQL.count("BEGIN;") == 1
    assert SQL.count("COMMIT;") == 1
    assert "DROP TABLE" not in SQL
    assert "DROP COLUMN" not in SQL


def test_procedure_has_an_explicit_audited_manifest_not_a_directory_baseline():
    assert RECONCILE.AUDITED_HISTORY[0] == "173_listening_tests_practice_type.sql"
    assert RECONCILE.AUDITED_HISTORY[-1] == "202_response_persisted_at.sql"
    assert len(RECONCILE.AUDITED_HISTORY) == 28
    assert RECONCILE.REQUIRED_EXISTING == (
        "197_rls_explicit_on_public_tables.sql",
        "199_user_feedback_vocabulary.sql",
        "203_anonymous_vocabulary_feedback_dedupe.sql",
    )
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "apply_migrations.sh --baseline" in source  # warning/docstring only
    assert "glob(" not in source
    assert "iterdir(" not in source


def test_procedure_applies_204_then_verifies_before_recording(monkeypatch, capsys):
    events = []
    before = set(RECONCILE.REQUIRED_EXISTING)
    after = set(RECONCILE.RECONCILED_SCOPE)
    ledger_reads = iter((before, after))

    monkeypatch.setattr(RECONCILE, "_ensure_ledger", lambda _url: events.append("ensure"))
    monkeypatch.setattr(RECONCILE, "_read_ledger", lambda _url: next(ledger_reads))
    monkeypatch.setattr(RECONCILE, "_apply_repair", lambda _url: events.append("repair-204"))
    monkeypatch.setattr(
        RECONCILE,
        "_verify_audited_postconditions",
        lambda _url: events.append("verify"),
    )

    def record(_url, filenames):
        events.append(("record", tuple(filenames)))

    monkeypatch.setattr(RECONCILE, "_record_ledger", record)
    monkeypatch.setattr(
        RECONCILE,
        "_standard_forward_dry_run",
        lambda _url: "----\nwould apply: 205_future.sql\n",
    )

    RECONCILE.reconcile("postgresql://staging.example/test", dry_run=False)

    assert events[:3] == ["ensure", "repair-204", "verify"]
    assert events[3] == (
        "record",
        (*RECONCILE.AUDITED_HISTORY, RECONCILE.REPAIR_MIGRATION),
    )
    output = capsys.readouterr().out
    assert "standard forward dry-run lists no migration from 173-204" in output


def test_second_procedure_run_is_a_schema_and_ledger_noop(monkeypatch, capsys):
    events = []
    monkeypatch.setattr(RECONCILE, "_ensure_ledger", lambda _url: events.append("ensure"))
    monkeypatch.setattr(
        RECONCILE,
        "_read_ledger",
        lambda _url: set(RECONCILE.RECONCILED_SCOPE),
    )
    monkeypatch.setattr(RECONCILE, "_apply_repair", lambda _url: events.append("repair"))
    monkeypatch.setattr(
        RECONCILE,
        "_verify_audited_postconditions",
        lambda _url: events.append("verify"),
    )
    monkeypatch.setattr(
        RECONCILE,
        "_record_ledger",
        lambda _url, _files: events.append("record"),
    )
    monkeypatch.setattr(
        RECONCILE,
        "_standard_forward_dry_run",
        lambda _url: "----\nwould apply: 205_future.sql\n",
    )

    RECONCILE.reconcile("postgresql://staging.example/test", dry_run=False)

    assert events == ["ensure"]
    assert "no-op: audited 173-204 ledger scope is already reconciled" in capsys.readouterr().out


def test_post_reconcile_forward_dry_run_rejects_any_historical_replay():
    with pytest.raises(RECONCILE.ReconciliationError, match="would replay"):
        RECONCILE._assert_no_historical_replay(
            "would apply: 173_listening_tests_practice_type.sql\n"
        )


def test_procedure_refuses_if_the_preexisting_ledger_no_longer_matches(monkeypatch):
    monkeypatch.setattr(RECONCILE, "_ensure_ledger", lambda _url: None)
    monkeypatch.setattr(RECONCILE, "_read_ledger", lambda _url: set())
    monkeypatch.setattr(
        RECONCILE,
        "_apply_repair",
        lambda _url: pytest.fail("must refuse before applying migration 204"),
    )

    with pytest.raises(RECONCILE.ReconciliationError, match="required existing"):
        RECONCILE.reconcile("postgresql://staging.example/test", dry_run=False)


def test_production_dry_run_needs_no_write_authorization(monkeypatch, capsys):
    monkeypatch.delenv("ALLOW_PROD", raising=False)
    monkeypatch.setattr(
        RECONCILE,
        "_read_ledger",
        lambda _url: set(RECONCILE.REQUIRED_EXISTING),
    )

    RECONCILE.reconcile(
        f"postgresql://db.{RECONCILE.PRODUCTION_PROJECT_REF}.supabase.co/postgres",
        dry_run=True,
    )

    output = capsys.readouterr().out
    assert f"would apply first: {RECONCILE.REPAIR_MIGRATION}" in output


def test_main_does_not_log_database_url_from_failed_subprocess(monkeypatch, capsys):
    sentinel = "never-print-this-password"
    database_url = f"postgresql://postgres:{sentinel}@db.example.test/postgres"

    def fail(_url, *, dry_run):
        assert dry_run is False
        raise subprocess.CalledProcessError(
            17,
            ["psql", database_url, "-c", "SELECT 1"],
        )

    monkeypatch.delenv("DRY_RUN", raising=False)
    monkeypatch.setattr(RECONCILE, "reconcile", fail)

    assert RECONCILE.main(["reconcile_prod_gate_e_migrations.py", database_url]) == 1
    stderr = capsys.readouterr().err
    assert sentinel not in stderr
    assert database_url not in stderr
    assert "database command exited with status 17" in stderr


def test_postcondition_sql_pins_final_schema_data_and_rpc_body():
    verify_sql = VERIFY_PATH.read_text(encoding="utf-8")
    assert "seed:courses.C1-C5" in verify_sql
    assert "data:artifact-pairing" in verify_sql
    assert "data:course-writing-duplicate-item" in verify_sql
    assert "data:full-test-attempt-id" in verify_sql
    assert "column-contract:responses.persisted_at" in verify_sql
    assert "format_type(a.atttypid, a.atttypmod) = 'timestamp with time zone'" in verify_sql
    assert "a.attnotnull" in verify_sql
    assert "pg_get_expr(d.adbin, d.adrelid) = 'now()'" in verify_sql
    assert "column-contract:class_assignment_items.score" in verify_sql
    assert "format_type(a.atttypid, a.atttypmod) = 'numeric(4,1)'" in verify_sql
    assert "constraint-contract:class_assignment_items.score" in verify_sql
    assert "con.convalidated" in verify_sql
    assert "score <= (100)::numeric" in verify_sql
    assert "function-contract:fn_insert_listening_answer_once" in verify_sql
    assert "l.lanname = 'plpgsql'" in verify_sql
    assert "p.prorettype = 'boolean'::regtype" in verify_sql
    assert "p.prosecdef" in verify_sql
    assert "p.proconfig = ARRAY['search_path=public, pg_temp']::text[]" in verify_sql
    assert "md5(p.prosrc) = '856941cccd7f1e4a4df130f9286a189f'" in verify_sql
    assert "function-contract:fn_bind_session_to_class_item" in verify_sql
    assert "md5(p.prosrc) = '804aff9dc563a6d6361efd8d1a511f4c'" in verify_sql
    assert "function-contract:fn_backfill_assignment_items" in verify_sql
    assert "p.prorettype = 'record'::regtype" in verify_sql
    assert "md5(p.prosrc) = '578c2592304f1866bd26931384af8513'" in verify_sql
    for function_name, body_md5 in (
        ("fn_create_class_assignment", "ee2d9cb823b7bee3d953608ff9b8466b"),
        ("fn_delete_class_assignment_if_unsubmitted", "93753c50092f72543734884464d2f7ef"),
        ("quiz_replace_questions", "c8098f0e3198f841ef1dc81124edbeb6"),
        ("set_speaking_full_test_attempt_id", "118d4c2e7c69140ab7c5657f9f9cefd0"),
        ("fn_create_session_daily_capped_v2", "ddb02c330107b985d6a5facfda95ffa9"),
    ):
        assert function_name in verify_sql
        assert body_md5 in verify_sql
    assert "p.prorettype = to_regtype(tbl)" in verify_sql
    assert "p.prosecdef = fn_security" in verify_sql
    assert "function-contract:fn_class_action_log_append_only" in verify_sql
    assert "p.prorettype = 'trigger'::regtype" in verify_sql
    assert "md5(p.prosrc) = '3c0a0fbc7f3f6da45c1e47bda5d4e10d'" in verify_sql
    assert "column-contract:class_assignments.recipient_scope" in verify_sql
    assert "pg_get_expr(d.adbin, d.adrelid) = '''class''::text'" in verify_sql
    assert "column-contract:class_assignments.content_config" in verify_sql
    assert "format_type(a.atttypid, a.atttypmod) = 'jsonb'" in verify_sql
    assert "pg_get_expr(d.adbin, d.adrelid) = '''{}''::jsonb'" in verify_sql
    assert "column-contract:class_assignment_items.state" in verify_sql
    assert "pg_get_expr(d.adbin, d.adrelid) = '''assigned''::text'" in verify_sql
    assert "constraint-contract:class_assignment_items.state" in verify_sql
    assert "class_assignment_items_state_check" in verify_sql
    assert "data:class_assignment_items.state" in verify_sql
    assert "column-contract:speaking_progress_marks.response_id" in verify_sql
    assert "speaking_progress_marks_response_id_key" in verify_sql
    assert "constraint-contract:speaking_progress_marks.response-id-unique" in verify_sql
    assert "speaking_progress_marks_response_id_fkey" in verify_sql
    assert "constraint-contract:speaking_progress_marks.response-parent" in verify_sql
    assert "data:speaking_progress_marks.response-id-duplicate" in verify_sql
    assert "ARRAY['response_id']::name[]" in verify_sql
    assert "column-contract:courses.code" in verify_sql
    assert "courses_code_key" in verify_sql
    assert "constraint-contract:courses.code-unique" in verify_sql
    assert "data:courses.code-duplicate" in verify_sql
    assert "ARRAY['code']::name[]" in verify_sql
    assert "column-contract:' || expected_pk.table_name || '.id'" in verify_sql
    assert "constraint-contract:' || expected_pk.table_name || '.primary-key'" in verify_sql
    assert "pg_get_expr(d.adbin, d.adrelid) = 'gen_random_uuid()'" in verify_sql
    assert "con.conname = expected_pk.table_name || '_pkey'" in verify_sql
    assert "expected_fk.referenced_table" in verify_sql
    assert "expected_fk.local_columns" in verify_sql
    assert "expected_fk.referenced_columns" in verify_sql
    assert "expected_fk.delete_action" in verify_sql
    assert "cohorts_course_id_fkey" in verify_sql
    assert "class_assignment_items_student_id_fkey" in verify_sql
    assert "speaking_lesson_sets_course_id_fkey" in verify_sql
    assert "quiz_banks_course_id_fkey" in verify_sql
    assert "course_writing_drafts_class_assignment_item_id_fkey" in verify_sql
    assert "expected_column.formatted_type" in verify_sql
    assert "expected_column.not_null" in verify_sql
    assert "expected_column.default_expression" in verify_sql
    assert "column-contract:' || expected_column.table_name" in verify_sql
    for contract in (
        "('cohorts', 'course_id', 'uuid', false, NULL::text)",
        "('sessions', 'class_assignment_item_id', 'uuid', false, NULL::text)",
        "('sessions', 'full_test_attempt_id', 'uuid', false, NULL::text)",
        "('reading_test_attempts', 'class_assignment_item_id', 'uuid', false, NULL::text)",
        "('listening_test_attempts', 'class_assignment_item_id', 'uuid', false, NULL::text)",
        "('topic_questions', 'audio_url', 'text', false, NULL::text)",
        "('topic_questions', 'audio_path', 'text', false, NULL::text)",
        "('topic_questions', 'level', 'text', false, NULL::text)",
        "('questions', 'audio_url', 'text', false, NULL::text)",
        "('questions', 'listen_only', 'boolean', true, 'false')",
        "('quiz_questions', 'why_wrong', 'jsonb', false, NULL::text)",
        "('quiz_banks', 'course_id', 'uuid', false, NULL::text)",
        "('quiz_banks', 'lesson_no', 'integer', false, NULL::text)",
        "('quiz_sessions', 'class_assignment_item_id', 'uuid', false, NULL::text)",
        "('quiz_sessions', 'kind', 'text', true, '''run''::text')",
        "('responses', 'persisted_at', 'timestamp with time zone', true, 'now()')",
        "('user_feedback', 'anonymous_dedupe_key', 'text', false, NULL::text)",
    ):
        assert contract in verify_sql
    assert "course_writing_submissions_total_check" in verify_sql
    assert "course_writing_submissions_clean_check" in verify_sql
    assert "course_writing_clean_within_total" in verify_sql
    assert "CHECK ((clean <= total))" in verify_sql
    assert "class_assignments_status_check" in verify_sql
    assert "'''published''::text'" in verify_sql
    assert "data:class_assignments.status" in verify_sql
    assert "class_action_log_action_check" in verify_sql
    assert "data:class_action_log.action" in verify_sql
    assert "'class_action_log', 'details', 'jsonb', true, '''{}''::jsonb'" in verify_sql
    assert "table-column-fingerprint:' || expected_table.table_name" in verify_sql
    assert "table-constraint-fingerprint:' || expected_table.table_name" in verify_sql
    assert "expected_table.column_hash" in verify_sql
    assert "expected_table.constraint_hash" in verify_sql
    assert "expected_table.column_count" in verify_sql
    assert "expected_table.constraint_count" in verify_sql
    assert "COALESCE(pg_get_expr(d.adbin, d.adrelid), '<null>')" in verify_sql
    for table_name, column_hash, column_count, constraint_hash, constraint_count in (
        ("class_action_log", "e7f091fe1b1fd0dbf842576d5a1f5709", 11,
         "66055ecab39b450e11fc2a529c776c8d", 2),
        ("class_assignment_items", "ce6ece6aed5694e124c88efe47de1319", 13,
         "2da9d3e9b38d7d709fd1469b54076154", 9),
        ("class_assignments", "93c0789e69084e8be087426f68136afa", 16,
         "c13ca7cf656bf783c7aa5cbed99486a1", 8),
        ("class_lessons", "bafa54d302d3670c4ae2a39df210b8e8", 11,
         "bc7bcc611ae1fe97b1226a7d88fba7e9", 5),
        ("course_writing_drafts", "f363a6f0056498516d4f061f2d9fccea", 7,
         "5f8960c8dc58ca5c830822799c9936cc", 3),
        ("course_writing_submissions", "1cd7c19eae1156745db96780cee2b3ec", 10,
         "576541f9ca975ff301f58643c0fd4411", 7),
        ("courses", "697a741779d2050d2607a78256c79298", 9,
         "ff83396dc07906bf6be243b42cec1fb0", 3),
        ("speaking_lesson_set_questions", "dc84cd18618b95a7e5538b867fef71d3", 14,
         "dd0b5308ef38df8e821cfaf92c35930d", 5),
        ("speaking_lesson_sets", "6e7fc9c45565df4d477ced675e11b6bc", 10,
         "16c37494c9ef10bfaf5b6e0713f1c8d0", 6),
        ("speaking_progress_marks", "5938715f0be38ef6c7e8ac05ecadf099", 16,
         "6e538f05d20eceecc3b21c308dbd19bb", 3),
    ):
        assert f"('{table_name}', '{column_hash}', {column_count}," in verify_sql
        assert f"'{constraint_hash}', {constraint_count})" in verify_sql
    assert "expected_check.definition" in verify_sql
    assert "class_assignments_kind_check" in verify_sql
    assert "class_assignment_items_artifact_pairing" in verify_sql
    assert "class_assignment_items_submitted_at_required" in verify_sql
    assert "topic_questions_level_check" in verify_sql
    assert "quiz_banks_lesson_no_check" in verify_sql
    assert "quiz_sessions_kind_check" in verify_sql
    assert "sessions_full_test_attempt_required" in verify_sql
    assert "user_feedback_skill_check" in verify_sql
    assert "user_feedback_anonymous_dedupe_scope" in verify_sql
    assert "uq_feedback_anon_vocab_daily" in verify_sql
    assert "expected_trigger.definition" in verify_sql
    assert "trg.tgfoid = to_regprocedure" in verify_sql
    assert "trg.tgenabled = 'O'" in verify_sql
    assert "trigger-contract:' || expected_trigger.table_name" in verify_sql
    assert "c.relkind IN ('r', 'p')" in verify_sql
    assert "AND NOT c.relrowsecurity" in verify_sql
    assert "rls:all-public-tables" in verify_sql
    assert "constraint-contract:' || expected_evidence_fk.table_name" in verify_sql
    assert "sessions_class_assignment_item_id_fkey" in verify_sql
    assert "reading_test_attempts_class_assignment_item_id_fkey" in verify_sql
    assert "listening_test_attempts_class_assignment_item_id_fkey" in verify_sql
    assert "quiz_sessions_class_assignment_item_id_fkey" in verify_sql
    assert "course_writing_submissions_class_assignment_item_id_fkey" in verify_sql
    assert "con.confdeltype = 'n'" in verify_sql
    assert "ARRAY['class_assignment_item_id']::name[]" in verify_sql
    assert "removed-column:course_writing_drafts.seq" in verify_sql
    assert "public.fn_save_course_writing_draft(uuid,uuid,uuid,jsonb,bigint)" in verify_sql
    assert "removed-function:fn_save_course_writing_draft" in verify_sql
    assert "removed-function:' || item" in verify_sql
    for retired_signature in (
        "public.fn_create_class_assignment(uuid,text,text,uuid,jsonb,uuid,text,"
        "timestamp with time zone,timestamp with time zone,text,uuid)",
        "public.fn_create_class_assignment(uuid,text,text,uuid,jsonb,uuid,text,"
        "timestamp with time zone,timestamp with time zone,text,uuid,text)",
    ):
        assert retired_signature in verify_sql
    assert "constraint-contract:class_assignments.recipient_scope" in verify_sql
    assert "constraint-contract:listening_tests.test_type" in verify_sql
    assert "constraint-contract:class_assignments.skill" in verify_sql
    assert "data:class_assignments.skill" in verify_sql
    assert "constraint-contract:class_assignment_items.assignment-student" in verify_sql
    assert "class_assignment_items_assignment_id_student_id_key" in verify_sql
    assert "idx.indisunique" in verify_sql
    assert "idx.indisvalid" in verify_sql
    assert "idx.indisready" in verify_sql
    assert "ARRAY['assignment_id', 'student_id']::name[]" in verify_sql
    assert "constraint-contract:class_assignment_items.assignment-parent" in verify_sql
    assert "class_assignment_items_assignment_id_fkey" in verify_sql
    assert "con.confrelid = 'public.class_assignments'::regclass" in verify_sql
    assert "con.confdeltype = 'c'" in verify_sql
    assert "ARRAY['assignment_id']::name[]" in verify_sql
    assert "data:class_assignments.recipient_scope" in verify_sql
    assert "data:listening_tests.test_type" in verify_sql
    assert "data:class_assignment_items.assignment-student-duplicate" in verify_sql
    assert "service-only-acl:" in verify_sql
    assert "has_function_privilege('anon'" in verify_sql
    assert "has_function_privilege('authenticated'" in verify_sql
    assert "has_function_privilege('service_role'" in verify_sql
    assert "required-service-acl:fn_create_session_daily_capped_v2" in verify_sql
    assert "'service_role',\n        'public.fn_create_session_daily_capped_v2" in verify_sql
    for function_name in (
        "fn_insert_listening_answer_once",
        "fn_create_class_assignment",
        "fn_backfill_assignment_items",
        "fn_delete_class_assignment_if_unsubmitted",
        "fn_bind_session_to_class_item",
        "quiz_replace_questions",
    ):
        assert verify_sql.count(function_name) >= 2
    assert "security-definer-owner:' || item" in verify_sql
    assert "JOIN pg_roles owner_role ON owner_role.oid = p.proowner" in verify_sql
    assert "owner_role.rolname = 'postgres'" in verify_sql
    for security_definer_function in (
        "fn_insert_listening_answer_once",
        "fn_create_class_assignment",
        "fn_backfill_assignment_items",
        "fn_delete_class_assignment_if_unsubmitted",
        "fn_bind_session_to_class_item",
    ):
        assert verify_sql.count(security_definer_function) >= 3
    assert "service-only-table-acl:course_writing_drafts" in verify_sql
    assert "service-role-table-acl:' || item" in verify_sql
    for table_name in (
        "courses",
        "class_lessons",
        "class_assignments",
        "class_assignment_items",
        "speaking_lesson_sets",
        "speaking_lesson_set_questions",
        "speaking_progress_marks",
        "course_writing_submissions",
        "course_writing_drafts",
        "class_action_log",
    ):
        assert f"'{table_name}'" in verify_sql
    assert "format('public.%I', item)" in verify_sql
    assert "required_privilege.name" in verify_sql
    assert "has_table_privilege('anon'" in verify_sql
    assert "has_table_privilege('authenticated'" in verify_sql
    assert "has_table_privilege('service_role'" in verify_sql
    for privilege in (
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
    ):
        assert f"'service_role', 'public.course_writing_drafts', '{privilege}'" in verify_sql
    assert "trigger-contract:class_action_log.append-only" in verify_sql
    assert "tgenabled = 'O'" in verify_sql
    assert "tgtype = 27" in verify_sql
    assert "tgfoid = to_regprocedure('public.fn_class_action_log_append_only()')" in verify_sql
    assert "forbidden-foreign-key:class_action_log" in verify_sql
    assert "con.contype = 'f'" in verify_sql
    assert "constraint-contract:class_lessons.id-cohort" in verify_sql
    assert "ARRAY['id', 'cohort_id']::name[]" in verify_sql
    assert "constraint-contract:class_assignments.lesson-cohort" in verify_sql
    assert "con.confrelid = 'public.class_lessons'::regclass" in verify_sql
    assert "con.confdeltype = 'n'" in verify_sql
    assert "ARRAY['lesson_id', 'cohort_id']::name[]" in verify_sql
    assert "unnest(con.confdelsetcols)" in verify_sql
    assert "ARRAY['lesson_id']::name[]" in verify_sql
    assert "constraint-contract:class_assignment_items.artifact_kind" in verify_sql
    for artifact_kind in (
        "session",
        "writing_assignment",
        "reading_attempt",
        "listening_attempt",
        "quiz_session",
        "course_writing",
    ):
        assert f"''{artifact_kind}''::text" in verify_sql
    assert "obsolete-constraint:course_writing_submissions(bank_id,user_id)" in verify_sql
    assert "ARRAY['bank_id', 'user_id']::name[]" in verify_sql
    assert "index-contract:uq_sessions_full_test_attempt_part" in verify_sql
    assert "FROM pg_index i" in verify_sql
    assert "i.indisunique" in verify_sql
    assert "i.indisvalid" in verify_sql
    assert "i.indisready" in verify_sql
    assert "i.indnatts = 2" in verify_sql
    assert "i.indnkeyatts = 2" in verify_sql
    assert "ARRAY['full_test_attempt_id', 'part']::name[]" in verify_sql
    assert "pg_get_expr(i.indpred, i.indrelid)" in verify_sql
    assert "index-contract:uq_course_writing_per_item" in verify_sql
    assert "'public.course_writing_submissions'::regclass" in verify_sql
    assert "'(class_assignment_item_id IS NOT NULL)'" in verify_sql
    assert "index-contract:uq_course_writing_draft_per_item" in verify_sql
    assert "'public.course_writing_drafts'::regclass" in verify_sql
    assert "i.indpred IS NULL" in verify_sql
    assert "ARRAY['class_assignment_item_id']::name[]" in verify_sql
    assert "'index-contract:' || expected_index.index_name" in verify_sql
    assert "'index-fingerprint:' || expected_index.index_name" in verify_sql
    assert "md5(pg_get_indexdef(i.indexrelid))" in verify_sql
    for index_name, definition_hash in (
        ("idx_class_action_log_assignment", "815e78dc0ac92856c3ada07bd8d2e7d4"),
        ("idx_class_action_log_cohort", "edcb99ab1c31f8b2a12055a496678aaf"),
        ("idx_class_assignment_items_artifact", "6fbea9a8007be2ad62b36fd5bb494e8f"),
        ("idx_class_assignment_items_outstanding", "bdaed6e860d6eab0a979b903ade65f27"),
        ("idx_class_assignment_items_student", "c41263f3d1569fe8d9a9235b51f57177"),
        ("idx_class_assignments_cohort_due", "a7c6dc611b76de0add93dd2a0d83474f"),
        ("idx_class_assignments_due_open", "1b97b4b8caf47e36eb233c728da5b6cf"),
        ("idx_class_assignments_lesson", "b6018f69a8c6abe0ad4931ad98f12138"),
        ("idx_class_lessons_cohort_order", "1618e7135a89aa123fe6287d79f886f9"),
        ("idx_class_lessons_published", "fc17f01d6b702e591f02b29598bbcff2"),
        ("idx_cohorts_course_id", "90be787c20a40e5e573e95d1ec71d09c"),
        ("idx_course_writing_item", "7b61ae0cc23a14b240afcb2d63b9490e"),
        ("idx_course_writing_user", "9b5f42b2175f1df9f89925eab3eecfc7"),
        ("idx_courses_active_order", "277bfc29b9347bb5d9d4e79ac5295d47"),
        ("idx_listening_attempts_class_item", "254e99bf578e0c039942fae2bd6a6e4f"),
        ("idx_listening_tests_practice_group", "314c62782bd1da4eb7e3021134dd2612"),
        ("idx_quiz_banks_course", "327690b27408e6d67ae9ab84a69007a1"),
        ("idx_quiz_sessions_class_item", "952f6bc0b982fe486f8c8c4abe3873b3"),
        ("idx_reading_attempts_class_item", "efeb7eff3bc757fa4cd7af5e5d7db5c4"),
        ("idx_sessions_class_assignment_item", "f9b6a14ec35a9e2701fe5fa1ac7a6bdd"),
        ("idx_sessions_full_test_attempt_id", "37c15557265bf149da6460c80cbefcf7"),
        ("idx_slsq_set", "92f035413fafee826a2cdd055f018c57"),
        ("idx_speaking_lesson_sets_course", "1d42516a5ecde255bf9f0af589f09a62"),
        ("idx_spm_class_item", "0a37bb27d2fb49108ecc6caac83a32ef"),
        ("idx_spm_session", "23496cd7e9df65c466604c402f47f565"),
        ("idx_spm_user_time", "d8c78ef7490fd06a97d9ed8b82548899"),
        ("idx_topic_questions_part_level", "0c9a31ecb25e52110255a0f97d4f5e2a"),
        ("ix_course_writing_draft_user", "31305d32e251c539b771c9ba8c4a0286"),
        ("uq_class_assignment_speaking_topic_per_cohort", "26c0e6bcf0ef2c972e95036c63b24c36"),
        ("uq_course_writing_draft_per_item", "e7453741b4a98bcce9309cfc6cb66157"),
        ("uq_course_writing_per_item", "06ffdbe62180b738ba79d2a37cf76cbc"),
        ("uq_feedback_anon_vocab_daily", "7656914d48c7625080646060e6b8757f"),
        ("uq_quiz_bank_course_lesson", "a97b80e35d4ceb19be581acd4ca1c515"),
        ("uq_sessions_full_test_attempt_part", "6601e72ee9d3ef2e4520c45c445287f7"),
        ("uq_slsq_order_active", "609dc5ab83cf5358114fd574f9a62448"),
        ("uq_speaking_lesson_set", "52787ee6a9e416cec50f85a8c05d9b59"),
    ):
        assert index_name in verify_sql
        assert definition_hash in verify_sql
    for index_name in (
        "uq_class_assignment_speaking_topic_per_cohort",
        "uq_speaking_lesson_set",
        "uq_slsq_order_active",
        "uq_quiz_bank_course_lesson",
    ):
        assert index_name in verify_sql
    assert "am.amname = 'btree'" in verify_sql
    assert "i.indnkeyatts = cardinality(expected_index.key_columns)" in verify_sql
    assert "i.indnatts = cardinality(expected_index.key_columns)" in verify_sql
    assert "IS NOT DISTINCT FROM expected_index.predicate" in verify_sql
    assert "policy-contract:reconciled-tables" in verify_sql
    assert "FROM pg_policies p" in verify_sql
    assert "policy_difference" in verify_sql
    assert "SELECT * FROM expected EXCEPT SELECT * FROM actual" in verify_sql
    assert "SELECT * FROM actual EXCEPT SELECT * FROM expected" in verify_sql
    assert "course_writing_submissions" in verify_sql
    assert "course_writing_drafts" in verify_sql
    for policy_name in (
        "courses_admin_all",
        "class_lessons_admin_all",
        "class_assignments_admin_all",
        "class_assignment_items_admin_all",
        "speaking_lesson_sets_admin_all",
        "slsq_admin_all",
        "spm_admin_all",
        "cal_admin_read",
        "cal_admin_append",
    ):
        assert policy_name in verify_sql
    assert "prod_gate_e_reconcile_postconditions_failed" in verify_sql


def test_both_progress_mark_writers_use_the_verified_response_conflict_key():
    grading_source = GRADING_PATH.read_text(encoding="utf-8")
    backfill_source = PROGRESS_BACKFILL_PATH.read_text(encoding="utf-8")

    assert '.upsert(mark, on_conflict="response_id")' in grading_source
    assert '.upsert(batch, on_conflict="response_id")' in backfill_source


def test_admin_course_writes_rely_on_the_verified_code_unique_key():
    source = ADMIN_COURSES_PATH.read_text(encoding="utf-8")

    assert 'supabase_admin.table("courses").insert({' in source
    assert '"code":        body.code' in source
    assert 'if "duplicate key" in str(exc).lower() or "unique"' in source
    assert "raise HTTPException(409" in source
