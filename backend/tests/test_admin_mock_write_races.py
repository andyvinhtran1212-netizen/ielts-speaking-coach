"""Regression coverage for PR #2089's offloaded multi-step writes."""

import asyncio
import threading
from copy import deepcopy
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from routers import admin_mock_exams as proctor, admin_mock_reviews, mock_corrections
from test_mock_exam_workflow import FakeSupabase


@pytest.fixture
def app(monkeypatch):
    app = FastAPI()
    for module in (proctor, admin_mock_reviews, mock_corrections):
        monkeypatch.setattr(module, "require_admin", AsyncMock(return_value={"id": "admin-1"}))
        app.include_router(module.router)
    monkeypatch.setattr(mock_corrections, "get_supabase_user", AsyncMock(return_value={"id": "learner-1"}))

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    return app


@pytest.mark.parametrize("late_error", [False, True])
def test_cancelled_capture_retains_lock_until_worker_finishes(app, monkeypatch, late_error):
    release = threading.Event()
    active, overlaps, calls = [], [], []

    async def scenario():
        loop, entered = asyncio.get_running_loop(), asyncio.Event()

        def record(*_args):
            calls.append(len(calls) + 1)
            index = calls[-1]
            if active:
                overlaps.append(index)
            active.append(index)
            try:
                if index == 1:
                    loop.call_soon_threadsafe(entered.set)
                    assert release.wait(5), "test did not release capture worker"
                    if late_error:
                        raise mock_corrections.svc.CaptureConflictError("late worker failure")
                return {"attempt": {}, "capture": {"id": str(index)}, "replayed": False}
            finally:
                active.remove(index)

        monkeypatch.setattr(mock_corrections.svc, "record_post_test_capture", record)
        monkeypatch.setattr(mock_corrections.svc, "explanation_access", lambda *_: None)
        monkeypatch.setattr(mock_corrections.svc, "learner_result_payload", lambda *_: None)
        path = "/api/mock-corrections/reading/attempts/attempt-1/post-test-capture"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            first = asyncio.create_task(client.post(path, json={"items": []}))
            second = None
            try:
                await asyncio.wait_for(entered.wait(), 5)
                first.cancel()
                await asyncio.sleep(0)
                first.cancel()  # repeated cancellation must not interrupt lock cleanup
                second = asyncio.create_task(client.post(path, json={"items": []}))
                await asyncio.sleep(0.05)
                before_release = list(calls)
                assert (await client.get("/ping")).json() == {"ok": True}
            finally:
                release.set()
                results = await asyncio.gather(first, *([second] if second else []), return_exceptions=True)
        assert isinstance(results[0], asyncio.CancelledError)
        assert results[1].status_code == 200
        assert before_release == [1]

    asyncio.run(scenario())
    assert calls == [1, 2] and not overlaps
    assert mock_corrections._capture_locks == {}


@pytest.fixture
def write_db(monkeypatch):
    db = FakeSupabase()
    db.tables["mock_exams"] = [{
        "id": "exam-1", "exam_mode": "retake", "reading_test_id": "paper-1",
    }]
    db.tables["mock_exam_assignments"] = [{
        "id": "assignment-1", "exam_id": "exam-1", "user_id": "learner-1",
        "skills": ["writing"], "open_from": None, "open_until": "2026-12-01T12:00:00+00:00",
    }]
    db.tables["mock_exam_sittings"] = [{
        "id": "sitting-1", "mock_exam_id": "exam-1", "user_id": "learner-1",
        "status": "registered", "assigned_skills": ["writing"],
        "retake_open_from": None, "retake_open_until": "2026-12-01T12:00:00+00:00",
        "sealed": True,
    }]
    for module in (proctor.assign_svc, proctor.svc, proctor.wf):
        monkeypatch.setattr(module, "supabase_admin", db)
    monkeypatch.setattr(proctor.wf, "resolve_display_names", lambda _: {})
    return db


def _assignment_body(skills, day):
    return {"assignments": [{
        "user_id": "learner-1", "skills": skills,
        "open_from": f"2026-11-{day:02d}T12:00:00+00:00",
        "open_until": f"2026-12-{day:02d}T12:00:00+00:00",
    }]}


