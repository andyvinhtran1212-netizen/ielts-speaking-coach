"""routers.admin.grammar — Grammar admin (file-based articles) (BACKENDSPLIT-0076 T009).

Cut and pasted unchanged from the former single-file routers/admin.py. The
package re-exports every name; tests patch ``routers.admin``, never this module
(see __init__.py).
"""

import math
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlparse
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Response
from pydantic import BaseModel, Field, model_validator
from models.grammar_content import GrammarArticleDocument
from database import supabase_admin
from services.errors import clip_user_value, clip_user_values, new_ref, safe_error

from routers.admin import (  # noqa: E402 — defined above this block in the package
    logger,
    router,
    require_admin,
)


# ── Sprint 12.7 — Grammar admin (hybrid file-based pattern) ────────────────────
#
# Grammar articles live as Markdown files under
# `backend/content/<category>/<slug>.md` (Discovery #73 inventory). They are
# loaded into memory at startup via services.grammar_content.GrammarContentService
# and served read-only via /api/grammar/*. Andy authors articles in repo + git
# (NOT via admin form), so this surface is intentionally read-only:
#
#   - GET /admin/grammar/articles   — list with file metadata + DB analytics
#   - GET /admin/grammar/analytics  — aggregate views/saves + zero-view list
#   - POST /admin/grammar/recommend-test — preview find_best_match() on a
#     synthetic issue string (dogfood the recommendation router before users
#     see it).
#
# No write endpoints. No `.md` upload. No DB-backed article CRUD. The
# commit-triggers-Vercel-deploy workflow already gives Andy a "publish"
# pipeline.


GRAMMAR_ARTICLE_METRIC_PAGE = 1000


