"""Readiness latency, event-loop isolation, timeouts and cached redaction.

All network work is faked; synchronous sleeps model PostgREST round trips.
"""
import asyncio
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import threading
import time
from types import SimpleNamespace

from fastapi import FastAPI
import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import health


class SlowDatabase:
    def __init__(self, delay=0.0, blocked_table=None, error_table=None):
        self.delay = delay
        self.blocked_table = blocked_table
        self.error_table = error_table
        self.release = threading.Event()
        self.calls = Counter()
        self.projections = {}
        self.lock = threading.Lock()

    def table(self, table):
        database = self

        class Query:
            def select(self, projection):
                self.projection = projection
                return self

            def limit(self, limit):
                self.row_limit = limit
                return self

            def execute(self):
                with database.lock:
                    database.calls[table] += 1
                    database.projections[table] = (self.projection, self.row_limit)
                if table == database.blocked_table:
                    # Finite fallback makes a pre-fix regression fail, not hang.
                    database.release.wait(1.0)
                time.sleep(database.delay)
                if table == database.error_table:
                    raise RuntimeError("private database host/schema detail")
                return SimpleNamespace(data=[])

        return Query()


@pytest.fixture
def ready_client(monkeypatch):
    monkeypatch.setattr(health.settings, "GEMINI_API_KEY", "fake-key")
    monkeypatch.setattr(health.runtime_flags, "is_enabled", lambda *a, **k: False)
    monkeypatch.setattr(health.curated_readiness, "schema_available", lambda: True)

    async def is_admin(authorization):
        return authorization == "Bearer test-admin"

    monkeypatch.setattr(health, "_is_admin", is_admin)
    app = FastAPI()
    app.include_router(health.router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def test_slow_database_probes_run_in_parallel(monkeypatch, ready_client):
    database = SlowDatabase(delay=0.1)
    monkeypatch.setattr(health, "supabase_admin", database)

    async def exercise():
        # Fix test capacity: a small CI runner's default cpu_count()+4 pool
        # otherwise measures executor queuing along with network concurrency.
        asyncio.get_running_loop().set_default_executor(ThreadPoolExecutor(max_workers=24))
        async with ready_client as client:
            start = time.perf_counter()
            response = await client.get("/health/ready")
            elapsed = time.perf_counter() - start
            assert response.status_code == 200
            assert response.json()["status"] == "ok"
            assert elapsed < 0.4, f"20 synchronous round trips took {elapsed:.3f}s"

    asyncio.run(exercise())
    assert database.calls == Counter({name: 1 for name in ("users", *health._CRITICAL_TABLES)})
    assert database.projections["users"] == ("id", 1)
    for table in health._CRITICAL_TABLES:
        assert database.projections[table] == (health._CRITICAL_COLUMNS.get(table, "id"), 0)


def test_readiness_does_not_block_concurrent_liveness(monkeypatch, ready_client):
    database = SlowDatabase(delay=0.1)
    monkeypatch.setattr(health, "supabase_admin", database)

    async def exercise():
        async with ready_client as client:
            start = time.perf_counter()
            readiness = asyncio.create_task(client.get("/health/ready"))
            # Give readiness the loop first, as in a busy ASGI worker.
            await asyncio.sleep(0)
            liveness = await client.get("/health")
            elapsed = time.perf_counter() - start
            try:
                assert liveness.status_code == 200
                assert liveness.json()["status"] == "ok"
                assert elapsed < 0.05, f"liveness stalled for {elapsed:.3f}s"
                assert not readiness.done()
            finally:
                await readiness

    asyncio.run(exercise())


@pytest.mark.parametrize("blocked_table,check", [("users", "database"), ("sessions", "migrations")])
def test_hung_database_probe_has_bounded_response(monkeypatch, ready_client, blocked_table, check):
    database = SlowDatabase(blocked_table=blocked_table)
    monkeypatch.setattr(health, "supabase_admin", database)
    monkeypatch.setattr(health, "_READY_PROBE_TIMEOUT_SECONDS", 0.15, raising=False)

    async def exercise():
        async with ready_client as client:
            start = time.perf_counter()
            try:
                response = await client.get("/health/ready")
                elapsed = time.perf_counter() - start
                assert response.status_code == 200
                body = response.json()
                assert body["status"] == "degraded"
                assert body["checks"][check]["status"] in {"fail", "timeout"}
                assert elapsed < 0.4, f"hung {check} probe took {elapsed:.3f}s"
            finally:
                database.release.set()

    asyncio.run(exercise())


@pytest.mark.parametrize("blocked_step", ["flag", "schema"])
def test_curated_lookup_is_threaded_and_bounded(monkeypatch, ready_client, blocked_step):
    database = SlowDatabase()
    release = threading.Event()
    monkeypatch.setattr(health, "supabase_admin", database)
    monkeypatch.setattr(health, "_READY_PROBE_TIMEOUT_SECONDS", 0.15, raising=False)

    def flag(*_args, **_kwargs):
        if blocked_step == "flag":
            release.wait(1.0)
        return True

    def schema():
        if blocked_step == "schema":
            release.wait(1.0)
        return True

    monkeypatch.setattr(health.runtime_flags, "is_enabled", flag)
    monkeypatch.setattr(health.curated_readiness, "schema_available", schema)

    async def exercise():
        async with ready_client as client:
            start = time.perf_counter()
            readiness = asyncio.create_task(client.get("/health/ready"))
            await asyncio.sleep(0)
            liveness = await client.get("/health")
            try:
                assert liveness.status_code == 200
                assert time.perf_counter() - start < 0.05
                response = await readiness
                assert response.status_code == 200
                assert response.json()["checks"]["curated_schema"]["status"] in {"fail", "timeout"}
                assert response.json()["status"] == "degraded"
                assert time.perf_counter() - start < 0.4
            finally:
                release.set()
                await readiness

    asyncio.run(exercise())


def test_anonymous_burst_reuses_status_until_ttl_expires(monkeypatch, ready_client):
    database = SlowDatabase(delay=0.01)
    monkeypatch.setattr(health, "supabase_admin", database)

    async def exercise():
        async with ready_client as client:
            responses = await asyncio.gather(*(client.get("/health/ready") for _ in range(8)))
            assert all(response.status_code == 200 for response in responses)
            assert all(response.json()["status"] == "ok" for response in responses)
            assert set(database.calls.values()) == {1}
            first = responses[0].json()
            first["checks"]["database"]["status"] = "mutated"
            cached = (await client.get("/health/ready")).json()
            assert cached["checks"]["database"] == {"status": "ok"}
            assert cached["timestamp"] != first["timestamp"]
            stamp, statuses = health._ready_probe_cache
            monkeypatch.setattr(health, "_ready_probe_cache", (stamp - health._READY_PROBE_TTL_SECONDS - 1, statuses))
            await client.get("/health/ready")
            assert set(database.calls.values()) == {2}

    asyncio.run(exercise())


def test_timeout_reuses_unfinished_probe_after_cache_expiry(monkeypatch, ready_client):
    database = SlowDatabase(blocked_table="users")
    monkeypatch.setattr(health, "supabase_admin", database)
    monkeypatch.setattr(health, "_READY_PROBE_TIMEOUT_SECONDS", 0.1, raising=False)

    async def exercise():
        async with ready_client as client:
            try:
                first = await client.get("/health/ready")
                assert first.json()["checks"]["database"]["status"] == "fail"
                stamp, statuses = health._ready_probe_cache
                monkeypatch.setattr(health, "_ready_probe_cache", (stamp - health._READY_PROBE_TTL_SECONDS - 1, statuses))
                second = await client.get("/health/ready")
                assert second.json()["checks"]["database"]["status"] == "fail"
                assert database.calls["users"] == 1
                assert database.calls["sessions"] == 2
            finally:
                database.release.set()
            # Once the stalled call finishes, a later probe can recover.
            while health._ready_probe_tasks:
                await asyncio.sleep(0)
            stamp, statuses = health._ready_probe_cache
            monkeypatch.setattr(health, "_ready_probe_cache", (stamp - health._READY_PROBE_TTL_SECONDS - 1, statuses))
            recovered = await client.get("/health/ready")
            assert recovered.json()["checks"]["database"]["status"] == "ok"
            assert database.calls["users"] == 2

    asyncio.run(exercise())


@pytest.mark.parametrize("first_admin", [False, True])
@pytest.mark.parametrize("error_table", [None, "users", "sessions"])
def test_cached_status_preserves_admin_anonymous_contract(monkeypatch, ready_client, first_admin, error_table):
    database = SlowDatabase(error_table=error_table)
    monkeypatch.setattr(health, "supabase_admin", database)

    async def exercise():
        async with ready_client as client:
            bodies = {}
            for admin in (first_admin, not first_admin, False, True):
                headers = {"Authorization": "Bearer test-admin"} if admin else {}
                response = await client.get("/health/ready", headers=headers)
                assert response.status_code == 200
                bodies[admin] = response.json()
            anonymous, admin = bodies[False], bodies[True]
            expected_checks = {"database", "migrations", "gemini_api", "feature_flags", "curated_schema"}
            for body in (anonymous, admin):
                assert set(body) == {"status", "timestamp", "checks"}
                assert set(body["checks"]) == expected_checks
                assert body["status"] == ("degraded" if error_table else "ok")
            for name, check in anonymous["checks"].items():
                assert check == {"status": admin["checks"][name]["status"]}
            assert "private database" not in repr(anonymous)
            assert "scope" in admin["checks"]["migrations"]
            assert set(admin["checks"]["feature_flags"]) == {
                "status", "vocab_bank_enabled", "d1_enabled", "d3_enabled", "flashcard_enabled",
            }
            if error_table == "users":
                assert admin["checks"]["database"]["error"] == "private database host/schema detail"
            elif error_table:
                assert admin["checks"]["migrations"]["missing"] == [
                    f"{error_table}: private database host/schema detail",
                ]
            else:
                assert admin["checks"]["migrations"]["verified"] == list(health._CRITICAL_TABLES)
            # Only status codes may live in the shared TTL cache.
            _, statuses = health._ready_probe_cache
            assert set(statuses) == expected_checks
            assert all(set(check) == {"status"} for check in statuses.values())

    asyncio.run(exercise())
