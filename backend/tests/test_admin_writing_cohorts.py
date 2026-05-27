"""Tests for Sprint 19.2 cohort admin views + fan-out.

  • services/cohort_assignment_service.fan_out_assignment — idempotency
  • routers/admin_writing_cohorts — list aggregation, matrix, auth
  • POST /admin/writing/assignments/fan-out — auth, empty-cohort, happy

Auth + supabase patched (no real DB). For the multi-query cohort
endpoints a tiny chain-router stands in for supabase-py: every chained
call returns self, .execute() returns the canned data for that table.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from routers.admin_writing_cohorts import _cell_status
from services.cohort_assignment_service import fan_out_assignment


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}


# ── chain-router mock ─────────────────────────────────────────────────


class _Chain:
    """Every supabase-py builder call (.select/.eq/.in_/.order/.limit)
    returns self; .execute() returns MagicMock(data=<canned>)."""
    def __init__(self, data):
        self._data = data

    def __getattr__(self, name):
        if name == "execute":
            return lambda: MagicMock(data=self._data)
        return lambda *a, **k: self


def _db(table_map: dict) -> MagicMock:
    db = MagicMock()
    db.table.side_effect = lambda name: _Chain(table_map.get(name, []))
    return db


# ── _cell_status (pure) ───────────────────────────────────────────────


def test_cell_status_derivation():
    # essay present → its status; flagged wins.
    assert _cell_status({"status": "submitted"}, {"status": "delivered", "is_flagged": True}) == "flagged"
    assert _cell_status({"status": "submitted"}, {"status": "grading", "is_flagged": False}) == "grading"
    assert _cell_status({"status": "delivered"}, {"status": "delivered", "is_flagged": False}) == "delivered"
    # no essay → not_submitted, unless the assignment was force-delivered.
    assert _cell_status({"status": "pending"}, None) == "not_submitted"
    assert _cell_status({"status": "delivered"}, None) == "delivered"


# ── fan-out service (idempotency) ─────────────────────────────────────


def _fanout_db(student_ids, already_ids, created_rows):
    """Build a db where students→student_ids, the existing-check→already_ids,
    and the insert→created_rows."""
    db = MagicMock()
    students_chain = db.table.return_value.select.return_value.eq.return_value
    students_chain.execute.return_value = MagicMock(data=[{"id": s} for s in student_ids])
    existing_chain = db.table.return_value.select.return_value.eq.return_value.in_.return_value
    existing_chain.execute.return_value = MagicMock(data=[{"student_id": s} for s in already_ids])
    insert_chain = db.table.return_value.insert.return_value
    insert_chain.execute.return_value = MagicMock(data=created_rows)
    return db


def test_fanout_creates_for_all_new_students():
    db = _fanout_db(["s1", "s2", "s3"], [], [{"id": "a1"}, {"id": "a2"}, {"id": "a3"}])
    r = fan_out_assignment(db, prompt_id=uuid.uuid4(), cohort_id=uuid.uuid4(), assigned_by="admin")
    assert r["student_count"] == 3
    assert r["created_count"] == 3
    assert r["skipped_count"] == 0
    assert len(r["assignment_ids"]) == 3


def test_fanout_skips_students_who_already_have_the_prompt():
    # s1 already assigned → only s2 is created.
    db = _fanout_db(["s1", "s2"], ["s1"], [{"id": "a2"}])
    r = fan_out_assignment(db, prompt_id=uuid.uuid4(), cohort_id=uuid.uuid4(), assigned_by="admin")
    assert r["created_count"] == 1
    assert r["skipped_count"] == 1
    # The insert payload must contain only the new student.
    sent = db.table.return_value.insert.call_args[0][0]
    assert len(sent) == 1


def test_fanout_empty_cohort_creates_nothing():
    db = _fanout_db([], [], [])
    r = fan_out_assignment(db, prompt_id=uuid.uuid4(), cohort_id=uuid.uuid4(), assigned_by="admin")
    assert r == {"student_count": 0, "created_count": 0, "skipped_count": 0, "assignment_ids": []}
    db.table.return_value.insert.assert_not_called()


def test_fanout_all_already_assigned_is_idempotent():
    db = _fanout_db(["s1", "s2"], ["s1", "s2"], [])
    r = fan_out_assignment(db, prompt_id=uuid.uuid4(), cohort_id=uuid.uuid4(), assigned_by="admin")
    assert r["created_count"] == 0
    assert r["skipped_count"] == 2
    db.table.return_value.insert.assert_not_called()


# ── Auth gates ────────────────────────────────────────────────────────


def test_cohort_list_requires_auth():
    assert _client().get("/admin/writing/cohorts").status_code == 401


def test_cohort_detail_requires_auth():
    assert _client().get(f"/admin/writing/cohorts/{uuid.uuid4()}").status_code == 401


def test_fanout_endpoint_requires_auth():
    body = {"prompt_id": str(uuid.uuid4()), "cohort_id": str(uuid.uuid4())}
    assert _client().post("/admin/writing/assignments/fan-out", json=body).status_code == 401


# ── Cohort list aggregation ───────────────────────────────────────────


def test_cohort_list_aggregates_activity():
    table_map = {
        "cohorts": [{"id": "c1", "name": "Lớp A"}, {"id": "c2", "name": "Lớp B"}],
        "students": [
            {"id": "s1", "cohort_id": "c1"}, {"id": "s2", "cohort_id": "c1"},
            {"id": "s3", "cohort_id": "c2"},
        ],
        "writing_assignments": [
            {"student_id": "s1", "essay_id": "e1", "status": "submitted"},   # pending essay
            {"student_id": "s2", "essay_id": "e2", "status": "delivered"},   # delivered
            {"student_id": "s3", "essay_id": None, "status": "pending"},     # not submitted
        ],
        "writing_essays": [
            {"id": "e1", "status": "submitted", "is_flagged": False},
            {"id": "e2", "status": "delivered", "is_flagged": False},
        ],
    }
    with patch("routers.admin_writing_cohorts.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_cohorts.supabase_admin", _db(table_map)):
        r = _client().get("/admin/writing/cohorts", headers=_ADMIN_AUTH)
    assert r.status_code == 200
    cohorts = {c["id"]: c for c in r.json()["cohorts"]}
    assert cohorts["c1"]["student_count"] == 2
    assert cohorts["c1"]["essays_pending"] == 1      # e1 submitted
    assert cohorts["c1"]["essays_delivered"] == 1    # e2 delivered
    assert cohorts["c2"]["student_count"] == 1
    assert cohorts["c2"]["active_assignments"] == 1  # not_submitted counts as active


# ── Cohort detail matrix ──────────────────────────────────────────────


def test_cohort_detail_builds_matrix():
    table_map = {
        "cohorts": [{"id": "c1", "name": "Lớp A"}],
        "students": [
            {"id": "s1", "full_name": "An", "student_code": "A1"},
            {"id": "s2", "full_name": "Bình", "student_code": "B1"},
        ],
        "writing_assignments": [
            {"id": "a1", "student_id": "s1", "prompt_id": "p1", "essay_id": "e1",
             "status": "submitted", "deadline": None, "created_at": "2026-01-01", "updated_at": "2026-01-02"},
            {"id": "a2", "student_id": "s2", "prompt_id": "p1", "essay_id": None,
             "status": "pending", "deadline": None, "created_at": "2026-01-01", "updated_at": "2026-01-01"},
        ],
        "writing_prompts": [{"id": "p1", "title": "Đề 1", "task_type": "task_2"}],
        "writing_essays": [{"id": "e1", "status": "delivered", "is_flagged": False, "overall_band_score": 7.0}],
    }
    cid = "11111111-1111-1111-1111-111111111111"  # path needs a valid UUID
    with patch("routers.admin_writing_cohorts.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_cohorts.supabase_admin", _db(table_map)):
        r = _client().get("/admin/writing/cohorts/" + cid, headers=_ADMIN_AUTH)
    assert r.status_code == 200
    data = r.json()
    assert data["cohort"]["student_count"] == 2
    assert [c["prompt_id"] for c in data["assignments"]] == ["p1"]
    # s1 has a delivered essay; s2 hasn't submitted.
    assert data["matrix"]["s1"]["p1"]["status"] == "delivered"
    assert data["matrix"]["s1"]["p1"]["band"] == 7.0
    assert data["matrix"]["s2"]["p1"]["status"] == "not_submitted"
    assert data["stats"]["essays_delivered"] == 1


def test_cohort_detail_missing_cohort_404():
    with patch("routers.admin_writing_cohorts.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_cohorts.supabase_admin", _db({"cohorts": []})):
        r = _client().get(f"/admin/writing/cohorts/{uuid.uuid4()}", headers=_ADMIN_AUTH)
    assert r.status_code == 404


# ── Fan-out endpoint ──────────────────────────────────────────────────


def test_fanout_endpoint_empty_cohort_400():
    with patch("routers.admin_writing_assignments.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.fan_out_assignment",
               return_value={"student_count": 0, "created_count": 0, "skipped_count": 0, "assignment_ids": []}):
        r = _client().post("/admin/writing/assignments/fan-out",
                           json={"prompt_id": str(uuid.uuid4()), "cohort_id": str(uuid.uuid4())},
                           headers=_ADMIN_AUTH)
    assert r.status_code == 400


def test_fanout_endpoint_happy_returns_counts():
    fake = {"student_count": 3, "created_count": 2, "skipped_count": 1, "assignment_ids": ["a1", "a2"]}
    with patch("routers.admin_writing_assignments.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing_assignments.fan_out_assignment", return_value=fake) as mock_fan:
        r = _client().post("/admin/writing/assignments/fan-out",
                           json={"prompt_id": str(uuid.uuid4()), "cohort_id": str(uuid.uuid4())},
                           headers=_ADMIN_AUTH)
    assert r.status_code == 201
    assert r.json()["created_count"] == 2
    assert r.json()["skipped_count"] == 1
    # assigned_by stamped from the auth context.
    assert mock_fan.call_args.kwargs["assigned_by"] == _ADMIN_USER["id"]
