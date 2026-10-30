"""PC-J86 (PC-J76 F-3) — the auth reads fail closed over a REAL async client.

``test_async_auth_db_layer.py`` proves flag-on/flag-off parity with an
in-memory fake that raises ``RuntimeError``. That never runs the code between
the facade and the wire: ``AsyncPostgrestClient`` response parsing,
``APIError`` on an error status, the PC-J55 timeouts and the one GET retry.
Here, with ``USE_ASYNC_DB`` on, every read goes through a real
``AsyncPostgrestClient`` on the production transport builder
(``database._build_supabase_async_http_client``) to a loopback fake PostgREST
that answers each request with data, a 5xx, a bad body or nothing at all.

Pinned for the learner gate (over HTTP on ``/api/student/permissions``),
``require_instructor`` / ``require_admin`` (``staff_guard.resolve_staff``) and
``/auth/check-active``: a lookup that fails never makes an account active or
staff, and every lookup failure is a 503 (gate, staff guards and, since
ASYNCAUTH-0036 Revision 2, ``/auth/check-active``). The sync singleton is never
touched with the flag on.
"""

from __future__ import annotations

import asyncio
import json
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qsl, unquote, urlsplit

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest import AsyncPostgrestClient

import database
import main
import routers.admin as admin_module
import routers.auth as auth_module
from config import settings
from services import access_code_permissions as acp
from services import activation_gate, staff_guard
from services.errors import GENERIC_MESSAGE

_FAST = httpx.Timeout(0.5, connect=0.5, pool=0.5)
_FUTURE = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

GATE_503 = "Không kiểm tra được trạng thái tài khoản. Vui lòng thử lại."

TABLES = {
    "users": [
        {"id": "u-active", "is_active": True, "role": "user"},
        {"id": "u-inactive", "is_active": False, "role": "user"},
        {"id": "u-instructor", "is_active": True, "role": "instructor"},
        {"id": "u-instructor-off", "is_active": False, "role": "instructor"},
        {"id": "u-admin", "is_active": True, "role": "admin"},
    ],
    "user_code_assignments": [
        {"user_id": "u-active", "code_id": "c-speak", "is_active": True},
    ],
    "access_codes": [
        {"id": "c-speak", "permissions": ["practice_single", "practice_part"],
         "session_limit": None, "is_revoked": False, "is_active": True,
         "expires_at": _FUTURE, "used_by": None},
    ],
    "students": [],
    "writing_assignments": [],
}

# Each failure mode, as the fake PostgREST answers one request.
#   http500   PostgREST error JSON on a 500
#   http502   proxy HTML page on a 502 (the error body is not JSON)
#   http503   503 with no body at all
#   bad_json  200 with a truncated JSON body
#   html200   200 with an HTML page (a proxy or captive page)
#   timeout   reads the request and never answers (both attempts: the
#             idempotent GET is re-sent once on a fresh connection)
#   reset     closes the connection without a response (both attempts)
#   empty     200 with an empty body (postgrest reads it as no rows)
_BAD_ANSWER = ["http500", "http502", "http503", "bad_json", "html200"]
_TRANSPORT = ["timeout", "reset"]
_FAILURES = _BAD_ANSWER + _TRANSPORT


def _plan(failure: str) -> list[str]:
    return [failure, failure] if failure in _TRANSPORT else [failure]


# ── Loopback fake PostgREST ──────────────────────────────────────────────────


def _matches(row: dict, params: list[tuple[str, str]]) -> bool:
    for col, expr in params:
        if col in ("select", "limit", "order", "offset"):
            continue
        op, _, value = expr.partition(".")
        if op == "eq" and str(row.get(col)) != value:
            return False
        if op == "in" and str(row.get(col)) not in value.strip("()").split(","):
            return False
        if op == "is" and value == "null" and row.get(col) is not None:
            return False
    return True


