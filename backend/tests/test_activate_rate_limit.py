"""F09 (ACTIVATELIMIT-0034) — /auth/activate rate limit shared through Postgres.

`routers.auth._rate_limit_activate` calls migration 334's
`fn_activate_attempt_check` before the access code is looked up or claimed:

- AC1/AC2: the real backend function, in two separate Python processes against
  a real local PostgreSQL with 334 applied, allows exactly 10 attempts and
  refuses the rest; after the window an attempt is allowed again.
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
import subprocess
import sys
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
], ids=["db_error", "null", "empty", "list", "string_bool", "int_bool", "no_retry",
        "bool_retry", "float_retry", "negative_retry"])
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


# ── AC1/AC2: real backend code, two processes, one Postgres counter ─────────

_WORKER = r"""
import json, subprocess, sys
from fastapi import HTTPException
from routers import auth

url, user, calls = sys.argv[1], sys.argv[2], int(sys.argv[3])


class _Psql:
    def rpc(self, name, params):
        query = f"SET ROLE service_role; SELECT public.{name}('{params['p_user_id']}')"
        class _Call:
            def execute(self):
                out = subprocess.run(["psql", url, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", query],
                                     capture_output=True, text=True, check=True, timeout=60).stdout
                class _Result: data = json.loads(out)
                return _Result()
        return _Call()


auth.supabase_admin = _Psql()
for _ in range(calls):
    try:
        auth._rate_limit_activate(user)
        print(json.dumps({"status": 200}))
    except HTTPException as e:
        print(json.dumps({"status": e.status_code, "detail": e.detail, "headers": e.headers}))
"""


@pytest.fixture(scope="module")
def pg_db():
    m334._require_pg()
    database = m334._new_database("act334_be")
    try:
        m334._apply(database, m334.SQL)
        yield database
    finally:
        m334._drop_database(database)


def _workers(database: str, user: str, calls: int, count: int) -> list[dict]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env["PYTHONPATH"] = str(BACKEND)
    processes = [subprocess.Popen([sys.executable, "-c", _WORKER, m334._url(database), user, str(calls)],
                                  cwd=BACKEND, env=env, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
                 for _ in range(count)]
    results = []
    for process in processes:
        out, err = process.communicate(timeout=300)
        assert process.returncode == 0, err
        results += [json.loads(line) for line in out.splitlines() if line.startswith("{")]
    return results


def test_eleventh_attempt_across_two_processes_is_429_then_allowed_after_the_window(pg_db):
    user = str(uuid4())
    results = _workers(pg_db, user, calls=6, count=2)
    assert len(results) == 12
    assert sum(r["status"] == 200 for r in results) == 10
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
    assert _workers(pg_db, user, calls=1, count=1) == [{"status": 200}]


def test_rpc_error_is_503_from_the_real_function(pg_db):
    """The real RPC errors (here: EXECUTE revoked) → 503, nothing recorded."""
    user = str(uuid4())
    m334.sql(pg_db, "REVOKE EXECUTE ON FUNCTION public.fn_activate_attempt_check(uuid) FROM service_role")
    try:
        results = _workers(pg_db, user, calls=1, count=1)
    finally:
        m334.sql(pg_db, "GRANT EXECUTE ON FUNCTION public.fn_activate_attempt_check(uuid) TO service_role")
    assert results[0]["status"] == 503
    assert results[0]["detail"]["error_code"] == "activation_unavailable"
    assert m334._rows(pg_db, user) == 0
