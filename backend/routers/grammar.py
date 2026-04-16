"""
routers/grammar.py — Grammar Wiki endpoints

All routes are public (no auth required) — the wiki is read-only reference content.

Endpoints
---------
GET /api/grammar/home                       → homepage data (categories + featured)
GET /api/grammar/categories                 → all categories with article lists
GET /api/grammar/category/{slug}            → single category with article list
GET /api/grammar/article/{category}/{slug}  → full article (HTML + TOC + related)
GET /api/grammar/roadmap/{slug}             → ordered articles for a category
GET /api/grammar/compare/{slug}             → two articles side-by-side
GET /api/grammar/search?q=...              → keyword search (≤20 results)
"""

from fastapi import APIRouter, HTTPException, Query

from services.grammar_content import grammar_service

router = APIRouter(prefix="/api/grammar", tags=["grammar"])


@router.get("/home")
async def get_home():
    """Return homepage data: all categories and up to 6 featured articles."""
    return grammar_service.get_home_data()


@router.get("/categories")
async def get_categories():
    """Return all categories with their article summaries."""
    return grammar_service.all_categories


@router.get("/category/{slug}")
async def get_category(slug: str):
    """Return all article summaries for a specific category."""
    data = grammar_service.get_category(slug)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Category '{slug}' not found")
    return data


@router.get("/article/{category}/{slug}")
async def get_article(category: str, slug: str):
    """
    Return the full article: HTML body, TOC, band scores metadata,
    resolved related_pages, and prev/next navigation.
    """
    data = grammar_service.get_article(category, slug)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Article '{category}/{slug}' not found",
        )
    return data


@router.get("/roadmap/{slug}")
async def get_roadmap(slug: str):
    """
    Return the ordered article list for a category as a learning roadmap.
    Slug is a category slug (e.g. 'tenses').
    """
    data = grammar_service.get_roadmap(slug)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Roadmap '{slug}' not found")
    return data


@router.get("/compare/{slug}")
async def get_compare(slug: str):
    """
    Return two articles side-by-side for comparison.
    Slug format: '<left-article>-vs-<right-article>'
    Example: present-simple-vs-present-continuous
    """
    data = grammar_service.get_compare(slug)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Compare page '{slug}' not found")
    return data


@router.get("/search")
async def search(q: str = Query("", description="Search query (min 2 chars)")):
    """
    Keyword search across title, summary, tags, and body text.
    Returns up to 20 results ranked by relevance score.
    """
    return grammar_service.search(q)


@router.get("/groups")
async def get_groups():
    """
    Return the 8 conceptual topic groups with enriched article lists.
    Each article has a resolved status: complete | updating | planned.
    Planned articles have no MD file yet — they should be shown but not linked.
    """
    return grammar_service.get_groups()
