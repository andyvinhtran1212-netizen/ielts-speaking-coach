"""Perf (B) — token verification reuses ONE keep-alive httpx client.

get_supabase_user() runs on every authenticated request. Opening a fresh
httpx.AsyncClient per call paid a full TLS handshake to Supabase Auth each time
— ~2-3 RTT (~110-170ms) across the Railway(SG) ↔ Supabase(Mumbai) ~56ms hop.
These pin the shared-client contract so a refactor can't silently revert to the
per-call `async with httpx.AsyncClient(...)`.
"""
from __future__ import annotations

import asyncio
import inspect

import httpx

from routers import auth


def test_get_auth_http_client_returns_a_shared_singleton():
    asyncio.run(auth.close_auth_http_client())  # start clean
    c1 = auth._get_auth_http_client()
    c2 = auth._get_auth_http_client()
    assert c1 is c2, "must reuse ONE client (keep-alive pool), not build per call"
    assert isinstance(c1, httpx.AsyncClient)
    asyncio.run(auth.close_auth_http_client())


def test_recreates_after_close():
    c1 = auth._get_auth_http_client()
    asyncio.run(auth.close_auth_http_client())
    c2 = auth._get_auth_http_client()
    assert c1 is not c2, "a closed client must be rebuilt, not reused"
    asyncio.run(auth.close_auth_http_client())


def test_close_is_idempotent():
    auth._get_auth_http_client()
    asyncio.run(auth.close_auth_http_client())
    asyncio.run(auth.close_auth_http_client())  # must not raise on a None client
    assert auth._auth_http_client is None


def test_get_supabase_user_uses_the_shared_client_not_a_per_call_one():
    src = inspect.getsource(auth.get_supabase_user)
    assert "_get_auth_http_client()" in src, "must fetch the shared keep-alive client"
    assert "async with httpx.AsyncClient" not in src, \
        "must NOT open a fresh per-call client (defeats keep-alive)"
