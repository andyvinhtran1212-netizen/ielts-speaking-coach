"""F09 (ACTIVATELIMIT-0034) — /auth/activate rate limit shared through Postgres.

`routers.auth._rate_limit_activate` calls migration 334's
`fn_activate_attempt_check` before the access code is looked up or claimed:

- AC1/AC2: the real backend function, in three separate Python processes
  against a real local PostgreSQL with 334 applied, allows exactly 10 attempts
  and refuses the rest even when the calls overlap inside the RPC (a lock-less
  copy over-allows under the same choreography); after the window an attempt
  is allowed again.
- AC3: any RPC failure or malformed answer is 503 `activation_unavailable`,
  and nothing after the check (code lookup, claim) runs.
- AC4: a refusal is 429 {error_code, retry_after_s} + Retry-After, and the code
  is never touched.
- AC5: Step 1c (archived profile) still refuses without consuming the code.

The PostgreSQL half needs TEST_PG_URL (LOCAL disposable cluster); REQUIRE_PG=1
forbids skipping it.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import test_admin_students_archive as archive
import test_migration_334_activate_attempt_rate_limit as m334

BACKEND = Path(__file__).resolve().parents[1]
USER_ID = "00000000-0000-0000-0000-0000000000f9"
RATE_LIMITED = "Quá nhiều lần thử kích hoạt. Vui lòng đợi vài phút rồi thử lại."

pytestmark = pytest.mark.usefixtures("live_activate_rate_limit")


class _LimiterOnly:
    """A Supabase stand-in that answers only the rate-limit RPC. Any table read
    means activation went past a refused or failed check."""

    def __init__(self, result):
        self.result, self.rpcs, self.tables = result, [], []

    def rpc(self, name, params):
        self.rpcs.append((name, params))
        result = self.result
        execute = MagicMock()
        if isinstance(result, Exception):
            execute.side_effect = result
        else:
            execute.return_value = MagicMock(data=result)
        return MagicMock(execute=execute)

    def table(self, name):
        self.tables.append(name)
        raise AssertionError(f"activation reached table {name!r}")


def _post(db, *, user_id: str = USER_ID):
    from main import app
    from routers import auth
    user = AsyncMock(return_value={"id": user_id, "email": "l@x", "user_metadata": {}})
    with patch.object(auth, "get_supabase_user", new=user), patch.object(auth, "supabase_admin", db):
        return TestClient(app, raise_server_exceptions=False).post(
            "/auth/activate", json={"access_code": "newcode1"},
            headers={"Authorization": "Bearer fake.jwt"})


# ── AC4: refusal before the code is touched ─────────────────────────────────

def test_refusal_is_429_with_error_code_retry_after_and_no_code_lookup():
    db = _LimiterOnly({"allowed": False, "retry_after_s": 42})
    r = _post(db)
    assert r.status_code == 429, r.text
    assert r.json()["detail"] == {"error_code": "activate_rate_limited", "retry_after_s": 42,
                                  "message": RATE_LIMITED}
    assert r.headers["Retry-After"] == "42"
    assert db.rpcs == [("fn_activate_attempt_check", {"p_user_id": USER_ID})]
    assert db.tables == [], "the code was never looked up, so it cannot be claimed"


def test_refusal_retry_after_is_at_least_one_second():
    r = _post(_LimiterOnly({"allowed": False, "retry_after_s": 0}))
    assert r.status_code == 429
    assert r.json()["detail"]["retry_after_s"] == 1 and r.headers["Retry-After"] == "1"


def test_unauthenticated_request_records_no_attempt():
    from main import app
    from routers import auth
    db = _LimiterOnly({"allowed": True, "retry_after_s": 0})
    with patch.object(auth, "get_supabase_user",
                      new=AsyncMock(side_effect=HTTPException(401, "no"))), \
            patch.object(auth, "supabase_admin", db):
        r = TestClient(app).post("/auth/activate", json={"access_code": "X"},
                                 headers={"Authorization": "Bearer bad"})
    assert r.status_code == 401
    assert db.rpcs == []


# ── AC3: fail closed ────────────────────────────────────────────────────────

@pytest.mark.parametrize("result", [
    RuntimeError("could not connect to server"),
    None,
    {},
    [{"allowed": True, "retry_after_s": 0}],
    {"allowed": "true", "retry_after_s": 0},
    {"allowed": 1, "retry_after_s": 0},
    {"allowed": True},
    {"allowed": False, "retry_after_s": True},
    {"allowed": False, "retry_after_s": 1.5},
    {"allowed": False, "retry_after_s": -1},
    {"allowed": None, "retry_after_s": 0},
    {"retry_after_s": 0},
    {"allowed": True, "retry_after_s": None},
    {"allowed": True, "retry_after_s": "0"},
    {"allowed": True, "retry_after_s": False},
    {"allowed": True, "retry_after_s": 0.0},
    {"allowed": True, "retry_after_s": -1},
], ids=["db_error", "null", "empty", "list", "string_bool", "int_bool", "no_retry",
        "bool_retry", "float_retry", "negative_retry", "null_allowed", "no_allowed",
        "allowed_null_retry", "allowed_string_retry", "allowed_bool_retry",
        "allowed_float_retry", "allowed_negative_retry"])
def test_check_failure_is_503_activation_unavailable_and_nothing_else_runs(result):
    db = _LimiterOnly(result)
    r = _post(db)
    assert r.status_code == 503, r.text
    detail = r.json()["detail"]
    assert detail["error_code"] == "activation_unavailable"
    assert "CHƯA được sử dụng" in detail["message"]
    assert detail["ref"]
    assert "Retry-After" not in r.headers
    assert db.tables == [], "no code lookup or claim after a failed check"


# ── AC5: allowed attempts continue to the unchanged steps ───────────────────

def test_allowed_attempt_reaches_step_1c_and_archived_profile_still_consumes_nothing():
    db = archive.FakeDB(
        {"access_codes": [archive._code_row()],
         "users": [{"id": archive.USER_ID, "is_active": False}],
         "students": [archive._row(archive.ARCHIVED_ID, archived=True, user_id=archive.USER_ID)]},
        rpc_results={"fn_activate_attempt_check": {"allowed": True, "retry_after_s": 0}})
    with pytest.raises(HTTPException) as error:
        archive._activate(db)
    assert error.value.status_code == 403
    assert "lưu trữ" in error.value.detail
    assert db.rpcs == [("fn_activate_attempt_check", {"p_user_id": archive.USER_ID})]
    assert db.calls[0][0] == "access_codes", "the code lookup follows the check"
    assert db.writes() == []
    assert db.tables["access_codes"][0]["is_used"] is False


def test_in_memory_counter_is_gone():
    from routers import auth
    assert not hasattr(auth, "_activate_attempts")
    source = (BACKEND / "routers" / "auth.py").read_text(encoding="utf-8")
    body = source[source.index("async def activate_account("):]
    # The check is the first thing after authentication.
    assert body.index("_rate_limit_activate(user_id)") < body.index('table("access_codes")')


# ── AC1/AC2: real backend code, three processes, one Postgres counter ───────
#
# Each worker is a separate Python process running the real
# `auth._rate_limit_activate`; its Supabase stand-in sends the RPC to the local
# database through psql (one connection per call, tagged with PGAPPNAME). The
# worker makes one call per line the test writes on its stdin, so the test is
# the barrier: every round, all workers are released together.
#
# Calls released together still rarely overlap inside the function, so a
# test-only BEFORE INSERT trigger parks each attempt on a gate (an advisory
# lock the test holds) after the window was counted and before the row is
# written. The test releases the gate only once every worker's call is parked
# on an advisory lock. With the per-user lock, one call is parked on the gate
# and the others wait for that lock (they have not counted yet); without it,
# every call has counted the same window. The function itself is unchanged.

_WORKER = r"""
import json, subprocess, sys
from fastapi import HTTPException
from routers import auth

