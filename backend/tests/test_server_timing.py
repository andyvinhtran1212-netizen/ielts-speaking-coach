"""Sprint Perf-1 — Server-Timing observability sentinels."""

from __future__ import annotations

import re
from contextlib import contextmanager
from time import perf_counter

from fastapi.testclient import TestClient

from config import settings


def _client() -> TestClient:
    from main import app
    return TestClient(app)


@contextmanager
def _server_timing_enabled():
    """Server-Timing is gated OFF by default (C-* audit). Flip the shared
    settings singleton on for the header-present assertions — the middleware
    reads settings.ENABLE_SERVER_TIMING per request, so this takes effect
    immediately without rebuilding the app."""
    prev = settings.ENABLE_SERVER_TIMING
    settings.ENABLE_SERVER_TIMING = True
    try:
        yield
    finally:
        settings.ENABLE_SERVER_TIMING = prev


def _parse(header: str) -> dict[str, float]:
    out: dict[str, float] = {}
    for part in header.split(","):
        m = re.fullmatch(r"\s*([a-z]+);dur=([0-9]+(?:\.[0-9]+)?)\s*", part)
        assert m, f"invalid Server-Timing part: {part!r}"
        out[m.group(1)] = float(m.group(2))
    return out


def test_server_timing_header_present_and_parseable_on_api_response():
    with _server_timing_enabled():
        start = perf_counter()
        r = _client().get("/api/reading/test")
        elapsed_ms = (perf_counter() - start) * 1000
    assert r.status_code == 401
    header = r.headers.get("server-timing")
    assert header, "API responses should expose Server-Timing when enabled"
    stages = _parse(header)
    assert set(stages) == {"total", "auth", "db", "app"}
    assert 0 <= stages["total"] <= elapsed_ms + 25
    assert all(value >= 0 for value in stages.values())


def test_timing_allow_origin_reflects_caller_so_browser_can_read_it():
    # Perf P3.3 — cross-origin (Vercel ↔ Railway) callers can't read
    # Server-Timing unless Timing-Allow-Origin opts them in. Reflect Origin.
    with _server_timing_enabled():
        r = _client().get("/api/reading/test", headers={"Origin": "https://averlearning.com"})
    assert r.status_code == 401
    assert r.headers.get("server-timing"), "Server-Timing must be present"
    assert r.headers.get("timing-allow-origin") == "https://averlearning.com"


def test_timing_allow_origin_falls_back_to_wildcard_without_origin():
    with _server_timing_enabled():
        r = _client().get("/api/reading/test")
    assert r.headers.get("timing-allow-origin") == "*"


def test_server_timing_absent_when_disabled_by_default():
    # C-* audit — gated OFF by default: no header on a normal API response.
    assert settings.ENABLE_SERVER_TIMING is False
    r = _client().get("/api/reading/test")
    assert r.status_code == 401
    assert "server-timing" not in r.headers


def test_health_routes_skip_server_timing():
    with _server_timing_enabled():
        r = _client().get("/health")
    assert r.status_code == 200
    assert "server-timing" not in r.headers


def test_listening_boot_route_participates_in_server_timing():
    with _server_timing_enabled():
        r = _client().get("/api/listening/dictation/c1/boot")
    assert r.status_code == 401
    header = r.headers.get("server-timing")
    assert header
    stages = _parse(header)
    assert set(stages) == {"total", "auth", "db", "app"}


def test_postgrest_execute_methods_are_wrapped_for_db_timing():
    # Importing main installs the PostgREST execute wrappers once at startup.
    import main  # noqa: F401
    from postgrest._sync.request_builder import SyncSelectRequestBuilder

    execute = getattr(SyncSelectRequestBuilder, "execute")
    assert getattr(execute, "_av_server_timing_wrapped", False) is True
