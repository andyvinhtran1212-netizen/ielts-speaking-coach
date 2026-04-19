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

from datetime import datetime, timedelta, timezone
from collections import Counter

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from database import supabase_admin
from routers.auth import get_supabase_user
from services.grammar_content import grammar_service


class ViewBody(BaseModel):
    viewed_from: str = "direct"
    session_id: str | None = None

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


@router.patch("/recommendations/{rec_id}/clicked")
async def mark_recommendation_clicked(
    rec_id: str,
    authorization: str | None = Header(default=None),
):
    """Mark a grammar recommendation as clicked by the user."""
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        result = (
            supabase_admin.table("grammar_recommendations")
            .update({
                "was_clicked": True,
                "clicked_at":  datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", rec_id)
            .eq("user_id", user_id)   # ownership guard
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi cập nhật recommendation: {e}")

    if not result.data:
        raise HTTPException(status_code=404, detail="Recommendation không tồn tại")

    return {"ok": True}


@router.get("/groups")
async def get_groups():
    """
    Return the 8 conceptual topic groups with enriched article lists.
    Each article has a resolved status: complete | updating | planned.
    Planned articles have no MD file yet — they should be shown but not linked.
    """
    return grammar_service.get_groups()


# ── User interaction endpoints (auth required) ────────────────────────────────

@router.post("/articles/{slug}/view")
async def track_article_view(
    slug: str,
    body: ViewBody,
    authorization: str | None = Header(default=None),
):
    """UPSERT a view record: increments view_count and updates last_viewed_at."""
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    # Resolve article metadata from in-memory service
    article = grammar_service.get_article_by_slug(slug)
    title    = article.get("title")    if article else None
    category = article.get("category") if article else None

    try:
        existing = (
            supabase_admin.table("article_views")
            .select("id, view_count")
            .eq("user_id", user_id)
            .eq("article_slug", slug)
            .execute()
        )
        now_iso = datetime.now(timezone.utc).isoformat()

        if existing.data:
            new_count = (existing.data[0].get("view_count") or 1) + 1
            supabase_admin.table("article_views").update({
                "view_count":    new_count,
                "last_viewed_at": now_iso,
                "viewed_from":   body.viewed_from,
            }).eq("id", existing.data[0]["id"]).execute()
        else:
            supabase_admin.table("article_views").insert({
                "user_id":         user_id,
                "article_slug":    slug,
                "article_title":   title,
                "article_category": category,
                "viewed_from":     body.viewed_from,
                "session_id":      body.session_id,
                "view_count":      1,
                "last_viewed_at":  now_iso,
            }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi track view: {e}")

    return {"ok": True}


@router.post("/articles/{slug}/save")
async def save_article(
    slug: str,
    authorization: str | None = Header(default=None),
):
    """Save an article for the user (idempotent)."""
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    article = grammar_service.get_article_by_slug(slug)
    title = article.get("title") if article else slug

    try:
        supabase_admin.table("saved_articles").upsert({
            "user_id":        user_id,
            "article_slug":   slug,
            "article_title":  title,
        }, on_conflict="user_id,article_slug").execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi lưu bài: {e}")

    return {"ok": True}


@router.delete("/articles/{slug}/save")
async def unsave_article(
    slug: str,
    authorization: str | None = Header(default=None),
):
    """Remove a saved article."""
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        supabase_admin.table("saved_articles").delete().eq(
            "user_id", user_id
        ).eq("article_slug", slug).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi xóa bài đã lưu: {e}")

    return {"ok": True}


@router.get("/dashboard-data")
async def get_dashboard_data(
    authorization: str | None = Header(default=None),
):
    """
    Return personalized grammar data for the dashboard:
      - grammar_focus_this_week: top-3 most-recommended article slugs in 14 days
      - weak_areas: slugs recommended ≥2 times in 30 days
      - recently_viewed: 5 most recently viewed articles
      - saved_articles: all saved articles
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    now = datetime.now(timezone.utc)
    t14 = (now - timedelta(days=14)).isoformat()
    t30 = (now - timedelta(days=30)).isoformat()

    # ── Fetch all data in parallel (sequential calls — Supabase client is sync) ─
    try:
        recs_14_res = (
            supabase_admin.table("grammar_recommendations")
            .select("recommended_slug, recommended_title, created_at")
            .eq("user_id", user_id)
            .gte("created_at", t14)
            .execute()
        )
        recs_30_res = (
            supabase_admin.table("grammar_recommendations")
            .select("recommended_slug, recommended_title, created_at")
            .eq("user_id", user_id)
            .gte("created_at", t30)
            .execute()
        )
        views_res = (
            supabase_admin.table("article_views")
            .select("article_slug, article_title, article_category, last_viewed_at")
            .eq("user_id", user_id)
            .order("last_viewed_at", desc=True)
            .limit(5)
            .execute()
        )
        saved_res = (
            supabase_admin.table("saved_articles")
            .select("article_slug, article_title, saved_at")
            .eq("user_id", user_id)
            .order("saved_at", desc=True)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi truy vấn dữ liệu: {e}")

    recs_14 = recs_14_res.data or []
    recs_30 = recs_30_res.data or []

    # ── grammar_focus_this_week ───────────────────────────────────────────────
    slug_counts_14 = Counter(r["recommended_slug"] for r in recs_14 if r.get("recommended_slug"))
    # Get viewed slugs to exclude articles already read
    viewed_slugs = {v["article_slug"] for v in (views_res.data or [])}

    grammar_focus = []
    for slug, count in slug_counts_14.most_common(10):
        if len(grammar_focus) >= 3:
            break
        article_info = grammar_service.get_article_by_slug(slug)
        if not article_info:
            continue
        # Get 2 related articles not yet viewed
        next_slugs = (article_info.get("next_articles") or [])[:3]
        related = []
        for ns in next_slugs:
            if ns not in viewed_slugs:
                na = grammar_service.get_article_by_slug(ns)
                if na:
                    related.append({"slug": ns, "title": na.get("title", ns), "category": na.get("category", "")})
            if len(related) >= 2:
                break
        # If not enough from next_articles, include the article itself if unviewed
        if slug not in viewed_slugs:
            related.insert(0, {"slug": slug, "title": article_info.get("title", slug), "category": article_info.get("category", "")})

        grammar_focus.append({
            "tag":           slug,
            "label_vi":      article_info.get("title", slug),
            "article_count": count,
            "articles":      related[:2],
        })

    # ── weak_areas ────────────────────────────────────────────────────────────
    slug_counts_30 = Counter(r["recommended_slug"] for r in recs_30 if r.get("recommended_slug"))
    # last_seen_at per slug
    last_seen: dict[str, str] = {}
    for r in recs_30:
        s = r.get("recommended_slug")
        if s and (s not in last_seen or r["created_at"] > last_seen[s]):
            last_seen[s] = r["created_at"]

    weak_areas = [
        {
            "tag":              slug,
            "label_vi":         (grammar_service.get_article_by_slug(slug) or {}).get("title", slug),
            "category":         (grammar_service.get_article_by_slug(slug) or {}).get("category", ""),
            "occurrence_count": cnt,
            "last_seen_at":     last_seen.get(slug),
        }
        for slug, cnt in slug_counts_30.most_common(5)
        if cnt >= 2
    ]

    # ── recently_viewed ───────────────────────────────────────────────────────
    recently_viewed = [
        {
            "slug":           v["article_slug"],
            "title":          v.get("article_title") or v["article_slug"],
            "category":       v.get("article_category") or "",
            "last_viewed_at": v["last_viewed_at"],
        }
        for v in (views_res.data or [])
    ]

    # ── saved_articles ────────────────────────────────────────────────────────
    saved_articles_list = [
        {
            "slug":     s["article_slug"],
            "title":    s.get("article_title") or s["article_slug"],
            "category": (grammar_service.get_article_by_slug(s["article_slug"]) or {}).get("category", ""),
            "saved_at": s["saved_at"],
        }
        for s in (saved_res.data or [])
    ]

    return {
        "grammar_focus_this_week": grammar_focus,
        "weak_areas":              weak_areas,
        "recently_viewed":         recently_viewed,
        "saved_articles":          saved_articles_list,
    }
