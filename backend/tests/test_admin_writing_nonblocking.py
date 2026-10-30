"""PC-J427: slow admin Writing I/O must leave the ASGI event loop free."""

import asyncio
import threading
import time
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI

from routers import admin_writing_assignments as assignments
from routers import admin_writing_cohorts as cohorts
from routers import admin_writing_prompts as prompts
from routers import admin_writing_regrade as regrade


_ADMIN = {"id": "00000000-0000-0000-0000-000000000001", "email": "admin@example.test"}
_REQUEST = "00000000-0000-4000-8000-000000000002"
_PROMPT = "00000000-0000-4000-8000-000000000003"
_COHORT = "00000000-0000-4000-8000-000000000004"
_STUDENT = "00000000-0000-4000-8000-000000000005"
_ASSIGNMENT = "00000000-0000-4000-8000-000000000006"


class _Call:
    def __init__(self, name, result, calls, *, delay=0):
        self.name, self.result, self.calls, self.delay = name, result, calls, delay
        self.started = threading.Event()
        self.finished = threading.Event()

    def __call__(self, *args, **kwargs):
        self.calls.append((self.name, threading.get_ident()))
        self.started.set()
        time.sleep(self.delay)
        self.finished.set()
        return self.result


def _app(module):
    app = FastAPI()
    app.include_router(module.router)

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    return app


def _with_ping(module, call, method, path, **kwargs):
    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=_app(module)), base_url="http://test",
        ) as client:
            loop_thread = threading.get_ident()
            start = time.perf_counter()
            slow = asyncio.create_task(client.request(method, path, **kwargs))
            while not call.started.is_set() and not slow.done():
                await asyncio.sleep(0.001)
            ping = await client.get("/ping")
            elapsed = time.perf_counter() - start
            still_running = not call.finished.is_set()
            response = await slow
        return loop_thread, ping, elapsed, still_running, response

    loop_thread, ping, elapsed, still_running, response = asyncio.run(run())
    assert ping.status_code == 200
    assert call.started.is_set(), response.text
    assert elapsed < 0.2, f"light request waited {elapsed:.3f}s behind admin Writing I/O"
    assert still_running, "light request must finish during the slow I/O"
    assert all(thread != loop_thread for _, thread in call.calls)
    return response


def test_upload_image_does_not_block_loop(monkeypatch):
    calls = []
    result = {"url": "https://example.test/chart.png", "public_id": "prompts/chart.png",
              "width": None, "height": None}
    upload = _Call("upload", result, calls, delay=0.5)
    monkeypatch.setattr(prompts, "require_admin", AsyncMock(return_value=_ADMIN))
    monkeypatch.setattr(prompts, "upload_prompt_image", upload)
    response = _with_ping(
        prompts, upload, "POST", "/admin/writing/prompts/upload-image",
        files={"file": ("chart.png", b"\x89PNG\r\n\x1a\n" + b"0" * 300, "image/png")},
    )
    assert response.status_code == 201
    assert response.json() == result


def test_fan_out_to_cohort_does_not_block_loop_and_keeps_receipt_roster_rpc_order(monkeypatch):
    calls = []
    receipt = _Call("receipt", None, calls, delay=0.5)
    roster = _Call("roster", [_STUDENT], calls)
    result = {"created_count": 1, "group_id": _REQUEST, "replayed": False}
    execute = _Call("rpc", SimpleNamespace(data=result), calls)
    monkeypatch.setattr(assignments, "require_admin", AsyncMock(return_value=_ADMIN))
    monkeypatch.setattr(assignments, "_read_assignment_request_receipt", receipt)
    monkeypatch.setattr(assignments, "active_student_ids_for_cohort", roster)
    monkeypatch.setattr(assignments, "supabase_admin", SimpleNamespace(
        rpc=lambda *a, **kw: SimpleNamespace(execute=execute),
    ))
    response = _with_ping(
        assignments, receipt, "POST", "/admin/writing/assignments/fan-out",
        json={"request_id": _REQUEST, "prompt_id": _PROMPT, "cohort_id": _COHORT,
              "expected_student_count": 1},
    )
    assert response.status_code == 201
    assert response.json() == result
    assert [name for name, _ in calls] == ["receipt", "roster", "rpc"]
    assert len({thread for _, thread in calls}) == 1


