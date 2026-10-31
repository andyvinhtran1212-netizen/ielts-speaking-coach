"""PR #2089: void during review insertion and convergent reconciliation."""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from test_admin_mock_edit_speaking_races import app, db  # noqa: F401 — shared fixtures


def _seed_sitting(db, *, status="speaking_pending", completed=False, sitting_id="sitting-1"):
    db.tables["mock_exams"][0]["status"] = "published"
    db.seed("mock_exam_sittings", {
        "id": sitting_id, "mock_exam_id": "exam-1", "user_id": "learner-1",
        "status": status, "sealed": True,
        "writing_submitted_at": "2026-10-30T12:00:00+00:00",
        "speaking_completed_at": "2026-10-30T12:00:00+00:00" if completed else None,
        "speaking_session_ids": ["session-1"] if completed else [],
    })
    db.seed("sessions", {"id": "session-1", "sitting_id": sitting_id, "status": "completed"})
    db.seed("responses", {"id": "response-1", "session_id": "session-1"})


@pytest.mark.parametrize("repair", [False, True])
@pytest.mark.parametrize("claim_late", [False, True])
def test_void_between_terminal_transition_and_review_insert(app, db, monkeypatch, repair, claim_late):
    """Pause the actual INSERT, finish the real void route, then resume it."""
    from routers import admin_mock_exams as proctor

    _seed_sitting(db, status="all_submitted" if repair else "speaking_pending", completed=repair)
    release = threading.Event()
    create_review = proctor.wf.create_review

    def insert_then_claim(*args, **kwargs):
        review = create_review(*args, **kwargs)
        if claim_late:
            # Exercise a claimant entering the insertion/check gap as well.
            proctor.wf.claim(review["id"], "admin-2")
        return review

    monkeypatch.setattr(proctor.wf, "create_review", insert_then_claim)

    async def scenario():
        loop, inserting = asyncio.get_running_loop(), asyncio.Event()
        worker_threads = []

        def before_execute(query):
            if query.table_name == "mock_exam_reviews" and query.op == "insert":
                worker_threads.append(threading.get_ident())
                loop.call_soon_threadsafe(inserting.set)
                assert release.wait(5), "test did not release review insert"

        db.before_execute = before_execute
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            record = asyncio.create_task(client.post("/admin/mock-exams/sittings/sitting-1/record-speaking"))
            try:
                await asyncio.wait_for(inserting.wait(), 5)
                assert proctor.svc.get_sitting("sitting-1")["status"] == "all_submitted"
                assert db.tables["mock_exam_reviews"] == []
                void = await asyncio.wait_for(client.post(
                    "/admin/mock-exams/sittings/sitting-1/void", json={"reason": "technical failure"},
                ), 2)
                assert void.status_code == 200
                assert void.json()["status"] == "void"
                assert db.tables["mock_exam_reviews"] == []
                assert (await client.get("/ping")).status_code == 200
            finally:
                release.set()
                response, = await asyncio.gather(record)

        sitting = proctor.svc.get_sitting("sitting-1")
        assert sitting["status"] == "void"
        assert sitting["sealed"] is True
        review, = db.tables["mock_exam_reviews"]
        assert review["status"] == "void"
        assert proctor.wf.get_queue(mock_exam_id="exam-1") == []
        with pytest.raises(proctor.wf.ConflictError):
            proctor.wf.claim(review["id"], "admin-2")
        assert response.status_code == 409
        assert proctor.svc.get_sitting("sitting-1")["status"] == "void"
        assert worker_threads and worker_threads[0] != threading.get_ident()

    asyncio.run(scenario())


