"""Run the actual migration in an isolated schema on a LOCAL disposable PG.

Set TEST_PG_URL to a local test cluster and REQUIRE_PG=1 to forbid skips.
Never accepts a remote database, including a production Supabase connection.
"""

import asyncio
import os
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import pytest
import asyncpg

SQL = (Path(__file__).resolve().parents[1] / "migrations/240_core_attempt_evidence.sql").read_text()
DB = os.environ.get("TEST_PG_URL", "")


def psql(sql):
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.query:
        raise RuntimeError("Migration tests require a local disposable database URL without query overrides")
    # Do not allow PGHOSTADDR/PGSERVICE/PGOPTIONS from the calling shell to
    # redirect the explicitly local fixture or change its execution context.
    environment = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    environment["PGCONNECT_TIMEOUT"] = "3"
    result = subprocess.run(["psql", DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
                            capture_output=True, text=True, timeout=30, env=environment)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


@pytest.fixture(scope="module")
def probe():
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 240 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 240 fixture requires a superuser on its disposable LOCAL cluster")
    name = "evidence_probe_" + uuid4().hex
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    psql(f"CREATE SCHEMA {name}")
    migrated = SQL.replace("public.", f"{name}.").replace("search_path = public,", f"search_path = {name},")
    try:
        # Minimal existing migration-220 dependency for the read-only computed
        # field. Product tables themselves are not created by migration 240.
        psql(f"CREATE TABLE {name}.dictation_attempts(id uuid, units_snapshot jsonb)")
        psql(migrated)
        psql(migrated)  # additive migration must be safely re-runnable
        psql(f"GRANT USAGE ON SCHEMA {name} TO service_role, anon, authenticated")
        yield name
    finally:
        # Only the exact unique schema created by this fixture is removed.
        psql(f"DROP SCHEMA {name} CASCADE")


def record(schema, *, attempt=None, event=None, operation_id=None, kind="started",
           operation="start", known=True, outcome=None, error=None, surface="reading_exam", attempt_kind=None):
    event = event or uuid4()
    operation_id = operation_id or uuid4()
    def literal(value):
        return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"
    args = [event, operation_id, surface, attempt, known, operation, kind,
            outcome, None, "unknown", None, error, attempt_kind or ("speaking_session" if surface == "speaking" else "default")]
    return psql(f"SET ROLE service_role; SELECT {schema}.fn_record_core_attempt_evidence(" +
                ",".join(str(x).lower() if type(x) is bool else literal(x) for x in args) + ")")


def test_additive_no_backfill_or_automatic_product_hooks():
    assert "CREATE TRIGGER" not in SQL
    assert "UPDATE public.sessions" not in SQL
    assert "DROP TABLE" not in SQL
    assert "SECURITY DEFINER" not in SQL


def test_empty_history_and_role_isolation(probe):
    assert psql(f"SELECT count(*) FROM {probe}.core_attempt_evidence") == "0"
    for role in ("anon", "authenticated"):
        with pytest.raises(RuntimeError, match="permission denied"):
            psql(f"SET ROLE {role}; SELECT * FROM {probe}.core_attempt_evidence_events")
        assert psql(f"SELECT has_function_privilege('{role}', '{probe}.fn_record_core_attempt_evidence(uuid,uuid,text,uuid,boolean,text,text,text,text,text,text,text,text)', 'EXECUTE')") == "f"


def test_dictation_count_computed_field_is_private_and_content_free(probe):
    for role in ("anon", "authenticated"):
        assert psql(f"SELECT has_function_privilege('{role}', '{probe}.core_evidence_unit_count({probe}.dictation_attempts)', 'EXECUTE')") == "f"
    assert psql(f"SELECT has_function_privilege('service_role', '{probe}.core_evidence_unit_count({probe}.dictation_attempts)', 'EXECUTE')") == "t"
    for snapshot, expected in [("[]", "0"), ('[{"text":"private"},{"text":"hidden"}]', "2"), ("{}", ""), ("null", "")]:
        assert psql(f"SET ROLE service_role; SELECT {probe}.core_evidence_unit_count(ROW(NULL,'{snapshot}'::jsonb)::{probe}.dictation_attempts)") == expected


def test_replay_and_concurrent_duplicate_are_one_receipt_and_attempt(probe):
    args = dict(attempt=uuid4(), event=uuid4(), operation_id=uuid4())
    async def overlap():
        first = await asyncpg.connect(DB)
        second = await asyncpg.connect(DB)
        task = None
        query = f"SELECT {probe}.fn_record_core_attempt_evidence($1,$2,'reading_exam',$3,true,'start','started',NULL,NULL,'unknown',NULL,NULL,'default')"
        params = (args["event"], args["operation_id"], args["attempt"])
        try:
            await first.execute("SET ROLE service_role")
            await second.execute("SET ROLE service_role")
            transaction = first.transaction()
            await transaction.start()
            receipt = await first.fetchval(query, *params)
            # Observe lock metadata as the local fixture owner, not the
            # service role (which correctly cannot inspect other sessions).
            await first.execute("RESET ROLE")
            task = asyncio.create_task(second.fetchval(query, *params))
            # Hold the first INSERT uncommitted until PG itself confirms the
            # competing RPC is blocked on its lock (not merely two threads).
            blocked = False
            for _ in range(100):
                await first.execute("SELECT pg_stat_clear_snapshot()")
                blocked = await first.fetchval(
                    "SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid=$1",
                    second.get_server_pid(),
                )
                if blocked:
                    break
                await asyncio.sleep(0.01)
            assert blocked, "second RPC did not overlap the uncommitted first receipt"
            await transaction.commit()
            return [str(receipt), str(await asyncio.wait_for(task, timeout=5))]
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await first.close()
            await second.close()
    receipts = asyncio.run(overlap())
    assert receipts == [str(args["event"])] * 2
    assert psql(f"SELECT count(*) FROM {probe}.core_attempt_evidence_events WHERE id='{args['event']}'") == "1"
    assert psql(f"SELECT count(*) FROM {probe}.core_attempt_evidence WHERE canonical_attempt_id='{args['attempt']}'") == "1"
    with pytest.raises(RuntimeError, match="evidence_event_conflict"):
        record(probe, **(args | {"operation_id": uuid4()}))


def test_conflicting_replay_rolls_back_new_attempt(probe):
    event, operation, first, other = (uuid4() for _ in range(4))
    record(probe, attempt=first, event=event, operation_id=operation)
    with pytest.raises(RuntimeError, match="evidence_event_conflict"):
        record(probe, attempt=other, event=event, operation_id=operation)
    assert psql(f"SELECT count(*) FROM {probe}.core_attempt_evidence WHERE canonical_attempt_id='{other}'") == "0"


def test_failed_submit_then_success_is_one_attempt_not_two(probe):
    attempt, operation = uuid4(), uuid4()
    record(probe, attempt=attempt)
    record(probe, attempt=attempt, operation_id=operation, kind="operation_failed",
           operation="submit", known=False, error="timeout")
    record(probe, attempt=attempt, operation_id=operation, kind="operation_succeeded",
           operation="submit", known=False)
    record(probe, attempt=attempt, operation_id=operation, kind="outcome_observed",
           operation="finalize", known=False, outcome="success")
    assert psql(f"SELECT count(*) FROM {probe}.core_attempt_evidence WHERE canonical_attempt_id='{attempt}'") == "1"
    assert psql(f"SELECT count(*) FROM {probe}.core_attempt_evidence_events e JOIN {probe}.core_attempt_evidence a ON a.id=e.attempt_id WHERE a.canonical_attempt_id='{attempt}' AND outcome='failed'") == "0"


def test_pre_insert_failure_not_added_to_attempt_denominator(probe):
    event = uuid4()
    record(probe, event=event, known=False, kind="operation_failed", error="server_error")
    assert psql(f"SELECT attempt_id IS NULL FROM {probe}.core_attempt_evidence_events WHERE id='{event}'") == "t"


def test_late_history_never_promoted_to_observed_start(probe):
    attempt = uuid4()
    record(probe, attempt=attempt, known=False, kind="outcome_observed", operation="finalize", outcome="unknown")
    record(probe, attempt=attempt)
    assert psql(f"SELECT start_observed FROM {probe}.core_attempt_evidence WHERE canonical_attempt_id='{attempt}'") == "f"


@pytest.mark.parametrize("surface", ["speaking", "reading_exam", "listening_test", "listening_dictation", "writing_assignment"])
def test_five_surfaces_share_receipt_contract(probe, surface):
    attempt = uuid4()
    record(probe, attempt=attempt, surface=surface)
    assert psql(f"SELECT surface FROM {probe}.core_attempt_evidence WHERE canonical_attempt_id='{attempt}'") == surface


def test_client_selected_session_uuid_cannot_merge_a_full_test(probe):
    shared_uuid = uuid4()
    record(probe, attempt=shared_uuid, surface="speaking", attempt_kind="speaking_session")
    record(probe, attempt=shared_uuid, surface="speaking", attempt_kind="speaking_full_test")
    assert psql(f"SELECT count(*) FROM {probe}.core_attempt_evidence WHERE surface='speaking' AND canonical_attempt_id='{shared_uuid}'") == "2"


def test_speaking_kind_is_required_even_for_unbound_failure(probe):
    with pytest.raises(RuntimeError, match="check constraint"):
        record(probe, surface="speaking", attempt_kind="default", known=False,
               kind="operation_failed", error="server_error")


def test_service_role_cannot_rewrite_or_delete_receipts(probe):
    for action in ("UPDATE", "DELETE"):
        assert psql(f"SELECT has_table_privilege('service_role', '{probe}.core_attempt_evidence_events', '{action}')") == "f"


def test_invalid_state_is_rejected_atomically(probe):
    attempt = uuid4()
    with pytest.raises(RuntimeError, match="check constraint"):
        record(probe, attempt=attempt, known=False, kind="operation_failed", operation="submit", error="timeout", outcome="failed")
    assert psql(f"SELECT count(*) FROM {probe}.core_attempt_evidence WHERE canonical_attempt_id='{attempt}'") == "0"


@pytest.mark.parametrize("known,kind", [(None, "started"), (False, "started"), (True, "operation_succeeded")])
def test_invalid_start_evidence_is_rejected(probe, known, kind):
    with pytest.raises(RuntimeError, match="invalid_start_evidence"):
        record(probe, attempt=uuid4(), known=known, kind=kind)


def test_surface_cannot_disagree_with_parent_even_on_direct_insert(probe):
    attempt = uuid4()
    record(probe, attempt=attempt)
    with pytest.raises(RuntimeError, match="foreign key constraint"):
        psql(f"""SET ROLE service_role;
            INSERT INTO {probe}.core_attempt_evidence_events
              (id, attempt_id, surface, operation_id, operation, event_kind, start_observed, attempt_kind)
            SELECT gen_random_uuid(), id, 'speaking', gen_random_uuid(), 'save', 'operation_succeeded', false, 'speaking_session'
            FROM {probe}.core_attempt_evidence WHERE canonical_attempt_id='{attempt}';""")


def test_rerun_rejects_missing_safety_constraint(probe):
    # Transaction rollback preserves the fixture after the intentionally failed
    # preflight. This proves IF NOT EXISTS cannot silently accept this drift.
    verification = SQL[SQL.index("DO $$"):SQL.index("CREATE INDEX IF NOT EXISTS")]
    verification = verification.replace("public.", f"{probe}.")
    with pytest.raises(RuntimeError, match="core_evidence_schema_incomplete"):
        psql(f"BEGIN; ALTER TABLE {probe}.core_attempt_evidence DROP CONSTRAINT core_evidence_surface_check; {verification} ROLLBACK;")


@pytest.mark.parametrize("mutation", [
    "core_attempt_evidence ALTER COLUMN start_observed DROP NOT NULL",
    "core_attempt_evidence_events ALTER COLUMN traffic_class DROP DEFAULT",
    "core_attempt_evidence_events ALTER COLUMN traffic_class SET DEFAULT 'organic'",
])
def test_rerun_rejects_column_drift_even_when_constraint_names_match(probe, mutation):
    verification = SQL[SQL.index("DO $$"):SQL.index("CREATE INDEX IF NOT EXISTS")]
    verification = verification.replace("public.", f"{probe}.")
    with pytest.raises(RuntimeError, match="core_evidence_column_drift"):
        psql(f"BEGIN; ALTER TABLE {probe}.{mutation}; {verification} ROLLBACK;")
