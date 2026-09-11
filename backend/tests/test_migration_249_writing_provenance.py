"""Prospective origin/first-activity proof on actual isolated LOCAL PostgreSQL."""
import json
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_248_writing_admission as execution_tests
from test_migration_240_core_attempt_evidence import probe, psql
from test_migration_248_writing_admission import schema as writing_schema, seed, prepare, execute, snapshot, phase

SQL = (Path(__file__).resolve().parents[1] / "migrations/249_writing_admission_provenance.sql").read_text()


@pytest.fixture(scope="module")
def schema(writing_schema):
    psql(f"ALTER TABLE {writing_schema}.writing_assignments ADD COLUMN essay_id uuid")
    sql = SQL.replace("public.", f"{writing_schema}.").replace("pg_catalog,public", f"pg_catalog,{writing_schema}")
    psql(sql)
    psql(sql)
    assert psql(f"SELECT count(*) FROM {writing_schema}.core_writing_capture_control") == "0"
    return writing_schema


@pytest.fixture(autouse=True)
def capture_on(schema):
    psql(f"INSERT INTO {schema}.core_writing_capture_control(enabled,manifest_digest) VALUES(true,'{'e'*64}') "
         "ON CONFLICT (singleton) DO UPDATE SET enabled=true,manifest_digest=excluded.manifest_digest")


def origin(schema, data):
    raw = psql(f"SELECT to_jsonb(o) FROM {schema}.core_writing_origins o WHERE assignment_id='{data['assignment']}'")
    return json.loads(raw) if raw else None


def test_capture_off_leaves_baseline_untracked_and_blocks_adoption(schema):
    psql(f"UPDATE {schema}.core_writing_capture_control SET enabled=false")
    data = seed(schema)
    assert snapshot(schema, data)["core_admission_tracked"] is False
    assert origin(schema, data) is None
    with pytest.raises(RuntimeError, match="writing_admission_baseline_conflict"):
        execute(schema, data)
    assert snapshot(schema, data)["started_at"] is None
    # Existing legacy start remains usable; no origin is created retrospectively.
    psql(f"UPDATE {schema}.writing_assignments SET started_at=clock_timestamp(),status='in_progress' WHERE id='{data['assignment']}'")
    assert origin(schema, data) is None


def test_prospective_origin_and_execution_commit_one_admitted_start(schema):
    data = seed(schema)
    initial = origin(schema, data)
    assert snapshot(schema, data)["core_admission_tracked"] is True
    assert initial["first_activity"] is None and initial["deleted_at"] is None
    first = execute(schema, data)
    admitted = origin(schema, data)
    assert admitted["first_activity"] == "admitted" and admitted["first_activity_at"] is not None
    assert execute(schema, data) == first and origin(schema, data) == admitted
    later = {**data, "command": prepare(schema, data)}
    assert execute(schema, later)["assignment"]["started_at"] == first["assignment"]["started_at"]
    assert origin(schema, data) == admitted


@pytest.mark.parametrize("activity", ["draft", "start", "essay"])
def test_deleted_draft_or_reset_status_never_looks_pristine_again(schema, activity):
    data = seed(schema)
    if activity == "draft":
        psql(f"INSERT INTO {schema}.writing_drafts(assignment_id,student_id,draft_text) VALUES "
             f"('{data['assignment']}','{data['student']}','old draft'); "
             f"DELETE FROM {schema}.writing_drafts WHERE assignment_id='{data['assignment']}'")
    elif activity == "start":
        psql(f"UPDATE {schema}.writing_assignments SET started_at=clock_timestamp(),status='in_progress' WHERE id='{data['assignment']}'; "
             f"UPDATE {schema}.writing_assignments SET started_at=NULL,status='pending' WHERE id='{data['assignment']}'")
    else:
        psql(f"UPDATE {schema}.writing_assignments SET essay_id='{uuid4()}' WHERE id='{data['assignment']}'; "
             f"UPDATE {schema}.writing_assignments SET essay_id=NULL WHERE id='{data['assignment']}'")
    assert snapshot(schema, data)["started_at"] is None
    assert snapshot(schema, data)["status"] == "pending"
    assert origin(schema, data)["first_activity"] == "unclaimed"
    with pytest.raises(RuntimeError, match="writing_admission_baseline_conflict"):
        execute(schema, data)
    assert phase(schema, data) == "accepted"


def test_draft_after_bound_start_keeps_origin_unchanged(schema):
    data = seed(schema)
    execute(schema, data)
    first = origin(schema, data)
    psql(f"INSERT INTO {schema}.writing_drafts(assignment_id,student_id,draft_text) VALUES "
         f"('{data['assignment']}','{data['student']}','my ongoing draft')")
    assert origin(schema, data) == first
    assert psql(f"SELECT draft_text FROM {schema}.writing_drafts WHERE assignment_id='{data['assignment']}'") == "my ongoing draft"


def test_invalid_epoch_prevents_unrecorded_creation_only_when_enabled(schema):
    psql(f"UPDATE {schema}.core_writing_capture_control SET manifest_digest='{'f'*64}'")
    with pytest.raises(RuntimeError, match="writing_origin_epoch_unavailable"):
        seed(schema)
    psql(f"UPDATE {schema}.core_writing_capture_control SET enabled=false")
    assert snapshot(schema, seed(schema))["core_admission_tracked"] is False


