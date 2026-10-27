"""W-ASSIGN-STATUS — writing_assignments follows its essay's lifecycle.

Before the fix only the admin PATCH ever wrote graded_at / delivered_at, so an
assignment stayed `submitted` after AI grading and after the essay was returned
(staging: 8 submitted/graded + 1 submitted/delivered, none graded/delivered).

What we pin:
  - mark_assignment_graded: submitted → graded + graded_at; re-run is a no-op;
    a regrade of a delivered essay never moves the assignment backwards.
  - mark_assignment_delivered: submitted|graded → delivered + delivered_at,
    graded_at back-filled only when NULL; re-run keeps the first delivered_at.
  - revert_assignment_delivery: delivered → graded, delivered_at NULL, graded_at
    kept; re-deliver flips it back to delivered.
  - pending / in_progress untouched; an essay without an assignment is a no-op.
  - a DB failure inside the sync is logged and swallowed — it never breaks the
    grading, instructor deliver, admin single/bulk deliver, mock release, or
    revoke flows that call it.
  - wiring: each lifecycle path calls the right hook (and only on success).
"""

from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from services import essay_service, instructor_workflow, writing_assignment_status_sync as sync
from test_essay_service import (
    _ESSAY_ID as _BG_ESSAY_ID,
    _JOB_ID as _BG_JOB_ID,
    _FakeSupabase as _RecordingSupabase,
    _bg_essay_responses,
    _valid_feedback_obj,
)
from test_instructor_workflow import FakeSupabase


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}


class _ExplodingDb:
    """Every table access raises — stands in for a Supabase outage."""

    def table(self, _name):
        raise RuntimeError("supabase down")


@pytest.fixture
def db(monkeypatch):
    """One stateful fake shared by the sync module and instructor_workflow, so a
    lifecycle test sees the real cross-table effect of each call."""
    fake = FakeSupabase()
    monkeypatch.setattr("services.writing_assignment_status_sync.supabase_admin", fake)
    monkeypatch.setattr("services.instructor_workflow.supabase_admin", fake)
    return fake


def _seed_assignment(db, *, status="submitted", essay_id=None, graded_at=None,
                     delivered_at=None) -> dict:
    row = {
        "id":           str(uuid4()),
        "essay_id":     None if essay_id is None else str(essay_id),
        "status":       status,
        "submitted_at": "2026-10-26T08:00:00+00:00" if essay_id else None,
        "graded_at":    graded_at,
        "delivered_at": delivered_at,
    }
    db.tables.setdefault("writing_assignments", []).append(row)
    return row


# ── mark_assignment_graded ───────────────────────────────────────────


def test_graded_moves_submitted_to_graded_with_timestamp(db):
    essay_id = uuid4()
    row = _seed_assignment(db, essay_id=essay_id)

    sync.mark_assignment_graded(essay_id)

    assert row["status"] == "graded"
    assert row["graded_at"] is not None
    assert row["delivered_at"] is None


def test_graded_rerun_is_idempotent(db):
    essay_id = uuid4()
    row = _seed_assignment(db, essay_id=essay_id)
    sync.mark_assignment_graded(essay_id)
    first_graded_at = row["graded_at"]

    sync.mark_assignment_graded(essay_id)   # same job re-run

    assert row["status"] == "graded"
    assert row["graded_at"] == first_graded_at


def test_regrade_never_moves_delivered_backwards(db):
    essay_id = uuid4()
    row = _seed_assignment(db, essay_id=essay_id, status="delivered",
                           graded_at="2026-10-26T09:00:00+00:00",
                           delivered_at="2026-10-26T10:00:00+00:00")

    sync.mark_assignment_graded(essay_id)   # regrade finished

    assert row["status"] == "delivered"
    assert row["graded_at"] == "2026-10-26T09:00:00+00:00"
    assert row["delivered_at"] == "2026-10-26T10:00:00+00:00"


# ── mark_assignment_delivered ────────────────────────────────────────


