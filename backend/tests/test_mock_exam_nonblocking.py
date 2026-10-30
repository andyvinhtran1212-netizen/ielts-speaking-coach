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
import copy
import threading
import time
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI

from routers import exams as exams_router
from routers import mock_attempt_flags as flags_router
from routers import mock_exams as mock_router
from tests.test_mock_exam_workflow import (  # noqa: F401 — fixtures
    _seed_exam, _seed_retake, fake_db, svc,
)

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


def _two_students():
    users = iter([{"id": "u-1"}, {"id": "u-2"}])

    async def auth(_authorization):
        return next(users)

    return auth


def test_submit_section_does_not_block_the_loop():
    # Two students: one student's writes are serialised on purpose (see
    # test_concurrent_section_starts_of_one_student_stay_serialised).
    submit = _Slow({"ok": True, "section": "reading"})
    with patch("routers.mock_exams.get_supabase_user", new=_two_students()), \
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


class _RacyRetakeClocks:
    """Mimics svc.start_section's read-check-write: it checks the OTHER clocks
    on a snapshot, then compare-and-sets only its own column (Codex P2 on
    #2088). Before the offload the single event loop serialised two starts;
    in worker threads they interleave unless the router serialises them."""

    def __init__(self):
        self.started = {}

    def __call__(self, sitting_id, user_id, section):
        snapshot = dict(self.started.get(user_id, {}))
        time.sleep(0.2)  # the PostgREST read/write round-trips
        if any(s != section for s in snapshot):
            raise mock_router.svc.SittingConflictError(
                "Đang làm phần khác — nộp xong mới bắt đầu phần khác.")
        self.started.setdefault(user_id, {})[section] = True
        return {"id": sitting_id, f"{section}_started_at": "now"}


def test_concurrent_section_starts_of_one_student_stay_serialised():
    clocks = _RacyRetakeClocks()
    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.start_section", new=clocks):
        base = f"/api/mock-exams/sittings/{_SITTING_ID}/sections"
        responses, ping, ping_s, _ = _run(
            [lambda c: c.post(f"{base}/reading/start", headers=_AUTH),
             lambda c: c.post(f"{base}/writing/start", headers=_AUTH)])

    # The loop stays free while the starts queue behind each other.
    assert ping.status_code == 200 and ping_s < 0.2, ping_s
    assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
    assert len(clocks.started[_USER["id"]]) == 1


def test_different_students_are_not_serialised():
    start = _Slow({"ok": True})
    with patch("routers.mock_exams.get_supabase_user", new=_two_students()), \
         patch("routers.mock_exams.svc.start_section", new=start):
        url = f"/api/mock-exams/sittings/{_SITTING_ID}/sections/reading/start"
        responses, ping, ping_s, total_s = _run(
            [lambda c: c.post(url, headers=_AUTH), lambda c: c.post(url, headers=_AUTH)])

    _assert_not_blocking(responses, ping, ping_s, total_s, n=2)


def test_student_write_keeps_lock_through_repeated_cancel():
    """CR P3 on #2088 (PC-J456): a request cancelled a SECOND time while it
    waits for its uninterruptible thread must still hold the student's lock
    until the thread returns, and only then re-raise CancelledError."""
    uid = "u-cancel"
    release = threading.Event()
    order = []

    def first():
        order.append("first-start")
        release.wait(5)
        order.append("first-end")
        return "first"

    def second():
        order.append("second-start")
        return "second"

    async def scenario():
        lock = mock_router._student_write_lock(uid)
        task = asyncio.create_task(mock_router._student_write(uid, first))
        follower = None
        try:
            while "first-start" not in order:
                await asyncio.sleep(0.01)
            task.cancel()
            await asyncio.sleep(0)
            task.cancel()
            await asyncio.sleep(0)
            await asyncio.sleep(0.05)
            assert lock.locked(), "lock released while the first write is still running"
            assert not task.done()

            follower = asyncio.create_task(mock_router._student_write(uid, second))
            await asyncio.sleep(0.05)
            assert "second-start" not in order, order
        finally:
            release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert await follower == "second"
        assert order == ["first-start", "first-end", "second-start"]
        assert not lock.locked()

    asyncio.run(scenario())


