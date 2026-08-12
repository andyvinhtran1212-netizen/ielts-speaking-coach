"""
tests/test_foot_traffic.py — Sprint 17.4 (Direction D) foot-traffic.

POST /api/analytics/events user attribution (auth → user_id; anonymous/failed →
NULL, never raises) + GET /admin/analytics/foot-traffic aggregation (total /
unique / anonymous / top pages sorted / daily, batched, graceful, admin-guarded).
"""

import asyncio

import pytest

from routers import analytics as analytics_module
from routers import admin as admin_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── POST /api/analytics/events — user attribution ────────────────────────────────

class _InsertStub:
    def __init__(self):
        self.inserted = []

    def table(self, _name): return self
    def insert(self, payload): self.inserted.append(payload); return self
    def execute(self): return type("R", (), {"data": []})()


def _payload():
    return analytics_module.AnalyticsEventPayload(
        event_name="page_view", event_data={"path": "/x"}, session_id="s1"
    )


def test_event_attributes_user_from_token(monkeypatch):
    async def _user(_authz): return {"id": "u1"}
    stub = _InsertStub()
    monkeypatch.setattr(analytics_module, "get_supabase_user", _user)
    monkeypatch.setattr(analytics_module, "supabase_admin", stub)
    out = _run(analytics_module.record_event(_payload(), authorization="Bearer x"))
    assert out == {"ok": True}
    assert stub.inserted[0]["user_id"] == "u1"


def test_event_anonymous_when_no_auth(monkeypatch):
    stub = _InsertStub()
    monkeypatch.setattr(analytics_module, "supabase_admin", stub)
    _run(analytics_module.record_event(_payload(), authorization=None))
    assert stub.inserted[0]["user_id"] is None


def test_event_attribution_never_raises_on_bad_token(monkeypatch):
    async def _boom(_authz): raise RuntimeError("bad token")
    stub = _InsertStub()
    monkeypatch.setattr(analytics_module, "get_supabase_user", _boom)
    monkeypatch.setattr(analytics_module, "supabase_admin", stub)
    out = _run(analytics_module.record_event(_payload(), authorization="Bearer bad"))
    assert out == {"ok": True}                       # tracking never fails the request
    assert stub.inserted[0]["user_id"] is None        # degrades to anonymous


# ── GET /admin/analytics/foot-traffic — aggregation ──────────────────────────────

class _Exec:
    def __init__(self, data): self.data = data


class _Q:
    """PostgREST-shaped query stub with the real ~1000-row response cap.

    DEBT-2026-07-22-G: a bare `.select()` never returns more than `cap` rows and
    says nothing about it. `.range(a, b)` is the only way past that, so a reader
    that doesn't page sees `rows[:cap]` here, exactly like production.
    """

    CAP = 1000

    def __init__(self, rows, calls):
        self._rows, self._calls = rows, calls
        self._cursor_created_at, self._cursor_id, self._limit = None, None, None
        self._created_at_lte = None
        self._route = None

    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def gte(self, *a, **k): return self
    def lte(self, field, value):
        if field == "created_at": self._created_at_lte = value
        return self
    def order(self, *a, **k): return self
    def or_(self, value):
        prefix = "created_at.gt."
        middle = ",and(created_at.eq."
        suffix = ",id.gt."
        if value.startswith(prefix) and middle in value and suffix in value:
            first, rest = value[len(prefix):].split(middle, 1)
            second, raw_id = rest[:-1].split(suffix, 1)
            self._cursor_created_at = first
            id_type = type(self._rows[0]["id"]) if self._rows else str
            self._cursor_id = id_type(raw_id)
            assert first == second
        return self
    def contains(self, field, value):
        if field == "event_data": self._route = value.get("path")
        return self
    def limit(self, value):
        self._limit = value
        return self

    def execute(self):
        self._calls.append("analytics_events")
        rows = sorted(self._rows, key=lambda row: (row.get("created_at", ""), row["id"]))
        if self._cursor_created_at is not None:
            rows = [row for row in rows if (
                row.get("created_at", "") > self._cursor_created_at
                or (row.get("created_at", "") == self._cursor_created_at and row["id"] > self._cursor_id)
            )]
        if self._created_at_lte is not None:
            rows = [row for row in rows if row.get("created_at", "") <= self._created_at_lte]
        if self._route is not None:
            rows = [row for row in rows if (row.get("event_data") or {}).get("path") == self._route]
        cap = min(self._limit or self.CAP, self.CAP)
        return _Exec(list(rows[:cap]))


