"""PR #2089 R11: terminal sittings/reviews reject stale link/claim writes."""

import asyncio
import threading
from copy import deepcopy
from unittest.mock import AsyncMock

import httpx
import pytest

from routers import admin_mock_exams as proctor
from routers import admin_mock_reviews as reviews
from routers import mock_exams as student
from test_admin_mock_edit_speaking_races import app, db  # noqa: F401 — shared fixtures


def _seed(db, action):
    db.tables["mock_exams"][0].update({
        "status": "published", "active_section": action,
        "listening_test_id": "paper-1", "reading_test_id": "paper-1",
    })
    db.seed("mock_exam_sittings", {
        "id": "sitting-1", "mock_exam_id": "exam-1", "user_id": "learner-1",
        "status": "under_review", "sealed": True,
        "speaking_session_ids": ["old-session"],
        "speaking_completed_at": "2026-10-30T12:00:00+00:00",
        "listening_attempt_id": None, "reading_attempt_id": None,
    })
    db.seed("mock_exam_reviews", {
        "id": "review-1", "sitting_id": "sitting-1", "status": "reviewed",
        "claimed_by": "admin-1", "claimed_at": "2026-10-30T12:00:00+00:00",
        "final_bands": {"speaking": 6.0}, "per_skill_notes": {}, "ai_draft": {},
    })
    db.seed("sessions", {
        "id": "new-session", "sitting_id": "sitting-1", "user_id": "learner-1",
        "status": "completed",
    })
    db.seed("responses", {"id": "response-1", "session_id": "new-session"})
    for section in ("listening", "reading"):
        db.seed(f"{section}_test_attempts", {
            "id": "new-attempt", "test_id": "paper-1", "user_id": "learner-1",
            "status": "in_progress", "sitting_id": None,
        })


async def _student_write(client, action):
    if action == "speaking":
        return await client.post("/api/mock-exams/sittings/sitting-1/speaking", json={
            "session_ids": ["new-session"],
        })
    return await client.post("/api/mock-exams/sittings/sitting-1/attach", json={
        "section": action, "attempt_id": "new-attempt",
    })


async def _race_terminal(app, db, monkeypatch, terminal, writer, target):
    """Commit the actual threaded terminal route before the on-loop UPDATE."""
    loop, terminal_entered = asyncio.get_running_loop(), asyncio.Event()
    writer_ready, terminal_committed = threading.Event(), threading.Event()
    module = proctor.wf if terminal == "released" else proctor.svc
    name = "bulk_release_sittings" if terminal == "released" else "void_sitting"
    original = getattr(module, name)
    writer_threads, terminal_threads, committed = [], [], {}

    def concurrent_terminal(*args, **kwargs):
        terminal_threads.append(threading.get_ident())
        loop.call_soon_threadsafe(terminal_entered.set)
        try:
            assert writer_ready.wait(5), "writer did not reach its UPDATE"
            result = original(*args, **kwargs)
            committed["sitting"] = proctor.svc.get_sitting("sitting-1")
            committed["review"] = proctor.wf.get_review("review-1")
            return result
        finally:
            terminal_committed.set()

    def before_execute(query):
        if query.op == "update" and target(query):
            writer_threads.append(threading.get_ident())
            writer_ready.set()
            assert terminal_committed.wait(5), "terminal write did not finish"

    monkeypatch.setattr(module, name, concurrent_terminal)
    db.before_execute = before_execute
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        if terminal == "released":
            terminal_request = client.post("/admin/mock-exams/exam-1/bulk-release", json={
                "sitting_ids": ["sitting-1"],
            })
        else:
            terminal_request = client.post("/admin/mock-exams/sittings/sitting-1/void", json={
                "reason": "technical failure",
            })
        terminal_task = asyncio.create_task(terminal_request)
        try:
            await asyncio.wait_for(terminal_entered.wait(), 5)
            response = await writer(client)
        finally:
            writer_ready.set()
            finished = await asyncio.wait_for(terminal_task, 5)
        assert finished.status_code == 200
        if terminal == "released":
            assert finished.json() == {"released": ["sitting-1"], "skipped": []}
        else:
            assert finished.json()["status"] == "void"
        assert (await client.get("/ping")).status_code == 200

    assert writer_threads == [threading.get_ident()]
    assert terminal_threads and terminal_threads[0] != threading.get_ident()
    assert proctor.svc.get_sitting("sitting-1") == committed["sitting"]
    assert proctor.wf.get_review("review-1") == committed["review"]
    assert committed["sitting"]["status"] == terminal
    assert committed["sitting"]["sealed"] is (terminal == "void")
    assert committed["review"]["status"] == terminal
    assert proctor.wf.get_queue(mock_exam_id="exam-1") == []
    return response