def test_origin_rolls_back_when_source_insert_rolls_back(schema):
    student, user, assignment = uuid4(), uuid4(), uuid4()
    psql(f"INSERT INTO {schema}.students VALUES('{student}','{user}')")
    with pytest.raises(RuntimeError, match="division by zero"):
        psql(f"BEGIN; INSERT INTO {schema}.writing_assignments(id,student_id) VALUES('{assignment}','{student}'); SELECT 1/0; COMMIT;")
    assert psql(f"SELECT count(*) FROM {schema}.core_writing_origins WHERE assignment_id='{assignment}'") == "0"
    assert psql(f"SELECT count(*) FROM {schema}.writing_assignments WHERE id='{assignment}'") == "0"


def test_source_delete_retains_tombstone_and_reuse_cannot_reset_history(schema):
    data = seed(schema)
    psql(f"DELETE FROM {schema}.writing_assignments WHERE id='{data['assignment']}'")
    assert origin(schema, data)["deleted_at"] is not None
    with pytest.raises(RuntimeError, match="duplicate key"):
        psql(f"INSERT INTO {schema}.writing_assignments(id,student_id) VALUES('{data['assignment']}','{data['student']}')")


def test_admin_reassignment_preserved_but_provenance_invalidated(schema):
    data = seed(schema)
    new_student, new_user = uuid4(), uuid4()
    psql(f"INSERT INTO {schema}.students VALUES('{new_student}','{new_user}'); "
         f"UPDATE {schema}.writing_assignments SET student_id='{new_student}' WHERE id='{data['assignment']}'")
    assert snapshot(schema, data)["student_id"] == str(new_student)
    assert origin(schema, data)["invalidated_at"] is not None
    # Even reassignment back does not repair provenance retrospectively.
    psql(f"UPDATE {schema}.writing_assignments SET student_id='{data['student']}' WHERE id='{data['assignment']}'")
    with pytest.raises(RuntimeError, match="writing_admission_baseline_conflict"):
        execute(schema, data)


def test_no_direct_role_access_or_unchecked_executor_bypass(schema):
    for role in ("anon", "authenticated", "service_role"):
        with pytest.raises(RuntimeError, match="permission denied"):
            psql(f"SET ROLE {role}; SELECT * FROM {schema}.core_writing_origins")
        assert psql(f"SELECT has_function_privilege('{role}','{schema}.fn_execute_writing_admission_v248(uuid,uuid,uuid,uuid,integer)','EXECUTE')") == "f"
    data = seed(schema)
    with pytest.raises(RuntimeError, match="writing_origin_client_claim"):
        psql(f"UPDATE {schema}.writing_assignments SET core_admission_tracked=false WHERE id='{data['assignment']}'")


def test_imported_linked_essay_is_never_pristine(schema):
    data = seed(schema)
    assignment = uuid4()
    psql(f"INSERT INTO {schema}.writing_assignments(id,student_id,essay_id) "
         f"VALUES('{assignment}','{data['student']}','{uuid4()}')")
    imported = {**data, "assignment": assignment}
    assert origin(schema, imported)["first_activity"] == "unclaimed"
    psql(f"UPDATE {schema}.writing_assignments SET essay_id=NULL WHERE id='{assignment}'")
    imported["command"] = prepare(schema, imported)
    with pytest.raises(RuntimeError, match="writing_admission_baseline_conflict"):
        execute(schema, imported)


def test_lost_binding_plus_reset_timer_cannot_create_second_start(schema):
    data = seed(schema)
    execute(schema, data)
    initial = origin(schema, data)
    # Simulate privileged drift, not a permitted application write.
    psql(f"DELETE FROM {schema}.core_admission_bindings WHERE canonical_id='{data['assignment']}'; "
         f"UPDATE {schema}.writing_assignments SET started_at=NULL,status='pending' WHERE id='{data['assignment']}'")
    later = {**data, "command": prepare(schema, data)}
    with pytest.raises(RuntimeError, match="writing_admission_binding_conflict"):
        execute(schema, later)
    assert origin(schema, data) == initial
    assert phase(schema, later) == "accepted"
    assert snapshot(schema, data)["started_at"] is None


@pytest.mark.parametrize("same_command", [True, False])
def test_provenance_wrapper_preserves_concurrent_executor_order(schema, same_command):
    execution_tests.test_overlapping_executors_preserve_single_start(schema, same_command)


def test_provenance_wrapper_preserves_draft_contention(schema):
    execution_tests.test_actual_draft_guard_serializes_prior_content_before_execution(schema)


def test_provenance_wrapper_preserves_command_fencing(schema):
    execution_tests.test_reconciler_fences_waiting_real_executor_before_timer_mutation(schema)


def test_provenance_rolls_back_with_failed_execution(schema):
    before = psql(f"SELECT count(*) FROM {schema}.core_writing_origins WHERE first_activity='admitted'")
    execution_tests.test_lease_rejection_and_bound_marker_failure_roll_back_all_writes(schema)
    # The helper retries successfully once after asserting source/binding rollback.
    assert int(psql(f"SELECT count(*) FROM {schema}.core_writing_origins WHERE first_activity='admitted'")) == int(before) + 1