class _LoopbackPostgrest:
    """Threaded HTTP/1.1 keep-alive fake PostgREST on 127.0.0.1.

    A thread-based server, not one on the test's event loop, so it serves
    TestClient (a fresh loop per request) and ``asyncio.run`` alike. Requests
    for a table consume that table's scripted actions in order, then get rows.
    """

    def __init__(self, tables):
        self.tables = {k: [dict(r) for r in v] for k, v in tables.items()}
        self.faults: dict[str, list[str]] = {}
        self.requests: list[tuple[str, str, str]] = []
        self._release = threading.Event()
        self._lock = threading.Lock()
        srv = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_a):
                pass

            def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler API
                srv._answer(self)

        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._httpd.daemon_threads = True
        self._httpd.block_on_close = False
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *_exc):
        self._release.set()
        self._httpd.shutdown()
        self._httpd.server_close()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self._httpd.server_address[1]}/rest/v1"

    def fail(self, table: str, *actions: str) -> None:
        self.faults.setdefault(table, []).extend(actions)

    def hits(self, table: str) -> list[str]:
        return [a for _m, t, a in self.requests if t == table]

    def _answer(self, h: BaseHTTPRequestHandler) -> None:
        parts = urlsplit(h.path)
        table = parts.path.rsplit("/", 1)[-1]
        params = [(k, unquote(v)) for k, v in parse_qsl(parts.query, keep_blank_values=True)]
        with self._lock:
            queue = self.faults.get(table) or []
            action = queue.pop(0) if queue else "rows"
            self.requests.append((h.command, table, action))
        if action == "timeout":
            self._release.wait()
            h.close_connection = True
            return
        if action == "reset":
            h.close_connection = True
            return
        status, ctype, body = {
            "http500": (500, "application/json", json.dumps(
                {"code": "XX000", "message": "upstream boom", "details": None, "hint": None})),
            "http502": (502, "text/html", "<html><body>502 Bad Gateway</body></html>"),
            "http503": (503, "application/json", ""),
            "bad_json": (200, "application/json", '[{"id": "u-active", "is_active": tru'),
            "html200": (200, "text/html", "<html><body>OK</body></html>"),
            "empty": (200, "application/json", ""),
        }.get(action) or (200, "application/json", self._rows(table, params))
        data = body.encode()
        try:
            h.send_response(status)
            h.send_header("Content-Type", ctype)
            h.send_header("Content-Length", str(len(data)))
            h.end_headers()
            h.wfile.write(data)
        except OSError:
            h.close_connection = True

    def _rows(self, table: str, params: list[tuple[str, str]]) -> str:
        rows = [r for r in self.tables.get(table, []) if _matches(r, params)]
        limit = dict(params).get("limit")
        if limit is not None:
            rows = rows[: int(limit)]
        return json.dumps(rows)


class _RealAsyncClient:
    """Replaces ``database.get_supabase_async`` with a real
    ``AsyncPostgrestClient`` on the production async transport, pointed at the
    loopback server. One httpx pool per event loop; ``close`` ends it on the
    loop that opened it."""

    def __init__(self, url: str):
        self.url = url
        self._http: httpx.AsyncClient | None = None

    async def get(self):
        if self._http is None:
            self._http = database._build_supabase_async_http_client()
        return AsyncPostgrestClient(self.url, http_client=self._http)

    async def close(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None


class _NoSync:
    """The sync singleton with the flag on: any use is recorded (callers that
    degrade on failure would swallow a raise) and refused."""

    def __init__(self):
        self.attempts: list[str] = []

    def table(self, name):
        self.attempts.append(name)
        raise AssertionError("sync client used while USE_ASYNC_DB is on")


class _AuthClient:
    """GoTrue stand-in: the bearer IS the user id; no network."""

    is_closed = False

    class cookies:  # noqa: N801 — mimics httpx.AsyncClient.cookies
        @staticmethod
        def clear():
            pass

    async def get(self, _url, headers):
        uid = headers["Authorization"].removeprefix("Bearer ")

        class _R:
            status_code = 200

            @staticmethod
            def json():
                return {"id": uid, "email": f"{uid}@x.test", "user_metadata": {}}

        return _R()


@pytest.fixture
def pg(monkeypatch, live_activation_gate):
    """Flag on, real activation gate, real async client → loopback server."""
    monkeypatch.setattr(settings, "USE_ASYNC_DB", True)
    monkeypatch.setattr(settings, "ADMIN_AAL2_ENFORCE", False)
    monkeypatch.setattr(database, "ASYNC_POSTGREST_TIMEOUT", _FAST)
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient())
    no_sync = _NoSync()
    for mod in (database, activation_gate, acp, admin_module, auth_module):
        monkeypatch.setattr(mod, "supabase_admin", no_sync)
    with _LoopbackPostgrest(TABLES) as srv:
        client = _RealAsyncClient(srv.url)
        monkeypatch.setattr(database, "get_supabase_async", client.get)
        srv.client, srv.no_sync = client, no_sync
        yield srv
    assert no_sync.attempts == [], "flag on: the sync singleton was used"