@pytest.mark.parametrize("terminal", ["released", "void"])
@pytest.mark.parametrize("action", ["speaking", "listening", "reading"])
def test_threaded_terminal_wins_over_student_link(app, db, monkeypatch, terminal, action):
    _seed(db, action)
    monkeypatch.setattr(student, "get_supabase_user", AsyncMock(return_value={"id": "learner-1"}))
    app.include_router(student.router)
    field = "speaking_session_ids" if action == "speaking" else f"{action}_attempt_id"

    async def writer(client):
        return await _student_write(client, action)

    response = asyncio.run(_race_terminal(
        app, db, monkeypatch, terminal, writer,
        lambda query: query.table_name == "mock_exam_sittings" and field in query.payload,
    ))
    assert response.status_code == 409
    sitting = proctor.svc.get_sitting("sitting-1")
    assert sitting["speaking_session_ids"] == ["old-session"]
    assert sitting["speaking_completed_at"] == "2026-10-30T12:00:00+00:00"
    for section in ("listening", "reading"):
        assert sitting[f"{section}_attempt_id"] is None
        assert db.tables[f"{section}_test_attempts"][0]["sitting_id"] is None


@pytest.mark.parametrize("terminal", ["released", "void"])
def test_threaded_terminal_wins_over_release_claim(app, db, monkeypatch, terminal):
    _seed(db, "speaking")
    if terminal == "void":
        db.tables["mock_exam_reviews"][0]["status"] = "claimed"
    monkeypatch.setattr(reviews, "require_admin", AsyncMock(return_value={"id": "admin-1"}))
    app.include_router(reviews.router)

    async def writer(client):
        return await client.post("/admin/mock-reviews/review-1/release-claim")

    response = asyncio.run(_race_terminal(
        app, db, monkeypatch, terminal, writer,
        lambda query: query.table_name == "mock_exam_reviews" and query.payload.get("status") == "queued",
    ))
    assert response.status_code == 403  # Existing release-claim refusal contract.


@pytest.mark.parametrize("status", ["released", "void", "reviewed"])
def test_release_claim_refuses_non_claimed_review(app, db, monkeypatch, status):
    _seed(db, "speaking")
    db.tables["mock_exam_reviews"][0]["status"] = status
    before = deepcopy(db.tables)
    with pytest.raises(PermissionError):
        proctor.wf.release("review-1", "admin-1")
    assert db.tables == before


@pytest.mark.parametrize("action", ["speaking", "listening", "reading"])
def test_student_link_still_succeeds_before_terminal(app, db, monkeypatch, action):
    _seed(db, action)
    monkeypatch.setattr(student, "get_supabase_user", AsyncMock(return_value={"id": "learner-1"}))
    app.include_router(student.router)

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await _student_write(client, action)
        assert response.status_code == 200
        sitting = proctor.svc.get_sitting("sitting-1")
        if action == "speaking":
            assert sitting["speaking_session_ids"] == ["new-session"]
        else:
            assert sitting[f"{action}_attempt_id"] == "new-attempt"
            assert db.tables[f"{action}_test_attempts"][0]["sitting_id"] == "sitting-1"

    asyncio.run(scenario())


def test_release_claim_still_requeues_claimed_review(db):
    _seed(db, "speaking")
    db.tables["mock_exam_reviews"][0]["status"] = "claimed"
    result = proctor.wf.release("review-1", "admin-1")
    assert result["status"] == "queued"
    assert result["claimed_by"] is None
    assert result["claimed_at"] is None
    assert proctor.svc.get_sitting("sitting-1")["status"] == "all_submitted"
