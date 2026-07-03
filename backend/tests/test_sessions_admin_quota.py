"""Pin: admin role bypasses MAX_SESSIONS_PER_USER_PER_DAY in POST /sessions.

Sprint Admin Bypass Quota — admins (Andy) need to run unlimited canary
sessions while debugging routing/scoring drifts. The bypass guard wraps
the existing quota check in `if not is_admin:` so:

  - role == "admin"  → quota skipped, session always creates
  - role != "admin"  → quota enforced exactly as before
  - role lookup fail → defensive fallback to quota-applied (treat as
                       non-admin so we don't accidentally open the gate
                       on a transient DB error)

Test mock strategy: same `supabase_admin` instance is hit per create_session
(is_active, permissions, role, then the atomic create RPC). The daily cap +
insert now run inside fn_create_session_daily_capped (migration 126, audit L7),
so the recorder simulates that RPC: it compares the configured `sessions_today`
count against the `p_max_daily` the caller passed and either raises the
`daily_quota_exceeded` sentinel (→ 429) or returns the inserted row. Admins pass
an effectively-unlimited ceiling, so the same RPC still creates for them.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from config import settings
from routers import sessions as sessions_module


def _run(coro):
    """Fresh loop per call — async handler called outside FastAPI."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Smart dispatching mock ───────────────────────────────────────────────


