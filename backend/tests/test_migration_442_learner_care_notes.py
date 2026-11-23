"""Migration 442 (ADMINIA-0074 G09-T35): learner_care_notes.

Runs the committed SQL on a LOCAL disposable PostgreSQL (TEST_PG_URL; with
REQUIRE_PG=1 a missing cluster is a failure, not a skip), transplanted from
``public`` into one random schema per test that also holds minimal
``students`` and ``users`` tables. It checks what the migration promises: a
note needs a learner and a non-empty body; done needs both its time and its
staff id; service_role can add, read and change a note but never delete one;
client roles see nothing; a note goes with its learner; the file re-runs;
the rollback refuses once a note exists.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
SQL = (MIGRATIONS / "442_learner_care_notes.sql").read_text(encoding="utf-8")
ROLLBACK_SQL = (MIGRATIONS / "rollback" / "442_learner_care_notes.sql").read_text(encoding="utf-8")
AUTHOR = "00000000-0000-0000-0000-000000000442"
STUDENT = "00000000-0000-0000-0000-00000000a001"
USER = "00000000-0000-0000-0000-00000000b001"


def _available() -> bool:
    try:
        return bool(shutil.which("psql")) and psql("SELECT 1") == "1"
    except Exception:
        return False


@pytest.fixture
def schema():
    if not _available():
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 442 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 442 fixture requires a superuser on its disposable LOCAL cluster")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    name = "learner_care_" + uuid4().hex
    psql(f"CREATE SCHEMA {name}")
    psql(f"GRANT USAGE ON SCHEMA {name} TO service_role, anon, authenticated")
    psql(f"""
      CREATE TABLE {name}.users (id uuid PRIMARY KEY);
      CREATE TABLE {name}.students (id uuid PRIMARY KEY, user_id uuid, persona_notes text);
      INSERT INTO {name}.users VALUES ('{USER}');
      INSERT INTO {name}.students VALUES ('{STUDENT}', '{USER}', NULL);
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


def _fails(sql: str) -> str:
    with pytest.raises(RuntimeError) as caught:
        psql(sql)
    return str(caught.value)


def _add(name: str, *, student: str | None = STUDENT, user: str | None = USER, body: str = "Gọi lại",
         role: str = "service_role") -> str:
    s = f"'{student}'" if student else "NULL"
    u = f"'{user}'" if user else "NULL"
    out = psql(f"SET ROLE {role}; INSERT INTO {name}.learner_care_notes (student_id, user_id, author_id, body) "
               f"VALUES ({s}, {u}, '{AUTHOR}', '{body}') RETURNING id")
    return out.splitlines()[-1]


def _count(name: str) -> int:
    return int(psql(f"SELECT count(*) FROM {name}.learner_care_notes"))


def test_service_role_adds_reads_and_changes_a_note(schema):
    _migrate(schema)
    nid = _add(schema)
    row = psql(f"SET ROLE service_role; SELECT source || '|' || is_initial || '|' || (done_at IS NULL) "
               f"FROM {schema}.learner_care_notes WHERE id='{nid}'").splitlines()[-1]
    assert row == "manual|false|true"
    psql(f"SET ROLE service_role; UPDATE {schema}.learner_care_notes SET done_at=now(), done_by='{AUTHOR}', "
         f"due_on='2026-11-23', next_action='Nhắc lịch' WHERE id='{nid}'")
    psql(f"SET ROLE service_role; UPDATE {schema}.learner_care_notes SET deleted_at=now() WHERE id='{nid}'")
    assert _count(schema) == 1   # removal is soft


def test_a_note_needs_a_learner_a_body_and_a_known_source(schema):
    _migrate(schema)
    assert "learner_care_notes_has_owner" in _fails(
        f"INSERT INTO {schema}.learner_care_notes (author_id, body) VALUES ('{AUTHOR}', 'x')")
    for body in ("", "   ", "x" * 4001):
        assert "learner_care_notes_body_check" in _fails(
            f"INSERT INTO {schema}.learner_care_notes (user_id, author_id, body) VALUES ('{USER}', '{AUTHOR}', '{body}')")
    assert "next_action_check" in _fails(
        f"INSERT INTO {schema}.learner_care_notes (user_id, author_id, body, next_action) "
        f"VALUES ('{USER}', '{AUTHOR}', 'x', ' ')")
    assert "source_check" in _fails(
        f"INSERT INTO {schema}.learner_care_notes (user_id, author_id, body, source) "
        f"VALUES ('{USER}', '{AUTHOR}', 'x', 'import')")
    psql(f"INSERT INTO {schema}.learner_care_notes (user_id, author_id, body, source) "
         f"VALUES ('{USER}', '{AUTHOR}', 'Khảo sát sau khoá', 'survey')")
    # A profile-only learner (no account yet) and an account-only one both work.
    _add(schema, user=None)
    _add(schema, student=None)
    # Done is the time AND who marked it, never one of the two.
    nid = _add(schema)
    assert "learner_care_notes_done_pair" in _fails(
        f"UPDATE {schema}.learner_care_notes SET done_at=now() WHERE id='{nid}'")
    assert _count(schema) == 4


def test_service_role_cannot_delete_and_clients_see_nothing(schema):
    _migrate(schema)
    _add(schema)
    for sql in (f"DELETE FROM {schema}.learner_care_notes", f"TRUNCATE {schema}.learner_care_notes"):
        assert "permission denied" in _fails(f"SET ROLE service_role; {sql}"), sql
    for role in ("anon", "authenticated"):
        assert "permission denied" in _fails(f"SET ROLE {role}; SELECT * FROM {schema}.learner_care_notes")
        assert "permission denied" in _fails(
            f"SET ROLE {role}; INSERT INTO {schema}.learner_care_notes (user_id, author_id, body) "
            f"VALUES ('{USER}', '{AUTHOR}', 'x')")
        assert "permission denied" in _fails(f"SET ROLE {role}; UPDATE {schema}.learner_care_notes SET body='x'")
    assert psql(f"SELECT relrowsecurity FROM pg_class WHERE oid = '{schema}.learner_care_notes'::regclass") == "t"
    assert psql(f"SELECT count(*) FROM pg_policy WHERE polrelid = '{schema}.learner_care_notes'::regclass") == "0"
    assert _count(schema) == 1


def test_a_note_goes_with_its_learner(schema):
    _migrate(schema)
    _add(schema, user=None)
    _add(schema, student=None)
    psql(f"DELETE FROM {schema}.students WHERE id='{STUDENT}'")
    assert _count(schema) == 1
    psql(f"DELETE FROM {schema}.users WHERE id='{USER}'")
    assert _count(schema) == 0


def test_rerun_and_rollback(schema):
    _migrate(schema)
    _migrate(schema)  # additive: a second run does not fail
    psql(_in(schema, ROLLBACK_SQL))
    assert psql(f"SELECT to_regclass('{schema}.learner_care_notes') IS NULL") == "t"

    _migrate(schema)
    nid = _add(schema)
    psql(f"UPDATE {schema}.learner_care_notes SET deleted_at=now() WHERE id='{nid}'")
    # Even a removed note is a record about a learner: no rollback.
    assert "keep schema 442 and roll forward" in _fails(_in(schema, ROLLBACK_SQL))
    assert _count(schema) == 1
