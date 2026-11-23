"""Migration 388 (COURSEACCESS-0055 T009): learner_active_sessions.

Runs the committed SQL on a LOCAL disposable PostgreSQL (TEST_PG_URL; with
REQUIRE_PG=1 a missing cluster is a failure, not a skip), transplanted from
``public`` into one random schema per test. Checks what the migration
promises: re-runnable, RLS on with no policy, client roles see nothing,
service_role may only SELECT and INSERT (the gate's first-row insert with ON
CONFLICT DO NOTHING), the CHECKs, the users FK cascade, no address/location
column, the per-account lock and its seven timed-start triggers (each start
write takes the lock; a learner start whose account changed session while it
waited is refused; other writes take no lock), and a rollback that refuses
while 389 exists and otherwise drops it. The real claim racing a real start
is in test_session_gate_concurrency_pg.py.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
SQL = (MIGRATIONS / "388_learner_active_sessions.sql").read_text(encoding="utf-8")
ROLLBACK_SQL = (MIGRATIONS / "rollback" / "388_learner_active_sessions.sql").read_text(encoding="utf-8")
USER = "00000000-0000-0000-0000-000000000388"
SESSION_A = "00000000-0000-0000-0000-0000000000a1"
SESSION_B = "00000000-0000-0000-0000-0000000000b2"
STUDENT = "00000000-0000-0000-0000-0000000005d1"
EXAM = "00000000-0000-0000-0000-0000000000e1"


def _available() -> bool:
    try:
        return bool(shutil.which("psql")) and psql("SELECT 1") == "1"
    except Exception:
        return False


@pytest.fixture
def schema():
    if not _available():
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 388 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 388 fixture requires a superuser on its disposable LOCAL cluster")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    name = "learner_sessions_" + uuid4().hex
    psql(f"CREATE SCHEMA {name}")
    psql(f"GRANT USAGE ON SCHEMA {name} TO service_role, anon, authenticated")
    psql(f"CREATE TABLE {name}.users (id uuid PRIMARY KEY); INSERT INTO {name}.users VALUES ('{USER}')")
    psql(_timed_tables(name))
    try:
        yield name
    finally:
        # Only the unique schema this fixture created is removed.
        psql(f"DROP SCHEMA {name} CASCADE")


def _timed_tables(name: str) -> str:
    """The columns of the four timed-work tables the start triggers read."""
    return f"""
    CREATE TABLE {name}.students (id uuid PRIMARY KEY, user_id uuid);
    INSERT INTO {name}.students VALUES ('{STUDENT}', '{USER}');
    CREATE TABLE {name}.reading_test_attempts (id bigserial PRIMARY KEY, user_id uuid NOT NULL,
        status text NOT NULL DEFAULT 'in_progress');
    CREATE TABLE {name}.class_assignment_items (id bigserial PRIMARY KEY, student_id uuid,
        opened_at timestamptz, timed_expires_at timestamptz, submitted_at timestamptz);
    CREATE TABLE {name}.mock_exams (id uuid PRIMARY KEY, listening_started_at timestamptz,
        reading_started_at timestamptz, writing_started_at timestamptz);
    CREATE TABLE {name}.mock_exam_sittings (id bigserial PRIMARY KEY, mock_exam_id uuid, user_id uuid,
        status text, listening_started_at timestamptz, reading_started_at timestamptz,
        writing_started_at timestamptz);
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA {name} TO service_role;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA {name} TO service_role;
    """


def _in(name: str, sql: str) -> str:
    return sql.replace("public.", f"{name}.")


def _migrate(name: str) -> None:
    psql(_in(name, SQL))


def _fails(sql: str) -> str:
    with pytest.raises(RuntimeError) as caught:
        psql(sql)
    return str(caught.value)


def _insert(name: str, session: str = SESSION_A, extra: str = "") -> None:
    cols = "user_id, session_id" + (", " + extra.split("=")[0] if extra else "")
    vals = f"'{USER}', '{session}'" + (", " + extra.split("=", 1)[1] if extra else "")
    psql(f"INSERT INTO {name}.learner_active_sessions ({cols}) VALUES ({vals})")


def test_reruns_and_keeps_rows(schema):
    _migrate(schema)
    _insert(schema)
    _migrate(schema)
    assert psql(f"SELECT session_id FROM {schema}.learner_active_sessions") == SESSION_A
    assert psql(f"SELECT relrowsecurity FROM pg_class WHERE oid='{schema}.learner_active_sessions'::regclass") == "t"
    assert psql(f"SELECT count(*) FROM pg_policy WHERE polrelid='{schema}.learner_active_sessions'::regclass") == "0"


def test_client_roles_have_no_privilege(schema):
    _migrate(schema)
    for role in ("anon", "authenticated"):
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
            assert psql(f"SELECT has_table_privilege('{role}', '{schema}.learner_active_sessions', "
                        f"'{privilege}')") == "f", (role, privilege)
        assert "permission denied" in _fails(
            f"SET ROLE {role}; SELECT * FROM {schema}.learner_active_sessions")


def test_service_role_reads_and_inserts_the_first_row_only(schema):
    _migrate(schema)
    insert = (f"SET ROLE service_role; INSERT INTO {schema}.learner_active_sessions (user_id, session_id, device_label) "
              f"VALUES ('{USER}', '{{sid}}', 'Chrome trên Windows') ON CONFLICT (user_id) DO NOTHING")
    psql(insert.format(sid=SESSION_A))
    psql(insert.format(sid=SESSION_B))  # the race loser changes nothing
    assert psql(f"SET ROLE service_role; SELECT session_id || '|' || device_label "
                f"FROM {schema}.learner_active_sessions") == f"{SESSION_A}|Chrome trên Windows"
    for sql in (f"UPDATE {schema}.learner_active_sessions SET session_id='{SESSION_B}'",
                f"DELETE FROM {schema}.learner_active_sessions",
                f"TRUNCATE {schema}.learner_active_sessions"):
        assert "permission denied" in _fails(f"SET ROLE service_role; {sql}"), sql


def test_checks_and_primary_key(schema):
    _migrate(schema)
    assert "learner_active_sessions_device_label_check" in _fails(
        f"INSERT INTO {schema}.learner_active_sessions (user_id, session_id, device_label) "
        f"VALUES ('{USER}', '{SESSION_A}', repeat('x', 121))")
    assert "learner_active_sessions_displaced_pair_check" in _fails(
        f"INSERT INTO {schema}.learner_active_sessions (user_id, session_id, previous_session_id) "
        f"VALUES ('{USER}', '{SESSION_A}', '{SESSION_B}')")
    assert "learner_active_sessions_previous_differs_check" in _fails(
        f"INSERT INTO {schema}.learner_active_sessions (user_id, session_id, previous_session_id, displaced_at) "
        f"VALUES ('{USER}', '{SESSION_A}', '{SESSION_A}', now())")
    _insert(schema)
    assert "learner_active_sessions_pkey" in _fails(
        f"INSERT INTO {schema}.learner_active_sessions (user_id, session_id) VALUES ('{USER}', '{SESSION_B}')")
    assert "learner_active_sessions_user_id_fkey" in _fails(
        f"INSERT INTO {schema}.learner_active_sessions (user_id, session_id) "
        f"VALUES ('{uuid4()}', '{SESSION_B}')")


def test_deleting_the_user_removes_the_row(schema):
    _migrate(schema)
    _insert(schema)
    psql(f"DELETE FROM {schema}.users WHERE id='{USER}'")
    assert psql(f"SELECT count(*) FROM {schema}.learner_active_sessions") == "0"


def test_no_address_or_location_column(schema):
    _migrate(schema)
    columns = psql(f"SELECT string_agg(column_name, ',') FROM information_schema.columns "
                   f"WHERE table_schema='{schema}' AND table_name='learner_active_sessions'").split(",")
    assert sorted(columns) == sorted([
        "user_id", "session_id", "device_label", "claimed_at",
        "previous_session_id", "displaced_at", "revoke_pending_at",
    ])
    for fragment in ("ip", "addr", "location", "user_agent"):
        assert not [c for c in columns if fragment in c.split("_")], fragment


def test_rollback_refuses_while_389_exists_then_drops(schema):
    _migrate(schema)
    _insert(schema)
    psql(f"CREATE TABLE {schema}.learner_login_events (id bigint)")
    assert "roll back 389 before 388" in _fails(_in(schema, ROLLBACK_SQL))
    assert psql(f"SELECT to_regclass('{schema}.learner_active_sessions') IS NOT NULL") == "t"
    psql(f"DROP TABLE {schema}.learner_login_events")
    psql(_in(schema, ROLLBACK_SQL))
    assert psql(f"SELECT to_regclass('{schema}.learner_active_sessions') IS NULL") == "t"
    assert psql(f"SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
                f"JOIN pg_namespace n ON n.oid = c.relnamespace "
                f"WHERE n.nspname = '{schema}' AND t.tgname LIKE 'trg_learner_session_%'") == "0"
    assert psql(f"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                f"WHERE n.nspname = '{schema}' AND p.proname LIKE 'learner_session_%'") == "0"
    psql(_in(schema, ROLLBACK_SQL))  # idempotent
    _migrate(schema)  # and forward again
    assert psql(f"SELECT count(*) FROM {schema}.learner_active_sessions") == "0"


# ── Per-account lock and timed-start triggers (HOLD FR-040/041) ──────────────

_STARTS = {
    "reading insert": "INSERT INTO {s}.reading_test_attempts (user_id) VALUES ('{u}')",
    "class item open": "INSERT INTO {s}.class_assignment_items (student_id, opened_at, timed_expires_at) "
                       "VALUES ('{st}', now(), now() + interval '30 minutes')",
    "sitting seat": "INSERT INTO {s}.mock_exam_sittings (mock_exam_id, user_id, status) "
                    "VALUES ('{e}', '{u}', 'registered')",
}


def _lock_holder(schema: str):
    """A second session that holds USER's account lock until told to stop."""
    import subprocess
    from test_migration_240_core_attempt_evidence import DB
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    proc = subprocess.Popen(["psql", DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    proc.stdin.write(f"BEGIN; SELECT {schema}.learner_session_lock('{USER}'); SELECT 'locked';\n")
    proc.stdin.flush()
    assert proc.stdout.readline().strip() in ("", "locked")
    return proc


def _waiting_on_advisory() -> str:
    return psql("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted "
                "AND classid = 388")


@pytest.mark.parametrize("start", sorted(_STARTS))
def test_each_timed_start_waits_for_the_account_lock(schema, start):
    import subprocess
    import time
    from test_migration_240_core_attempt_evidence import DB
    _migrate(schema)
    _insert(schema)
    holder = _lock_holder(schema)
    sql = _STARTS[start].format(s=schema, u=USER, st=STUDENT, e=EXAM)
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    starter = subprocess.Popen(["psql", DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    try:
        for _ in range(50):
            if _waiting_on_advisory() == "1":
                break
            time.sleep(0.1)
        assert _waiting_on_advisory() == "1", f"{start} did not wait for the account lock"
        assert starter.poll() is None
    finally:
        holder.stdin.write("COMMIT;\n")
        holder.stdin.close()
        holder.wait(timeout=10)
    assert starter.wait(timeout=10) == 0, starter.stderr.read()


@pytest.mark.parametrize("change", ["claim", "revoke_all", "revoke_pending"])
def test_a_learner_start_that_waited_behind_a_session_change_is_refused(schema, change):
    import subprocess
    import time
    from test_migration_240_core_attempt_evidence import DB
    _migrate(schema)
    _insert(schema)
    holder = _lock_holder(schema)
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    sql = _STARTS["reading insert"].format(s=schema, u=USER)
    starter = subprocess.Popen(["psql", DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    for _ in range(50):
        if _waiting_on_advisory() == "1":
            break
        time.sleep(0.1)
    change_sql = {
        "claim": f"UPDATE {schema}.learner_active_sessions SET session_id = '{SESSION_B}', claimed_at = now(), "
                 f"previous_session_id = '{SESSION_A}', displaced_at = now();",
        "revoke_all": f"DELETE FROM {schema}.learner_active_sessions;",
        "revoke_pending": f"UPDATE {schema}.learner_active_sessions SET revoke_pending_at = now();",
    }[change]
    holder.stdin.write(change_sql + " COMMIT;\n")
    holder.stdin.close()
    holder.wait(timeout=10)
    assert starter.wait(timeout=10) != 0
    assert "learner_session_changed_during_timed_start" in starter.stderr.read()
    assert psql(f"SELECT count(*) FROM {schema}.reading_test_attempts") == "0"


def test_unchanged_account_and_non_start_writes_pass(schema):
    _migrate(schema)
    _insert(schema)
    psql(_STARTS["reading insert"].format(s=schema, u=USER))
    # Not starts: a finished attempt, a submit, an untimed item, a closed sitting.
    psql(f"INSERT INTO {schema}.reading_test_attempts (user_id, status) VALUES ('{USER}', 'completed')")
    psql(f"UPDATE {schema}.reading_test_attempts SET status = 'completed'")
    psql(f"INSERT INTO {schema}.class_assignment_items (student_id) VALUES ('{STUDENT}')")
    psql(f"INSERT INTO {schema}.mock_exam_sittings (mock_exam_id, user_id, status) VALUES ('{EXAM}', '{USER}', 'done')")
    psql(f"INSERT INTO {schema}.mock_exams (id) VALUES ('{EXAM}')")
    # A teacher opening a section locks seated learners but is never refused.
    psql(f"INSERT INTO {schema}.mock_exam_sittings (mock_exam_id, user_id, status) "
         f"VALUES ('{EXAM}', '{USER}', 'lrw_in_progress')")
    psql(f"UPDATE {schema}.mock_exams SET listening_started_at = now()")
    # An account with no row (flag never used) starts normally.
    psql(f"DELETE FROM {schema}.learner_active_sessions")
    psql(_STARTS["class item open"].format(s=schema, st=STUDENT))
    assert psql(f"SELECT count(*) FROM {schema}.class_assignment_items WHERE timed_expires_at IS NOT NULL") == "1"


def test_lock_functions_are_not_callable_by_client_or_service_roles(schema):
    _migrate(schema)
    for role in ("anon", "authenticated", "service_role"):
        for fn in ("learner_session_lock(uuid)", "learner_session_guard_start(uuid, boolean)"):
            assert psql(f"SELECT has_function_privilege('{role}', '{schema}.{fn}', 'EXECUTE')") == "f", (role, fn)
    # service_role (PostgREST) still starts timed work: the trigger runs as owner.
    psql(f"SET ROLE service_role; INSERT INTO {schema}.reading_test_attempts (user_id) VALUES ('{USER}')")
