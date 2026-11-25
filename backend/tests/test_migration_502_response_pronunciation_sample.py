"""Migration 502 (COURSEACCESS-0055 T012 / G04-T13): responses pronunciation sample.

Runs the committed SQL on a LOCAL disposable PostgreSQL (TEST_PG_URL; with
REQUIRE_PG=1 a missing cluster is a failure, not a skip), transplanted from
``public`` into one random schema per test holding a minimal ``responses``
table. It checks what the migration promises: three nullable columns with
one CHECK (a segment has both ends and end > start; full / not_sampled carry
no seconds), old rows untouched, the file re-runs, and the rollback drops the
columns. Static checks pin the forward-policy group and the register row.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "502_response_pronunciation_sample.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
ROLLBACK_SQL = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
OLD = "00000000-0000-0000-0000-000000000502"


def _rows(file: str) -> list[list[str]]:
    return [line.split("\t") for line in (MIGRATIONS / file).read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#")]


def test_forward_policy_holds_502_until_an_explicit_feature_run():
    row = next(r for r in _rows("forward-policy.tsv") if r[0] == NAME)
    assert row[1:3] == ["pending_feature", "pron_sample"]


def test_register_marks_502_present_for_g04_t13():
    row = next(r for r in _rows("register.tsv") if r[0] == "502")
    assert row[1:5] == [NAME, "present", "G04-T13", "COURSEACCESS-0055"]


def test_migration_changes_no_privilege_and_no_existing_row():
    code = "\n".join(line for line in SQL.splitlines() if not line.lstrip().startswith("--"))
    for word in ("GRANT", "REVOKE", "UPDATE public", "DELETE", "POLICY", "DROP"):
        assert word not in code


def _available() -> bool:
    try:
        return bool(shutil.which("psql")) and psql("SELECT 1") == "1"
    except Exception:
        return False


@pytest.fixture
def schema():
    if not _available():
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 502 verification")
        pytest.skip("Local PostgreSQL unavailable")
    name = "pron_sample_" + uuid4().hex
    psql(f"CREATE SCHEMA {name}")
    psql(f"""
      CREATE TABLE {name}.responses (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id uuid, question_id uuid,
          pronunciation_score numeric, pronunciation_status text);
      INSERT INTO {name}.responses (id, pronunciation_score, pronunciation_status)
          VALUES ('{OLD}', 71.5, 'completed');
    """)
    try:
        yield name
    finally:
        # Only the unique schema this fixture created is removed.
        psql(f"DROP SCHEMA {name} CASCADE")


def _in(name: str, sql: str) -> str:
    return sql.replace("public.", f"{name}.").replace(
        "table_schema = 'public'", f"table_schema = '{name}'")


def _insert(name: str, scope: str, start: str, end: str) -> None:
    psql(f"INSERT INTO {name}.responses (pronunciation_sample_scope, pronunciation_sample_start_s,"
         f" pronunciation_sample_end_s) VALUES ({scope}, {start}, {end})")


def _fails(name: str, scope: str, start: str, end: str) -> str:
    with pytest.raises(RuntimeError) as caught:
        _insert(name, scope, start, end)
    return str(caught.value)


def test_columns_check_and_rerun(schema):
    psql(_in(schema, SQL))
    psql(_in(schema, SQL))  # applying twice is a no-op

    cols = psql(f"""SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY column_name)
                      FROM information_schema.columns
                     WHERE table_schema = '{schema}' AND table_name = 'responses'
                       AND column_name LIKE 'pronunciation_sample_%'""")
    assert cols == ("pronunciation_sample_end_s:numeric:YES,"
                    "pronunciation_sample_scope:text:YES,"
                    "pronunciation_sample_start_s:numeric:YES")
    assert psql(f"SELECT count(*) FROM pg_constraint WHERE conrelid = '{schema}.responses'::regclass"
                " AND conname = 'responses_pronunciation_sample_check' AND convalidated") == "1"
    # The old row keeps its score and has no sample.
    assert psql(f"SELECT pronunciation_score || '|' || coalesce(pronunciation_sample_scope, 'null')"
                f" FROM {schema}.responses WHERE id = '{OLD}'") == "71.5|null"

    _insert(schema, "'segment'", "41.0", "71.0")
    _insert(schema, "'full'", "NULL", "NULL")
    _insert(schema, "'not_sampled'", "NULL", "NULL")
    _insert(schema, "NULL", "NULL", "NULL")
    for bad in (("'segment'", "45", "45"), ("'segment'", "50", "40"), ("'segment'", "NULL", "40"),
                ("'segment'", "-1", "29"), ("'full'", "0", "30"), ("'not_sampled'", "NULL", "30"),
                ("'partial'", "NULL", "NULL"), ("NULL", "10", "40")):
        assert "responses_pronunciation_sample_check" in _fails(schema, *bad)


def test_rollback_drops_the_three_columns(schema):
    psql(_in(schema, SQL))
    _insert(schema, "'segment'", "10", "40")
    psql(_in(schema, ROLLBACK_SQL))
    assert psql(f"""SELECT count(*) FROM information_schema.columns
                     WHERE table_schema = '{schema}' AND table_name = 'responses'
                       AND column_name LIKE 'pronunciation_sample_%'""") == "0"
    assert psql(f"SELECT pronunciation_score FROM {schema}.responses WHERE id = '{OLD}'") == "71.5"
    psql(_in(schema, ROLLBACK_SQL))  # re-run is a no-op