class _Builder:
    """Per-call builder. Returns the data the dispatcher decided is right
    for THIS table + select-columns combination."""

    def __init__(self, data, raise_on_execute=None):
        self._data = data
        self._raise = raise_on_execute

    def select(self, *_a, **_kw):
        return self

    def insert(self, *_a, **_kw):
        return self

    def eq(self, *_a, **_kw):
        return self

    def gte(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def execute(self):
        if self._raise:
            raise self._raise
        class _R:
            pass
        r = _R()
        r.data = list(self._data) if self._data else []
        return r


class _DispatchClient:
    """Routes each `table().select(cols)` / `table().insert()` call to
    a pre-configured builder based on (table, select-columns or 'insert').

    Recorded calls let tests assert the quota query was (or wasn't) made.
    """

    def __init__(
        self,
        *,
        is_active=True,
        permissions=("all",),
        role="student",
        sessions_today=0,
        role_lookup_fails=False,
    ):
        self._is_active = is_active
        self._permissions = list(permissions)
        self._role = role
        self._sessions_today = sessions_today
        self._role_lookup_fails = role_lookup_fails
        self.calls: list[tuple] = []  # (table, action) pairs

    def table(self, name):
        return _TableProxy(self, name)

    def rpc(self, name, params=None):
        """Simulate fn_create_session_daily_capped (L7 atomic create).

        Mirrors the SQL: if the existing daily count is already at/over the
        caller-supplied p_max_daily, raise the daily_quota_exceeded sentinel
        (PostgREST surfaces the RAISE as an error string). Otherwise return the
        inserted session row.
        """
        self.calls.append(("rpc", name, params))
        params = params or {}
        if name == "fn_create_session_daily_capped":
            if self._sessions_today >= params.get("p_max_daily", 0):
                return _Builder(
                    [],
                    raise_on_execute=RuntimeError(
                        "postgrest error: daily_quota_exceeded (P0001)"
                    ),
                )
            return _Builder([{
                "id": "new-session-uuid",
                "mode": params.get("p_mode"),
                "part": params.get("p_part"),
                "topic": params.get("p_topic"),
                "started_at": "2026-05-05T00:00:00+00:00",
                "status": "in_progress",
            }])
        return _Builder([])


class _TableProxy:
    """Captures which select() columns were asked for, then hands back
    the right pre-baked _Builder."""

    def __init__(self, client: _DispatchClient, name: str):
        self._c = client
        self._name = name

    def select(self, cols, *_a, **_kw):
        self._c.calls.append((self._name, "select", cols))
        # users.select("is_active") → _require_active
        if self._name == "users" and "is_active" in cols:
            return _Builder([{"is_active": self._c._is_active}])
        # users.select("permissions") → _require_permission
        if self._name == "users" and "permissions" in cols:
            return _Builder([{"permissions": self._c._permissions}])
        # users.select("role") → admin bypass check
        if self._name == "users" and "role" in cols:
            if self._c._role_lookup_fails:
                return _Builder(
                    [], raise_on_execute=RuntimeError("simulated DB error"),
                )
            return _Builder([{"role": self._c._role}])
        # sessions.select("id") .gte("started_at", ...) → quota count
        if self._name == "sessions" and "id" in cols:
            return _Builder(
                [{"id": f"s{i}"} for i in range(self._c._sessions_today)]
            )
        return _Builder([])

    def insert(self, payload, *_a, **_kw):
        self._c.calls.append((self._name, "insert", payload))
        return _Builder([{
            "id": "new-session-uuid",
            "mode": payload.get("mode"),
            "part": payload.get("part"),
            "topic": payload.get("topic"),
            "started_at": "2026-05-05T00:00:00+00:00",
            "status": "in_progress",
        }])


def _patch(monkeypatch, **client_kwargs):
    client = _DispatchClient(**client_kwargs)

    async def _fake_user(_authz):
        return {"id": "user-uuid-test"}

    monkeypatch.setattr(sessions_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(sessions_module, "supabase_admin", client)
    # PR1 single-source: _require_permission now reads the LIVE access-code
    # query, not users.permissions. Stub it to the client's configured perms so
    # these quota tests exercise the bypass/quota branches with a permitted user.
    monkeypatch.setattr(
        sessions_module,
        "get_user_access_code_permissions_cached",
        lambda _uid: list(client._permissions),
    )
    # These tests pin the DAILY cap + admin bypass, not the per-code lifetime
    # quota. Stub the canonical quota to "unlimited" so create_session's quota
    # check is a no-op (and never touches the real DB). The lifetime-quota path
    # has its own dedicated tests in test_session_limit_enforcement.py.
    monkeypatch.setattr(
        sessions_module,
        "get_user_session_quota",
        lambda _uid: {"used": 0, "limit": None, "remaining": None, "unlimited": True},
    )
    return client


def _body():
    return sessions_module.CreateSessionBody(
        mode="practice", part=1, topic="A favourite place"
    )


# ── Tests ────────────────────────────────────────────────────────────────


def test_admin_bypasses_quota_when_at_limit(monkeypatch):
    """role=='admin' + sessions_today already at MAX → should still
    create. Quota query must NOT be issued."""
    client = _patch(
        monkeypatch,
        role="admin",
        sessions_today=settings.MAX_SESSIONS_PER_USER_PER_DAY,
    )
    out = _run(sessions_module.create_session(_body(), authorization="Bearer x"))
    assert out["session_id"] == "new-session-uuid"
    # Admin bypass: the create RPC must be called with an effectively-unlimited
    # daily ceiling, so being at MAX doesn't block.
    rpc_calls = [c for c in client.calls if c[0] == "rpc"]
    assert len(rpc_calls) == 1
    assert rpc_calls[0][2]["p_max_daily"] > settings.MAX_SESSIONS_PER_USER_PER_DAY, (
        "Admin bypass regressed — RPC got the enforced daily cap, not the bypass ceiling"
    )


def test_non_admin_hits_quota_at_limit(monkeypatch):
    """role!='admin' + sessions_today at MAX → 429. Confirms the bypass
    didn't accidentally open the gate for everyone."""
    _patch(
        monkeypatch,
        role="student",
        sessions_today=settings.MAX_SESSIONS_PER_USER_PER_DAY,
    )
    with pytest.raises(HTTPException) as exc:
        _run(sessions_module.create_session(_body(), authorization="Bearer x"))
    assert exc.value.status_code == 429
    assert str(settings.MAX_SESSIONS_PER_USER_PER_DAY) in exc.value.detail


def test_role_lookup_failure_falls_back_to_quota(monkeypatch):
    """If the role select raises (DB blip), defensively treat as
    non-admin and apply the quota. We must NOT silently let the request
    through on transient errors."""
    _patch(
        monkeypatch,
        role_lookup_fails=True,
        sessions_today=settings.MAX_SESSIONS_PER_USER_PER_DAY,
    )
    with pytest.raises(HTTPException) as exc:
        _run(sessions_module.create_session(_body(), authorization="Bearer x"))
    assert exc.value.status_code == 429, (
        "Role lookup failure must fall back to quota-applied — never "
        "skip-quota — otherwise a DB blip becomes an accidental bypass."
    )


def test_non_admin_under_quota_creates_normally(monkeypatch):
    """Sanity: regular user under the daily limit creates a session
    without hitting any error path."""
    client = _patch(monkeypatch, role="student", sessions_today=2)
    out = _run(sessions_module.create_session(_body(), authorization="Bearer x"))
    assert out["session_id"] == "new-session-uuid"
    # Non-admin path: the create RPC ran with the ENFORCED daily cap.
    rpc_calls = [c for c in client.calls if c[0] == "rpc"]
    assert len(rpc_calls) == 1
    assert rpc_calls[0][2]["p_max_daily"] == settings.MAX_SESSIONS_PER_USER_PER_DAY