# ── Writing grading dispatch survives a cancelled submit (PC-J468) ──
# Codex P2 on #2088 (thread yDmG8): the claim runs in the worker thread and
# moves the essays pending→grading + queues the jobs; a request cancelled while
# it waits for that thread re-raised before the dispatch, and a resubmit cannot
# re-claim a non-pending essay. Only the stuck-job reaper (360 s + one lost
# attempt) would have picked them up.

_QUEUED = [("e1", "j1"), ("e2", "j2")]


def _submit_scenario(section, claimed, *, cancel):
    """Drive the submit handler with a claim that blocks until released.

    Returns (outcome, dispatched, background_tasks): outcome is the handler's
    result or the CancelledError it raised; dispatched lists every
    ``_bg_grade_essay`` call made by any path, BackgroundTasks included."""
    from fastapi import BackgroundTasks

    entered, release = threading.Event(), threading.Event()
    dispatched = []
    sitting = {"id": _SITTING_ID, "essay_task1_id": "e1", "essay_task2_id": "e2"}

    def claim(_essay_ids):
        entered.set()
        release.wait(5)
        return {"queued": list(claimed), "short": [], "skipped": []}

    def submit(*_args):
        if section != "writing":
            entered.set()
            release.wait(5)
        return {"ok": True, "section": section}

    async def bg_grade(essay_id, job_id, **_kwargs):
        dispatched.append((essay_id, job_id))

    async def scenario():
        tasks = BackgroundTasks()
        handler = asyncio.create_task(mock_router.submit_section(
            _SITTING_ID, section, mock_router.SectionSubmitBody(task1_text="a", task2_text="b"),
            tasks, authorization="Bearer faketoken",
        ))
        try:
            while not entered.is_set():
                await asyncio.sleep(0.01)
            if cancel:
                handler.cancel()
                await asyncio.sleep(0)
                handler.cancel()      # a second cancel while the thread still runs
                await asyncio.sleep(0.05)
        finally:
            release.set()
        try:
            outcome = await handler
        except asyncio.CancelledError as e:
            outcome = e
        # Starlette runs BackgroundTasks after the response; a cancelled request
        # never sends one, so they only run on the normal path.
        if not cancel:
            await tasks()
        deadline = time.monotonic() + 2
        expected = len(claimed) if section == "writing" else 0
        while len(dispatched) < expected and time.monotonic() < deadline:
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.1)      # a duplicate dispatch would land here
        return outcome, dispatched, tasks

    with patch("routers.mock_exams.get_supabase_user", new=AsyncMock(return_value=_USER)), \
         patch("routers.mock_exams.svc.submit_section", new=submit), \
         patch("routers.mock_exams.svc.get_sitting", return_value=sitting), \
         patch("routers.mock_exams.svc.claim_mock_writing_grading", new=claim), \
         patch("routers.mock_exams.essay_service._bg_grade_essay", new=bg_grade):
        return asyncio.run(scenario())


def test_cancelled_writing_submit_still_dispatches_each_claimed_job_once():
    outcome, dispatched, tasks = _submit_scenario("writing", _QUEUED, cancel=True)

    assert isinstance(outcome, asyncio.CancelledError), outcome  # lock behaviour kept
    assert sorted(dispatched) == sorted(_QUEUED), dispatched
    assert not tasks.tasks      # not also handed to the response's BackgroundTasks


def test_writing_submit_without_cancel_dispatches_each_claimed_job_once():
    outcome, dispatched, tasks = _submit_scenario("writing", _QUEUED, cancel=False)

    assert outcome == {"ok": True, "section": "writing"}
    assert sorted(dispatched) == sorted(_QUEUED), dispatched
    assert len(tasks.tasks) == len(_QUEUED)


@pytest.mark.parametrize("cancel", [True, False])
@pytest.mark.parametrize("section, claimed", [
    ("listening", _QUEUED), ("reading", _QUEUED), ("writing", []),
])
def test_submit_without_claimed_jobs_dispatches_nothing(section, claimed, cancel):
    """Listening/Reading never claim (the claim double is not even reached), and
    an empty claim queues nothing — with or without a cancel."""
    outcome, dispatched, tasks = _submit_scenario(section, claimed, cancel=cancel)

    assert isinstance(outcome, asyncio.CancelledError) if cancel \
        else outcome == {"ok": True, "section": section}
    assert dispatched == []
    assert not tasks.tasks


