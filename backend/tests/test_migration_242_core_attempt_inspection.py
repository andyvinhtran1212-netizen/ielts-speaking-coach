"""Actual read-only RPC on the same strictly local disposable PG as 240."""

import asyncio
import json
from pathlib import Path
from uuid import uuid4

import pytest
import asyncpg

from test_migration_240_core_attempt_evidence import DB, probe, psql, record
from services.core_attempt_inspection import HistorySummary

SQL = (Path(__file__).resolve().parents[1] / "migrations/242_core_attempt_evidence_inspection.sql").read_text()


@pytest.fixture(scope="module")
def report_schema(probe):
    psql(f"CREATE TABLE {probe}.writing_essays(id uuid); CREATE TABLE {probe}.writing_jobs(essay_id uuid, job_type text, status text)")
    psql(f"GRANT SELECT ON {probe}.writing_jobs TO service_role")
    migrated = SQL.replace("public.", f"{probe}.").replace("search_path = public,", f"search_path = {probe},")
    psql(migrated)
    psql(migrated)
    return probe


def inspect(schema, attempt, surface="reading_exam", kind="default"):
    result = psql(f"SET ROLE service_role; SELECT jsonb_build_object('history', {schema}.fn_inspect_core_attempt_evidence('{surface}','{kind}','{attempt}'))")
    history = json.loads(result)["history"]
    if history is not None:
        HistorySummary.model_validate(history)
    return history


def test_no_registry_is_null_and_browser_rpc_denied(report_schema):
    assert inspect(report_schema, uuid4()) is None
    for role in ("anon", "authenticated"):
        with pytest.raises(RuntimeError, match="permission denied"):
            psql(f"SET ROLE {role}; SELECT {report_schema}.fn_inspect_core_attempt_evidence('reading_exam','default','{uuid4()}')")
    assert "SECURITY INVOKER" in SQL and "SECURITY DEFINER" not in SQL
    assert "INSERT INTO" not in SQL and "UPDATE " not in SQL and "DELETE " not in SQL


def test_retry_history_is_receipts_not_attempt_outcome_or_logical_operations(report_schema):
    attempt, operation, event = uuid4(), uuid4(), uuid4()
    args = dict(attempt=attempt, operation_id=operation, event=event, operation="submit", kind="operation_failed", known=False, error="timeout")
    record(report_schema, **args)
    record(report_schema, **args)  # exact receipt replay
    record(report_schema, attempt=attempt)  # late start cannot upgrade registry
    record(report_schema, attempt=attempt, operation_id=operation, kind="outcome_observed", operation="submit", known=False, outcome="success")
    record(report_schema, attempt=attempt, kind="outcome_observed", operation="grade", known=False, outcome="failed")
    result = inspect(report_schema, attempt)
    assert result["receipts"] == 4 and result["started"] == 1 and result["start_observed"] is False
    assert result["operation_failed"] == result["success"] == result["failed"] == 1
    assert result["outcome_observed"] == 2
    assert result["traffic_unknown"] == result["renderer_unknown"] == result["release_unknown"] == 4
    assert "latest_outcome" not in result and "attempt_count" not in result


def test_namespaces_are_isolated_even_for_same_uuid(report_schema):
    attempt = uuid4()
    for surface, kind in [("reading_exam", "default"), ("speaking", "speaking_session"), ("speaking", "speaking_full_test")]:
        record(report_schema, attempt=attempt, surface=surface, attempt_kind=kind)
        assert inspect(report_schema, attempt, surface, kind)["receipts"] == 1
    assert inspect(report_schema, attempt, "listening_test") is None
    assert inspect(report_schema, attempt, "speaking", "default") is None


def test_sql_aggregation_is_not_postgrest_default_row_limit(report_schema):
    attempt = uuid4()
    record(report_schema, attempt=attempt)
    psql(f"""SET ROLE service_role;
        INSERT INTO {report_schema}.core_attempt_evidence_events
          (id,attempt_id,surface,attempt_kind,operation_id,operation,event_kind,start_observed)
        SELECT gen_random_uuid(), a.id, a.surface, a.attempt_kind, gen_random_uuid(), 'save', 'operation_succeeded', false
        FROM {report_schema}.core_attempt_evidence a CROSS JOIN generate_series(1,1100)
        WHERE a.canonical_attempt_id='{attempt}' AND a.surface='reading_exam';""")
    result = inspect(report_schema, attempt)
    assert result["receipts"] == 1101 and result["operation_succeeded"] == 1100
    assert len(json.dumps(result)) < 2000  # bounded response, no event/content dump


def test_unbound_start_failure_does_not_attach_to_some_attempt(report_schema):
    attempt = uuid4()
    record(report_schema, kind="operation_failed", known=False, error="rejected")
    assert inspect(report_schema, attempt) is None


def test_active_job_count_is_private_and_not_affected_by_old_job_volume(report_schema):
    essay, other = uuid4(), uuid4()
    psql(f"""INSERT INTO {report_schema}.writing_jobs
        SELECT '{essay}'::uuid,'analyze','completed' FROM generate_series(1,1100);
        INSERT INTO {report_schema}.writing_jobs VALUES
          ('{essay}','analyze','queued'), ('{essay}','analyze','running'),
          ('{essay}','regenerate_section','running'), ('{other}','analyze','queued');""")
    assert json.loads(psql(f"SET ROLE service_role; SELECT {report_schema}.core_evidence_job_summary(ROW('{essay}')::{report_schema}.writing_essays)")) == {"total": 1103, "active_analyze": 2}
    assert json.loads(psql(f"SET ROLE service_role; SELECT {report_schema}.core_evidence_job_summary(ROW('{uuid4()}')::{report_schema}.writing_essays)")) == {"total": 0, "active_analyze": 0}
    for role in ("anon", "authenticated"):
        with pytest.raises(RuntimeError, match="permission denied"):
            psql(f"SET ROLE {role}; SELECT {report_schema}.core_evidence_job_summary(ROW('{essay}')::{report_schema}.writing_essays)")


def test_inflight_receipt_is_not_partially_visible_or_a_safe_watermark(report_schema):
    attempt = uuid4()
    record(report_schema, attempt=attempt)
    async def run():
        writer, reader = await asyncpg.connect(DB), await asyncpg.connect(DB)
        try:
            await writer.execute("SET ROLE service_role")
            await reader.execute("SET ROLE service_role")
            transaction = writer.transaction()
            await transaction.start()
            await writer.execute(
                f"SELECT {report_schema}.fn_record_core_attempt_evidence($1,$2,'reading_exam',$3,false,'submit','outcome_observed','success',NULL,'unknown',NULL,NULL,'default')",
                uuid4(), uuid4(), attempt,
            )
            query = f"SELECT {report_schema}.fn_inspect_core_attempt_evidence('reading_exam','default',$1)"
            before = json.loads(await reader.fetchval(query, attempt))
            assert before["receipts"] == 1 and before["success"] == before["outcome_observed"] == 0
            await transaction.commit()
            after = json.loads(await reader.fetchval(query, attempt))
            assert after["receipts"] == 2 and after["success"] == after["outcome_observed"] == 1
            HistorySummary.model_validate(after)
        finally:
            await writer.close()
            await reader.close()
    asyncio.run(run())
