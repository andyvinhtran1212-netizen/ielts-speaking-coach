"""LIBRARY-0061 T006: public Writing sample API (FR-004, FR-010, FR-011,
FR-013–FR-019). The database is faked; the router is the real one in main.py."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from tests._library_fake_db import FakeDB


def _essay(band):
    return {
        "text": f"Essay at band {band}.",
        "word_count": 280,
        "outline": ["Intro", "Body"],
        "vocab_table": [{"term": "mitigate", "meaning_vi": "giảm nhẹ"}],
        "structures": ["Although ..."],
        "estimated_scores": {"TR": 7, "CC": 7},  # internal: must not leak
        "idea_codes": ["PS-01"],
    }


def _sample(slug, *, title, task_type="task2", qtype="opinion", topic="education",
            published=True, image=None, subtype=None, updated="2026-11-01T00:00:00+00:00", id_=None):
    return {
        "id": id_ or f"id-{slug}",
        "source_key": f"src/{slug}",
        "slug": slug,
        "title_en": title,
        "task_type": task_type,
        "question_type": qtype if task_type == "task2" else None,
        "task1_subtype": subtype,
        "topic_slug": topic,
        "prompt_text": f"Prompt about {title}.",
        "prompt_image_path": image,
        "essays": {b: _essay(b) for b in ("7.5", "7.0", "6.0")},
        "delta_75_70": [{"criterion": "TR", "before": "a", "after": "b", "why": "c",
                         "type": "lexical", "error_group": "G1"}],
        "delta_70_60": [{"criterion": "GRA", "before": "x", "after": "y", "why": "z"}],
        "justification": {"by_criterion": [{
            "criterion": "LR", "summary_vi": "Từ vựng",
            "score_estimate": 7,
            "jumps": [{"pair": "7.0-7.5", "changes": [
                {"lower_form": "big", "higher_form": "substantial", "why_vi": "chính xác hơn",
                 "change_type": "LR-precision"}]}],
        }], "integrity_check": {"ok": True}},
        "task1_data": {"kind": "bar"} if task_type == "task1_academic" else None,
        "content_hash": "deadbeef",
        "source_review_status": "approved",
        "difficulty_notes": "internal",
        "published": published,
        "published_at": "2026-11-01T00:00:00+00:00" if published else None,
        "updated_at": updated,
    }


TOPICS = [
    {"slug": "education", "label_vi": "Giáo dục", "shelves": ["writing", "speaking"], "display_order": 1},
    {"slug": "environment", "label_vi": "Môi trường", "shelves": ["writing"], "display_order": 2},
    {"slug": "hobbies", "label_vi": "Sở thích", "shelves": ["speaking"], "display_order": 3},
]


def _rows():
    return [
        _sample("alpha-schools", title="Alpha schools", qtype="opinion", topic="education"),
        _sample("beta-uniforms", title="Beta uniforms", qtype="discussion", topic="education"),
        _sample("gamma-climate", title="Gamma climate", qtype="opinion", topic="environment",
                updated="2026-11-05T00:00:00+00:00"),
        _sample("delta-chart", title="Delta chart", task_type="task1_academic", subtype="bar",
                topic="environment", image="writing/delta-chart/figure.png"),
        _sample("draft-secret", title="Draft secret", qtype="opinion", topic="education", published=False),
    ]


@pytest.fixture()
def db(monkeypatch):
    fake = FakeDB(tables={
        "writing_samples": _rows(),
        "library_topics": TOPICS,
        "writing_sample_slug_history": [
            {"old_slug": "alpha-old", "sample_id": "id-alpha-schools"},
            {"old_slug": "draft-old", "sample_id": "id-draft-secret"},
        ],
        "writing_tips": [
            {"id": 1, "published": True, "content_type": "knowledge"},
            {"id": 2, "published": True, "content_type": "tip"},
            {"id": 3, "published": False, "content_type": "tip"},
            {"id": 4, "published": True, "content_type": "other"},
        ],
        "speaking_samples": [
            {"id": 1, "published": True, "video_source": "youtube:abc"},
            {"id": 2, "published": True, "video_source": None},
            {"id": 3, "published": False, "video_source": "youtube:def"},
        ],
    })
    import routers.library as library

    monkeypatch.setattr(library, "supabase_admin", fake)
    return fake


@pytest.fixture()
def client(db):
    from main import app

    return TestClient(app)


FORBIDDEN = (
    "source_key", "content_hash", "source_review_status", "integrity_check",
    "difficulty_notes", "estimated_scores", "idea_codes", "score_estimate",
    "change_type", "error_group", "draft-secret", "Draft secret",
)


def _assert_clean(body):
    text = json.dumps(body, ensure_ascii=False)
    for needle in FORBIDDEN:
        assert needle not in text, needle
    assert "supabase.co/storage" not in text
    assert "writing/delta-chart/figure.png" not in text


# ── list ────────────────────────────────────────────────────────────────────


def test_list_returns_only_published_in_default_order_with_public_cache(client):
    r = client.get("/api/library/writing-samples")
    assert r.status_code == 200
    assert r.headers["cache-control"].startswith("public, max-age=60")
    assert r.headers.get("etag")
    body = r.json()
    assert [i["slug"] for i in body["items"]] == ["alpha-schools", "beta-uniforms", "gamma-climate", "delta-chart"]
    assert body["total"] == 4 and body["page"] == 1 and body["page_size"] == 12
    assert [t["slug"] for t in body["topics"]] == ["education", "environment"]  # speaking-only topic hidden
    _assert_clean(body)


def test_list_facets_ignore_their_own_filter(client):
    body = client.get("/api/library/writing-samples?task=task2&chude=education").json()
    assert [i["slug"] for i in body["items"]] == ["alpha-schools", "beta-uniforms"]
    facets = body["facets"]
    assert facets["task"] == {"task2": 2}  # education only, any task
    assert facets["question_type"] == {"opinion": 1, "discussion": 1}
    assert facets["topic"] == {"education": 2, "environment": 1}  # task2, any topic


def test_list_search_matches_title_and_prompt_case_insensitively(client):
    assert [i["slug"] for i in client.get("/api/library/writing-samples?q=CLIMATE").json()["items"]] == ["gamma-climate"]
    assert client.get("/api/library/writing-samples?q=prompt about delta").json()["total"] == 1
    assert client.get("/api/library/writing-samples?q=secret").json()["total"] == 0


def test_list_paging(client, db):
    db.tables["writing_samples"] = [
        _sample(f"s-{i:02d}", title=f"Set {i:02d}") for i in range(15)
    ]
    second = client.get("/api/library/writing-samples?trang=2").json()
    assert second["total"] == 15
    assert [i["slug"] for i in second["items"]] == ["s-12", "s-13", "s-14"]
    assert client.get("/api/library/writing-samples?trang=3").json()["items"] == []


@pytest.mark.parametrize("query", [
    "task=task3",
    "dang=essay",
    "task=task1&dang=opinion",
    "chude=hobbies",  # topic exists but is not on the Writing shelf
    "chude=nope",
    "trang=0",
    "q=" + "x" * 101,
])
def test_list_rejects_bad_params_with_422(client, query):
    assert client.get(f"/api/library/writing-samples?{query}").status_code == 422


def test_list_accepts_q_of_exactly_100_chars(client):
    assert client.get("/api/library/writing-samples?q=" + "x" * 100).status_code == 200


# ── index ───────────────────────────────────────────────────────────────────


def test_index_lists_published_slugs_and_dates(client):
    r = client.get("/api/library/writing-samples/index")
    assert r.status_code == 200
    body = r.json()
    assert {e["slug"] for e in body} == {"alpha-schools", "beta-uniforms", "gamma-climate", "delta-chart"}
    assert all(set(e) == {"slug", "updated_at"} for e in body)
    assert r.headers["last-modified"] == "Thu, 05 Nov 2026 00:00:00 GMT"


# ── detail ──────────────────────────────────────────────────────────────────


def test_detail_allow_lists_payload_and_expands_criteria(client):
    r = client.get("/api/library/writing-samples/alpha-schools")
    assert r.status_code == 200
    assert r.headers["cache-control"].startswith("public, max-age=60")
    body = r.json()
    _assert_clean(body)
    assert set(body["essays"]) == {"7.5", "7.0", "6.0"}
    assert set(body["essays"]["7.5"]) == {"text", "word_count", "outline", "vocab_table", "structures"}
    assert body["delta_75_70"] == [{"before": "a", "after": "b", "why": "c", "criterion": "Task Response"}]
    assert body["delta_70_60"][0]["criterion"] == "Grammatical Range and Accuracy"
    assert body["justification"] == [{
        "criterion": "Lexical Resource",
        "summary_vi": "Từ vựng",
        "jumps": [{"pair": "7.0-7.5", "changes": [
            {"lower_form": "big", "higher_form": "substantial", "why_vi": "chính xác hơn"}]}],
    }]
    assert body["figure_url"] is None
    assert body["task1_data"] is None
    assert body["prev"] is None and body["next"]["slug"] == "beta-uniforms"
    # Same type + same topic is empty (draft excluded), then same type, then same topic.
    assert [x["slug"] for x in body["related"]] == ["gamma-climate", "beta-uniforms"]


def test_detail_task1_uses_task_achievement_and_route_figure_url(client, db):
    db.tables["writing_samples"][3]["delta_75_70"] = [{"criterion": "TR", "before": "", "after": "", "why": ""}]
    body = client.get("/api/library/writing-samples/delta-chart").json()
    assert body["delta_75_70"][0]["criterion"] == "Task Achievement"
    assert body["figure_url"] == "/api/library/media/writing-sample/delta-chart/figure"
    assert body["task1_data"] == {"kind": "bar"}
    assert body["prev"]["slug"] == "gamma-climate" and body["next"] is None
    _assert_clean(body)


def test_detail_unpublished_is_404(client):
    r = client.get("/api/library/writing-samples/draft-secret")
    assert r.status_code == 404
    assert r.json() == {"detail": "sample_not_found"}


def test_detail_unknown_is_404(client):
    assert client.get("/api/library/writing-samples/nope").json() == {"detail": "sample_not_found"}


def test_detail_old_slug_redirects_308_to_current(client):
    r = client.get("/api/library/writing-samples/alpha-old", follow_redirects=False)
    assert r.status_code == 308
    assert r.headers["location"] == "/api/library/writing-samples/alpha-schools"


def test_detail_old_slug_of_unpublished_set_is_404(client):
    r = client.get("/api/library/writing-samples/draft-old", follow_redirects=False)
    assert r.status_code == 404


def test_criterion_name_never_echoes_short_codes():
    from routers.library import criterion_name

    assert criterion_name("tr", "task2") == "Task Response"
    assert criterion_name("CC", "task2") == "Coherence and Cohesion"
    assert criterion_name("XY", "task2") is None
    assert criterion_name("Lexical Resource", "task2") == "Lexical Resource"
    assert criterion_name(None, "task2") is None


# ── summary ─────────────────────────────────────────────────────────────────


def test_summary_counts_published_shelves(client):
    r = client.get("/api/library/summary")
    assert r.status_code == 200
    body = r.json()
    assert body["writing_samples"] == {"total": 4, "task2": 3, "task1": 1}
    assert body["writing_guides"] == {"total": 2}
    assert body["speaking"] == {"total": 2, "with_video": 1}
    assert body["grammar"]["total"] > 0
    assert body["vocabulary"]["total"] > 0


def test_summary_shelf_that_cannot_be_counted_is_null(client, db):
    db.broken.add("speaking_samples")
    body = client.get("/api/library/summary").json()
    assert body["speaking"] is None
    assert body["writing_samples"]["total"] == 4


# ── access ──────────────────────────────────────────────────────────────────


def test_routes_are_public_without_a_token(client):
    for path in (
        "/api/library/summary",
        "/api/library/writing-samples",
        "/api/library/writing-samples/index",
        "/api/library/writing-samples/alpha-schools",
    ):
        assert client.get(path).status_code == 200, path
