"""PR #2089 R9: threaded void must win over stale section status writers."""

import asyncio
import threading
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import httpx
import pytest

from test_admin_mock_edit_speaking_races import app, db  # noqa: F401 — shared fixtures


def _seed(db, status, *, submitted=False):
    now = datetime.now(timezone.utc)
    db.tables["mock_exams"][0].update({
        "status": "published", "exam_mode": "retake", "listening_test_id": "paper-1",
    })
    db.seed("mock_exam_sittings", {
        "id": "sitting-1", "mock_exam_id": "exam-1", "user_id": "learner-1",
        "status": status, "sealed": True, "assigned_skills": ["listening"],
        "retake_open_from": (now - timedelta(hours=1)).isoformat(),
        "retake_open_until": (now + timedelta(hours=1)).isoformat(),
        "listening_started_at": now.isoformat() if submitted else None,
        "listening_submitted_at": now.isoformat() if submitted else None,
    })


async def _race_void(app, db, monkeypatch, writer, target):
    """Run the real void in its route's thread while the writer stays on-loop.

    The worker waits until the writer's actual UPDATE is ready, commits void,
    then releases that UPDATE. Detached DB snapshots keep the stale read real.
    """
    from routers import admin_mock_exams as proctor

    loop = asyncio.get_running_loop()
    void_entered = asyncio.Event()
    writer_ready, void_committed = threading.Event(), threading.Event()
    void_sitting = proctor.svc.void_sitting
    writer_threads, void_threads = [], []

    def concurrent_void(*args, **kwargs):
        void_threads.append(threading.get_ident())
        loop.call_soon_threadsafe(void_entered.set)
        try:
            assert writer_ready.wait(5), "writer did not reach its status UPDATE"
            return void_sitting(*args, **kwargs)
        finally:
            void_committed.set()

    def before_execute(query):
        if (query.table_name == "mock_exam_sittings" and query.op == "update"
                and target(query)):
            writer_threads.append(threading.get_ident())
            writer_ready.set()
            assert void_committed.wait(5), "void did not finish before the stale UPDATE"

    monkeypatch.setattr(proctor.svc, "void_sitting", concurrent_void)
    db.before_execute = before_execute
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        void_task = asyncio.create_task(client.post(
            "/admin/mock-exams/sittings/sitting-1/void", json={"reason": "technical failure"},
        ))
        try:
            await asyncio.wait_for(void_entered.wait(), 5)
            result = await writer(client)
        finally:
            writer_ready.set()
            void = await asyncio.wait_for(void_task, 5)
        assert void.status_code == 200
        assert void.json()["status"] == "void"
        assert (await client.get("/ping")).status_code == 200

    assert writer_threads and set(writer_threads) == {threading.get_ident()}
    assert void_threads and void_threads[0] != threading.get_ident()
    fresh = proctor.svc.get_sitting("sitting-1")
    assert fresh["status"] == "void"
    assert fresh["sealed"] is True
    assert db.tables["mock_exam_reviews"] == []
    assert proctor.wf.get_queue(mock_exam_id="exam-1") == []
    return result


@pytest.mark.parametrize("status", ["registered", "lrw_in_progress"])
@pytest.mark.parametrize("action", ["start", "submit"])
def test_threaded_void_wins_over_student_section_writer(app, db, monkeypatch, status, action):
    from routers import mock_exams as student

    _seed(db, status)
    if action == "submit":
        db.tables["mock_exam_sittings"][0]["listening_started_at"] = datetime.now(timezone.utc).isoformat()
        db.tables["mock_exam_sittings"][0]["listening_attempt_id"] = "attempt-1"
        db.seed("listening_test_attempts", {"id": "attempt-1", "status": "submitted"})
    monkeypatch.setattr(student, "get_supabase_user", AsyncMock(return_value={"id": "learner-1"}))
    app.include_router(student.router)

    async def writer(client):
        return await client.post(f"/api/mock-exams/sittings/sitting-1/sections/listening/{action}", json={})

    def target(query):
        return ("listening_started_at" in query.payload if action == "start"
                else query.payload.get("status") == "lrw_submitted")

    response = asyncio.run(_race_void(app, db, monkeypatch, writer, target))
    assert response.status_code == 409
    if action == "start":
        assert db.tables["mock_exam_sittings"][0]["listening_started_at"] is None


@pytest.mark.parametrize("status", ["registered", "lrw_in_progress"])
@pytest.mark.parametrize("pause_at", ["claim", "terminal"])
def test_threaded_void_wins_over_force_collect(app, db, monkeypatch, status, pause_at):
    from routers import admin_mock_exams as proctor

    _seed(db, status)

    async def writer(_client):
        return proctor.svc._collect_section_for_sitting(
            proctor.svc.get_sitting("sitting-1"), "listening", db.tables["mock_exams"][0],
            unlinked_ids=[],
        )

    def target(query):
        return ("listening_submitted_at" in query.payload if pause_at == "claim"
                else query.payload.get("status") == "lrw_submitted")

    assert asyncio.run(_race_void(app, db, monkeypatch, writer, target)) is False
    if pause_at == "claim":
        assert db.tables["mock_exam_sittings"][0]["listening_submitted_at"] is None


@pytest.mark.parametrize("status", ["registered", "lrw_in_progress"])
def test_threaded_void_wins_over_stalled_repair(app, db, monkeypatch, status):
    from routers import admin_mock_exams as proctor

    _seed(db, status, submitted=True)

    async def writer(_client):
        return proctor.svc.reconcile_stalled_sittings("exam-1")

    result = asyncio.run(_race_void(
        app, db, monkeypatch, writer, lambda query: query.payload.get("status") == "lrw_submitted",
    ))
    assert result == {"repaired": 0}


@pytest.mark.parametrize("finalize", [False, True])
def test_threaded_void_wins_over_student_writing_capture(app, db, monkeypatch, finalize):
    from routers import mock_exams as student

    _seed(db, "lrw_in_progress")
    db.tables["writing_essays"] = []
    sitting = db.tables["mock_exam_sittings"][0]
    sitting.update({
        "assigned_skills": ["writing"],
        "writing_started_at": datetime.now(timezone.utc).isoformat(),
        "writing_submission": {"task2": {"text": "Last accepted draft"}},
    })
    monkeypatch.setattr(student, "get_supabase_user", AsyncMock(return_value={"id": "learner-1"}))
    app.include_router(student.router)

    async def writer(client):
        action = "sections/writing/submit" if finalize else "writing"
        return await client.post(f"/api/mock-exams/sittings/sitting-1/{action}", json={
            "task1_text": "Stale task one", "task2_text": "Stale task two",
        })

    response = asyncio.run(_race_void(
        app, db, monkeypatch, writer, lambda query: "writing_submission" in query.payload,
    ))
    assert sitting["writing_submission"] == {"task2": {"text": "Last accepted draft"}}
    assert sitting.get("writing_submitted_at") is None
    assert not sitting.get("essay_task1_id")
    assert not sitting.get("essay_task2_id")
    assert db.tables["writing_essays"] == []
    assert response.status_code == 409
