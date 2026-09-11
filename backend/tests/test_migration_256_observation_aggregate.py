"""Actual private aggregate RPC on isolated disposable LOCAL PostgreSQL."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
import asyncpg

from test_migration_240_core_attempt_evidence import DB, probe, psql, record
from services.core_attempt_aggregate import ObservationSnapshot, STREAMS

SQL = (Path(__file__).resolve().parents[1] / "migrations/256_core_attempt_observation_aggregate.sql").read_text()


def test_current_gate_f_migration_numbers_are_unique_and_old_draft_is_absent():
    directory = Path(__file__).resolve().parents[1] / 'migrations'
    files = [path.name for path in directory.glob('*.sql')
             if path.name.split('_')[0].isdigit() and int(path.name.split('_')[0]) >= 240]
    numbers = [name.split('_')[0] for name in files]
    assert len(numbers) == len(set(numbers)), files
    assert not (directory / '245_core_attempt_observation_aggregate.sql').exists()


@pytest.fixture(scope="module")
def schema(probe):
    migrated = SQL.replace("public.", f"{probe}.").replace("search_path = public,", f"search_path = {probe},")
    psql(migrated)
    psql(migrated)
    return probe


def now(): return datetime.now(timezone.utc)


def aggregate(schema, start, end=None):
    cutoff = "NULL" if end is None else f"'{end.isoformat()}'"
    raw = psql(f"BEGIN READ ONLY; SET LOCAL ROLE service_role; SELECT {schema}.fn_core_attempt_observation_aggregate"
               f"('{start.isoformat()}', {cutoff}); COMMIT;")
    result = json.loads(raw)
    ObservationSnapshot.model_validate(result)
    return result


def cell(result, surface="reading_exam", kind="default"):
    return next(row for row in result["rows"] if (row["surface"], row["attempt_kind"]) == (surface, kind))


def test_private_idempotent_read_only_and_empty_is_six_streams(schema):
    start = datetime(2001, 1, 1, tzinfo=timezone.utc)
    result = aggregate(schema, start, start + timedelta(days=1))
    assert len(result["rows"]) == 6
    for row in result["rows"]:
        assert all(value == 0 for key, value in row.items() if key not in {"surface", "attempt_kind"})
    for role in ("anon", "authenticated"):
        with pytest.raises(RuntimeError, match="permission denied"):
            psql(f"SET ROLE {role}; SELECT {schema}.fn_core_attempt_observation_aggregate(now()-interval '1 day',now())")
    assert "SECURITY INVOKER" in SQL and "SECURITY DEFINER" not in SQL
    for mutation in ("INSERT INTO", "UPDATE ", "DELETE FROM", "DROP TABLE", "CREATE TRIGGER"):
        assert mutation not in SQL


def test_retries_mixed_outcomes_and_old_new_operations_are_not_new_attempts(schema):
    start = now()
    attempt, old, new, retry, restart, failed_event = (uuid4() for _ in range(6))
    record(schema, attempt=attempt)
    failure = dict(attempt=attempt, operation_id=retry, event=failed_event, operation="submit",
                   kind="operation_failed", known=False, error="timeout")
    record(schema, **failure)
    record(schema, **failure)
    record(schema, attempt=attempt, operation_id=retry, operation="submit", kind="outcome_observed", known=False, outcome="success")
    record(schema, attempt=attempt, operation="grade", kind="outcome_observed", known=False, outcome="failed")
    record(schema, attempt=old, operation_id=restart, operation="start", kind="outcome_observed", known=False, outcome="abandoned")
    record(schema, attempt=new, operation_id=restart)
    row = cell(aggregate(schema, start))
    assert row["receipts"] == 6 and row["canonical_attempts"] == 3
    assert row["bound_attempt_operations"] == 5 and row["server_observation_operations"] == 4
    assert row["start_known_at_registration"] == 2 and row["start_unknown_at_registration"] == 1
    assert row["mixed_outcome_attempts"] == row["without_outcome_attempts"] == 1
    assert row["attempts_with_success"] == row["attempts_with_failed"] == row["attempts_with_abandoned"] == 1
    assert row["renderer_unknown_receipts"] == row["traffic_unknown_receipts"] == row["release_unknown_receipts"] == 6


def test_unbound_failed_admissions_do_not_inflate_canonical_attempts(schema):
    start, operation = now(), uuid4()
    for _ in range(2):
        record(schema, operation_id=operation, operation="start", kind="operation_failed", known=False, error="server_error")
    row = cell(aggregate(schema, start))
    assert row["receipts"] == 2 and row["unbound_start_failure_operations"] == 1
    assert row["server_observation_operations"] == 1
    assert row["canonical_attempts"] == row["bound_attempt_operations"] == row["attempts_with_failed"] == 0


def test_same_uuid_in_six_namespaces_is_not_merged(schema):
    start, attempt = now(), uuid4()
    for surface, kind in STREAMS:
        record(schema, attempt=attempt, surface=surface, attempt_kind=kind)
    result = aggregate(schema, start)
    assert all(row["canonical_attempts"] == row["receipts"] == 1 for row in result["rows"])
    assert str(attempt) not in json.dumps(result)


def test_server_aggregate_counts_more_than_1000_events_in_one_small_payload(schema):
    start, attempt = now(), uuid4()
    record(schema, attempt=attempt)
    psql(f"""SET ROLE service_role;
        INSERT INTO {schema}.core_attempt_evidence_events
            (id,attempt_id,surface,attempt_kind,operation_id,operation,event_kind,start_observed)
        SELECT gen_random_uuid(),a.id,a.surface,a.attempt_kind,gen_random_uuid(),'save','operation_succeeded',false
        FROM {schema}.core_attempt_evidence a CROSS JOIN generate_series(1,1100)
        WHERE a.canonical_attempt_id='{attempt}' AND a.surface='reading_exam';""")
    result = aggregate(schema, start)
    assert cell(result)["receipts"] == cell(result)["bound_attempt_operations"] == 1101
    assert cell(result)["canonical_attempts"] == 1 and len(json.dumps(result)) < 9000


def test_ingestion_interval_is_half_open_and_not_start_registration_window(schema):
    attempt = uuid4()
    record(schema, attempt=attempt)
    start = datetime(2002, 1, 1, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    for stamp in (start - timedelta(microseconds=1), start, end - timedelta(microseconds=1), end):
        psql(f"""SET ROLE service_role;
            INSERT INTO {schema}.core_attempt_evidence_events
                (id,attempt_id,surface,attempt_kind,operation_id,operation,event_kind,start_observed,created_at)
            SELECT gen_random_uuid(),a.id,a.surface,a.attempt_kind,gen_random_uuid(),'save','operation_succeeded',false,'{stamp.isoformat()}'
            FROM {schema}.core_attempt_evidence a WHERE a.canonical_attempt_id='{attempt}' AND a.surface='reading_exam';""")
    row = cell(aggregate(schema, start, end))
    assert row["receipts"] == 2 and row["canonical_attempts"] == row["start_known_at_registration"] == 1


@pytest.mark.parametrize("start,end", [
    ("NULL", "now()"), ("now()+interval '1 day'", "NULL"), ("now()", "now()"),
    ("now()", "now()-interval '1 day'"),
    ("now()-interval '32 days'", "now()"), ("now()", "now()+interval '1 day'"),
    ("'-infinity'::timestamptz", "now()"), ("now()", "'infinity'::timestamptz"),
])
def test_invalid_windows_are_rejected_in_database(schema, start, end):
    with pytest.raises(RuntimeError, match="invalid_observation_window"):
        psql(f"SET ROLE service_role; SELECT {schema}.fn_core_attempt_observation_aggregate({start},{end})")


def test_receipt_attributes_are_counted_without_claiming_attempt_attribution(schema):
    start, attempt = now(), uuid4()
    record(schema, attempt=attempt)
    for renderer, traffic, release in (("next", "organic", "'" + "a" * 40 + "'"), ("legacy", "synthetic", "NULL")):
        psql(f"""SET ROLE service_role;
            INSERT INTO {schema}.core_attempt_evidence_events
                (id,attempt_id,surface,attempt_kind,operation_id,operation,event_kind,start_observed,renderer,traffic_class,release_id)
            SELECT gen_random_uuid(),a.id,a.surface,a.attempt_kind,gen_random_uuid(),'save','operation_succeeded',false,'{renderer}','{traffic}',{release}
            FROM {schema}.core_attempt_evidence a WHERE a.canonical_attempt_id='{attempt}' AND a.surface='reading_exam';""")
    result = aggregate(schema, start)
    row = cell(result)
    assert row["receipts"] == 3 and row["canonical_attempts"] == 1
    assert row["renderer_next_receipts"] == row["renderer_legacy_receipts"] == row["renderer_unknown_receipts"] == 1
    assert row["organic_receipts"] == row["synthetic_receipts"] == row["traffic_unknown_receipts"] == 1
    assert row["release_known_receipts"] == 1 and row["release_unknown_receipts"] == 2
    assert "a" * 40 not in json.dumps(result)


def test_late_commit_can_enter_same_window_without_any_dirty_read(schema):
    attempt = uuid4()
    record(schema, attempt=attempt)
    start = now()
    async def check():
        conn = await asyncpg.connect(DB)
        transaction = conn.transaction()
        await transaction.start()
        try:
            await conn.execute(f"""INSERT INTO {schema}.core_attempt_evidence_events
                (id,attempt_id,surface,attempt_kind,operation_id,operation,event_kind,start_observed)
                SELECT gen_random_uuid(),a.id,a.surface,a.attempt_kind,gen_random_uuid(),'save','operation_succeeded',false
                FROM {schema}.core_attempt_evidence a WHERE a.canonical_attempt_id=$1 AND a.surface='reading_exam'""", attempt)
            end = now()
            assert cell(aggregate(schema, start, end))["receipts"] == 0
            await transaction.commit()
            assert cell(aggregate(schema, start, end))["receipts"] == 1
        finally:
            await conn.close()
    asyncio.run(check())


def test_default_cutoff_is_database_statement_time_and_exact_31_days_is_valid(schema):
    raw = psql(f"SET ROLE service_role; SELECT {schema}.fn_core_attempt_observation_aggregate("
               "statement_timestamp()-interval '744 hours',NULL)")
    result = ObservationSnapshot.model_validate(json.loads(raw))
    assert result.window_end - result.window_start == timedelta(days=31)
    assert result.window_end <= now()


@pytest.mark.parametrize("incomplete_tables", [False, True])
def test_missing_dependency_fails_during_migration_not_first_live_call(schema, incomplete_tables):
    name = "aggregate_dependency_" + uuid4().hex
    psql(f"CREATE SCHEMA {name}")
    try:
        if incomplete_tables:
            psql(f"CREATE TABLE {name}.core_attempt_evidence(id uuid)")
        migrated = SQL.replace("public.", f"{name}.").replace("search_path = public,", f"search_path = {name},")
        with pytest.raises(RuntimeError, match="core_aggregate_requires_migration_240"):
            psql(migrated)
        assert psql(f"SELECT count(*) FROM pg_proc WHERE pronamespace='{name}'::regnamespace") == "0"
    finally:
        psql(f"DROP SCHEMA {name} CASCADE")


@pytest.mark.parametrize("surface,kind,constraint", [
    ("future_surface", "default", "core_evidence_events_surface_check"),
    ("speaking", "future_kind", "core_evidence_events_attempt_kind_check"),
])
def test_future_namespace_drift_cannot_silently_disappear_from_six_stream_report(schema, surface, kind, constraint):
    # Temporary DDL and synthetic row are rolled back with the failed statement;
    # normal production constraints currently reject such a seventh stream.
    with pytest.raises(RuntimeError, match="unsupported_observation_stream"):
        psql(f"""BEGIN;
            ALTER TABLE {schema}.core_attempt_evidence_events DROP CONSTRAINT {constraint};
            INSERT INTO {schema}.core_attempt_evidence_events
                (id,surface,attempt_kind,operation_id,operation,event_kind,start_observed,error_code,created_at)
            VALUES (gen_random_uuid(),'{surface}','{kind}',gen_random_uuid(),'start','operation_failed',false,'unknown','2003-01-01');
            SET LOCAL ROLE service_role;
            SELECT {schema}.fn_core_attempt_observation_aggregate('2003-01-01','2003-01-02');
            ROLLBACK;""")
    assert psql(f"SELECT count(*) FROM {schema}.core_attempt_evidence_events WHERE surface='future_surface'") == "0"


def test_outcomes_before_receipt_window_are_not_lifetime_or_current_outcomes(schema):
    attempt = uuid4()
    record(schema, attempt=attempt)
    record(schema, attempt=attempt, kind="outcome_observed", operation="submit", known=False, outcome="success")
    start = now()
    record(schema, attempt=attempt, kind="operation_succeeded", operation="save", known=False)
    row = cell(aggregate(schema, start))
    assert row["receipts"] == row["canonical_attempts"] == row["without_outcome_attempts"] == 1
    assert row["attempts_with_success"] == 0


def test_query_ceiling_accepts_exact_limit_and_rejects_excess_without_partial_counts(schema):
    # Synthetic unbound receipts in an isolated historical window, all rolled
    # back. The subtransaction catches only the expected size rejection.
    result = psql(f"""BEGIN;
        SET LOCAL ROLE service_role;
        INSERT INTO {schema}.core_attempt_evidence_events
            (id,surface,attempt_kind,operation_id,operation,event_kind,start_observed,error_code,created_at)
        SELECT gen_random_uuid(),'reading_exam','default',gen_random_uuid(),'start','operation_failed',false,'unknown','2004-01-01'
        FROM generate_series(1,100000);
        DO $$ DECLARE report jsonb; receipt_count bigint; BEGIN
            report := {schema}.fn_core_attempt_observation_aggregate('2004-01-01','2004-01-02');
            SELECT sum((row->>'receipts')::bigint) INTO receipt_count FROM jsonb_array_elements(report->'rows') row;
            IF receipt_count <> 100000 THEN RAISE EXCEPTION 'truncated_count'; END IF;
            INSERT INTO {schema}.core_attempt_evidence_events
                (id,surface,attempt_kind,operation_id,operation,event_kind,start_observed,error_code,created_at)
            VALUES (gen_random_uuid(),'reading_exam','default',gen_random_uuid(),'start','operation_failed',false,'unknown','2004-01-01');
            BEGIN
                PERFORM {schema}.fn_core_attempt_observation_aggregate('2004-01-01','2004-01-02');
                RAISE EXCEPTION 'missing_size_guard';
            EXCEPTION WHEN SQLSTATE 'ZC001' THEN
                IF SQLERRM <> 'observation_window_too_large' THEN RAISE; END IF;
            END;
        END $$;
        ROLLBACK; SELECT 'verified';""")
    assert result == "verified"
    assert cell(aggregate(schema, datetime(2004, 1, 1, tzinfo=timezone.utc),
                          datetime(2004, 1, 2, tzinfo=timezone.utc)))["receipts"] == 0


def test_unbound_start_failure_then_bound_same_operation_keeps_both_facts(schema):
    start, operation, attempt = now(), uuid4(), uuid4()
    record(schema, operation_id=operation, kind="operation_failed", known=False, error="timeout")
    record(schema, operation_id=operation, attempt=attempt)
    row = cell(aggregate(schema, start))
    assert row["receipts"] == 2 and row["canonical_attempts"] == 1
    assert row["bound_attempt_operations"] == row["unbound_start_failure_operations"] == row["server_observation_operations"] == 1


def test_schema_guards_unbound_semantics_nullability_and_single_rpc_signature(schema):
    assert psql(f"SELECT count(*) FROM pg_proc WHERE pronamespace='{schema}'::regnamespace AND proname='fn_core_attempt_observation_aggregate'") == "1"
    assert psql(f"SELECT attnotnull FROM pg_attribute WHERE attrelid='{schema}.core_attempt_evidence'::regclass AND attname='start_observed'") == "t"
    with pytest.raises(RuntimeError, match="core_evidence_events_unbound_check"):
        record(schema, kind="operation_failed", operation="save", known=False, error="timeout")
