"""Sprint Perf-1 — Server-Timing observability sentinels."""

from __future__ import annotations

import re
from time import perf_counter

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


def _parse(header: str) -> dict[str, float]:
    out: dict[str, float] = {}
    for part in header.split(","):
        m = re.fullmatch(r"\s*([a-z]+);dur=([0-9]+(?:\.[0-9]+)?)\s*", part)
        assert m, f"invalid Server-Timing part: {part!r}"
        out[m.group(1)] = float(m.group(2))
    return out


def test_server_timing_header_present_and_parseable_on_api_response():
    start = perf_counter()
    r = _client().get("/api/reading/test")
    elapsed_ms = (perf_counter() - start) * 1000
    assert r.status_code == 401
    header = r.headers.get("server-timing")
    assert header, "API responses should expose Server-Timing"
    stages = _parse(header)
    assert set(stages) == {"total", "auth", "db", "app"}
    assert 0 <= stages["total"] <= elapsed_ms + 25
    assert all(value >= 0 for value in stages.values())


def test_health_routes_skip_server_timing():
    r = _client().get("/health")
    assert r.status_code == 200
    assert "server-timing" not in r.headers


def test_postgrest_execute_methods_are_wrapped_for_db_timing():
    # Importing main installs the PostgREST execute wrappers once at startup.
    import main  # noqa: F401
    from postgrest._sync.request_builder import SyncSelectRequestBuilder

    execute = getattr(SyncSelectRequestBuilder, "execute")
    assert getattr(execute, "_av_server_timing_wrapped", False) is True