def test_list_cohorts_does_not_block_loop(monkeypatch):
    query = _Call("cohorts", SimpleNamespace(data=[]), [], delay=0.5)

    class Query:
        def select(self, *a, **kw): return self
        def eq(self, *a, **kw): return self
        def order(self, *a, **kw): return self
        execute = query

    monkeypatch.setattr(cohorts, "require_admin", AsyncMock(return_value=_ADMIN))
    monkeypatch.setattr(cohorts, "supabase_admin", SimpleNamespace(table=lambda name: Query()))
    monkeypatch.setattr(cohorts.test_data_visibility, "hide_for", lambda **kw: False)
    response = _with_ping(cohorts, query, "GET", "/admin/writing/cohorts")
    assert response.status_code == 200
    assert response.json() == {"cohorts": []}


def test_list_regrade_requests_does_not_block_loop(monkeypatch):
    result = {"requests": [], "capped": False}
    execute = _Call("regrade", SimpleNamespace(data=result), [], delay=0.5)
    monkeypatch.setattr(regrade, "require_admin", AsyncMock(return_value=_ADMIN))
    monkeypatch.setattr(regrade, "supabase_admin", SimpleNamespace(
        rpc=lambda *a, **kw: SimpleNamespace(execute=execute),
    ))
    response = _with_ping(regrade, execute, "GET", "/admin/writing/regrade-requests")
    assert response.status_code == 200
    assert response.json() == result


def test_create_assignments_keeps_receipt_archived_check_and_insert_in_one_worker(monkeypatch):
    calls = []
    receipt = _Call("receipt", None, calls, delay=0.5)
    archived = _Call("archived", None, calls)
    result = {"created": [], "created_count": 0, "group_id": _REQUEST,
              "duplicates_warning": [], "replayed": False}
    execute = _Call("rpc", SimpleNamespace(data=result), calls)
    monkeypatch.setattr(assignments, "require_admin", AsyncMock(return_value=_ADMIN))
    monkeypatch.setattr(assignments, "_read_assignment_request_receipt", receipt)
    monkeypatch.setattr(assignments, "_refuse_archived_students", archived)
    monkeypatch.setattr(assignments, "supabase_admin", SimpleNamespace(
        rpc=lambda *a, **kw: SimpleNamespace(execute=execute),
    ))
    response = _with_ping(
        assignments, receipt, "POST", "/admin/writing/assignments",
        json={"request_id": _REQUEST, "prompt_id": _PROMPT, "student_ids": [_STUDENT]},
    )
    assert response.status_code == 201
    assert response.json() == {"created": [], "count": 0, "group_id": _REQUEST,
                               "duplicates_warning": [], "replayed": False}
    assert [name for name, _ in calls] == ["receipt", "archived", "rpc"]
    assert len({thread for _, thread in calls}) == 1


def test_regrade_partial_write_observation_survives_thread_context(monkeypatch):
    from services import core_writing_observation as observation

    result = {"ok": True, "request": {
        "id": _REQUEST, "status": "accepted", "essay_id": _PROMPT,
    }}
    monkeypatch.setattr(regrade, "require_admin", AsyncMock(return_value=_ADMIN))
    monkeypatch.setattr(regrade, "supabase_admin", SimpleNamespace(
        rpc=lambda *a, **kw: SimpleNamespace(execute=lambda: SimpleNamespace(data=result)),
    ))
    monkeypatch.setattr(observation.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)
    observer = AsyncMock()
    monkeypatch.setattr(observation, "observe_writing_batch", observer)
    monkeypatch.setattr(regrade, "observe_writing_batch", observer)

    def failed_decoration(rows):
        raise RuntimeError("context lookup failed after accepted write")

    monkeypatch.setattr(regrade, "_decorate", failed_decoration)

    async def run():
        with pytest.raises(RuntimeError, match="context lookup failed"):
            await regrade.action_regrade_request(
                UUID(_REQUEST), regrade.RegradeAction(action="accept"), authorization=None,
            )

    asyncio.run(run())
    observer.assert_awaited_once_with([_PROMPT])


class _AssignmentStore:
    """Independent read snapshots; atomic predicate matching and update."""

    def __init__(self, status):
        self.row = {"id": _ASSIGNMENT, "status": status}
        self.lock = threading.Lock()
        self.reads = 0
        self.writes = 0
        self.after_read = lambda read_number: None

    def table(self, name):
        assert name == "writing_assignments"
        store = self

        class Query:
            def __init__(self):
                self.filters = {}
                self.patch = None

            def select(self, columns): return self
            def limit(self, count): return self

            def eq(self, column, value):
                self.filters[column] = value
                return self

            def update(self, patch):
                self.patch = patch
                return self

            def execute(self):
                with store.lock:
                    matches = store.row is not None and all(
                        store.row.get(key) == value for key, value in self.filters.items()
                    )
                    if self.patch is not None and matches:
                        store.row.update(self.patch)
                        store.writes += 1
                    data = [deepcopy(store.row)] if matches else []
                    if self.patch is None:
                        store.reads += 1
                        read_number = store.reads
                if self.patch is None:
                    store.after_read(read_number)
                return SimpleNamespace(data=data)

        return Query()