def test_delivered_from_graded_keeps_graded_at(db):
    essay_id = uuid4()
    row = _seed_assignment(db, essay_id=essay_id, status="graded",
                           graded_at="2026-10-26T09:00:00+00:00")

    sync.mark_assignment_delivered(essay_id)

    assert row["status"] == "delivered"
    assert row["delivered_at"] is not None
    assert row["graded_at"] == "2026-10-26T09:00:00+00:00"


def test_delivered_from_submitted_backfills_graded_at(db):
    essay_id = uuid4()
    row = _seed_assignment(db, essay_id=essay_id)

    sync.mark_assignment_delivered(essay_id)

    assert row["status"] == "delivered"
    assert row["delivered_at"] is not None
    assert row["graded_at"] is not None


def test_delivered_rerun_keeps_first_delivery(db):
    essay_id = uuid4()
    row = _seed_assignment(db, essay_id=essay_id, status="graded",
                           graded_at="2026-10-26T09:00:00+00:00")
    sync.mark_assignment_delivered(essay_id)
    first_delivered_at = row["delivered_at"]

    sync.mark_assignment_delivered(essay_id)

    assert row["status"] == "delivered"
    assert row["delivered_at"] == first_delivered_at


# ── revert_assignment_delivery ───────────────────────────────────────


def test_revert_steps_delivered_back_to_graded(db):
    essay_id = uuid4()
    row = _seed_assignment(db, essay_id=essay_id, status="delivered",
                           graded_at="2026-10-26T09:00:00+00:00",
                           delivered_at="2026-10-26T10:00:00+00:00")

    sync.revert_assignment_delivery(essay_id)

    assert row["status"] == "graded"
    assert row["delivered_at"] is None
    assert row["graded_at"] == "2026-10-26T09:00:00+00:00"

    sync.mark_assignment_delivered(essay_id)   # re-deliver

    assert row["status"] == "delivered"
    assert row["delivered_at"] is not None
    assert row["graded_at"] == "2026-10-26T09:00:00+00:00"


def test_revert_ignores_non_delivered_rows(db):
    essay_id = uuid4()
    row = _seed_assignment(db, essay_id=essay_id, status="graded",
                           graded_at="2026-10-26T09:00:00+00:00")

    sync.revert_assignment_delivery(essay_id)

    assert row["status"] == "graded"
    assert row["graded_at"] == "2026-10-26T09:00:00+00:00"


# ── guards: untouched states, no assignment, failures ────────────────


@pytest.mark.parametrize("status", ["pending", "in_progress"])
def test_active_assignments_are_never_touched(db, status):
    essay_id = uuid4()
    row = _seed_assignment(db, essay_id=essay_id, status=status)
    before = dict(row)

    sync.mark_assignment_graded(essay_id)
    sync.mark_assignment_delivered(essay_id)
    sync.revert_assignment_delivery(essay_id)

    assert row == before


def test_other_assignments_are_not_touched(db):
    essay_id = uuid4()
    other = _seed_assignment(db, essay_id=uuid4())
    before = dict(other)

    sync.mark_assignment_graded(essay_id)
    sync.mark_assignment_delivered(essay_id)

    assert other == before


def test_essay_without_assignment_is_a_quiet_noop(db, caplog):
    caplog.set_level(logging.WARNING, logger=sync.logger.name)
    essay_id = uuid4()

    sync.mark_assignment_graded(essay_id)
    sync.mark_assignment_delivered(essay_id)
    sync.revert_assignment_delivery(essay_id)

    assert db.tables.get("writing_assignments", []) == []
    assert caplog.records == []


@pytest.mark.parametrize("fn", [
    sync.mark_assignment_graded,
    sync.mark_assignment_delivered,
    sync.revert_assignment_delivery,
])
def test_db_failure_is_logged_and_swallowed(monkeypatch, caplog, fn):
    caplog.set_level(logging.WARNING, logger=sync.logger.name)
    monkeypatch.setattr("services.writing_assignment_status_sync.supabase_admin",
                        _ExplodingDb())

    assert fn(uuid4()) is None

    assert any("[assignment-sync]" in r.getMessage() for r in caplog.records)


# ── wiring: AI grading (essay_service._bg_grade_essay) ───────────────


