"""Pin: admin role bypasses MAX_SESSIONS_PER_USER_PER_DAY in POST /sessions.

Sprint Admin Bypass Quota — admins (Andy) need to run unlimited canary
sessions while debugging routing/scoring drifts. The bypass guard wraps
the existing quota check in `if not is_admin:` so:

  - role == "admin"  → quota skipped, session always creates
  - role != "admin"  → quota enforced exactly as before
  - role lookup fail → defensive fallback to quota-applied (treat as
                       non-admin so we don't accidentally open the gate
                       on a transient DB error)

Test mock strategy: same `supabase_admin` instance is hit ~5x per
create_session (is_active, permissions, role, quota count, insert).
The recorder dispatches by the column list passed to `.select()` plus
the table name so each builder returns the right shape. `.insert()`
gets its own branch.
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
    # Quota select on sessions table must be absent — admin path skips it.
    quota_selects = [
        c for c in client.calls
        if c[0] == "sessions" and c[1] == "select"
    ]
    assert quota_selects == [], (
        f"Admin bypass regressed — quota query still ran: {quota_selects}"
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
    # Quota query DID run for non-admin path.
    quota_selects = [
        c for c in client.calls
        if c[0] == "sessions" and c[1] == "select"
    ]
    assert len(quota_selects) == 1