@pytest.mark.parametrize("second_action", ["assign", "remove"])
def test_assignment_write_and_sitting_refresh_are_serial(app, monkeypatch, write_db, second_action):
    release = threading.Event()
    refresh = proctor.assign_svc._refresh_open_sitting
    calls = []

    async def scenario():
        loop, entered = asyncio.get_running_loop(), asyncio.Event()

        def paused_refresh(*args):
            calls.append(deepcopy(args))
            if len(calls) == 1:
                loop.call_soon_threadsafe(entered.set)
                assert release.wait(5), "test did not release assignment worker"
            return refresh(*args)

        monkeypatch.setattr(proctor.assign_svc, "_refresh_open_sitting", paused_refresh)
        path = "/admin/mock-exams/exam-1/assignments"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            first = asyncio.create_task(client.post(path, json=_assignment_body(["reading"], 2)))
            second = None
            try:
                await asyncio.wait_for(entered.wait(), 5)
                second = asyncio.create_task(
                    client.post(path, json=_assignment_body(["writing"], 3)) if second_action == "assign"
                    else client.delete(path + "/learner-1")
                )
                await asyncio.sleep(0.05)
                second_waited = not second.done()
                assert (await client.get("/ping")).status_code == 200
            finally:
                release.set()
                responses = await asyncio.gather(first, *([second] if second else []))
            assert [r.status_code for r in responses] == [200, 200]
            assert responses[0].json()["refreshed"] == ["learner-1"]
            # A new GET must agree with the state immediately after the writes.
            listed = (await client.get(path)).json()["assignments"]
        sitting = write_db.tables["mock_exam_sittings"][0]
        if second_action == "assign":
            assignment = write_db.tables["mock_exam_assignments"][0]
            assert listed[0]["skills"] == assignment["skills"] == sitting["assigned_skills"] == ["writing"]
            assert assignment["open_from"] == sitting["retake_open_from"]
            assert assignment["open_until"] == sitting["retake_open_until"]
            assert responses[1].json()["refreshed"] == ["learner-1"]
        else:
            assert listed == write_db.tables["mock_exam_assignments"] == []
            assert sitting["status"] == "void"
            assert responses[1].json() == {"ok": True, "voided": ["sitting-1"]}
        assert second_waited

    asyncio.run(scenario())


@pytest.mark.parametrize("first_action", ["assign", "remove"])
def test_cancelled_assignment_write_retains_exam_lock(app, monkeypatch, write_db, first_action):
    release = threading.Event()
    calls, overlaps, active = [], [], []

    async def scenario():
        loop, entered = asyncio.get_running_loop(), asyncio.Event()

        def wrap(name, fn):
            def run(*args, **kwargs):
                calls.append(name)
                if active:
                    overlaps.append(name)
                active.append(name)
                try:
                    if len(calls) == 1:
                        loop.call_soon_threadsafe(entered.set)
                        assert release.wait(5), "test did not release assignment worker"
                    return fn(*args, **kwargs)
                finally:
                    active.remove(name)
            return run

        monkeypatch.setattr(proctor.assign_svc, "assign", wrap("assign", proctor.assign_svc.assign))
        monkeypatch.setattr(proctor.assign_svc, "remove", wrap("remove", proctor.assign_svc.remove))
        path = "/admin/mock-exams/exam-1/assignments"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            first = asyncio.create_task(
                client.post(path, json=_assignment_body(["reading"], 2)) if first_action == "assign"
                else client.delete(path + "/learner-1")
            )
            second = None
            try:
                await asyncio.wait_for(entered.wait(), 5)
                first.cancel()
                await asyncio.sleep(0)
                first.cancel()
                second = asyncio.create_task(client.post(path, json=_assignment_body(["writing"], 3)))
                await asyncio.sleep(0.05)
                before_release = list(calls)
            finally:
                release.set()
                results = await asyncio.gather(first, *([second] if second else []), return_exceptions=True)
        assert isinstance(results[0], asyncio.CancelledError)
        assert results[1].status_code == 200
        assert before_release == [first_action]

    asyncio.run(scenario())
    assert calls == [first_action, "assign"] and not overlaps


