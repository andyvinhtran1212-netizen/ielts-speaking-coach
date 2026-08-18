"""Gate F exact active-session drain inventory.

The endpoint must never turn a capped scan, missing timestamp or failed count
into a plausible zero that could authorize Legacy player retirement.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import error_logs as el


class _Query:
    def __init__(self, rows):
        self._rows = rows
        self._filters = []
        self._count_mode = None

    def select(self, *_args, **kwargs):
        self._count_mode = kwargs.get("count")
        return self

    def eq(self, field, value):
        self._filters.append(("eq", field, value))
        return self

    def lte(self, field, value):
        self._filters.append(("lte", field, value))
        return self

    def is_(self, field, value):
        self._filters.append(("is", field, value))
        return self

    def limit(self, _value):
        return self

    @staticmethod
    def _timestamp(value):
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))

    def _matches(self, row):
        for operation, field, expected in self._filters:
            value = row.get(field)
            if operation == "eq" and value != expected:
                return False
            if operation == "lte":
                if value is None or self._timestamp(value) > self._timestamp(expected):
                    return False
            if operation == "is" and expected == "null" and value is not None:
                return False
        return True

    def execute(self):
        assert self._count_mode == "exact"
        return SimpleNamespace(count=sum(self._matches(row) for row in self._rows), data=[])


class _Admin:
    def __init__(self, tables, *, missing_count=False):
        self._tables = tables
        self._missing_count = missing_count

    def table(self, name):
        if self._missing_count and name == "dictation_attempts":
            query = _Query(self._tables.get(name, []))

            def _execute():
                return SimpleNamespace(count=None, data=[])

            query.execute = _execute
            return query
        return _Query(self._tables.get(name, []))


def _client(monkeypatch, tables, *, missing_count=False):
    async def _admin(_authorization):
        return {"id": "admin", "role": "admin"}

    monkeypatch.setattr(el, "require_admin", _admin)
    monkeypatch.setattr(
        el,
        "supabase_admin",
        _Admin(tables, missing_count=missing_count),
    )
    app = FastAPI()
    app.include_router(el._admin_router)
    return TestClient(app)


def _row(*, status="in_progress", started_at=None, renderer_affinity=None):
    return {
        "id": "resource",
        "status": status,
        "started_at": started_at,
        "renderer_affinity": renderer_affinity,
    }


def _iso(value):
    return value.isoformat()


def test_counts_pre_cutover_and_missing_timestamps_as_legacy_blockers(monkeypatch):
    now = datetime.now(timezone.utc)
    cutover = now - timedelta(days=2)
    old = _iso(cutover - timedelta(minutes=1))
    new = _iso(cutover + timedelta(minutes=1))
    tables = {
        "sessions": [
            _row(started_at=old),
            _row(started_at=new),
            _row(started_at=None),
            _row(status="completed", started_at=old),
        ],
        "reading_test_attempts": [_row(started_at=new)],
        "listening_test_attempts": [],
        "dictation_attempts": [
            _row(started_at=old),
            _row(started_at=new),
            _row(status="completed", started_at=old),
        ],
        "writing_assignments": [
            _row(status="pending", renderer_affinity="legacy"),
            _row(status="in_progress", renderer_affinity="legacy"),
            _row(status="in_progress", renderer_affinity=None),
            _row(status="in_progress", renderer_affinity="next"),
            _row(status="submitted", renderer_affinity="legacy"),
        ],
    }

    response = _client(monkeypatch, tables).get(
        "/admin/error-logs/legacy-active-session-drain",
        params={"cutover_at": _iso(cutover)},
        headers={"Authorization": "Bearer test"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["schema_version"] == 3
    speaking = body["surfaces"]["speaking"]
    assert speaking == {
        "table": "sessions",
        "active_status": "in_progress",
        "active_total": 3,
        "pre_cutover_active": 1,
        "missing_started_at": 1,
        "legacy_blocking": 2,
        "post_cutover_active": 1,
        "exact": True,
    }
    dictation = body["surfaces"]["listening_dictation"]
    assert dictation == {
        "table": "dictation_attempts",
        "active_status": "in_progress",
        "active_total": 2,
        "pre_cutover_active": 1,
        "missing_started_at": 0,
        "legacy_blocking": 1,
        "post_cutover_active": 1,
        "exact": True,
    }
    writing = body["surfaces"]["writing_assignment"]
    assert writing == {
        "table": "writing_assignments",
        "blocking_renderer_affinities": ["legacy", None],
        "active_statuses": ["pending", "in_progress"],
        "legacy_pending": 1,
        "legacy_in_progress": 1,
        "unclaimed_in_progress": 1,
        "legacy_blocking": 3,
        "exact": True,
    }
    assert body["legacy_blocking_total"] == 6
    assert body["stateful_legacy_drain_zero"] is False
    assert body["retirement_decision"] == "pending-additional-gate-f-evidence"


def test_zero_only_when_every_stateful_pre_cutover_count_is_exactly_zero(monkeypatch):
    now = datetime.now(timezone.utc)
    cutover = now - timedelta(days=1)
    after = _iso(now - timedelta(hours=1))
    tables = {
        "sessions": [_row(started_at=after)],
        "reading_test_attempts": [],
        "listening_test_attempts": [_row(started_at=after)],
        "dictation_attempts": [_row(started_at=after)],
        "writing_assignments": [
            _row(status="pending", renderer_affinity="next"),
            _row(status="submitted", renderer_affinity="legacy"),
        ],
    }

    body = _client(monkeypatch, tables).get(
        "/admin/error-logs/legacy-active-session-drain",
        params={"cutover_at": _iso(cutover)},
        headers={"Authorization": "Bearer test"},
    ).json()

    assert body["exact"] is True
    assert body["legacy_blocking_total"] == 0
    assert body["stateful_legacy_drain_zero"] is True
    assert body["surfaces"]["speaking"]["post_cutover_active"] == 1
    assert body["surfaces"]["listening_test"]["post_cutover_active"] == 1
    assert body["surfaces"]["listening_dictation"]["post_cutover_active"] == 1
    assert body["surfaces"]["writing_assignment"]["legacy_blocking"] == 0


def test_missing_exact_count_fails_closed(monkeypatch):
    now = datetime.now(timezone.utc)
    response = _client(monkeypatch, {}, missing_count=True).get(
        "/admin/error-logs/legacy-active-session-drain",
        params={"cutover_at": _iso(now - timedelta(days=1))},
        headers={"Authorization": "Bearer test"},
    )

    assert response.status_code == 500
    assert response.json()["detail"] == (
        "Không thể xác minh exact active-session drain cho Gate F"
    )


def test_cutover_timestamp_requires_timezone_and_cannot_be_future(monkeypatch):
    client = _client(monkeypatch, {})
    naive = client.get(
        "/admin/error-logs/legacy-active-session-drain",
        params={"cutover_at": "2026-08-17T10:00:00"},
        headers={"Authorization": "Bearer test"},
    )
    future = client.get(
        "/admin/error-logs/legacy-active-session-drain",
        params={"cutover_at": _iso(datetime.now(timezone.utc) + timedelta(days=1))},
        headers={"Authorization": "Bearer test"},
    )

    assert naive.status_code == 422
    assert future.status_code == 422


def test_admin_auth_runs_before_any_table_query(monkeypatch):
    calls = []

    async def _deny(_authorization):
        calls.append("auth")
        raise HTTPException(403, "forbidden")

    class _NeverQuery:
        def table(self, _name):
            calls.append("query")
            raise AssertionError("database must not be queried before auth")

    monkeypatch.setattr(el, "require_admin", _deny)
    monkeypatch.setattr(el, "supabase_admin", _NeverQuery())
    app = FastAPI()
    app.include_router(el._admin_router)
    response = TestClient(app).get(
        "/admin/error-logs/legacy-active-session-drain",
        params={"cutover_at": _iso(datetime.now(timezone.utc) - timedelta(days=1))},
    )

    assert response.status_code == 403
    assert calls == ["auth"]
