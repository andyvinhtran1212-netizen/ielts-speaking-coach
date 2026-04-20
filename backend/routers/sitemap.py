"""
routers/sitemap.py — Grammar Wiki XML sitemap

GET /sitemap-grammar.xml
  Returns a valid XML sitemap with one <url> per published grammar article.
  Planned/stub articles (no MD file) are excluded.
  Media type: application/xml
"""

from datetime import date
from xml.sax.saxutils import escape

from fastapi import APIRouter
from fastapi.responses import Response

from services.grammar_content import grammar_service

router = APIRouter(tags=["sitemap"])

_BASE = "https://averlearning.com"
_TODAY = date.today().isoformat()


@router.get("/sitemap-grammar.xml", include_in_schema=False)
async def grammar_sitemap():
    """XML sitemap for all published Grammar Wiki articles."""
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]

    for slug, article in grammar_service.articles_by_slug.items():
        # Skip stubs / planned articles (no HTML body generated)
        if article.get("status") == "planned":
            continue

        category = escape(article.get("category", ""))
        safe_slug = escape(slug)
        loc = f"{_BASE}/grammar/{category}/{safe_slug}"

        last_mod = article.get("last_updated") or _TODAY

        lines.append("  <url>")
        lines.append(f"    <loc>{loc}</loc>")
        lines.append(f"    <lastmod>{last_mod}</lastmod>")
        lines.append("    <changefreq>monthly</changefreq>")
        lines.append("    <priority>0.7</priority>")
        lines.append("  </url>")

    lines.append("</urlset>")

    return Response(
        content="\n".join(lines),
        media_type="application/xml",
    )
