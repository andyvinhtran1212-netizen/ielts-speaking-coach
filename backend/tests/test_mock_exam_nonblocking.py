"""
tests/test_mock_exam_nonblocking.py — PC-J423 (PC-J408 group G4-a).

The student mock-exam routes are ``async def`` but called the sync service
layer (PostgREST ``.execute()``, Storage signing) straight on the event loop,
so on the single uvicorn process one student restoring or submitting a section
held every other request (incl. OPTIONS and /health) for the whole round-trip.
That is the class of the 2026-10-30 prod incident, which hit during a live
mock exam. The sync work now runs in a worker thread; these tests pin that a
slow service no longer serialises the loop.
"""

import asyncio
import threading
import time
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

from routers import exams as exams_router
from routers import mock_attempt_flags as flags_router
from routers import mock_exams as mock_router

_DELAY = 0.5
_USER = {"id": "00000000-0000-0000-0000-0000000000aa"}
_AUTH = {"Authorization": "Bearer faketoken"}
_SITTING_ID = "00000000-0000-0000-0000-0000000000bb"
_ATTEMPT_ID = "00000000-0000-0000-0000-0000000000cc"


class _Slow:
    """Sync service double that blocks like a slow Supabase round-trip and
    records which thread ran it."""

    def __init__(self, result):
        self.result = result
        self.threads = []
        self.calls = []

    def __call__(self, *args, **kwargs):
        self.threads.append(threading.get_ident())
        self.calls.append((args, kwargs))
        time.sleep(_DELAY)
        return self.result


def _app():
    app = FastAPI()
    app.include_router(exams_router.router)
    app.include_router(mock_router.router)
    app.include_router(flags_router.router)

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    return app


def _run(make_requests):
    """Start the slow request(s), then ping; return (responses, ping, ping_s, total_s)."""

    async def scenario():
        transport = httpx.ASGITransport(app=_app())
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            start = time.perf_counter()
            slow = [asyncio.create_task(r(client)) for r in make_requests]
            await asyncio.sleep(0.05)  # let the slow request(s) reach the service
            ping = await client.get("/ping")
            ping_s = time.perf_counter() - start
            responses = await asyncio.gather(*slow)
            return responses, ping, ping_s, time.perf_counter() - start

    return asyncio.run(scenario())


def _assert_not_blocking(responses, ping, ping_s, total_s, *, n):
    assert ping.status_code == 200
    # A service call on the loop thread would hold /ping for the full 0.5 s.
    assert ping_s < 0.2, f"/ping waited {ping_s:.3f}s behind the mock-exam route"
    if n > 1:
        # n requests that each spend 0.5 s in the service overlap (~0.5 s)
        # instead of queueing on the loop (n × 0.5 s).
        assert total_s < _DELAY * n - 0.15, (
            f"{n} requests took {total_s:.3f}s; they ran one after another")
    for r in responses:
        assert r.status_code == 200, r.text


def test_get_sitting_state_does_not_block_the_loop():
    sitting = {"id": _SITTING_ID, "user_id": _USER["id"], "mock_exam_id": "exam-1"}
    exam = {"id": "exam-1", "active_section": "listening", "exam_mode": "sequential"}
    get_sitting = _Slow(sitting)
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.get_sitting", new=get_sitting), \
         patch("routers.mock_exams.svc.get_published_exam_by_id", return_value=exam), \
         patch("routers.mock_exams.svc.section_time_remaining_seconds", return_value=600), \
         patch("routers.mock_exams.svc.section_duration_seconds", return_value=1800), \
         patch("routers.mock_exams.svc.get_exam_content_for_sitting", return_value={}), \
         patch("routers.mock_exams.attach_signed_image_urls"):
        url = f"/api/mock-exams/sittings/{_SITTING_ID}"
        responses, ping, ping_s, total_s = _run(
            [lambda c: c.get(url, headers=_AUTH), lambda c: c.get(url, headers=_AUTH)])

    _assert_not_blocking(responses, ping, ping_s, total_s, n=2)
    body = responses[0].json()
    assert body["active_section"] == "listening"
    assert body["section_time_left_seconds"] == 600
    assert body["section_duration_seconds"] == 1800
    assert threading.main_thread().ident not in get_sitting.threads


def test_submit_section_does_not_block_the_loop():
    submit = _Slow({"ok": True, "section": "reading"})
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.submit_section", new=submit):
        url = f"/api/mock-exams/sittings/{_SITTING_ID}/sections/reading/submit"
        responses, ping, ping_s, total_s = _run(
            [lambda c: c.post(url, json={}, headers=_AUTH),
             lambda c: c.post(url, json={}, headers=_AUTH)])

    _assert_not_blocking(responses, ping, ping_s, total_s, n=2)
    assert responses[0].json() == {"ok": True, "section": "reading"}
    assert threading.main_thread().ident not in submit.threads


def test_submit_section_writing_claim_does_not_block_the_loop():
    """The Writing branch re-reads the sitting and claims grading jobs — also sync."""
    sitting = {"id": _SITTING_ID, "essay_task1_id": "e1", "essay_task2_id": "e2"}
    claim = _Slow({"queued": []})
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.submit_section", return_value={"ok": True}), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.svc.claim_mock_writing_grading", new=claim):
        url = f"/api/mock-exams/sittings/{_SITTING_ID}/sections/writing/submit"
        responses, ping, ping_s, total_s = _run(
            [lambda c: c.post(url, json={"task1_text": "a", "task2_text": "b"}, headers=_AUTH)])

    _assert_not_blocking(responses, ping, ping_s, total_s, n=1)
    assert responses[0].json() == {"ok": True}
    assert threading.main_thread().ident not in claim.threads


def test_exam_submit_attempt_does_not_block_the_loop():
    submit = _Slow({"attempt_id": "a1", "score": 3})
    with patch("routers.exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.exams.exam_service.submit_attempt", new=submit):
        url = "/api/exams/toeic-1/attempts"
        body = {"answers": [{"q_num": 1, "user_answer": "A"}]}
        responses, ping, ping_s, total_s = _run(
            [lambda c: c.post(url, json=body, headers=_AUTH),
             lambda c: c.post(url, json=body, headers=_AUTH)])

    _assert_not_blocking(responses, ping, ping_s, total_s, n=2)
    assert responses[0].json() == {"attempt_id": "a1", "score": 3}
    # Same positional arguments the handler passed before the offload.
    assert submit.calls[0] == ((_USER["id"], "toeic-1", [{"q_num": 1, "user_answer": "A"}]), {})
    assert threading.main_thread().ident not in submit.threads


def test_listening_review_flags_do_not_block_the_loop():
    attempt = {"id": _ATTEMPT_ID, "user_id": _USER["id"]}
    fetch = _Slow(attempt)
    state = {"attempt_id": _ATTEMPT_ID, "review_flags": []}
    with patch.object(flags_router.listening, "_require_auth", AsyncMock(return_value=_USER)), \
         patch.object(flags_router.listening, "_fetch_attempt_or_404", new=fetch), \
         patch.object(flags_router, "_guard"), \
         patch.object(flags_router, "flag_state_response", return_value=state):
        url = f"/api/listening/tests/attempts/{_ATTEMPT_ID}/review-flags"
        responses, ping, ping_s, total_s = _run(
            [lambda c: c.get(url, headers=_AUTH), lambda c: c.get(url, headers=_AUTH)])

    _assert_not_blocking(responses, ping, ping_s, total_s, n=2)
    assert responses[0].json()["attempt_id"] == _ATTEMPT_ID
    assert responses[0].json()["review_flags"] == []
    assert threading.main_thread().ident not in fetch.threads
