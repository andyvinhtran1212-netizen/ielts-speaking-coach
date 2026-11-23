"""LIBRARY-0061 FR-064: Library media is served by the backend, only while the
item is published, never cached and never as a Storage URL."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests._library_fake_db import FakeDB

PNG = b"\x89PNG\r\n\x1a\n" + bytes(range(200))
MP3 = b"ID3" + bytes(range(256)) * 4  # 1027 bytes

FIGURE = "/api/library/media/writing-sample/delta-chart/figure"
AUDIO = "/api/library/media/speaking-sample/p1-hobbies/audio"


@pytest.fixture()
def db(monkeypatch):
    fake = FakeDB(
        tables={
            "writing_samples": [
                {"slug": "delta-chart", "published": True, "prompt_image_path": "writing/delta-chart/figure.png"},
                {"slug": "draft-chart", "published": False, "prompt_image_path": "writing/draft-chart/figure.png"},
                {"slug": "no-figure", "published": True, "prompt_image_path": None},
                {"slug": "odd-type", "published": True, "prompt_image_path": "writing/odd/figure.svg"},
                {"slug": "lost-object", "published": True, "prompt_image_path": "writing/lost/figure.png"},
            ],
            "speaking_samples": [
                {"slug": "p1-hobbies", "published": True, "audio_path": "speaking/p1-hobbies/audio.mp3"},
            ],
        },
        objects={
            ("library-media", "writing/delta-chart/figure.png"): PNG,
            ("library-media", "writing/draft-chart/figure.png"): PNG,
            ("library-media", "writing/odd/figure.svg"): b"<svg/>",
            ("library-media", "speaking/p1-hobbies/audio.mp3"): MP3,
        },
    )
    import routers.library as library
    import services.library_media as media

    monkeypatch.setattr(library, "supabase_admin", fake)
    media.reset_state()
    yield fake
    media.reset_state()


@pytest.fixture()
def client(db):
    from main import app

    return TestClient(app)


def _no_store(r):
    assert r.headers["cache-control"] == "no-store"
    assert "etag" not in r.headers


def test_published_figure_is_200_bytes_no_store(client, db):
    r = client.get(FIGURE)
    assert r.status_code == 200
    assert r.content == PNG
    assert r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["accept-ranges"] == "bytes"
    _no_store(r)
    assert "location" not in r.headers
    assert db.downloads == [("library-media", "writing/delta-chart/figure.png")]


def test_draft_is_404_and_object_is_never_downloaded(client, db):
    r = client.get("/api/library/media/writing-sample/draft-chart/figure")
    assert r.status_code == 404
    assert r.json() == {"detail": "media_not_found"}
    _no_store(r)
    assert db.downloads == []


def test_unpublish_takes_effect_on_the_next_request_to_the_same_url(client, db):
    assert client.get(FIGURE).status_code == 200
    db.tables["writing_samples"][0]["published"] = False
    r = client.get(FIGURE)
    assert r.status_code == 404
    _no_store(r)


@pytest.mark.parametrize("path", [
    "/api/library/media/writing-sample/delta-chart/audio",      # asset not on this shelf
    "/api/library/media/speaking-sample/p1-hobbies/figure",
    "/api/library/media/grammar/x/figure",                      # shelf outside allow-list
    "/api/library/media/writing-sample/nope/figure",            # unknown item
    "/api/library/media/writing-sample/no-figure/figure",       # item without a figure
    "/api/library/media/writing-sample/odd-type/figure",        # type outside allow-list
    "/api/library/media/writing-sample/lost-object/figure",     # object missing in Storage
])
def test_everything_else_is_404_no_store(client, path):
    r = client.get(path)
    assert r.status_code == 404
    _no_store(r)


def test_audio_range_is_206(client):
    r = client.get(AUDIO, headers={"Range": "bytes=0-99"})
    assert r.status_code == 206
    assert r.content == MP3[:100]
    assert r.headers["content-range"] == f"bytes 0-99/{len(MP3)}"
    assert r.headers["content-type"] == "audio/mpeg"
    _no_store(r)


def test_audio_open_and_suffix_ranges(client):
    tail = client.get(AUDIO, headers={"Range": "bytes=1000-"})
    assert tail.status_code == 206 and tail.content == MP3[1000:]
    suffix = client.get(AUDIO, headers={"Range": "bytes=-27"})
    assert suffix.status_code == 206 and suffix.content == MP3[-27:]
    assert suffix.headers["content-range"] == f"bytes 1000-1026/{len(MP3)}"


def test_unsatisfiable_range_is_416(client):
    r = client.get(AUDIO, headers={"Range": f"bytes={len(MP3)}-"})
    assert r.status_code == 416
    assert r.headers["content-range"] == f"bytes */{len(MP3)}"
    _no_store(r)


def test_multi_range_falls_back_to_whole_file(client):
    r = client.get(AUDIO, headers={"Range": "bytes=0-1,5-9"})
    assert r.status_code == 200 and r.content == MP3


def test_public_storage_url_is_never_emitted():
    import routers.library as library
    import services.library_media as media

    for module in (library, media):
        source = open(module.__file__, encoding="utf-8").read()
        assert "get_public_url" not in source
        assert "create_signed_url" not in source


def test_db_failure_is_503_no_store(client, db):
    db.broken.add("writing_samples")
    r = client.get(FIGURE)
    assert r.status_code == 503
    _no_store(r)
    assert db.downloads == []


# ── abuse bounds (weekly SA 2026-11-23, S-1) ────────────────────────────────


def test_range_burst_downloads_the_object_once(client, db):
    for header in ("bytes=0-99", "bytes=100-199", "bytes=500-", "bytes=-27"):
        r = client.get(AUDIO, headers={"Range": header})
        assert r.status_code == 206
        _no_store(r)
    assert client.get(AUDIO).content == MP3
    assert db.downloads == [("library-media", "speaking/p1-hobbies/audio.mp3")]


def test_cached_bytes_never_outlive_unpublish(client, db):
    assert client.get(FIGURE).status_code == 200
    db.tables["writing_samples"][0]["published"] = False
    r = client.get(FIGURE)
    assert r.status_code == 404
    _no_store(r)
    assert len(db.downloads) == 1  # 404 came from the publish check, not Storage


def test_cache_expires_after_ttl(client, db, monkeypatch):
    import services.library_media as media

    now = [1000.0]
    monkeypatch.setattr(media.time, "monotonic", lambda: now[0])
    assert client.get(FIGURE).status_code == 200
    now[0] += media.CACHE_TTL_SECONDS - 1
    assert client.get(FIGURE).status_code == 200
    assert len(db.downloads) == 1
    now[0] += 2
    assert client.get(FIGURE).status_code == 200
    assert len(db.downloads) == 2


def test_failed_download_is_not_cached(client, db):
    path = "/api/library/media/writing-sample/lost-object/figure"
    assert client.get(path).status_code == 404
    db.objects[("library-media", "writing/lost/figure.png")] = PNG
    r = client.get(path)
    assert r.status_code == 200 and r.content == PNG


def test_cache_is_bounded_by_bytes(monkeypatch):
    import services.library_media as media

    media.reset_state()
    monkeypatch.setattr(media, "CACHE_MAX_BYTES", 10)
    media._cache_put("a", b"12345")
    media._cache_put("b", b"12345")
    media._cache_put("c", b"12345")      # evicts the least recent ("a")
    media._cache_put("big", b"x" * 11)   # larger than the cap: never stored
    assert list(media._cache) == ["b", "c"]
    assert media._cache_bytes == 10
    media.reset_state()


def test_one_client_is_throttled_before_any_read(client, db, monkeypatch):
    import services.library_media as media

    monkeypatch.setattr(media, "IP_MAX_PER_MINUTE", 3)
    flood = {"X-Real-IP": "203.0.113.7"}
    for _ in range(3):
        assert client.get(FIGURE, headers=flood).status_code == 200
    calls_before = len(db.calls)
    r = client.get(FIGURE, headers=flood)
    assert r.status_code == 429
    assert r.json()["detail"] == "media_rate_limited"
    assert int(r.headers["retry-after"]) >= 1
    _no_store(r)
    assert len(db.calls) == calls_before  # no DB lookup for a throttled call
    other = client.get(FIGURE, headers={"X-Real-IP": "198.51.100.9"})
    assert other.status_code == 200


def test_throttle_window_slides(client, db, monkeypatch):
    import services.library_media as media

    now = [5000.0]
    monkeypatch.setattr(media.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(media, "IP_MAX_PER_MINUTE", 2)
    ip = {"X-Real-IP": "203.0.113.8"}
    assert client.get(FIGURE, headers=ip).status_code == 200
    assert client.get(FIGURE, headers=ip).status_code == 200
    assert client.get(FIGURE, headers=ip).status_code == 429
    now[0] += media._IP_WINDOW_SECONDS + 1
    assert client.get(FIGURE, headers=ip).status_code == 200
