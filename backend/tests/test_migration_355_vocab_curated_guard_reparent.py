"""VOCABGUARD-0040 FR-001: replacement-only migration and real PG guards.

Reuse the curated vocabulary fixture, which accepts only loopback PostgreSQL.
REQUIRE_PG=1 forbids skips. Rollback SQL stays in the migration header, outside
the forward runner's executable statements, as for other guarded migrations.
"""

import asyncio
import json
import os
import re

import asyncpg
import pytest

from test_vocab_curated_postgres import MIGRATIONS, db as db


FILENAME = "355_vocab_curated_guard_reparent.sql"
SQL = (MIGRATIONS / FILENAME).read_text()
CASES = [
    ("vocab_unit_version_reviews", "published_vocab_review_is_immutable"),
    ("vocab_unit_tasks", "published_vocab_task_is_immutable"),
]
GUARDS = {"fn_guard_published_vocab_review", "fn_guard_published_vocab_task"}


def _executable(sql):
    return re.sub(r"^\s*--[^\n]*", "", sql, flags=re.M).strip()


def _down():
    note = SQL.split("-- BEGIN DOWN\n", 1)[1].split("-- END DOWN", 1)[0]
    assert all(line.startswith("--") for line in note.splitlines())
    return "\n".join(line.removeprefix("--").removeprefix(" ")
                     for line in note.splitlines())


def _apply(db, sql=SQL):
    db.query(sql.replace("public.", f"{db.schema}.").replace(
        "search_path = public,", f"search_path = {db.schema},"))


def _functions(db):
    return json.loads(db.query("""SELECT jsonb_object_agg(proname, pg_get_functiondef(oid))
        FROM pg_proc WHERE pronamespace = current_schema()::regnamespace
        AND proname IN ('fn_guard_published_vocab_review', 'fn_guard_published_vocab_task')"""))


def _catalog(db):
    # Exclude only the two bodies being replaced. OIDs, owners, ACLs, language,
    # search_path and security flags must survive both apply and double apply.
    return json.loads(db.query("""SELECT jsonb_build_object(
        'functions', (SELECT jsonb_agg(
            CASE WHEN proname IN ('fn_guard_published_vocab_review', 'fn_guard_published_vocab_task')
                 THEN to_jsonb(p) - 'prosrc' ELSE to_jsonb(p) END ORDER BY oid)
            FROM pg_proc p WHERE pronamespace = current_schema()::regnamespace),
        'triggers', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid)
            FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            WHERE c.relnamespace = current_schema()::regnamespace),
        'tables', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid)
            FROM pg_class c WHERE relnamespace = current_schema()::regnamespace),
        'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid)
            FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
            WHERE c.relnamespace = current_schema()::regnamespace))"""))


def _rows(db):
    tables = json.loads(db.query("""SELECT jsonb_agg(table_name ORDER BY table_name)
        FROM information_schema.tables WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'"""))
    return {table: db.rows(table) for table in tables}


def test_forward_sql_changes_only_two_functions_in_one_bounded_transaction():
    executable = _executable(SQL)
    definitions = re.findall(
        r"CREATE OR REPLACE FUNCTION (\w+)\(\)\s*RETURNS trigger.*?\n\$\$;",
        executable, re.S)
    assert set(definitions) == GUARDS and len(definitions) == 2
    remainder = re.sub(r"CREATE OR REPLACE FUNCTION .*?\n\$\$;", "", executable, flags=re.S)
    assert remainder.split() == ["BEGIN;", "SET", "LOCAL", "lock_timeout", "=", "'5s';", "COMMIT;"]
    assert not re.search(r"\b(INSERT|UPDATE|DELETE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\s+(?:INTO|FROM|TABLE|FUNCTION|TRIGGER|ON)\b",
                         executable, re.I)
    for name in GUARDS:
        body = executable.split(f"FUNCTION {name}()", 1)[1].split("\n$$;", 1)[0]
        assert "LANGUAGE plpgsql" in body
        assert "SET search_path = public, pg_temp" in body
        assert "ARRAY[OLD.version_id, NEW.version_id]" in body
        assert re.search(r"ORDER BY id\s+FOR SHARE", body)


def test_header_down_script_restores_exact_original_guard_bodies():
    down = _down()
    for filename, name in [
        ("234_vocab_curated_identity_and_editorial.sql", "review"),
        ("235_vocab_curated_tasks_attempts_mastery.sql", "task"),
    ]:
        original = re.search(r"CREATE OR REPLACE FUNCTION fn_guard_published_vocab_" + name
                             + r"\(\).*?\n\$\$;", (MIGRATIONS / filename).read_text(), re.S)
        assert original and original.group() in down
    assert down.startswith("BEGIN;\nSET LOCAL lock_timeout = '5s';")
    assert down.endswith("COMMIT;")


