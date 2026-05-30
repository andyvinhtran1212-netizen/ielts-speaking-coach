"""Sprint Perf-3 — public content cache-header sentinels."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


def test_grammar_home_has_public_cache_headers_and_stable_etag():
    client = _client()
    first = client.get("/api/grammar/home")
    second = client.get("/api/grammar/home")

    assert first.status_code == 200
    assert first.headers["cache-control"] == (
        "public, max-age=60, s-maxage=60, stale-while-revalidate=300"
    )
    assert first.headers["etag"].startswith('"')
    assert first.headers["etag"] == second.headers["etag"]
    assert first.headers.get("last-modified")


def test_grammar_home_matching_if_none_match_returns_304_empty_body():
    client = _client()
    first = client.get("/api/grammar/home")
    cached = client.get(
        "/api/grammar/home",
        headers={"If-None-Match": first.headers["etag"]},
    )

    assert cached.status_code == 304
    assert cached.content == b""
    assert cached.headers["etag"] == first.headers["etag"]
    assert cached.headers["cache-control"] == first.headers["cache-control"]


def test_vocabulary_search_etag_changes_with_response_body():
    client = _client()
    populated = client.get("/api/vocabulary/search?q=mit")
    empty = client.get("/api/vocabulary/search?q=definitely-not-a-headword")

    assert populated.status_code == 200
    assert empty.status_code == 200
    assert populated.headers["etag"] != empty.headers["etag"]


def test_personalized_grammar_dashboard_is_not_public_cached():
    r = _client().get("/api/grammar/dashboard-data")
    assert r.status_code == 401
    assert "cache-control" not in r.headers
    assert "etag" not in r.headers
