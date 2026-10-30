"""PC-J440: shared-client isolation and immutable published content views."""

import hashlib
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

import database

THREADS = 16
PER_THREAD = 250


def _digest(value):
    return hashlib.sha256(str(value).encode()).hexdigest()


def test_singleton_concurrent_builders_isolated(monkeypatch):
    client = database.supabase_admin
    barrier = threading.Barrier(THREADS)
    seen, errors = set(), []
    lock = threading.Lock()
    auth_digest = _digest(client.options.headers.get("Authorization"))
    apikey_digest = _digest(client.options.headers.get("apiKey") or client.options.headers.get("apikey"))

    def handle(request):
        time.sleep(0.0005)  # keep many sends in flight at once
        marker = request.headers["x-j426-marker"]
        body = json.loads(request.content) if request.content else None
        # Credentials must be the singleton's own on every request (compared
        # by digest, never printed).
        if _digest(request.headers.get("authorization")) != auth_digest:
            errors.append(("auth", marker))
        if _digest(request.headers.get("apikey")) != apikey_digest:
            errors.append(("apikey", marker))
        with lock:
            if marker in seen:
                errors.append(("dup", marker))
            seen.add(marker)
        return httpx.Response(200, json=[{
            "marker": marker, "path": request.url.path, "method": request.method,
            "params": str(request.url.params), "prefer": request.headers.get("prefer"),
            "body": body,
        }])

    with httpx.Client(transport=httpx.MockTransport(handle), http1=True, http2=False) as transport:
        monkeypatch.setattr(client, "_postgrest", client._init_postgrest_client(
            rest_url=str(client.rest_url), headers=client.options.headers,
            schema=client.options.schema,
            timeout=client.options.postgrest_client_timeout, http_client=transport,
        ))
        original_headers = dict(client.postgrest.headers)

        def worker(w):
            barrier.wait(timeout=10)
            for i in range(PER_THREAD):
                marker = f"{w}-{i}"
                op = i % 6
                if op == 0:
                    b = (client.table(f"grammar_items_{w}").select("*", count="exact")
                         .eq("release_id", marker).range(0, 999))
                    method, body = "GET", None
                elif op == 1:
                    b = client.table(f"grammar_diagnostic_sessions_{w}").insert({"marker": marker})
                    method, body = "POST", {"marker": marker}
                elif op == 2:
                    b = (client.table(f"grammar_lesson_attempts_{w}")
                         .update({"marker": marker}).eq("id", marker))
                    method, body = "PATCH", {"marker": marker}
                elif op == 3:
                    b = client.table(f"runtime_flags_{w}").upsert({"key": marker})
                    method, body = "POST", {"key": marker}
                elif op == 4:
                    b = client.rpc(f"record_grammar_response_{w}", {"p_marker": marker})
                    method, body = "POST", {"p_marker": marker}
                else:
                    b = client.rpc(f"create_attempt_{w}", {"p_marker": marker}, count="exact")
                    method, body = "POST", {"p_marker": marker}
                b.request.headers["X-J426-Marker"] = marker
                got = b.execute().data
                assert len(got) == 1, marker
                row = got[0]
                assert row["marker"] == marker
                assert row["method"] == method
                assert row["path"].endswith(f"_{w}"), (marker, row["path"])
                assert row["body"] == body, (marker, row["body"])
                if op in (0, 2):
                    assert marker in row["params"], (marker, row["params"])

        with ThreadPoolExecutor(max_workers=THREADS) as pool:
            list(pool.map(worker, range(THREADS)))
        assert errors == []
        assert len(seen) == THREADS * PER_THREAD
        assert dict(client.postgrest.headers) == original_headers


# ── Part 2: grammar_diagnostic_service._content cache ──────────────────────

