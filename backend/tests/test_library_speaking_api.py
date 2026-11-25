"""LIBRARY-0061 T013: public Speaking shelf API (FR-030–FR-036).
The database is faked; the router is the real one in main.py."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from tests._library_fake_db import FakeDB


TOPICS = [
    {"slug": "places", "label_vi": "Nơi chốn", "shelves": ["writing", "speaking"], "display_order": 2},
    {"slug": "people", "label_vi": "Con người", "shelves": ["speaking"], "display_order": 1},
    {"slug": "environment", "label_vi": "Môi trường", "shelves": ["writing"], "display_order": 3},
]


def _line(start, text, marks=()):
    return {"start_ms": start, "text": text, "marks": list(marks)}


def _row(slug, *, part=2, title, topic="places", video=None, youtube=None, url=None, audio=None,
         transcript=None, sample="I'd like to talk about Hue. It is calm.", published=True,
         duration=61, updated="2026-11-01T00:00:00+00:00", title_vi=None):
    return {
        "id": f"id-{slug}",
        "source_id": f"src-{slug}",
        "slug": slug,
        "part": part,
        "title_en": title,
        "title_vi": title_vi,
        "topic_slug": topic,
        "topic_id": f"topic-{slug}",
        "cue_card": {"prompt": f"Describe {title}.", "bullets": ["where", "when"],
                     "reflection": "and explain why", "internal": "x"},
        "video_source": video,
        "youtube_id": youtube,
        "video_url": url,
        "duration_s": duration if (video or audio) else None,
        "transcript": transcript if transcript is not None else [
            _line(0 if (video or audio) else None, "I'd like to talk about Hue."),
            _line(2400 if (video or audio) else None, "It is calm.",
                  [{"kind": "vocab", "start": 6, "end": 10, "note": "yên bình"},
                   {"kind": "secret", "start": 0, "end": 2, "note": "x"},
                   {"kind": "structure", "start": 3, "end": 99, "note": "out of range"}]),
        ],
        "sample_text": sample,
        "audio_path": audio,
        "voice": "synthetic",
        "outline": ["Place", "Why"],
        "vocabulary": [{"term": "calm", "meaning_vi": "yên bình", "internal": 1}],
        "related_part3": ["Why do people travel?"],
        "source_note": "internal note",
        "content_hash": "deadbeef",
        "published": published,
        "published_at": "2026-11-01T00:00:00+00:00" if published else None,
        "updated_at": updated,
    }


def _rows():
    return [
        _row("a-city-part-2", title="A city", video="youtube", youtube="AbCdEfGhIjK"),
        _row("hometown-part-1", part=1, title="Hometown", topic="places", audio="speaking-samples/p1/answer.mp3"),
        _row("tourism-part-3", part=3, title="Tourism", topic="places"),
        _row("a-friend-part-2", title="A friend", topic="people", video="self_hosted",
             url="https://video.example.com/friend.mp4", updated="2026-11-05T00:00:00+00:00"),
        _row("orphan-part-2", title="Orphan", topic=None),
        _row("writing-only-topic-part-2", title="Writing topic", topic="environment"),
        _row("draft-secret-part-2", title="Draft secret", published=False),
        _row("no-answer-part-2", title="No answer", sample="   "),
    ]


@pytest.fixture()
def db(monkeypatch):
    fake = FakeDB(tables={"speaking_samples": _rows(), "library_topics": TOPICS})
    import routers.library as library

    monkeypatch.setattr(library, "supabase_admin", fake)
    return fake


@pytest.fixture()
def client(db):
    from main import app

    return TestClient(app)


FORBIDDEN = (
    "source_id", "src-", "content_hash", "deadbeef", "source_note", "internal",
    "audio_path", "speaking-samples/p1/answer.mp3", "draft-secret", "No answer",
    "supabase.co/storage", "secret", "out of range",
)


def _assert_clean(body):
    text = json.dumps(body, ensure_ascii=False)
    for needle in FORBIDDEN:
        assert needle not in text, needle


# ── list ────────────────────────────────────────────────────────────────────


def test_list_shelf_order_topic_then_part_then_title(client):
    r = client.get("/api/library/speaking")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers.get("etag")
    body = r.json()
    # people (order 1) → places (order 2: Part 1, 2, 3) → no Speaking topic last.
    assert [i["slug"] for i in body["items"]] == [
        "a-friend-part-2", "hometown-part-1", "a-city-part-2", "tourism-part-3",
        "orphan-part-2", "writing-only-topic-part-2",
    ]
    assert body["total"] == 6
    assert body["topics"] == [{"slug": "people", "label_vi": "Con người"},
                              {"slug": "places", "label_vi": "Nơi chốn"}]
    _assert_clean(body)


def test_list_states_how_the_answer_is_delivered(client):
    items = {i["slug"]: i for i in client.get("/api/library/speaking").json()["items"]}
    assert items["a-city-part-2"]["answer_kind"] == "video"
    assert items["a-city-part-2"]["duration_s"] == 61
    assert items["a-friend-part-2"]["answer_kind"] == "video"
    assert items["hometown-part-1"]["answer_kind"] == "audio"
    assert items["tourism-part-3"]["answer_kind"] == "text"
    assert items["tourism-part-3"]["duration_s"] is None
    assert all(i["voice"] == "synthetic" for i in items.values())
    # A topic that is not on the Speaking shelf reads as no topic.
    assert items["writing-only-topic-part-2"]["topic_slug"] is None


def test_list_filters_combine_with_and_and_facets_skip_their_own_filter(client):
    body = client.get("/api/library/speaking?part=2&video=true").json()
    assert [i["slug"] for i in body["items"]] == ["a-friend-part-2", "a-city-part-2"]
    assert body["facets"]["part"] == {"2": 2}  # Part 1 has no video answer
    assert body["facets"]["video"] == 2
    assert body["facets"]["topic"] == {"people": 1, "places": 1}

    body = client.get("/api/library/speaking?chude=places&q=CITY").json()
    assert [i["slug"] for i in body["items"]] == ["a-city-part-2"]


def test_list_search_matches_vietnamese_title(client, db):
    db.tables["speaking_samples"][0]["title_vi"] = "Một thành phố"
    body = client.get("/api/library/speaking", params={"q": "thành phố"}).json()
    assert [i["slug"] for i in body["items"]] == ["a-city-part-2"]
    # Accents and case are ignored; the topic name matches too.
    body = client.get("/api/library/speaking", params={"q": "THANH PHO"}).json()
    assert [i["slug"] for i in body["items"]] == ["a-city-part-2"]
    body = client.get("/api/library/speaking", params={"q": "con nguoi"}).json()
    assert [i["slug"] for i in body["items"]] == ["a-friend-part-2"]


@pytest.mark.parametrize("query", ["part=4", "part=x", "chude=environment", "chude=nope", "q=" + "x" * 101])
def test_list_rejects_bad_params_with_422(client, query):
    assert client.get(f"/api/library/speaking?{query}").status_code == 422


def test_empty_shelf_is_an_empty_list(client, db):
    db.tables["speaking_samples"] = [_row("draft-part-2", title="Draft", published=False)]
    body = client.get("/api/library/speaking").json()
    assert body["items"] == [] and body["total"] == 0


def test_index_lists_published_answered_slugs(client):
    r = client.get("/api/library/speaking/index")
    assert r.status_code == 200
    slugs = [i["slug"] for i in r.json()]
    assert "a-city-part-2" in slugs and len(slugs) == 6
    assert "draft-secret-part-2" not in slugs and "no-answer-part-2" not in slugs
    assert r.headers["last-modified"] == "Thu, 05 Nov 2026 00:00:00 GMT"


# ── detail ──────────────────────────────────────────────────────────────────


def test_detail_youtube_allow_lists_payload(client):
    r = client.get("/api/library/speaking/a-city-part-2")
    assert r.status_code == 200
    body = r.json()
    _assert_clean(body)
    assert body["media"] == {"video_source": "youtube", "youtube_id": "AbCdEfGhIjK",
                             "video_url": None, "audio_url": None}
    assert body["voice"] == "synthetic"
    assert body["timed"] is True
    assert [line["start_ms"] for line in body["transcript"]] == [0, 2400]
    # Unknown kinds and out-of-range marks are dropped.
    assert body["transcript"][1]["marks"] == [{"kind": "vocab", "start": 6, "end": 10, "note": "yên bình"}]
    assert body["cue_card"] == {"prompt": "Describe A city.", "bullets": ["where", "when"],
                                "reflection": "and explain why"}
    assert body["vocabulary"] == [{"term": "calm", "meaning_vi": "yên bình", "note": None}]
    assert body["topic_label_vi"] == "Nơi chốn"
    assert body["topic_id"] == "topic-a-city-part-2"
    # Neighbours follow shelf order: within the topic, then into the next topic.
    assert body["prev"] == {"slug": "hometown-part-1", "title_en": "Hometown"}
    assert body["next"] == {"slug": "tourism-part-3", "title_en": "Tourism"}


def test_detail_audio_points_at_the_media_route(client):
    body = client.get("/api/library/speaking/hometown-part-1").json()
    assert body["answer_kind"] == "audio"
    assert body["media"]["audio_url"] == "/api/library/media/speaking-sample/hometown-part-1/audio"
    assert body["media"]["video_source"] is None


def test_detail_self_hosted_video_url(client):
    body = client.get("/api/library/speaking/a-friend-part-2").json()
    assert body["media"]["video_url"] == "https://video.example.com/friend.mp4"
    assert body["media"]["youtube_id"] is None
    assert body["prev"] is None


def test_detail_text_only_has_no_times(client):
    body = client.get("/api/library/speaking/tourism-part-3").json()
    assert body["answer_kind"] == "text" and body["timed"] is False
    assert all(line["start_ms"] is None for line in body["transcript"])


@pytest.mark.parametrize("times", [[0, None], [2400, 0], [0, 0], [-5, 10]])
def test_detail_bad_times_are_served_untimed(client, db, times):
    row = db.tables["speaking_samples"][0]
    for line, start in zip(row["transcript"], times):
        line["start_ms"] = start
    body = client.get("/api/library/speaking/a-city-part-2").json()
    assert body["timed"] is False
    assert [line["start_ms"] for line in body["transcript"]] == [None, None]


@pytest.mark.parametrize("slug", ["draft-secret-part-2", "no-answer-part-2", "nope"])
def test_detail_unpublished_answerless_or_unknown_is_404_no_store(client, slug):
    r = client.get(f"/api/library/speaking/{slug}")
    assert r.status_code == 404
    assert r.json() == {"detail": "speaking_not_found"}
    assert r.headers["cache-control"] == "no-store"


def test_unpublishing_takes_effect_on_the_next_request(client, db):
    first = client.get("/api/library/speaking/a-city-part-2")
    db.tables["speaking_samples"][0]["published"] = False
    again = client.get("/api/library/speaking/a-city-part-2", headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 404


def test_routes_are_public_without_a_token(client):
    for path in ("/api/library/speaking", "/api/library/speaking/index", "/api/library/speaking/a-city-part-2"):
        assert client.get(path).status_code == 200, path


@pytest.mark.parametrize("path", ["/api/library/speaking", "/api/library/speaking/index",
                                  "/api/library/speaking/a-city-part-2"])
def test_db_failure_is_503_no_store(client, db, path):
    db.broken.add("speaking_samples")
    r = client.get(path)
    assert r.status_code == 503
    assert r.json() == {"detail": "library_unavailable"}
    assert r.headers["cache-control"] == "no-store"
