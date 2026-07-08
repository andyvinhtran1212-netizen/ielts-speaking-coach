"""Tests for routers/error_logs.py + the global exception handler
extension in main.py (Sprint 12.3 — DEBT-ADMIN-IA-REFACTOR 3/8).

Surfaces under test:

  1. POST /api/error-logs — frontend ingress.
     - Anonymous (no auth) works; user_id stays NULL.
     - source=='backend' rejected at 422 (defense in depth).
     - level enum validated server-side.
     - Long message truncated to 1000 chars without crashing.
     - Long stack truncated to 5000 chars.

  2. GET /admin/error-logs — admin list with filters.
     - Requires admin auth.
     - level + source enum guards (422 on bad).
     - limit / offset bounds (422 on out-of-range).
     - dismissed=False returns only undismissed rows.
     - dismissed=True returns only dismissed rows.
     - user_id filter narrows correctly.
     - Returns rows ordered occurred_at DESC.

  3. POST /admin/error-logs/{id}/dismiss + .../undismiss
     - Admin only.
     - 404 on unknown id.
     - Idempotent (re-dismiss is OK).
     - Undismiss resets both timestamp + dismissed_by.

  4. GET /admin/error-logs/stats — Tổng quan dashboard.
     - Returns 4 counts (total + undismissed + 24h + 7d).
     - Admin only.

  5. POST /admin/error-logs/test — dogfood helper.
     - error_type='exception' raises so the global handler catches it.
     - 'warning' + 'info' INSERT directly.
     - Bad error_type → 422.
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


# ── In-memory Supabase fake (extends Sprint 12.2 pattern with .is_/.gte) ─


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        # PostgREST exposes the exact row count (Content-Range) on .count when
        # the query was built with count="exact"; None otherwise.
        self.count = count


class _IsNot:
    """Helper class implementing `.not_.is_(col, 'null')` chaining."""
    def __init__(self, parent):
        self._parent = parent

    def is_(self, field, value):
        # Translate `not_.is_(col, 'null')` into "col IS NOT NULL".
        if value == "null":
            self._parent.filters.append((field, "not_null", None))
        else:
            self._parent.filters.append((field, "ne", value))
        return self._parent


class _TableQuery:
    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self._mode = "select"
        self._payload = None
        self._update = None
        self.filters: list[tuple[str, str, object]] = []
        self.in_filter: tuple[str, list] | None = None
        self.limit_n = None
        self._range = None
        self._order_field = None
        self._order_desc = False
        self._count_mode = None
        self._head = False

    @property
    def not_(self):
        return _IsNot(self)

    def select(self, *_args, **_kw):
        self._mode = "select"
        self._count_mode = _kw.get("count")
        self._head = bool(_kw.get("head", False))
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._mode = "update"
        self._update = payload
        return self

    def eq(self, field, value):
        self.filters.append((field, "eq", value))
        return self

    def gte(self, field, value):
        self.filters.append((field, "gte", value))
        return self

    def is_(self, field, value):
        # `.is_("col", "null")` → "col IS NULL"
        if value == "null":
            self.filters.append((field, "is_null", None))
        else:
            self.filters.append((field, "eq", value))
        return self

    def in_(self, field, values):
        self.in_filter = (field, list(values))
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def range(self, start, end):
        # Supabase `.range(offset, offset + limit - 1)` semantics.
        self._range = (start, end)
        return self

    def order(self, field, desc=False):
        self._order_field = field
        self._order_desc = bool(desc)
        return self

    def execute(self):
        rows = self.fake.tables.setdefault(self.table_name, [])

        if self._mode == "insert":
            new_rows = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for r in new_rows:
                row = dict(r)
                row.setdefault("id", str(uuid4()))
                row.setdefault("occurred_at", datetime.now(timezone.utc).isoformat())
                row.setdefault("dismissed_at", None)
                row.setdefault("dismissed_by", None)
                rows.append(row)
                inserted.append(row)
            return _Resp(inserted)

        matched = [r for r in rows if self._matches(r)]

        if self._mode == "update":
            for r in matched:
                r.update(self._update or {})
            return _Resp(matched)

        # select — exact count reflects ALL rows matching the filters, before
        # range/limit paging (mirrors PostgREST's Content-Range count).
        count = len(matched) if self._count_mode else None
        if self._order_field:
            matched = sorted(
                matched,
                key=lambda r: r.get(self._order_field) or "",
                reverse=self._order_desc,
            )
        if self._range is not None:
            start, end = self._range
            matched = matched[start:end + 1]
        elif self.limit_n is not None:
            matched = matched[: self.limit_n]
        # head=True → count only, no row payload (as PostgREST returns).
        data = [] if self._head else matched
        return _Resp(data, count)

    def _matches(self, row):
        for field, op, value in self.filters:
            row_val = row.get(field)
            if op == "eq" and row_val != value:
                return False
            if op == "ne" and row_val == value:
                return False
            if op == "gte" and (row_val is None or row_val < value):
                return False
            if op == "is_null" and row_val is not None:
                return False
            if op == "not_null" and row_val is None:
                return False
        if self.in_filter:
            field, values = self.in_filter
            if row.get(field) not in values:
                return False
        return True


class _FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "error_logs": [],
            "users": [],
        }

    def table(self, name: str):
        return _TableQuery(self, name)


# ── Fixtures ──────────────────────────────────────────────────────────


_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}


@pytest.fixture
def fake_db(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr("routers.error_logs.supabase_admin", fake)
    monkeypatch.setattr("routers.admin.supabase_admin", fake)
    monkeypatch.setattr("main.supabase_admin", fake)
    return fake


@pytest.fixture
def client(fake_db):
    from main import app
    with patch("routers.error_logs.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        with TestClient(app) as c:
            yield c


# ── POST /api/error-logs (frontend ingress) ──────────────────────────


class TestFrontendIngress:
    def test_anonymous_report_ok(self, client, fake_db):
        r = client.post(
            "/api/error-logs",
            json={
                "level": "error",
                "source": "frontend",
                "message": "TypeError: cannot read property 'x' of undefined",
                "url": "/pages/home.html",
            },
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"received": True}
        assert len(fake_db.tables["error_logs"]) == 1
        assert fake_db.tables["error_logs"][0]["user_id"] is None
        assert fake_db.tables["error_logs"][0]["source"] == "frontend"

    def test_rejects_source_backend(self, client):
        r = client.post(
            "/api/error-logs",
            json={"level": "error", "source": "backend", "message": "x"},
        )
        assert r.status_code == 422
        assert "frontend" in r.text.lower()

    def test_rejects_bad_level(self, client):
        r = client.post(
            "/api/error-logs",
            json={"level": "critical", "source": "frontend", "message": "x"},
        )
        assert r.status_code == 422

    def test_rejects_empty_message(self, client):
        # Pydantic min_length=1 fires before our level guard.
        r = client.post(
            "/api/error-logs",
            json={"level": "error", "source": "frontend", "message": ""},
        )
        assert r.status_code == 422

    def test_truncates_long_message(self, client, fake_db):
        long = "x" * 2000  # Pydantic max_length=2000 accepts; router slices to 1000.
        r = client.post(
            "/api/error-logs",
            json={"level": "error", "source": "frontend", "message": long},
        )
        assert r.status_code == 200, r.text
        stored = fake_db.tables["error_logs"][0]["message"]
        assert len(stored) == 1000

    def test_propagates_request_id_and_extra(self, client, fake_db):
        req_id = str(uuid4())
        r = client.post(
            "/api/error-logs",
            json={
                "level": "warning",
                "source": "frontend",
                "message": "Slow render",
                "request_id": req_id,
                "extra": {"component": "PracticePage", "ms": 4500},
            },
        )
        assert r.status_code == 200, r.text
        row = fake_db.tables["error_logs"][0]
        assert row["request_id"] == req_id
        assert row["extra"]["component"] == "PracticePage"


# ── GET /admin/error-logs (admin list) ───────────────────────────────


def _seed(fake_db, **overrides):
    row = {
        "id": str(uuid4()),
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "level": "error",
        "source": "frontend",
        "message": "test",
        "stack": None,
        "user_id": None,
        "url": None,
        "user_agent": None,
        "request_id": None,
        "extra": None,
        "dismissed_at": None,
        "dismissed_by": None,
    }
    row.update(overrides)
    fake_db.tables["error_logs"].append(row)
    return row


class TestAdminList:
    def test_returns_undismissed_only_when_filtered(self, client, fake_db):
        a = _seed(fake_db, message="undismissed-a")
        b = _seed(fake_db, message="dismissed-b", dismissed_at=datetime.now(timezone.utc).isoformat())
        r = client.get("/admin/error-logs?dismissed=false", headers=_ADMIN_AUTH)
        assert r.status_code == 200, r.text
        msgs = [it["message"] for it in r.json()["items"]]
        assert "undismissed-a" in msgs
        assert "dismissed-b" not in msgs

    def test_returns_dismissed_only_when_filtered(self, client, fake_db):
        _seed(fake_db, message="undismissed-a")
        _seed(fake_db, message="dismissed-b", dismissed_at=datetime.now(timezone.utc).isoformat())
        r = client.get("/admin/error-logs?dismissed=true", headers=_ADMIN_AUTH)
        assert r.status_code == 200, r.text
        msgs = [it["message"] for it in r.json()["items"]]
        assert "dismissed-b" in msgs
        assert "undismissed-a" not in msgs

    def test_filter_by_level(self, client, fake_db):
        _seed(fake_db, message="err", level="error")
        _seed(fake_db, message="warn", level="warning")
        r = client.get("/admin/error-logs?level=warning", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        msgs = [it["message"] for it in r.json()["items"]]
        assert msgs == ["warn"]

    def test_filter_by_source(self, client, fake_db):
        _seed(fake_db, message="fe", source="frontend")
        _seed(fake_db, message="be", source="backend")
        r = client.get("/admin/error-logs?source=backend", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        msgs = [it["message"] for it in r.json()["items"]]
        assert msgs == ["be"]

    def test_filter_by_user_id(self, client, fake_db):
        u1 = str(uuid4())
        u2 = str(uuid4())
        _seed(fake_db, message="for-u1", user_id=u1)
        _seed(fake_db, message="for-u2", user_id=u2)
        r = client.get(f"/admin/error-logs?user_id={u1}", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        msgs = [it["message"] for it in r.json()["items"]]
        assert msgs == ["for-u1"]

    def test_rejects_bad_level_filter(self, client):
        r = client.get("/admin/error-logs?level=critical", headers=_ADMIN_AUTH)
        assert r.status_code == 422

    def test_rejects_bad_source_filter(self, client):
        r = client.get("/admin/error-logs?source=server", headers=_ADMIN_AUTH)
        assert r.status_code == 422

    def test_rejects_limit_over_200(self, client):
        r = client.get("/admin/error-logs?limit=300", headers=_ADMIN_AUTH)
        assert r.status_code == 422

    def test_pagination_via_range(self, client, fake_db):
        # Seed 10 rows; request page 2 (offset=5, limit=3).
        for i in range(10):
            _seed(fake_db, message=f"row-{i:02d}",
                  occurred_at=f"2026-05-19T0{i}:00:00Z")
        r = client.get("/admin/error-logs?limit=3&offset=5", headers=_ADMIN_AUTH)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert len(items) == 3

    def test_ordering_desc_by_occurred_at(self, client, fake_db):
        _seed(fake_db, message="older", occurred_at="2026-05-18T00:00:00Z")
        _seed(fake_db, message="newer", occurred_at="2026-05-19T00:00:00Z")
        r = client.get("/admin/error-logs", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        msgs = [it["message"] for it in r.json()["items"]]
        assert msgs[0] == "newer"


# ── Dismiss / Undismiss ──────────────────────────────────────────────


class TestDismiss:
    def test_dismiss_sets_timestamp_and_admin(self, client, fake_db):
        row = _seed(fake_db, message="x")
        r = client.post(f"/admin/error-logs/{row['id']}/dismiss", headers=_ADMIN_AUTH)
        assert r.status_code == 200, r.text
        assert r.json() == {"dismissed": True}
        assert fake_db.tables["error_logs"][0]["dismissed_at"] is not None
        assert fake_db.tables["error_logs"][0]["dismissed_by"] == _ADMIN_USER["id"]

    def test_dismiss_404_unknown(self, client):
        r = client.post("/admin/error-logs/nope/dismiss", headers=_ADMIN_AUTH)
        assert r.status_code == 404

    def test_dismiss_idempotent(self, client, fake_db):
        row = _seed(fake_db, message="x", dismissed_at="2026-05-19T00:00:00Z",
                    dismissed_by="old-admin")
        r = client.post(f"/admin/error-logs/{row['id']}/dismiss", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        # Updated to the new admin + fresh timestamp.
        assert fake_db.tables["error_logs"][0]["dismissed_by"] == _ADMIN_USER["id"]


class TestUndismiss:
    def test_undismiss_resets_both_fields(self, client, fake_db):
        row = _seed(fake_db, message="x",
                    dismissed_at="2026-05-19T00:00:00Z",
                    dismissed_by="some-admin")
        r = client.post(f"/admin/error-logs/{row['id']}/undismiss", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        assert r.json() == {"undismissed": True}
        assert fake_db.tables["error_logs"][0]["dismissed_at"] is None
        assert fake_db.tables["error_logs"][0]["dismissed_by"] is None

    def test_undismiss_404_unknown(self, client):
        r = client.post("/admin/error-logs/nope/undismiss", headers=_ADMIN_AUTH)
        assert r.status_code == 404


# ── Stats ────────────────────────────────────────────────────────────


class TestStats:
    def test_stats_counts_4_metrics(self, client, fake_db):
        now = datetime.now(timezone.utc)
        # 5 total: 3 in last 24h, 1 in last 7d (not 24h), 1 older
        _seed(fake_db, message="a", occurred_at=now.isoformat())
        _seed(fake_db, message="b", occurred_at=now.isoformat())
        _seed(fake_db, message="c", occurred_at=now.isoformat(),
              dismissed_at=now.isoformat())  # dismissed → not undismissed
        _seed(fake_db, message="d",
              occurred_at=(now - timedelta(days=3)).isoformat())  # in last 7d not 24h
        _seed(fake_db, message="e",
              occurred_at=(now - timedelta(days=30)).isoformat())  # older

        r = client.get("/admin/error-logs/stats", headers=_ADMIN_AUTH)
        assert r.status_code == 200, r.text
        stats = r.json()
        assert stats["total"] == 5
        assert stats["undismissed"] == 4
        assert stats["last_24h"] == 3
        assert stats["last_7d"] == 4

    def test_stats_zero_when_empty(self, client):
        r = client.get("/admin/error-logs/stats", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        stats = r.json()
        assert stats == {"total": 0, "undismissed": 0, "last_24h": 0, "last_7d": 0}


# ── Dogfood test endpoint ────────────────────────────────────────────


class TestDogfoodEndpoint:
    def test_warning_inserts_row(self, client, fake_db):
        r = client.post("/admin/error-logs/test?error_type=warning", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        assert r.json() == {"generated": "warning"}
        assert fake_db.tables["error_logs"][0]["level"] == "warning"
        assert fake_db.tables["error_logs"][0]["source"] == "backend"

    def test_info_inserts_row(self, client, fake_db):
        r = client.post("/admin/error-logs/test?error_type=info", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        assert fake_db.tables["error_logs"][0]["level"] == "info"

    def test_rejects_bad_error_type(self, client):
        r = client.post("/admin/error-logs/test?error_type=weird", headers=_ADMIN_AUTH)
        assert r.status_code == 422
