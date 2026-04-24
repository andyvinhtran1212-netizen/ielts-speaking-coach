"""
routers/vocabulary.py — Vocabulary Wiki endpoints

All routes are public (no auth required).

Endpoints
---------
GET /api/vocabulary/categories               → 6 categories with article lists
GET /api/vocabulary/articles                 → flat list of all article summaries
GET /api/vocabulary/articles/{cat}/{slug}    → full article detail
GET /api/vocabulary/search?q=...            → simple headword prefix match
"""

from fastapi import APIRouter, HTTPException, Query

from services.vocab_content import vocab_service

router = APIRouter(prefix="/api/vocabulary", tags=["vocabulary"])


@router.get("/categories")
async def get_categories():
    """Return all vocab categories with article summaries."""
    return vocab_service.get_categories()


@router.get("/articles")
async def get_articles():
    """Return flat list of all article summaries (for client-side search/listing)."""
    return vocab_service.get_all_articles()


@router.get("/articles/{category}/{slug}")
async def get_article(category: str, slug: str):
    """Return full article: HTML body, pronunciation, synonyms, collocations, related words."""
    data = vocab_service.get_article(category, slug)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Article '{category}/{slug}' not found",
        )
    return data


@router.get("/search")
async def search(q: str = Query(default="", min_length=0)):
    """Simple prefix match on headword. Returns up to 20 results."""
    return vocab_service.search_prefix(q)
