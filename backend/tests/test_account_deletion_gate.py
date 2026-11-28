"""ACCOUNTDATA-0100 FR-003: the pending-deletion gate.

The allow list is checked against the REAL app (as
``test_activation_gate_inventory`` does), and the live gate is driven through
a real learner route, an exempt route and the account routes.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

import main
from services import account_deletion_gate as gate
from services.activation_gate import ACTIVATION_EXEMPT_ROUTES, is_staff_path

LIVE = {
    (method, route.path)
    for route in main.app.routes if isinstance(route, APIRoute)
    for method in route.methods - {"HEAD", "OPTIONS"}
}


def test_every_allowed_route_is_live_learner_route_with_reason():
    for (method, path), reason in gate.DELETION_ALLOWED_ROUTES.items():
        assert (method, path) in LIVE, f"{method} {path} is not a route of the app"
        assert not is_staff_path(path)
        assert reason.strip() and "\n" not in reason


def test_the_six_account_routes_are_allowed_and_activation_exempt():
    account = {(m, p) for m, p in LIVE if p.startswith("/api/account/deletion-request")
               or p.startswith("/api/account/data-export")}
    assert len(account) == 6
    for key in account:
        assert gate.allows(*key), key
        assert key in ACTIVATION_EXEMPT_ROUTES, key


def test_public_and_blocked_routes():
    assert gate.allows("GET", "/api/grammar/home")
    assert gate.allows("GET", "/api/courses/{slug}")
    assert gate.allows("GET", "/health")
    assert gate.allows("GET", "/api/enrollment-orders/me")
    # Exempt from activation but not open while a deletion is pending.
    for key in [("GET", "/auth/check-active"), ("POST", "/auth/activate"), ("GET", "/auth/profile"),
                ("POST", "/api/enrollment-orders"), ("POST", "/api/enrollment-orders/{order_code}/cancel"),
                ("GET", "/api/me/courses"), ("POST", "/api/analytics/events")]:
        assert key in ACTIVATION_EXEMPT_ROUTES and not gate.allows(*key), key
    # Gated learner routes are blocked.
    assert not gate.allows("POST", "/sessions")
    assert not gate.allows("GET", "/sessions/{session_id}")
    # A public-looking prefix alone does not open a route that is not exempt.
    gated_vocab = [(m, p) for m, p in LIVE if p.startswith("/api/vocabulary/")
                   and (m, p) not in ACTIVATION_EXEMPT_ROUTES]
    assert gated_vocab and not any(gate.allows(m, p) for m, p in gated_vocab)


@pytest.fixture
def live_gate(live_activation_gate, monkeypatch):
    from routers import auth

    async def fake_user(authorization):
        if authorization != "Bearer ok":
            raise HTTPException(401, detail="Invalid token")
        return {"id": "00000000-0000-0000-0000-0000000020a1", "email": "x@example.test"}

    async def active(_uid):
        return True

    state = {"open": True, "calls": 0}

    async def lookup(_uid):
        state["calls"] += 1
        return state["open"]

    monkeypatch.setattr(auth, "get_supabase_user", fake_user)
    monkeypatch.setattr(live_activation_gate, "alookup_is_active", active)
    monkeypatch.setattr(gate, "alookup_open_request", lookup)
    with TestClient(main.app, raise_server_exceptions=False) as client:
        yield client, state


def test_live_gate_blocks_learner_routes_while_pending(live_gate):
    client, state = live_gate
    r = client.get("/api/me/courses", headers={"Authorization": "Bearer ok"})
    assert r.status_code == 403 and r.json()["detail"]["error_code"] == "account_deletion_pending"
    r = client.get("/auth/check-active", headers={"Authorization": "Bearer ok"})
    assert r.status_code == 403 and r.json()["detail"]["error_code"] == "account_deletion_pending"
    r = client.get("/sessions/00000000-0000-0000-0000-000000000001", headers={"Authorization": "Bearer ok"})
    assert r.status_code == 403 and r.json()["detail"]["error_code"] == "account_deletion_pending"


def test_live_gate_lets_allowed_anonymous_and_bad_tokens_through(live_gate):
    client, state = live_gate
    r = client.get("/api/grammar/categories", headers={"Authorization": "Bearer ok"})
    assert r.status_code != 403
    calls = state["calls"]
    # Anonymous: the handler answers (401 here), the gate does not look up.
    r = client.get("/api/me/courses")
    assert r.status_code == 401 and state["calls"] == calls
    # Exempt route with a token that does not verify: the handler decides.
    r = client.get("/auth/check-active", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401
    state["open"] = False
    r = client.get("/auth/check-active", headers={"Authorization": "Bearer ok"})
    assert r.status_code != 403


class _FakeQuery:
    def __init__(self, outcome):
        self.outcome = outcome

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return type("R", (), {"data": self.outcome})()


class _FakeDb:
    def __init__(self, outcome):
        self.outcome = outcome

    def table(self, name):
        assert name == "account_deletion_requests"
        return _FakeQuery(self.outcome)


def test_lookup_outcomes(live_deletion_gate, monkeypatch):
    monkeypatch.setattr(live_deletion_gate.settings, "USE_ASYNC_DB", False)
    monkeypatch.setattr(live_deletion_gate, "supabase_admin", _FakeDb([{"status": "pending"}]))
    assert asyncio.run(live_deletion_gate.alookup_open_request("u")) is True
    monkeypatch.setattr(live_deletion_gate, "supabase_admin", _FakeDb([]))
    assert asyncio.run(live_deletion_gate.alookup_open_request("u")) is False
    # Migration 500 not applied: allow.
    monkeypatch.setattr(live_deletion_gate, "supabase_admin", _FakeDb(
        RuntimeError("{'code': 'PGRST205', 'message': \"Could not find the table 'public.account_deletion_requests'\"}")))
    assert asyncio.run(live_deletion_gate.alookup_open_request("u")) is False
    # Any other failure fails closed.
    monkeypatch.setattr(live_deletion_gate, "supabase_admin", _FakeDb(RuntimeError("timeout")))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(live_deletion_gate.alookup_open_request("u"))
    assert exc.value.status_code == 503


def test_memo_reuses_the_answer():
    calls = []

    async def run():
        async def lookup(uid):
            calls.append(uid)
            return False

        orig = gate.alookup_open_request
        gate.alookup_open_request = lookup
        try:
            memo: dict = {}
            await gate.aensure_not_pending("u", "POST", "/sessions", memo)
            await gate.aensure_not_pending("u", "GET", "/sessions/{session_id}", memo)
        finally:
            gate.alookup_open_request = orig

    asyncio.run(run())
    assert calls == ["u"]
