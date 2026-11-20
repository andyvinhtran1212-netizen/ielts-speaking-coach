"""Migration 440 (ADMINIA-0074 G09-T22): admin_settings + append-only log.

Runs the committed SQL on a LOCAL disposable PostgreSQL (TEST_PG_URL; with
REQUIRE_PG=1 a missing cluster is a failure, not a skip), transplanted from
``public`` into one random schema per test. It checks what the migration
promises: the seed equals the defaults in services/ops_thresholds.py,
fn_admin_settings_merge writes value and log in one call and nothing for a
no-op, the log cannot be changed or emptied, client roles see nothing, the
file re-runs safely, and the rollback refuses once a setting was changed.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

from services import ops_thresholds
from test_migration_240_core_attempt_evidence import psql

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
SQL = (MIGRATIONS / "440_admin_settings.sql").read_text(encoding="utf-8")
ROLLBACK_SQL = (MIGRATIONS / "rollback" / "440_admin_settings.sql").read_text(encoding="utf-8")
ACTOR = "00000000-0000-0000-0000-0000000004a0"


def _available() -> bool:
    try:
        return bool(shutil.which("psql")) and psql("SELECT 1") == "1"
    except Exception:
        return False


@pytest.fixture
def schema():
    if not _available():
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 440 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 440 fixture requires a superuser on its disposable LOCAL cluster")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    name = "admin_settings_" + uuid4().hex
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


def _merge(name: str, changes: dict, reason: str = "Đổi theo quy trình mới") -> dict:
    out = psql(
        "SET ROLE service_role; "
        f"SELECT {name}.fn_admin_settings_merge('ops_thresholds', '{json.dumps(changes)}'::jsonb, "
        f"'{reason}', '{ACTOR}'::uuid)::text"
    )
    return json.loads(out.splitlines()[-1])


def _stored(name: str) -> dict:
    return json.loads(psql(f"SELECT value::text FROM {name}.admin_settings WHERE key='ops_thresholds'"))


def _log_count(name: str) -> int:
    return int(psql(f"SELECT count(*) FROM {name}.admin_settings_log"))


def _fails(sql: str) -> str:
    with pytest.raises(RuntimeError) as caught:
        psql(sql)
    return str(caught.value)


def test_seed_equals_the_service_defaults_and_rerun_keeps_edits(schema):
    _migrate(schema)
    assert _stored(schema) == {t.key: t.default for t in ops_thresholds.EDITABLE}
    _merge(schema, {"writing_review_hours": 1})
    _migrate(schema)  # additive: a second run neither fails nor resets the owner's edit
    assert _stored(schema)["writing_review_hours"] == 1
    assert _log_count(schema) == 1


def test_merge_writes_value_and_one_log_row_and_a_no_op_writes_nothing(schema):
    _migrate(schema)
    before = _stored(schema)
    merged = _merge(schema, {"writing_review_hours": 24, "too_fast_sec_per_question": 8})
    assert merged == {**before, "writing_review_hours": 24, "too_fast_sec_per_question": 8}
    assert _stored(schema) == merged
    row = psql(f"SELECT old_value::text || '|' || new_value::text || '|' || reason || '|' || actor_id "
               f"FROM {schema}.admin_settings_log").split("|")
    assert json.loads(row[0]) == before and json.loads(row[1]) == merged
    assert row[2:] == ["Đổi theo quy trình mới", ACTOR]
    assert psql(f"SELECT updated_by FROM {schema}.admin_settings WHERE key='ops_thresholds'") == ACTOR

    _merge(schema, {"writing_review_hours": 24})
    assert _log_count(schema) == 1

    _merge(schema, {"too_fast_sec_per_question": None})  # back to "tắt lý do"
    assert _stored(schema)["too_fast_sec_per_question"] is None
    assert _log_count(schema) == 2


def test_merge_refuses_a_non_object_and_a_blank_reason(schema):
    _migrate(schema)
    assert "admin_settings_changes_not_object" in _fails(
        f"SET ROLE service_role; SELECT {schema}.fn_admin_settings_merge('ops_thresholds', '[1]'::jsonb, 'x', NULL)")
    assert "admin_settings_log_reason_check" in _fails(
        f"SET ROLE service_role; SELECT {schema}.fn_admin_settings_merge('ops_thresholds', "
        "'{\"regrade_hours\": 5}'::jsonb, '   ', NULL)")
    # The refused call left neither the value nor a log row behind.
    assert _stored(schema)["regrade_hours"] == 48 and _log_count(schema) == 0


def test_log_is_append_only(schema):
    _migrate(schema)
    _merge(schema, {"regrade_hours": 12})
    for sql in (f"UPDATE {schema}.admin_settings_log SET reason='sửa'",
                f"DELETE FROM {schema}.admin_settings_log",
                f"TRUNCATE {schema}.admin_settings_log"):
        # Even the superuser is stopped by the triggers.
        assert "admin_settings_log chỉ THÊM" in _fails(sql), sql
        # service_role does not hold the privilege at all.
        assert "permission denied" in _fails(f"SET ROLE service_role; {sql}"), sql
    assert _log_count(schema) == 1


def test_client_roles_see_nothing_and_cannot_call_the_merge(schema):
    _migrate(schema)
    for role in ("anon", "authenticated"):
        for table in ("admin_settings", "admin_settings_log"):
            assert "permission denied" in _fails(f"SET ROLE {role}; SELECT * FROM {schema}.{table}")
        assert "permission denied" in _fails(
            f"SET ROLE {role}; SELECT {schema}.fn_admin_settings_merge('ops_thresholds', '{{}}'::jsonb, 'x', NULL)")
    assert psql(f"SELECT count(*) FROM pg_policy WHERE polrelid IN "
                f"('{schema}.admin_settings'::regclass, '{schema}.admin_settings_log'::regclass)") == "0"


def test_rollback_runs_on_a_fresh_install_and_refuses_after_a_change(schema):
    _migrate(schema)
    psql(_in(schema, ROLLBACK_SQL))
    assert psql(f"SELECT to_regclass('{schema}.admin_settings') IS NULL") == "t"

    _migrate(schema)
    _merge(schema, {"inactive_days": 14})
    assert "keep schema 440 and roll forward" in _fails(_in(schema, ROLLBACK_SQL))
    assert _stored(schema)["inactive_days"] == 14
