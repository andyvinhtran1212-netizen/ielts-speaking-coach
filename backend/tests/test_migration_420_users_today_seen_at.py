"""Migration 420 (LEARNERCORE-0063 FR-025/FR-078, G07-T13): Today seen cursor.

Runs the committed SQL on a LOCAL disposable PostgreSQL (TEST_PG_URL; with
REQUIRE_PG=1 a missing cluster is a failure, not a skip), transplanted from
``public`` into one random schema per test that holds a minimal ``users``
table with a learner self-update column grant (mig 320 shape). It checks what
the migration header promises: two nullable columns with no default and no
index; the file re-runs without touching existing values; client roles get no
write on the new columns (they are not in the mig 320 self-update list); the
rollback drops only those two columns, re-runs, and the migration applies
again afterwards with every user row intact.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"
SQL = (MIGRATIONS / "420_users_today_seen_at.sql").read_text(encoding="utf-8")
ROLLBACK_SQL = (MIGRATIONS / "rollback" / "420_users_today_seen_at.sql").read_text(encoding="utf-8")
USER = "00000000-0000-0000-0000-00000000c420"
OTHER = "00000000-0000-0000-0000-00000000d420"
NEW_COLUMNS = ("today_seen_at", "today_seen_key")


def _available() -> bool:
    try:
        return bool(shutil.which("psql")) and psql("SELECT 1") == "1"
    except Exception:
        return False


@pytest.fixture
def schema():
    if not _available():
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 420 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 420 fixture requires a superuser on its disposable LOCAL cluster")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    name = "today_seen_" + uuid4().hex
    psql(f"CREATE SCHEMA {name}")
    psql(f"GRANT USAGE ON SCHEMA {name} TO service_role, anon, authenticated")
    psql(f"""
      CREATE TABLE {name}.users (id uuid PRIMARY KEY, email text, display_name text);
      INSERT INTO {name}.users VALUES ('{USER}', 'a@example.test', 'A'), ('{OTHER}', NULL, NULL);
      GRANT SELECT, INSERT, UPDATE, DELETE ON {name}.users TO service_role;
      GRANT SELECT ON {name}.users TO authenticated;
      GRANT UPDATE (display_name) ON {name}.users TO authenticated;
    """)
    try:
        yield name
    finally:
        # Only the unique schema this fixture created is removed.
        psql(f"DROP SCHEMA {name} CASCADE")


def _in(name: str, sql: str) -> str:
    return sql.replace("public.", f"{name}.")


def _migrate(name: str) -> None:
    psql(_in(name, SQL))


def _columns(name: str) -> list[str]:
    out = psql(f"SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' "
               f"|| coalesce(column_default, '-'), ',' ORDER BY column_name) "
               f"FROM information_schema.columns WHERE table_schema='{name}' AND table_name='users'")
    return out.split(",")


def test_adds_two_nullable_columns_without_default_or_index(schema):
    _migrate(schema)
    assert _columns(schema) == [
        "display_name:text:YES:-",
        "email:text:YES:-",
        "id:uuid:NO:-",
        "today_seen_at:timestamp with time zone:YES:-",
        "today_seen_key:text:YES:-",
    ]
    assert psql(f"SELECT count(*) FROM pg_indexes WHERE schemaname='{schema}' AND tablename='users'") == "1"
    assert psql(f"SELECT count(*) FROM {schema}.users WHERE today_seen_at IS NULL "
                f"AND today_seen_key IS NULL") == "2"
    for column in NEW_COLUMNS:
        assert psql(f"SELECT col_description('{schema}.users'::regclass, attnum) LIKE '%mig 420%' "
                    f"FROM pg_attribute WHERE attrelid='{schema}.users'::regclass "
                    f"AND attname='{column}'") == "t"


def test_migration_reruns_and_keeps_the_cursor(schema):
    _migrate(schema)
    psql(f"UPDATE {schema}.users SET today_seen_at='2026-11-23T10:00:00Z', "
         f"today_seen_key='writing:00000000-0000-0000-0000-0000000000e1' WHERE id='{USER}'")
    _migrate(schema)
    _migrate(schema)
    assert psql(f"SELECT today_seen_key || '|' || (today_seen_at = '2026-11-23T10:00:00Z') "
                f"FROM {schema}.users WHERE id='{USER}'") == \
        "writing:00000000-0000-0000-0000-0000000000e1|true"
    assert psql(f"SELECT count(*) FROM {schema}.users") == "2"


def test_client_roles_cannot_write_the_cursor(schema):
    _migrate(schema)
    for column in NEW_COLUMNS:
        for role in ("anon", "authenticated"):
            assert psql(f"SELECT has_column_privilege('{role}', '{schema}.users', '{column}', "
                        f"'UPDATE')") == "f"
            assert psql(f"SELECT has_column_privilege('{role}', '{schema}.users', '{column}', "
                        f"'INSERT')") == "f"
        assert psql(f"SELECT has_column_privilege('service_role', '{schema}.users', '{column}', "
                    f"'UPDATE')") == "t"
    # The existing learner self-update grant is unchanged.
    assert psql(f"SELECT has_column_privilege('authenticated', '{schema}.users', 'display_name', "
                f"'UPDATE')") == "t"


def test_rollback_drops_only_the_two_columns_reruns_and_reapplies(schema):
    _migrate(schema)
    psql(f"UPDATE {schema}.users SET today_seen_at=now(), today_seen_key='speaking:x' WHERE id='{USER}'")
    psql(_in(schema, ROLLBACK_SQL))
    psql(_in(schema, ROLLBACK_SQL))
    assert _columns(schema) == ["display_name:text:YES:-", "email:text:YES:-", "id:uuid:NO:-"]
    assert psql(f"SELECT email FROM {schema}.users WHERE id='{USER}'") == "a@example.test"
    _migrate(schema)
    assert psql(f"SELECT count(*) FROM {schema}.users WHERE today_seen_key IS NULL") == "2"


# ── static: the hosted apply needs anh Andy's typed approval ───────────────


def test_migration_420_is_held_out_of_the_normal_apply_run():
    policy = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
              if line.startswith("420_")]
    assert len(policy) == 1
    assert policy[0][:3] == ["420_users_today_seen_at.sql", "pending_feature", "learner_today"]
    assert "No apply on merge" in policy[0][3]
    readme = (MIGRATIONS / "README.md").read_text()
    assert "`420` is `pending_feature learner_today`" in readme
    register = [line.split("\t") for line in (MIGRATIONS / "register.tsv").read_text().splitlines()
                if line.startswith("420\t")]
    assert len(register) == 1 and register[0][1] == "420_users_today_seen_at.sql"


def test_migration_420_only_adds_and_rollback_only_drops_its_columns():
    body = SQL.split("BEGIN;", 1)[1].upper()
    for forbidden in ("DROP ", "DELETE FROM", "TRUNCATE", "UPDATE ", "GRANT ", "CREATE INDEX"):
        assert forbidden not in body
    assert body.count("ADD COLUMN IF NOT EXISTS") == 2
    rollback = ROLLBACK_SQL.split("BEGIN;", 1)[1].upper()
    assert rollback.count("DROP COLUMN IF EXISTS") == 2
    assert "DROP TABLE" not in rollback
