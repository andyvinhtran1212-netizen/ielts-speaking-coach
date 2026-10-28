"""Migration 334 (ACTIVATELIMIT-0034, F09): shared /auth/activate rate limit.

`public.fn_activate_attempt_check(uuid)` counts ALLOWED attempts in
`public.activation_attempts` and allows 10 per rolling 10 minutes per user. A
per-user transaction advisory lock makes the count-then-insert atomic across
connections (= across backend workers and replicas).

The static half always runs. The PostgreSQL half creates a disposable database
on the LOCAL cluster in TEST_PG_URL, mimics hosted Supabase (a NOSUPERUSER
migration runner whose default privileges grant ALL on new tables and functions
to anon/authenticated/service_role) and applies 334 twice. It proves the
grants, the 11th-call refusal across two processes (and, with a lock-less copy
of the function as negative control, that the choreography really detects the
race), window expiry, pruning, idempotent re-run, the rollback note and the
postcondition DO block.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import pytest

BACKEND = Path(__file__).resolve().parents[1]
NAME = "334_activate_attempt_rate_limit.sql"
SQL = (BACKEND / "migrations" / NAME).read_text(encoding="utf-8")
FN = "public.fn_activate_attempt_check"
OWNER = "act334_runner"
DB_URL = os.environ.get("TEST_PG_URL", "")


def _strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


CODE = _strip_comments(SQL)


def _function_body() -> str:
    start = CODE.index(f"CREATE OR REPLACE FUNCTION {FN}(p_user_id uuid)")
    return CODE[start:CODE.index("END $$;", start)]


def _postcondition() -> str:
    start = CODE.rindex("DO $$")
    return CODE[start:CODE.index("END $$;", start) + len("END $$;")]


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_destructive_ddl():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    outside_fn = CODE.replace(_function_body(), "")
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"^\s*TRUNCATE\b", r"^\s*UPDATE\s",
                      r"INSERT\s+INTO"):
        assert not re.search(forbidden, outside_fn, re.M | re.I), forbidden


def test_function_is_pinned_definer_and_service_role_only():
    assert ("RETURNS jsonb\nLANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$"
            in CODE)
    assert (f"REVOKE ALL ON FUNCTION {FN}(uuid)\n    FROM PUBLIC, anon, authenticated;" in CODE)
    assert f"GRANT EXECUTE ON FUNCTION {FN}(uuid) TO service_role;" in CODE
    assert ("REVOKE ALL ON TABLE public.activation_attempts FROM PUBLIC, anon, authenticated, "
            "service_role;" in CODE)


def test_lock_is_taken_before_the_window_is_read_and_limit_is_10_per_10_minutes():
    body = _function_body()
    assert "c_max    CONSTANT integer  := 10;" in body
    assert "c_window CONSTANT interval := interval '10 minutes';" in body
    assert "c_keep   CONSTANT interval := interval '1 day';" in body
    lock = body.index("pg_catalog.pg_advisory_xact_lock(")
    assert lock < body.index("v_now := pg_catalog.clock_timestamp();")
    assert lock < body.index("SELECT count(*) INTO v_count")
    assert lock < body.index("INSERT INTO public.activation_attempts")
    # A refused call records nothing: the only INSERT follows the refusal return.
    assert body.count("INSERT INTO") == 1
    assert body.index("RETURN pg_catalog.jsonb_build_object(\n            'allowed', false") < (
        body.index("INSERT INTO"))


def test_postconditions_cover_grants_definer_index_rls_and_owner():
    post = _postcondition()
    for marker in ("activate_attempt_objects_missing", "activate_attempt_index_missing",
                   "activate_attempt_rls_disabled", "activate_attempt_table_client_privilege",
                   "activate_attempt_check_client_executable",
                   "activate_attempt_check_public_executable",
                   "activate_attempt_check_not_service_executable",
                   "activate_attempt_check_not_pinned_security_definer",
                   "activate_attempt_check_owner_subject_to_rls"):
        assert marker in post, marker
    assert "service_role_missing" in CODE[:CODE.index("CREATE TABLE")]


def test_rollback_note_drops_function_then_table():
    note = _rollback_sql()
    assert note.index("DROP FUNCTION IF EXISTS") < note.index("DROP TABLE IF EXISTS")
    assert "SET LOCAL lock_timeout = '5s';" in note


def _rollback_sql() -> str:
    header = SQL[SQL.index("-- ROLLBACK"):SQL.index("\nBEGIN;\n")]
    return "\n".join(line[5:] for line in header.splitlines()
                     if line.startswith("--   ") and not line.startswith("--   SELECT")
                     and "FROM pg_proc" not in line and "has_function" not in line)


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _url(database: str) -> str:
    parsed = urlparse(DB_URL)
    if (parsed.scheme not in {"postgres", "postgresql"}
            or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.query):
        raise RuntimeError("Migration tests require a local disposable database URL without query overrides")
    return parsed._replace(path=f"/{database}").geturl()


def _env() -> dict:
    # Never let PGHOST/PGSERVICE/PGOPTIONS from the shell redirect the fixture.
    env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    env["PGCONNECT_TIMEOUT"] = "10"
    return env


def _psql_args(database: str, *, app: str = "act334") -> list[str]:
    url = _url(database)
    url += ("&" if "?" in url else "?") + f"application_name={app}"
    return ["psql", url, "-X", "-v", "ON_ERROR_STOP=1", "-tAq"]


def sql(database: str, query: str, *, timeout: int = 60) -> str:
    result = subprocess.run([*_psql_args(database), "-c", query], capture_output=True,
                            text=True, timeout=timeout, env=_env())
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def _apply(database: str, text: str) -> None:
    """Run a migration-shaped script as the NOSUPERUSER runner (hosted shape)."""
    result = subprocess.run([*_psql_args(database), "-f", "-"],
                            input=f"SET ROLE {OWNER};\n{text}", capture_output=True,
                            text=True, timeout=120, env=_env())
    if result.returncode:
        raise RuntimeError(result.stderr)


def _svc(database: str, query: str) -> str:
    return sql(database, f"SET ROLE service_role; {query}")


def check(database: str, user: str) -> dict:
    return json.loads(_svc(database, f"SELECT {FN}('{user}')"))


def _require_pg() -> None:
    try:
        available = bool(shutil.which("psql")) and sql("postgres", "SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 334 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if sql("postgres", "SELECT usesuper FROM pg_user WHERE usename = current_user") != "t":
        pytest.fail("Migration 334 fixture requires a superuser on its disposable LOCAL cluster")
    sql("postgres", f"""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{OWNER}') THEN
        CREATE ROLE {OWNER} NOSUPERUSER NOBYPASSRLS NOLOGIN;
      END IF;
    END $$;""")
    sql("postgres", "ALTER ROLE service_role BYPASSRLS")


def _new_database(prefix: str) -> str:
    database = f"{prefix}_{uuid4().hex[:12]}"
    sql("postgres", f"CREATE DATABASE {database}")
    sql(database, f"""
        GRANT USAGE, CREATE ON SCHEMA public TO {OWNER};
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES FOR ROLE {OWNER} IN SCHEMA public
            GRANT ALL ON TABLES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES FOR ROLE {OWNER} IN SCHEMA public
            GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES FOR ROLE {OWNER} IN SCHEMA public
            GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;""")
    return database


def _drop_database(database: str) -> None:
    sql("postgres", f"DROP DATABASE IF EXISTS {database} WITH (FORCE)")


@pytest.fixture(scope="module")
def db():
    _require_pg()
    database = _new_database("act334")
    try:
        _apply(database, SQL)
        _apply(database, SQL)  # re-running is a no-op
        # Negative control: the same function WITHOUT the per-user lock.
        body = _function_body()
        lock = re.search(r"\n\s*PERFORM pg_catalog\.pg_advisory_xact_lock\([^;]*;", body)
        assert lock
        nolock = (body.replace(lock.group(0), "")
                  .replace(f"{FN}(p_user_id uuid)", f"{FN}_nolock(p_user_id uuid)"))
        _apply(database, nolock + "END $$;\nGRANT EXECUTE ON FUNCTION "
               f"{FN}_nolock(uuid) TO service_role;")
        yield database
    finally:
        _drop_database(database)


def _seed(database: str, user: str, *ages: str) -> None:
    """Insert attempts directly (superuser), each `ages` entry an interval ago."""
    if ages:
        values = ", ".join(f"('{user}', clock_timestamp() - interval '{age}')" for age in ages)
        sql(database, f"INSERT INTO public.activation_attempts (user_id, attempted_at) VALUES {values}")


def _rows(database: str, user: str) -> int:
    return int(sql(database, f"SELECT count(*) FROM public.activation_attempts WHERE user_id = '{user}'"))


def _denied(database: str, role: str, query: str) -> str:
    with pytest.raises(RuntimeError) as error:
        sql(database, f"SET ROLE {role}; {query}")
    return str(error.value)


# ── PostgreSQL: catalog, grants, idempotence ────────────────────────────────

def test_catalog_after_double_apply(db):
    assert sql(db, f"SELECT prosecdef, proconfig FROM pg_proc WHERE oid = '{FN}(uuid)'::regprocedure") == (
        't|{"search_path=\\"\\""}')
    assert sql(db, f"SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = '{FN}(uuid)'::regprocedure") == OWNER
    assert sql(db, "SELECT pg_get_userbyid(relowner), relrowsecurity, relforcerowsecurity FROM pg_class "
                   "WHERE oid = 'public.activation_attempts'::regclass") == f"{OWNER}|t|f"
    assert sql(db, "SELECT indexdef FROM pg_indexes WHERE tablename = 'activation_attempts'") == (
        "CREATE INDEX idx_activation_attempts_user_attempted ON public.activation_attempts "
        "USING btree (user_id, attempted_at)")
    assert sql(db, "SELECT count(*) FROM pg_policy WHERE polrelid = 'public.activation_attempts'::regclass") == "0"
    assert sql(db, "SELECT count(*) FROM pg_proc WHERE proname = 'fn_activate_attempt_check'") == "1"


def test_only_service_role_executes_and_clients_cannot_touch_the_table(db):
    user = str(uuid4())
    for role in ("anon", "authenticated"):
        assert sql(db, f"SELECT has_function_privilege('{role}', '{FN}(uuid)', 'EXECUTE')") == "f"
        assert "permission denied for function fn_activate_attempt_check" in _denied(
            db, role, f"SELECT {FN}('{user}')")
        for query in ("SELECT 1 FROM public.activation_attempts",
                      f"INSERT INTO public.activation_attempts (user_id) VALUES ('{user}')",
                      "DELETE FROM public.activation_attempts"):
            assert "permission denied for table activation_attempts" in _denied(db, role, query)
    acl = sql(db, "SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END"
                  " || ':' || a.privilege_type FROM pg_proc p, aclexplode(p.proacl) a"
                  f" WHERE p.oid = '{FN}(uuid)'::regprocedure")
    assert sorted(acl.splitlines()) == [f"{OWNER}:EXECUTE", "service_role:EXECUTE"]
    # service_role: execute + read only; it cannot write around the limiter.
    assert check(db, user)["allowed"] is True
    assert _svc(db, f"SELECT count(*) FROM public.activation_attempts WHERE user_id = '{user}'") == "1"
    for query in (f"INSERT INTO public.activation_attempts (user_id) VALUES ('{user}')",
                  f"DELETE FROM public.activation_attempts WHERE user_id = '{user}'"):
        assert "permission denied for table activation_attempts" in _denied(db, "service_role", query)


def test_re_apply_keeps_existing_attempts(db):
    user = str(uuid4())
    for _ in range(3):
        check(db, user)
    _apply(db, SQL)
    assert _rows(db, user) == 3
    assert sql(db, "SELECT count(*) FROM pg_indexes WHERE tablename = 'activation_attempts'") == "1"


# ── PostgreSQL: limit behaviour ─────────────────────────────────────────────

def test_ten_allowed_then_eleventh_refused_and_refusal_records_nothing(db):
    user, other = str(uuid4()), str(uuid4())
    results = [check(db, user) for _ in range(10)]
    assert results == [{"allowed": True, "retry_after_s": 0}] * 10
    refused = check(db, user)
    assert refused["allowed"] is False
    assert 595 <= refused["retry_after_s"] <= 600
    assert _rows(db, user) == 10
    for _ in range(5):
        assert check(db, user)["allowed"] is False
    assert _rows(db, user) == 10, "a refused call must not grow the table"
    assert check(db, other)["allowed"] is True, "the limit is per user"


def test_window_expiry_allows_again(db):
    user = str(uuid4())
    _seed(db, user, *["10 minutes 1 second"] * 10)
    assert check(db, user) == {"allowed": True, "retry_after_s": 0}

    near = str(uuid4())
    _seed(db, near, *["9 minutes"] * 10)
    refused = check(db, near)
    assert refused["allowed"] is False and 59 <= refused["retry_after_s"] <= 61


def test_retry_after_names_the_moment_a_slot_frees(db):
    # 11 in-window rows (e.g. written before a clock step): the 2nd oldest frees
    # the slot, not the oldest.
    user = str(uuid4())
    _seed(db, user, "9 minutes 30 seconds", "8 minutes", *["1 minute"] * 9)
    refused = check(db, user)
    assert refused["allowed"] is False and 119 <= refused["retry_after_s"] <= 121


def test_prunes_only_this_users_rows_older_than_one_day(db):
    user, other = str(uuid4()), str(uuid4())
    _seed(db, user, "2 days", "1 day 1 minute", "23 hours")
    _seed(db, other, "3 days")
    assert check(db, user)["allowed"] is True
    assert _rows(db, user) == 2  # the 23-hour row + the new one
    assert _rows(db, other) == 1


def test_null_user_and_non_read_committed_callers_fail_instead_of_allowing(db):
    assert "activate_attempt_user_required" in _denied(db, "service_role", f"SELECT {FN}(NULL)")
    user = str(uuid4())
    with pytest.raises(RuntimeError) as error:
        sql(db, f"BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL ROLE service_role; "
                f"SELECT {FN}('{user}'); COMMIT;")
    assert "activate_attempt_check_requires_read_committed" in str(error.value)
    assert _rows(db, user) == 0


# ── PostgreSQL: atomicity across two connections ────────────────────────────

def _run_async(database: str, app: str, script: str, tmp: Path) -> subprocess.Popen:
    path = tmp / f"{app}.sql"
    path.write_text(script, encoding="utf-8")
    return subprocess.Popen([*_psql_args(database, app=app), "-f", str(path)],
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, env=_env())


def _wait_for(database: str, condition: str, *, timeout: float = 120) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if sql(database, f"SELECT count(*) FROM pg_stat_activity WHERE {condition}") == "1":
            return
        time.sleep(0.2)
    raise AssertionError(f"never observed: {condition}")


def _finish(process: subprocess.Popen, *, timeout: float = 180) -> str:
    out, err = process.communicate(timeout=timeout)
    assert process.returncode == 0, err
    return out.strip()


def _race(database: str, function: str, tmp: Path) -> tuple[dict, dict, int]:
    """Two connections take the 10th and 11th slot. A has inserted its
    attempt but not committed (it waits on a test-held gate) while B runs."""
    user, gate = str(uuid4()), 334_000 + int(uuid4().int % 1000)
    for _ in range(9):
        assert check(database, user)["allowed"] is True
    tag = uuid4().hex[:8]
    holder = subprocess.Popen([*_psql_args(database, app=f"act334_gate_{tag}")],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, env=_env())
    try:
        holder.stdin.write(f"SELECT pg_advisory_lock({gate});\nSELECT pg_sleep(600);\n")
        holder.stdin.flush()
        _wait_for(database, f"application_name = 'act334_gate_{tag}' AND wait_event = 'PgSleep'")
        a = _run_async(database, f"act334_a_{tag}",
                       f"BEGIN;\nSET LOCAL ROLE service_role;\nSELECT {function}('{user}');\n"
                       f"RESET ROLE;\nSELECT pg_advisory_xact_lock_shared({gate}) IS NULL;\nCOMMIT;\n", tmp)
        # A has returned from the function (its row is written, lock still held
        # by its open transaction) and now waits on the gate.
        _wait_for(database, f"application_name = 'act334_a_{tag}' AND wait_event = 'advisory' "
                            f"AND query LIKE '%pg_advisory_xact_lock_shared%'")
        b = _run_async(database, f"act334_b_{tag}",
                       f"SET ROLE service_role;\nSELECT {function}('{user}');\n", tmp)
        if function == FN:
            _wait_for(database, f"application_name = 'act334_b_{tag}' AND wait_event = 'advisory'")
            assert b.poll() is None, "B must wait for A's per-user lock"
        else:
            out_b = _finish(b)   # nothing to wait for: it reads 9 and inserts
        # Release the gate: end the holder's backend (a killed psql client
        # would leave it sleeping with the lock).
        sql(database, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                      f"WHERE application_name = 'act334_gate_{tag}'")
        out_a = _finish(a)
        if function == FN:
            out_b = _finish(b)
    finally:
        if holder.poll() is None:
            holder.kill()
        holder.communicate(timeout=60)
    first_a = json.loads(out_a.splitlines()[0])
    return first_a, json.loads(out_b.splitlines()[-1]), _rows(database, user)


def test_eleventh_call_from_a_second_process_is_refused_while_the_tenth_is_in_flight(db, tmp_path):
    a, b, rows = _race(db, FN, tmp_path)
    assert a == {"allowed": True, "retry_after_s": 0}
    assert b["allowed"] is False and b["retry_after_s"] > 0
    assert rows == 10


def test_negative_control_without_the_lock_lets_the_eleventh_through(db, tmp_path):
    """Proves the race test can fail: the lock-less copy over-allows."""
    a, b, rows = _race(db, f"{FN}_nolock", tmp_path)
    assert a["allowed"] is True and b["allowed"] is True
    assert rows == 11


def test_parallel_burst_from_two_processes_allows_exactly_ten(db, tmp_path):
    user = str(uuid4())
    script = "SET ROLE service_role;\n" + f"SELECT {FN}('{user}');\n" * 8
    processes = [_run_async(db, f"act334_burst_{i}", script, tmp_path) for i in range(2)]
    outputs = [_finish(process) for process in processes]
    results = [json.loads(line) for out in outputs for line in out.splitlines()]
    assert len(results) == 16
    assert sum(result["allowed"] for result in results) == 10
    assert _rows(db, user) == 10


# ── PostgreSQL: postcondition and rollback ──────────────────────────────────

@pytest.mark.parametrize(("breakage", "marker"), [
    (f"GRANT EXECUTE ON FUNCTION {FN}(uuid) TO anon", "activate_attempt_check_client_executable"),
    (f"GRANT EXECUTE ON FUNCTION {FN}(uuid) TO PUBLIC", "activate_attempt_check_public_executable"),
    (f"REVOKE EXECUTE ON FUNCTION {FN}(uuid) FROM service_role",
     "activate_attempt_check_not_service_executable"),
    ("GRANT SELECT ON public.activation_attempts TO authenticated",
     "activate_attempt_table_client_privilege"),
    ("ALTER TABLE public.activation_attempts DISABLE ROW LEVEL SECURITY", "activate_attempt_rls_disabled"),
    ("DROP INDEX public.idx_activation_attempts_user_attempted", "activate_attempt_index_missing"),
    (f"ALTER FUNCTION {FN}(uuid) RESET search_path",
     "activate_attempt_check_not_pinned_security_definer"),
    ("ALTER TABLE public.activation_attempts FORCE ROW LEVEL SECURITY",
     "activate_attempt_check_owner_subject_to_rls"),
])
def test_postcondition_rejects_an_unsafe_state(db, breakage, marker):
    with pytest.raises(RuntimeError) as error:
        sql(db, f"BEGIN; {breakage}; {_postcondition()} ROLLBACK;")
    assert marker in str(error.value)
    sql(db, _postcondition())  # the real state still passes


def test_rollback_note_removes_everything_and_re_apply_restores_it():
    _require_pg()
    database = _new_database("act334_rb")
    try:
        _apply(database, SQL)
        _apply(database, _rollback_sql())
        assert sql(database, "SELECT to_regclass('public.activation_attempts') IS NULL, "
                             f"to_regprocedure('{FN}(uuid)') IS NULL") == "t|t"
        _apply(database, SQL)
        assert check(database, str(uuid4()))["allowed"] is True
    finally:
        _drop_database(database)
