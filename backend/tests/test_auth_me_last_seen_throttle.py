"""BL-12 — GET /auth/me must not write users.last_seen_at on every call.

/auth/me runs on every page load. The handler used to UPDATE last_seen_at each
time; it now skips the write while the stored value is younger than
LAST_SEEN_WRITE_INTERVAL (5 minutes) and still writes a missing, stale or
unparseable value.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import Response

import routers.auth as auth_module

_USER_ID = "00000000-0000-4000-8000-0000000000bb"
_NOW = datetime(2026, 10, 28, 3, 0, 0, tzinfo=timezone.utc)


class _Result:
    def __init__(self, data):
        self.data = data


class _Builder:
    def __init__(self, admin, table):
        self._admin = admin
        self._table = table
        self._update = None

    def select(self, *_a, **_k):
        return self

    def update(self, payload, *_a, **_k):
        self._update = payload
        return self

    def eq(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        if self._update is not None:
            self._admin.updates.append((self._table, self._update))
            return _Result([self._admin.row])
        return _Result([self._admin.row])


class _FakeAdmin:
    def __init__(self, row):
        self.row = row
        self.updates: list[tuple[str, dict]] = []

    def table(self, name):
        return _Builder(self, name)


class _FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return _NOW if tz else _NOW.replace(tzinfo=None)


def _call_me(monkeypatch, last_seen_at):
    admin = _FakeAdmin({
        "id": _USER_ID, "email": "seen@example.com", "role": "user",
        "is_active": True, "feature_flags": {}, "last_seen_at": last_seen_at,
    })

    async def _fake_user(_authz):
        return {"id": _USER_ID, "email": "seen@example.com", "user_metadata": {}}

    import services.access_code_permissions as acp

    monkeypatch.setattr(auth_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(auth_module, "supabase_admin", admin)
    monkeypatch.setattr(auth_module, "datetime", _FrozenDatetime)
    monkeypatch.setattr(acp, "get_user_access_code_permissions_cached", lambda _uid: [])
    out = asyncio.run(auth_module.get_me(Response(), authorization="Bearer x"))
    assert out["id"] == _USER_ID
    return [payload for table, payload in admin.updates
            if table == "users" and "last_seen_at" in payload]


@pytest.mark.parametrize("last_seen_at", [
    (_NOW - timedelta(seconds=30)).isoformat(),
    (_NOW - timedelta(minutes=4, seconds=59)).isoformat(),
    (_NOW - timedelta(minutes=2)).isoformat().replace("+00:00", "Z"),
])
def test_recent_last_seen_skips_the_write(monkeypatch, last_seen_at):
    assert _call_me(monkeypatch, last_seen_at) == []


@pytest.mark.parametrize("last_seen_at", [
    None,
    "",
    "not-a-timestamp",
    (_NOW - timedelta(minutes=5)).isoformat(),
    (_NOW - timedelta(days=3)).isoformat(),
    (_NOW + timedelta(hours=1)).isoformat(),   # bad future value must not freeze
    "2026-10-28T02:00:00",                      # naive → treated as UTC, stale
])
def test_missing_or_stale_last_seen_is_written(monkeypatch, last_seen_at):
    writes = _call_me(monkeypatch, last_seen_at)
    assert writes == [{"last_seen_at": _NOW.isoformat()}]


def test_two_calls_in_a_row_write_once(monkeypatch):
    """The ticket's repro: two back-to-back /auth/me calls → one write."""
    first = _call_me(monkeypatch, (_NOW - timedelta(hours=1)).isoformat())
    second = _call_me(monkeypatch, first[0]["last_seen_at"])
    assert len(first) == 1 and second == []
