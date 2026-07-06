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

EXPECTED_ARTICLE_COUNT = 80
REQUIRED_FIELDS = {"headword", "slug", "category", "level", "part_of_speech", "pronunciation"}
VALID_CATEGORIES = {
    "environment", "technology", "education",
    "work-career", "health", "people-society", "economy",
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


def _article(headword: str, slug: str, category: str) -> dict:
    return {
        "headword": headword, "slug": slug, "category": category,
        "level": "B2", "part_of_speech": "adjective", "pronunciation": "/x/",
        "synonyms": [], "antonyms": [], "collocations": [], "related_words": [],
        "word_family": [], "gloss_vi": "", "definition_en": "", "definition_vi": "",
        "example": "", "html": "", "syllables": "", "audio_headword": "",
        "audio_example": "", "register": "", "common_error": "", "memory_hook": "",
        "source": "",
    }


def test_same_slug_two_categories_both_counted_and_addressable():
    """mig 122: a word (slug) present in TWO categories is counted once per topic
    and each card is reachable by its own (category, slug) — no silent dedup that
    would drop a word from the census or 404 its detail page."""
    svc = _service()
    # Rebuild the index from a hand-made census sharing a slug across categories.
    svc.articles_by_slug = {}
    svc.articles_by_cat_slug = {}
    svc._all_articles = []
    svc.articles_by_category = {}
    svc.all_categories = []
    svc._build_indexes([
        _article("Abundant", "abundant", "environment"),
        _article("Abundant", "abundant", "business"),
    ])
    # Full census counts BOTH — not deduped by slug.
    assert len(svc.get_all_articles()) == 2
    # Each is individually addressable by its own category.
    assert svc.get_article("environment", "abundant") is not None
    assert svc.get_article("business", "abundant") is not None
    # A category with no such card → not found.
    assert svc.get_article("health", "abundant") is None


def test_load_from_db_paginates_past_1000_row_cap():
    """PostgREST caps one response at ~1000 rows; a bare select('*') silently drops
    everything past the first page. With vocab_cards > 1000 rows the loader must
    page with range() so the browse index + KP seed see EVERY word (regression:
    1835 rows loaded as only ~1000 → ~800 cards invisible)."""
    from unittest.mock import patch, MagicMock
    import services.vocab_content as vc

    N = 1835

    class _PagedFake:
        def __init__(self, rows):
            self._rows = rows; self._a = 0; self._b = 0
        def table(self, _name): return self
        def select(self, *a, **k): return self
        def range(self, a, b): self._a = a; self._b = b; return self
        def execute(self):
            return MagicMock(data=self._rows[self._a:self._b + 1])

    rows = [{"headword": f"w{i}", "slug": f"w{i}", "category": "education", "updated_at": None}
            for i in range(N)]
    svc = vc.VocabContentService.__new__(vc.VocabContentService)  # skip __init__ (no live DB load)
    with patch("database.supabase_admin", _PagedFake(rows)):
        loaded = svc._load_from_db()
    assert loaded is not None
    assert len(loaded) == N, f"loader dropped rows past the 1000 cap: got {len(loaded)} of {N}"


def test_vocab_search_prefix():
    svc = _service()
    results = svc.search_prefix("mit")
    headwords = [r["headword"].lower() for r in results]
    assert any(h.startswith("mit") for h in headwords), (
        f"Prefix search 'mit' returned no matching headwords: {headwords}"
    )
