"""W-03 — behaviour of the learner activation gate on the REAL app.

Runs the live gate (`live_activation_gate` fixture) end to end through
main.app: the real routers.auth.get_supabase_user (Supabase Auth replaced by
an in-memory client that counts calls) and the real users.is_active lookup
(over a stub table). Handlers are probed with a sentinel: their module's
get_supabase_user / require_admin is replaced by one that answers 418, so a
418 proves the request got PAST the gate into the handler, while 403
"Tài khoản chưa được kích hoạt" proves the gate stopped it.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import routers.auth as auth_module
from services import activation_gate
from services.activation_gate import INACTIVE_DETAIL

ACTIVE, INACTIVE, NO_ROW = "user-active", "user-inactive", "user-missing"


class _Result:
    def __init__(self, data):
        self.data = data


class _UsersQuery:
    def __init__(self, store):
        self.store, self.filters = store, {}

    def select(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def execute(self):
        self.store.lookups.append(dict(self.filters))
        if self.store.fail:
            raise RuntimeError("users lookup down")
        return _Result([r for r in self.store.rows if all(r.get(k) == v for k, v in self.filters.items())])


class _UsersDB:
    def __init__(self):
        self.rows = [{"id": ACTIVE, "is_active": True}, {"id": INACTIVE, "is_active": False}]
        self.lookups: list = []
        self.fail = False

    def table(self, name):
        assert name == "users", name
        return _UsersQuery(self)


class _AuthResponse:
    def __init__(self, user):
        self.status_code = 200 if user else 401
        self._user = user

    def json(self):
        return self._user


class _AuthClient:
    """Stands in for the shared httpx client used by get_supabase_user."""

    is_closed = False

    def __init__(self):
        self.calls = 0

        class _Jar:
            def clear(self):
                pass
        self.cookies = _Jar()

    async def get(self, _url, headers):
        self.calls += 1
        uid = headers["Authorization"].removeprefix("Bearer ")
        return _AuthResponse({"id": uid, "email": f"{uid}@example.test", "user_metadata": {}})


@pytest.fixture
def gate(live_activation_gate, monkeypatch):
    db, client = _UsersDB(), _AuthClient()
    monkeypatch.setattr(activation_gate, "supabase_admin", db)
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: client)

    class Harness:
        users = db
        auth = client
        api = TestClient(main.app, raise_server_exceptions=False)

        @staticmethod
        def call(method, path, uid=None, **kw):
            headers = {"Authorization": f"Bearer {uid}"} if uid else {}
            return Harness.api.request(method, path, headers=headers, **kw)

    return Harness


def _sentinel(*_a, **_k):
    raise HTTPException(418, "handler reached")


async def _async_sentinel(*_a, **_k):
    _sentinel()


def _inactive(resp):
    return resp.status_code == 403 and resp.json().get("detail") == INACTIVE_DETAIL


# (handler module whose auth we replace with the sentinel, method, path, json body)
PAID = [
    ("routers.listening", "POST", "/api/listening/attempts",
     {"mode": "gist", "content_id": "c-1", "user_transcript": "the gist"}),
    ("routers.writing_student", "POST", "/api/writing/my-assignments/a-1/submit", {}),
    ("routers.mock_exams", "POST", "/api/mock-exams/sittings/s-1/sections/writing/submit", {}),
    ("routers.quiz", "POST", "/api/quiz/course/writing", {}),
    ("routers.course_pronunciation", "POST", "/api/quiz/course/pronunciation/submit", None),
    ("routers.advanced_vocab", "POST", "/api/advanced-vocab/controlled-rewrite/complete", {}),
]
GENERIC = [
    ("main", "GET", "/topics", None),
    ("routers.student_home", "GET", "/api/student/permissions", None),
    ("routers.listening", "GET", "/api/listening/tests", None),
    ("routers.sessions", "POST", "/sessions", {"mode": "practice", "part": 1}),
    ("routers.flashcards", "GET", "/api/flashcards/stacks", None),
]


@pytest.mark.parametrize("module,method,path,body", PAID + GENERIC)
def test_inactive_account_is_refused_before_the_handler(gate, monkeypatch, module, method, path, body):
    monkeypatch.setattr(f"{module}.get_supabase_user", _async_sentinel)
    resp = gate.call(method, path, INACTIVE, json=body)
    assert _inactive(resp), (resp.status_code, resp.text)


@pytest.mark.parametrize("module,method,path,body", PAID + GENERIC)
def test_account_without_users_row_is_inactive(gate, monkeypatch, module, method, path, body):
    monkeypatch.setattr(f"{module}.get_supabase_user", _async_sentinel)
    assert _inactive(gate.call(method, path, NO_ROW, json=body))


@pytest.mark.parametrize("module,method,path,body", PAID + GENERIC)
def test_active_account_passes_the_gate(gate, monkeypatch, module, method, path, body):
    monkeypatch.setattr(f"{module}.get_supabase_user", _async_sentinel)
    resp = gate.call(method, path, ACTIVE, json=body)
    # 418: handler reached. 422: request validation — which FastAPI runs only
    # after the router dependency (the gate) has passed.
    assert resp.status_code in (418, 422), (resp.status_code, resp.text)
    assert gate.users.lookups == [{"id": ACTIVE}]


def test_gate_and_handler_share_one_supabase_auth_call(gate, monkeypatch):
    class _Topics:
        def table(self, _name): return self
        def select(self, *_a): return self
        def eq(self, *_a): return self
        def order(self, *_a): return self

        def execute(self):
            return _Result([{"id": "t1", "title": "Hometown", "category": "x", "part": 1}])

    monkeypatch.setattr(main, "supabase_admin", _Topics())
    resp = gate.call("GET", "/topics", ACTIVE)
    assert resp.status_code == 200 and resp.json()[0]["id"] == "t1"
    assert gate.auth.calls == 1                 # gate verified; handler reused it
    resp = gate.call("GET", "/topics", ACTIVE)
    assert resp.status_code == 200
    assert gate.auth.calls == 2                 # never cached across requests
    assert gate.users.lookups == [{"id": ACTIVE}, {"id": ACTIVE}]


def test_anonymous_request_falls_through_to_the_handlers_own_auth(gate):
    resp = gate.call("GET", "/topics")
    assert resp.status_code == 401
    assert gate.users.lookups == [] and gate.auth.calls == 0


def test_invalid_token_is_401_not_403(gate, monkeypatch):
    class _Reject(_AuthClient):
        async def get(self, _url, headers):
            self.calls += 1
            return _AuthResponse(None)
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _Reject())
    assert gate.call("GET", "/topics", "garbage").status_code == 401
    assert gate.users.lookups == []


def test_is_active_lookup_failure_fails_closed(gate, monkeypatch):
    monkeypatch.setattr("main.get_supabase_user", _async_sentinel)
    gate.users.fail = True
    resp = gate.call("GET", "/topics", ACTIVE)
    assert resp.status_code == 503


# ── Exemptions: what an inactive account still reaches ──────────────────────

def test_inactive_account_cannot_edit_profile(gate):
    resp = gate.call("PATCH", "/auth/profile", INACTIVE, json={"display_name": "x"})
    assert _inactive(resp)


def test_inactive_account_can_check_status_and_bootstrap(gate, monkeypatch):
    monkeypatch.setattr(auth_module, "supabase_admin", gate.users)
    resp = gate.call("GET", "/auth/check-active", INACTIVE)
    assert resp.status_code == 200 and resp.json() == {"is_active": False, "suspended": False}


def test_inactive_account_can_reach_activation(gate, monkeypatch):
    monkeypatch.setattr(auth_module, "_rate_limit_activate", _sentinel)
    resp = gate.call("POST", "/auth/activate", INACTIVE, json={"access_code": "AB12-CD34"})
    assert resp.status_code == 418              # reached the activation handler


def test_inactive_account_can_load_me(gate, monkeypatch):
    class _Me:
        def table(self, _n): return self
        def select(self, *_a): return self
        def update(self, *_a): return self
        def eq(self, *_a): return self
        def limit(self, *_a): return self

        def execute(self):
            return _Result([{"id": INACTIVE, "email": "x@example.test", "role": "user",
                             "is_active": False}])

    monkeypatch.setattr(auth_module, "supabase_admin", _Me())
    monkeypatch.setattr("services.access_code_permissions.get_user_access_code_permissions_cached",
                        lambda _uid: [])
    resp = gate.call("GET", "/auth/me", INACTIVE)
    assert resp.status_code == 200 and resp.json()["is_active"] is False


@pytest.mark.parametrize("method,path,body,expected", [
    ("GET", "/api/grammar/categories", None, 200),
    ("GET", "/api/vocabulary/categories", None, 200),
    ("GET", "/api/writing/prompt-bank", None, 200),
    ("POST", "/api/feedback", {}, 422),            # handler validation, not the gate
    ("POST", "/api/analytics/events", {}, 422),
])
def test_inactive_account_still_reaches_public_content(gate, method, path, body, expected):
    resp = gate.call(method, path, INACTIVE, json=body)
    assert resp.status_code == expected, resp.text
    assert gate.users.lookups == []             # exempt: no activation lookup at all


@pytest.mark.parametrize("module,path", [
    ("routers.vocab_units", "/admin/vocabulary/pilot-metrics"),
    ("routers.feedback", "/api/admin/feedback"),
])
def test_staff_path_in_gated_router_is_not_gated(gate, monkeypatch, module, path):
    monkeypatch.setattr(f"{module}.require_admin", _async_sentinel)
    resp = gate.call("GET", path, INACTIVE)
    assert resp.status_code == 418              # role guard decides, not activation
    assert gate.users.lookups == []


# ── Folded permission checks (defence in depth) ─────────────────────────────

def test_speaking_permission_requires_an_active_account(gate, monkeypatch):
    from routers import sessions as sessions_module
    monkeypatch.setattr(sessions_module, "get_user_access_code_permissions_cached", lambda _u: ["all"])
    sessions_module._require_permission(ACTIVE, "practice")            # no raise
    with pytest.raises(HTTPException) as ei:
        sessions_module._require_permission(INACTIVE, "practice")
    assert ei.value.status_code == 403 and ei.value.detail == INACTIVE_DETAIL


def test_writing_permission_requires_an_active_account(gate, monkeypatch):
    import asyncio
    from routers import writing_student as ws
    monkeypatch.setattr(ws, "get_user_access_code_permissions", lambda _u: ["writing"])
    monkeypatch.setattr(ws, "student_has_writing_assignment", lambda _sid: True)
    student = {"id": "s1", "user_id": ACTIVE}
    assert asyncio.run(ws.require_writing_permission(student)) is student
    with pytest.raises(HTTPException) as ei:
        asyncio.run(ws.require_writing_permission({"id": "s2", "user_id": INACTIVE}))
    assert ei.value.status_code == 403 and ei.value.detail == INACTIVE_DETAIL


def test_writing_permission_still_requires_the_entitlement(gate, monkeypatch):
    import asyncio
    from routers import writing_student as ws
    monkeypatch.setattr(ws, "get_user_access_code_permissions", lambda _u: ["practice_single"])
    monkeypatch.setattr(ws, "student_has_writing_assignment", lambda _sid: False)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(ws.require_writing_permission({"id": "s1", "user_id": ACTIVE}))
    assert ei.value.status_code == 403 and "Writing" in ei.value.detail