def _grader():
    grader = MagicMock()

    async def fake_grade(_config):
        return MagicMock(
            feedback=_valid_feedback_obj(), model_used="gemini-2.5-pro",
            tokens_input=1, tokens_output=1, cost_usd=0.001,
            grading_duration_ms=10, prompt_version="v1.0",
        )

    grader.grade_essay = fake_grade
    return grader


def _bg_patches(fake, grader):
    return (
        patch.object(essay_service, "supabase_admin", fake),
        patch.object(essay_service, "get_grader", return_value=grader),
        patch.object(essay_service, "get_recurring_patterns", return_value=None),
        patch.object(essay_service, "get_band_trajectory", return_value=None),
        patch.object(essay_service, "get_sentence_structure_history", return_value=None),
        patch.object(essay_service, "observe_writing_background", new=AsyncMock()),
    )


@pytest.mark.asyncio
async def test_bg_grade_marks_assignment_graded_after_grade_commits():
    fake = _RecordingSupabase(responses=_bg_essay_responses())
    seen_at_call: list = []

    def record(essay_id):
        writes = [c for c in fake.calls if c["op"] == "update"]
        seen_at_call.append({
            "essay_id": essay_id,
            "essay_graded": any(c["table"] == "writing_essays"
                                and c["payload"].get("status") == "graded" for c in writes),
            "job_completed": any(c["table"] == "writing_jobs"
                                 and c["payload"].get("status") == "completed" for c in writes),
        })

    p = _bg_patches(fake, _grader())
    with p[0], p[1], p[2], p[3], p[4], p[5], \
         patch.object(sync, "mark_assignment_graded", side_effect=record):
        await essay_service._bg_grade_essay(_BG_ESSAY_ID, _BG_JOB_ID)

    assert seen_at_call == [{
        "essay_id": _BG_ESSAY_ID, "essay_graded": True, "job_completed": True,
    }]


@pytest.mark.asyncio
async def test_bg_grade_failure_does_not_mark_assignment_graded():
    from services.gemini_writing_grader import AISafetyBlockError

    fake = _RecordingSupabase(responses=_bg_essay_responses())
    grader = MagicMock()

    async def blocked(_config):
        raise AISafetyBlockError("blocked")

    grader.grade_essay = blocked
    p = _bg_patches(fake, grader)
    with p[0], p[1], p[2], p[3], p[4], p[5], \
         patch.object(essay_service, "_owns_job", return_value=True), \
         patch.object(sync, "mark_assignment_graded") as hook:
        await essay_service._bg_grade_essay(_BG_ESSAY_ID, _BG_JOB_ID)

    hook.assert_not_called()


@pytest.mark.asyncio
async def test_bg_grade_survives_sync_outage(monkeypatch):
    monkeypatch.setattr("services.writing_assignment_status_sync.supabase_admin",
                        _ExplodingDb())
    fake = _RecordingSupabase(responses=_bg_essay_responses())

    p = _bg_patches(fake, _grader())
    with p[0], p[1], p[2], p[3], p[4], p[5]:
        await essay_service._bg_grade_essay(_BG_ESSAY_ID, _BG_JOB_ID)

    essay_statuses = [c["payload"].get("status") for c in fake.calls
                      if c["table"] == "writing_essays" and c["op"] == "update"]
    assert "graded" in essay_statuses
    assert "failed" not in essay_statuses
    final_job = [c for c in fake.calls
                 if c["table"] == "writing_jobs" and c["op"] == "update"][-1]
    assert final_job["payload"]["status"] == "completed"


# ── wiring: instructor deliver + revoke (instructor_workflow) ────────


def _claimed_review(db, essay_id: UUID, instructor_id: UUID) -> str:
    db.tables.setdefault("writing_essays", []).append({
        "id": str(essay_id), "status": "graded", "instructor_note": None,
    })
    review = instructor_workflow.create_review(essay_id)
    instructor_workflow.claim(review.id, instructor_id)
    return review.id