def _api(srv) -> TestClient:
    async def app(scope, receive, send):
        try:
            await main.app(scope, receive, send)
        finally:
            await srv.client.close()

    return TestClient(app, raise_server_exceptions=False)


def _get(srv, path: str, user_id: str):
    return _api(srv).get(path, headers={"Authorization": f"Bearer {user_id}"})


def _assert_structured_5xx(r, status: int) -> None:
    """main.py's HTTPException handler replaces a 5xx string detail with the
    safe envelope, its ``ref`` being the response's request id."""
    assert r.status_code == status, r.text
    assert r.json() == {"detail": {
        "error_code": "internal_error", "message": GENERIC_MESSAGE,
        "ref": r.headers["X-Request-ID"],
    }}


def _run(srv, coro_fn):
    """``coro_fn()`` on a fresh loop; an HTTPException becomes its tuple."""
    async def body():
        try:
            return await coro_fn()
        except HTTPException as exc:
            return ("HTTPException", exc.status_code, exc.detail)
        finally:
            await srv.client.close()

    return asyncio.run(body())


# ── Learner gate over HTTP: GET /api/student/permissions ─────────────────────

_NO_PERMISSIONS = acp.get_user_permissions_summary([])


def test_permissions_active_learner_is_200_over_the_real_client(pg):
    r = _get(pg, "/api/student/permissions", "u-active")
    assert r.status_code == 200, r.text
    assert r.json() == acp.get_user_permissions_summary(["practice_part", "practice_single"])
    # The gate read users once; the summary reused the request memo.
    assert pg.hits("users") == ["rows"]
    assert pg.hits("access_codes") and pg.hits("user_code_assignments")


def test_permissions_inactive_learner_is_403(pg):
    r = _get(pg, "/api/student/permissions", "u-inactive")
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == activation_gate.INACTIVE_DETAIL
    assert pg.hits("access_codes") == [], "no permission read for an inactive account"


def test_permissions_missing_users_row_is_403(pg):
    r = _get(pg, "/api/student/permissions", "u-nobody")
    assert r.status_code == 403, r.text


@pytest.mark.parametrize("failure", _FAILURES)
def test_permissions_users_lookup_failure_is_structured_503_never_200(pg, failure):
    pg.fail("users", *_plan(failure))
    r = _get(pg, "/api/student/permissions", "u-active")
    _assert_structured_5xx(r, 503)
    assert pg.hits("users") == _plan(failure), "a bad answer is not re-sent; a GET transport error is, once"
    assert pg.hits("access_codes") == [] and pg.hits("user_code_assignments") == []


def test_permissions_empty_users_body_is_inactive_403(pg):
    pg.fail("users", "empty")
    r = _get(pg, "/api/student/permissions", "u-active")
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == activation_gate.INACTIVE_DETAIL


@pytest.mark.parametrize("failure", _TRANSPORT)
def test_permissions_one_transport_error_recovers_on_the_retry(pg, failure):
    pg.fail("users", failure)
    r = _get(pg, "/api/student/permissions", "u-active")
    assert r.status_code == 200, r.text
    assert pg.hits("users") == [failure, "rows"]


# ── Learner gate, direct: aensure_account_active ─────────────────────────────


@pytest.mark.parametrize("failure", _FAILURES + ["empty"])
def test_gate_never_confirms_active_on_a_failed_lookup(pg, failure):
    pg.fail("users", *_plan(failure))

    async def check():
        token = activation_gate.begin_request_memo()
        try:
            await activation_gate.aensure_account_active("u-active")
            return activation_gate.confirmed_active("u-active")
        finally:
            activation_gate.reset_request_memo(token)

    out = _run(pg, check)
    expected = 403 if failure == "empty" else 503
    assert out[:2] == ("HTTPException", expected)


# ── Staff guards: require_instructor / require_admin → resolve_staff ─────────

_GUARDS = {
    "require_instructor": (admin_module.require_instructor, staff_guard.INSTRUCTOR_ROLE_DENIED),
    "require_admin": (admin_module.require_admin, staff_guard.ADMIN_ROLE_DENIED),
}
_STAFF = {"require_instructor": "u-instructor", "require_admin": "u-admin"}


