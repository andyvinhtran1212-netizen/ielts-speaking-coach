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

    monkeypatch.setattr(library, "supabase_admin", fake)
    return fake


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
