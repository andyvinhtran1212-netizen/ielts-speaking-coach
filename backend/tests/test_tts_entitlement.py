"""F05 — POST /tts must not spend OpenAI budget for an unentitled account.

Staging audit F05: /tts only authenticated the caller, then called OpenAI tts-1.
Signup is open, so any free account could burn TTS money. The route now runs a
per-IP minute throttle, the Speaking entitlement guard, and a per-user daily
quota — all before synthesize_mp3 — and the 502 wrapper must not swallow the
guards' 403/429. synthesize_mp3 is mocked throughout — no network.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import sessions as sessions_module
from routers import tts as tts_module

OWNER = "user-1"


def _run(coro):
    return asyncio.run(coro)


def _body(text="Describe your hometown."):
    return tts_module.TTSRequest(text=text, voice="nova")


class _CountQuery:
    """ai_usage_logs stand-in: records filters, returns a fixed exact count."""

    def __init__(self, count, log, raises=None):
        self._count = count
        self._log = log
        self._raises = raises

    def select(self, *_a, **kwargs):
        self._log.append(("select", kwargs.get("count")))
        return self

    def eq(self, column, value):
        self._log.append(("eq", column, value))
        return self

    def gte(self, column, value):
        self._log.append(("gte", column, value))
        return self

    def execute(self):
        if self._raises:
            raise self._raises
        return SimpleNamespace(data=[], count=self._count)


class _DB:
    def __init__(self, count=0, raises=None):
        self.count = count
        self.raises = raises
        self.tables: list[str] = []
        self.log: list[tuple] = []

    def table(self, name):
        self.tables.append(name)
        return _CountQuery(self.count, self.log, self.raises)


@pytest.fixture
def env(monkeypatch):
    """Authenticated OWNER, entitled, OpenAI configured, synth + ledger mocked."""
    state = SimpleNamespace(synth_calls=[], logged=[], guard_calls=[], db=_DB())

    async def _user(_authorization):
        return {"id": OWNER}

    async def _synth(text, voice):
        state.synth_calls.append((text, voice))
        return b"MP3BYTES"

    async def _log(**kwargs):
        state.logged.append(kwargs)

    def _guard(user_id, session):
        state.guard_calls.append((user_id, session))

    monkeypatch.setattr(tts_module, "get_supabase_user", _user)
    monkeypatch.setattr(tts_module, "require_speaking_entitlement", _guard)
    monkeypatch.setattr(tts_module, "synthesize_mp3", _synth)
    monkeypatch.setattr(tts_module.ai_usage_logger, "log_tts_async", _log)
    monkeypatch.setattr(tts_module, "supabase_admin", state.db)
    monkeypatch.setattr(tts_module.settings, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(tts_module.settings, "TTS_DAILY_LIMIT_PER_USER", 200)
    monkeypatch.setattr(tts_module.settings, "TTS_IP_MAX_PER_MINUTE", 60)
    monkeypatch.setattr(tts_module, "_ip_hits", {})
    return state


# ── Entitlement ────────────────────────────────────────────────────────────

def test_inactive_account_gets_403_and_openai_is_never_called(env, monkeypatch):
    """Real guard, real _require_active: users.is_active=false → 403."""
    users = SimpleNamespace(
        table=lambda _name: _UsersQuery([{"id": OWNER, "is_active": False}]))
    monkeypatch.setattr(sessions_module, "supabase_admin", users)
    monkeypatch.setattr(tts_module, "require_speaking_entitlement",
                        sessions_module.require_speaking_entitlement)

    with pytest.raises(HTTPException) as error:
        _run(tts_module.text_to_speech(_body(), authorization="Bearer x"))
    assert error.value.status_code == 403
    assert env.synth_calls == []
    assert env.logged == []
    assert env.db.tables == []  # quota lookup never reached


def test_active_account_without_speaking_scope_gets_403(env, monkeypatch):
    users = SimpleNamespace(
        table=lambda _name: _UsersQuery([{"id": OWNER, "is_active": True}]))
    monkeypatch.setattr(sessions_module, "supabase_admin", users)
    monkeypatch.setattr(sessions_module, "get_user_access_code_permissions_cached",
                        lambda _uid: ["writing"])
    monkeypatch.setattr(tts_module, "require_speaking_entitlement",
                        sessions_module.require_speaking_entitlement)

    with pytest.raises(HTTPException) as error:
        _run(tts_module.text_to_speech(_body(), authorization="Bearer x"))
    assert error.value.status_code == 403
    assert env.synth_calls == []


def test_guard_runs_sessionless_for_the_authenticated_user(env):
    _run(tts_module.text_to_speech(_body(), authorization="Bearer x"))
    assert env.guard_calls == [(OWNER, None)]


def test_active_entitled_account_gets_audio(env):
    resp = _run(tts_module.text_to_speech(_body("Read this aloud"), authorization="Bearer x"))
    assert resp.status_code == 200
    assert resp.media_type == "audio/mpeg"
    assert resp.body == b"MP3BYTES"
    assert env.synth_calls == [("Read this aloud", "nova")]
    assert env.logged and env.logged[0]["user_id"] == OWNER
    assert env.logged[0]["feature"] == "question_tts"


# ── Per-user daily quota ───────────────────────────────────────────────────

def test_quota_counts_this_users_question_tts_rows_since_utc_midnight(env):
    env.db.count = 5
    _run(tts_module.text_to_speech(_body(), authorization="Bearer x"))
    assert env.db.tables == ["ai_usage_logs"]
    assert ("select", "exact") in env.db.log
    assert ("eq", "user_id", OWNER) in env.db.log
    assert ("eq", "feature", "question_tts") in env.db.log
    gte = [entry for entry in env.db.log if entry[0] == "gte"]
    assert gte == [("gte", "created_at", tts_module._utc_today_start().isoformat())]


def test_quota_exceeded_returns_429_and_openai_is_never_called(env, monkeypatch):
    monkeypatch.setattr(tts_module.settings, "TTS_DAILY_LIMIT_PER_USER", 3)
    env.db.count = 3
    with pytest.raises(HTTPException) as error:
        _run(tts_module.text_to_speech(_body(), authorization="Bearer x"))
    assert error.value.status_code == 429
    detail = error.value.detail
    assert detail["error"] == "rate_limit_exceeded"
    assert detail["limit"] == 3 and detail["used"] == 3
    assert detail["reset_at"] == tts_module._utc_tomorrow_start().isoformat()
    assert env.synth_calls == []


def test_quota_below_limit_is_allowed(env, monkeypatch):
    monkeypatch.setattr(tts_module.settings, "TTS_DAILY_LIMIT_PER_USER", 3)
    env.db.count = 2
    resp = _run(tts_module.text_to_speech(_body(), authorization="Bearer x"))
    assert resp.status_code == 200


def test_quota_lookup_failure_fails_open(env):
    env.db.raises = RuntimeError("db down")
    resp = _run(tts_module.text_to_speech(_body(), authorization="Bearer x"))
    assert resp.status_code == 200
    assert len(env.synth_calls) == 1


def test_non_positive_quota_disables_the_cap(env, monkeypatch):
    monkeypatch.setattr(tts_module.settings, "TTS_DAILY_LIMIT_PER_USER", 0)
    env.db.count = 10_000
    resp = _run(tts_module.text_to_speech(_body(), authorization="Bearer x"))
    assert resp.status_code == 200
    assert env.db.tables == []


# ── The 502 wrapper must not swallow guard HTTPExceptions ──────────────────

def test_http_exception_inside_the_synth_try_is_not_rewrapped_as_502(env, monkeypatch):
    async def _synth(_text, _voice):
        raise HTTPException(429, "upstream says slow down")
    monkeypatch.setattr(tts_module, "synthesize_mp3", _synth)
    with pytest.raises(HTTPException) as error:
        _run(tts_module.text_to_speech(_body(), authorization="Bearer x"))
    assert error.value.status_code == 429


# ── Per-IP throttle (through FastAPI, so Request injection is exercised) ───

def _client():
    app = FastAPI()
    app.include_router(tts_module.router)
    return TestClient(app)


def test_ip_throttle_returns_429_after_budget(env, monkeypatch):
    monkeypatch.setattr(tts_module.settings, "TTS_IP_MAX_PER_MINUTE", 2)
    client = _client()
    payload = {"text": "Hello", "voice": "nova"}
    headers = {"Authorization": "Bearer x", "X-Forwarded-For": "203.0.113.9, 10.0.0.1"}

    for _ in range(2):
        ok = client.post("/tts", json=payload, headers=headers)
        assert ok.status_code == 200
        assert ok.headers["content-type"] == "audio/mpeg"

    blocked = client.post("/tts", json=payload, headers=headers)
    assert blocked.status_code == 429
    assert blocked.json()["detail"]["error"] == "rate_limit_exceeded"
    assert int(blocked.headers["Retry-After"]) >= 1
    assert len(env.synth_calls) == 2

    # A different client IP has its own window.
    other = client.post("/tts", json=payload,
                        headers={"Authorization": "Bearer x", "X-Forwarded-For": "198.51.100.7"})
    assert other.status_code == 200


def test_ip_throttle_runs_before_auth_and_entitlement(env, monkeypatch):
    monkeypatch.setattr(tts_module.settings, "TTS_IP_MAX_PER_MINUTE", 1)
    client = _client()
    headers = {"Authorization": "Bearer x", "X-Forwarded-For": "203.0.113.10"}
    assert client.post("/tts", json={"text": "Hi"}, headers=headers).status_code == 200
    guard_calls = len(env.guard_calls)
    assert client.post("/tts", json={"text": "Hi"}, headers=headers).status_code == 429
    assert len(env.guard_calls) == guard_calls


def test_ip_window_slides(env, monkeypatch):
    monkeypatch.setattr(tts_module.settings, "TTS_IP_MAX_PER_MINUTE", 1)
    clock = [1000.0]
    monkeypatch.setattr(tts_module.time, "monotonic", lambda: clock[0])
    request = SimpleNamespace(headers={"x-forwarded-for": "203.0.113.11"}, client=None)

    tts_module._throttle_ip(request)
    with pytest.raises(HTTPException) as error:
        tts_module._throttle_ip(request)
    assert error.value.status_code == 429

    clock[0] += tts_module._IP_WINDOW_SECONDS + 1
    tts_module._throttle_ip(request)  # oldest hit expired → allowed again


def test_non_positive_ip_budget_disables_the_throttle(env, monkeypatch):
    monkeypatch.setattr(tts_module.settings, "TTS_IP_MAX_PER_MINUTE", 0)
    request = SimpleNamespace(headers={"x-forwarded-for": "203.0.113.12"}, client=None)
    for _ in range(5):
        tts_module._throttle_ip(request)
    assert tts_module._ip_hits == {}


class _UsersQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, column, value):
        self._rows = [r for r in self._rows if str(r.get(column)) == str(value)]
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)