def test_instructor_deliver_and_revoke_drive_the_assignment(db):
    essay_id, instructor_id = uuid4(), uuid4()
    row = _seed_assignment(db, essay_id=essay_id)
    sync.mark_assignment_graded(essay_id)
    graded_at = row["graded_at"]
    review_id = _claimed_review(db, essay_id, instructor_id)

    instructor_workflow.deliver(review_id, instructor_id, "Tốt",
                                expected_essay_id=essay_id)

    assert row["status"] == "delivered"
    assert row["delivered_at"] is not None
    assert row["graded_at"] == graded_at

    instructor_workflow.sync_revoke_review(essay_id)

    assert row["status"] == "graded"
    assert row["delivered_at"] is None
    assert row["graded_at"] == graded_at
    # The review is back in the queue, so it can be delivered again …
    instructor_workflow.deliver(review_id, instructor_id, "Tốt",
                                expected_essay_id=essay_id)
    # … and the assignment follows.
    assert row["status"] == "delivered"
    assert row["delivered_at"] is not None


def test_instructor_deliver_survives_sync_outage(db, monkeypatch):
    essay_id, instructor_id = uuid4(), uuid4()
    review_id = _claimed_review(db, essay_id, instructor_id)
    monkeypatch.setattr("services.writing_assignment_status_sync.supabase_admin",
                        _ExplodingDb())

    delivered = instructor_workflow.deliver(review_id, instructor_id, None,
                                            expected_essay_id=essay_id)

    assert delivered.essay_id == essay_id
    essay = db.tables["writing_essays"][0]
    assert essay["status"] == "delivered"


def test_revoke_without_review_row_still_reverts_assignment(db):
    """Standard/admin essays have no instructor_reviews row; the assignment must
    still leave 'delivered' on revoke."""
    essay_id = uuid4()
    row = _seed_assignment(db, essay_id=essay_id, status="delivered",
                           graded_at="2026-10-26T09:00:00+00:00",
                           delivered_at="2026-10-26T10:00:00+00:00")

    assert instructor_workflow.sync_revoke_review(essay_id) is None

    assert row["status"] == "graded"
    assert row["delivered_at"] is None


def test_revoke_survives_sync_outage(db, monkeypatch):
    essay_id, instructor_id = uuid4(), uuid4()
    review_id = _claimed_review(db, essay_id, instructor_id)
    instructor_workflow.deliver(review_id, instructor_id, None,
                                expected_essay_id=essay_id)
    monkeypatch.setattr("services.writing_assignment_status_sync.supabase_admin",
                        _ExplodingDb())

    synced = instructor_workflow.sync_revoke_review(essay_id)

    assert synced is not None and synced.status.value == "claimed"


# ── wiring: admin single / bulk deliver + revoke (routers/admin_writing) ─


def _client() -> TestClient:
    from main import app
    return TestClient(app)


def _admin_rpc_db(outcomes: dict[str, dict]) -> MagicMock:
    """routers.admin_writing.supabase_admin stand-in: fn_deliver_writing_essay
    answers per essay id."""
    fake = MagicMock()

    def rpc(name, params):
        assert name == "fn_deliver_writing_essay"
        call = MagicMock()
        call.execute.return_value = MagicMock(data=[outcomes[params["p_essay_id"]]])
        return call

    fake.rpc.side_effect = rpc
    return fake


def test_admin_deliver_marks_assignment_delivered_only_on_ok(db):
    from routers import admin_writing

    ok_id, refused_id = str(uuid4()), str(uuid4())
    ok_row = _seed_assignment(db, essay_id=ok_id, status="graded",
                              graded_at="2026-10-26T09:00:00+00:00")
    refused_row = _seed_assignment(db, essay_id=refused_id)
    rpc_db = _admin_rpc_db({
        ok_id:      {"ok": True},
        refused_id: {"ok": False, "reason": "not_reviewed", "status": "graded"},
    })
    with patch.object(admin_writing, "supabase_admin", rpc_db):
        assert admin_writing._deliver_essay(ok_id, "web_view")["ok"] is True
        assert admin_writing._deliver_essay(refused_id, "web_view")["ok"] is False

    assert ok_row["status"] == "delivered"
    assert ok_row["delivered_at"] is not None
    assert refused_row["status"] == "submitted"
    assert refused_row["delivered_at"] is None


