"""P0-1 (C-1.1) async-DB scaffold — flag OFF must be a perfect no-op.

These pin the facade's dual-path semantics, the flag default, the loop-lag
monitor surface, the /health/async-db endpoint, and — critically — that the
scaffold is NOT yet wired into any router (so flag-off changes nothing).
"""

from __future__ import annotations

import asyncio
import glob
import os

from fastapi.testclient import TestClient

import database
from config import settings
from services import loop_monitor
from services.db_async import aexecute


def test_flag_defaults_off():
    assert settings.USE_ASYNC_DB is False


def test_aexecute_off_uses_sync_singleton_directly(monkeypatch):
    # Flag OFF → facade must call build(supabase_admin).execute() directly and
    # NEVER touch the async client.
    monkeypatch.setattr(settings, "USE_ASYNC_DB", False)
    sentinel_client = object()
    monkeypatch.setattr(database, "supabase_admin", sentinel_client)

    async def _boom():  # must not be called when flag is off
        raise AssertionError("async client must not be used when USE_ASYNC_DB is off")

    monkeypatch.setattr(database, "get_supabase_async", _boom)

    seen = {}

    class FakeBuilder:
        def __init__(self, client):
            seen["client"] = client

        def execute(self):  # sync — exactly today's call
            seen["executed"] = True
            return "SYNC_RESULT"

    result = asyncio.run(aexecute(lambda c: FakeBuilder(c)))
    assert result == "SYNC_RESULT"
    assert seen["client"] is sentinel_client
    assert seen["executed"] is True


def test_aexecute_on_awaits_async_client(monkeypatch):
    # Flag ON → facade awaits build(async_client).execute().
    monkeypatch.setattr(settings, "USE_ASYNC_DB", True)
    fake_client = object()

    async def _fake_get():
        return fake_client

    monkeypatch.setattr(database, "get_supabase_async", _fake_get)

    seen = {}

    class FakeAsyncBuilder:
        def __init__(self, client):
            seen["client"] = client

        async def execute(self):  # coroutine — awaited
            seen["executed"] = True
            return "ASYNC_RESULT"

    result = asyncio.run(aexecute(lambda c: FakeAsyncBuilder(c)))
    assert result == "ASYNC_RESULT"
    assert seen["client"] is fake_client
    assert seen["executed"] is True


def test_loop_monitor_snapshot_shape():
    snap = loop_monitor.snapshot()
    for key in (
        "samples",
        "interval_s",
        "lag_ms_last",
        "lag_ms_max",
        "lag_ms_p50",
        "lag_ms_p95",
        "running",
    ):
        assert key in snap, f"missing {key}"


def test_health_async_db_endpoint_reports_baseline():
    from main import app

    client = TestClient(app)
    r = client.get("/health/async-db")
    assert r.status_code == 200
    body = r.json()
    assert body["use_async_db"] is False
    assert body["async_client_initialised"] is False
    assert "event_loop_lag" in body
    assert "lag_ms_p95" in body["event_loop_lag"]


def _facade_users(subdir):
    base = os.path.join(os.path.dirname(__file__), "..", subdir)
    wired = set()
    for path in glob.glob(os.path.join(base, "*.py")):
        if " 2.py" in path:  # ignore stray ` 2` dupes
            continue
        if os.path.basename(path) == "db_async.py":
            continue
        src = open(path, encoding="utf-8").read()
        if "services.db_async" in src or "aexecute(" in src:
            wired.add(os.path.basename(path))
    return wired


def test_only_grading_and_auth_layer_are_wired_to_facade():
    # P0-1 Phase 2 wired grading.py; PC-J05 (D1a) wired the per-request auth and
    # permission checks. Flipping USE_ASYNC_DB on may change ONLY these paths —
    # sessions/reading/listening/admin data routes are later phases.
    #   routers/admin.py — require_admin / require_instructor role read only
    #   routers/auth.py  — /auth/me and /auth/check-active
    assert _facade_users("routers") == {"grading.py", "admin.py", "auth.py"}
    assert _facade_users("services") == {
        "activation_gate.py",          # learner gate is_active read
        "access_code_permissions.py",  # live permissions + /api/student/permissions
        "student_service.py",          # afetch_linked_student (writing bridge)
    }


def test_admin_router_uses_facade_only_in_staff_role_guard():
    # admin.py is wired for the guard's role read, not for any admin data route.
    src = open(os.path.join(os.path.dirname(__file__), "..", "routers", "admin.py"),
               encoding="utf-8").read()
    assert src.count("aexecute(") == 1
    guard = src[src.index("async def _staff_role_row"):src.index("async def require_admin")]
    assert "aexecute(" in guard
