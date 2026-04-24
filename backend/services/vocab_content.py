"""
services/vocab_content.py — Vocabulary Wiki content loader

Scans backend/content_vocab/**/*.md, parses YAML frontmatter + Markdown body,
and exposes an in-memory index that the vocabulary router queries.

Intentionally separate from grammar_content.py — no shared base class.
Tech debt logged in TECH_DEBT_BACKLOG.md.

Loaded once at import time (module-level singleton `vocab_service`).
"""

import logging
import re
from pathlib import Path
from typing import Optional

import markdown
import yaml

logger = logging.getLogger(__name__)

CONTENT_DIR    = Path(__file__).parent.parent / "content_vocab"
CATEGORIES_FILE = CONTENT_DIR / "_categories.yaml"

_MD_EXTENSIONS  = ["tables", "fenced_code", "attr_list"]


class VocabContentService:
    def __init__(self):
        self.articles_by_slug:     dict[str, dict]       = {}
        self.articles_by_category: dict[str, list[dict]] = {}
        self.all_categories:       list[dict]            = []
        self.headword_index:       list[dict]            = []  # for prefix search
        self._valid_categories:    set[str]              = set()
        self._load_categories()
        self._load_all()

    # ── Category manifest ────────────────────────────────────────────────────

    def _load_categories(self) -> None:
        if not CATEGORIES_FILE.exists():
            logger.warning("[vocab] categories manifest not found: %s", CATEGORIES_FILE)
            return
        raw: dict = yaml.safe_load(CATEGORIES_FILE.read_text(encoding="utf-8")) or {}
        for cat in raw.get("categories", []):
            self._valid_categories.add(cat["slug"])

    # ── Loader ───────────────────────────────────────────────────────────────

    def _load_all(self) -> None:
        if not CONTENT_DIR.exists():
            logger.warning("[vocab] content dir not found: %s", CONTENT_DIR)
            return

        articles: list[dict] = []
        for md_file in sorted(CONTENT_DIR.rglob("*.md")):
            try:
                article = self._parse_file(md_file)
                if article:
                    articles.append(article)
            except Exception as exc:
                logger.error("[vocab] failed to parse %s: %s", md_file, exc)

        for a in articles:
            self.articles_by_slug[a["slug"]] = a
            self.articles_by_category.setdefault(a["category"], []).append(a)

        for cat in self.articles_by_category:
            self.articles_by_category[cat].sort(
                key=lambda x: x.get("headword", x["slug"])
            )

        # Build all_categories from manifest order (fall back to filesystem order)
        if self._valid_categories:
            raw = yaml.safe_load(CATEGORIES_FILE.read_text(encoding="utf-8")) or {}
            self.all_categories = []
            for cat_def in raw.get("categories", []):
                slug = cat_def["slug"]
                arts = self.articles_by_category.get(slug, [])
                self.all_categories.append({
                    "slug":          slug,
                    "title":         cat_def.get("title", _prettify(slug)),
                    "description":   cat_def.get("description", ""),
                    "article_count": len(arts),
                    "articles":      [self._summary(a) for a in arts],
                })
        else:
            self.all_categories = [
                {
                    "slug":          cat,
                    "title":         _prettify(cat),
                    "description":   "",
                    "article_count": len(arts),
                    "articles":      [self._summary(a) for a in arts],
                }
                for cat, arts in sorted(self.articles_by_category.items())
            ]

        # headword prefix-search index
        self.headword_index = [
            {
                "slug":     a["slug"],
                "category": a["category"],
                "headword": a["headword"],
            }
            for a in articles
        ]

        logger.info(
            "[vocab] loaded %d articles across %d categories",
            len(articles), len(self.all_categories),
        )

    def _parse_file(self, path: Path) -> Optional[dict]:
        raw = path.read_text(encoding="utf-8")

        if raw.startswith("---"):
            parts = raw.split("---", 2)
            fm_str = parts[1] if len(parts) >= 3 else ""
            body   = parts[2].strip() if len(parts) >= 3 else raw
        else:
            fm_str = ""
            body   = raw

        fm: dict = yaml.safe_load(fm_str) or {}

        # Required fields
        headword = fm.get("headword", "")
        slug     = fm.get("slug") or path.stem
        category = fm.get("category") or path.parent.name

        if not headword or not slug:
            logger.warning("[vocab] skipping %s — missing headword or slug", path)
            return None

        if self._valid_categories and category not in self._valid_categories:
            logger.warning("[vocab] skipping %s — category '%s' not in manifest", path, category)
            return None

        md_proc = markdown.Markdown(extensions=_MD_EXTENSIONS)
        html    = md_proc.convert(body)

        return {
            "headword":       headword,
            "slug":           slug,
            "category":       category,
            "level":          fm.get("level", ""),
            "part_of_speech": fm.get("part_of_speech", ""),
            "pronunciation":  fm.get("pronunciation", ""),
            "synonyms":       [str(x) for x in (fm.get("synonyms") or []) if x is not None],
            "antonyms":       [str(x) for x in (fm.get("antonyms") or []) if x is not None],
            "collocations":   [str(x) for x in (fm.get("collocations") or []) if x is not None],
            "related_words":  [str(x) for x in (fm.get("related_words") or []) if x is not None],
            "html":           html,
        }

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _summary(self, a: dict) -> dict:
        return {
            "slug":           a["slug"],
            "category":       a["category"],
            "headword":       a["headword"],
            "level":          a.get("level", ""),
            "part_of_speech": a.get("part_of_speech", ""),
            "pronunciation":  a.get("pronunciation", ""),
        }

    def _resolve_related(self, slugs: list[str]) -> list[dict]:
        out = []
        for s in slugs:
            a = self.articles_by_slug.get(s)
            if a:
                out.append({"slug": a["slug"], "headword": a["headword"], "category": a["category"]})
        return out

    # ── Public API ───────────────────────────────────────────────────────────

    def get_categories(self) -> list[dict]:
        return self.all_categories

    def get_all_articles(self) -> list[dict]:
        return [self._summary(a) for a in self.articles_by_slug.values()]

    def get_article(self, category: str, slug: str) -> Optional[dict]:
        a = self.articles_by_slug.get(slug)
        if not a or a["category"] != category:
            return None
        related = self._resolve_related(a.get("related_words") or [])
        return {**a, "related_words": related}

    def search_prefix(self, prefix: str) -> list[dict]:
        """Simple case-insensitive prefix match on headword."""
        if not prefix:
            return []
        q = prefix.lower()
        return [
            item for item in self.headword_index
            if item["headword"].lower().startswith(q)
        ][:20]


# ── Module-level helpers ─────────────────────────────────────────────────────

def _prettify(slug: str) -> str:
    return slug.replace("-", " ").title()


# ── Singleton ────────────────────────────────────────────────────────────────
vocab_service = VocabContentService()
