"""Public Grammar payloads must stay aligned with their OpenAPI contracts."""

import sys
from pathlib import Path

from pydantic import TypeAdapter

sys.path.insert(0, str(Path(__file__).parent.parent))

from models.grammar_content import (  # noqa: E402
    GrammarArticleDocument,
    GrammarCategoryResponse,
    GrammarCategorySummary,
    GrammarCompareResponse,
    GrammarGroup,
    GrammarHomeResponse,
    GrammarSearchResult,
)
from routers.grammar import router  # noqa: E402
from services.grammar_content import grammar_service  # noqa: E402


def test_every_live_public_grammar_payload_matches_the_declared_contract():
    GrammarHomeResponse.model_validate(grammar_service.get_home_data())
    TypeAdapter(list[GrammarCategorySummary]).validate_python(
        grammar_service.all_categories,
    )
    TypeAdapter(list[GrammarGroup]).validate_python(grammar_service.get_groups())

    for category in grammar_service.all_categories:
        slug = category["slug"]
        GrammarCategoryResponse.model_validate(grammar_service.get_category(slug))
        GrammarCategoryResponse.model_validate(grammar_service.get_roadmap(slug))

    for slug, source in grammar_service.articles_by_slug.items():
        resolved = grammar_service.get_article(source["category"], slug)
        GrammarArticleDocument.model_validate(resolved)

    TypeAdapter(list[GrammarSearchResult]).validate_python(
        grammar_service.search("grammar"),
    )

    compare_slug = "present-simple-vs-present-continuous"
    GrammarCompareResponse.model_validate(grammar_service.get_compare(compare_slug))


def test_public_grammar_routes_expose_response_models_to_openapi():
    expected = {
        "/api/grammar/home": GrammarHomeResponse,
        "/api/grammar/categories": list[GrammarCategorySummary],
        "/api/grammar/category/{slug}": GrammarCategoryResponse,
        "/api/grammar/article/{category}/{slug}": GrammarArticleDocument,
        "/api/grammar/roadmap/{slug}": GrammarCategoryResponse,
        "/api/grammar/compare/{slug}": GrammarCompareResponse,
        "/api/grammar/search": list[GrammarSearchResult],
        "/api/grammar/groups": list[GrammarGroup],
    }
    routes = {
        route.path: route.response_model
        for route in router.routes
        if "GET" in getattr(route, "methods", set())
    }
    for path, model in expected.items():
        assert routes[path] == model
