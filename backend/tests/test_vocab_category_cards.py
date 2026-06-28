"""GET /api/vocabulary/categories/{cat}/cards — topic-scoped study stack.

The endpoint feeds topic-scoped flashcards/exercises: all FULL vocab cards (rich
fields) for one category. Service-level + route-level. No DB needed — the service
falls back to the markdown seed words in CI.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.testclient import TestClient

from services.vocab_content import VocabContentService, vocab_service

# The article (not summary) shape — every rich field a flashcard/exercise can use.
_RICH_KEYS = {
    "headword", "slug", "category", "pronunciation", "part_of_speech", "level",
    "definition_en", "definition_vi", "example", "collocations", "synonyms",
    "antonyms", "memory_hook", "common_error", "audio_headword", "audio_example",
}


def test_get_category_cards_returns_full_rich_cards():
    svc = VocabContentService()
    cat = next(iter(svc.articles_by_category))          # a category that has cards
    cards = svc.get_category_cards(cat)
    assert cards, f"expected cards for category {cat!r}"
    assert all(c["category"] == cat for c in cards)
    # Full article shape (not the trimmed summary) so the rich study UI has
    # everything to render — assert the KEYS exist (values vary by data source).
    missing = _RICH_KEYS - set(cards[0])
    assert not missing, f"card missing rich fields: {missing}"


def test_get_category_cards_unknown_returns_none():
    svc = VocabContentService()
    assert svc.get_category_cards("__no_such_category__") is None


def test_category_cards_route_200_and_404():
    from main import app
    client = TestClient(app)

    cat = next(iter(vocab_service.articles_by_category))
    res = client.get(f"/api/vocabulary/categories/{cat}/cards")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["category"] == cat
    assert body["count"] == len(body["cards"]) >= 1
    assert isinstance(body["cards"], list) and body["cards"]

    res404 = client.get("/api/vocabulary/categories/__nope__/cards")
    assert res404.status_code == 404
