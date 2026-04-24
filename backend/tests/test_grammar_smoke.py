"""
Smoke tests for Grammar Wiki — regression protection before Vocab Module work.

Checks:
1. Grammar home data has valid structure (categories + total_articles > 0)
2. Category 'parts-of-speech' contains articles
3. Article 'nouns' in 'parts-of-speech' has required fields
4. No vocab category slugs appear in grammar category list

Tests the grammar_service singleton directly — no HTTP, no DB dependency.
The grammar routes are pure markdown reads; this keeps CI green without
SUPABASE_URL / SUPABASE_KEY.

Run: pytest backend/tests/test_grammar_smoke.py -v
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import grammar_service

VOCAB_CATEGORY_SLUGS = {
    "environment", "technology", "education",
    "work-career", "health", "people-society",
}


def test_grammar_home_ok():
    home = grammar_service.get_home_data()
    assert "categories" in home
    assert "total_articles" in home
    assert home["total_articles"] > 0


def test_grammar_category_parts_of_speech_ok():
    cat = grammar_service.get_category("parts-of-speech")
    assert cat is not None, "Category 'parts-of-speech' not found"
    assert "articles" in cat
    assert len(cat["articles"]) > 0


def test_grammar_article_nouns_ok():
    article = grammar_service.get_article("parts-of-speech", "nouns")
    assert article is not None, "Article 'parts-of-speech/nouns' not found"
    assert "html" in article
    assert article["slug"] == "nouns"
    assert article["category"] == "parts-of-speech"


def test_grammar_no_vocab_leak():
    """Vocab category slugs must not appear in grammar category list."""
    home = grammar_service.get_home_data()
    grammar_category_slugs = {cat["slug"] for cat in home.get("categories", [])}
    leaked = grammar_category_slugs & VOCAB_CATEGORY_SLUGS
    assert leaked == set(), (
        f"Vocab category slugs leaked into grammar data: {leaked}"
    )
