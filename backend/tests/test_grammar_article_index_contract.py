"""Pin: `/api/grammar/categories` lists exactly the articles `get_article` serves.

`frontend/proxy.ts` answers a real HTTP 404 for any `/grammar/<category>/<slug>`
whose key is missing from this list. A servable article that is not listed
would be 404'd; a listed key that does not load would fall back to the soft 404.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import grammar_service


def test_category_list_matches_servable_articles():
    listed = {
        (article["category"], article["slug"])
        for category in grammar_service.all_categories
        for article in category["articles"]
    }
    servable = {(article["category"], slug) for slug, article in grammar_service.articles_by_slug.items()}
    assert listed == servable
    assert all(grammar_service.get_article(category, slug) for category, slug in listed)
    assert grammar_service.get_article("foundations", "nonexistent-slug") is None
