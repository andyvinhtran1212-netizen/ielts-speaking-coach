"""
services/grammar_content.py — Grammar Wiki content loader

Scans backend/content/**/*.md, parses YAML frontmatter + Markdown body,
and exposes an in-memory index that the grammar router queries.

Loaded once at import time (module-level singleton `grammar_service`).
"""

import logging
import re
from pathlib import Path
from typing import Optional

import markdown
import yaml

logger = logging.getLogger(__name__)

CONTENT_DIR = Path(__file__).parent.parent / "content"

_MD_EXTENSIONS   = ["tables", "fenced_code", "toc", "attr_list"]
_MD_EXT_CONFIGS  = {
    "toc": {
        "permalink": False,
        "toc_depth": "2-3",
    }
}


class GrammarContentService:
    def __init__(self):
        # ── Indexes ──────────────────────────────────────────────────────────
        self.articles_by_slug:     dict[str, dict]       = {}  # slug → full article
        self.articles_by_category: dict[str, list[dict]] = {}  # category → [article, …]
        self.all_categories:       list[dict]            = []
        self.search_index:         list[dict]            = []
        self._load_all()

    # ── Loader ───────────────────────────────────────────────────────────────

    def _load_all(self) -> None:
        if not CONTENT_DIR.exists():
            logger.warning("[grammar] content dir not found: %s", CONTENT_DIR)
            return

        articles: list[dict] = []
        for md_file in sorted(CONTENT_DIR.rglob("*.md")):
            try:
                article = self._parse_file(md_file)
                if article:
                    articles.append(article)
            except Exception as exc:
                logger.error("[grammar] failed to parse %s: %s", md_file, exc)

        # slug and category indexes
        for a in articles:
            self.articles_by_slug[a["slug"]] = a
            self.articles_by_category.setdefault(a["category"], []).append(a)

        # Sort each category by order, then title
        for cat in self.articles_by_category:
            self.articles_by_category[cat].sort(
                key=lambda x: (x.get("order", 999), x.get("title", ""))
            )

        # all_categories list (sorted alphabetically)
        self.all_categories = [
            {
                "slug":          cat,
                "title":         _prettify(cat),
                "article_count": len(arts),
                "articles":      [self._summary(a) for a in arts],
            }
            for cat, arts in sorted(self.articles_by_category.items())
        ]

        # search index (plain-text body for keyword matching)
        for a in articles:
            plain = re.sub(r"<[^>]+>", " ", a.get("html", ""))
            self.search_index.append({
                "slug":     a["slug"],
                "category": a["category"],
                "title":    a["title"],
                "summary":  a.get("summary", ""),
                "tags":     a.get("tags", []),
                "text":     plain.lower(),
            })

        logger.info(
            "[grammar] loaded %d articles across %d categories",
            len(articles), len(self.all_categories),
        )

    def _parse_file(self, path: Path) -> Optional[dict]:
        raw = path.read_text(encoding="utf-8")

        # Split YAML frontmatter from Markdown body
        if raw.startswith("---"):
            parts = raw.split("---", 2)
            fm_str = parts[1] if len(parts) >= 3 else ""
            body   = parts[2].strip() if len(parts) >= 3 else raw
        else:
            fm_str = ""
            body   = raw

        fm: dict = yaml.safe_load(fm_str) or {}

        slug     = fm.get("slug") or path.stem
        category = fm.get("category") or path.parent.name
        title    = fm.get("title") or _prettify(slug)

        # Render Markdown → HTML and capture TOC tokens
        md_proc = markdown.Markdown(
            extensions=_MD_EXTENSIONS,
            extension_configs=_MD_EXT_CONFIGS,
        )
        html       = md_proc.convert(body)
        toc_tokens = getattr(md_proc, "toc_tokens", [])
        toc        = _flatten_toc(toc_tokens)

        # Reading time: words in rendered HTML / 200 wpm
        word_count   = len(re.sub(r"<[^>]+>", " ", html).split())
        reading_time = max(1, round(word_count / 200))

        return {
            "slug":          slug,
            "category":      category,
            "title":         title,
            "summary":       (fm.get("summary") or "").strip(),
            "level":         fm.get("level", ""),
            "tags":          fm.get("tags") or [],
            "prerequisites": fm.get("prerequisites") or [],
            "related_pages": fm.get("related_pages") or [],
            "compare_with":  fm.get("compare_with") or [],
            "order":         fm.get("order", 999),
            "last_updated":  str(fm.get("last_updated", "")),
            "html":          html,
            "toc":           toc,
            "reading_time":  reading_time,
            "word_count":    word_count,
        }

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _summary(self, a: dict) -> dict:
        """Lightweight article card (no HTML body)."""
        return {
            "slug":         a["slug"],
            "category":     a["category"],
            "title":        a["title"],
            "summary":      a["summary"],
            "level":        a["level"],
            "tags":         a["tags"],
            "order":        a["order"],
            "reading_time": a["reading_time"],
            "last_updated": a["last_updated"],
        }

    def _resolve_related(self, slugs: list[str]) -> list[dict]:
        """Turn a list of slugs into [{slug, title, category}] objects."""
        out = []
        for s in slugs:
            a = self.articles_by_slug.get(s)
            if a:
                out.append({"slug": a["slug"], "title": a["title"], "category": a["category"]})
            else:
                # Slug not yet in content — return a stub so the frontend can still render a link
                out.append({"slug": s, "title": _prettify(s), "category": ""})
        return out

    # ── Public API ───────────────────────────────────────────────────────────

    def get_home_data(self) -> dict:
        """Home page: category overview + one featured article per category."""
        featured = []
        for arts in self.articles_by_category.values():
            if arts:
                featured.append(self._summary(arts[0]))

        return {
            "categories":        self.all_categories,
            "featured_articles": featured[:6],
            "total_articles":    len(self.articles_by_slug),
            "total_categories":  len(self.all_categories),
        }

    def get_article(self, category: str, slug: str) -> Optional[dict]:
        """Full article with HTML body, TOC, resolved related pages, and prev/next nav."""
        a = self.articles_by_slug.get(slug)
        if not a or a["category"] != category:
            return None

        # Resolve related_pages slugs → objects
        related = self._resolve_related(a["related_pages"])

        # Prev / next within the same category
        cat_list = self.articles_by_category.get(category, [])
        idx      = next((i for i, x in enumerate(cat_list) if x["slug"] == slug), -1)
        prev_art = self._summary(cat_list[idx - 1]) if idx > 0 else None
        next_art = self._summary(cat_list[idx + 1]) if idx < len(cat_list) - 1 else None

        return {
            **a,
            "related_pages": related,
            "prev_article":  prev_art,
            "next_article":  next_art,
        }

    def get_category(self, slug: str) -> Optional[dict]:
        """All article summaries for a category."""
        arts = self.articles_by_category.get(slug)
        if arts is None:
            return None
        return {
            "slug":     slug,
            "title":    _prettify(slug),
            "articles": [self._summary(a) for a in arts],
        }

    def search(self, query: str) -> list[dict]:
        """Keyword search across title, summary, tags, and body text."""
        q = query.lower().strip()
        if len(q) < 2:
            return []

        results = []
        for item in self.search_index:
            score = 0
            if q in item["title"].lower():                               score += 10
            if q in item["summary"].lower():                             score += 5
            if any(q in tag.lower() for tag in item.get("tags", [])):   score += 3
            if q in item["text"]:                                        score += 1
            if score:
                results.append((score, item))

        results.sort(key=lambda x: x[0], reverse=True)
        return [
            {
                "slug":     r["slug"],
                "category": r["category"],
                "title":    r["title"],
                "summary":  r["summary"],
            }
            for _, r in results[:20]
        ]

    def get_roadmap(self, slug: str) -> Optional[dict]:
        """Ordered article list for a category — used as a learning roadmap."""
        return self.get_category(slug)

    def get_compare(self, slug: str) -> Optional[dict]:
        """
        Return two articles side-by-side for comparison.

        slug format: '<article-a>-vs-<article-b>'
        Also falls back to looking for articles whose compare_with references match.
        """
        if "-vs-" in slug:
            left_slug, right_slug = slug.split("-vs-", 1)
            a1 = self.articles_by_slug.get(left_slug)
            a2 = self.articles_by_slug.get(right_slug)
            if a1 and a2:
                return {"slug": slug, "left": a1, "right": a2}

        # Fallback: scan compare_with fields
        for a in self.articles_by_slug.values():
            for compare_slug in a.get("compare_with", []):
                other = self.articles_by_slug.get(compare_slug)
                if other and (
                    slug == f"{a['slug']}-vs-{compare_slug}"
                    or slug == f"{compare_slug}-vs-{a['slug']}"
                ):
                    return {"slug": slug, "left": a, "right": other}

        return None


# ── Module-level helpers ─────────────────────────────────────────────────────

def _prettify(slug: str) -> str:
    return slug.replace("-", " ").title()


def _flatten_toc(tokens: list, depth: int = 0) -> list[dict]:
    """Recursively flatten toc_tokens into a flat list with depth."""
    result = []
    for t in tokens:
        result.append({"id": t.get("id", ""), "name": t.get("name", ""), "depth": depth})
        if t.get("children"):
            result.extend(_flatten_toc(t["children"], depth + 1))
    return result


# ── Singleton ────────────────────────────────────────────────────────────────
# Instantiated once when the module is first imported (at server startup).
grammar_service = GrammarContentService()
