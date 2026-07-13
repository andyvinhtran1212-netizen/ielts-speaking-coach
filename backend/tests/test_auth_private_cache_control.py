"""FE-migration pilot 3 (authenticated read) — private responses uncacheable.

Per-pilot entry checklist (plan Phase 2): effective private responses must
carry `Cache-Control: private, no-store` so no cache layer between either
frontend (legacy or Next) and FastAPI can ever serve one user's identity or
profile to another. Pinned at the HTTP layer via TestClient so the header is
asserted on the real response, not the handler's intent.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.auth as auth_module

_USER_ID = "00000000-0000-4000-8000-0000000000aa"


class _Result:
    def __init__(self, data):
        self.data = data


class _Builder:
    """Minimal chainable stub: any select resolves to one user row."""

    def __init__(self, row):
        self._row = row

    def __getattr__(self, _name):
        def _chain(*_a, **_kw):
            return self

        return _chain

    def execute(self):
        return _Result([self._row])


class _FakeAdmin:
    def __init__(self, row):
        self._row = row

    def table(self, _name):
        return _Builder(self._row)


@pytest.fixture()
def client(monkeypatch):
    row = {
        "id": _USER_ID,
        "email": "cache-test@example.com",
        "role": "user",
        "is_active": True,
        "feature_flags": {},
    }

    async def _fake_user(_authz):
        return {"id": _USER_ID, "email": row["email"], "user_metadata": {}}

    monkeypatch.setattr(auth_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(auth_module, "supabase_admin", _FakeAdmin(row))
    # /auth/me pulls live permissions from a service module — keep it inert.
    import services.access_code_permissions as acp

    monkeypatch.setattr(
        acp, "get_user_access_code_permissions_cached", lambda _uid: []
    )

    app = FastAPI()
    app.include_router(auth_module.router)
    return TestClient(app)


@pytest.mark.parametrize("path", ["/auth/me", "/auth/profile"])
def test_private_auth_responses_are_no_store(client, path):
    res = client.get(path, headers={"Authorization": "Bearer x"})
    assert res.status_code == 200, res.text
    assert res.headers.get("cache-control") == "private, no-store"
