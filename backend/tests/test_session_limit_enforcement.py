"""PR-B — session_limit becomes an enforced lifetime quota (Sprint 5.2 wish #1).

Two layers:
  1. get_user_total_session_limit — SUM of session_limit across the user's LIVE
     codes (chốt C: multi-code = sum); None ("unlimited") when the user has no
     code or any live code is NULL-limit; revoked/expired codes excluded.
  2. create_session enforces it as a LIFETIME quota, SEPARATE from and in
     addition to the daily cap, and skips it for admins.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

import services.access_code_permissions as perms_mod
from routers import sessions as sessions_module
from services.access_code_permissions import get_user_total_session_limit


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── In-memory fake for the helper ────────────────────────────────────────────


class _Builder:
    def __init__(self, rows):
        self._rows, self._preds = rows, []

    def select(self, *_a, **_k): return self
    def eq(self, col, val): self._preds.append((col, val, "eq")); return self
    def in_(self, col, vals): self._preds.append((col, set(vals), "in")); return self

    def execute(self):
        out = []
        for row in self._rows:
            ok = True
            for col, val, op in self._preds:
                if op == "eq" and row.get(col) != val: ok = False; break
                if op == "in" and row.get(col) not in val: ok = False; break
            if ok:
                out.append(dict(row))
        class _R: pass
        r = _R(); r.data = out; return r


class _Fake:
    def __init__(self, assignments, codes):
        self._t = {"user_code_assignments": assignments, "access_codes": codes}

    def table(self, name): return _Builder(self._t.get(name, []))


def _future(): return (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
def _past():   return (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()


def _code(cid, limit, **kw):
    base = {"id": cid, "permissions": ["practice_single"], "session_limit": limit,
            "is_revoked": False, "is_active": True, "expires_at": _future(), "used_by": None}
    base.update(kw)
    return base


def _assign(uid, cid, is_active=True):
    return {"user_id": uid, "code_id": cid, "is_active": is_active}


def _install(monkeypatch, assignments, codes):
    monkeypatch.setattr(perms_mod, "supabase_admin", _Fake(assignments, codes))


# ── 1. get_user_total_session_limit semantics ────────────────────────────────


def test_single_code_limit(monkeypatch):
    _install(monkeypatch, [_assign("u", "c1")], [_code("c1", 10)])
    assert get_user_total_session_limit("u") == 10


def test_multi_code_limits_sum(monkeypatch):
    _install(monkeypatch, [_assign("u", "c1"), _assign("u", "c2")],
             [_code("c1", 10), _code("c2", 5)])
    assert get_user_total_session_limit("u") == 15  # chốt C: SUM


def test_any_null_limit_is_unlimited(monkeypatch):
    _install(monkeypatch, [_assign("u", "c1"), _assign("u", "c2")],
             [_code("c1", 10), _code("c2", None)])
    assert get_user_total_session_limit("u") is None  # one unlimited → unlimited


def test_no_codes_is_unlimited(monkeypatch):
    _install(monkeypatch, [], [])
    assert get_user_total_session_limit("u") is None  # no per-code cap


def test_revoked_and_expired_codes_excluded_from_sum(monkeypatch):
    _install(
        monkeypatch,
        [_assign("u", "live"), _assign("u", "rev"), _assign("u", "exp")],
        [_code("live", 7), _code("rev", 100, is_revoked=True), _code("exp", 100, expires_at=_past())],
    )
    assert get_user_total_session_limit("u") == 7  # only the live code counts


def test_revoked_assignment_excluded(monkeypatch):
    # used_by points at the user but the assignment is inactive (removed) → #442
    # suppresses the legacy fallback, so its limit must not count either.
    _install(monkeypatch, [_assign("u", "c1", is_active=False)], [_code("c1", 50, used_by="u")])
    assert get_user_total_session_limit("u") is None  # no live code → unlimited (no cap)


# ── 2. create_session enforcement ────────────────────────────────────────────


class _SessionsStub:
    """Routes the two sessions counts: the daily check uses .gte('started_at'),
    the lifetime check does not. Returns `daily`/`lifetime` row lists so each
    branch is isolated. role → student. insert → a row."""

    def __init__(self, *, daily, lifetime, role="student"):
        self._daily, self._lifetime, self._role = daily, lifetime, role

    def table(self, name):
        return _SBuilder(self, name)


class _SBuilder:
    def __init__(self, stub, name):
        self._s, self._name = stub, name
        self._has_gte, self._cols, self._insert = False, "", None

    def select(self, cols, *a, **k): self._cols = cols; return self
    def eq(self, *a, **k): return self
    def gte(self, *a, **k): self._has_gte = True; return self
    def limit(self, *a, **k): return self
    def insert(self, payload, *a, **k): self._insert = payload; return self

    def execute(self):
        class _R: pass
        r = _R()
        if self._insert is not None:
            p = self._insert
            r.data = [{"id": "new-sess", "mode": p.get("mode"), "part": p.get("part"),
                       "topic": p.get("topic"), "started_at": "2026-06-11T00:00:00+00:00",
                       "status": "in_progress"}]
        elif self._name == "users":
            r.data = [{"role": self._s._role}]
        elif self._name == "sessions":
            n = self._s._daily if self._has_gte else self._s._lifetime
            r.data = [{"id": f"s{i}"} for i in range(n)]
        else:
            r.data = []
        return r


def _wire(monkeypatch, *, limit, daily=0, lifetime=0, role="student"):
    async def _user(_a): return {"id": "u1"}
    monkeypatch.setattr(sessions_module, "get_supabase_user", _user)
    monkeypatch.setattr(sessions_module, "_require_active", lambda *_a, **_k: None)
    monkeypatch.setattr(sessions_module, "_require_permission", lambda *_a, **_k: None)
    monkeypatch.setattr(sessions_module, "get_user_total_session_limit", lambda _uid: limit)
    monkeypatch.setattr(sessions_module, "supabase_admin",
                        _SessionsStub(daily=daily, lifetime=lifetime, role=role))


def _body():
    return sessions_module.CreateSessionBody(mode="practice", part=1, topic="X")


def test_blocked_when_lifetime_quota_reached(monkeypatch):
    # Under the daily cap (daily=0) but at the per-code lifetime limit.
    _wire(monkeypatch, limit=3, daily=0, lifetime=3)
    with pytest.raises(HTTPException) as ei:
        _run(sessions_module.create_session(_body(), authorization="Bearer x"))
    assert ei.value.status_code == 429
    assert "lượt" in ei.value.detail  # the per-code message, not the daily one


def test_allowed_under_lifetime_quota(monkeypatch):
    _wire(monkeypatch, limit=5, daily=0, lifetime=2)
    out = _run(sessions_module.create_session(_body(), authorization="Bearer x"))
    assert out["session_id"] == "new-sess"


def test_unlimited_when_limit_none(monkeypatch):
    # No per-code cap → lifetime check skipped even with many sessions.
    _wire(monkeypatch, limit=None, daily=0, lifetime=9999)
    out = _run(sessions_module.create_session(_body(), authorization="Bearer x"))
    assert out["session_id"] == "new-sess"


def test_admin_bypasses_lifetime_quota(monkeypatch):
    _wire(monkeypatch, limit=1, daily=0, lifetime=9999, role="admin")
    out = _run(sessions_module.create_session(_body(), authorization="Bearer x"))
    assert out["session_id"] == "new-sess"