class _Stub:
    def __init__(self, rows, calls): self._rows, self._calls = rows, calls
    def table(self, _name): return _Q(self._rows, self._calls)


def _install_admin(monkeypatch, rows, calls=None):
    calls = calls if calls is not None else []
    async def _ok(_authz): return {"id": "admin"}
    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", _Stub(rows, calls))
    return calls


def test_foot_traffic_aggregates(monkeypatch):
    rows = [
        {"id": "0001", "user_id": "u1", "event_data": {"path": "/home"}, "created_at": "2026-05-01T08:00:00Z"},
        {"id": "0002", "user_id": "u1", "event_data": {"path": "/home"}, "created_at": "2026-05-01T09:00:00Z"},
        {"id": "0003", "user_id": "u2", "event_data": {"path": "/speaking"}, "created_at": "2026-05-02T10:00:00Z"},
        {"id": "0004", "user_id": None, "event_data": {"path": "/home"}, "created_at": "2026-05-02T11:00:00Z"},
        {"id": "0005", "user_id": None, "event_data": {"path": ["not", "hashable"]}, "created_at": "2026-05-02T12:00:00Z"},
    ]
    calls = _install_admin(monkeypatch, rows)
    out = _run(admin_module.foot_traffic(authorization="x"))
    assert out["total_views"] == 5
    assert out["unique_visitors"] == 2          # u1, u2
    assert out["anonymous_hits"] == 2
    assert out["top_pages"][0] == {"path": "/home", "views": 3}   # sorted desc
    assert {d["date"]: d["views"] for d in out["daily"]} == {"2026-05-01": 2, "2026-05-02": 3}
    assert calls.count("analytics_events") == 2   # data page + empty terminator (no N+1)


def test_foot_traffic_filters_exact_route(monkeypatch):
    rows = [
        {"id": "0001", "user_id": "u1", "event_data": {"path": "/home"}, "created_at": "2026-05-01T08:00:00Z"},
        {"id": "0002", "user_id": "u2", "event_data": {"path": "/speaking"}, "created_at": "2026-05-01T09:00:00Z"},
    ]
    _install_admin(monkeypatch, rows)
    out = _run(admin_module.foot_traffic(authorization="x", route="/speaking"))
    assert out["route"] == "/speaking"
    assert out["total_views"] == 1
    assert out["top_pages"] == [{"path": "/speaking", "views": 1}]


def test_foot_traffic_pages_past_the_postgrest_1000_cap(monkeypatch):
    """DEBT-2026-07-22-G — the unpaginated read truncated at ~1000 rows and every
    derived number came from that arbitrary slice.

    Confirmed live 2026-07-22: the default 30-day view reported "TỔNG LƯỢT XEM
    1000" exactly and the by-day chart showed only 22–27/06 — the OLDEST days in
    the range. Everything after 27/06 was missing from a panel that calls itself
    "last 30 days", so the top-pages table was wrong, not merely incomplete.
    """
    rows = [
        {
            "id": f"{i:05d}",
            "user_id": f"u{i % 37}",
            "event_data": {"path": "/home" if i % 2 else "/speaking"},
            "created_at": f"2026-06-{(i % 28) + 1:02d}T08:00:00Z",
        }
        for i in range(2350)
    ]
    calls = _install_admin(monkeypatch, rows)
    out = _run(admin_module.foot_traffic(authorization="x"))

    assert out["total_views"] == 2350, "rows past the first page were silently dropped"
    assert out["unique_visitors"] == 37
    assert len(out["daily"]) == 28, "the by-day chart must cover the whole window"
    assert sum(d["views"] for d in out["daily"]) == 2350
    assert calls.count("analytics_events") == 4   # 1000 + 1000 + 350 + empty terminator
    assert out["truncated"] is False


