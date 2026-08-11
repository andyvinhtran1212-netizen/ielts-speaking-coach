"""Contracts for production schema reconciliation migration 204.

The production audit found a partially provisioned 173–203 range.  This guard
keeps the repair additive/idempotent and pins the four final contracts that must
exist before the historical ledger can be reconciled.  It also exercises the
dedicated deployment procedure so the normal forward runner never replays the
unledgered historical files before reaching 204.
"""

import importlib.util
from pathlib import Path

import pytest


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "204_reconcile_course_and_gate_e_schema.sql"
).read_text(encoding="utf-8")

BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = BACKEND_ROOT / "scripts" / "reconcile_prod_gate_e_migrations.py"
VERIFY_PATH = BACKEND_ROOT / "scripts" / "verify_prod_gate_e_reconcile.sql"

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
    assert "function-body:delete-course-evidence" in verify_sql
    assert "function-contract:fn_insert_listening_answer_once" in verify_sql
    assert "l.lanname = 'plpgsql'" in verify_sql
    assert "p.prorettype = 'boolean'::regtype" in verify_sql
    assert "p.prosecdef" in verify_sql
    assert "p.proconfig = ARRAY['search_path=public, pg_temp']::text[]" in verify_sql
    assert "md5(p.prosrc) = '856941cccd7f1e4a4df130f9286a189f'" in verify_sql
    assert "function-contract:fn_bind_session_to_class_item" in verify_sql
    assert "md5(p.prosrc) = '804aff9dc563a6d6361efd8d1a511f4c'" in verify_sql
    assert "function-contract:fn_class_action_log_append_only" in verify_sql
    assert "p.prorettype = 'trigger'::regtype" in verify_sql
    assert "md5(p.prosrc) = '3c0a0fbc7f3f6da45c1e47bda5d4e10d'" in verify_sql
    assert "column-contract:class_assignments.recipient_scope" in verify_sql
    assert "pg_get_expr(d.adbin, d.adrelid) = '''class''::text'" in verify_sql
    assert "constraint-contract:class_assignments.recipient_scope" in verify_sql
    assert "constraint-contract:listening_tests.test_type" in verify_sql
    assert "constraint-contract:class_assignment_items.assignment-student" in verify_sql
    assert "class_assignment_items_assignment_id_student_id_key" in verify_sql
    assert "idx.indisunique" in verify_sql
    assert "idx.indisvalid" in verify_sql
    assert "idx.indisready" in verify_sql
    assert "ARRAY['assignment_id', 'student_id']::name[]" in verify_sql
    assert "data:class_assignments.recipient_scope" in verify_sql
    assert "data:listening_tests.test_type" in verify_sql
    assert "data:class_assignment_items.assignment-student-duplicate" in verify_sql
    assert "service-only-acl:" in verify_sql
    assert "has_function_privilege('anon'" in verify_sql
    assert "has_function_privilege('authenticated'" in verify_sql
    assert "has_function_privilege('service_role'" in verify_sql
    for function_name in (
        "fn_insert_listening_answer_once",
        "fn_create_class_assignment",
        "fn_backfill_assignment_items",
        "fn_delete_class_assignment_if_unsubmitted",
        "fn_bind_session_to_class_item",
        "quiz_replace_questions",
    ):
        assert verify_sql.count(function_name) >= 2
    assert "service-only-table-acl:course_writing_drafts" in verify_sql
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
