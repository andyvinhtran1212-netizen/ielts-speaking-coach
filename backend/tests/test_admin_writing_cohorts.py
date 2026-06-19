"""Tests for Sprint 19.2 cohort admin views + fan-out.

  • services/cohort_assignment_service.fan_out_assignment — multi-prompt,
    grouping, allow+warn (W-ASSIGN: re-giving in a new Buổi is allowed)
  • routers/admin_writing_cohorts — list aggregation, matrix, auth
  • POST /admin/writing/assignments/fan-out — auth, empty-cohort, happy

Auth + supabase patched (no real DB). For the multi-query cohort
endpoints a tiny chain-router stands in for supabase-py: every chained
call returns self, .execute() returns the canned data for that table.
"""

from __future__ import annotations

import re
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
    # GV-1a: the band-map read goes through the writing_feedback_current view;
    # for single-version test data it == the base table.
    db.table.side_effect = lambda name: _Chain(
        table_map.get("writing_feedback" if name == "writing_feedback_current" else name, []))
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
    """Build a db where students→student_ids (select.eq chain), the
    existing-overlap check→already_ids (select.in_.in_ chain), and the
    insert→created_rows."""
    db = MagicMock()
    students_chain = db.table.return_value.select.return_value.eq.return_value
    students_chain.execute.return_value = MagicMock(data=[{"id": s} for s in student_ids])
    existing_chain = db.table.return_value.select.return_value.in_.return_value.in_.return_value
    existing_chain.execute.return_value = MagicMock(data=[{"student_id": s} for s in already_ids])
    insert_chain = db.table.return_value.insert.return_value
    insert_chain.execute.return_value = MagicMock(data=created_rows)
    return db


def test_fanout_creates_for_all_students():
    db = _fanout_db(["s1", "s2", "s3"], [], [{"id": "a1"}, {"id": "a2"}, {"id": "a3"}])
    r = fan_out_assignment(db, prompt_ids=[uuid.uuid4()], cohort_id=uuid.uuid4(), assigned_by="admin")
    assert r["student_count"] == 3
    assert r["created_count"] == 3
    assert r["duplicates_warning"] == []
    assert r["group_id"] is not None
    assert len(r["assignment_ids"]) == 3


def test_fanout_allow_and_warn_when_student_already_has_a_prompt():
    # W-ASSIGN: re-giving is ALLOWED (a new Buổi) — s1 already had it → still
    # created, just surfaced in duplicates_warning (no skip).
    db = _fanout_db(["s1", "s2"], ["s1"], [{"id": "a1"}, {"id": "a2"}])
    r = fan_out_assignment(db, prompt_ids=[uuid.uuid4()], cohort_id=uuid.uuid4(), assigned_by="admin")
    assert r["created_count"] == 2                 # BOTH created — no skip
    assert r["duplicates_warning"] == ["s1"]
    sent = db.table.return_value.insert.call_args[0][0]
    assert len(sent) == 2                           # both students in the payload


def test_fanout_multi_prompt_creates_students_times_prompts_in_one_group():
    db = _fanout_db(["s1", "s2"], [],
                    [{"id": "a1"}, {"id": "a2"}, {"id": "a3"}, {"id": "a4"}])
    r = fan_out_assignment(db, prompt_ids=[uuid.uuid4(), uuid.uuid4()],
                           cohort_id=uuid.uuid4(), assigned_by="admin")
    sent = db.table.return_value.insert.call_args[0][0]
    assert len(sent) == 4                           # 2 students × 2 prompts
    assert len({row["assignment_group_id"] for row in sent}) == 1   # one shared group
    assert r["group_id"] == sent[0]["assignment_group_id"]


def test_fanout_carries_name_and_allow_soft_check():
    db = _fanout_db(["s1"], [], [{"id": "a1"}])
    fan_out_assignment(db, prompt_ids=[uuid.uuid4()], cohort_id=uuid.uuid4(),
                       assigned_by="admin", name="Buổi 5", allow_soft_check=True)
    sent = db.table.return_value.insert.call_args[0][0]
    assert sent[0]["name"] == "Buổi 5"
    assert sent[0]["allow_soft_check"] is True


def test_fanout_empty_cohort_creates_nothing():
    db = _fanout_db([], [], [])
    r = fan_out_assignment(db, prompt_ids=[uuid.uuid4()], cohort_id=uuid.uuid4(), assigned_by="admin")
    assert r["student_count"] == 0
    assert r["created_count"] == 0
    assert r["group_id"] is None
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
        "writing_essays": [{"id": "e1", "status": "delivered", "is_flagged": False}],
        # Band lives on writing_feedback (essay_id UNIQUE), NOT writing_essays.
        "writing_feedback": [{"essay_id": "e1", "overall_band_score": 7.0}],
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
    assert data["matrix"]["s1"]["p1"]["band"] == 7.0   # sourced from writing_feedback
    assert data["matrix"]["s2"]["p1"]["status"] == "not_submitted"
    assert data["stats"]["essays_delivered"] == 1


def test_cohort_essay_selects_never_reference_overall_band_score():
    """Regression (Bug 1, the 500): overall_band_score is a writing_feedback
    column, never on writing_essays. The canned-data mocks can't catch a bad
    column, so pin the corrected query shape at the source: no writing_essays
    SELECT may project overall_band_score, and the band must be fetched from
    writing_feedback."""
    import inspect
    import routers.admin_writing_cohorts as mod

    src = inspect.getsource(mod)
    # Every writing_essays projection in this module.
    essay_selects = re.findall(
        r'table\(\s*["\']writing_essays["\']\s*\)\s*\.select\(\s*["\']([^"\']+)["\']',
        src,
    )
    assert essay_selects, "expected writing_essays selects to be present"
    for cols in essay_selects:
        assert "overall_band_score" not in cols, (
            f"writing_essays select must NOT project overall_band_score: {cols!r}"
        )
    # Band is sourced from the feedback table/view (GV-1a: the current-version
    # view writing_feedback_current; still NOT from writing_essays).
    assert re.search(
        r'table\(\s*["\']writing_feedback(?:_current)?["\']\s*\)\s*\.select\(\s*["\'][^"\']*overall_band_score',
        src,
    ), "band must be fetched from writing_feedback(_current)"


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
