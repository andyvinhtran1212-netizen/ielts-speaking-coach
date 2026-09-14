"""Public Grammar Wiki response contracts.

The routes return cache-aware ``Response`` objects, which bypass FastAPI's
normal response serialization.  These models therefore serve two purposes:

* make the canonical public contract visible in OpenAPI for Next.js; and
* let tests validate every live Markdown-derived payload before deployment.

Keep fields required when the content service always emits them.  That makes a
content-loader drift fail in CI instead of silently widening the browser type.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


GrammarArticleStatus = Literal["complete", "updating", "draft"]


class GrammarArticleRef(BaseModel):
    slug: str
    category: str
    title: str


class GrammarArticleCard(GrammarArticleRef):
    summary: str
    level: str
    difficulty: str
    band_relevance: list[str]
    speaking_relevance: str
    writing_relevance: str
    pathways: list[str]
    common_error_tags: list[str]
    tags: list[str]
    order: int
    reading_time: int
    last_updated: str
    status: GrammarArticleStatus


class GrammarArticleSummary(GrammarArticleCard):
    next_articles: list[str]


class GrammarTocItem(BaseModel):
    id: str
    name: str
    depth: int


class GrammarAnchor(BaseModel):
    id: str
    location: str
    type: str


class GrammarArticleDocumentBase(GrammarArticleCard):
    html: str
    word_count: int
    toc: list[GrammarTocItem]
    anchors: list[GrammarAnchor]
    learning_blocks: list[dict[str, Any]]
    prerequisites: list[str]
    compare_with: list[str]


class GrammarArticleDocument(GrammarArticleDocumentBase):
    """Canonical article route after related/next slugs have been resolved."""

    related_pages: list[GrammarArticleRef]
    next_articles: list[GrammarArticleRef]
    prev_article: GrammarArticleSummary | None = None
    next_article: GrammarArticleSummary | None = None


class GrammarSourceArticleDocument(GrammarArticleDocumentBase):
    """Source document embedded by the compare route before link resolution."""

    related_pages: list[str]
    next_articles: list[str]


class GrammarCategorySummary(BaseModel):
    slug: str
    title: str
    article_count: int
    articles: list[GrammarArticleSummary]


class GrammarHomeResponse(BaseModel):
    categories: list[GrammarCategorySummary]
    featured_articles: list[GrammarArticleSummary]
    total_articles: int
    total_categories: int


class GrammarCategoryResponse(BaseModel):
    slug: str
    title: str
    articles: list[GrammarArticleSummary]


class GrammarCompareResponse(BaseModel):
    slug: str
    left: GrammarSourceArticleDocument
    right: GrammarSourceArticleDocument


class GrammarSearchResult(GrammarArticleRef):
    summary: str
    level: str
    status: GrammarArticleStatus
    reading_time: int
    speaking_relevance: str
    writing_relevance: str


class GrammarGroupArticle(GrammarArticleRef):
    level: str
    status: Literal["complete", "updating", "draft", "planned"]
    reading_time: int | None
    summary: str


class GrammarGroup(BaseModel):
    slug: str
    title: str
    description: str
    color: str
    article_count: int
    complete_count: int
    articles: list[GrammarGroupArticle]