url, user, function = sys.argv[1], sys.argv[2], sys.argv[3]


class _Psql:
    def rpc(self, name, params):
        assert name == "fn_activate_attempt_check", name
        query = f"SET ROLE service_role; SELECT public.{function}('{params['p_user_id']}')"
        class _Call:
            def execute(self):
                out = subprocess.run(["psql", url, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", query],
                                     capture_output=True, text=True, check=True, timeout=300).stdout
                class _Result: data = json.loads(out)
                return _Result()
        return _Call()


auth.supabase_admin = _Psql()
for _ in sys.stdin:
    try:
        auth._rate_limit_activate(user)
        result = {"status": 200}
    except HTTPException as e:
        result = {"status": e.status_code, "detail": e.detail, "headers": e.headers}
    print(json.dumps(result), flush=True)
"""

FN = "fn_activate_attempt_check"
NOLOCK = f"{FN}_nolock"
GATE = 334_095          # advisory key of the test-held insert gate
WORKERS, ROUNDS = 3, 4  # 12 calls; the 10th is the first of round 4


@pytest.fixture(scope="module")
def pg_db():
    m334._require_pg()
    database = m334._new_database("act334_be")
    try:
        m334._apply(database, m334.SQL)
        # Negative control: the migration's function without its per-user lock.
        body = m334._function_body()
        lock = re.search(r"\n\s*PERFORM pg_catalog\.pg_advisory_xact_lock\([^;]*;", body)
        assert lock, "migration 334's function lost its per-user advisory lock"
        m334._apply(database, body.replace(lock.group(0), "").replace(
            f"public.{FN}(p_user_id uuid)", f"public.{NOLOCK}(p_user_id uuid)")
            + f"END $$;\nGRANT EXECUTE ON FUNCTION public.{NOLOCK}(uuid) TO service_role;")
        m334.sql(database, f"""
            CREATE FUNCTION public.act334_test_insert_gate() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                PERFORM pg_catalog.pg_advisory_xact_lock_shared({GATE});
                RETURN NEW;
            END $$;
            CREATE TRIGGER act334_test_insert_gate BEFORE INSERT ON public.activation_attempts
                FOR EACH ROW EXECUTE FUNCTION public.act334_test_insert_gate();""")
        yield database
    finally:
        m334._drop_database(database)


class _Workers:
    """`count` worker processes for one user, each tagged `act334be_<tag>_w<i>`."""

    def __init__(self, database: str, user: str, count: int, function: str, tmp: Path):
        self.database, self.tag, self.tmp = database, uuid4().hex[:8], tmp
        self.apps = [f"act334be_{self.tag}_w{i}" for i in range(count)]
        self.processes = []
        for app in self.apps:
            env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
            env.update(PYTHONPATH=str(BACKEND), PGAPPNAME=app, PGCONNECT_TIMEOUT="10")
            with (tmp / f"{app}.err").open("w") as err:
                self.processes.append(subprocess.Popen(
                    [sys.executable, "-c", _WORKER, m334._url(database), user, function],
                    cwd=BACKEND, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=err, text=True))

    def _stderr(self, app: str) -> str:
        return (self.tmp / f"{app}.err").read_text()

    def release(self) -> None:
        for process in self.processes:
            process.stdin.write("go\n")
            process.stdin.flush()

    def results(self) -> list[dict]:
        out = []
        for app, process in zip(self.apps, self.processes):
            line = process.stdout.readline()
            assert line.startswith("{"), self._stderr(app)
            out.append(json.loads(line))
        return out

    def call(self) -> list[dict]:
        self.release()
        return self.results()

    def close(self) -> None:
        for process in self.processes:
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
        for app, process in zip(self.apps, self.processes):
            try:
                process.wait(timeout=120)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=60)
            assert process.returncode == 0, self._stderr(app)

    def parked(self, gate_only: bool = False) -> int:
        """How many of this run's calls wait on an advisory lock (or the gate)."""
        gate = (f" AND l.classid = 0 AND l.objid = {GATE} AND l.objsubid = 1" if gate_only else "")
        apps = ", ".join(f"'{app}'" for app in self.apps)
        return int(m334.sql(self.database,
            "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid "
            f"WHERE NOT l.granted AND l.locktype = 'advisory' AND a.application_name IN ({apps})"
            f"{gate}"))


def _gated_round(workers: _Workers) -> tuple[int, list[dict]]:
    """Release every worker once while the insert gate is held; return how many
    calls sat on the gate once all of them were parked, and their results."""
    app = f"act334be_{workers.tag}_gate"
    holder = subprocess.Popen([*m334._psql_args(workers.database, app=app)],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, env=m334._env())
    try:
        holder.stdin.write(f"SELECT pg_advisory_lock({GATE});\nSELECT pg_sleep(600);\n")
        holder.stdin.flush()
        m334._wait_for(workers.database, f"application_name = '{app}' AND wait_event = 'PgSleep'")
        workers.release()
        deadline = time.monotonic() + 180
        while workers.parked() < len(workers.apps):
            assert time.monotonic() < deadline, "the workers' calls never all parked"
            time.sleep(0.2)
        on_gate = workers.parked(gate_only=True)
    finally:
        # End the holder's backend: a killed psql client would leave it
        # sleeping with the gate.
        m334.sql(workers.database, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                                   f"WHERE application_name = '{app}'")
        if holder.poll() is None:
            holder.kill()
        holder.communicate(timeout=60)
    return on_gate, workers.results()


def _gated_burst(database: str, function: str, tmp: Path) -> tuple[str, list[int], list[dict]]:
    user = str(uuid4())
    workers = _Workers(database, user, WORKERS, function, tmp)
    gates, results = [], []
    try:
        for _ in range(ROUNDS):
            on_gate, round_results = _gated_round(workers)
            gates.append(on_gate)
            results += round_results
    finally:
        workers.close()
    return user, gates, results


def test_eleventh_attempt_from_overlapping_processes_is_429_then_allowed_after_the_window(
        pg_db, tmp_path):
    user, gates, results = _gated_burst(pg_db, FN, tmp_path)
    assert len(results) == WORKERS * ROUNDS
    assert sum(r["status"] == 200 for r in results) == 10
    # Every round really overlapped: one call held the per-user lock (parked on
    # the gate after counting) while the other two waited for it.
    assert gates == [1] * ROUNDS
    refused = [r for r in results if r["status"] != 200]
    assert len(refused) == 2
    for r in refused:
        assert r["status"] == 429
        assert r["detail"]["error_code"] == "activate_rate_limited"
        assert 1 <= r["detail"]["retry_after_s"] <= 600
        assert r["headers"] == {"Retry-After": str(r["detail"]["retry_after_s"])}
    # A refused attempt is not recorded.
    assert m334._rows(pg_db, user) == 10

    # AC2: once the attempts leave the 10-minute window, a new one is allowed.
    m334.sql(pg_db, "UPDATE public.activation_attempts SET attempted_at = attempted_at "
                    f"- interval '10 minutes 1 second' WHERE user_id = '{user}'")
    single = _Workers(pg_db, user, 1, FN, tmp_path)
    try:
        assert single.call() == [{"status": 200}]
    finally:
        single.close()


def test_negative_control_the_same_choreography_over_allows_without_the_lock(pg_db, tmp_path):
    """Proves the test above can fail: with the lock removed, all three calls of
    a round count the same window, and round 4 lets 12 attempts through."""
    user, gates, results = _gated_burst(pg_db, NOLOCK, tmp_path)
    assert [r["status"] for r in results] == [200] * WORKERS * ROUNDS
    assert gates == [WORKERS] * ROUNDS
    assert m334._rows(pg_db, user) == WORKERS * ROUNDS > 10


def test_rpc_error_is_503_from_the_real_function(pg_db, tmp_path):
    """The real RPC errors (here: EXECUTE revoked) → 503, nothing recorded."""
    user = str(uuid4())
    m334.sql(pg_db, "REVOKE EXECUTE ON FUNCTION public.fn_activate_attempt_check(uuid) FROM service_role")
    single = _Workers(pg_db, user, 1, FN, tmp_path)
    try:
        results = single.call()
    finally:
        single.close()
        m334.sql(pg_db, "GRANT EXECUTE ON FUNCTION public.fn_activate_attempt_check(uuid) TO service_role")
    assert results[0]["status"] == 503
    assert results[0]["detail"]["error_code"] == "activation_unavailable"
    assert m334._rows(pg_db, user) == 0
