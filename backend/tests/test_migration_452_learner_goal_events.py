"""Migration 452 (ADMINIA-0074 G09-T04b): learner_goal_events + fn_learner_goal_resolve.

Runs the committed SQL on a LOCAL disposable PostgreSQL (TEST_PG_URL; with
REQUIRE_PG=1 a missing cluster is a failure, not a skip), transplanted from
``public`` into one random schema per test that also holds minimal
``students`` and ``users`` tables with the real goal column types (mig 005,
033). It checks what the migration promises: one call copies the chosen
source onto both rows and writes one event; it refuses when there is no
conflict, when the profile is not that account's, and for an unknown source,
leaving everything unchanged; the events cannot be changed or emptied; client
roles see nothing; the file re-runs; the rollback refuses once a goal was
resolved.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
SQL = (MIGRATIONS / "452_learner_goal_events.sql").read_text(encoding="utf-8")
ROLLBACK_SQL = (MIGRATIONS / "rollback" / "452_learner_goal_events.sql").read_text(encoding="utf-8")
ACTOR = "00000000-0000-0000-0000-0000000004b2"
STUDENT = "00000000-0000-0000-0000-00000000a001"
USER = "00000000-0000-0000-0000-00000000b001"
OTHER_USER = "00000000-0000-0000-0000-00000000b002"


def _available() -> bool:
    try:
        return bool(shutil.which("psql")) and psql("SELECT 1") == "1"
    except Exception:
        return False


@pytest.fixture
def schema():
    if not _available():
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 452 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 452 fixture requires a superuser on its disposable LOCAL cluster")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    name = "learner_goal_" + uuid4().hex
    psql(f"CREATE SCHEMA {name}")
    psql(f"GRANT USAGE ON SCHEMA {name} TO service_role, anon, authenticated")
    psql(f"""
      CREATE TABLE {name}.users (id uuid PRIMARY KEY, target_band DECIMAL(2,1), exam_date DATE);
      CREATE TABLE {name}.students (id uuid PRIMARY KEY, user_id uuid,
          target_band NUMERIC(2,1) CHECK (target_band IS NULL OR (target_band >= 0 AND target_band <= 9)),
          target_date DATE);
      GRANT SELECT, UPDATE ON {name}.users, {name}.students TO service_role;
      INSERT INTO {name}.users VALUES ('{USER}', 7.5, '2027-02-01'), ('{OTHER_USER}', NULL, NULL);
      INSERT INTO {name}.students VALUES ('{STUDENT}', '{USER}', 7.0, '2027-01-10');
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


def _resolve(name: str, use: str, *, user: str = USER) -> dict:
    out = psql(f"SET ROLE service_role; SELECT {name}.fn_learner_goal_resolve("
               f"'{STUDENT}'::uuid, '{user}'::uuid, '{use}', '{ACTOR}'::uuid)::text")
    return json.loads(out.splitlines()[-1])


def _goals(name: str) -> tuple[str, str]:
    return (psql(f"SELECT target_band || '|' || target_date FROM {name}.students WHERE id='{STUDENT}'"),
            psql(f"SELECT target_band || '|' || exam_date FROM {name}.users WHERE id='{USER}'"))


def _events(name: str) -> int:
    return int(psql(f"SELECT count(*) FROM {name}.learner_goal_events"))


def _fails(sql: str) -> str:
    with pytest.raises(RuntimeError) as caught:
        psql(sql)
    return str(caught.value)


def test_resolve_copies_one_source_to_both_rows_with_one_event(schema):
    _migrate(schema)
    assert _resolve(schema, "learner") == {"target_band": 7.5, "target_date": "2027-02-01"}
    assert _goals(schema) == ("7.5|2027-02-01", "7.5|2027-02-01")
    row = psql(f"SELECT used || '|' || before::text || '|' || after::text || '|' || actor_id "
               f"FROM {schema}.learner_goal_events").split("|")
    assert row[0] == "learner"
    assert json.loads(row[1]) == {"admin": {"target_band": 7.0, "target_date": "2027-01-10"},
                                  "learner": {"target_band": 7.5, "exam_date": "2027-02-01"}}
    assert json.loads(row[2]) == {"target_band": 7.5, "target_date": "2027-02-01"}
    assert row[3] == ACTOR
    # The sources now agree: a second resolve is refused and writes nothing.
    assert "no_conflict" in _fails(f"SET ROLE service_role; SELECT {schema}.fn_learner_goal_resolve("
                                   f"'{STUDENT}', '{USER}', 'admin', NULL)")
    assert _events(schema) == 1


