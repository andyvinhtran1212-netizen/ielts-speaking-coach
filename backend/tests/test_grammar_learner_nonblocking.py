"""Learner grammar offloading, service contracts and same-session writes."""

import asyncio
import copy
import threading
import time
import weakref
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routers import grammar_diagnostic as diagnostic
from routers import grammar_lesson as lesson


@pytest.fixture(autouse=True)
def _fresh_event_loop_locks(monkeypatch):
    # Each pytest case has a new event loop. Retained exception tracebacks can
    # keep a prior loop's otherwise weakly held lock alive between cases.
    monkeypatch.setattr(diagnostic, "_session_write_locks", weakref.WeakValueDictionary(), raising=False)


CASES = [
    (diagnostic, "availability", "is_enabled", (), {},
     ("master30_grammar_self_serve",), {"default": False}),
    (diagnostic, "create_session", "create_session", (diagnostic.SessionCreate(),), {},
     ("learner",), {"mode": "ENTRY", "module": "GENERAL", "test_length": "QUICK",
                   "class_assignment_item_id": None}),
    (diagnostic, "list_sessions", "learner_history", (), {}, ("learner",), {}),
    (diagnostic, "get_session", "session_summary", ("session",), {}, ("learner", "session"), {}),
    (diagnostic, "next_item", "next_item", ("session",), {}, ("learner", "session"), {}),
    (diagnostic, "submit_response", "record_response",
     ("session", diagnostic.ResponseCreate(item_id="q1", selected_option=1)), {},
     ("learner", "session"), {"item_id": "q1", "selected_option": 1,
                             "response_time_ms": None, "assistance_used": False}),
    (diagnostic, "complete_session", "finalize_session", ("session",), {},
     ("learner", "session"), {}),
    (diagnostic, "get_report", "learner_report", ("session",), {}, ("learner", "session"), {}),
    (lesson, "read_item", "read_item", ("item",), {}, ("learner", "item"), {}),
    (lesson, "start_item", "start_item", ("item",), {}, ("learner", "item"), {}),
    (lesson, "answer_item", "answer_item",
     ("item", lesson.AnswerBody(question_id="q1", answer_text="My answer")), {},
     ("learner", "item", "q1", None), {"answer_text": "My answer"}),
]


async def _authenticated(_authorization):
    return {"id": "learner"}


def _target(module, name):
    return module.runtime_flags if name == "is_enabled" else module.service


@pytest.mark.asyncio
@pytest.mark.parametrize("case", CASES, ids=[row[1] for row in CASES])
async def test_learner_service_yields_loop_and_preserves_arguments(monkeypatch, case):
    module, route, service, args, kwargs, expected_args, expected_kwargs = case
    monkeypatch.setattr(module, "get_supabase_user", _authenticated)
    called = []
    loop_thread = threading.get_ident()

    def slow(*a, **kw):
        called.append((a, kw, threading.get_ident()))
        time.sleep(0.5)
        return True if route == "availability" else {"saved": True}

    monkeypatch.setattr(_target(module, service), service, slow)
    started = time.perf_counter()

    async def light_request():
        await asyncio.sleep(0)
        return time.perf_counter() - started

    result, delay = await asyncio.gather(
        getattr(module, route)(*args, authorization="Bearer test", **kwargs), light_request(),
    )
    assert delay < 0.2
    assert called[0][:2] == (expected_args, expected_kwargs)
    assert called[0][2] != loop_thread
    if route == "availability":
        assert result.assigned_only is False
    elif route == "list_sessions":
        assert result == {"sessions": {"saved": True}}
    else:
        assert result == {"saved": True}


@pytest.mark.asyncio
@pytest.mark.parametrize("case", CASES, ids=[row[1] for row in CASES])
async def test_learner_auth_failure_precedes_service(monkeypatch, case):
    module, route, service, args, kwargs, *_ = case

    async def denied(_authorization):
        raise HTTPException(401, "unauthorized")

    def unexpected(*_a, **_kw):
        pytest.fail("Service ran before authentication")

    monkeypatch.setattr(module, "get_supabase_user", denied)
    monkeypatch.setattr(_target(module, service), service, unexpected)
    with pytest.raises(HTTPException) as caught:
        await getattr(module, route)(*args, authorization=None, **kwargs)
    assert (caught.value.status_code, caught.value.detail) == (401, "unauthorized")


@pytest.mark.asyncio
@pytest.mark.parametrize("second_route", ["next_item", "submit_response", "complete_session"])
@pytest.mark.parametrize("session_ids", [
    ("session", "session"),
    ("D076F452-09AE-4B65-B261-108C65564667", "d076f45209ae4b65b261108c65564667"),
])
async def test_session_check_then_write_has_exactly_one_winner(monkeypatch, second_route, session_ids):
    """Slow reads return independent snapshots, never the fake's shared row."""
    monkeypatch.setattr(diagnostic, "get_supabase_user", _authenticated)
    row = {"status": "in_progress"}
    writes = []

    def write(*_a, **_kw):
        snapshot = copy.deepcopy(row)
        time.sleep(0.05)
        if snapshot["status"] != "in_progress":
            raise HTTPException(409, "closed")
        row["status"] = "completed"
        writes.append(threading.get_ident())
        return {"accepted": True}

    for name in ("next_item", "record_response", "finalize_session"):
        monkeypatch.setattr(diagnostic.service, name, write)
    second_args = (session_ids[1],)
    if second_route == "submit_response":
        second_args += (diagnostic.ResponseCreate(item_id="q1", selected_option=1),)
    results = await asyncio.gather(
        diagnostic.next_item(session_ids[0], authorization="test"),
        getattr(diagnostic, second_route)(*second_args, authorization="test"),
        return_exceptions=True,
    )
    assert sum(isinstance(result, dict) for result in results) == 1
    conflicts = [result for result in results if isinstance(result, HTTPException)]
    assert len(conflicts) == 1 and conflicts[0].status_code == 409
    assert len(writes) == 1


