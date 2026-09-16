"""Executable regression for migration 280's immutable timer snapshot."""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest


_MIG = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "280_snapshot_timed_course_cutoff.sql"
)
_DB = os.environ.get("TEST_PG_URL", "postgres://localhost/postgres")
_SCHEMA = "timed_snapshot_probe_280"


def _psql(sql: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["psql", _DB, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        check=False,
        capture_output=True,
        text=True,
    )
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result


def _have_pg() -> bool:
    if not shutil.which("psql"):
        return False
    try:
        return _psql("SELECT 1;").stdout.strip() == "1"
    except Exception:
        return False


if os.environ.get("REQUIRE_PG") == "1" and not _have_pg():
    raise RuntimeError(f"REQUIRE_PG=1 but PostgreSQL is unavailable at {_DB}")

pytestmark = pytest.mark.skipif(
    not _have_pg(), reason="local PostgreSQL is required for the real trigger probe",
)


@pytest.fixture()
def snapshot_probe():
    assignment_id, legacy_assignment_id = uuid.uuid4(), uuid.uuid4()
    item_id, legacy_item_id = uuid.uuid4(), uuid.uuid4()
    setup = f"""
    DROP SCHEMA IF EXISTS {_SCHEMA} CASCADE;
    CREATE SCHEMA {_SCHEMA};
    SET search_path = {_SCHEMA};

    CREATE TABLE class_assignments (
        id UUID PRIMARY KEY,
        skill TEXT NOT NULL,
        content_config JSONB NOT NULL,
        due_at TIMESTAMPTZ,
        timed_started_at TIMESTAMPTZ
    );
    CREATE TABLE class_assignment_items (
        id UUID PRIMARY KEY,
        assignment_id UUID NOT NULL,
        opened_at TIMESTAMPTZ
    );

    INSERT INTO class_assignments VALUES
        ('{assignment_id}', 'course', '{{"time_limit_minutes": 60}}',
         '2026-09-16T03:00:00Z', NULL),
        ('{legacy_assignment_id}', 'course', '{{"time_limit_minutes": 45}}',
         '2026-09-16T04:00:00Z', '2026-09-16T01:00:00Z');
    INSERT INTO class_assignment_items VALUES
        ('{item_id}', '{assignment_id}', NULL),
        ('{legacy_item_id}', '{legacy_assignment_id}', '2026-09-16T01:00:00Z');
    """
    migration = (
        _MIG.read_text(encoding="utf-8")
        .replace("public.", f"{_SCHEMA}.")
        .replace(
            "SET search_path = public, pg_temp",
            f"SET search_path = {_SCHEMA}, pg_temp",
        )
    )
    _psql(setup + migration)
    try:
        yield {
            "assignment": assignment_id,
            "item": item_id,
            "legacy_item": legacy_item_id,
        }
    finally:
        _psql(f"DROP SCHEMA IF EXISTS {_SCHEMA} CASCADE;", check=False)


def test_backfills_and_snapshots_the_effective_cutoff(snapshot_probe):
    legacy = _psql(
        "SELECT timed_limit_minutes = 45 AND "
        "timed_expires_at = '2026-09-16T01:45:00Z' "
        f"FROM {_SCHEMA}.class_assignment_items "
        f"WHERE id = '{snapshot_probe['legacy_item']}';"
    ).stdout.strip()
    assert legacy == "t"

    _psql(
        f"UPDATE {_SCHEMA}.class_assignment_items "
        "SET opened_at = '2026-09-16T02:30:00Z' "
        f"WHERE id = '{snapshot_probe['item']}';"
    )
    current = _psql(
        "SELECT timed_limit_minutes = 60 AND "
        "timed_expires_at = '2026-09-16T03:00:00Z' "
        f"FROM {_SCHEMA}.class_assignment_items "
        f"WHERE id = '{snapshot_probe['item']}';"
    ).stdout.strip()
    assert current == "t"


def test_started_duration_and_item_snapshot_are_immutable(snapshot_probe):
    _psql(
        f"UPDATE {_SCHEMA}.class_assignment_items "
        "SET opened_at = '2026-09-16T02:30:00Z' "
        f"WHERE id = '{snapshot_probe['item']}';"
    )
    duration = _psql(
        f"UPDATE {_SCHEMA}.class_assignments "
        "SET content_config = '{\"time_limit_minutes\": 5}'::jsonb "
        f"WHERE id = '{snapshot_probe['assignment']}';",
        check=False,
    )
    assert duration.returncode != 0
    assert "timed_course_duration_locked_after_start" in duration.stderr

    snapshot = _psql(
        f"UPDATE {_SCHEMA}.class_assignment_items "
        "SET timed_expires_at = timed_expires_at + interval '1 minute' "
        f"WHERE id = '{snapshot_probe['item']}';",
        check=False,
    )
    assert snapshot.returncode != 0
    assert "timed_course_snapshot_immutable" in snapshot.stderr