def test_foot_traffic_reports_truncation_instead_of_hiding_it(monkeypatch):
    """If the safety ceiling ever does bite, say so. The whole defect class here
    is a plausible number with no signal attached — a silent cap is what made
    this invisible for a month."""
    monkeypatch.setattr(admin_module, "FOOT_TRAFFIC_MAX_ROWS", 2000)
    rows = [
        {"id": f"{i:05d}", "user_id": None, "event_data": {"path": "/x"}, "created_at": "2026-06-01T00:00:00Z"}
        for i in range(3000)
    ]
    _install_admin(monkeypatch, rows)
    out = _run(admin_module.foot_traffic(authorization="x"))
    assert out["truncated"] is True
    assert out["data_status"] == "partial"
    assert out["total_views"] == 2000
    assert out["effective_to"] == "2026-06-01T00:00:00Z"


def test_foot_traffic_orders_stably_for_pagination(monkeypatch):
    """Paging without ORDER BY can repeat or skip rows between pages — PostgREST
    gives no ordering guarantee. Pin the keyset id sort + request watermark."""
    import inspect
    src = inspect.getsource(admin_module.foot_traffic)
    assert '.order("created_at")' in src
    assert '.order("id")' in src
    assert 'q.or_(' in src
    assert '.lte("created_at", effective_to)' in src


def test_foot_traffic_partial_page_failure_is_reported_as_truncated(monkeypatch):
    """Review #821: a transient failure on the SECOND page kept page one and
    left `truncated` false, so the panel presented a partial total, chart and
    ranking as complete — the same silent-incompleteness defect this endpoint
    was just fixed to stop producing."""
    rows = [
        {"id": f"{i:05d}", "user_id": f"u{i}", "event_data": {"path": "/home"},
         "created_at": "2026-06-01T08:00:00Z"}
        for i in range(1500)
    ]

    class _FlakyQ(_Q):
        calls = 0

        def execute(self):
            _FlakyQ.calls += 1
            if _FlakyQ.calls > 1:
                raise RuntimeError("upstream blip on page 2")
            return super().execute()

    class _FlakyStub:
        def table(self, _name):
            return _FlakyQ(rows, [])

    async def _ok(_authz):
        return {"id": "admin"}

    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", _FlakyStub())
    out = _run(admin_module.foot_traffic(authorization="x"))

    assert out["total_views"] == 1000, "page one is kept — still useful"
    assert out["truncated"] is True, "but it must NOT read as a complete window"
    assert out["data_status"] == "partial"


def test_foot_traffic_graceful_on_query_failure(monkeypatch):
    class _BoomStub:
        def table(self, _n):
            raise RuntimeError("db down")
    async def _ok(_authz): return {"id": "admin"}
    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", _BoomStub())
    out = _run(admin_module.foot_traffic(authorization="x"))
    assert out["data_status"] == "unavailable"
    assert out["total_views"] is None and out["top_pages"] == []


