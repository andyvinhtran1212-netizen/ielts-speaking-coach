"""PUBLICSITE-0059 FR-026, plan 5.7 (G05-T23): GET /api/public/site-info.

Empty settings are null (the page hides the line); the two public flags are
false when the row is missing or the lookup fails; bank details never appear;
the answer is kept 60 s per process. Contact values are fake (example.com and
a placeholder number), never a real channel.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import routers.site_info as site_info
from config import settings

URL = "/api/public/site-info"
FIELDS = (
    "SITE_CONTACT_EMAIL", "SITE_CONTACT_PHONE", "SITE_CONTACT_ZALO", "SITE_CONTACT_REPLY_HOURS",
    "ENROLL_OFFICE_HOURS_TEXT", "ENROLL_CONFIRM_SLA_TEXT", "ENROLL_ESCALATE_AFTER_TEXT",
)


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    site_info._cache.clear()
    for name in FIELDS:
        monkeypatch.setattr(settings, name, "")
    flags: dict[str, object] = {}

    def is_enabled(key, default=True, *, on_error=None):
        value = flags.get(key, default)
        if isinstance(value, Exception):
            return on_error if on_error is not None else default
        return value

    monkeypatch.setattr(site_info.runtime_flags, "is_enabled", is_enabled)
    yield flags
    site_info._cache.clear()


@pytest.fixture()
def client():
    from main import app

    return TestClient(app)


def test_no_settings_every_text_is_null_and_flags_are_off(client):
    r = client.get(URL)
    assert r.status_code == 200
    assert r.json() == {
        "contact": {"email": None, "phone": None, "zalo": None, "reply_hours": None},
        "enroll": {"office_hours": None, "confirm_sla": None, "escalate_after": None},
        "login_code_enabled": False,
        "enroll_prelearn_chapter1": False,
    }
    assert r.headers["cache-control"] == "public, max-age=60"


def test_settings_are_served_trimmed_and_blank_is_null(client, monkeypatch, clean):
    monkeypatch.setattr(settings, "SITE_CONTACT_EMAIL", "  lienhe@example.com ")
    monkeypatch.setattr(settings, "SITE_CONTACT_PHONE", "0900 000 000")  # placeholder, not a real line
    monkeypatch.setattr(settings, "SITE_CONTACT_ZALO", "   ")
    monkeypatch.setattr(settings, "SITE_CONTACT_REPLY_HOURS", "8:00–21:00 mỗi ngày")
    monkeypatch.setattr(settings, "ENROLL_CONFIRM_SLA_TEXT", "trong 4 giờ làm việc")
    clean["email_code_login"] = True
    body = client.get(URL).json()
    assert body["contact"] == {
        "email": "lienhe@example.com", "phone": "0900 000 000", "zalo": None, "reply_hours": "8:00–21:00 mỗi ngày",
    }
    assert body["enroll"] == {"office_hours": None, "confirm_sla": "trong 4 giờ làm việc", "escalate_after": None}
    assert body["login_code_enabled"] is True
    assert body["enroll_prelearn_chapter1"] is False


def test_a_failed_flag_lookup_keeps_the_feature_off(client, clean):
    clean["email_code_login"] = RuntimeError("db down")
    clean["enroll_prelearn_chapter1"] = RuntimeError("db down")
    body = client.get(URL).json()
    assert body["login_code_enabled"] is False
    assert body["enroll_prelearn_chapter1"] is False


def test_a_raising_flag_helper_keeps_the_feature_off(client, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(site_info.runtime_flags, "is_enabled", boom)
    assert client.get(URL).json()["login_code_enabled"] is False


def test_no_bank_or_order_field_is_ever_served(client, monkeypatch):
    for name in FIELDS:
        monkeypatch.setattr(settings, name, "x")
    text = client.get(URL).text.lower()
    for word in ("bank", "account", "bin", "vietqr", "tai_khoan", "so_tk"):
        assert word not in text, word


def test_the_answer_is_kept_60_seconds(client, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(site_info.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(settings, "SITE_CONTACT_EMAIL", "a@example.com")
    assert client.get(URL).json()["contact"]["email"] == "a@example.com"
    monkeypatch.setattr(settings, "SITE_CONTACT_EMAIL", "b@example.com")
    now[0] += 59
    assert client.get(URL).json()["contact"]["email"] == "a@example.com"
    now[0] += 2
    assert client.get(URL).json()["contact"]["email"] == "b@example.com"


def test_no_auth_needed_and_exempt_from_the_activation_gate(client):
    from services.activation_gate import ACTIVATION_EXEMPT_ROUTES

    assert client.get(URL).status_code == 200
    assert ("GET", URL) in ACTIVATION_EXEMPT_ROUTES


def test_cold_cache_flag_lookup_does_not_block_the_event_loop(monkeypatch):
    # Codex P1 / CR #2658: the flag reads on a cache miss are synchronous
    # Supabase calls. A parked lookup must not keep /ping from being served.
    import asyncio
    import threading

    import httpx
    from fastapi import FastAPI

    from tests.loop_gate import WAIT, LoopGate, until

    gate = LoopGate()
    loop_thread: list[int] = []

    def slow_is_enabled(key, default=True, *, on_error=None):
        gate.park()
        return False

    monkeypatch.setattr(site_info.runtime_flags, "is_enabled", slow_is_enabled)

    app = FastAPI()
    app.include_router(site_info.router)

    @app.get("/ping")
    async def ping():
        loop_thread.append(threading.get_ident())
        return {"ok": True}

    async def scenario():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            slow = asyncio.ensure_future(client.get(URL))
            try:
                reached = await until(lambda: gate.inside >= 1, stop=slow)
                pong = await asyncio.wait_for(client.get("/ping"), WAIT)
                parked = reached and not slow.done() and not gate.released
            finally:
                gate.release()
            return await asyncio.wait_for(slow, WAIT), pong, parked

    info, pong, parked = asyncio.run(scenario())
    assert not gate.timed_out, "the flag lookup ran on the event loop"
    assert parked, "/ping must be served while the flag lookup is still parked"
    assert pong.status_code == 200
    assert info.status_code == 200
    assert info.json()["login_code_enabled"] is False
    assert gate.threads[0] != loop_thread[0]
