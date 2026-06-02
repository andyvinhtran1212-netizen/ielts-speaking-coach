"""reading-access-tracking Part A — per-test password lock.

Security-first: the lock is enforced SERVER-SIDE. A locked test's bundle / start
is 403'd without the matching X-Reading-Password; the password is never leaked
in the student bundle. Admin lock mints a fresh password each time (old dies).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

_AUTH = {"Authorization": "Bearer fake.user.jwt"}
_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_USER = {"id": "00000000-0000-0000-0000-00000000bbbb", "email": "u@x"}
_ADMIN = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "a@x"}


def _client():
    from main import app
    return TestClient(app, raise_server_exceptions=False)


class _Chain:
    def __init__(self, data): self._data = data
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def neq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def execute(self): return MagicMock(data=self._data)


# ── Unit: the gate logic (the core security invariant) ────────────────

def _locked_test(pw="ABCD-1234"):
    return {"id": "t-uuid", "test_id": "T1", "metadata": {"access": {"locked": True, "password": pw}}}


def test_gate_rejects_absent_and_wrong_password():
    from routers.reading_student import _require_test_unlocked
    t = _locked_test()
    with pytest.raises(HTTPException) as e1:
        _require_test_unlocked(t, None)
    assert e1.value.status_code == 403
    with pytest.raises(HTTPException) as e2:
        _require_test_unlocked(t, "WRONG-0000")
    assert e2.value.status_code == 403


def test_gate_allows_correct_password_and_unlocked_tests():
    from routers.reading_student import _require_test_unlocked
    _require_test_unlocked(_locked_test("ABCD-1234"), "ABCD-1234")          # correct → ok
    _require_test_unlocked(_locked_test("ABCD-1234"), "  ABCD-1234  ")      # trimmed → ok
    _require_test_unlocked({"metadata": {"access": {"locked": False}}}, None)  # not locked → ok
    _require_test_unlocked({"metadata": {}}, None)                          # no access cfg → ok


# ── Endpoint: locked test is 403'd without the password ───────────────

def test_get_locked_test_403_without_password():
    db = MagicMock()
    db.table.side_effect = lambda name: _Chain([_locked_test()]) if name == "reading_tests" else _Chain([])
    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", db):
        r = _client().get("/api/reading/test/T1", headers=_AUTH)
    assert r.status_code == 403


def test_start_locked_test_403_without_password():
    db = MagicMock()
    db.table.side_effect = lambda name: _Chain([_locked_test()]) if name == "reading_tests" else _Chain([])
    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", db):
        r = _client().post("/api/reading/test/T1/attempts", headers=_AUTH)
    assert r.status_code == 403
    db.table.return_value.insert.assert_not_called()


def test_get_locked_test_200_with_password_and_no_password_leak():
    # correct password → bundle returned; metadata (incl. password) stripped,
    # a safe `locked` flag surfaced.
    db = MagicMock()
    db.table.side_effect = lambda name: _Chain([_locked_test()]) if name == "reading_tests" else _Chain([])
    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", db):
        r = _client().get("/api/reading/test/T1", headers={**_AUTH, "X-Reading-Password": "ABCD-1234"})
    assert r.status_code == 200
    body = r.json()
    assert body.get("locked") is True
    assert "metadata" not in body                  # password never leaked
    assert "ABCD-1234" not in r.text


def test_unlock_endpoint_verifies_password():
    db = MagicMock()
    db.table.side_effect = lambda name: _Chain([_locked_test()])
    with patch("routers.reading_student.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.reading_student.supabase_admin", db):
        ok = _client().post("/api/reading/test/T1/unlock", headers=_AUTH, json={"password": "ABCD-1234"})
        bad = _client().post("/api/reading/test/T1/unlock", headers=_AUTH, json={"password": "x"})
    assert ok.status_code == 200 and ok.json()["ok"] is True
    assert bad.status_code == 403


# ── Admin lock toggle ─────────────────────────────────────────────────

def test_admin_lock_mints_password_and_writes_metadata():
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "t-uuid", "metadata": {"translation_vi": "keep me"}}])
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_reading.supabase_admin", db):
        r = _client().post("/admin/reading/content/tests/T1/lock", headers=_ADMIN_AUTH, json={"locked": True})
    assert r.status_code == 200
    body = r.json()
    assert body["locked"] is True
    assert body["password"] and "-" in body["password"]      # XXXX-XXXX minted
    written = db.table.return_value.update.call_args[0][0]["metadata"]
    assert written["access"]["locked"] is True
    assert written["access"]["password"] == body["password"]
    assert written["translation_vi"] == "keep me"            # other metadata preserved


def test_admin_unlock_clears_password():
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": "t-uuid", "metadata": {"access": {"locked": True, "password": "OLD-0000"}}}])
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_reading.supabase_admin", db):
        r = _client().post("/admin/reading/content/tests/T1/lock", headers=_ADMIN_AUTH, json={"locked": False})
    assert r.status_code == 200
    assert r.json()["locked"] is False and r.json()["password"] is None
    written = db.table.return_value.update.call_args[0][0]["metadata"]
    assert written["access"] == {"locked": False}


def test_admin_lock_requires_admin():
    assert _client().post("/admin/reading/content/tests/T1/lock", json={"locked": True}).status_code == 401