class _Q:
    """Minimal fake PostgREST builder for the three content tables."""

    def __init__(self, table, gate):
        self.table, self.gate, self.release = table, gate, None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        if col == "release_id":
            self.release = val
        return self

    def range(self, *_a):
        return self

    def execute(self):
        self.gate(self.table, self.release)
        if self.table == "grammar_items":
            data = [{"item_id": f"{self.release}-i{n}", "attribute_id": "M01",
                     "release": self.release} for n in range(733)]
        elif self.table == "grammar_remediation_routes":
            data = [{"route_id": f"{self.release}-r", "attribute_id": "M01", "route": {}}]
        else:
            data = [{"attribute_id": "M01", "learner_copy": {"release": self.release}}]
        return type("R", (), {"data": data})()


class _DB:
    def __init__(self, gate):
        self.gate = gate

    def table(self, name):
        return _Q(name, self.gate)


def test_content_cache_view_stays_on_its_release_under_threads(monkeypatch):
    """Request A (release R1) holds the dict _content returned while request B
    (release R2, e.g. a new session after an admin activates a new release,
    retired R1 sessions still running) loads its content in another thread.
    On the event loop A and B cannot interleave; under to_thread they can."""
    from services import grammar_diagnostic_service as svc

    svc.clear_content_cache()
    b_done = threading.Event()
    monkeypatch.setattr(svc, "supabase_admin", _DB(lambda *_: None))

    def request_a():
        content = svc._content({"id": "R1"})
        first = content["by_id"].get("R1-i0")
        b_done.wait(5)  # A's next DB round-trip; B runs meanwhile
        later = content["by_id"].get("R1-i0")
        return first is not None, later is not None, content["release_id"]

    def request_b():
        time.sleep(0.05)
        svc._content({"id": "R2"})
        b_done.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        fa = pool.submit(request_a)
        pool.submit(request_b).result()
        first_ok, later_ok, release_seen = fa.result()
    svc.clear_content_cache()
    assert first_ok
    # Expected for thread safety: A keeps seeing R1 for its whole request.
    assert (later_ok, release_seen) == (True, "R1")


@pytest.fixture(autouse=True)
def _isolated_content_cache(monkeypatch):
    from services import grammar_diagnostic_service as svc
    monkeypatch.setattr(svc, "_content_cache", {})


def test_content_cache_cold_start_readers_never_see_empty_or_partial(monkeypatch):
    """Pause one builder before route indexing; a cache hit must be complete."""
    from services import grammar_diagnostic_service as svc

    paused, resume = threading.Event(), threading.Event()
    first = threading.Lock()

    class Routes(list):
        def __iter__(self):
            if first.acquire(blocking=False):
                paused.set()
                assert resume.wait(5)
            return super().__iter__()

    class Query(_Q):
        def execute(self):
            result = super().execute()
            if self.table == "grammar_remediation_routes":
                result.data = Routes(result.data)
            return result

    monkeypatch.setattr(svc, "supabase_admin", _DB(lambda *_: None))
    original = svc._content({"id": "R1"})
    svc._content_cache = {**svc._content_cache, "release_id": "stale"}
    monkeypatch.setattr(svc.supabase_admin, "table", lambda name: Query(name, lambda *_: None))
    with ThreadPoolExecutor(max_workers=2) as pool:
        loading = pool.submit(svc._content, {"id": "R1"})
        try:
            assert paused.wait(5)
            visible = pool.submit(svc._content, {"id": "R1"}).result(timeout=5)
            assert visible["release_id"] == "R1"
            assert visible["by_id"]["R1-i0"]
            assert visible["route_by_attribute"].get("M01")
            assert original["by_id"]["R1-i0"]
        finally:
            resume.set()
            loading.result(timeout=5)


def test_clear_content_cache_preserves_in_flight_view_and_reloads(monkeypatch):
    from services import grammar_diagnostic_service as svc

    queries = []
    monkeypatch.setattr(svc, "supabase_admin", _DB(lambda *q: queries.append(q)))
    original = svc._content({"id": "R1"})
    svc.clear_content_cache()
    assert original["release_id"] == "R1"
    assert original["by_id"]["R1-i0"]
    assert original["route_by_attribute"].get("M01")
    reloaded = svc._content({"id": "R1"})
    assert len(queries) == 6
    assert reloaded == original
    assert reloaded is not original