def test_foot_traffic_keyset_snapshot_ignores_concurrent_inserts(monkeypatch):
    """A normal newly-recorded row after the request watermark must not leak
    into a later page. This is the hot-table race offset paging cannot model."""
    rows = [
        {"id": f"{i:05d}", "user_id": "u1", "event_data": {"path": "/stable"},
         "created_at": "2026-06-01T08:00:00Z"}
        for i in range(1001)
    ]

    class _ConcurrentQ(_Q):
        calls = 0

        def execute(self):
            result = super().execute()
            _ConcurrentQ.calls += 1
            if _ConcurrentQ.calls == 1:
                rows.append({"id": "zzzzz", "user_id": "u2", "event_data": {"path": "/future-insert"},
                             "created_at": "2999-06-01T08:00:00Z"})
            return result

    class _ConcurrentStub:
        def table(self, _name): return _ConcurrentQ(rows, [])

    async def _ok(_authz): return {"id": "admin"}
    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", _ConcurrentStub())
    out = _run(admin_module.foot_traffic(authorization="x"))

    assert out["data_status"] == "complete"
    assert out["total_views"] == 1001
    assert out["top_pages"] == [{"path": "/stable", "views": 1001}]


def test_foot_traffic_cursor_keeps_native_integer_type(monkeypatch):
    rows = [
        {"id": i, "user_id": "u1", "event_data": {"path": "/numeric"},
         "created_at": "2026-06-01T08:00:00Z"}
        for i in range(1001)
    ]
    _install_admin(monkeypatch, rows)
    out = _run(admin_module.foot_traffic(authorization="x"))
    assert out["data_status"] == "complete"
    assert out["total_views"] == 1001


def test_foot_traffic_pages_when_server_cap_is_below_requested_limit(monkeypatch):
    rows = [
        {"id": f"{i:05d}", "user_id": "u1", "event_data": {"path": "/capped"},
         "created_at": "2026-06-01T08:00:00Z"}
        for i in range(1200)
    ]

    class _CappedQ(_Q):
        CAP = 500

    class _CappedStub:
        def table(self, _name): return _CappedQ(rows, [])

    async def _ok(_authz): return {"id": "admin"}
    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", _CappedStub())
    out = _run(admin_module.foot_traffic(authorization="x"))
    assert out["data_status"] == "complete"
    assert out["total_views"] == 1200


def test_foot_traffic_date_only_end_is_inclusive(monkeypatch):
    rows = [
        {"id": "0001", "user_id": "u1", "event_data": {"path": "/today"},
         "created_at": "2026-01-12T22:00:00+00:00"},
    ]
    _install_admin(monkeypatch, rows)
    out = _run(admin_module.foot_traffic(
        authorization="x", date_from="2026-01-12", date_to="2026-01-12"
    ))
    assert out["data_status"] == "complete"
    assert out["total_views"] == 1


def test_foot_traffic_snapshot_wins_over_future_date_to(monkeypatch):
    rows = [
        {"id": "0001", "user_id": "u1", "event_data": {"path": "/past"},
         "created_at": "2026-01-12T22:00:00+00:00"},
        {"id": "0002", "user_id": "u1", "event_data": {"path": "/future"},
         "created_at": "2999-08-12T22:00:00+00:00"},
    ]
    _install_admin(monkeypatch, rows)
    out = _run(admin_module.foot_traffic(
        authorization="x", date_from="2026-01-01", date_to="2999-08-12"
    ))
    assert out["data_status"] == "complete"
    assert out["total_views"] == 1
    assert out["top_pages"] == [{"path": "/past", "views": 1}]


@pytest.mark.parametrize("date_from,date_to", [
    ("not-a-date", None),
    ("2026-08-12", "bad"),
    ("2026-08-13", "2026-08-12"),
])
def test_foot_traffic_rejects_invalid_date_filters(monkeypatch, date_from, date_to):
    from fastapi import HTTPException
    _install_admin(monkeypatch, [])
    with pytest.raises(HTTPException) as exc:
        _run(admin_module.foot_traffic(
            authorization="x", date_from=date_from, date_to=date_to
        ))
    assert exc.value.status_code == 422


def test_foot_traffic_admin_guarded(monkeypatch):
    from fastapi import HTTPException
    async def _deny(_authz): raise HTTPException(403, "forbidden")
    monkeypatch.setattr(admin_module, "require_admin", _deny)
    with pytest.raises(HTTPException) as ei:
        _run(admin_module.foot_traffic(authorization="x"))
    assert ei.value.status_code == 403
