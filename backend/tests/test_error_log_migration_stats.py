"""ADR-012 cutover dashboard — GET /admin/error-logs/migration-stats.

Pins: aggregation by (implementation, release) from extra tags, untagged
bucket, undismissed/by_level counts, and — critically — explicit pagination
past PostgREST's 1000-row default cap (the admin-stats lesson, PR #688:
a bare select silently truncates and undercounts).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.error_logs as el


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows, order_calls):
        self._rows = rows
        self._range = (0, len(rows) - 1)
        self._order_calls = order_calls

    def __getattr__(self, _name):
        def _chain(*_a, **_kw):
            return self

        return _chain

    def order(self, column, **_kw):
        self._order_calls.append(column)
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def execute(self):
        s, e = self._range
        return _Result(self._rows[s:e + 1])


class _FakeAdmin:
    def __init__(self, rows):
        self._rows = rows
        self.order_calls: list[str] = []

    def table(self, _name):
        return _Query(self._rows, self.order_calls)


def _client(monkeypatch, rows):
    async def _ok(_authz):
        return {"id": "admin", "role": "admin"}

    monkeypatch.setattr(el, "require_admin", _ok)
    fake = _FakeAdmin(rows)
    monkeypatch.setattr(el, "supabase_admin", fake)
    app = FastAPI()
    app.include_router(el.router)
    app.include_router(el._admin_router)
    client = TestClient(app)
    client.fake_admin = fake  # type: ignore[attr-defined]
    return client


def test_groups_by_implementation_release_with_untagged_bucket(monkeypatch):
    rows = [
        {"level": "error", "dismissed_at": None,
         "extra": {"implementation": "next", "release": "abcdef1234567890"}},
        {"level": "warning", "dismissed_at": "2026-07-13T00:00:00Z",
         "extra": {"implementation": "next", "release": "abcdef1234567890"}},
        {"level": "error", "dismissed_at": None,
         "extra": {"implementation": "legacy", "release": "abcdef1234567890"}},
        {"level": "error", "dismissed_at": None, "extra": None},        # pre-tagging report
        {"level": "error", "dismissed_at": None, "extra": "corrupt"},   # non-dict extra
    ]
    res = _client(monkeypatch, rows).get(
        "/admin/error-logs/migration-stats", headers={"Authorization": "Bearer x"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["scanned"] == 5 and body["truncated"] is False
    by_key = {(r["implementation"], r["release"]): r for r in body["rows"]}
    nxt = by_key[("next", "abcdef123456")]  # release truncated to 12 chars
    assert nxt["total"] == 2 and nxt["undismissed"] == 1
    assert nxt["by_level"] == {"error": 1, "warning": 1}
    assert by_key[("legacy", "abcdef123456")]["total"] == 1
    assert by_key[("untagged", "untagged")]["total"] == 2


def test_paginates_past_postgrest_1000_cap(monkeypatch):
    rows = [
        {"level": "error", "dismissed_at": None,
         "extra": {"implementation": "legacy", "release": "r1"}}
    ] * 1500
    client = _client(monkeypatch, rows)
    res = client.get(
        "/admin/error-logs/migration-stats", headers={"Authorization": "Bearer x"}
    )
    body = res.json()
    assert body["scanned"] == 1500, "bare-select 1000-cap must not undercount"
    assert body["rows"][0]["total"] == 1500
    # Offset pagination REQUIRES a stable order or pages can overlap/skip
    # under concurrent inserts (review #746) — pin the order() calls.
    assert "occurred_at" in client.fake_admin.order_calls
    assert "id" in client.fake_admin.order_calls


def test_days_param_clamped(monkeypatch):
    client = _client(monkeypatch, [])
    assert client.get(
        "/admin/error-logs/migration-stats?days=999",
        headers={"Authorization": "Bearer x"},
    ).json()["window_days"] == 30
    assert client.get(
        "/admin/error-logs/migration-stats?days=0",
        headers={"Authorization": "Bearer x"},
    ).json()["window_days"] == 1