@pytest.mark.asyncio
async def test_real_next_item_reads_completed_state_after_concurrent_completion(monkeypatch):
    monkeypatch.setattr(diagnostic, "get_supabase_user", _authenticated)
    svc = diagnostic.service
    row = {"status": "in_progress", "release_id": "R1", "test_length": "QUICK",
           "current_phase": "BASELINE", "objective_limit": 28}
    entered, completed = threading.Event(), threading.Event()
    writes = []

    def slow_session(*_a):
        snapshot = copy.deepcopy(row)
        time.sleep(0.05)
        return snapshot

    def complete(*_a):
        entered.set()
        time.sleep(0.15)
        row.update(status="completed", current_phase="COMPLETED")
        writes.append("completed")
        completed.set()
        return {"persisted_report": True}

    class Query:
        def select(self, *_a): return self
        def eq(self, *_a): return self
        def range(self, *_a): return self
        def execute(self): return SimpleNamespace(data=[])

        def update(self, _data):
            assert row["status"] == "completed"
            pytest.fail("A stale next_item attempted to update a completed session")

    def content(*_a):
        assert completed.wait(2)
        return {"items": []}

    monkeypatch.setattr(svc, "_session", slow_session)
    monkeypatch.setattr(svc, "finalize_session", complete)
    monkeypatch.setattr(svc, "session_summary", lambda _user, session: copy.deepcopy(session))
    monkeypatch.setattr(svc, "_require_session_accepting", lambda *_a: None)
    monkeypatch.setattr(svc, "_content", content)
    monkeypatch.setattr(svc, "_responses", lambda *_a: [])
    monkeypatch.setattr(svc, "_exposures", lambda *_a: [])
    monkeypatch.setattr(svc, "_practice_exposure", lambda *_a: {
        "item_ids": set(), "stimulus_families": set(), "parallel_set_ids": set(),
    })
    monkeypatch.setattr(svc, "_selection_attribute", lambda *_a: ["M01"])
    monkeypatch.setattr(svc, "supabase_admin", type("DB", (), {"table": lambda *_a: Query()})())
    finishing = asyncio.create_task(diagnostic.complete_session("session", authorization="test"))
    assert await asyncio.to_thread(entered.wait, 2)
    try:
        next_result = await diagnostic.next_item("session", authorization="test")
    finally:
        report = await finishing
    assert report == {"persisted_report": True}
    assert next_result["complete"] is True
    assert next_result["session"]["current_phase"] == "COMPLETED"
    assert writes == ["completed"]


@pytest.mark.asyncio
@pytest.mark.parametrize("worker_fails", [False, True])
async def test_cancelled_session_write_keeps_lock_until_thread_finishes(monkeypatch, worker_fails):
    monkeypatch.setattr(diagnostic, "get_supabase_user", _authenticated)
    entered, release, second_entered = threading.Event(), threading.Event(), threading.Event()

    def first(*_a):
        entered.set()
        assert release.wait(5)
        if worker_fails:
            raise HTTPException(409, "worker failed after disconnect")
        return {"complete": False}

    def second(*_a, **_kw):
        second_entered.set()
        return {"accepted": True}

    monkeypatch.setattr(diagnostic.service, "next_item", first)
    monkeypatch.setattr(diagnostic.service, "record_response", second)
    request = asyncio.create_task(diagnostic.next_item("session", authorization="test"))
    assert await asyncio.to_thread(entered.wait, 2)
    following = asyncio.create_task(diagnostic.submit_response(
        "session", diagnostic.ResponseCreate(item_id="q1", selected_option=0), authorization="test",
    ))
    try:
        for _ in range(2):
            request.cancel()
            await asyncio.sleep(0.02)
            assert not second_entered.is_set()
            assert not request.done()
    finally:
        release.set()
        results = await asyncio.gather(request, following, return_exceptions=True)
    assert isinstance(results[0], asyncio.CancelledError)
    assert results[1] == {"accepted": True}
    # The captured CancelledError retains its traceback and lock reference.
    # Its release, rather than the timing of garbage collection, is the contract.
    assert all(not lock.locked() for lock in diagnostic._session_write_locks.values())


@pytest.mark.asyncio
async def test_different_sessions_write_in_parallel(monkeypatch):
    monkeypatch.setattr(diagnostic, "get_supabase_user", _authenticated)
    barrier = threading.Barrier(2)

    def write(_user, session):
        barrier.wait(timeout=2)
        return {"session": session}

    monkeypatch.setattr(diagnostic.service, "next_item", write)
    assert await asyncio.gather(
        diagnostic.next_item("session-a", authorization="test"),
        diagnostic.next_item("session-b", authorization="test"),
    ) == [{"session": "session-a"}, {"session": "session-b"}]