def test_migration_is_held_for_explicit_leader_apply_and_documented():
    entries = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
               if line.startswith(FILENAME + "\t")]
    assert len(entries) == 1
    assert entries[0][1:3] == ["pending_feature", "vocab_curated_guard_reparent"]
    assert "234/235" in entries[0][3]
    readme = (MIGRATIONS / "README.md").read_text()
    assert "Migration `355`" in readme
    assert "MIGRATION_FEATURES=vocab_curated_guard_reparent" in readme


def test_apply_twice_preserves_data_and_catalog_and_replaces_only_guard_bodies(db):
    unit, _, _ = db.published()
    draft = db.version(unit)["version"]
    db.approve(draft)
    _apply(db, _down())
    before_rows, before_catalog, before_functions = _rows(db), _catalog(db), _functions(db)
    _apply(db)
    after_functions = _functions(db)
    assert {name for name in GUARDS if before_functions[name] != after_functions[name]} == GUARDS
    assert _rows(db) == before_rows
    assert _catalog(db) == before_catalog
    _apply(db)
    assert _functions(db) == after_functions
    assert _rows(db) == before_rows
    assert _catalog(db) == before_catalog


@pytest.mark.parametrize("table,error", CASES)
def test_draft_child_cannot_be_moved_into_published_version(db, table, error):
    unit, published, _ = db.published()
    draft = db.version(unit)["version"]
    db.approve(draft)
    child = db.rows(table, f"version_id='{draft['id']}'")[0]
    before = db.rows(table)
    # Avoid sequence/reviewer uniqueness being mistaken for the guard error.
    extra = ", sequence=5" if table == "vocab_unit_tasks" else f", reviewer_id='{db.author}'"
    with pytest.raises(RuntimeError, match=error):
        db.query(f"SET ROLE service_role; UPDATE {table} SET version_id='{published['id']}'"
                 f"{extra} WHERE id='{child['id']}'")
    assert db.rows(table) == before


@pytest.mark.parametrize("table,error", CASES)
def test_draft_child_can_move_between_drafts_and_remain_editable(db, table, error):
    unit = db.unit()
    source = db.version(unit)["version"]
    target = db.version(unit, tasks=[])["version"]
    db.approve(source)
    child = db.rows(table, f"version_id='{source['id']}'")[0]
    field = "notes" if table == "vocab_unit_version_reviews" else "prompt"
    db.query(f"SET ROLE service_role; UPDATE {table} SET version_id='{target['id']}', "
             f"{field}='draft moved' WHERE id='{child['id']}'")
    moved = db.rows(table, f"id='{child['id']}'")[0]
    assert moved["version_id"] == target["id"] and moved[field] == "draft moved"
    db.query(f"SET ROLE service_role; DELETE FROM {table} WHERE id='{child['id']}'")
    assert db.rows(table, f"id='{child['id']}'") == []


@pytest.mark.parametrize("table,error", CASES)
def test_reparent_holds_share_locks_on_both_parents_until_transaction_end(db, table, error):
    unit = db.unit()
    source = db.version(unit)["version"]
    target = db.version(unit, tasks=[])["version"]
    db.approve(source)
    child = db.rows(table, f"version_id='{source['id']}'")[0]

    async def check_locks():
        # The fixture has already validated the loopback-only URL via psql.
        writer = await asyncpg.connect(os.environ["TEST_PG_URL"])
        observer = await asyncpg.connect(os.environ["TEST_PG_URL"])
        transaction = writer.transaction()
        try:
            await writer.execute(f"SET search_path={db.schema},pg_temp; SET ROLE service_role")
            await observer.execute(f"SET search_path={db.schema},pg_temp")
            await transaction.start()
            await writer.execute(f"UPDATE {table} SET version_id=$1 WHERE id=$2",
                                 target["id"], child["id"])
            for parent in (source, target):
                with pytest.raises(asyncpg.LockNotAvailableError):
                    await observer.fetchval("SELECT id FROM vocab_unit_versions WHERE id=$1 FOR UPDATE NOWAIT",
                                            parent["id"])
            await transaction.rollback()
            for parent in (source, target):
                assert str(await observer.fetchval(
                    "SELECT id FROM vocab_unit_versions WHERE id=$1 FOR UPDATE NOWAIT", parent["id"])) == parent["id"]
        finally:
            await writer.close()
            await observer.close()

    asyncio.run(check_locks())
    assert db.rows(table, f"id='{child['id']}'")[0] == child
