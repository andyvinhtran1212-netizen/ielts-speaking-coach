"""
tests/test_analytics_nonblocking.py — incident 2026-10-30 hotfix.

POST /api/analytics/events used to run the sync Supabase insert on the event
loop, so on the single uvicorn process every page_view beacon stalled every
other request (incl. OPTIONS and /health) for one Supabase round-trip. The
insert now runs in a worker thread on that thread's own client, with a bounded
number in flight.
"""

import asyncio
import threading
import time

import httpx
from fastapi import FastAPI

from routers import analytics as analytics_module


class _SlowInsert:
    """Per-thread client double whose execute() blocks like a slow round-trip."""

    def __init__(self, delay=0.0, fail=False):
        self.delay = delay
        self.fail = fail
        self.inserted = []
        self.threads = []
        self.finished = 0

    def table(self, _name): return self
    def insert(self, row): self.inserted.append(row); return self

    def execute(self):
        self.threads.append(threading.get_ident())
        time.sleep(self.delay)
        self.finished += 1
        if self.fail:
            raise RuntimeError("supabase down")
        return type("R", (), {"data": []})()


def _patch(monkeypatch, stub, slots=analytics_module._MAX_IN_FLIGHT_INSERTS):
    sem = threading.BoundedSemaphore(slots)
    monkeypatch.setattr(analytics_module, "thread_supabase_admin", lambda: stub)
    monkeypatch.setattr(analytics_module, "_insert_slots", sem)
    return sem


def _app():
    app = FastAPI()
    app.include_router(analytics_module.router)

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    return app


def _event():
    return {"event_name": "page_view", "event_data": {"path": "/x"}}


def test_slow_insert_does_not_block_other_requests(monkeypatch):
    stub = _SlowInsert(delay=0.6)
    _patch(monkeypatch, stub)

    async def scenario():
        transport = httpx.ASGITransport(app=_app())
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            start = time.perf_counter()
            beacon = asyncio.create_task(client.post("/api/analytics/events", json=_event()))
            await asyncio.sleep(0.05)  # let the beacon reach its insert
            ping = await client.get("/ping")
            ping_s = time.perf_counter() - start
            insert_running = stub.inserted and not stub.finished
            return await beacon, ping, ping_s, insert_running

    beacon, ping, ping_s, insert_running = asyncio.run(scenario())
    assert ping.status_code == 200
    # Timed from the beacon's start: an insert on the loop thread would hold
    # /ping for its whole 0.6 s.
    assert ping_s < 0.3, f"/ping waited {ping_s:.3f}s behind the analytics insert"
    assert insert_running, "/ping answered while the insert was still in flight"
    assert beacon.status_code == 200 and beacon.json() == {"ok": True}
    assert len(stub.inserted) == 1


def test_concurrent_beacons_overlap_instead_of_serialising(monkeypatch):
    stub = _SlowInsert(delay=0.3)
    _patch(monkeypatch, stub)
    payload = analytics_module.AnalyticsEventPayload(**_event())

    async def five():
        start = time.perf_counter()
        await asyncio.gather(*(analytics_module.record_event(payload, authorization=None)
                               for _ in range(5)))
        return time.perf_counter() - start

    # Five 300 ms inserts on the loop thread would take 1.5 s.
    assert asyncio.run(five()) < 0.9
    assert len(stub.inserted) == 5


def test_insert_runs_off_the_loop_thread_on_a_per_thread_client(monkeypatch):
    stub = _SlowInsert()
    _patch(monkeypatch, stub)
    factory_threads = []

    def factory():
        factory_threads.append(threading.get_ident())
        return stub

    monkeypatch.setattr(analytics_module, "thread_supabase_admin", factory)
    payload = analytics_module.AnalyticsEventPayload(**_event())

    async def run():
        loop_thread = threading.get_ident()
        out = await analytics_module.record_event(payload, authorization=None)
        return loop_thread, out

    loop_thread, out = asyncio.run(run())
    assert out == {"ok": True}
    assert factory_threads and factory_threads[0] != loop_thread
    assert stub.threads == factory_threads, "client is resolved inside the worker thread"
    assert not hasattr(analytics_module, "supabase_admin"), "shared singleton is not used"


def test_failed_insert_still_ok_and_releases_its_slot(monkeypatch):
    stub = _SlowInsert(fail=True)
    sem = _patch(monkeypatch, stub, slots=1)
    payload = analytics_module.AnalyticsEventPayload(**_event())

    async def twice():
        return [await analytics_module.record_event(payload, authorization=None)
                for _ in range(2)]

    assert asyncio.run(twice()) == [{"ok": True}, {"ok": True}]
    assert len(stub.inserted) == 2, "the slot came back after the first failure"
    assert sem.acquire(blocking=False)


def test_saturated_inserts_are_dropped_not_queued(monkeypatch, caplog):
    stub = _SlowInsert()
    sem = _patch(monkeypatch, stub, slots=1)
    assert sem.acquire(blocking=False)  # the only slot is busy
    payload = analytics_module.AnalyticsEventPayload(**_event())

    with caplog.at_level("WARNING", logger=analytics_module.logger.name):
        out = asyncio.run(analytics_module.record_event(payload, authorization=None))

    assert out == {"ok": True}
    assert stub.inserted == []
    assert "dropped event page_view" in caplog.text


def test_invalid_payload_still_rejected_before_any_insert(monkeypatch):
    stub = _SlowInsert()
    _patch(monkeypatch, stub)

    async def post(body):
        transport = httpx.ASGITransport(app=_app())
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            return await client.post("/api/analytics/events", json=body)

    assert asyncio.run(post({"event_name": "bad event"})).status_code == 422
    assert asyncio.run(post({**_event(), "unexpected": 1})).status_code == 422
    assert stub.inserted == []
