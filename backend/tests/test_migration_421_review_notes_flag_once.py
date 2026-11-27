"""Migration 421 (LEARNERCORE-0063 amendment 4, G07-T31): review_notes + flag once.

Runs the committed SQL on a LOCAL disposable PostgreSQL (TEST_PG_URL; with
REQUIRE_PG=1 a missing cluster is a failure, not a skip), transplanted from
``public`` into one random schema per test that holds minimal ``users`` and
``user_feedback`` tables (mig 100 shape). It checks what the migration and the
archive script promise: the file re-runs; a second flag on the same (attempt,
question, sender) is refused, signed-in and anonymous alike, while reports,
ratings and practice flags (attempt_id NULL) are untouched; duplicates already
inside the index scope stop the migration without deleting anything; the
archive script keeps the oldest row, copies the rest whole and then lets the
migration apply; review notes are one per question, 1–500 characters, hidden
from client roles; the rollback drops only the two indexes.
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
SQL = (MIGRATIONS / "421_review_notes_flag_once.sql").read_text(encoding="utf-8")
ROLLBACK_SQL = (MIGRATIONS / "rollback" / "421_review_notes_flag_once.sql").read_text(encoding="utf-8")
ARCHIVE_SQL = (ROOT / "scripts" / "archive_duplicate_feedback_flags.sql").read_text(encoding="utf-8")
USER = "00000000-0000-0000-0000-00000000c421"
ATTEMPT = "00000000-0000-0000-0000-00000000a421"
TEST = "00000000-0000-0000-0000-00000000e421"


def _available() -> bool:
    try:
        return bool(shutil.which("psql")) and psql("SELECT 1") == "1"
    except Exception:
        return False


@pytest.fixture
def schema():
    if not _available():
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 421 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 421 fixture requires a superuser on its disposable LOCAL cluster")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    name = "review_notes_" + uuid4().hex
    psql(f"CREATE SCHEMA {name}")
    psql(f"GRANT USAGE ON SCHEMA {name} TO service_role, anon, authenticated")
    psql(f"""
      CREATE TABLE {name}.users (id uuid PRIMARY KEY);
      CREATE TABLE {name}.user_feedback (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          type text NOT NULL CHECK (type IN ('rating', 'report', 'flag')),
          skill text NOT NULL CHECK (skill IN ('reading', 'listening')),
          attempt_id uuid, test_id text, q_num integer,
          rating_de smallint, rating_audio smallint, category text, note text,
          status text NOT NULL DEFAULT 'new',
          created_by uuid REFERENCES {name}.users(id) ON DELETE SET NULL,
          anon_id text,
          created_at timestamptz NOT NULL DEFAULT now(),
          resolved_at timestamptz, resolved_by uuid);
      INSERT INTO {name}.users VALUES ('{USER}');
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


def _flag(name: str, *, q: str = "3", user: str | None = USER, anon: str | None = None,
          attempt: str | None = ATTEMPT, kind: str = "flag", at: str = "now()") -> str:
    cb = f"'{user}'" if user else "NULL"
    an = f"'{anon}'" if anon else "NULL"
    at_id = f"'{attempt}'" if attempt else "NULL"
    return (f"INSERT INTO {name}.user_feedback (type, skill, attempt_id, q_num, created_by, anon_id, created_at) "
            f"VALUES ('{kind}', 'listening', {at_id}, {q}, {cb}, {an}, {at})")


def _count(name: str, where: str = "true") -> int:
    return int(psql(f"SELECT count(*) FROM {name}.user_feedback WHERE {where}"))


def test_migration_reruns_and_a_second_flag_on_the_same_question_is_refused(schema):
    _migrate(schema)
    _migrate(schema)
    psql(_flag(schema))
    assert "uq_feedback_flag_user" in _fails(_flag(schema))
    psql(_flag(schema, q="4"))                       # another question
    psql(_flag(schema, q="NULL"))                    # whole-test flag, once
    assert "uq_feedback_flag_user" in _fails(_flag(schema, q="NULL"))
    psql(_flag(schema, user=None, anon="anon-1"))
    assert "uq_feedback_flag_anon" in _fails(_flag(schema, user=None, anon="anon-1"))
    psql(_flag(schema, user=None, anon="anon-2"))    # another anonymous taker


def test_reports_ratings_and_practice_flags_stay_outside_the_indexes(schema):
    _migrate(schema)
    for _ in range(2):
        psql(_flag(schema, kind="report"))
        psql(_flag(schema, attempt=None))            # practice/exercise flag
    assert _count(schema) == 4


def test_preflight_stops_on_existing_duplicates_and_deletes_nothing(schema):
    psql(_flag(schema))
    psql(_flag(schema))
    message = _fails(_in(schema, SQL))
    assert "duplicate flag rows exist" in message
    assert _count(schema) == 2
    assert psql(f"SELECT to_regclass('{schema}.review_notes') IS NULL") == "t"
    assert psql(f"SELECT to_regclass('{schema}.uq_feedback_flag_user') IS NULL") == "t"


def test_preflight_ignores_duplicates_outside_the_index_scope(schema):
    for _ in range(2):
        psql(_flag(schema, attempt=None))
        psql(_flag(schema, kind="report"))
    _migrate(schema)
    assert _count(schema) == 4


