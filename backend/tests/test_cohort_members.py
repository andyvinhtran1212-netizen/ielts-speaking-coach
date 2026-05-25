"""
tests/test_cohort_members.py — Sprint 17.3 (Direction C).

GET /admin/cohorts/{id}/members — CODE-DERIVED roster (active assignees of the
cohort's access codes), reusing the Sprint 17.2 usage aggregation. Pins: derives
from codes, excludes inactive assignments, dedupes a multi-code user, 404, guard.
"""

import asyncio

import pytest

from routers import cohorts as cohorts_module
from routers import admin as admin_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _Exec:
    def __init__(self, data):
        self.data = data


class _B:
    def __init__(self, name, tables):
        self._name, self._t, self._eqs = name, tables, []

    def select(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def gte(self, *a, **k): return self
    def lte(self, *a, **k): return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def execute(self):
        rows = list(self._t.get(self._name, []))
        for col, val in self._eqs:
            rows = [r for r in rows if r.get(col) == val]
        return _Exec(rows)


class _Stub:
    def __init__(self, tables):
        self._t = tables

    def table(self, name):
        return _B(name, self._t)


def _install(monkeypatch, tables):
    async def _ok(_authz):
        return {"id": "admin"}
    stub = _Stub(tables)
    monkeypatch.setattr(cohorts_module, "require_admin", _ok)
    # The cohort endpoint queries via cohorts' client; the reused aggregator queries
    # via admin's client — patch BOTH to the same stub.
    monkeypatch.setattr(cohorts_module, "supabase_admin", stub)
    monkeypatch.setattr(admin_module, "supabase_admin", stub)


def test_members_code_derived_excludes_inactive_and_dedupes(monkeypatch):
    _install(monkeypatch, {
        "cohorts": [{"id": "co1", "name": "Lớp A", "is_active": True, "description": "x"}],
        "access_codes": [{"id": "c1", "code": "AAA", "cohort_id": "co1"},
                         {"id": "c2", "code": "BBB", "cohort_id": "co1"},
                         {"id": "cX", "code": "OTHER", "cohort_id": "other"}],
        "user_code_assignments": [
            {"code_id": "c1", "user_id": "u1", "is_active": True},
            {"code_id": "c2", "user_id": "u1", "is_active": True},   # same user, 2nd code → dedupe
            {"code_id": "c1", "user_id": "u2", "is_active": False},  # inactive → excluded
        ],
        "users": [{"id": "u1", "email": "a@x", "display_name": "A"}],
        "sessions": [{"user_id": "u1", "started_at": "2026-01-02T00:00:00Z"},
                     {"user_id": "u1", "started_at": "2026-01-09T00:00:00Z"}],
        "ai_usage_logs": [{"user_id": "u1", "cost_usd_est": 0.05}],
    })
    out = _run(cohorts_module.cohort_members("co1", authorization="x"))
    assert out["member_count"] == 1
    m = out["members"][0]
    assert m["user_id"] == "u1" and m["email"] == "a@x"
    assert m["sessions"] == 2 and m["ai_cost_usd"] == 0.05
    assert m["last_active"] == "2026-01-09T00:00:00Z"


def test_members_empty_when_cohort_has_no_codes(monkeypatch):
    _install(monkeypatch, {
        "cohorts": [{"id": "co1", "name": "Lớp A", "is_active": True}],
        "access_codes": [],   # no codes for this cohort
    })
    out = _run(cohorts_module.cohort_members("co1", authorization="x"))
    assert out["member_count"] == 0 and out["members"] == []


def test_members_404_when_cohort_missing(monkeypatch):
    from fastapi import HTTPException
    _install(monkeypatch, {"cohorts": []})
    with pytest.raises(HTTPException) as ei:
        _run(cohorts_module.cohort_members("nope", authorization="x"))
    assert ei.value.status_code == 404


def test_members_admin_guarded(monkeypatch):
    from fastapi import HTTPException

    async def _deny(_authz):
        raise HTTPException(403, "forbidden")
    monkeypatch.setattr(cohorts_module, "require_admin", _deny)
    monkeypatch.setattr(cohorts_module, "supabase_admin", _Stub({}))
    with pytest.raises(HTTPException) as ei:
        _run(cohorts_module.cohort_members("co1", authorization="x"))
    assert ei.value.status_code == 403
