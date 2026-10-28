"""Migration 338 (PAPERUPDATEDAT-0037): every UPDATE of a Reading/Listening
paper row advances updated_at, without changing the 306 mock paper guards.

On production AVR-READ-002 was hidden through the admin visibility toggle on
2026-10-28 (release event 741f775e, policy_revision 0 -> 1) while updated_at
stayed at 2026-05-30: reading_tests/listening_tests only had DEFAULT now().
338 adds update_<table>_updated_at BEFORE UPDATE row triggers on the five paper
tables that have updated_at and no trigger yet.

The static half always runs. The PostgreSQL half applies 338 twice on top of
the real 306/315/316 fixture (test_mock_private_draft_postgres) and proves that
visibility RPCs, raw updates, explicit stale values, child edits and the Mock
Test copy all advance updated_at, while policy_revision, release events,
mock_content_revision and guard refusals behave exactly as before. A minimal
schema covers the precondition and postcondition failures.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID, uuid4

import asyncpg
import pytest

from test_mock_paper_policy_postgres import DB, query
from test_mock_private_draft_postgres import create, private_probe, source_bundle  # noqa: F401 (fixture)

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "338_reading_listening_paper_updated_at.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = "\n".join(line for line in SQL.splitlines() if not line.lstrip().startswith("--"))
TABLES = ("reading_tests", "listening_tests", "reading_passages", "reading_questions", "listening_content")
OLD = datetime(2026, 5, 30, 5, 16, 57, tzinfo=timezone.utc)


def migrated(schema: str) -> str:
    return SQL.replace("public.", schema + ".")


def triggers(schema: str, table: str) -> list[str]:
    return [r["tgname"] for r in query(
        "SELECT t.tgname FROM pg_trigger t WHERE t.tgrelid=to_regclass($1) AND NOT t.tgisinternal ORDER BY 1",
        f"{schema}.{table}")]


def now():
    return query("SELECT now() AS t")[0]["t"]


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_data_change():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    for forbidden in (r"\bDELETE\s+FROM", r"\bTRUNCATE\b", r"^\s*UPDATE\s", r"\bINSERT\s+INTO",
                      r"\bALTER\s+(TABLE|FUNCTION)\b", r"\bDROP\s+TRIGGER\b", r"\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b",
                      r"\bDISABLE\s+TRIGGER\b", r"\bGRANT\b", r"\bREVOKE\b"):
        assert not re.search(forbidden, CODE, re.M | re.I), forbidden


def test_covers_exactly_the_five_paper_tables_with_the_shared_function():
    arrays = re.findall(r"paper_tables TEXT\[\] := ARRAY\[(.*?)\];", CODE, re.S)
    assert len(arrays) == 1
    assert tuple(re.findall(r"'([a-z_]+)'", arrays[0])) == TABLES
    assert ("EXECUTE format('CREATE OR REPLACE TRIGGER %I BEFORE UPDATE ON public.%I '\n"
            "                       'FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',\n"
            "                       'update_' || name || '_updated_at', name);") in CODE
    # listening_exercises keeps 208's own trigger; 338 only requires it.
    assert "listening_exercises" not in arrays[0]
    assert "trg_listening_exercises_updated_at" in CODE


def test_shared_function_still_sets_now_and_is_pinned():
    body = (MIGRATIONS / "033_writing_coach_tables.sql").read_text(encoding="utf-8")
    assert re.search(r"CREATE OR REPLACE FUNCTION update_updated_at_column\(\)\s+RETURNS TRIGGER AS \$\$\s+"
                     r"BEGIN\s+NEW\.updated_at = NOW\(\);\s+RETURN NEW;\s+END;", body)
    hardening = (MIGRATIONS / "108_security_hardening.sql").read_text(encoding="utf-8")
    assert "ALTER FUNCTION public.update_updated_at_column()              SET search_path = public, pg_temp;" in hardening


def test_guards_sort_before_the_new_triggers_and_ignore_updated_at():
    guard = (MIGRATIONS / "306_mock_paper_policy_and_admission.sql").read_text(encoding="utf-8")
    package = (MIGRATIONS / "295_listening_content_programmes.sql").read_text(encoding="utf-8")
    for name in ("trg_mock_paper_policy", "trg_mock_paper_source", "trg_protect_listening_package_child",
                 "trg_listening_exercises_updated_at"):
        for table in TABLES:
            assert name < f"update_{table}_updated_at"
    # 306 excludes updated_at from both the content diff and the policy snapshot.
    assert "IF (n-ARRAY['policy_revision','mock_content_revision','approved_public_overlap','updated_at'," in guard
    assert "IF n-ARRAY['updated_at'] IS DISTINCT FROM b-ARRAY['updated_at'] THEN" in guard
    snapshot = guard.split("CREATE OR REPLACE FUNCTION public.fn_mock_policy_snapshot", 1)[1].split("$$;", 1)[0]
    assert "updated_at" not in snapshot
    # 295 allow-lists updated_at for the three Listening paper tables it guards.
    assert package.count("v_allowed_columns := ARRAY['status', 'updated_at'];") >= 3
    assert "v_allowed_columns := ARRAY['status', 'is_public', 'updated_at'];" in package


def test_no_other_migration_drops_or_disables_the_new_triggers():
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name == NAME:
            continue
        text = path.read_text(encoding="utf-8")
        for table in TABLES:
            assert f"update_{table}_updated_at" not in text, path.name


# ── PostgreSQL behaviour ────────────────────────────────────────────────────

FUNCTION_033 = re.search(
    r"CREATE OR REPLACE FUNCTION update_updated_at_column\(\).*?\$\$ LANGUAGE plpgsql;",
    (MIGRATIONS / "033_writing_coach_tables.sql").read_text(encoding="utf-8"), re.S).group(0)


@pytest.fixture
def paper_probe(private_probe):  # noqa: F811
    s = private_probe
    query(f"""
        {FUNCTION_033.replace('FUNCTION update_updated_at_column', f'FUNCTION {s}.update_updated_at_column')}
        ALTER FUNCTION {s}.update_updated_at_column() SET search_path = {s}, pg_temp;
        ALTER TABLE {s}.reading_passages ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
        ALTER TABLE {s}.reading_questions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
        ALTER TABLE {s}.listening_content ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
        ALTER TABLE {s}.listening_exercises ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
        -- 208's own trigger on listening_exercises.
        CREATE FUNCTION {s}.update_listening_exercises_updated_at() RETURNS trigger LANGUAGE plpgsql
            SET search_path = {s}, pg_temp AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
        CREATE TRIGGER trg_listening_exercises_updated_at BEFORE UPDATE ON {s}.listening_exercises
            FOR EACH ROW EXECUTE FUNCTION {s}.update_listening_exercises_updated_at();
    """)
    query(migrated(s))
    query(migrated(s))  # re-runnable
    yield s


def old_paper(s, skill="reading", public=True):
    return query(f"INSERT INTO {s}.{skill}_tests(is_public,test_id,updated_at) VALUES($1,$2,$3) RETURNING id",
                 public, uuid4().hex, OLD)[0]["id"]


def row(s, skill, paper_id):
    return query(f"SELECT * FROM {s}.{skill}_tests WHERE id=$1", paper_id)[0]


def events(s, paper_id):
    return query(f"SELECT * FROM {s}.mock_correction_release_events WHERE scope_id=$1 ORDER BY created_at", str(paper_id))


def test_each_table_has_one_trigger_after_the_guards(paper_probe):
    s = paper_probe
    for table in TABLES:
        names = triggers(s, table)
        assert names.count(f"update_{table}_updated_at") == 1
        assert names[-1] == f"update_{table}_updated_at", names
    assert "trg_mock_paper_policy" in triggers(s, "reading_tests")
    assert "trg_mock_paper_policy" in triggers(s, "listening_tests")
    assert triggers(s, "listening_exercises") == ["trg_listening_exercises_updated_at", "trg_mock_paper_source"]


@pytest.mark.parametrize("skill", ["reading", "listening"])
def test_visibility_rpc_advances_updated_at_with_one_audited_policy_change(paper_probe, skill):
    s = paper_probe
    paper_id = old_paper(s, skill)
    before, start = row(s, skill, paper_id), now()
    actor = uuid4()
    query(f"SELECT {s}.fn_mutate_mock_paper_policy($1,$2,'{{\"is_public\":false}}',$3,0,NULL,NULL)",
          skill, paper_id, actor)
    after = row(s, skill, paper_id)
    assert before["updated_at"] == OLD
    assert after["is_public"] is False and start <= after["updated_at"] <= now()
    assert after["policy_revision"] == before["policy_revision"] + 1
    assert after["mock_content_revision"] == before["mock_content_revision"]
    [event] = events(s, paper_id)
    assert event["actor_id"] == actor and event["action"] == "mock_paper_policy_updated"
    assert json.loads(event["previous_state"])["is_public"] is True
    assert json.loads(event["new_state"])["is_public"] is False


def test_raw_update_and_an_explicit_stale_value_still_advance_updated_at(paper_probe):
    s = paper_probe
    paper_id = old_paper(s)
    start = now()
    query(f"UPDATE {s}.reading_tests SET is_public=false, updated_at=$2 WHERE id=$1", paper_id, OLD)
    after = row(s, "reading", paper_id)
    assert start <= after["updated_at"] <= now()
    [event] = events(s, paper_id)
    assert event["reason"] == "legacy_writer" and event["actor_id"] is None


def test_updated_at_only_update_changes_no_revision_and_writes_no_event(paper_probe):
    s = paper_probe
    paper_id = old_paper(s)
    before = row(s, "reading", paper_id)
    query(f"UPDATE {s}.reading_tests SET updated_at=updated_at WHERE id=$1", paper_id)
    after = row(s, "reading", paper_id)
    assert after["updated_at"] > OLD
    assert after["policy_revision"] == before["policy_revision"]
    assert after["mock_content_revision"] == before["mock_content_revision"]
    assert events(s, paper_id) == []


def test_content_edit_bumps_mock_content_revision_once_as_before(paper_probe):
    s = paper_probe
    paper_id = old_paper(s)
    query(f"UPDATE {s}.reading_tests SET title='Edited' WHERE id=$1", paper_id)
    after = row(s, "reading", paper_id)
    assert after["mock_content_revision"] == 1 and after["policy_revision"] == 0
    assert after["updated_at"] > OLD and events(s, paper_id) == []


def test_guard_sees_the_writers_row_and_refusals_still_abort(paper_probe):
    s = paper_probe
    paper_id = old_paper(s)
    # A probe that sorts before update_* records what the guards see.
    query(f"""
        CREATE TABLE {s}.seen(updated_at timestamptz);
        CREATE FUNCTION {s}.probe_seen() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN INSERT INTO {s}.seen VALUES (NEW.updated_at); RETURN NEW; END $$;
        CREATE TRIGGER trg_probe_seen BEFORE UPDATE ON {s}.reading_tests
            FOR EACH ROW EXECUTE FUNCTION {s}.probe_seen();
    """)
    try:
        query(f"UPDATE {s}.reading_tests SET metadata='{{\"k\":1}}' WHERE id=$1", paper_id)
        assert [r["updated_at"] for r in query(f"SELECT * FROM {s}.seen")] == [OLD]
        assert row(s, "reading", paper_id)["updated_at"] > OLD
    finally:
        query(f"DROP TRIGGER trg_probe_seen ON {s}.reading_tests")
    stamped = row(s, "reading", paper_id)
    with pytest.raises(asyncpg.PostgresError, match="explicit_decision_required"):
        query(f"UPDATE {s}.reading_tests SET approved_public_overlap='{{}}' WHERE id=$1", paper_id)
    assert dict(row(s, "reading", paper_id)) == dict(stamped)


def test_child_edits_advance_their_own_updated_at_and_keep_the_source_guard(paper_probe):
    s = paper_probe
    reading = source_bundle(s, "reading")
    listening = source_bundle(s, "listening")
    # Inserting the children already bumped mock_content_revision (306 source guard).
    revision = {k: row(s, k, p)["mock_content_revision"] for k, p in (("reading", reading), ("listening", listening))}
    query(f"UPDATE {s}.reading_passages SET updated_at=$2 WHERE test_id=$1", reading, OLD)  # stays now()
    query(f"UPDATE {s}.reading_questions SET updated_at=$2 FROM {s}.reading_passages p "
          f"WHERE p.id=reading_questions.passage_id AND p.test_id=$1", reading, OLD)
    query(f"UPDATE {s}.listening_content SET updated_at=$2 WHERE test_id=$1", listening, OLD)
    for table, key, paper_id in (("reading_passages", "test_id", reading), ("listening_content", "test_id", listening)):
        assert all(r["updated_at"] > OLD for r in query(f"SELECT updated_at FROM {s}.{table} WHERE {key}=$1", paper_id))
    assert all(r["updated_at"] > OLD for r in query(
        f"SELECT q.updated_at FROM {s}.reading_questions q JOIN {s}.reading_passages p ON p.id=q.passage_id WHERE p.test_id=$1",
        reading))
    # updated_at-only child writes are not content changes for the 306 source guard.
    assert row(s, "reading", reading)["mock_content_revision"] == revision["reading"]
    assert row(s, "listening", listening)["mock_content_revision"] == revision["listening"]
    query(f"UPDATE {s}.reading_passages SET title='Edited' WHERE test_id=$1", reading)
    assert row(s, "reading", reading)["mock_content_revision"] == revision["reading"] + 1
    # listening_exercises is still maintained by 208's trigger.
    query(f"UPDATE {s}.listening_exercises SET updated_at=$1", OLD)
    assert all(r["updated_at"] > OLD for r in query(f"SELECT updated_at FROM {s}.listening_exercises"))


def test_insert_keeps_the_writers_updated_at(paper_probe):
    assert row(paper_probe, "reading", old_paper(paper_probe))["updated_at"] == OLD


@pytest.mark.parametrize("skill", ["reading", "listening"])
def test_mock_copy_still_hides_a_public_source_and_now_advances_its_updated_at(paper_probe, skill):
    s = paper_probe
    source = source_bundle(s, skill, public=True)
    # Give the source an old stamp, as on production before 338.
    query(f"ALTER TABLE {s}.{skill}_tests DISABLE TRIGGER update_{skill}_tests_updated_at")
    query(f"UPDATE {s}.{skill}_tests SET updated_at=$2 WHERE id=$1", source, OLD)
    query(f"ALTER TABLE {s}.{skill}_tests ENABLE TRIGGER update_{skill}_tests_updated_at")
    assert row(s, skill, source)["updated_at"] == OLD
    start = now()
    result = create(s, **{f"{skill}_test_id": str(source), f"{skill}_is_public": False})
    after = row(s, skill, source)
    assert after["is_public"] is False and after["policy_revision"] == 1
    assert start <= after["updated_at"] <= now()
    copy = row(s, skill, UUID(result[f"{skill}_test_id"]))
    assert copy["is_public"] is False and copy["exam_only"] is True and copy["policy_revision"] == 0
    [event] = events(s, source)
    assert event["reason"] == "policy_update"


# ── Preconditions and postconditions on a minimal schema ────────────────────

def _minimal(drop: str | None = None):
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.query:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("338 requires an explicitly LOCAL disposable PostgreSQL URL")
        pytest.skip("Local PostgreSQL unavailable")
    s = "m338_" + uuid4().hex
    parts = [f"CREATE SCHEMA {s};"]
    if drop != "function":
        parts.append(FUNCTION_033.replace("FUNCTION update_updated_at_column", f"FUNCTION {s}.update_updated_at_column"))
    parts.append(f"CREATE FUNCTION {s}.noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;")
    for table in (*TABLES, "listening_exercises"):
        column = "" if drop == f"column:{table}" else ", updated_at timestamptz"
        parts.append(f"CREATE TABLE {s}.{table}(id int{column});")
    for table in ("reading_tests", "listening_tests"):
        if drop != f"guard:{table}":
            parts.append(f"CREATE TRIGGER trg_mock_paper_policy BEFORE UPDATE OR DELETE ON {s}.{table} "
                         f"FOR EACH ROW EXECUTE FUNCTION {s}.noop();")
    if drop != "exercises":
        parts.append(f"CREATE TRIGGER trg_listening_exercises_updated_at BEFORE UPDATE ON {s}.listening_exercises "
                     f"FOR EACH ROW EXECUTE FUNCTION {s}.noop();")
    query("\n".join(parts))
    return s


@pytest.fixture
def minimal():
    created = []

    def build(drop=None):
        created.append(_minimal(drop))
        return created[-1]
    yield build
    for s in created:
        query(f"DROP SCHEMA IF EXISTS {s} CASCADE")


def test_minimal_schema_applies(minimal):
    s = minimal()
    query(migrated(s))
    query(migrated(s))
    for table in TABLES:
        assert triggers(s, table)[-1] == f"update_{table}_updated_at"


@pytest.mark.parametrize("drop", ["function", "guard:reading_tests", "guard:listening_tests", "exercises",
                                  *(f"column:{t}" for t in TABLES)])
def test_precondition_aborts_without_creating_any_trigger(minimal, drop):
    s = minimal(drop)
    with pytest.raises(asyncpg.PostgresError, match="migration_338_precondition"):
        query(migrated(s))
    for table in TABLES:
        assert f"update_{table}_updated_at" not in triggers(s, table)


def test_postcondition_rejects_a_before_row_trigger_that_fires_after(minimal):
    s = minimal()
    query(f"CREATE TRIGGER zz_late BEFORE INSERT OR UPDATE ON {s}.reading_passages FOR EACH ROW EXECUTE FUNCTION {s}.noop();")
    with pytest.raises(asyncpg.PostgresError, match="fires after update_reading_passages_updated_at"):
        query(migrated(s))
    assert "update_reading_passages_updated_at" not in triggers(s, "reading_passages")


def test_postcondition_rejects_a_second_shared_function_trigger(minimal):
    s = minimal()
    query(f"CREATE TRIGGER set_updated_at BEFORE UPDATE ON {s}.listening_content "
          f"FOR EACH ROW EXECUTE FUNCTION {s}.update_updated_at_column();")
    with pytest.raises(asyncpg.PostgresError, match="second update_updated_at_column"):
        query(migrated(s))


def test_reapply_reenables_a_disabled_trigger(minimal):
    s = minimal()
    query(migrated(s))
    query(f"ALTER TABLE {s}.reading_tests DISABLE TRIGGER update_reading_tests_updated_at")
    query(migrated(s))  # CREATE OR REPLACE TRIGGER restores the enabled state
    assert query("SELECT tgenabled FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2",
                 f"{s}.reading_tests", "update_reading_tests_updated_at")[0]["tgenabled"] == b"O"