def _grammar_article_metric_rows(table: str, columns: str, slugs: list[str]) -> list[dict]:
    """Read every metric row for the requested slugs.

    PostgREST caps bare selects, so a single response cannot prove a metric is
    complete. Keyset paging on the immutable primary key avoids offset drift
    while rows are inserted or saves are removed. Any page failure aborts the
    source instead of returning a partial total labelled complete.
    """
    if not slugs:
        return []

    rows: list[dict] = []
    cursor_id: str | None = None
    while True:
        query = (
            supabase_admin.table(table)
            .select(f"id,{columns}")
            .in_("article_slug", slugs)
            .order("id")
            .limit(GRAMMAR_ARTICLE_METRIC_PAGE)
        )
        if cursor_id is not None:
            query = query.gt("id", cursor_id)
        batch = (
            query
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        if len(batch) < GRAMMAR_ARTICLE_METRIC_PAGE:
            return rows
        next_id = batch[-1].get("id")
        if not next_id or next_id == cursor_id:
            raise RuntimeError(f"{table} pagination cursor did not advance")
        cursor_id = str(next_id)


@router.get("/grammar/articles")
async def admin_list_grammar_articles(
    category: str | None = Query(default=None, description="filter to a single category slug"),
    search: str | None = Query(default=None, description="case-insensitive substring on title"),
    authorization: str | None = Header(default=None),
):
    """List all grammar articles with view + save counts.

    Source-of-truth: the in-memory `grammar_service.articles_by_slug`
    (loaded from `backend/content/<category>/<slug>.md`). View/save
    counts come from `article_views` and `saved_articles` aggregated
    per slug.

    Filtering happens client-side over the small (<200 row) result set
    so we don't have to thread a SQL WHERE clause through the
    grammar_service in-memory layout.
    """
    await require_admin(authorization)

    try:
        from services.grammar_content import grammar_service
    except Exception as exc:
        logger.error("[admin] grammar service import failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Dịch vụ ngữ pháp tạm thời không khả dụng. Vui lòng thử lại.") from None

    all_articles = list((grammar_service.articles_by_slug or {}).values())
    categories = sorted({a.get("category") for a in all_articles if a.get("category")})
    articles = all_articles

    if category:
        articles = [a for a in articles if a.get("category") == category]
    if search:
        needle = search.strip().lower()
        articles = [a for a in articles
                    if needle in (a.get("title") or "").lower()
                    or needle in (a.get("slug") or "").lower()]

    # Collect slugs we need to hydrate with analytics counts.
    slugs = [a["slug"] for a in articles if a.get("slug")]

    view_count: dict[str, int] = {}
    save_count: dict[str, int] = {}
    analytics_status = {"views": "complete", "saves": "complete"}
    if slugs:
        try:
            for row in _grammar_article_metric_rows(
                "article_views", "article_slug,view_count", slugs
            ):
                s = row.get("article_slug")
                if not s:
                    continue
                view_count[s] = view_count.get(s, 0) + int(row.get("view_count") or 0)
        except Exception as exc:
            logger.warning("[admin] grammar view aggregate failed: %s", exc)
            analytics_status["views"] = "unavailable"
        try:
            for row in _grammar_article_metric_rows(
                "saved_articles", "article_slug", slugs
            ):
                s = row.get("article_slug")
                if not s:
                    continue
                save_count[s] = save_count.get(s, 0) + 1
        except Exception as exc:
            logger.warning("[admin] grammar save aggregate failed: %s", exc)
            analytics_status["saves"] = "unavailable"

    items = []
    for a in articles:
        slug = a.get("slug") or ""
        items.append({
            "slug":          slug,
            "title":         a.get("title"),
            "category":      a.get("category"),
            "summary":       a.get("summary"),
            "band":          a.get("band"),
            "order":         a.get("order"),
            "tags":          a.get("tags") or [],
            "view_count":    view_count.get(slug, 0) if analytics_status["views"] == "complete" else None,
            "save_count":    save_count.get(slug, 0) if analytics_status["saves"] == "complete" else None,
            "source_path":   f"backend/content/{a.get('category', '')}/{slug}.md",
        })

    items.sort(key=lambda r: (r.get("category") or "", r.get("order") or 999, r.get("title") or ""))

    return {
        "items":      items,
        "total":      len(items),
        "available_total": len(all_articles),
        "categories": categories,
        "analytics_status": analytics_status,
    }


@router.get("/grammar/articles/{slug}/preview", response_model=GrammarArticleDocument)
async def admin_preview_grammar_article(
    slug: str,
    authorization: str | None = Header(default=None),
):
    """Return the full rendered article (HTML body + TOC + frontmatter)
    so the admin browser can show an inline preview without leaving
    /pages/admin/grammar/articles.html."""
    await require_admin(authorization)

    try:
        from services.grammar_content import grammar_service
    except Exception as exc:
        logger.error("[admin] grammar service import failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Dịch vụ ngữ pháp tạm thời không khả dụng. Vui lòng thử lại.") from None

    summary = grammar_service.get_article_by_slug(slug)
    if not summary:
        raise HTTPException(404, f"Article '{clip_user_value(slug)}' not found")
    article = grammar_service.get_article(summary["category"], slug)
    if not article:
        raise HTTPException(404, f"Article '{clip_user_value(slug)}' not found")
    return article


@router.get("/grammar/analytics")
async def admin_grammar_analytics(
    days: int = Query(default=7, ge=1, le=90),
    authorization: str | None = Header(default=None),
):
    """Aggregate views + saves for the admin grammar analytics page.

    Returns:
      - views_total              (sum of view_count across article_views)
      - active_view_records_recent (user/article records active in the window)
      - saves_total              (count of saved_articles rows)
      - top_viewed[]             (top 20 by total views)
      - top_saved[]              (top 5 by save count)
      - zero_view_slugs[]        (article slugs with NO view rows — content gap)
      - articles_total           (total .md files loaded)
      - days                     (window used for views_recent)
    """
    await require_admin(authorization)

    try:
        from services.grammar_content import grammar_service
    except Exception as exc:
        logger.error("[admin] grammar service import failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Dịch vụ ngữ pháp tạm thời không khả dụng. Vui lòng thử lại.") from None

    all_slugs = set((grammar_service.articles_by_slug or {}).keys())
    title_by_slug = {
        s: (a.get("title") or s)
        for s, a in (grammar_service.articles_by_slug or {}).items()
    }
    cat_by_slug = {
        s: (a.get("category") or "")
        for s, a in (grammar_service.articles_by_slug or {}).items()
    }

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    views_per_slug: dict[str, int] = {}
    active_view_records_recent = 0
    analytics_status = {
        "views": "complete",
        "recent_activity": "complete",
        "saves": "complete",
    }
    try:
        view_rows = _grammar_article_metric_rows(
            "article_views", "article_slug,view_count,last_viewed_at", list(all_slugs)
        )
        for row in view_rows:
            s = row.get("article_slug")
            if not s:
                continue
            raw_count = row.get("view_count")
            if raw_count is None:
                raise ValueError("article_views.view_count is null")
            n = int(raw_count)
            if n < 0:
                raise ValueError("article_views.view_count is negative")
            views_per_slug[s] = views_per_slug.get(s, 0) + n
            last = row.get("last_viewed_at")
            if not last:
                analytics_status["recent_activity"] = "unavailable"
                continue
            try:
                viewed_at = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
                if viewed_at.tzinfo is None:
                    viewed_at = viewed_at.replace(tzinfo=timezone.utc)
                if viewed_at >= cutoff:
                    active_view_records_recent += 1
            except (TypeError, ValueError):
                analytics_status["recent_activity"] = "unavailable"
    except Exception as exc:
        logger.warning("[admin] grammar views fetch failed: %s", exc)
        analytics_status["views"] = "unavailable"
        analytics_status["recent_activity"] = "unavailable"

    saves_per_slug: dict[str, int] = {}
    try:
        for row in _grammar_article_metric_rows(
            "saved_articles", "article_slug", list(all_slugs)
        ):
            s = row.get("article_slug")
            if not s:
                continue
            saves_per_slug[s] = saves_per_slug.get(s, 0) + 1
    except Exception as exc:
        logger.warning("[admin] grammar saves fetch failed: %s", exc)
        analytics_status["saves"] = "unavailable"

    def _decorate(slug: str, count: int) -> dict:
        return {
            "slug":     slug,
            "title":    title_by_slug.get(slug, slug),
            "category": cat_by_slug.get(slug, ""),
            "count":    count,
        }

    top_viewed = sorted(views_per_slug.items(), key=lambda kv: (-kv[1], kv[0]))[:20]
    top_saved = sorted(saves_per_slug.items(), key=lambda kv: (-kv[1], kv[0]))[:5]

    seen_slugs = set(views_per_slug.keys())
    zero_view_slugs = sorted(all_slugs - seen_slugs)[:30]
    views_available = analytics_status["views"] == "complete"
    saves_available = analytics_status["saves"] == "complete"
    recent_available = analytics_status["recent_activity"] == "complete"

    return {
        "views_total":      sum(views_per_slug.values()) if views_available else None,
        "active_view_records_recent": active_view_records_recent if recent_available else None,
        "saves_total":      sum(saves_per_slug.values()) if saves_available else None,
        "articles_total":   len(all_slugs),
        "top_viewed":       [_decorate(s, c) for s, c in top_viewed] if views_available else None,
        "top_saved":        [_decorate(s, c) for s, c in top_saved] if saves_available else None,
        "zero_view_slugs":  [_decorate(s, 0) for s in zero_view_slugs] if views_available else None,
        "zero_view_total":  len(all_slugs - seen_slugs) if views_available else None,
        "days":             days,
        "analytics_status": analytics_status,
        "recent_activity_basis": "user_article_records_with_last_viewed_at_in_window",
    }


class GrammarRecommendPayload(BaseModel):
    issue: str = Field(..., min_length=1, max_length=2000)


@router.post("/grammar/recommend-test")
async def admin_grammar_recommend_test(
    payload: GrammarRecommendPayload,
    authorization: str | None = Header(default=None),
):
    """Dogfood tool — run the live grammar recommendation matcher
    against a synthetic issue string.

    Wraps `services.grammar_content.grammar_service.find_best_match()` —
    the same function that powers the post-grading recommendation
    surface. Returns the matched article + the matcher's score so Andy
    can preview quality before users see it.
    """
    await require_admin(authorization)

    try:
        from services.grammar_content import grammar_service
    except Exception as exc:
        logger.error("[admin] grammar service import failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Dịch vụ ngữ pháp tạm thời không khả dụng. Vui lòng thử lại.") from None

    issue = payload.issue.strip()
    if not issue:
        raise HTTPException(400, "issue must be non-empty")

    match = grammar_service.find_best_match(issue)
    if not match:
        return {"issue": issue, "outcome": "below_threshold", "match": None, "candidate": None}

    slug = match.get("slug")
    full = grammar_service.get_article_by_slug(slug or "")
    if not slug or not full:
        raise HTTPException(500, "matcher returned an article that is not in the canonical content index")
    category = full.get("category") or match.get("category")
    title = full.get("title") or match.get("title")
    score = match.get("score")
    if (
        not category
        or not title
        or isinstance(score, bool)
        or not isinstance(score, (int, float))
        or not math.isfinite(score)
        or score < 0
        or score > 1
    ):
        raise HTTPException(500, "matcher returned an incomplete recommendation contract")
    anchor = grammar_service.find_best_anchor(issue, slug)
    url = f"/grammar/{quote(str(category), safe='')}/{quote(str(slug), safe='')}"
    if anchor:
        url += f"#{quote(str(anchor), safe='')}"
    candidate = {
        "slug": slug,
        "category": category,
        "title": title,
        "score": score,
        "summary": full.get("summary"),
        "anchor": anchor,
        "status": full.get("status") or "complete",
        "url": url,
    }
    if candidate["status"] == "draft":
        return {
            "issue": issue,
            "outcome": "draft_suppressed",
            "match": None,
            "candidate": candidate,
        }
    return {
        "issue": issue,
        "outcome": "matched",
        "match": candidate,
        "candidate": candidate,
    }
