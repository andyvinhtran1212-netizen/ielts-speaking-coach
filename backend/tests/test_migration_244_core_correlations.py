"""Actual append-only RPC and snapshot aggregate on LOCAL disposable PostgreSQL."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import probe, psql, record
from test_migration_242_core_attempt_inspection import report_schema
from services.core_attempt_inspection import HistorySummary

SQL = (Path(__file__).resolve().parents[1] / "migrations/244_core_operation_correlations.sql").read_text()


@pytest.fixture(scope="module")
def schema(report_schema):
    migrated = SQL.replace("public.", f"{report_schema}.").replace("search_path = public,", f"search_path = {report_schema},")
    psql(migrated)
    psql(migrated)
    return report_schema


def correlate(schema, attempt, server_operation, hint, digest="a" * 64, *, surface="reading_exam", kind="default", operation="save"):
    return psql(f"SET ROLE service_role; SELECT {schema}.fn_record_core_operation_correlation('{server_operation}','{surface}','{kind}','{attempt}','{operation}','{hint}','{digest}')")


def report(schema, attempt, surface="reading_exam", kind="default"):
    raw = psql(f"SET ROLE service_role; SELECT jsonb_build_object('history',{schema}.fn_inspect_core_attempt_evidence_v2('{surface}','{kind}','{attempt}'))")
    value = json.loads(raw)["history"]
    if value is not None:
        HistorySummary.model_validate(value)
    return value


def test_distinct_retries_are_one_hint_input_group_not_one_attempt_per_event(schema):
    attempt, hint = uuid4(), uuid4()
    for error in ("timeout", None):
        server_operation = uuid4()
        record(schema, attempt=attempt, operation_id=server_operation, operation="save", known=False,
               kind="operation_failed" if error else "operation_succeeded", error=error)
        correlate(schema, attempt, server_operation, hint)
        correlate(schema, attempt, server_operation, hint)
    history = report(schema, attempt)
    assert history["operation_failed"] == history["operation_succeeded"] == 1
    assert history["operation_correlation"] == {"observed_operations": 2, "correlated_operations": 2,
        "uncorrelated_operations": 0, "client_input_groups": 1, "client_ids_with_multiple_fingerprints": 0}


def test_changed_inputs_and_unobserved_correlations_are_not_silently_merged(schema):
    attempt, hint = uuid4(), uuid4()
    for digest in ("a" * 64, "b" * 64):
        operation = uuid4()
        record(schema, attempt=attempt, operation_id=operation, operation="save", kind="operation_succeeded", known=False)
        correlate(schema, attempt, operation, hint, digest)
    correlate(schema, attempt, uuid4(), hint)  # missing event: not counted as observed operation
    record(schema, attempt=attempt, operation="save", kind="operation_succeeded", known=False)
    result = report(schema, attempt)["operation_correlation"]
    assert result == {"observed_operations": 3, "correlated_operations": 2,
        "uncorrelated_operations": 1, "client_input_groups": 2, "client_ids_with_multiple_fingerprints": 1}


def test_operation_and_outcome_receipts_share_one_observed_operation(schema):
    attempt, operation = uuid4(), uuid4()
    record(schema, attempt=attempt, operation_id=operation, operation="submit", kind="operation_succeeded", known=False)
    record(schema, attempt=attempt, operation_id=operation, operation="submit", kind="outcome_observed", outcome="success", known=False)
    correlate(schema, attempt, operation, uuid4(), operation="submit")
    history = report(schema, attempt)
    assert history["receipts"] == 2 and history["operation_correlation"]["observed_operations"] == 1


@pytest.mark.parametrize("new_created", [False, True])
@pytest.mark.parametrize("old_count", [1, 3])
@pytest.mark.parametrize("old_start_recorded", [False, True])
@pytest.mark.parametrize("surface", ["reading_exam", "listening_dictation"])
def test_start_over_abandonment_never_borrows_new_attempt_correlation(schema, new_created, old_count, old_start_recorded, surface):
    olds, new, operation = [uuid4() for _ in range(old_count)], uuid4(), uuid4()
    if old_start_recorded:
        for old in olds:
            record(schema, attempt=old, surface=surface)
    writes = [dict(attempt=old, operation_id=operation, operation="start", kind="outcome_observed",
                   known=False, outcome="abandoned") for old in olds]
    writes.append(dict(attempt=new if new_created else None, operation_id=operation, operation="start",
                       kind="started" if new_created else "operation_failed", known=new_created,
                       error=None if new_created else "server_error"))
    # Real concurrent RPCs share an operation UUID but not an event UUID or
    # canonical attempt. No operation-row uniqueness may discard these facts.
    ready = Barrier(len(writes))
    def write(fields):
        ready.wait(timeout=10)
        return record(schema, surface=surface, **fields)
    with ThreadPoolExecutor(max_workers=len(writes)) as pool:
        assert len(list(pool.map(write, writes))) == len(writes)
    if new_created:
        correlate(schema, new, operation, uuid4(), operation="start", surface=surface)
    for old in olds:
        old_history = report(schema, old, surface)
        assert old_history["abandoned"] == 1 and old_history["start_observed"] is old_start_recorded
        assert old_history["started"] == int(old_start_recorded)
        assert old_history["operation_failed"] == 0
        assert old_history["operation_correlation"]["uncorrelated_operations"] == 1 + int(old_start_recorded)
        assert old_history["operation_correlation"]["correlated_operations"] == 0
    new_history = report(schema, new, surface)
    if new_created:
        assert new_history["started"] == 1 and new_history["abandoned"] == 0
        assert new_history["operation_correlation"]["correlated_operations"] == 1
    else:
        assert new_history is None
        # Inspect the actual unbound operation, not only an unused fresh UUID.
        assert psql(f"SET ROLE service_role; SELECT count(*) FROM {schema}.core_attempt_evidence_events "
                    f"WHERE operation_id='{operation}' AND attempt_id IS NULL "
                    "AND event_kind='operation_failed' AND error_code='server_error'") == "1"
        assert psql(f"SET ROLE service_role; SELECT count(*) FROM {schema}.core_operation_correlations "
                    f"WHERE operation_id='{operation}'") == "0"
    assert psql(f"SET ROLE service_role; SELECT count(*) FROM {schema}.core_attempt_evidence_events "
                f"WHERE operation_id='{operation}'") == str(old_count + 1)


@pytest.mark.parametrize("override", [{"surface": "listening_test"}, {"operation": "submit"}, {"attempt": None}])
def test_scope_mismatch_cannot_correlate_someone_elses_event(schema, override):
    attempt, operation = uuid4(), uuid4()
    record(schema, attempt=attempt, operation_id=operation, operation="save", kind="operation_succeeded", known=False)
    values = {"surface": "reading_exam", "operation": "save", "attempt": attempt} | override
    correlate(schema, values["attempt"] or uuid4(), operation, uuid4(), surface=values["surface"], operation=values["operation"])
    assert report(schema, attempt)["operation_correlation"]["uncorrelated_operations"] == 1


def test_conflicting_replay_does_not_overwrite_scope_or_digest(schema):
    attempt, operation, hint = uuid4(), uuid4(), uuid4()
    correlate(schema, attempt, operation, hint)
    with pytest.raises(RuntimeError, match="core_operation_correlation_conflict"):
        correlate(schema, attempt, operation, hint, "b" * 64)
    assert psql(f"SELECT input_digest FROM {schema}.core_operation_correlations WHERE operation_id='{operation}'") == "a" * 64


def test_empty_registry_is_not_a_zero_error_certificate(schema):
    assert report(schema, uuid4()) is None


def test_roles_and_append_only_guards(schema):
    for role in ("anon", "authenticated"):
        with pytest.raises(RuntimeError, match="permission denied"):
            psql(f"SET ROLE {role}; SELECT * FROM {schema}.core_operation_correlations")
        for signature in ("fn_record_core_operation_correlation(uuid,text,text,uuid,text,uuid,text)",
                          "fn_core_operation_correlation_summary(uuid)", "fn_inspect_core_attempt_evidence_v2(text,text,uuid)"):
            assert psql(f"SELECT has_function_privilege('{role}','{schema}.{signature}','EXECUTE')") == "f"
    for privilege in ("UPDATE", "DELETE", "TRUNCATE"):
        assert psql(f"SELECT has_table_privilege('service_role','{schema}.core_operation_correlations','{privilege}')") == "f"
