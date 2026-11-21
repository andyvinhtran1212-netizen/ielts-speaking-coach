"""Migration 441 (ADMINIA-0074 G09-T24): one teacher per class + schedule.

Runs the committed SQL on a LOCAL disposable PostgreSQL (TEST_PG_URL; with
REQUIRE_PG=1 a missing cluster is a failure, not a skip) in one random schema
holding minimal stand-ins for the tables 441 touches (users, cohorts,
students, student_cohort_memberships, class_lessons, and class_action_log with
the 198 action CHECK). It checks the backfill rule of plan 5.3, the drift
guard on the action CHECK (198 or 198+378 accepted, anything else refused), fn_set_cohort_teacher (one log row per real change,
none for a repeat), client roles, a re-run, and the rollback guard.
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
SQL = (MIGRATIONS / "441_cohort_teacher_schedule.sql").read_text(encoding="utf-8")
ROLLBACK_SQL = (MIGRATIONS / "rollback" / "441_cohort_teacher_schedule.sql").read_text(encoding="utf-8")

T1, T2 = "10000000-0000-0000-0000-000000000001", "10000000-0000-0000-0000-000000000002"
ADMIN = "10000000-0000-0000-0000-0000000000ad"
# Classes: one teacher among members; two teachers; no teacher; archived; empty.
SAME, MIXED, NONE, ARCHIVED, EMPTY = (f"c0000000-0000-0000-0000-00000000000{i}" for i in range(1, 6))


def _available() -> bool:
    try:
        return bool(shutil.which("psql")) and psql("SELECT 1") == "1"
    except Exception:
        return False


def _stand_ins(s: str) -> str:
    return f"""
    CREATE TABLE {s}.users (id uuid PRIMARY KEY, role text NOT NULL);
    CREATE TABLE {s}.cohorts (id uuid PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL DEFAULT true,
                              updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE {s}.students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                               instructor_id uuid REFERENCES {s}.users(id) ON DELETE SET NULL);
    CREATE TABLE {s}.student_cohort_memberships (student_id uuid REFERENCES {s}.students(id),
                                                 cohort_id uuid REFERENCES {s}.cohorts(id), is_active boolean NOT NULL);
    CREATE TABLE {s}.class_lessons (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid);
    CREATE TABLE {s}.class_action_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        action text NOT NULL CHECK (action IN ('due_change', 'return_work')),
        cohort_id uuid NOT NULL, assignment_id uuid, student_id uuid,
        actor_user_id uuid, actor_email text, details jsonb NOT NULL DEFAULT '{{}}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now());
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA {s} TO service_role;
    INSERT INTO {s}.users VALUES ('{T1}', 'instructor'), ('{T2}', 'instructor'), ('{ADMIN}', 'admin');
    INSERT INTO {s}.cohorts (id, name, is_active) VALUES
        ('{SAME}', 'Lớp một giáo viên', true), ('{MIXED}', 'Lớp hai giáo viên', true),
        ('{NONE}', 'Lớp chưa có giáo viên', true), ('{ARCHIVED}', 'Lớp đã lưu trữ', false),
        ('{EMPTY}', 'Lớp trống', true);
    """


def _member(s: str, cohort: str, teacher: str | None, active: bool = True) -> str:
    teacher_sql = f"'{teacher}'::uuid" if teacher else "NULL"
    return (f"WITH st AS (INSERT INTO {s}.students (instructor_id) VALUES ({teacher_sql}) RETURNING id) "
            f"INSERT INTO {s}.student_cohort_memberships SELECT id, '{cohort}', {str(active).lower()} FROM st;")


@pytest.fixture
def schema():
    if not _available():
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 441 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 441 fixture requires a superuser on its disposable LOCAL cluster")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    name = "cohort_teacher_" + uuid4().hex
    psql(f"CREATE SCHEMA {name}")
    psql(f"GRANT USAGE ON SCHEMA {name} TO service_role, anon, authenticated")
    try:
        psql(_stand_ins(name))
        psql(" ".join([
            _member(name, SAME, T1), _member(name, SAME, T1), _member(name, SAME, None),
            _member(name, SAME, T2, active=False),          # left the class: ignored
            _member(name, MIXED, T1), _member(name, MIXED, T2),
            _member(name, NONE, None),
            _member(name, ARCHIVED, T1),
        ]))
        yield name
    finally:
        # Only the unique schema this fixture created is removed.
        psql(f"DROP SCHEMA {name} CASCADE")


def _migrate(s: str) -> str:
    """Run 441 and return its NOTICE lines."""
    import subprocess

    from test_migration_240_core_attempt_evidence import DB
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    out = subprocess.run(["psql", DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", SQL.replace("public.", f"{s}.")],
                         capture_output=True, text=True, timeout=30, env=env)
    if out.returncode:
        raise RuntimeError(out.stderr)
    return out.stderr


def _teacher(s: str, cohort: str) -> str:
    return psql(f"SELECT coalesce(instructor_id::text, '') FROM {s}.cohorts WHERE id='{cohort}'")


def _set(s: str, cohort: str, teacher: str | None) -> dict | None:
    value = f"'{teacher}'::uuid" if teacher else "NULL"
    out = psql(f"SET ROLE service_role; SELECT coalesce({s}.fn_set_cohort_teacher('{cohort}', {value}, "
               f"'{ADMIN}', 'a@x.test')::text, 'null')")
    return json.loads(out.splitlines()[-1])


def _fails(sql: str) -> str:
    with pytest.raises(RuntimeError) as caught:
        psql(sql)
    return str(caught.value)


def test_backfill_takes_the_one_shared_teacher_and_names_the_rest(schema):
    notices = _migrate(schema)
    assert _teacher(schema, SAME) == T1           # inactive member's T2 is ignored
    assert _teacher(schema, MIXED) == ""          # two teachers: admins only
    assert _teacher(schema, NONE) == ""
    assert _teacher(schema, EMPTY) == ""
    assert _teacher(schema, ARCHIVED) == ""       # archived classes are not filled
    for name in ("Lớp hai giáo viên", "Lớp chưa có giáo viên", "Lớp trống"):
        assert f"cohort_teacher_unset: {name}" in notices
    assert "Lớp một giáo viên" not in notices
    # Nobody is assigned by default (Q35): no class went to the admin.
    assert psql(f"SELECT count(*) FROM {schema}.cohorts WHERE instructor_id='{ADMIN}'") == "0"


def test_rerun_keeps_a_teacher_set_by_an_admin(schema):
    _migrate(schema)
    _set(schema, MIXED, T2)
    _migrate(schema)
    assert _teacher(schema, MIXED) == T2 and _teacher(schema, SAME) == T1


def test_teacher_change_logs_once_and_a_repeat_writes_nothing(schema):
    _migrate(schema)
    assert _set(schema, MIXED, T2)["status"] == "changed"
    assert _set(schema, MIXED, T2)["status"] == "unchanged"
    assert _set(schema, SAME, None) == {"status": "changed", "instructor_id": None, "previous_instructor_id": T1}
    rows = psql(f"SELECT cohort_id || '|' || details::text || '|' || actor_user_id FROM {schema}.class_action_log "
                f"WHERE action='cohort_teacher_change' ORDER BY created_at").splitlines()
    assert len(rows) == 2
    cohort, details, actor = rows[0].split("|")
    assert cohort == MIXED and actor == ADMIN
    assert json.loads(details) == {"old_instructor_id": None, "new_instructor_id": T2}
    assert _set(schema, "c0000000-0000-0000-0000-0000000000ff", T1) is None  # unknown class


def test_schedule_columns_and_shape(schema):
    _migrate(schema)
    psql(f"""UPDATE {schema}.cohorts SET weekly_schedule='[{{"dow":2,"start":"19:30"}}]', start_date='2026-12-01'
             WHERE id='{SAME}'; UPDATE {schema}.class_lessons SET starts_at='19:30'""")
    assert "cohorts_weekly_schedule_shape" in _fails(
        f"UPDATE {schema}.cohorts SET weekly_schedule='{{\"dow\":2}}' WHERE id='{SAME}'")


def _set_action_check(s: str, actions: str) -> None:
    psql(f"ALTER TABLE {s}.class_action_log DROP CONSTRAINT class_action_log_action_check; "
         f"ALTER TABLE {s}.class_action_log ADD CONSTRAINT class_action_log_action_check CHECK (action IN ({actions}))")


def _action_check(s: str) -> str:
    return psql(f"SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='class_action_log_action_check' "
                f"AND conrelid='{s}.class_action_log'::regclass")


def test_the_378_action_list_is_extended_and_restored(schema):
    # The full-chain harness applies 378 (never applied on hosted databases).
    _set_action_check(schema, "'due_change','return_work','exercise_book_assign','exercise_book_close'")
    _migrate(schema)
    assert "'exercise_book_close'::text, 'cohort_teacher_change'::text])" in _action_check(schema)
    _migrate(schema)   # re-run
    psql(ROLLBACK_SQL.replace("public.", f"{schema}."))
    assert "'exercise_book_close'::text])" in _action_check(schema)
    assert "cohort_teacher_change" not in _action_check(schema)


def test_drift_guard_refuses_an_unknown_action_check(schema):
    _set_action_check(schema, "'due_change','return_work','something_else'")
    with pytest.raises(RuntimeError) as caught:
        _migrate(schema)
    assert "cohort_teacher_action_check_drift" in str(caught.value)
    # Nothing of 441 stayed behind (one transaction).
    assert psql(f"SELECT count(*) FROM information_schema.columns WHERE table_schema='{schema}' "
                f"AND table_name='cohorts' AND column_name='instructor_id'") == "0"


def test_client_roles_cannot_set_a_teacher(schema):
    _migrate(schema)
    for role in ("anon", "authenticated"):
        assert "permission denied" in _fails(
            f"SET ROLE {role}; SELECT {schema}.fn_set_cohort_teacher('{SAME}', NULL, NULL, NULL)")


def test_rollback_on_a_fresh_install_and_refusal_after_a_change(schema):
    _migrate(schema)
    psql(ROLLBACK_SQL.replace("public.", f"{schema}."))
    assert psql(f"SELECT count(*) FROM information_schema.columns WHERE table_schema='{schema}' "
                f"AND table_name='cohorts' AND column_name='instructor_id'") == "0"
    assert "'due_change'::text, 'return_work'::text])" in _action_check(schema)

    _migrate(schema)
    _set(schema, NONE, T1)
    assert "keep schema 441 and roll forward" in _fails(ROLLBACK_SQL.replace("public.", f"{schema}."))
    assert _teacher(schema, NONE) == T1
