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

from datetime import timezone
from email.utils import format_datetime

from fastapi import APIRouter, HTTPException, Query, Request, Response

from services.public_cache import cacheable_json, content_last_modified
from services.vocab_content import CATEGORIES_FILE, CONTENT_DIR, vocab_service

router = APIRouter(prefix="/api/vocabulary", tags=["vocabulary"])
# Fallback cache key for the markdown source (files have no per-row timestamp).
_PUBLIC_LAST_MODIFIED = content_last_modified(CONTENT_DIR, CATEGORIES_FILE)


def _last_modified() -> str:
    """G2 — cache key derived from the live source, as an HTTP-date STRING.

    When serving from vocab_cards, vocab_service.last_modified = MAX(updated_at)
    (a datetime), so a commit (which bumps updated_at + triggers reload())
    invalidates the client cache. cacheable_json puts this straight into the
    Last-Modified header, which Starlette .encode()s — so it MUST be a str, not
    a datetime (passing the raw datetime is what 500'd /api/vocabulary/* after
    the DB cutover). Format MAX(updated_at) as an RFC-1123 HTTP-date here. Falls
    back to the static markdown stamp (already a str) when no DB time exists."""
    lm = vocab_service.last_modified
    if lm is None:
        return _PUBLIC_LAST_MODIFIED
    # format_datetime(usegmt=True) requires a tz-aware datetime; coerce any naive
    # value to UTC so a row with a naive updated_at can't raise.
    if lm.tzinfo is None:
        lm = lm.replace(tzinfo=timezone.utc)
    return format_datetime(lm, usegmt=True)


@router.get("/categories")
async def get_categories(request: Request) -> Response:
    """Return all vocab categories with article summaries."""
    return cacheable_json(
        vocab_service.get_categories(),
        request,
        last_modified=_last_modified(),
    )


@router.get("/articles")
async def get_articles(request: Request) -> Response:
    """Return flat list of all article summaries (for client-side search/listing)."""
    return cacheable_json(
        vocab_service.get_all_articles(),
        request,
        last_modified=_last_modified(),
    )


@router.get("/articles/{category}/{slug}")
async def get_article(category: str, slug: str, request: Request) -> Response:
    """Return full article: HTML body, pronunciation, synonyms, collocations, related words."""
    data = vocab_service.get_article(category, slug)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Article '{category}/{slug}' not found",
        )
    return cacheable_json(data, request, last_modified=_last_modified())


@router.get("/search")
async def search(
    request: Request,
    q: str = Query(default="", min_length=0),
) -> Response:
    """Simple prefix match on headword. Returns up to 20 results."""
    return cacheable_json(
        vocab_service.search_prefix(q),
        request,
        last_modified=_last_modified(),
    )
