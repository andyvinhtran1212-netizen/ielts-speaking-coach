"""
services/vocab_content.py — Vocabulary Wiki content loader

Scans backend/content_vocab/**/*.md, parses YAML frontmatter + Markdown body,
and exposes an in-memory index that the vocabulary router queries.

Intentionally separate from grammar_content.py — no shared base class.
Tech debt logged in TECH_DEBT_BACKLOG.md.

Loaded once at import time (module-level singleton `vocab_service`).

M3 (Slice-1) cutover: the words now live in the `vocab_cards` table (admin upload
persists there — Railway fs is ephemeral). _load_all() reads the table and builds
the SAME in-memory shapes; when the table is empty/unavailable it falls back to
the markdown content_vocab/** loader (G3 safety net for one release). reload()
rebuilds after an admin commit (G1); last_modified tracks MAX(updated_at) so the
public cache invalidates on new uploads (G2).
"""

import logging
import re
from datetime import datetime, timezone
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
        self.last_modified:        Optional[datetime]    = None  # G2: cache key (MAX updated_at)
        self._source:             str                    = "markdown"  # "db" | "markdown"
        self._load_categories()
        self._load_all()

    def reload(self) -> None:
        """G1 — rebuild the in-memory index from the source of truth. Called
        after an admin upload commits so a new word appears without a restart."""
        self.articles_by_slug = {}
        self.articles_by_category = {}
        self.all_categories = []
        self.headword_index = []
        self._valid_categories = set()
        self.last_modified = None
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
        # M3 cutover: prefer the vocab_cards table; fall back to markdown when the
        # table is empty OR unavailable (no DB at import in CI/tests) — G3 safety
        # net so a bad migrate-in (or a DB hiccup) never darks the live grid.
        articles = self._load_from_db()
        if articles is None:
            articles = self._load_from_markdown()
            self._source = "markdown"
            # markdown has no per-row timestamp → stamp "now" so the cache key is
            # at least stable within a process.
            if self.last_modified is None:
                self.last_modified = datetime.now(timezone.utc)
        else:
            self._source = "db"
        self._build_indexes(articles)
        logger.info(
            "[vocab] loaded %d articles across %d categories (source=%s)",
            len(articles), len(self.all_categories), self._source,
        )

    def _load_from_db(self) -> Optional[list[dict]]:
        """Read all words from vocab_cards → article dicts (same shape as
        _parse_file). Returns None when the table is empty OR the read fails, so
        the caller falls back to markdown (G3)."""
        try:
            from database import supabase_admin  # local import — keep module import-safe
            res = supabase_admin.table("vocab_cards").select("*").execute()
            rows = res.data or []
        except Exception as exc:  # noqa: BLE001 — any failure → markdown fallback
            logger.warning("[vocab] vocab_cards read failed (%s) — markdown fallback", exc)
            return None
        if not rows:
            return None
        # G2: cache key = MAX(updated_at).
        stamps = [r.get("updated_at") for r in rows if r.get("updated_at")]
        if stamps:
            try:
                self.last_modified = max(
                    datetime.fromisoformat(str(s).replace("Z", "+00:00")) for s in stamps)
            except Exception:  # noqa: BLE001
                self.last_modified = datetime.now(timezone.utc)
        return [self._row_to_article(r) for r in rows]

    @staticmethod
    def _row_to_article(r: dict) -> dict:
        """A vocab_cards row → the article dict shape get_article/_summary expect."""
        return {
            "headword":       r.get("headword", ""),
            "slug":           r.get("slug", ""),
            "category":       r.get("category", ""),
            "level":          r.get("level") or "",
            "part_of_speech": r.get("part_of_speech") or "",
            "pronunciation":  r.get("pronunciation") or "",
            "synonyms":       list(r.get("synonyms") or []),
            "antonyms":       list(r.get("antonyms") or []),
            "collocations":   list(r.get("collocations") or []),
            "related_words":  list(r.get("related_words") or []),
            "gloss_vi":       r.get("gloss_vi") or "",
            "definition_en":  r.get("definition_en") or "",
            "example":        r.get("example") or "",
            "html":           r.get("body_html") or "",
            # Slice-2 — pregenerated audio URLs (null until pregen stamps them; the
            # FE ▶ prefers these and falls back to speechSynthesis when absent).
            "audio_headword": r.get("audio_headword") or "",
            "audio_example":  r.get("audio_example") or "",
        }

    def _load_from_markdown(self) -> list[dict]:
        if not CONTENT_DIR.exists():
            logger.warning("[vocab] content dir not found: %s", CONTENT_DIR)
            return []
        articles: list[dict] = []
        for md_file in sorted(CONTENT_DIR.rglob("*.md")):
            try:
                article = self._parse_file(md_file)
                if article:
                    articles.append(article)
            except Exception as exc:
                logger.error("[vocab] failed to parse %s: %s", md_file, exc)
        return articles

    def _build_indexes(self, articles: list[dict]) -> None:
        for a in articles:
            self.articles_by_slug[a["slug"]] = a
            self.articles_by_category.setdefault(a["category"], []).append(a)

        for cat in self.articles_by_category:
            self.articles_by_category[cat].sort(
                key=lambda x: x.get("headword", x["slug"])
            )

        # Category-runtime (Slice-A): the category list is DISTINCT-from-DB — any
        # category present in the data surfaces, no yaml whitelist. Order is
        # deterministic: the yaml manifest first (so the original groups keep
        # their curated order + nice VN titles), then any NEW category not in the
        # manifest, alphabetically. Title = yaml override if present, else
        # _prettify(slug) — so a brand-new topic auto-surfaces with a readable
        # title and zero config (the word's category in frontmatter is enough).
        manifest_order: list[str] = []
        manifest_map: dict[str, dict] = {}
        if CATEGORIES_FILE.exists():
            raw = yaml.safe_load(CATEGORIES_FILE.read_text(encoding="utf-8")) or {}
            for cat_def in raw.get("categories", []):
                manifest_order.append(cat_def["slug"])
                manifest_map[cat_def["slug"]] = cat_def

        new_cats = sorted(set(self.articles_by_category) - set(manifest_order))
        # Yaml cats are emitted even when empty (backward-compat — the 6 original
        # groups always render); new cats appear once they have ≥1 word. The grid
        # filters empty sections client-side.
        self.all_categories = []
        for slug in manifest_order + new_cats:
            cat_def = manifest_map.get(slug, {})
            arts = self.articles_by_category.get(slug, [])
            self.all_categories.append({
                "slug":          slug,
                "title":         cat_def.get("title") or _prettify(slug),
                "description":   cat_def.get("description", ""),
                "article_count": len(arts),
                "articles":      [self._summary(a) for a in arts],
            })

        # headword prefix-search index
        self.headword_index = [
            {
                "slug":     a["slug"],
                "category": a["category"],
                "headword": a["headword"],
            }
            for a in articles
        ]

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
            # VE1 (word-library grid): a short VN gloss for the mini-card. The 20
            # words have NO structured VN field — the gloss is the body's first
            # paragraph (e.g. "**Tiên tiến nhất…** — …"), so extract it. A word
            # whose body has none just gets "" (never breaks).
            "gloss_vi":       _first_paragraph_text(body),
            # VE1 forward-compat for VC1 (Andy fills these later). ADDITIVE — a
            # word without the frontmatter key gets "" and no existing field changes.
            "definition_en":  str(fm.get("definition_en") or ""),
            "example":        str(fm.get("example") or ""),
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
            # VE1 — grid mini-card VN gloss (additive; existing summary fields unchanged).
            "gloss_vi":       a.get("gloss_vi", ""),
            # Slice-2 — pregenerated headword audio for the grid ▶ (empty until
            # pregen stamps it; markdown-fallback articles have no audio).
            "audio_headword": a.get("audio_headword", ""),
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


def _first_paragraph_text(body: str) -> str:
    """VE1 — the body's first real paragraph as PLAINTEXT, for the grid mini-card
    VN gloss. Skips headings (`#`) and blockquotes (`>`); strips markdown bold /
    italic / inline-code / links. Returns "" when the body has no paragraph."""
    for para in (body or "").split("\n\n"):
        p = para.strip()
        if not p or p.startswith("#") or p.startswith(">"):
            continue
        p = re.sub(r"\*\*([^*]+)\*\*", r"\1", p)      # **bold**
        p = re.sub(r"\*([^*]+)\*", r"\1", p)          # *italic*
        p = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", p)  # [text](link)
        p = p.replace("`", "")
        return re.sub(r"\s+", " ", p).strip()
    return ""


# ── Singleton ────────────────────────────────────────────────────────────────
vocab_service = VocabContentService()