def test_using_the_admin_goal_overwrites_the_learner_goal(schema):
    _migrate(schema)
    assert _resolve(schema, "admin") == {"target_band": 7.0, "target_date": "2027-01-10"}
    assert _goals(schema) == ("7.0|2027-01-10", "7.0|2027-01-10")


def test_refusals_change_nothing(schema):
    _migrate(schema)
    before = _goals(schema)
    call = f"SET ROLE service_role; SELECT {schema}.fn_learner_goal_resolve"
    assert "learner_goal_use_invalid" in _fails(f"{call}('{STUDENT}', '{USER}', 'both', NULL)")
    # A profile that is not this account's is not resolved against it.
    assert "learner_not_linked" in _fails(f"{call}('{STUDENT}', '{OTHER_USER}', 'admin', NULL)")
    # One side empty is not a conflict (the overview says the same), nor is a
    # field set on one side only.
    psql(f"UPDATE {schema}.users SET target_band=NULL, exam_date=NULL WHERE id='{USER}'")
    assert "no_conflict" in _fails(f"{call}('{STUDENT}', '{USER}', 'admin', NULL)")
    psql(f"UPDATE {schema}.users SET target_band=7.0, exam_date=NULL WHERE id='{USER}'")
    assert "no_conflict" in _fails(f"{call}('{STUDENT}', '{USER}', 'admin', NULL)")
    psql(f"UPDATE {schema}.users SET target_band=7.5, exam_date='2027-02-01' WHERE id='{USER}'")
    assert _goals(schema) == before and _events(schema) == 0


def test_a_field_the_chosen_source_leaves_empty_keeps_the_other_value(schema):
    _migrate(schema)
    psql(f"UPDATE {schema}.students SET target_date=NULL WHERE id='{STUDENT}'")   # admin: 7.0, no date
    assert _resolve(schema, "admin") == {"target_band": 7.0, "target_date": "2027-02-01"}
    assert _goals(schema) == ("7.0|2027-02-01", "7.0|2027-02-01")


def test_events_are_append_only(schema):
    _migrate(schema)
    _resolve(schema, "admin")
    for sql in (f"UPDATE {schema}.learner_goal_events SET used='learner'",
                f"DELETE FROM {schema}.learner_goal_events",
                f"TRUNCATE {schema}.learner_goal_events"):
        # Even the superuser is stopped by the triggers.
        assert "learner_goal_events chỉ THÊM" in _fails(sql), sql
        # service_role does not hold the privilege at all.
        assert "permission denied" in _fails(f"SET ROLE service_role; {sql}"), sql
    assert _events(schema) == 1


def test_client_roles_see_nothing_and_cannot_resolve(schema):
    _migrate(schema)
    for role in ("anon", "authenticated"):
        assert "permission denied" in _fails(f"SET ROLE {role}; SELECT * FROM {schema}.learner_goal_events")
        assert "permission denied" in _fails(
            f"SET ROLE {role}; SELECT {schema}.fn_learner_goal_resolve('{STUDENT}', '{USER}', 'admin', NULL)")
    assert psql(f"SELECT count(*) FROM pg_policy WHERE polrelid = '{schema}.learner_goal_events'::regclass") == "0"


def test_rerun_and_rollback(schema):
    _migrate(schema)
    _migrate(schema)  # additive: a second run does not fail
    psql(_in(schema, ROLLBACK_SQL))
    assert psql(f"SELECT to_regclass('{schema}.learner_goal_events') IS NULL") == "t"

    _migrate(schema)
    _resolve(schema, "learner")
    assert "keep schema 452 and roll forward" in _fails(_in(schema, ROLLBACK_SQL))
    assert _events(schema) == 1
