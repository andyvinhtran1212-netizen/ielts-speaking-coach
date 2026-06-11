"""
tests/test_admin_access_codes_quota.py — Sprint 17.1 (Direction A).

Pins the per-user quota enrichment added to GET /admin/access-codes:
  - `assigned_users[].quota` = {used, limit, remaining, limit_type};
  - session_limit NULL → unlimited;
  - the session count is ONE batched query (no N+1 across codes/users);
  - the existing admin-scope guard (require_admin) is invoked.
"""

import asyncio

import pytest

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
        self._name, self._t = name, tables

    def select(self, *a, **k): return self
    def order(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def eq(self, *a, **k): return self

    def execute(self):
        return _Exec(list(self._t.get(self._name, [])))


class _Stub:
    def __init__(self, tables, calls):
        self._t, self._calls = tables, calls

    def table(self, name):
        self._calls.append(name)
        return _B(name, self._t)


def _install(monkeypatch, tables):
    calls: list = []

    async def _ok(_authz):  # admin guard passes
        return {"id": "admin", "role": "admin"}

    # The list now reads the canonical completed-session counts via
    # get_completed_session_counts (one GROUP BY RPC, no cap). Stub it to count
    # the seeded `sessions` rows per user (the tests treat each seeded row as a
    # completed session) and record the call so the no-N+1 test can assert it
    # ran exactly once over all uids.
    def _counts(uids):
        calls.append(("get_completed_session_counts", list(uids)))
        cc: dict = {}
        wanted = set(uids)
        for row in tables.get("sessions", []):
            u = row.get("user_id")
            if u in wanted:
                cc[u] = cc.get(u, 0) + 1
        return cc

    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", _Stub(tables, calls))
    monkeypatch.setattr(admin_module, "get_completed_session_counts", _counts)
    return calls


def _code(cid="c1", **kw):
    base = {"id": cid, "code": "AAA-111", "is_used": True, "is_revoked": False,
            "is_active": True, "used_by": None, "used_at": None, "created_at": "2026-01-01T00:00:00Z",
            "permissions": ["all"], "session_limit": 10, "expires_at": None,
            "code_type": "mass", "cohort_id": None, "notes": None}
    base.update(kw)
    return base


def test_quota_with_limit(monkeypatch):
    _install(monkeypatch, {
        "access_codes": [_code(session_limit=10)],
        "user_code_assignments": [{"code_id": "c1", "user_id": "u1", "is_active": True}],
        "users": [{"id": "u1", "email": "a@x.com", "display_name": "A"}],
        "sessions": [{"user_id": "u1"}, {"user_id": "u1"}, {"user_id": "u1"}],  # 3 sessions
    })
    out = _run(admin_module.list_access_codes(authorization="Bearer x"))
    q = out[0]["assigned_users"][0]["quota"]
    assert q == {"used": 3, "limit": 10, "remaining": 7, "limit_type": "per_user_via_code"}
    assert out[0]["assigned_users"][0]["email"] == "a@x.com"


def test_quota_unlimited_when_session_limit_null(monkeypatch):
    _install(monkeypatch, {
        "access_codes": [_code(session_limit=None)],
        "user_code_assignments": [{"code_id": "c1", "user_id": "u1", "is_active": True}],
        "users": [{"id": "u1", "email": "a@x.com", "display_name": "A"}],
        "sessions": [{"user_id": "u1"}],
    })
    out = _run(admin_module.list_access_codes(authorization="Bearer x"))
    q = out[0]["assigned_users"][0]["quota"]
    assert q["limit"] is None and q["remaining"] is None and q["limit_type"] == "unlimited"
    assert q["used"] == 1


def test_quota_zero_remaining_clamped(monkeypatch):
    _install(monkeypatch, {
        "access_codes": [_code(session_limit=2)],
        "user_code_assignments": [{"code_id": "c1", "user_id": "u1", "is_active": True}],
        "users": [{"id": "u1", "email": "a@x.com", "display_name": "A"}],
        "sessions": [{"user_id": "u1"}] * 5,  # over the limit
    })
    out = _run(admin_module.list_access_codes(authorization="Bearer x"))
    q = out[0]["assigned_users"][0]["quota"]
    assert q["used"] == 5 and q["remaining"] == 0   # clamped, not negative


def test_completed_counts_batched_once_no_n_plus_1(monkeypatch):
    calls = _install(monkeypatch, {
        "access_codes": [_code("c1"), _code("c2", code="BBB-222")],
        "user_code_assignments": [{"code_id": "c1", "user_id": "u1", "is_active": True},
                                  {"code_id": "c2", "user_id": "u2", "is_active": True}],
        "users": [{"id": "u1", "email": "a@x.com", "display_name": "A"},
                  {"id": "u2", "email": "b@x.com", "display_name": "B"}],
        "sessions": [{"user_id": "u1"}, {"user_id": "u2"}, {"user_id": "u2"}],
    })
    out = _run(admin_module.list_access_codes(authorization="Bearer x"))
    # ONE batched completed-count call over all uids (no per-user N+1).
    batch_calls = [c for c in calls if c[0] == "get_completed_session_counts"]
    assert len(batch_calls) == 1
    assert set(batch_calls[0][1]) == {"u1", "u2"}
    by_code = {c["code"]: c for c in out}
    assert by_code["AAA-111"]["assigned_users"][0]["quota"]["used"] == 1
    assert by_code["BBB-222"]["assigned_users"][0]["quota"]["used"] == 2


def test_removed_user_not_resynthesized_as_legacy_redeemer(monkeypatch):
    """After per-user revoke, the code has only an INACTIVE assignment for the
    redeemer (used_by). The list must NOT re-show them as the owner — they were
    deliberately removed and (post #442) have no access. assigned_users empty.
    """
    _install(monkeypatch, {
        "access_codes": [_code("c1", used_by="u1", is_used=True)],
        "user_code_assignments": [{"code_id": "c1", "user_id": "u1", "is_active": False}],
        "users": [{"id": "u1", "email": "a@x.com", "display_name": "A"}],
        "sessions": [],
    })
    out = _run(admin_module.list_access_codes(authorization="Bearer x"))
    assert out[0]["assigned_user_count"] == 0
    assert out[0]["assigned_users"] == []


def test_true_legacy_usedby_still_synthesized(monkeypatch):
    """A real legacy code — used_by set, NO assignment row at all — still shows
    the redeemer as a non-removable fallback entry."""
    _install(monkeypatch, {
        "access_codes": [_code("c1", used_by="u9", is_used=True)],
        "user_code_assignments": [],  # no row at all
        "users": [{"id": "u9", "email": "legacy@x.com", "display_name": "L"}],
        "sessions": [],
    })
    out = _run(admin_module.list_access_codes(authorization="Bearer x"))
    au = out[0]["assigned_users"]
    assert len(au) == 1
    assert au[0]["is_fallback_used_by"] is True
    assert au[0]["removable"] is False
    assert au[0]["email"] == "legacy@x.com"


def test_admin_guard_invoked(monkeypatch):
    from fastapi import HTTPException

    async def _deny(_authz):
        raise HTTPException(403, "forbidden")

    monkeypatch.setattr(admin_module, "require_admin", _deny)
    monkeypatch.setattr(admin_module, "supabase_admin", _Stub({}, []))
    with pytest.raises(HTTPException) as ei:
        _run(admin_module.list_access_codes(authorization="Bearer x"))
    assert ei.value.status_code == 403