def test_archive_script_keeps_the_oldest_row_then_the_migration_applies(schema):
    psql(_flag(schema, at="'2026-11-01T00:00:00Z'"))
    psql(_flag(schema, at="'2026-11-02T00:00:00Z'"))
    psql(_flag(schema, at="'2026-11-03T00:00:00Z'"))
    psql(_flag(schema, user=None, anon="anon-1", at="'2026-11-01T00:00:00Z'"))
    psql(_flag(schema, user=None, anon="anon-1", at="'2026-11-05T00:00:00Z'"))
    psql(_flag(schema, attempt=None))
    psql(_flag(schema, attempt=None))
    psql(_in(schema, ARCHIVE_SQL))
    assert psql(f"SELECT string_agg(created_at::date::text, ',' ORDER BY created_at) "
                f"FROM {schema}.user_feedback WHERE attempt_id IS NOT NULL") == "2026-11-01,2026-11-01"
    assert _count(schema, "attempt_id IS NULL") == 2
    assert psql(f"SELECT count(*) || '|' || count(DISTINCT archived_reason) "
                f"FROM {schema}.user_feedback_flag_archive") == "3|1"
    assert psql(f"SELECT bool_and(attempt_id = '{ATTEMPT}' AND type = 'flag' AND q_num = 3) "
                f"FROM {schema}.user_feedback_flag_archive") == "t"
    _migrate(schema)
    assert "uq_feedback_flag_user" in _fails(_flag(schema))


def test_review_notes_are_one_per_question_and_bounded(schema):
    _migrate(schema)
    insert = (f"INSERT INTO {schema}.review_notes (user_id, skill, test_uuid, q_num, body) "
              f"VALUES ('{USER}', 'listening', '{TEST}', 3, ")
    psql(insert + "'nghe lại đoạn 2')")
    assert "review_notes_one_per_question" in _fails(insert + "'again')")
    assert "check" in _fails(insert.replace(", 3, ", ", 4, ") + "'')").lower()
    assert "check" in _fails(insert.replace(", 3, ", ", 5, ") + "repeat('x', 501))").lower()
    psql(insert.replace(", 3, ", ", 6, ") + "repeat('ạ', 500))")
    assert "check" in _fails(insert.replace("'listening'", "'speaking'").replace(", 3, ", ", 7, ")
                             + "'x')").lower()
    psql(f"DELETE FROM {schema}.users WHERE id='{USER}'")
    assert psql(f"SELECT count(*) FROM {schema}.review_notes") == "0"


def test_review_notes_are_backend_only(schema):
    _migrate(schema)
    assert psql(f"SELECT relrowsecurity FROM pg_class WHERE oid='{schema}.review_notes'::regclass") == "t"
    for role in ("anon", "authenticated"):
        assert psql(f"SELECT has_table_privilege('{role}', '{schema}.review_notes', "
                    f"'SELECT,INSERT,UPDATE,DELETE')") == "f"
    assert psql(f"SELECT has_table_privilege('service_role', '{schema}.review_notes', "
                f"'SELECT,INSERT,UPDATE,DELETE')") == "t"
    assert psql(f"SELECT has_table_privilege('service_role', '{schema}.review_notes', 'TRUNCATE')") == "f"


def test_rollback_drops_only_the_two_indexes(schema):
    _migrate(schema)
    psql(f"INSERT INTO {schema}.review_notes (user_id, skill, test_uuid, q_num, body) "
         f"VALUES ('{USER}', 'reading', '{TEST}', 1, 'note')")
    psql(_in(schema, ROLLBACK_SQL))
    psql(_in(schema, ROLLBACK_SQL))
    assert psql(f"SELECT to_regclass('{schema}.uq_feedback_flag_user') IS NULL "
                f"AND to_regclass('{schema}.uq_feedback_flag_anon') IS NULL") == "t"
    assert psql(f"SELECT count(*) FROM {schema}.review_notes") == "1"
    psql(_flag(schema))
    psql(_flag(schema))


# ── static: the hosted apply needs anh Andy's typed approval ───────────────


def test_migration_421_is_held_out_of_the_normal_apply_run():
    policy = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
              if line.startswith("421_")]
    assert len(policy) == 1
    assert policy[0][:3] == ["421_review_notes_flag_once.sql", "pending_feature", "review_notes_flag_once"]
    assert "No apply on merge" in policy[0][3]
    readme = (MIGRATIONS / "README.md").read_text()
    assert "`421` is `pending_feature review_notes_flag_once`" in readme
    register = [line.split("\t") for line in (MIGRATIONS / "register.tsv").read_text().splitlines()
                if line.startswith("421\t")]
    assert len(register) == 1 and register[0][1] == "421_review_notes_flag_once.sql"


def test_migration_421_never_deletes_feedback_and_the_archive_is_not_a_migration():
    body = SQL.split("BEGIN;", 1)[1].upper()
    assert "DELETE FROM" not in body and "TRUNCATE" not in body
    assert "RAISE EXCEPTION" in body
    assert not list(MIGRATIONS.glob("*archive_duplicate_feedback_flags*"))
    assert "NOT a migration" in ARCHIVE_SQL
    assert "DROP TABLE" not in ROLLBACK_SQL.split("BEGIN;", 1)[1].upper()