@pytest.mark.parametrize("current,targets", [
    ("pending", ("in_progress", "delivered")),
    ("in_progress", ("submitted", "delivered")),
    ("in_progress", ("submitted", "submitted")),
    ("submitted", ("graded", "delivered")),
])
def test_concurrent_assignment_status_patches_only_one_succeeds(monkeypatch, current, targets):
    db = _AssignmentStore(current)
    both_read = threading.Barrier(2)
    reader_threads = set()

    def slow_get(read_number):
        if read_number <= 2:
            reader_threads.add(threading.get_ident())
            # Both workers hold deep copies of the old row before either writes.
            both_read.wait(timeout=5)
            time.sleep(0.05)

    db.after_read = slow_get
    monkeypatch.setattr(assignments, "require_admin", AsyncMock(return_value=_ADMIN))
    monkeypatch.setattr(assignments, "supabase_admin", db)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=_app(assignments)), base_url="http://test",
        ) as client:
            return await asyncio.gather(*(
                client.patch(f"/admin/writing/assignments/{_ASSIGNMENT}", json={
                    "status": target, "instructions": f"request-{i}",
                }) for i, target in enumerate(targets)
            ))

    responses = asyncio.run(run())
    assert len(reader_threads) == 2
    assert sorted(r.status_code for r in responses) == [200, 409]
    winner = next(r for r in responses if r.status_code == 200)
    loser = next(r for r in responses if r.status_code == 409)
    assert loser.json() == {"detail": "Assignment changed; reload"}
    assert db.writes == 1
    assert db.row == winner.json()
    timestamp = {"submitted": "submitted_at", "graded": "graded_at", "delivered": "delivered_at"}
    expected_stamp = timestamp.get(db.row["status"])
    assert {key for key in timestamp.values() if key in db.row} == (
        {expected_stamp} if expected_stamp else set()
    )


@pytest.mark.parametrize("changed_status,requested_status,expected_code", [
    (None, "submitted", 404),
    ("delivered", "submitted", 409),
    ("submitted", "in_progress", 409),
])
def test_assignment_status_patch_detects_change_after_read(
    monkeypatch, changed_status, requested_status, expected_code,
):
    db = _AssignmentStore("in_progress")

    def concurrent_change(read_number):
        if read_number == 1:
            with db.lock:
                if changed_status is None:
                    db.row = None
                else:
                    db.row["status"] = changed_status

    db.after_read = concurrent_change
    monkeypatch.setattr(assignments, "require_admin", AsyncMock(return_value=_ADMIN))
    monkeypatch.setattr(assignments, "supabase_admin", db)

    async def run():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=_app(assignments)), base_url="http://test",
        ) as client:
            return await client.patch(f"/admin/writing/assignments/{_ASSIGNMENT}", json={
                "status": requested_status, "instructions": "stale update",
            })

    response = asyncio.run(run())
    assert response.status_code == expected_code
    assert response.json() == {"detail": (
        "Assignment not found" if expected_code == 404 else "Assignment changed; reload"
    )}
    assert db.writes == 0
    assert db.row == (None if changed_status is None else {
        "id": _ASSIGNMENT, "status": changed_status,
    })


@pytest.mark.parametrize("patch", [
    {"deadline": None, "instructions": "updated"},
    {"status": None, "instructions": "updated"},
    {"status": "in_progress", "instructions": "updated"},
])
def test_assignment_patch_preserves_nonstatus_and_same_status_updates(monkeypatch, patch):
    db = _AssignmentStore("in_progress")
    monkeypatch.setattr(assignments, "require_admin", AsyncMock(return_value=_ADMIN))
    monkeypatch.setattr(assignments, "supabase_admin", db)

    result = asyncio.run(assignments.update_assignment(
        UUID(_ASSIGNMENT), assignments.AssignmentUpdate(**patch),
    ))
    assert result == db.row == {
        "id": _ASSIGNMENT, **patch, "status": "in_progress",
    }
    assert db.writes == 1
    assert db.reads == (1 if patch.get("status") is not None else 0)
