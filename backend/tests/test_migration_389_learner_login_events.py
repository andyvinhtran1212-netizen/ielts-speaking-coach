"""Migration 389 (COURSEACCESS-0055 T014 / G04-T16): learner_login_events.

Runs the committed SQL on a LOCAL disposable PostgreSQL (TEST_PG_URL; with
REQUIRE_PG=1 a missing cluster is a failure, not a skip), transplanted from
``public`` into one random schema per test: applies twice, RLS on with no
policy, client roles see nothing, service_role may SELECT/INSERT/DELETE but not
UPDATE, the three CHECKs, UNIQUE (user_id, session_id, outcome) with ON CONFLICT
DO NOTHING, the users FK cascade, no ip/addr/location/user_agent column, and a
rollback that drops the table.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
SQL = (MIGRATIONS / "389_learner_login_events.sql").read_text(encoding="utf-8")
ROLLBACK_SQL = (MIGRATIONS / "rollback" / "389_learner_login_events.sql").read_text(encoding="utf-8")
USER = "00000000-0000-0000-0000-000000000389"
SESSION = "00000000-0000-0000-0000-0000000000a1"


def _available() -> bool:
    try:
        return bool(shutil.which("psql")) and psql("SELECT 1") == "1"
    except Exception:
        return False


@pytest.fixture
def schema():
    if not _available():
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 389 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 389 fixture requires a superuser on its disposable LOCAL cluster")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    name = "login_events_" + uuid4().hex
    psql(f"CREATE SCHEMA {name}")
    psql(f"GRANT USAGE ON SCHEMA {name} TO service_role, anon, authenticated")
    psql(f"CREATE TABLE {name}.users (id uuid PRIMARY KEY); INSERT INTO {name}.users VALUES ('{USER}')")
    try:
        yield name
    finally:
        # Only the unique schema this fixture created is removed.
        psql(f"DROP SCHEMA {name} CASCADE")


def _in(name: str, sql: str) -> str:
    return sql.replace("public.", f"{name}.").replace("table_schema = 'public'", f"table_schema = '{name}'")


def _migrate(name: str) -> None:
    psql(_in(name, SQL))


def _fails(sql: str) -> str:
    with pytest.raises(RuntimeError) as caught:
        psql(sql)
    return str(caught.value)


def _insert_sql(name: str, outcome: str = "signed_in", kind: str = "desktop", method: str = "google",
                label: str = "'Chrome trên Windows'") -> str:
    return (f"INSERT INTO {name}.learner_login_events (user_id, session_id, device_kind, device_label, method, outcome) "
            f"VALUES ('{USER}', '{SESSION}', '{kind}', {label}, '{method}', '{outcome}') "
            "ON CONFLICT (user_id, session_id, outcome) DO NOTHING")


def test_reruns_rls_and_no_policy(schema):
    _migrate(schema)
    psql(_insert_sql(schema))
    _migrate(schema)
    assert psql(f"SELECT count(*) FROM {schema}.learner_login_events") == "1"
    assert psql(f"SELECT relrowsecurity FROM pg_class WHERE oid='{schema}.learner_login_events'::regclass") == "t"
    assert psql(f"SELECT count(*) FROM pg_policy WHERE polrelid='{schema}.learner_login_events'::regclass") == "0"


def test_client_roles_have_no_privilege(schema):
    _migrate(schema)
    for role in ("anon", "authenticated"):
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
            assert psql(f"SELECT has_table_privilege('{role}', '{schema}.learner_login_events', "
                        f"'{privilege}')") == "f", (role, privilege)
        assert "permission denied" in _fails(f"SET ROLE {role}; SELECT * FROM {schema}.learner_login_events")


def test_service_role_inserts_once_reads_deletes_never_updates(schema):
    _migrate(schema)
    psql(f"SET ROLE service_role; {_insert_sql(schema)}")
    psql(f"SET ROLE service_role; {_insert_sql(schema)}")  # same (session, outcome): no second row
    psql(f"SET ROLE service_role; {_insert_sql(schema, outcome='claimed')}")
    assert psql(f"SET ROLE service_role; SELECT count(*) FROM {schema}.learner_login_events") == "2"
    assert "permission denied" in _fails(
        f"SET ROLE service_role; UPDATE {schema}.learner_login_events SET outcome='pending'")
    assert "permission denied" in _fails(f"SET ROLE service_role; TRUNCATE {schema}.learner_login_events")
    psql(f"SET ROLE service_role; DELETE FROM {schema}.learner_login_events WHERE occurred_at < now() + interval '1 day'")
    assert psql(f"SELECT count(*) FROM {schema}.learner_login_events") == "0"


def test_checks(schema):
    _migrate(schema)
    plain = _insert_sql(schema).replace(" ON CONFLICT (user_id, session_id, outcome) DO NOTHING", "")
    assert "learner_login_events_device_kind_check" in _fails(plain.replace("'desktop'", "'watch'"))
    assert "learner_login_events_method_check" in _fails(plain.replace("'google'", "'facebook'"))
    assert "learner_login_events_outcome_check" in _fails(plain.replace("'signed_in'", "'hacked'"))
    assert "learner_login_events_device_label_check" in _fails(plain.replace("'Chrome trên Windows'", "repeat('x', 121)"))
    psql(plain)
    assert "learner_login_events_session_outcome_key" in _fails(plain)


def test_user_delete_cascades(schema):
    _migrate(schema)
    psql(_insert_sql(schema))
    psql(f"DELETE FROM {schema}.users WHERE id='{USER}'")
    assert psql(f"SELECT count(*) FROM {schema}.learner_login_events") == "0"


def test_no_address_location_or_user_agent_column(schema):
    _migrate(schema)
    columns = psql(f"SELECT string_agg(column_name, ',') FROM information_schema.columns "
                   f"WHERE table_schema='{schema}' AND table_name='learner_login_events'").split(",")
    assert sorted(columns) == sorted(["id", "user_id", "session_id", "occurred_at", "device_kind",
                                      "device_label", "method", "outcome"])
    for fragment in ("ip", "addr", "location", "user_agent"):
        assert not [c for c in columns if fragment in c], fragment


def test_rollback_drops_and_reapplies(schema):
    _migrate(schema)
    psql(_insert_sql(schema))
    psql(_in(schema, ROLLBACK_SQL))
    assert psql(f"SELECT to_regclass('{schema}.learner_login_events') IS NULL") == "t"
    psql(_in(schema, ROLLBACK_SQL))
    _migrate(schema)
    assert psql(f"SELECT count(*) FROM {schema}.learner_login_events") == "0"
