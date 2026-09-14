"""Lean, paged Vocabulary Wiki directory contract."""

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.vocab_content import VocabContentService


def test_directory_is_lean_stable_and_paged():
    service = VocabContentService()
    first = service.get_directory(limit=3)
    second = service.get_directory(offset=3, limit=3)

    assert first["offset"] == 0
    assert first["limit"] == 3
    assert first["total"] == len(service.get_curated_articles())
    assert len(first["items"]) == min(3, first["total"])
    assert all("articles" not in category for category in first["categories"])
    assert all(set(category) == {"slug", "title", "article_count"} for category in first["categories"])
    assert {
        (item["category"], item["slug"]) for item in first["items"]
    }.isdisjoint({
        (item["category"], item["slug"]) for item in second["items"]
    })


def test_directory_filters_by_category_and_substring():
    service = VocabContentService()
    category = next(item for item in service.get_categories() if item["article_count"])
    sample = category["articles"][0]

    category_page = service.get_directory(category=category["slug"], limit=100)
    assert category_page["total"] == category["article_count"]
    assert all(item["category"] == category["slug"] for item in category_page["items"])

    needle = sample["headword"][: max(1, len(sample["headword"]) // 2)].swapcase()
    search_page = service.get_directory(query=needle, limit=100)
    assert any(item["slug"] == sample["slug"] for item in search_page["items"])


def test_directory_initial_payload_stays_bounded_as_catalogue_grows():
    service = object.__new__(VocabContentService)
    summaries = [
        {
            "slug": f"word-{index}",
            "category": "large-bank",
            "headword": f"Word {index}",
            "level": "B2",
            "part_of_speech": "noun",
            "pronunciation": "/wɜːd/",
            "gloss_vi": "một mục từ dùng để kiểm tra ngân sách payload",
            "audio_headword": "",
        }
        for index in range(811)
    ]
    service.all_categories = [{
        "slug": "large-bank",
        "title": "Large bank",
        "article_count": len(summaries),
        "articles": summaries,
    }]

    directory = service.get_directory(limit=60)
    legacy_payload_bytes = len(json.dumps(service.all_categories, ensure_ascii=False).encode())
    directory_payload_bytes = len(json.dumps(directory, ensure_ascii=False).encode())

    assert len(directory["items"]) == 60
    assert directory["total"] == 811
    assert directory_payload_bytes < legacy_payload_bytes * 0.1


def test_directory_route_validates_bounds_and_preserves_cache_headers():
    from main import app

    client = TestClient(app)
    response = client.get("/api/vocabulary/directory?offset=0&limit=2")
    assert response.status_code == 200, response.text
    assert len(response.json()["items"]) <= 2
    assert response.headers.get("Last-Modified", "").endswith("GMT")

    assert client.get("/api/vocabulary/directory?limit=0").status_code == 422
    assert client.get("/api/vocabulary/directory?limit=101").status_code == 422
    assert client.get("/api/vocabulary/directory?offset=-1").status_code == 422