@pytest.mark.parametrize("kind", ["capture", "assignment"])
def test_cancelled_waiter_keeps_holder_locked_and_other_keys_free(app, monkeypatch, kind):
    release = threading.Event()
    calls = []

    async def scenario():
        loop, entered = asyncio.get_running_loop(), asyncio.Event()

        def work(key):
            calls.append(key)
            if key == "held" and calls.count("held") == 1:
                loop.call_soon_threadsafe(entered.set)
                assert release.wait(5), "test did not release holder"
            return {"attempt": {}, "capture": {}, "replayed": False} if kind == "capture" else {}

        if kind == "capture":
            monkeypatch.setattr(mock_corrections.svc, "record_post_test_capture", lambda _skill, key, *_: work(key))
            monkeypatch.setattr(mock_corrections.svc, "explanation_access", lambda *_: None)
            monkeypatch.setattr(mock_corrections.svc, "learner_result_payload", lambda *_: None)
            path = "/api/mock-corrections/reading/attempts/{key}/post-test-capture"
            body = {"items": []}
        else:
            monkeypatch.setattr(proctor.assign_svc, "assign", lambda key, *_a, **_k: work(key))
            path, body = "/admin/mock-exams/{key}/assignments", {"assignments": []}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            holder = asyncio.create_task(client.post(path.format(key="held"), json=body))
            waiter = next_waiter = None
            try:
                await asyncio.wait_for(entered.wait(), 5)
                waiter = asyncio.create_task(client.post(path.format(key="held"), json=body))
                await asyncio.sleep(0)
                waiter.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await waiter
                next_waiter = asyncio.create_task(client.post(path.format(key="held"), json=body))
                other = await asyncio.wait_for(client.post(path.format(key="other"), json=body), 1)
                assert other.status_code == 200
                await asyncio.sleep(0.05)
                before_release = list(calls)
            finally:
                release.set()
                responses = await asyncio.gather(holder, *([next_waiter] if next_waiter else []))
                if waiter:
                    await asyncio.gather(waiter, return_exceptions=True)
        assert all(response.status_code == 200 for response in responses)
        assert before_release == ["held", "other"]

    asyncio.run(scenario())
    assert calls == ["held", "other", "held"]
    assert mock_corrections._capture_locks == {}
    assert not proctor._assignment_write_locks


@pytest.mark.parametrize("bulk", [False, True])
def test_final_bands_losing_race_with_release_preserves_released_state(app, monkeypatch, write_db, bulk):
    wf = proctor.wf
    bands = {"reading": 6.5, "overall": 6.5}
    write_db.tables["mock_exam_reviews"] = [{
        "id": "review-1", "sitting_id": "sitting-1", "status": "reviewed",
        "claimed_by": "admin-1", "final_bands": dict(bands),
    }]
    write_db.tables["mock_exam_sittings"][0]["status"] = "under_review"
    monkeypatch.setattr(wf, "_required_skills", lambda *_: ("reading",))
    monkeypatch.setattr(wf, "_unconvertible_skills", lambda *_: set())
    release = threading.Event()
    real_table = write_db.table

    async def scenario():
        loop, entered = asyncio.get_running_loop(), asyncio.Event()

        def table(name):
            query = real_table(name)
            execute = query.execute

            def paused_execute():
                if name == "mock_exam_reviews" and query.op == "update" and query.payload.get("status") == "reviewed":
                    loop.call_soon_threadsafe(entered.set)
                    assert release.wait(5), "test did not release final-band worker"
                return execute()

            query.execute = paused_execute
            return query

        monkeypatch.setattr(write_db, "table", table)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            if bulk:
                save = asyncio.create_task(client.post("/admin/mock-exams/exam-1/bulk-final-bands",
                                                       json={"sitting_ids": ["sitting-1"]}))
            else:
                # The individual route is synchronous today; simulate its competing
                # request on a separate loop so its existing 409 mapping is checked.
                async def individual():
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as other:
                        return await other.post("/admin/mock-reviews/review-1/final-bands",
                                                json={"final_bands": {"reading": 9}})
                save = asyncio.create_task(asyncio.to_thread(lambda: asyncio.run(individual())))
            try:
                await asyncio.wait_for(entered.wait(), 5)
                published = await client.post("/admin/mock-exams/exam-1/bulk-release",
                                              json={"sitting_ids": ["sitting-1"]})
                assert published.json() == {"released": ["sitting-1"], "skipped": []}
            finally:
                release.set()
                saved = await save
        if bulk:
            assert saved.status_code == 200
            assert saved.json()["saved"] == []
            assert saved.json()["skipped"][0]["sitting_id"] == "sitting-1"
            assert "status='released'" in saved.json()["skipped"][0]["reason"]
        else:
            assert saved.status_code == 409
        review = write_db.tables["mock_exam_reviews"][0]
        sitting = write_db.tables["mock_exam_sittings"][0]
        assert review["status"] == sitting["status"] == "released"
        assert review["final_bands"] == bands
        assert sitting["sealed"] is False

    asyncio.run(scenario())
