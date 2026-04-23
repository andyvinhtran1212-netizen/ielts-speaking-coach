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

CONTENT_DIR  = Path(__file__).parent.parent / "content"
GROUPS_FILE  = CONTENT_DIR / "_groups.yaml"

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
        self.articles_by_slug:      dict[str, dict]       = {}  # slug → full article
        self.articles_by_category:  dict[str, list[dict]] = {}  # category → [article, …]
        self.articles_by_error_tag: dict[str, list[dict]] = {}  # error_tag → [article, …]
        self.articles_by_pathway:   dict[str, list[dict]] = {}  # pathway → [article, …]
        self.all_categories:        list[dict]            = []
        self.search_index:          list[dict]            = []
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

        # slug, category, error_tag, and pathway indexes
        for a in articles:
            self.articles_by_slug[a["slug"]] = a
            self.articles_by_category.setdefault(a["category"], []).append(a)
            for tag in a.get("common_error_tags") or []:
                self.articles_by_error_tag.setdefault(tag, []).append(a)
            for pathway in a.get("pathways") or []:
                self.articles_by_pathway.setdefault(pathway, []).append(a)

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

        status = fm.get("status", "complete")
        # Normalise — only allow known values
        if status not in ("complete", "updating"):
            status = "complete"

        return {
            "slug":              slug,
            "category":          category,
            "title":             title,
            "summary":           (fm.get("summary") or "").strip(),
            "level":             fm.get("level", ""),
            "difficulty":        fm.get("difficulty", ""),
            "band_relevance":    fm.get("band_relevance") or [],
            "common_error_tags": [str(t) for t in (fm.get("common_error_tags") or []) if t is not None],
            "speaking_relevance": fm.get("speaking_relevance", ""),
            "writing_relevance": fm.get("writing_relevance", ""),
            "next_articles":     [str(t) for t in (fm.get("next_articles") or []) if t is not None],
            "pathways":          [str(t) for t in (fm.get("pathways") or []) if t is not None],
            "tags":              [str(t) for t in (fm.get("tags") or []) if t is not None],
            "prerequisites":     [str(t) for t in (fm.get("prerequisites") or []) if t is not None],
            "related_pages":     [str(t) for t in (fm.get("related_pages") or []) if t is not None],
            "compare_with":      [str(t) for t in (fm.get("compare_with") or []) if t is not None],
            "order":             fm.get("order", 999),
            "last_updated":      str(fm.get("last_updated", "")),
            "status":            status,
            "html":              html,
            "toc":               toc,
            "reading_time":      reading_time,
            "word_count":        word_count,
        }

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _summary(self, a: dict) -> dict:
        """Lightweight article card (no HTML body)."""
        return {
            "slug":              a["slug"],
            "category":         a["category"],
            "title":            a["title"],
            "summary":          a["summary"],
            "level":            a["level"],
            "difficulty":       a.get("difficulty", ""),
            "band_relevance":   a.get("band_relevance") or [],
            "speaking_relevance": a.get("speaking_relevance", ""),
            "writing_relevance": a.get("writing_relevance", ""),
            "pathways":         a.get("pathways") or [],
            "common_error_tags": a.get("common_error_tags") or [],
            "tags":             a["tags"],
            "next_articles":    a.get("next_articles") or [],
            "order":            a["order"],
            "reading_time":     a["reading_time"],
            "last_updated":     a["last_updated"],
            "status":           a.get("status", "complete"),
        }

    def _resolve_related(self, slugs: list[str]) -> list[dict]:
        """Turn a list of slugs into [{slug, title, category}] objects.
        Unresolved slugs are silently skipped — stubs with empty category
        produce broken links on the frontend.
        """
        out = []
        for s in slugs:
            a = self.articles_by_slug.get(s)
            if a:
                out.append({"slug": a["slug"], "title": a["title"], "category": a["category"]})
            # else: skip — unresolved slugs have no valid category and cannot be linked
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

        # Resolve related_pages and next_articles slugs → objects
        related       = self._resolve_related(a["related_pages"])
        next_articles = self._resolve_related(a.get("next_articles") or [])

        # Prev / next within the same category
        cat_list = self.articles_by_category.get(category, [])
        idx      = next((i for i, x in enumerate(cat_list) if x["slug"] == slug), -1)
        prev_art = self._summary(cat_list[idx - 1]) if idx > 0 else None
        next_art = self._summary(cat_list[idx + 1]) if idx < len(cat_list) - 1 else None

        return {
            **a,
            "related_pages":  related,
            "next_articles":  next_articles,
            "prev_article":   prev_art,
            "next_article":   next_art,
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

    def get_article_by_slug(self, slug: str) -> Optional[dict]:
        """Return article summary by slug alone (no category required)."""
        a = self.articles_by_slug.get(slug)
        return self._summary(a) if a else None

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
            if any(q in str(tag).lower() for tag in item.get("tags", []) if tag is not None):   score += 3
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

    def find_best_match(self, issue: str) -> dict | None:
        """
        Find the best-matching grammar wiki article for a Vietnamese grammar issue string.

        Uses keyword overlap scoring (no embeddings needed at this stage):
        - Title match scores highest
        - Tag match scores next
        - Body text match gives a small boost

        Vietnamese → English keyword mappings allow matching Claude's Vietnamese
        issue descriptions against English article titles/tags.

        Returns { slug, category, title, score } if best score > 0.35, else None.
        """
        if not issue or not self.search_index:
            return None

        issue_lower = issue.lower()

        # ── Direct slug map — known phrases bypass scoring entirely ─────────────
        # Ordered longest-first so longer phrases take priority over sub-phrases.
        _DIRECT_MAP: list[tuple[str, str]] = [
            ("dùng a thay vì an",  "articles-a-an-sound-rules"),
            ("dùng an thay vì a",  "articles-a-an-sound-rules"),
            ("a thay vì an",       "articles-a-an-sound-rules"),
            ("an thay vì a",       "articles-a-an-sound-rules"),
            ("sai a/an",           "articles-a-an-sound-rules"),
            ("âm đầu",             "articles-a-an-sound-rules"),
            ("missing determiner", "article-errors"),
            ("thiếu mạo từ",       "article-errors"),
            ("sai thì",            "tense-consistency"),
        ]
        for phrase, target_slug in _DIRECT_MAP:
            if phrase in issue_lower:
                item = next((x for x in self.search_index if x["slug"] == target_slug), None)
                if item:
                    return {
                        "slug":     item["slug"],
                        "category": item["category"],
                        "title":    item["title"],
                        "score":    1.0,
                    }
                break  # phrase matched but slug missing from index — fall through

        # ── Vietnamese → English keyword map ────────────────────────────────────
        # Each Vietnamese term maps to one or more English tokens to search for.
        _VI_EN: list[tuple[str, list[str]]] = [
            # Tenses
            ("quá khứ đơn",          ["past simple", "simple past"]),
            ("hiện tại đơn",         ["present simple", "simple present"]),
            ("hiện tại tiếp diễn",   ["present continuous", "present progressive"]),
            ("quá khứ tiếp diễn",    ["past continuous", "past progressive"]),
            ("hiện tại hoàn thành",  ["present perfect"]),
            ("quá khứ hoàn thành",   ["past perfect"]),
            ("tương lai",            ["future", "will", "going to"]),
            # Articles
            ("mạo từ",               ["article", "articles"]),
            ("thiếu the",            ["article", "the"]),
            ("thiếu a",              ["article", "a", "an"]),
            # Subject-verb
            ("chủ ngữ",              ["subject"]),
            ("chủ vị",               ["subject verb"]),
            ("động từ",              ["verb"]),
            ("chia động từ",         ["subject verb agreement", "verb form"]),
            # Prepositions
            ("giới từ",              ["preposition", "prepositions"]),
            # Conditionals
            ("câu điều kiện",        ["conditional", "conditionals", "if clause"]),
            # Relative clauses
            ("mệnh đề quan hệ",      ["relative clause", "relative clauses", "who which"]),
            ("mệnh đề",              ["clause"]),
            # Passive
            ("bị động",              ["passive", "passive voice"]),
            # Countable/uncountable
            ("danh từ đếm được",     ["countable", "uncountable", "noun"]),
            ("danh từ không đếm",    ["uncountable", "noun"]),
            ("danh từ",              ["noun", "nouns"]),
            # Plural
            ("số nhiều",             ["plural", "plurals"]),
            # Modals
            ("động từ khuyết thiếu", ["modal", "modals", "can could"]),
            ("can",                  ["modal", "can could"]),
            ("should",               ["modal", "should"]),
            ("must",                 ["modal", "must have to"]),
            # Comparison
            ("so sánh",              ["comparison", "comparative", "superlative"]),
            # Collocation / vocabulary
            ("collocation",          ["collocation", "collocations"]),
            ("từ vựng",              ["vocabulary", "word choice"]),
            ("lặp từ",               ["vocabulary", "word choice", "repetition"]),
            # Linking words
            ("từ nối",               ["discourse", "markers", "cohesion", "linking"]),
            ("liên từ",              ["conjunction", "conjunctions", "linking"]),
            # Pronouns
            ("đại từ",               ["pronoun", "pronouns"]),
            # Word order
            ("trật tự từ",           ["word order"]),
            # Gerund/infinitive
            ("danh động từ",         ["gerund", "gerund infinitive"]),
            ("to-infinitive",        ["infinitive", "gerund infinitive"]),
            # Sentence completeness / fragments
            ("thiếu động từ chính",  ["verb", "main verb", "missing", "sentence-structure"]),
            ("thiếu chủ ngữ",        ["subject", "sentence-structure"]),
            ("câu không hoàn chỉnh", ["sentence-structure"]),
            ("cấu trúc câu",         ["sentence-structure", "clause", "compound"]),
            # Generic tense errors
            ("sai thì",              ["tense", "verb tense", "tenses"]),
            ("thì động từ",          ["tense", "verb tense", "tenses"]),
            # Cohesion / linking
            ("thiếu từ nối",         ["discourse", "markers", "cohesion", "linking"]),
            ("thiếu liên từ",        ["conjunction", "linking"]),
            # Article a/an sound-rule errors
            ("dùng a thay vì an",    ["sound", "a-an", "articles"]),
            ("a thay vì an",         ["sound", "a-an", "articles"]),
            ("an thay vì a",         ["sound", "a-an", "articles"]),
            ("dùng an thay vì a",    ["sound", "a-an", "articles"]),
            ("sai a/an",             ["sound", "a-an", "articles"]),
            # Missing determiner
            ("missing determiner",   ["article", "articles", "determiner"]),
        ]

        # Build extra search tokens from the issue text via the mapping
        extra_tokens: list[str] = []
        for vi_term, en_terms in _VI_EN:
            if vi_term in issue_lower:
                extra_tokens.extend(en_terms)

        # Also include raw issue words (catches English terms Claude might include,
        # e.g. "past simple", "the", slug-like words)
        raw_words = re.findall(r"[a-z]{3,}", issue_lower)

        all_tokens = set(extra_tokens + raw_words)
        if not all_tokens:
            return None

        best_score = 0.0
        best_item: dict | None = None

        for item in self.search_index:
            title_lower = item["title"].lower()
            tags_lower  = " ".join(str(t) for t in item.get("tags", []) if t is not None).lower()
            body_text   = item["text"]  # already lowercased at load time

            title_score = 0.0
            tag_score   = 0.0
            body_score  = 0.0
            for token in all_tokens:
                if token in title_lower: title_score += 0.5
                if token in tags_lower:  tag_score   += 0.3
                if token in body_text:   body_score  += 0.05

            # Require at least one title or tag hit — discard body-only matches
            if title_score == 0.0 and tag_score == 0.0:
                continue

            score = min(1.0, (title_score + tag_score + body_score) / max(len(all_tokens), 1))

            if score > best_score:
                best_score = score
                best_item = item

        if best_score < 0.35 or best_item is None:
            return None

        return {
            "slug":     best_item["slug"],
            "category": best_item["category"],
            "title":    best_item["title"],
            "score":    round(best_score, 3),
        }

    def get_articles_by_error_tag(self, tag: str) -> list[dict]:
        """Return article summaries that address a specific common_error_tag."""
        arts = self.articles_by_error_tag.get(tag, [])
        return [self._summary(a) for a in arts]

    def get_articles_by_pathway(self, pathway: str) -> list[dict]:
        """Return article summaries for a given learning pathway slug."""
        arts = self.articles_by_pathway.get(pathway, [])
        return [self._summary(a) for a in arts]

    def get_groups(self) -> list[dict]:
        """
        Return the 8 conceptual groups from _groups.yaml, each enriched with
        per-article status resolved from the live article index.

        Article statuses:
          - 'complete'  — MD file exists, status=complete
          - 'updating'  — MD file exists, status=updating
          - 'planned'   — listed in manifest but no MD file yet (not linked)
        """
        if not GROUPS_FILE.exists():
            logger.warning("[grammar] groups manifest not found: %s", GROUPS_FILE)
            return []

        raw: dict = yaml.safe_load(GROUPS_FILE.read_text(encoding="utf-8")) or {}
        result: list[dict] = []

        for g in raw.get("groups", []):
            enriched: list[dict] = []
            complete_count = 0

            for art in g.get("articles", []):
                slug     = art["slug"]
                category = art["category"]
                title    = art.get("title", _prettify(slug))
                existing = self.articles_by_slug.get(slug)

                if existing:
                    status = existing.get("status", "complete")
                    if status == "complete":
                        complete_count += 1
                    enriched.append({
                        "slug":         slug,
                        "category":     existing["category"],
                        "title":        existing["title"],
                        "level":        existing.get("level", ""),
                        "status":       status,
                        "reading_time": existing.get("reading_time", 1),
                        "summary":      existing.get("summary", ""),
                    })
                else:
                    enriched.append({
                        "slug":         slug,
                        "category":     category,
                        "title":        title,
                        "level":        "",
                        "status":       "planned",
                        "reading_time": None,
                        "summary":      "",
                    })

            result.append({
                "slug":           g["slug"],
                "title":          g["title"],
                "description":    g.get("description", ""),
                "color":          g.get("color", "teal"),
                "article_count":  len(enriched),
                "complete_count": complete_count,
                "articles":       enriched,
            })

        logger.info("[grammar] loaded %d groups", len(result))
        return result

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