# ── Same-sitting races through the REAL service (CR G4 serial checklist) ──
# FakeSupabase hands out its shared row dict, which hides a stale snapshot, so
# get_sitting returns a deep copy after a PostgREST-sized delay.

def _slow_deepcopy_get_sitting(monkeypatch, svc):
    real = svc.get_sitting

    def slow(sitting_id):
        row = copy.deepcopy(real(sitting_id))
        time.sleep(0.2)
        return row

    monkeypatch.setattr(svc, "get_sitting", slow)


def _post_staggered(user_id, urls_and_bodies):
    """Fire the requests 50 ms apart (deterministic interleaving) and gather."""

    async def go():
        transport = httpx.ASGITransport(app=_app())
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            tasks = []
            for url, body in urls_and_bodies:
                tasks.append(asyncio.create_task(client.post(url, json=body, headers=_AUTH)))
                await asyncio.sleep(0.05)
            return await asyncio.gather(*tasks)

    with patch("routers.mock_exams.get_supabase_user",
               new=AsyncMock(return_value={"id": str(user_id)})):
        return asyncio.run(go())


def test_parallel_retake_starts_on_one_sitting_open_exactly_one_clock(fake_db, svc, monkeypatch):
    """Codex P2 / CR on #2088 (staging 200/409, 95c01b1fc 200/200): start_section
    checks the OTHER clocks on its snapshot, then compare-and-sets only its own
    column. N simultaneous starts of different sections must open ONE clock."""
    u = uuid4()
    skills = ["listening", "reading", "writing"]
    _seed_retake(fake_db, u, skills)
    sitting = svc.create_sitting(u, "MOCK-TEST-A")
    _slow_deepcopy_get_sitting(monkeypatch, svc)

    base = f"/api/mock-exams/sittings/{sitting['id']}/sections"
    responses = _post_staggered(u, [(f"{base}/{sec}/start", None) for sec in skills])

    assert sorted(r.status_code for r in responses) == [200, 409, 409], [r.text for r in responses]
    row = next(r for r in fake_db.rows("mock_exam_sittings") if r["id"] == sitting["id"])
    running = [k for k in skills if row.get(f"{k}_started_at")]
    assert len(running) == 1, f"clocks running: {running}"


def test_parallel_attach_cannot_trade_answers_for_a_blank_attempt(fake_db, svc, monkeypatch):
    """CR on #2088: attach_attempt decides on the sitting snapshot whether a
    re-bind would orphan answers. Two simultaneous attaches (the attempt with
    answers, then a blank one) must keep the answered attempt bound, as the
    loop-serialised handler did."""
    exam = _seed_exam(fake_db, listening=False)   # one advance opens Reading
    u = uuid4()
    sitting = svc.create_sitting(u, "MOCK-TEST-A")
    svc.advance_section(exam["id"], str(uuid4()))
    answered, blank = str(uuid4()), str(uuid4())
    for attempt_id in (answered, blank):
        fake_db.seed("reading_test_attempts",
                     {"id": attempt_id, "user_id": str(u), "test_id": exam["reading_test_id"],
                      "status": "in_progress", "sitting_id": None})
    fake_db.seed("reading_attempt_answers", {"attempt_id": answered, "user_answer": "TRUE"})
    _slow_deepcopy_get_sitting(monkeypatch, svc)

    url = f"/api/mock-exams/sittings/{sitting['id']}/attach"
    responses = _post_staggered(u, [
        (url, {"section": "reading", "attempt_id": answered}),
        (url, {"section": "reading", "attempt_id": blank}),
    ])

    assert [r.status_code for r in responses] == [200, 409], [r.text for r in responses]
    row = next(r for r in fake_db.rows("mock_exam_sittings") if r["id"] == sitting["id"])
    assert row["reading_attempt_id"] == answered
