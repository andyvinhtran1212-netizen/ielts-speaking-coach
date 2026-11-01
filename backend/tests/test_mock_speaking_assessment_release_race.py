"""PR #2089 R10: a stale Speaking save must not edit published feedback."""

import asyncio
import threading
from copy import deepcopy
from unittest.mock import AsyncMock

import httpx

from routers import admin_mock_exams as proctor
from routers import admin_mock_reviews as reviews
from test_admin_mock_edit_speaking_races import app, db  # noqa: F401 — shared fixtures


def test_threaded_bulk_release_wins_over_stale_speaking_save(app, db, monkeypatch):
    monkeypatch.setattr(reviews, "require_admin", AsyncMock(return_value={"id": "admin-1"}))
    app.include_router(reviews.router)
    db.seed("mock_exam_sittings", {
        "id": "sitting-1", "mock_exam_id": "exam-1", "user_id": "learner-1",
        "status": "under_review", "sealed": True,
    })
    notes = {"speaking": {"intro": "Published assessment"}, "reading": {"note": "Keep"}}
    draft = {"speaking": {"band": 6.0}, "reading": {"band": 7.0}}
    db.seed("mock_exam_reviews", {
        "id": "review-1", "sitting_id": "sitting-1", "status": "reviewed",
        "claimed_by": "admin-1", "final_bands": {"speaking": 6.0},
        "per_skill_notes": deepcopy(notes), "ai_draft": deepcopy(draft),
    })
    save_ready, release_committed = threading.Event(), threading.Event()
    bulk_release = proctor.wf.bulk_release_sittings
    save_threads, release_threads = [], []

    async def scenario():
        loop, release_entered = asyncio.get_running_loop(), asyncio.Event()

        def concurrent_release(*args, **kwargs):
            release_threads.append(threading.get_ident())
            loop.call_soon_threadsafe(release_entered.set)
            try:
                assert save_ready.wait(5), "Speaking save did not reach its UPDATE"
                return bulk_release(*args, **kwargs)
            finally:
                release_committed.set()

        def before_execute(query):
            if (query.table_name == "mock_exam_reviews" and query.op == "update"
                    and "per_skill_notes" in query.payload):
                save_threads.append(threading.get_ident())
                save_ready.set()
                assert release_committed.wait(5), "bulk release did not finish before save"

        monkeypatch.setattr(proctor.wf, "bulk_release_sittings", concurrent_release)
        db.before_execute = before_execute
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            release_task = asyncio.create_task(client.post(
                "/admin/mock-exams/exam-1/bulk-release", json={"sitting_ids": ["sitting-1"]},
            ))
            try:
                await asyncio.wait_for(release_entered.wait(), 5)
                save = await client.post("/admin/mock-reviews/review-1/speaking-assessment", json={
                    "bands": {"fc": 8, "lr": 8, "gra": 8, "p": 8}, "intro": "Stale edit",
                })
            finally:
                save_ready.set()
                released = await asyncio.wait_for(release_task, 5)
            assert released.status_code == 200
            assert released.json() == {"released": ["sitting-1"], "skipped": []}
            assert save.status_code == 409
            assert (await client.get("/ping")).status_code == 200

        assert save_threads == [threading.get_ident()]
        assert release_threads and release_threads[0] != threading.get_ident()
        fresh = proctor.wf.get_review("review-1")
        assert fresh["status"] == "released"
        assert fresh["released_by"] == "admin-1"
        assert fresh["released_at"]
        assert fresh["per_skill_notes"] == notes
        assert fresh["ai_draft"] == draft
        sitting = proctor.svc.get_sitting("sitting-1")
        assert sitting["status"] == "released"
        assert sitting["sealed"] is False

    asyncio.run(scenario())
