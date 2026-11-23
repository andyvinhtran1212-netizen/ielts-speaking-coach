"""Migration 451 (ADMINIA-0074 G09-T07): incident group states + append-only notes.

Runs the committed SQL on a LOCAL disposable PostgreSQL (TEST_PG_URL; with
REQUIRE_PG=1 a missing cluster is a failure, not a skip), transplanted from
``public`` into one random schema per test, like migration 440's test. It
checks what the migration promises: fn_incident_group_transition writes the
state and one auto note per change, a closed group with a newer record is
reopened and keeps its notes and claimer, notes cannot be changed or emptied,
client roles see nothing, the file re-runs safely, and the rollback refuses
once a group was acted on.
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
SQL = (MIGRATIONS / "451_incident_groups.sql").read_text(encoding="utf-8")
ROLLBACK_SQL = (MIGRATIONS / "rollback" / "451_incident_groups.sql").read_text(encoding="utf-8")
ACTOR = "00000000-0000-0000-0000-0000000004b1"
FP = "a" * 40


def _available() -> bool:
    try:
        return bool(shutil.which("psql")) and psql("SELECT 1") == "1"
    except Exception:
        return False


@pytest.fixture
def schema():
    if not _available():
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 451 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 451 fixture requires a superuser on its disposable LOCAL cluster")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    name = "incident_groups_" + uuid4().hex
    psql(f"CREATE SCHEMA {name}")
    psql(f"GRANT USAGE ON SCHEMA {name} TO service_role, anon, authenticated")
    try:
        yield name
    finally:
        # Only the unique schema this fixture created is removed.
        psql(f"DROP SCHEMA {name} CASCADE")


def _in(name: str, sql: str) -> str:
    return sql.replace("public.", f"{name}.")


def _migrate(name: str) -> None:
    psql(_in(name, SQL))


def _act(name: str, action: str, last_seen: str | None = "2026-11-20T10:00:00Z", note: str | None = None,
         fp: str = FP) -> dict:
    seen = f"'{last_seen}'::timestamptz" if last_seen else "NULL"
    note_sql = f"'{note}'" if note is not None else "NULL"
    out = psql(
        "SET ROLE service_role; "
        f"SELECT {name}.fn_incident_group_transition('errors', '{fp}', '{action}', '{ACTOR}'::uuid, "
        f"{seen}, {note_sql})::text"
    )
    return json.loads(out.splitlines()[-1])


def _group(name: str) -> dict:
    out = psql(f"SELECT row_to_json(g)::text FROM {name}.incident_groups g WHERE fingerprint = '{FP}'")
    return json.loads(out)


def _notes(name: str) -> list[tuple[str, bool]]:
    out = psql(f"SELECT body || '|' || auto FROM {name}.incident_group_notes ORDER BY id")
    return [(line.rsplit("|", 1)[0], line.rsplit("|", 1)[1] == "true") for line in out.splitlines() if line]


def _fails(sql: str) -> str:
    with pytest.raises(RuntimeError) as caught:
        psql(sql)
    return str(caught.value)


def test_claim_then_resolve_writes_state_and_one_auto_note_each(schema):
    _migrate(schema)
    assert _act(schema, "claim") == {"status": "in_review", "changed": True, "reopened": False}
    group = _group(schema)
    assert group["status"] == "in_review" and group["claimed_by"] == ACTOR and group["claimed_at"]
    # Claiming an already claimed group changes nothing and writes nothing.
    assert _act(schema, "claim")["changed"] is False
    assert _act(schema, "resolve", note="Đã sửa ở bản 1.2") == {"status": "resolved", "changed": True,
                                                                "reopened": False}
    group = _group(schema)
    assert group["status"] == "resolved" and group["resolved_by"] == ACTOR and group["resolved_at"]
    assert group["note"] == "Đã sửa ở bản 1.2"
    assert _notes(schema) == [("Nhận xử lý.", True), ("Đánh dấu đã xử lý.", True), ("Đã sửa ở bản 1.2", False)]


def test_a_newer_record_reopens_a_closed_group_and_keeps_notes_and_claimer(schema):
    _migrate(schema)
    _act(schema, "claim")
    _act(schema, "resolve", note="ghi chú cũ")
    # Same last record as when it was closed: still resolved, nothing to reopen.
    assert _act(schema, "resolve", last_seen="2026-11-20T10:00:00Z")["changed"] is False
    # A record after resolved_at: the group reads as new, so claiming it works,
    # and the reopen is logged before the claim.
    out = _act(schema, "claim", last_seen="2999-01-01T00:00:00Z")
    assert out == {"status": "in_review", "changed": True, "reopened": True}
    group = _group(schema)
    assert group["status"] == "in_review" and group["resolved_at"] is None and group["claimed_by"] == ACTOR
    assert group["note"] == "ghi chú cũ"
    assert [b for b, _ in _notes(schema)][-2:] == ["Tự mở lại: có ghi nhận mới sau khi nhóm được đóng.",
                                                   "Nhận xử lý."]


def test_ignore_and_reopen(schema):
    _migrate(schema)
    assert _act(schema, "ignore")["status"] == "ignored"
    assert _group(schema)["resolved_at"]          # closing time is kept for both closed states
    assert _act(schema, "reopen")["status"] == "new"
    group = _group(schema)
    assert group["status"] == "new" and group["resolved_at"] is None and group["resolved_by"] is None
    assert _act(schema, "reopen")["changed"] is False


def test_a_note_alone_is_kept_and_an_unknown_action_is_refused(schema):
    _migrate(schema)
    _act(schema, "claim")
    assert _act(schema, "claim", note="Đang chờ nhà cung cấp")["changed"] is False
    assert _notes(schema)[-1] == ("Đang chờ nhà cung cấp", False)
    assert "incident_group_action_invalid" in _fails(
        f"SET ROLE service_role; SELECT {schema}.fn_incident_group_transition("
        f"'errors', '{FP}', 'delete', NULL, NULL, NULL)")


def test_a_group_closed_row_by_row_starts_resolved(schema):
    _migrate(schema)
    out = psql(
        "SET ROLE service_role; "
        f"SELECT {schema}.fn_incident_group_transition('errors', '{FP}', 'reopen', '{ACTOR}'::uuid, "
        "'2026-11-20T10:00:00Z'::timestamptz, NULL, true)::text")
    assert json.loads(out.splitlines()[-1]) == {"status": "new", "changed": True, "reopened": False}
    assert [b for b, _ in _notes(schema)] == ["Mở lại nhóm."]


def test_source_status_and_fingerprint_checks(schema):
    _migrate(schema)
    assert "incident_groups_fingerprint_check" in _fails(
        f"INSERT INTO {schema}.incident_groups (source, fingerprint) VALUES ('errors', 'abc')")
    assert "incident_groups_source_check" in _fails(
        f"INSERT INTO {schema}.incident_groups (source, fingerprint) VALUES ('other', '{FP}')")
    assert "check" in _fails(
        f"INSERT INTO {schema}.incident_groups (source, fingerprint, status) VALUES ('errors', '{FP}', 'resolved')")


def test_notes_are_append_only(schema):
    _migrate(schema)
    _act(schema, "claim")
    for sql in (f"UPDATE {schema}.incident_group_notes SET body='sửa'",
                f"DELETE FROM {schema}.incident_group_notes",
                f"TRUNCATE {schema}.incident_group_notes"):
        assert "incident_group_notes chỉ THÊM" in _fails(sql), sql
        assert "permission denied" in _fails(f"SET ROLE service_role; {sql}"), sql
    assert "permission denied" in _fails(f"SET ROLE service_role; DELETE FROM {schema}.incident_groups")
    assert len(_notes(schema)) == 1


def test_client_roles_see_nothing_and_cannot_call_the_transition(schema):
    _migrate(schema)
    for role in ("anon", "authenticated"):
        for table in ("incident_groups", "incident_group_notes"):
            assert "permission denied" in _fails(f"SET ROLE {role}; SELECT * FROM {schema}.{table}")
        assert "permission denied" in _fails(
            f"SET ROLE {role}; SELECT {schema}.fn_incident_group_transition("
            f"'errors', '{FP}', 'claim', NULL, NULL, NULL)")
    assert psql(f"SELECT count(*) FROM pg_policy WHERE polrelid IN "
                f"('{schema}.incident_groups'::regclass, '{schema}.incident_group_notes'::regclass)") == "0"


def test_rerun_is_safe_and_rollback_refuses_after_an_action(schema):
    _migrate(schema)
    psql(_in(schema, ROLLBACK_SQL))
    assert psql(f"SELECT to_regclass('{schema}.incident_groups') IS NULL") == "t"

    _migrate(schema)
    _act(schema, "claim")
    _migrate(schema)  # additive: a second run neither fails nor resets a decision
    assert _group(schema)["status"] == "in_review"
    assert "keep schema 451 and roll forward" in _fails(_in(schema, ROLLBACK_SQL))
    assert _group(schema)["status"] == "in_review"
