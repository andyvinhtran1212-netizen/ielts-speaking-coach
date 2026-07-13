"""FE-migration pilot 4 — first require_flag adoption (ADR-010).

PATCH /auth/profile is the program's first mutation endpoint behind the
runtime kill switch: flag ``profile_update``, default ENABLED (a missing
runtime_flags row must never break the legacy page). Disabled → 503 with the
contracted ``feature_disabled`` body, and the handler body must never run.
Also pins the pilot-3/4 private-response header on the mutation path.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.auth as auth_module
import services.runtime_flags as runtime_flags

_USER_ID = "00000000-0000-4000-8000-0000000000bb"


class _Result:
    def __init__(self, data):
        self.data = data


class _Builder:
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
        self.update_calls = 0

    def table(self, _name):
        return _Builder(self._row)


@pytest.fixture()
def harness(monkeypatch):
    row = {
        "id": _USER_ID,
        "email": "pilot4@example.com",
        "display_name": "Pilot Four",
        "role": "user",
        "is_active": True,
        "weekly_goal": 7,
    }

    async def _fake_user(_authz):
        return {"id": _USER_ID, "email": row["email"], "user_metadata": {}}

    monkeypatch.setattr(auth_module, "get_supabase_user", _fake_user)
    fake_admin = _FakeAdmin(row)
    monkeypatch.setattr(auth_module, "supabase_admin", fake_admin)
    runtime_flags.clear_cache()

    app = FastAPI()
    app.include_router(auth_module.router)
    return TestClient(app), fake_admin


def test_flag_missing_defaults_enabled(harness, monkeypatch):
    """Missing runtime_flags row = enabled — legacy traffic must not notice."""
    client, _ = harness
    monkeypatch.setattr(
        runtime_flags, "is_enabled", lambda key, default=True: default
    )
    res = client.patch(
        "/auth/profile",
        headers={"Authorization": "Bearer x"},
        json={"weekly_goal": 9},
    )
    assert res.status_code == 200, res.text
    assert res.headers.get("cache-control") == "private, no-store"


def test_flag_disabled_returns_503_feature_disabled(harness, monkeypatch):
    client, _ = harness

    seen = {}

    def _disabled(key, default=True):
        seen["key"] = key
        return False

    monkeypatch.setattr(runtime_flags, "is_enabled", _disabled)

    async def _must_not_run(_authz):  # dependency must reject BEFORE auth/body
        raise AssertionError("handler body must not run when the flag is off")

    monkeypatch.setattr(auth_module, "get_supabase_user", _must_not_run)

    res = client.patch(
        "/auth/profile",
        headers={"Authorization": "Bearer x"},
        json={"weekly_goal": 9},
    )
    assert res.status_code == 503
    detail = res.json()["detail"]
    assert detail["code"] == "feature_disabled"
    assert detail["flag"] == "profile_update"
    assert seen["key"] == "profile_update"


def test_repeat_patch_same_payload_is_idempotent(harness, monkeypatch):
    """Set-semantics update: replaying the identical PATCH (timeout retry)
    converges on the same state and the same 200 response."""
    client, _ = harness
    monkeypatch.setattr(
        runtime_flags, "is_enabled", lambda key, default=True: default
    )
    payload = {"display_name": "Pilot Four", "weekly_goal": 9}
    first = client.patch(
        "/auth/profile", headers={"Authorization": "Bearer x"}, json=payload
    )
    second = client.patch(
        "/auth/profile", headers={"Authorization": "Bearer x"}, json=payload
    )
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
