"""
Unit tests for VocabContentService — Phase A ship-gate.

Tests the content loader directly (no HTTP, no DB) to catch article-count
drift, missing required fields, and invalid category slugs before they reach
the API layer.

Run: pytest backend/tests/test_vocab_content.py -v
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.vocab_content import VocabContentService

EXPECTED_ARTICLE_COUNT = 20
REQUIRED_FIELDS = {"headword", "slug", "category", "level", "part_of_speech", "pronunciation"}
VALID_CATEGORIES = {
    "environment", "technology", "education",
    "work-career", "health", "people-society",
}


def _service() -> VocabContentService:
    return VocabContentService()


def test_vocab_article_count():
    svc = _service()
    articles = list(svc.articles_by_slug.values())
    assert len(articles) == EXPECTED_ARTICLE_COUNT, (
        f"Expected {EXPECTED_ARTICLE_COUNT} vocab articles, got {len(articles)}. "
        f"Loaded slugs: {sorted(svc.articles_by_slug.keys())}"
    )


def test_vocab_required_fields_present():
    svc = _service()
    missing = []
    for slug, article in svc.articles_by_slug.items():
        for field in REQUIRED_FIELDS:
            if not article.get(field):
                missing.append(f"{slug}.{field}")
    assert not missing, f"Articles missing required fields: {missing}"


def test_vocab_all_categories_valid():
    svc = _service()
    invalid = [
        (slug, a["category"])
        for slug, a in svc.articles_by_slug.items()
        if a["category"] not in VALID_CATEGORIES
    ]
    assert not invalid, f"Articles with invalid categories: {invalid}"


def test_vocab_category_count():
    svc = _service()
    assert len(svc.all_categories) == len(VALID_CATEGORIES), (
        f"Expected {len(VALID_CATEGORIES)} categories, got {len(svc.all_categories)}"
    )


def test_vocab_search_prefix():
    svc = _service()
    results = svc.search_prefix("mit")
    headwords = [r["headword"].lower() for r in results]
    assert any(h.startswith("mit") for h in headwords), (
        f"Prefix search 'mit' returned no matching headwords: {headwords}"
    )
