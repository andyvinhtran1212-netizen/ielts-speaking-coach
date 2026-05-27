"""Tests for Sprint 19.4 student re-grade request flow.

  • Student  POST/GET /api/writing/essays/{id}/regrade-request
  • Admin    GET/PATCH /admin/writing/regrade-requests
  • mark_delivered fulfils an accepted request

Student auth via app.dependency_overrides[get_current_student]; admin via
patched require_admin. Supabase patched (no DB). _decorate is patched to
identity in the admin PATCH tests so the assertions focus on the state
machine, not the context-join queries.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _app():
    from main import app
    return app


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa"}
_STUDENT = {"id": "00000000-0000-0000-0000-0000000000cc", "user_id": "u1"}
_ESSAY = "00000000-0000-0000-0000-0000000000ee"
_REQ = "00000000-0000-0000-0000-0000000000bb"
_REASON = "Em nghĩ phần Task Response chưa được đánh giá đúng, vì em đã nêu đủ hai khía cạnh."  # ≥50


def _routed_db(table_data: dict) -> MagicMock:
    """table(name) → a per-name MagicMock whose any chain ending in
    .execute() returns MagicMock(data=table_data.get(name, []))."""
    cache: dict = {}

    def _make(name):
        if name in cache:
            return cache[name]
        m = MagicMock()
        result = MagicMock(data=table_data.get(name, []))

        class _Chain:
            def __getattr__(self, _):
                return self._call
            def _call(self, *a, **k):
                return self
            def execute(self):
                return result
        chain = _Chain()
        m.select.return_value = chain
        m.insert.return_value = chain
        m.update.return_value = chain
        cache[name] = m
        m._chain = chain
        m._result = result
        return m

    db = MagicMock()
    db.table.side_effect = _make
    db._cache = cache
    return db


# ── Student POST ──────────────────────────────────────────────────────


def _override_student():
    from routers.writing_student import get_current_student
    app = _app()
    app.dependency_overrides[get_current_student] = lambda: _STUDENT
    return app


def _clear_overrides():
    _app().dependency_overrides.clear()


def test_student_regrade_requires_auth():
    # No override → get_current_student runs → 401 without bearer.
    r = TestClient(_app()).post(f"/api/writing/essays/{_ESSAY}/regrade-request", json={"reason": _REASON})
    assert r.status_code == 401


def test_student_regrade_reason_too_short_422():
    app = _override_student()
    try:
        r = TestClient(app).post(f"/api/writing/essays/{_ESSAY}/regrade-request", json={"reason": "ngắn"})
        assert r.status_code == 422
    finally:
        _clear_overrides()


def test_student_regrade_happy_path():
    mock_db = MagicMock()
    tbl = mock_db.table.return_value
    tbl.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": _ESSAY, "status": "delivered"}])
    tbl.insert.return_value.execute.return_value = MagicMock(data=[{"id": _REQ, "status": "pending"}])
    app = _override_student()
    try:
        with patch("routers.writing_student.supabase_admin", mock_db):
            r = TestClient(app).post(f"/api/writing/essays/{_ESSAY}/regrade-request", json={"reason": _REASON})
        assert r.status_code == 200
        assert r.json()["status"] == "pending"
        sent = tbl.insert.call_args[0][0]
        assert sent["student_id"] == _STUDENT["id"]
        assert sent["essay_id"] == str(_ESSAY)
    finally:
        _clear_overrides()


def test_student_regrade_blocked_when_not_delivered():
    mock_db = MagicMock()
    tbl = mock_db.table.return_value
    tbl.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": _ESSAY, "status": "graded"}])   # not delivered
    app = _override_student()
    try:
        with patch("routers.writing_student.supabase_admin", mock_db):
            r = TestClient(app).post(f"/api/writing/essays/{_ESSAY}/regrade-request", json={"reason": _REASON})
        assert r.status_code == 409
    finally:
        _clear_overrides()


def test_student_regrade_not_owner_404():
    mock_db = MagicMock()
    tbl = mock_db.table.return_value
    tbl.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[])   # essay not owned by this student
    app = _override_student()
    try:
        with patch("routers.writing_student.supabase_admin", mock_db):
            r = TestClient(app).post(f"/api/writing/essays/{_ESSAY}/regrade-request", json={"reason": _REASON})
        assert r.status_code == 404
    finally:
        _clear_overrides()


def test_student_regrade_duplicate_409():
    mock_db = MagicMock()
    tbl = mock_db.table.return_value
    tbl.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"id": _ESSAY, "status": "delivered"}])
    tbl.insert.return_value.execute.side_effect = Exception("duplicate key value (23505)")
    app = _override_student()
    try:
        with patch("routers.writing_student.supabase_admin", mock_db):
            r = TestClient(app).post(f"/api/writing/essays/{_ESSAY}/regrade-request", json={"reason": _REASON})
        assert r.status_code == 409
    finally:
        _clear_overrides()


# ── Admin list + action ─────────────────────────────────────────────


def test_admin_list_requires_auth():
    assert TestClient(_app()).get("/admin/writing/regrade-requests").status_code == 401


def test_admin_accept_un_delivers_essay():
    db = _routed_db({
        "essay_regrade_requests": [{"id": _REQ, "status": "pending", "essay_id": _ESSAY}],
        "writing_essays": [{"id": _ESSAY}],   # conditional un-deliver matched a delivered row
    })
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db), \
         patch("routers.admin_writing_regrade._decorate", side_effect=lambda rows: rows):
        r = TestClient(_app()).patch(f"/admin/writing/regrade-requests/{_REQ}",
                                     json={"action": "accept"}, headers=_ADMIN_AUTH)
    assert r.status_code == 200
    # The essay was un-delivered to 'reviewed'.
    essay_update = db._cache["writing_essays"].update.call_args[0][0]
    assert essay_update["status"] == "reviewed"
    assert essay_update["delivered_at"] is None


def test_admin_reject_requires_response():
    db = _routed_db({"essay_regrade_requests": [{"id": _REQ, "status": "pending", "essay_id": _ESSAY}]})
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db), \
         patch("routers.admin_writing_regrade._decorate", side_effect=lambda rows: rows):
        r = TestClient(_app()).patch(f"/admin/writing/regrade-requests/{_REQ}",
                                     json={"action": "reject"}, headers=_ADMIN_AUTH)
    assert r.status_code == 400


def test_admin_reject_persists_response():
    db = _routed_db({"essay_regrade_requests": [{"id": _REQ, "status": "pending", "essay_id": _ESSAY}]})
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db), \
         patch("routers.admin_writing_regrade._decorate", side_effect=lambda rows: rows):
        r = TestClient(_app()).patch(f"/admin/writing/regrade-requests/{_REQ}",
                                     json={"action": "reject", "response": "Band đã đúng theo descriptor."},
                                     headers=_ADMIN_AUTH)
    assert r.status_code == 200
    upd = db._cache["essay_regrade_requests"].update.call_args[0][0]
    assert upd["status"] == "rejected"
    assert upd["admin_response"] == "Band đã đúng theo descriptor."


def test_admin_action_non_pending_409():
    db = _routed_db({"essay_regrade_requests": [{"id": _REQ, "status": "accepted", "essay_id": _ESSAY}]})
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db), \
         patch("routers.admin_writing_regrade._decorate", side_effect=lambda rows: rows):
        r = TestClient(_app()).patch(f"/admin/writing/regrade-requests/{_REQ}",
                                     json={"action": "accept"}, headers=_ADMIN_AUTH)
    assert r.status_code == 409


def test_admin_accept_noop_when_essay_not_delivered_409():
    """Codex C1: accept on a pending request whose essay is no longer
    'delivered' must 409 and leave the request 'pending' (the essay-update
    matched 0 rows → no silent accept)."""
    # essay_regrade_requests: request lookup returns pending; the essay
    # un-deliver update returns data=[] (matched no delivered row).
    db = _routed_db({
        "essay_regrade_requests": [{"id": _REQ, "status": "pending", "essay_id": _ESSAY}],
        "writing_essays": [],   # conditional update (WHERE status='delivered') matched nothing
    })
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db), \
         patch("routers.admin_writing_regrade._decorate", side_effect=lambda rows: rows):
        r = TestClient(_app()).patch(f"/admin/writing/regrade-requests/{_REQ}",
                                     json={"action": "accept"}, headers=_ADMIN_AUTH)
    assert r.status_code == 409
    # The request must NOT have been patched to 'accepted'.
    assert db._cache["essay_regrade_requests"].update.call_count == 0


def test_migration_085_declares_reason_check():
    """Sentinel: the reason-length CHECK is canonical at the DB layer
    (can't exercise a live CHECK without a real Postgres)."""
    import pathlib
    sql = pathlib.Path(__file__).resolve().parents[1].joinpath(
        "migrations", "085_essay_regrade_reason_check.sql").read_text()
    assert "essay_regrade_reason_length" in sql
    assert "char_length(reason) BETWEEN 50 AND 500" in sql