def test_admin_deliver_survives_sync_outage(monkeypatch):
    from routers import admin_writing

    monkeypatch.setattr("services.writing_assignment_status_sync.supabase_admin",
                        _ExplodingDb())
    essay_id = str(uuid4())
    with patch.object(admin_writing, "supabase_admin", _admin_rpc_db({essay_id: {"ok": True}})):
        outcome = admin_writing._deliver_essay(essay_id, "web_view")

    assert outcome == {"essay_id": essay_id, "ok": True, "status": "delivered", "reason": None}


def test_admin_bulk_deliver_marks_each_delivered_assignment(db):
    from routers import admin_writing

    e1, e2 = str(uuid4()), str(uuid4())
    r1 = _seed_assignment(db, essay_id=e1, status="graded",
                          graded_at="2026-10-26T09:00:00+00:00")
    r2 = _seed_assignment(db, essay_id=e2)
    rpc_db = _admin_rpc_db({
        e1: {"ok": True},
        e2: {"ok": False, "reason": "not_reviewed", "status": "graded"},
    })
    with patch.object(admin_writing, "require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch.object(admin_writing, "supabase_admin", rpc_db), \
         patch.object(admin_writing, "observe_writing_batch", new=AsyncMock()):
        r = _client().post("/admin/writing/essays/bulk-mark-delivered",
                           json={"essay_ids": [e1, e2]}, headers=_ADMIN_AUTH)

    assert r.status_code == 200, r.text
    assert r.json()["delivered"] == [e1]
    assert r1["status"] == "delivered" and r1["delivered_at"] is not None
    assert r2["status"] == "submitted" and r2["delivered_at"] is None


def test_admin_revoke_reverts_assignment(db):
    from routers import admin_writing

    essay_id = str(uuid4())
    row = _seed_assignment(db, essay_id=essay_id, status="delivered",
                           graded_at="2026-10-26T09:00:00+00:00",
                           delivered_at="2026-10-26T10:00:00+00:00")
    db.tables.setdefault("writing_essays", []).append({
        "id": essay_id, "status": "delivered", "deleted_at": None,
    })
    with patch.object(admin_writing, "require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch.object(admin_writing, "supabase_admin", db), \
         patch.object(admin_writing, "note_writing_mutation"), \
         patch.object(admin_writing, "observe_writing_batch", new=AsyncMock()):
        r = _client().post(f"/admin/writing/essays/{essay_id}/revoke-delivery",
                           json={}, headers=_ADMIN_AUTH)

    assert r.status_code == 200, r.text
    assert row["status"] == "graded"
    assert row["delivered_at"] is None
    assert row["graded_at"] == "2026-10-26T09:00:00+00:00"


# ── wiring: mock-exam release (essay_service.deliver_reviewed_essay) ──


def test_mock_release_marks_assignment_delivered_only_when_essay_flips(db, monkeypatch):
    flipped_id, untouched_id = str(uuid4()), str(uuid4())
    db.tables["writing_essays"] = [
        {"id": flipped_id, "status": "reviewed"},
        {"id": untouched_id, "status": "graded"},
    ]
    flipped_row = _seed_assignment(db, essay_id=flipped_id, status="graded",
                                   graded_at="2026-10-26T09:00:00+00:00")
    untouched_row = _seed_assignment(db, essay_id=untouched_id, status="graded",
                                     graded_at="2026-10-26T09:00:00+00:00")
    monkeypatch.setattr(essay_service, "supabase_admin", db)

    assert essay_service.deliver_reviewed_essay(flipped_id) is True
    assert essay_service.deliver_reviewed_essay(untouched_id) is False

    assert flipped_row["status"] == "delivered"
    assert flipped_row["delivered_at"] is not None
    assert untouched_row["status"] == "graded"


def test_mock_release_without_assignment_and_with_sync_outage(db, monkeypatch):
    essay_id = str(uuid4())
    db.tables["writing_essays"] = [{"id": essay_id, "status": "reviewed"}]
    monkeypatch.setattr(essay_service, "supabase_admin", db)
    monkeypatch.setattr("services.writing_assignment_status_sync.supabase_admin",
                        _ExplodingDb())

    assert essay_service.deliver_reviewed_essay(essay_id) is True
    assert db.tables["writing_essays"][0]["status"] == "delivered"
