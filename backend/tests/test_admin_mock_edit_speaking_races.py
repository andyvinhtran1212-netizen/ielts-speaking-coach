"""PR #2089 R8: stale speaking completion and stale publish validation."""

import asyncio
import threading
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from routers import admin_mock_exams as proctor
from test_mock_exam_workflow import FakeSupabase, _Query, _RpcResult


class SnapshotDB(FakeSupabase):
    """Atomic statements with detached results, like separate PostgREST calls."""
    def __init__(self):
        super().__init__()
        self.statement_lock = threading.Lock()
        self.before_execute = lambda _query: None

    def table(self, name):
        return SnapshotQuery(self, name)

    def rpc(self, name, params):
        with self.statement_lock:
            return _RpcResult(deepcopy(super().rpc(name, params).execute().data))


class SnapshotQuery(_Query):
    def execute(self):
        self.fake.before_execute(self)
        with self.fake.statement_lock:
            return SimpleNamespace(data=deepcopy(super().execute().data))


@pytest.fixture
def app(monkeypatch):
    app = FastAPI()
    monkeypatch.setattr(proctor, "require_admin", AsyncMock(return_value={"id": "admin-1"}))
    app.include_router(proctor.router)

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    return app


@pytest.fixture
def db(monkeypatch):
    db = SnapshotDB()
    for module in (proctor.svc, proctor.wf):
        monkeypatch.setattr(module, "supabase_admin", db)
    db.seed("mock_exams", {
        "id": "exam-1", "status": "draft", "exam_mode": "sequential",
        "writing_task2_prompt_id": "good", "writing_minutes": 60,
        "speaking_topic_set": {"part1": ["topic"]},
    })
    db.seed("writing_prompts", {
        "id": "good", "task_type": "task2", "prompt_text": "Discuss both views.", "is_active": True,
    })
    db.seed("writing_prompts", {
        "id": "bad", "task_type": "task2", "prompt_text": "", "is_active": True,
    })
    return db


@pytest.mark.parametrize("pause_at", ["stamp", "reconcile"])
def test_void_wins_over_stale_record_speaking(app, db, pause_at):
    db.tables["mock_exams"][0]["status"] = "published"
    db.seed("mock_exam_sittings", {
        "id": "sitting-1", "mock_exam_id": "exam-1", "user_id": "learner-1",
        "status": "speaking_pending", "sealed": True,
        "writing_submitted_at": "2026-10-30T12:00:00+00:00",
        "speaking_completed_at": None, "speaking_session_ids": [],
    })
    db.seed("sessions", {"id": "session-1", "sitting_id": "sitting-1", "status": "completed"})
    db.seed("responses", {"id": "response-1", "session_id": "session-1"})
    release = threading.Event()

    async def scenario():
        loop, entered = asyncio.get_running_loop(), asyncio.Event()
        worker_threads = []

        def before_execute(query):
            if query.table_name != "mock_exam_sittings" or query.op != "update":
                return
            target = "speaking_completed_at" in query.payload if pause_at == "stamp" else (
                query.payload.get("status") == "all_submitted"
            )
            if target:
                worker_threads.append(threading.get_ident())
                loop.call_soon_threadsafe(entered.set)
                assert release.wait(5), "test did not release speaking worker"

        db.before_execute = before_execute
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            record = asyncio.create_task(client.post("/admin/mock-exams/sittings/sitting-1/record-speaking"))
            try:
                await asyncio.wait_for(entered.wait(), 5)
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
        sitting, = db.tables["mock_exam_sittings"]
        assert sitting["status"] == "void"
        assert sitting["sealed"] is True
        assert db.tables["mock_exam_reviews"] == []
        assert response.status_code == 409
        if pause_at == "stamp":
            assert sitting["speaking_completed_at"] is None
            assert sitting["speaking_session_ids"] == []
        assert worker_threads and worker_threads[0] != threading.get_ident()

    asyncio.run(scenario())


@pytest.mark.parametrize("cancel_publisher", [False, True])
def test_concurrent_exam_edits_publish_exactly_validated_content(app, db, monkeypatch, cancel_publisher):
    release = threading.Event()
    require_ready = proctor.svc._require_exam_content_ready
    validated = []

    async def scenario():
        loop, checked = asyncio.get_running_loop(), asyncio.Event()

        def pause_after_validation(candidate, **kwargs):
            require_ready(candidate, **kwargs)
            validated.append(deepcopy(candidate))
            if len(validated) == 1:
                loop.call_soon_threadsafe(checked.set)
                assert release.wait(5), "test did not release publisher"

        monkeypatch.setattr(proctor.svc, "_require_exam_content_ready", pause_after_validation)
        db.seed("mock_exams", {"id": "exam-2", "title": "Other exam", "status": "draft"})
        path = "/admin/mock-exams/exam-1"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            publisher = asyncio.create_task(client.patch(path, json={"status": "published"}))
            waiter = editor = None
            try:
                await asyncio.wait_for(checked.wait(), 5)
                if cancel_publisher:
                    publisher.cancel()
                    await asyncio.sleep(0)
                    publisher.cancel()
                # A cancelled waiter must not release the publisher's lock.
                waiter = asyncio.create_task(client.patch(path, json={"title": "Cancelled edit"}))
                await asyncio.wait({waiter}, timeout=0.05)
                waiter.cancel()
                await asyncio.gather(waiter, return_exceptions=True)
                editor = asyncio.create_task(client.patch(path, json={
                    "writing_task2_prompt_id": "bad", "writing_minutes": -1,
                }))
                await asyncio.wait({editor}, timeout=0.1)
                before_release = deepcopy(db.tables["mock_exams"][0])
                other = await asyncio.wait_for(client.patch(
                    "/admin/mock-exams/exam-2", json={"title": "Updated independently"},
                ), 2)
                assert other.status_code == 200
                assert (await client.get("/ping")).status_code == 200
            finally:
                release.set()
                results = await asyncio.gather(
                    publisher, *([editor] if editor else []), return_exceptions=True,
                )
        if cancel_publisher:
            assert isinstance(results[0], asyncio.CancelledError)
        else:
            assert results[0].status_code == 200
        final = proctor.svc.get_published_exam_by_id("exam-1")
        assert final["status"] == "published"
        fields = ("status", "writing_task2_prompt_id", "writing_minutes")
        assert tuple(final[k] for k in fields) in [tuple(v[k] for k in fields) for v in validated]
        assert results[1].status_code == 400
        assert before_release["writing_task2_prompt_id"] == "good"
        assert before_release.get("title") != "Cancelled edit"
        assert final.get("title") != "Cancelled edit"

    asyncio.run(scenario())
