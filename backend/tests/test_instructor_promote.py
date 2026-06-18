"""W-2 (Option B) — instructor role guard + email-bound promote at /auth/activate.

Covers:
  - require_instructor: instructor/admin pass; user/student 403; admin routes
    still reject instructor (require_admin unchanged).
  - /auth/activate promote gate: ordinary code never promotes; wrong/empty email
    on an instructor-code HARD-403s WITHOUT consuming the code; matching email
    (case-insensitive) promotes atomically + writes a promote_role audit; an
    already-admin user is NOT downgraded.
  - POST /admin/access-codes/generate: mints an email-bound instructor-code and
    rejects an instructor-code with no intended_email.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


_USER_AUTH = {"Authorization": "Bearer fake.user.jwt"}
_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-0000000000aa", "email": "admin@x"}
_UID = "00000000-0000-0000-0000-0000000000bb"


# ── A tiny fake supabase that routes by table name + records writes ──────────

class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, table, fake):
        self._table = table
        self._fake = fake
        self._write = None          # None = read; else (kind, payload)

    # builder no-ops
    def select(self, *a, **k): return self
    def eq(self, *a, **k):     return self
    def neq(self, *a, **k):    return self
    def limit(self, *a, **k):  return self
    def order(self, *a, **k):  return self

    def insert(self, payload):
        self._fake.inserts.append((self._table, payload)); self._write = ("insert", payload); return self

    def update(self, payload):
        self._fake.updates.append((self._table, payload)); self._write = ("update", payload); return self

    def upsert(self, payload, **k):
        self._fake.upserts.append((self._table, payload)); self._write = ("upsert", payload); return self

    def execute(self):
        if self._write is None:
            return _Result(list(self._fake.select_data.get(self._table, [])))
        kind, payload = self._write
        if kind == "insert" and isinstance(payload, list):
            return _Result([{**r, "id": f"id-{i}"} for i, r in enumerate(payload)])
        return _Result([{}])        # benign non-empty for write paths


class _FakeSB:
    def __init__(self, select_data=None):
        self.select_data = select_data or {}
        self.inserts: list = []
        self.updates: list = []
        self.upserts: list = []

    def table(self, name):
        return _Query(name, self)


def _code_row(**over):
    row = {
        "id": str(uuid4()),
        "code": "CODE0001",
        "is_used": False,
        "is_revoked": False,
        "is_active": True,
        "permissions": ["writing"],
        "expires_at": None,
        "grants_role": None,
        "intended_email": None,
    }
    row.update(over)
    return row


def _activate(code_row, *, token_email, user_row=None):
    """Run POST /auth/activate against the fake SB; return (response, fake)."""
    fake = _FakeSB({
        "access_codes": [code_row],
        "users": [user_row] if user_row is not None else [{"id": _UID, "role": "user"}],
        "students": [],
    })
    auth_user = {"id": _UID, "email": token_email, "user_metadata": {}}
    with patch("routers.auth.get_supabase_user", new=AsyncMock(return_value=auth_user)), \
         patch("routers.auth.supabase_admin", fake):
        resp = _client().post("/auth/activate", headers=_USER_AUTH,
                              json={"access_code": code_row["code"]})
    return resp, fake


# ── require_instructor / require_admin ───────────────────────────────────────

def _guard_ctx(role):
    sb = _FakeSB({"users": [{"role": role}]})
    return patch("routers.admin.get_supabase_user",
                 new=AsyncMock(return_value={"id": _UID, "email": "x@y"})), \
           patch("routers.admin.supabase_admin", sb)


@pytest.mark.parametrize("role", ["instructor", "admin"])
def test_require_instructor_allows_instructor_and_admin(role):
    from routers.admin import require_instructor
    p1, p2 = _guard_ctx(role)
    with p1, p2:
        out = _run(require_instructor("Bearer x"))
    assert out["id"] == _UID


@pytest.mark.parametrize("role", ["user", "student", None])
def test_require_instructor_blocks_non_instructor(role):
    from routers.admin import require_instructor
    p1, p2 = _guard_ctx(role)
    with p1, p2, pytest.raises(HTTPException) as ei:
        _run(require_instructor("Bearer x"))
    assert ei.value.status_code == 403


def test_admin_routes_still_block_instructor():
    """An instructor must NOT pass require_admin (no privilege bleed)."""
    from routers.admin import require_admin
    p1, p2 = _guard_ctx("instructor")
    with p1, p2, pytest.raises(HTTPException) as ei:
        _run(require_admin("Bearer x"))
    assert ei.value.status_code == 403


# ── /auth/activate promote gate ──────────────────────────────────────────────

def test_ordinary_code_does_not_promote():
    """grants_role NULL → ordinary activation, role untouched (no 'role' write)."""
    resp, fake = _activate(_code_row(), token_email="student@x.com")
    assert resp.status_code == 200, resp.text
    role_writes = [p for (t, p) in fake.updates if t == "users" and "role" in p]
    assert role_writes == [], f"ordinary code must not write role: {role_writes}"


def test_instructor_code_wrong_email_403_and_not_consumed():
    """Email mismatch → HARD-403 AND the code is NOT consumed (no is_used write)."""
    code = _code_row(grants_role="instructor", intended_email="gv@aver.com")
    resp, fake = _activate(code, token_email="someoneelse@gmail.com")
    assert resp.status_code == 403
    assert "không khớp" in resp.json()["detail"]
    # Fail-closed BEFORE any mutation: code stays valid (no access_codes update).
    assert all(t != "access_codes" for (t, _) in fake.updates), "code must not be consumed"
    assert all(t != "users" for (t, _) in fake.updates), "user must not be activated"
    # The rejected attempt is audited.
    rej = [p for (t, p) in fake.inserts
           if t == "access_code_audit" and p.get("action") == "promote_role_rejected"]
    assert len(rej) == 1 and rej[0]["after"]["reason"] == "email_mismatch"


def test_instructor_code_null_email_403():
    """grants_role='instructor' with NULL intended_email → fail-closed 403."""
    code = _code_row(grants_role="instructor", intended_email=None)
    resp, fake = _activate(code, token_email="anyone@x.com")
    assert resp.status_code == 403
    assert all(t != "access_codes" for (t, _) in fake.updates)


def test_instructor_code_matching_email_promotes_and_audits():
    """Case-insensitive email match → role='instructor' folded into the SAME
    users.update (atomic) + a promote_role audit row."""
    code = _code_row(grants_role="instructor", intended_email="GV@Aver.com")
    resp, fake = _activate(code, token_email="gv@aver.com")   # differs only by case
    assert resp.status_code == 200, resp.text
    role_writes = [p for (t, p) in fake.updates if t == "users" and p.get("role") == "instructor"]
    assert len(role_writes) == 1, "exactly one atomic users.update with role=instructor"
    assert role_writes[0].get("is_active") is True, "promote folded INTO activation (no bolt-tail)"
    aud = [p for (t, p) in fake.inserts
           if t == "access_code_audit" and p.get("action") == "promote_role"]
    assert len(aud) == 1 and aud[0]["after"]["role"] == "instructor"
    assert aud[0]["before"]["role"] == "user"


def test_promote_is_upgrade_only_admin_not_downgraded():
    """An existing admin redeeming a (matching) instructor-code is NOT downgraded."""
    code = _code_row(grants_role="instructor", intended_email="boss@aver.com")
    resp, fake = _activate(code, token_email="boss@aver.com",
                           user_row={"id": _UID, "role": "admin"})
    assert resp.status_code == 200, resp.text
    role_writes = [p for (t, p) in fake.updates if t == "users" and "role" in p]
    assert role_writes == [], "admin must not be downgraded to instructor"


# ── admin generate — mint an email-bound instructor-code ─────────────────────

def test_generate_mints_email_bound_instructor_code():
    fake = _FakeSB()
    with patch("routers.admin.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin.supabase_admin", fake):
        r = _client().post("/admin/access-codes/generate", headers=_ADMIN_AUTH, json={
            "count": 1, "permissions": ["writing"],
            "grants_role": "instructor", "intended_email": "gv@aver.com",
        })
    assert r.status_code == 200, r.text
    rows = [p for (t, p) in fake.inserts if t == "access_codes"][0]
    assert rows[0]["grants_role"] == "instructor"
    assert rows[0]["intended_email"] == "gv@aver.com"
    assert rows[0]["issued_by"] == _ADMIN_USER["id"]    # provenance stamped


def test_generate_instructor_code_requires_intended_email():
    with patch("routers.admin.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin.supabase_admin", _FakeSB()):
        r = _client().post("/admin/access-codes/generate", headers=_ADMIN_AUTH, json={
            "count": 1, "permissions": ["writing"], "grants_role": "instructor",
        })
    assert r.status_code == 400
    assert "intended_email" in r.json()["detail"]