def _guard(srv, guard: str, user_id: str):
    fn = _GUARDS[guard][0]
    return _run(srv, lambda: fn(f"Bearer {user_id}"))


@pytest.mark.parametrize("guard", sorted(_GUARDS))
def test_staff_guard_admits_active_staff_over_the_real_client(pg, guard):
    out = _guard(pg, guard, _STAFF[guard])
    assert isinstance(out, dict) and out["id"] == _STAFF[guard]
    assert pg.hits("users") == ["rows", "rows"], "role read, then is_active read"


@pytest.mark.parametrize("guard,user_id", [
    ("require_instructor", "u-active"), ("require_instructor", "u-nobody"),
    ("require_admin", "u-instructor"), ("require_admin", "u-active"),
])
def test_staff_guard_denies_a_non_staff_role(pg, guard, user_id):
    assert _guard(pg, guard, user_id) == ("HTTPException", 403, _GUARDS[guard][1])


def test_staff_guard_denies_an_inactive_instructor(pg):
    out = _guard(pg, "require_instructor", "u-instructor-off")
    assert out == ("HTTPException", 403, activation_gate.INACTIVE_DETAIL)


@pytest.mark.parametrize("failure", _FAILURES)
@pytest.mark.parametrize("guard", sorted(_GUARDS))
def test_staff_guard_role_lookup_failure_is_503(pg, guard, failure):
    pg.fail("users", *_plan(failure))
    out = _guard(pg, guard, _STAFF[guard])
    assert out == ("HTTPException", 503, staff_guard.LOOKUP_FAILED_DETAIL)
    assert pg.hits("users") == _plan(failure), "no is_active read after a failed role read"


@pytest.mark.parametrize("failure", _FAILURES)
@pytest.mark.parametrize("guard", sorted(_GUARDS))
def test_staff_guard_is_active_lookup_failure_is_503(pg, guard, failure):
    pg.fail("users", "rows", *_plan(failure))
    out = _guard(pg, guard, _STAFF[guard])
    assert out == ("HTTPException", 503, GATE_503)


@pytest.mark.parametrize("guard", sorted(_GUARDS))
def test_staff_guard_empty_role_body_is_not_staff(pg, guard):
    pg.fail("users", "empty")
    assert _guard(pg, guard, _STAFF[guard]) == ("HTTPException", 403, _GUARDS[guard][1])


@pytest.mark.parametrize("guard", sorted(_GUARDS))
def test_staff_guard_empty_is_active_body_is_inactive(pg, guard):
    pg.fail("users", "rows", "empty")
    out = _guard(pg, guard, _STAFF[guard])
    assert out == ("HTTPException", 403, activation_gate.INACTIVE_DETAIL)


@pytest.mark.parametrize("failure", _FAILURES)
def test_resolve_staff_with_the_facade_read_never_grants(pg, failure):
    pg.fail("users", *_plan(failure))
    out = _run(pg, lambda: staff_guard.resolve_staff(
        "Bearer u-admin", need="admin", get_user=auth_module.get_supabase_user,
        db=pg.no_sync, read_role=admin_module._staff_role_row,
    ))
    assert out == ("HTTPException", 503, staff_guard.LOOKUP_FAILED_DETAIL)


# ── GET /auth/check-active ───────────────────────────────────────────────────


@pytest.mark.parametrize("user_id,expected", [
    ("u-active", {"is_active": True, "suspended": False}),
    ("u-inactive", {"is_active": False, "suspended": False}),
    ("u-nobody", {"is_active": False, "suspended": False}),
])
def test_check_active_reads_over_the_real_client(pg, user_id, expected):
    r = _get(pg, "/auth/check-active", user_id)
    assert r.status_code == 200, r.text
    assert r.json() == expected


@pytest.mark.parametrize("failure", _FAILURES)
def test_check_active_lookup_failure_is_503_never_active(pg, failure):
    # ASYNCAUTH-0036 Revision 2 (Vinh, 2026-10-29; PC-J76 F-4): 503 like the
    # gate and the staff guards, with the same sanitized envelope.
    pg.fail("users", *_plan(failure))
    r = _get(pg, "/auth/check-active", "u-active")
    _assert_structured_5xx(r, 503)


def test_check_active_empty_body_is_inactive(pg):
    pg.fail("users", "empty")
    r = _get(pg, "/auth/check-active", "u-active")
    assert r.status_code == 200, r.text
    assert r.json() == {"is_active": False, "suspended": False}
