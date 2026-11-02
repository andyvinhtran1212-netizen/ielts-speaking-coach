"""/health/quiz-write: event-loop isolation, single-flight TTL cache, redaction.

PC-J263. All PostgREST work is faked; a synchronous sleep models the two
upserts that quiz_write_health sends.
"""
import asyncio
from pathlib import Path
import sys
import threading
import time

from fastapi import FastAPI
import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import health
from services import quiz_service
from tests.loop_gate import WAIT, LoopGate, until

RAW_ERR = 'relation "quiz_attempts" column secret_col does not exist'
HEALTHY = {"ok": True, "checks": {
    "quiz_attempts.client_id": {"ok": True, "note": "on_conflict resolved"},
}}
UNHEALTHY = {"ok": False, "checks": {
    "quiz_attempts.client_id": {"ok": False, "note": "write path unhealthy", "err": RAW_ERR},
    "quiz_word_stats.user_bank_item": {"ok": True, "note": "on_conflict resolved"},
}}


class FakeProbe:
    def __init__(self, result=HEALTHY, delay=0.0):
        self.result = result
        self.delay = delay
        self.gate = None  # a LoopGate parks the call until the test releases it
        self.calls = 0
        self.lock = threading.Lock()

    def __call__(self):
        with self.lock:
            self.calls += 1
        if self.gate is not None:
            self.gate.park()
        time.sleep(self.delay)
        return self.result


@pytest.fixture
def probe(monkeypatch):
    fake = FakeProbe()
    monkeypatch.setattr(quiz_service, "quiz_write_health", fake)
    # raising=False: the pre-fix module has no cache, so this suite fails on
    # its assertions there rather than at setup.
    monkeypatch.setattr(health, "_quiz_write_probe_cache", None, raising=False)
    monkeypatch.setattr(health, "_quiz_write_probe_task", None, raising=False)

    async def is_admin(authorization):
        return authorization == "Bearer test-admin"

    monkeypatch.setattr(health, "_is_admin", is_admin)
    return fake


def _client():
    app = FastAPI()
    app.include_router(health.router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _expire_cache():
    assert health._quiz_write_probe_cache is not None, "probe result was not cached"
    stamp, cached = health._quiz_write_probe_cache
    health._quiz_write_probe_cache = (stamp - health._QUIZ_WRITE_PROBE_TTL_SECONDS - 1, cached)


def test_quiz_write_probe_does_not_block_the_event_loop(probe):
    probe.gate = gate = LoopGate()

    async def exercise():
        request = asyncio.create_task(health.health_quiz_write(authorization=None))
        try:
            # This coroutine keeps running on the loop while the probe is
            # parked; a probe on the loop thread would hold it until WAIT.
            entered = await until(lambda: gate.inside >= 1, stop=request)
            parked = entered and not request.done() and not gate.released
        finally:
            gate.release()
        return await asyncio.wait_for(request, WAIT), parked

    body, parked = asyncio.run(exercise())
    assert body["status"] == "healthy"
    assert probe.calls == 1
    assert not gate.timed_out, "the quiz-write probe ran on the event loop"
    assert parked, "the loop did not run while the probe was in flight"


def test_quiz_write_probe_is_single_flight_and_cached_for_ttl(probe):
    probe.delay = 0.2

    async def exercise():
        bodies = await asyncio.gather(*(health.health_quiz_write(authorization=None) for _ in range(5)))
        assert probe.calls == 1
        assert {body["checked_at"] for body in bodies} == {bodies[0]["checked_at"]}

        again = await health.health_quiz_write(authorization=None)
        assert probe.calls == 1
        assert again["checked_at"] == bodies[0]["checked_at"]

        _expire_cache()
        fresh = await health.health_quiz_write(authorization=None)
        assert probe.calls == 2
        assert fresh["checked_at"] != bodies[0]["checked_at"]

    asyncio.run(exercise())


def test_cancelled_caller_does_not_start_a_second_probe(probe):
    probe.delay = 0.2

    async def exercise():
        first = asyncio.create_task(health.health_quiz_write(authorization=None))
        await asyncio.sleep(0.05)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        body = await health.health_quiz_write(authorization=None)
        assert body["status"] == "healthy"
        assert probe.calls == 1

    asyncio.run(exercise())


def test_failed_probe_clears_the_in_flight_slot(probe, monkeypatch):
    # A raising probe clears the in-flight slot, so the next caller retries.
    def boom():
        probe.calls += 1
        raise RuntimeError("unexpected")

    monkeypatch.setattr(quiz_service, "quiz_write_health", boom)

    async def exercise():
        for _ in range(2):
            with pytest.raises(RuntimeError):
                await health.health_quiz_write(authorization=None)
        assert getattr(health, "_quiz_write_probe_task", None) is None
        assert getattr(health, "_quiz_write_probe_cache", None) is None

    asyncio.run(exercise())
    assert probe.calls == 2


def test_anonymous_caller_never_sees_raw_error_text(probe):
    probe.result = UNHEALTHY

    async def exercise():
        async with _client() as client:
            anonymous = await client.get("/health/quiz-write")
            admin = await client.get("/health/quiz-write", headers={"Authorization": "Bearer test-admin"})
            return anonymous, admin

    anonymous, admin = asyncio.run(exercise())
    assert probe.calls == 1
    assert anonymous.status_code == 200
    text = anonymous.text
    for leaked in ('"err"', "relation", "secret_col"):
        assert leaked not in text, f"anonymous body leaks {leaked}: {text}"
    assert anonymous.json()["quiz_write"] == {"ok": False, "checks": {
        "quiz_attempts.client_id": {"ok": False, "note": "write path unhealthy"},
        "quiz_word_stats.user_bank_item": {"ok": True, "note": "on_conflict resolved"},
    }}

    assert admin.status_code == 200
    assert admin.json()["quiz_write"] == UNHEALTHY
    assert admin.json()["checked_at"] == anonymous.json()["checked_at"]


@pytest.mark.parametrize(("result", "status"), [(HEALTHY, "healthy"), (UNHEALTHY, "error")])
@pytest.mark.parametrize("authorization", [None, "Bearer test-admin"])
def test_quiz_write_contract_shape(probe, result, status, authorization):
    probe.result = result

    async def exercise():
        async with _client() as client:
            headers = {"Authorization": authorization} if authorization else {}
            return await client.get("/health/quiz-write", headers=headers)

    response = asyncio.run(exercise())
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"status", "timestamp", "checked_at", "quiz_write"}
    assert body["status"] == status
    assert set(body["quiz_write"]) == {"ok", "checks"}
    assert body["quiz_write"]["ok"] is result["ok"]
    assert set(body["quiz_write"]["checks"]) == set(result["checks"])
