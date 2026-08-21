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


def _rpc_db(result: dict) -> MagicMock:
    db = MagicMock()
    db.rpc.return_value.execute.return_value = MagicMock(data=result)
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
    tbl.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = \
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
    tbl.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = \
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
    tbl.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = \
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
    tbl.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = \
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


def test_admin_list_reports_cap_with_301st_sentinel():
    source = [{"id": f"r-{index}", "status": "pending"} for index in range(301)]
    db = _rpc_db({"requests": source[:300], "capped": True})
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db), \
         patch("routers.admin_writing_regrade._decorate", side_effect=lambda rows: rows):
        r = TestClient(_app()).get(
            "/admin/writing/regrade-requests?status=pending", headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    assert len(r.json()["requests"]) == 300
    assert r.json()["capped"] is True
    db.rpc.assert_called_once_with("fn_list_writing_regrade_requests", {
        "p_status": "pending", "p_cohort_id": None,
    })


def test_admin_list_reads_all_lanes_from_one_rpc_snapshot():
    source = [
        {"id": "pending-1", "status": "pending"},
        {"id": "accepted-1", "status": "accepted"},
        {"id": "rejected-1", "status": "rejected"},
        {"id": "fulfilled-1", "status": "fulfilled"},
    ]
    db = _rpc_db({"requests": source, "capped": False})
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db), \
         patch("routers.admin_writing_regrade._decorate", side_effect=lambda rows: rows):
        r = TestClient(_app()).get("/admin/writing/regrade-requests", headers=_ADMIN_AUTH)
    assert r.status_code == 200
    assert [row["id"] for row in r.json()["requests"]] == [row["id"] for row in source]
    db.rpc.assert_called_once_with("fn_list_writing_regrade_requests", {
        "p_status": None, "p_cohort_id": None,
    })


def test_admin_list_preserves_secondary_class_filter_context_in_decoration():
    secondary = "00000000-0000-0000-0000-0000000000b2"
    source = [{"id": _REQ, "student_id": _STUDENT["id"], "essay_id": _ESSAY}]
    db = _rpc_db({"requests": source, "capped": False})
    decorated = [{**source[0], "cohort_name": "Lớp B"}]
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db), \
         patch("routers.admin_writing_regrade._decorate", return_value=decorated) as decorate:
        r = TestClient(_app()).get(
            f"/admin/writing/regrade-requests?cohort_id={secondary}", headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    decorate.assert_called_once_with(source, preferred_cohort_id=secondary)
    assert r.json()["requests"][0]["cohort_name"] == "Lớp B"


def test_decorate_labels_secondary_class_selected_by_canonical_filter():
    from routers import admin_writing_regrade as module

    primary = "00000000-0000-0000-0000-0000000000a1"
    secondary = "00000000-0000-0000-0000-0000000000b2"
    db = _routed_db({
        "students": [{
            "id": _STUDENT["id"], "full_name": "Phương Anh",
            "student_code": "C1-001", "cohort_id": primary,
        }],
        "cohorts": [
            {"id": primary, "name": "Lớp A"},
            {"id": secondary, "name": "Lớp B"},
        ],
        "writing_essays": [{
            "id": _ESSAY, "prompt_text": "Prompt", "task_type": "task2",
            "status": "delivered",
        }],
        "writing_feedback_current": [],
    })
    with patch.object(module, "supabase_admin", db):
        row = module._decorate(
            [{"id": _REQ, "student_id": _STUDENT["id"], "essay_id": _ESSAY}],
            preferred_cohort_id=secondary,
        )[0]
    assert row["cohort_name"] == "Lớp B"


def test_admin_accept_un_delivers_essay():
    db = _rpc_db({"ok": True, "request": {"id": _REQ, "status": "accepted", "essay_id": _ESSAY}})
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db), \
         patch("routers.admin_writing_regrade._decorate", side_effect=lambda rows: rows):
        r = TestClient(_app()).patch(f"/admin/writing/regrade-requests/{_REQ}",
                                     json={"action": "accept"}, headers=_ADMIN_AUTH)
    assert r.status_code == 200
    assert r.json()["status"] == "accepted"
    db.rpc.assert_called_once_with("fn_action_writing_regrade_request", {
        "p_request_id": _REQ, "p_admin_id": _ADMIN_USER["id"],
        "p_action": "accept", "p_response": None,
    })


def test_admin_reject_requires_response():
    db = MagicMock()
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db), \
         patch("routers.admin_writing_regrade._decorate", side_effect=lambda rows: rows):
        r = TestClient(_app()).patch(f"/admin/writing/regrade-requests/{_REQ}",
                                     json={"action": "reject"}, headers=_ADMIN_AUTH)
    assert r.status_code == 400


def test_admin_reject_persists_response():
    db = _rpc_db({"ok": True, "request": {
        "id": _REQ, "status": "rejected", "essay_id": _ESSAY,
        "admin_response": "Band đã đúng theo descriptor.",
    }})
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db), \
         patch("routers.admin_writing_regrade._decorate", side_effect=lambda rows: rows):
        r = TestClient(_app()).patch(f"/admin/writing/regrade-requests/{_REQ}",
                                     json={"action": "reject", "response": "Band đã đúng theo descriptor."},
                                     headers=_ADMIN_AUTH)
    assert r.status_code == 200
    assert r.json()["admin_response"] == "Band đã đúng theo descriptor."
    assert db.rpc.call_args.args[1]["p_response"] == "Band đã đúng theo descriptor."


def test_admin_action_non_pending_409():
    db = _rpc_db({"ok": False, "reason": "already_actioned", "status": "accepted"})
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
    db = _rpc_db({"ok": False, "reason": "essay_not_delivered", "essay_status": "reviewed"})
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db), \
         patch("routers.admin_writing_regrade._decorate", side_effect=lambda rows: rows):
        r = TestClient(_app()).patch(f"/admin/writing/regrade-requests/{_REQ}",
                                     json={"action": "accept"}, headers=_ADMIN_AUTH)
    assert r.status_code == 409


def test_admin_action_rejects_malformed_rpc_acknowledgement():
    db = _rpc_db({"ok": True, "request": {"id": "wrong", "status": "accepted"}})
    with patch("routers.admin_writing_regrade.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_regrade.supabase_admin", db):
        r = TestClient(_app()).patch(
            f"/admin/writing/regrade-requests/{_REQ}",
            json={"action": "accept"}, headers=_ADMIN_AUTH,
        )
    assert r.status_code == 500


def test_migration_085_declares_reason_check():
    """Sentinel: the reason-length CHECK is canonical at the DB layer
    (can't exercise a live CHECK without a real Postgres)."""
    import pathlib
    sql = pathlib.Path(__file__).resolve().parents[1].joinpath(
        "migrations", "085_essay_regrade_reason_check.sql").read_text()
    assert "essay_regrade_reason_length" in sql
    assert "char_length(reason) BETWEEN 50 AND 500" in sql


def test_migration_205_makes_action_and_delivery_atomic_service_role_only():
    import pathlib
    sql = pathlib.Path(__file__).resolve().parents[1].joinpath(
        "migrations", "205_writing_regrade_atomic_transitions.sql").read_text()
    assert "fn_action_writing_regrade_request" in sql
    assert "fn_deliver_writing_essay" in sql
    assert "fn_fulfil_writing_regrade_on_delivery" in sql
    assert "AFTER UPDATE OF status ON writing_essays" in sql
    assert "FOR UPDATE" in sql
    assert "Global lock order is essay → request" in sql
    assert "REVOKE EXECUTE" in sql
    assert "TO service_role" in sql
