"""Migration 509: one course give per (class, give_request_id).

The static half always runs. The PostgreSQL half applies 509 to a minimal
`class_assignments` table and proves, with two real sessions, that two inserts
of the same course give that are both in flight create exactly one row (the
second waits for the first and then fails with 23505 naming the index), while a
deliberate re-give with a new id, an old give without an id, and other skills
stay allowed.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import DB, psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "509_course_give_request_unique.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
ROLLBACK = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")


def test_static_shape_and_ledgers():
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_course_give_request" in SQL
    assert "WHERE skill = 'course'" in SQL
    assert "content_config ? 'give_request_id'" in SQL
    assert "UPDATE " not in SQL.upper().replace("UPDATE_", "")
    assert "GRANT" not in SQL.upper() and "REVOKE" not in SQL.upper()
    assert "DROP INDEX IF EXISTS public.uq_course_give_request" in ROLLBACK
    register = (MIGRATIONS / "register.tsv").read_text(encoding="utf-8")
    assert f"509\t{NAME}\tpresent\t" in register
    policy = (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8")
    assert f"{NAME}\tpending_feature\tcourse_give_request\t" in policy
    router = (BACKEND / "routers" / "admin_class_assignments.py").read_text(encoding="utf-8")
    assert '"uq_course_give_request" in str(exc)' in router


def _require_pg():
    try:
        ok = bool(DB) and psql("SELECT 1") == "1"
    except Exception:
        ok = False
    if not ok:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 509 verification")
        pytest.skip("Local PostgreSQL unavailable")


@pytest.fixture
def schema():
    _require_pg()
    name = "m509_" + uuid4().hex
    psql(f"CREATE SCHEMA {name}")
    psql(f"""CREATE TABLE {name}.class_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cohort_id uuid NOT NULL, skill text NOT NULL, content_id uuid,
        content_config jsonb NOT NULL DEFAULT '{{}}'::jsonb)""")
    migrated = SQL.replace("public.", f"{name}.").replace(
        "'public'::regnamespace", f"'{name}'::regnamespace")
    psql(migrated)
    psql(migrated)  # idempotent re-apply
    yield name
    psql(f"DROP SCHEMA {name} CASCADE")


def _row(schema, cohort, skill="course", rid=None):
    cfg = "'{}'::jsonb" if rid is None else f"jsonb_build_object('give_request_id', '{rid}')"
    return (f"INSERT INTO {schema}.class_assignments (cohort_id, skill, content_id, content_config) "
            f"VALUES ('{cohort}', '{skill}', gen_random_uuid(), {cfg})")


def test_two_in_flight_gives_with_the_same_id_create_one_row(schema):
    asyncpg = pytest.importorskip("asyncpg")
    cohort, rid = uuid4(), uuid4()

    async def race():
        a = await asyncpg.connect(DB)
        b = await asyncpg.connect(DB)
        try:
            tx = a.transaction()
            await tx.start()
            await a.execute(_row(schema, cohort, rid=rid))
            # b blocks on the unique index until a decides.
            second = asyncio.ensure_future(b.execute(_row(schema, cohort, rid=rid)))
            await asyncio.sleep(0.5)
            assert not second.done()
            await tx.commit()
            with pytest.raises(asyncpg.UniqueViolationError) as caught:
                await second
            assert "uq_course_give_request" in str(caught.value)
        finally:
            await a.close()
            await b.close()

    asyncio.run(race())
    assert psql(f"SELECT count(*) FROM {schema}.class_assignments") == "1"


def test_new_id_old_rows_and_other_skills_are_still_allowed(schema):
    cohort, rid = uuid4(), uuid4()
    psql(_row(schema, cohort, rid=rid))
    psql(_row(schema, cohort, rid=uuid4()))          # deliberate re-give
    psql(_row(schema, cohort))                       # pre-509 give, no id
    psql(_row(schema, cohort))
    psql(_row(schema, uuid4(), rid=rid))             # same id, other class
    psql(_row(schema, cohort, skill="reading", rid=rid))
    assert psql(f"SELECT count(*) FROM {schema}.class_assignments") == "6"
    with pytest.raises(RuntimeError, match="uq_course_give_request"):
        psql(_row(schema, cohort, rid=rid))


def test_rollback_drops_only_the_index(schema):
    psql(ROLLBACK.replace("public.", f"{schema}."))
    assert psql(f"SELECT to_regclass('{schema}.uq_course_give_request') IS NULL") == "t"