@pytest.mark.parametrize("winner_status", ["speaking_pending", "all_submitted", "under_review"])
def test_losing_reconcile_returns_the_committed_forward_state(db, winner_status):
    from routers import admin_mock_exams as proctor

    pending = winner_status == "speaking_pending"
    _seed_sitting(db, status="lrw_submitted" if pending else "speaking_pending", completed=not pending)
    target = "speaking_pending" if pending else "all_submitted"
    paused, release = threading.Event(), threading.Event()
    loser_thread = []

    def before_execute(query):
        if (query.table_name == "mock_exam_sittings" and query.op == "update"
                and query.payload.get("status") == target
                and threading.get_ident() == loser_thread[0]):
            paused.set()
            assert release.wait(5), "test did not release losing reconcile"

    def lose():
        loser_thread.append(threading.get_ident())
        return proctor.svc._reconcile_terminal("sitting-1")

    db.before_execute = before_execute
    with ThreadPoolExecutor(max_workers=1) as pool:
        loser = pool.submit(lose)
        try:
            assert paused.wait(5)
            assert proctor.svc._reconcile_terminal("sitting-1")["status"] == target
            if winner_status == "under_review":
                review, = db.tables["mock_exam_reviews"]
                proctor.wf.claim(review["id"], "admin-2")
        finally:
            release.set()
        assert loser.result(timeout=5)["status"] == winner_status
    assert len(db.tables.get("mock_exam_reviews", [])) == (0 if pending else 1)
    assert proctor.svc.get_sitting("sitting-1")["status"] == winner_status


@pytest.mark.parametrize("conflict_at", ["retry_write", "reconcile"])
def test_retake_reaper_continues_after_one_reconcile_conflict(db, monkeypatch, conflict_at):
    from routers import admin_mock_exams as proctor

    exam = db.tables["mock_exams"][0]
    exam.update({"exam_mode": "retake", "status": "published"})
    for sitting_id in ("sitting-1", "sitting-2"):
        _seed_sitting(db, status="lrw_in_progress", sitting_id=sitting_id)
        db.tables["mock_exam_sittings"][-1]["assigned_skills"] = ["writing"]
    reconcile = proctor.svc._reconcile_terminal
    visited = []

    def conflict_once(sitting_id, exam=None):
        visited.append(sitting_id)
        if sitting_id == "sitting-1" and conflict_at == "reconcile":
            proctor.svc.void_sitting(sitting_id, "admin-1", "concurrent void")
            raise proctor.svc.SittingConflictError("concurrent void")
        return reconcile(sitting_id, exam)

    monkeypatch.setattr(proctor.svc, "_reconcile_terminal", conflict_once)

    def void_before_retry(query):
        if (conflict_at == "retry_write" and query.table_name == "mock_exam_sittings"
                and query.op == "update" and query.payload.get("status") == "lrw_submitted"
                and any(field == "id" and value == "sitting-1" for field, _, value, _ in query.filters)):
            proctor.svc.void_sitting("sitting-1", "admin-1", "concurrent void")

    db.before_execute = void_before_retry
    result = proctor.svc.reap_expired_retake_sittings()
    assert "sitting-2" in visited
    assert result == {"collected": 0, "sittings": 1}
    assert proctor.svc.get_sitting("sitting-1")["status"] == "void"
    assert proctor.svc.get_sitting("sitting-2")["status"] == "all_submitted"
    review, = db.tables["mock_exam_reviews"]
    assert review["sitting_id"] == "sitting-2"
    assert review["status"] == "queued"


def test_void_after_review_insert_cancels_existing_review(app, db, monkeypatch):
    from routers import admin_mock_exams as proctor

    _seed_sitting(db)
    release = threading.Event()
    create_review = proctor.wf.create_review

    async def scenario():
        loop, inserted = asyncio.get_running_loop(), asyncio.Event()

        def pause_after_insert(*args, **kwargs):
            review = create_review(*args, **kwargs)
            loop.call_soon_threadsafe(inserted.set)
            assert release.wait(5), "test did not release inserted review"
            return review

        monkeypatch.setattr(proctor.wf, "create_review", pause_after_insert)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            record = asyncio.create_task(client.post("/admin/mock-exams/sittings/sitting-1/record-speaking"))
            try:
                await asyncio.wait_for(inserted.wait(), 5)
                review, = db.tables["mock_exam_reviews"]
                assert review["status"] == "queued"
                void = await client.post("/admin/mock-exams/sittings/sitting-1/void", json={"reason": "cancel"})
                assert void.status_code == 200
            finally:
                release.set()
                response, = await asyncio.gather(record)
        assert response.status_code == 409
        assert proctor.svc.get_sitting("sitting-1")["status"] == "void"
        assert proctor.wf.get_queue(mock_exam_id="exam-1") == []
        review, = db.tables["mock_exam_reviews"]
        assert review["status"] == "void"
        with pytest.raises(proctor.wf.ConflictError):
            proctor.wf.claim(review["id"], "admin-2")

    asyncio.run(scenario())
