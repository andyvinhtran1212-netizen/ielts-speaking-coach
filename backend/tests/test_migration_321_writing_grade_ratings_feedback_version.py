"""Migration 321 on LOCAL disposable PG: writing_grade_ratings converges to the
revised migration 116 shape (feedback_version NOT NULL +
UNIQUE(essay_id, feedback_version)) from either starting point.

Regression for the staging/production drift found 2026-10-26: both databases
were migrated with the early draft of 116 (commit df4fce621) — no
feedback_version column, UNIQUE(essay_id) — and 116's CREATE TABLE IF NOT
EXISTS can never repair that, so essay_service's rating read/upsert failed with
42703. The drifted fixture below is the production shape from the read-only
check, not the draft file.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""
import asyncio
import os
import re
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import asyncpg
import pytest

DB = os.environ.get("TEST_PG_URL", "")
MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
MIGRATION = (MIGRATIONS / "321_writing_grade_ratings_feedback_version.sql").read_text()
MIGRATION_116 = (MIGRATIONS / "116_writing_grade_ratings.sql").read_text()
COMPOSITE = "writing_grade_ratings_essay_id_feedback_version_key"


def _code(sql):
    return re.sub(r"--[^\n]*", "", sql)


# ── Static contract ─────────────────────────────────────────────────────────


def test_migration_is_one_transaction_with_a_postcondition():
    code = _code(MIGRATION)
    assert code.strip().startswith("BEGIN;") and code.strip().endswith("COMMIT;")
    for failure in ("feedback_version_missing", "feedback_version_nullable",
                    "single_essay_unique_survives", "essay_feedback_version_unique_missing"):
        assert f"writing_grade_ratings_{failure}" in code


def test_migration_adds_no_client_access_and_leaves_rls_alone():
    code = _code(MIGRATION).upper()
    for forbidden in ("GRANT ", "POLICY", "ROW LEVEL SECURITY", "DROP TABLE", "CREATE TABLE",
                      "DELETE FROM", "TRUNCATE"):
        assert forbidden not in code


def test_composite_constraint_name_matches_a_fresh_116():
    # The fresh-database name Postgres derives for 116's inline UNIQUE, so both
    # paths end with the same identity (asserted against a real 116 below).
    assert "UNIQUE (essay_id, feedback_version)" in MIGRATION_116
    assert f"ADD CONSTRAINT {COMPOSITE}" in _code(MIGRATION)


def test_service_keys_ratings_on_the_composite():
    service = (MIGRATIONS.parent / "services" / "essay_service.py").read_text()
    assert 'on_conflict="essay_id,feedback_version"' in service
    assert '.eq("feedback_version", feedback_version)' in service


# ── PostgreSQL ──────────────────────────────────────────────────────────────


async def _run(sql, *args):
    connection = await asyncpg.connect(DB)
    try:
        if not args and ";" in sql:
            await connection.execute(sql)
            return []
        return await connection.fetch(sql, *args)
    finally:
        await connection.close()


def query(sql, *args):
    return asyncio.run(_run(sql, *args))


def migrate(name):
    query(MIGRATION.replace("public.", name + "."))


@pytest.fixture
def schema():
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("321 requires an explicitly LOCAL disposable PostgreSQL URL")
        pytest.skip("Local PostgreSQL unavailable")
    name = "grade_ratings_" + uuid4().hex
    query(f"""
        CREATE SCHEMA {name};
        CREATE TABLE {name}.writing_essays(
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            current_version int NOT NULL DEFAULT 1);
    """)
    try:
        yield name
    finally:
        query(f"DROP SCHEMA IF EXISTS {name} CASCADE")


def drifted(name):
    """The draft-116 shape found on staging and production on 2026-10-26."""
    query(f"""
        CREATE TABLE {name}.writing_grade_ratings(
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            essay_id uuid NOT NULL REFERENCES {name}.writing_essays(id) ON DELETE CASCADE,
            grading_model text NOT NULL, analysis_level int, grading_tier text,
            rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
            note text NOT NULL DEFAULT '', rated_by uuid,
            rated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (essay_id));
        CREATE INDEX IF NOT EXISTS idx_writing_grade_ratings_model
            ON {name}.writing_grade_ratings (grading_model);
        ALTER TABLE {name}.writing_grade_ratings ENABLE ROW LEVEL SECURITY;
    """)


def essay(name, current_version=1):
    return query(f"INSERT INTO {name}.writing_essays(current_version) VALUES ($1) RETURNING id",
                 current_version)[0]["id"]


def shape(name):
    rel = f"{name}.writing_grade_ratings"
    column = query("""SELECT attnotnull, format_type(atttypid, atttypmod) type FROM pg_attribute
                       WHERE attrelid = $1::regclass AND attname = 'feedback_version'
                         AND NOT attisdropped""", rel)
    uniques = query("""SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint
                        WHERE conrelid = $1::regclass AND contype = 'u' ORDER BY conname""", rel)
    rls = query("SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass", rel)[0][0]
    return (column[0]["attnotnull"], column[0]["type"]) if column else None, \
        {row["conname"]: row["def"] for row in uniques}, rls


def upsert(name, essay_id, version, rating):
    return query(f"""INSERT INTO {name}.writing_grade_ratings(essay_id, feedback_version, grading_model, rating)
                     VALUES ($1, $2, 'claude-sonnet-5-5', $3)
                     ON CONFLICT (essay_id, feedback_version) DO UPDATE SET rating = EXCLUDED.rating
                     RETURNING feedback_version, rating""", essay_id, version, rating)


def test_drifted_table_converges_and_the_service_upsert_works(schema):
    drifted(schema)
    with pytest.raises(asyncpg.exceptions.UndefinedColumnError):
        upsert(schema, essay(schema), 1, 3)  # 42703, the staging failure

    migrate(schema)
    migrate(schema)  # forward re-application is a no-op

    column, uniques, rls = shape(schema)
    assert column == (True, "integer")
    assert uniques == {COMPOSITE: "UNIQUE (essay_id, feedback_version)"}
    assert rls is True

    graded = essay(schema)
    assert [tuple(r) for r in upsert(schema, graded, 1, 4)] == [(1, 4)]
    assert [tuple(r) for r in upsert(schema, graded, 1, 2)] == [(1, 2)]   # re-rate same run
    assert [tuple(r) for r in upsert(schema, graded, 2, 5)] == [(2, 5)]   # regraded run
    assert query(f"SELECT count(*) FROM {schema}.writing_grade_ratings WHERE essay_id = $1",
                 graded)[0][0] == 2


def test_legacy_rows_take_their_essays_current_version(schema):
    drifted(schema)
    first, regraded = essay(schema, 1), essay(schema, 3)
    query(f"""INSERT INTO {schema}.writing_grade_ratings(essay_id, grading_model, rating, note)
              VALUES ($1, 'gemini-2.5-pro', 4, 'kept'), ($2, 'gemini-2.5-pro', 2, '')""",
          first, regraded)

    migrate(schema)

    rows = query(f"SELECT essay_id, feedback_version, rating, note FROM {schema}.writing_grade_ratings")
    assert {r["essay_id"]: (r["feedback_version"], r["rating"], r["note"]) for r in rows} == {
        first: (1, 4, "kept"), regraded: (3, 2, "")}


def test_fresh_116_shape_is_left_unchanged(schema):
    query(f"SET search_path = {schema}; " + MIGRATION_116.replace("public.", schema + "."))
    before = shape(schema)
    assert before[1] == {COMPOSITE: "UNIQUE (essay_id, feedback_version)"}

    migrate(schema)

    assert shape(schema) == before


def test_differently_named_single_essay_unique_is_dropped(schema):
    drifted(schema)
    query(f"""ALTER TABLE {schema}.writing_grade_ratings
                  RENAME CONSTRAINT writing_grade_ratings_essay_id_key TO legacy_one_rating_per_essay""")

    migrate(schema)

    assert shape(schema)[1] == {COMPOSITE: "UNIQUE (essay_id, feedback_version)"}


def test_existing_equivalent_constraint_is_reused_not_duplicated(schema):
    drifted(schema)
    query(f"""ALTER TABLE {schema}.writing_grade_ratings ADD COLUMN feedback_version int NOT NULL DEFAULT 1;
              ALTER TABLE {schema}.writing_grade_ratings
                  ADD CONSTRAINT ratings_per_run UNIQUE (feedback_version, essay_id)""")

    migrate(schema)

    assert shape(schema)[1] == {"ratings_per_run": "UNIQUE (feedback_version, essay_id)"}


def test_postcondition_aborts_and_rolls_back_when_a_single_essay_unique_index_survives(schema):
    drifted(schema)
    query(f"CREATE UNIQUE INDEX legacy_essay_once ON {schema}.writing_grade_ratings (essay_id)")

    with pytest.raises(asyncpg.exceptions.RaiseError, match="single_essay_unique_survives"):
        migrate(schema)

    column, uniques, _ = shape(schema)
    assert column is None   # the whole transaction rolled back
    assert uniques == {"writing_grade_ratings_essay_id_key": "UNIQUE (essay_id)"}
