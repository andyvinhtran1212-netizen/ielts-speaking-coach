"""ASYNCAUTH-0036 lifecycle and wiring pins (PC-J96, PC-J76 F-15).

  * FR-003 — ``main.shutdown_event`` releases the USE_ASYNC_DB client's
    PostgREST pool through ``database.close_supabase_async`` exactly once, and
    a shutdown is safe when the flag was off and no async client was built.
  * FR-004 — ``GET /api/student/home-summary`` hands the aggregator the
    per-thread factory ``database.thread_supabase_admin``: every section runs
    on its worker thread's own service-role client, never the shared
    ``supabase_admin`` singleton and never a client from another thread.
"""

from __future__ import annotations

import asyncio
import threading
import time
from unittest.mock import Mock

import httpx

import database


# ── FR-003: shutdown closes the async client ─────────────────────────────────


def _stub_sync_closers(monkeypatch):
    """shutdown_event imports these at call time; keep the shared sync pools
    open for the rest of the suite."""
    from routers import auth

    async def _close_auth():
        return None

    monkeypatch.setattr(auth, "close_auth_http_client", _close_auth)
    monkeypatch.setattr(database, "close_supabase_http_client", Mock())


def test_shutdown_closes_the_async_client_exactly_once(monkeypatch):
    import main

    _stub_sync_closers(monkeypatch)
    calls = []

    async def _close_async():
        calls.append(threading.get_ident())

    monkeypatch.setattr(database, "close_supabase_async", _close_async)

    asyncio.run(main.shutdown_event())

    assert len(calls) == 1


def test_shutdown_releases_a_built_async_pool(monkeypatch):
    import main

    _stub_sync_closers(monkeypatch)
    transport = httpx.AsyncClient()
    monkeypatch.setattr(database, "_supabase_async", object())
    monkeypatch.setattr(database, "_supabase_async_postgrest_http_client", transport)

    asyncio.run(main.shutdown_event())

    assert transport.is_closed
    assert database._supabase_async is None
    assert database._supabase_async_postgrest_http_client is None
    assert database.async_client_initialised() is False


def test_shutdown_without_an_async_client_does_not_raise(monkeypatch):
    import main

    _stub_sync_closers(monkeypatch)
    monkeypatch.setattr(database, "_supabase_async", None)
    monkeypatch.setattr(database, "_supabase_async_postgrest_http_client", None)

    asyncio.run(main.shutdown_event())
    # A second shutdown (TestClient lifespans restart in one interpreter) is a no-op.
    asyncio.run(main.shutdown_event())

    assert database.async_client_initialised() is False
    assert database._supabase_async_postgrest_http_client is None


# ── FR-004: home-summary runs on per-thread clients ──────────────────────────


_USER = {
    "id": "u-home",
    "email": "learner@example.com",
    "user_metadata": {"display_name": "Lan"},
}


def _stub_auth(monkeypatch):
    from routers import student_home

    async def _user(_authorization):
        return _USER

    monkeypatch.setattr(student_home, "get_supabase_user", _user)


def test_home_summary_route_passes_the_thread_client_factory(monkeypatch):
    from routers import student_home

    _stub_auth(monkeypatch)
    seen = {}

    async def _summary(make_sb, user_id, **kwargs):
        seen.update(make_sb=make_sb, user_id=user_id, kwargs=kwargs)
        return {"ok": True}

    monkeypatch.setattr(student_home, "get_home_summary_concurrent", _summary)

    assert asyncio.run(student_home.home_summary(authorization="Bearer t")) == {"ok": True}
    # The factory itself, called inside each worker thread — not a client built
    # on the loop thread and not the shared sync singleton.
    assert seen["make_sb"] is database.thread_supabase_admin
    assert seen["make_sb"] is not database.supabase_admin
    assert seen["user_id"] == "u-home"
    assert seen["kwargs"] == {
        "name": "Lan", "email": "learner@example.com", "account_name": "Lan",
    }


def test_home_summary_sections_each_use_their_threads_own_client(monkeypatch):
    from routers import student_home
    from services import student_home_aggregator as agg

    _stub_auth(monkeypatch)
    lock = threading.Lock()
    used: list = []

    def _record(sb):
        # Hold the worker so sections overlap on distinct executor threads.
        time.sleep(0.05)
        with lock:
            used.append((threading.get_ident(), sb, database.thread_supabase_admin()))
        return {}

    for name in ("_build_speaking", "_build_grammar", "_build_vocabulary",
                 "_build_reading", "_build_listening", "_build_streak"):
        monkeypatch.setattr(agg, name, lambda sb, _uid: _record(sb))
    monkeypatch.setattr(agg, "_build_writing", lambda sb, *_a: _record(sb))

    loop_thread = threading.get_ident()
    payload = asyncio.run(student_home.home_summary(authorization="Bearer t"))

    assert payload["student"] == {"name": "Lan", "email": "learner@example.com"}
    assert len(used) == 7
    try:
        for thread, sb, own in used:
            assert thread != loop_thread, "sections run off the event loop"
            assert sb is own, "a section gets the client of the thread it runs on"
            assert sb is not database.supabase_admin, "never the shared singleton"
        by_thread: dict = {}
        for thread, sb, _own in used:
            by_thread.setdefault(thread, set()).add(id(sb))
        assert all(len(ids) == 1 for ids in by_thread.values()), "a thread reuses its client"
        clients = [next(iter(ids)) for ids in by_thread.values()]
        assert len(set(clients)) == len(by_thread) > 1, "threads never share a client"
    finally:
        for _thread, sb, _own in used:
            if sb is not database.supabase_admin:  # never close the shared pool
                sb.postgrest.session.close()
