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
MAPPING_FILE = CONTENT_DIR / "feedback-anchor-mapping.yaml"

_MD_EXTENSIONS   = ["tables", "fenced_code", "toc", "attr_list"]
_MD_EXT_CONFIGS  = {
    "toc": {
        "permalink": False,
        "toc_depth": "2-3",
    }
}

# Matches deep-link anchor markers in article bodies. Captures the anchor
# id (kebab-dot ASCII per the convention pinned in test_anchor_drift.py).
# Used in `_parse_file` to convert markers into clickable `<a id>` tags.
_ANCHOR_MARKER_RE = re.compile(r"<!--\s*anchor:\s*([\w.\-]+)\s*-->")

# Score floor for both `find_best_match` (slug routing) and
# `find_best_anchor` (anchor selection within a slug). Sprint 6.6 logs
# revealed Vietnamese AI feedback strings score 0.18-0.30 against
# English mapping keywords, so the original 0.35 floor was rejecting
# semantically valid matches. Sprint 6.7 lowered to 0.20 — false-
# positive guard tests in test_grammar_matcher_threshold.py pin the
# behaviour for unrelated topics (pronunciation / vocab / fluency).
_MATCH_THRESHOLD = 0.20

# Vietnamese function-word filter: a handful of standalone ASCII
# Vietnamese words pass `\b[a-z]{3,}\b` but carry no routing signal —
# they hit mapping haystacks via substring (e.g. "trong" is in "wrong"
# / "strong" / Vietnamese summaries; "sai" is in most error-pattern
# keywords). Drop them so they don't compete with curated tokens.
# Shared between find_best_match (Sprint 7c) and find_best_anchor
# (Sprint 7c.1).
_VN_STOP_TOKENS = frozenset({
    "trong",  # in/inside (preposition)
    "sai",    # wrong (modifier — bleeds into all error mappings)
    "thay",   # instead/replace
    "khi",    # when
    "kia",    # that one
})

# Sprint 7c.2: AI feedback often quotes student errors verbatim, e.g.:
#   "Sai cấu trúc động từ — 'can uh success in' không hợp lệ"
# The quoted English fragment is the broken student English, NOT the
# grammar topic. Words like "can" / "should" / "must" inside such
# quotes triggered _VI_EN expansions ("can" → ["modal", "can could"])
# AND raw_words extractions ("can" hits M023 keyword "can to V"
# directly), both biasing routing to modal-verbs.
#
# Heuristic: strip quoted phrases of >=3 words (likely a student-
# error sample) from issue text before tokenization. Short quotes —
# 1-2 words — are typically topic names like 'past simple' /
# 'present perfect' and remain in the text so they contribute to
# article keyword matching.
_QUOTED_PHRASE_RE = re.compile(r"['\u2018\u2019]([^'\u2018\u2019]*)['\u2018\u2019]")
_QUOTED_PHRASE_MIN_WORDS_TO_STRIP = 3


def _strip_long_quoted_phrases(text: str) -> str:
    """Replace quoted phrases of `_QUOTED_PHRASE_MIN_WORDS_TO_STRIP`+
    words with a space. Short quotes (≤2 words, e.g. topic names)
    are left in place."""
    def repl(m: re.Match) -> str:
        inside = m.group(1)
        if len(inside.split()) >= _QUOTED_PHRASE_MIN_WORDS_TO_STRIP:
            return " "
        # Preserve original quoted token so raw-word + VI_EN scans see it.
        return m.group(0)
    return _QUOTED_PHRASE_RE.sub(repl, text)


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
            if "_archive" in md_file.parts:
                continue
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
        # Convert anchor markers `<!-- anchor: ID -->` (preserved verbatim
        # by the markdown parser) into clickable HTML anchor tags so URL
        # hash deep-linking works (`/grammar/.../slug#ID` → browser scrolls).
        html = _ANCHOR_MARKER_RE.sub(
            r'<a id="\1" class="grammar-anchor"></a>', html,
        )
        toc_tokens = getattr(md_proc, "toc_tokens", [])
        toc        = _flatten_toc(toc_tokens)

        # Reading time: words in rendered HTML / 200 wpm
        word_count   = len(re.sub(r"<[^>]+>", " ", html).split())
        reading_time = max(1, round(word_count / 200))

        status = str(fm.get("status", "complete") or "complete").strip().lower()
        # Preserve canonical editorial states so downstream callers can make
        # honest visibility decisions (e.g. avoid recommending draft content).
        if status not in ("complete", "updating", "draft"):
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
            # Sprint 4 Phase 3: expose declared deep-link anchors so the
            # AI feedback matcher (Phase 4) can resolve issue → anchor at
            # runtime against the article's own anchor inventory.
            "anchors":           [
                {"id": a.get("id"), "location": a.get("location", ""), "type": a.get("type", "")}
                for a in (fm.get("anchors") or [])
                if a.get("id")
            ],
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

        Sprint 7c rework — three-tier scoring, mapping-keywords-first:
          Tier 1: feedback_keywords + user_phrase_examples + summary
                  from feedback-anchor-mapping.yaml entries grouped by
                  slug. Curated, primary signal — picks up Vietnamese
                  issue strings that English titles miss.
          Tier 2: article title + tags (semantic fallback). Halved
                  weight so a strong Tier 1 mapping match outranks a
                  tag-only article without curated coverage.
          Tier 3: article body — REMOVED. Body word frequency was the
                  Sprint 7b production routing bug source ("am",
                  "tired" winning unrelated articles like modal-verbs
                  whose example sentences happened to contain the
                  same common English words).

        Per-slug score = max(tier_1, tier_2 * 0.5). The article in
        `search_index` is looked up from the winning slug. Returns
        { slug, category, title, score } if best score >=
        _MATCH_THRESHOLD, else None.
        """
        # Sprint 6.5 diagnostic: every return path logs an event so the
        # canary tells us *which* branch fired (direct-map / threshold-fail
        # / score-pass / no-tokens / no-input). Logs are plain-text-greppable
        # AND carry an `extra` dict for any future structured aggregator.
        issue_preview = (issue or "")[:160]
        if not issue or not self.search_index:
            logger.info(
                "matcher_match event=skipped reason=empty_input issue=%r matched=False",
                issue_preview,
                extra={"event": "matcher_match", "reason": "empty_input",
                       "issue": issue_preview, "matched": False},
            )
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
                    logger.info(
                        "matcher_match event=hit path=direct_map issue=%r matched_slug=%s score=1.0",
                        issue_preview, item["slug"],
                        extra={"event": "matcher_match", "path": "direct_map",
                               "issue": issue_preview, "matched_slug": item["slug"],
                               "score": 1.0, "matched": True},
                    )
                    return {
                        "slug":     item["slug"],
                        "category": item["category"],
                        "title":    item["title"],
                        "score":    1.0,
                    }
                logger.info(
                    "matcher_match event=skipped reason=direct_map_slug_missing "
                    "phrase=%r expected_slug=%s issue=%r",
                    phrase, target_slug, issue_preview,
                    extra={"event": "matcher_match",
                           "reason": "direct_map_slug_missing",
                           "phrase": phrase, "expected_slug": target_slug,
                           "issue": issue_preview, "matched": False},
                )
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
            # Sprint 7d — Codex AMBER 2026-05-05: AI feedback often phrases
            # the same fragment-shape as "không có động từ" instead of
            # "thiếu động từ" (negation vs. lack-of). Without this entry,
            # cleaned issues like "câu không có động từ chính" produce only
            # the single token "verb" via the broader "động từ" trigger,
            # leaving 9 slugs tied at 1.0 and dict-order picking
            # present-simple over missing-main-verbs (M050). Same expansion
            # as the "thiếu động từ chính" line above so M050's keywords
            # ("missing main verb", "main verb missing", "sentence-structure")
            # all hit, breaking the tie cleanly (1.0 vs 0.5).
            ("không có động từ",     ["verb", "main verb", "missing", "sentence-structure"]),
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

        # Sprint 7c.2: AI feedback often embeds the student's broken
        # English in single quotes (e.g. "'can uh success in'"). The
        # words inside are the error being corrected, not the grammar
        # topic — but words like "can" / "should" / "must" used to
        # trigger BOTH _VI_EN expansion ("can" → ["modal", ...]) and
        # raw_words extraction ("can" hits M023 keyword "can to V"
        # directly), biasing routing toward modal-verbs.
        #
        # Strip quoted phrases of ≥3 words (long enough to be a
        # student-error sample) from BOTH the VI_EN scan input AND
        # the raw_words extraction input. Short quotes (≤2 words,
        # typically topic names like 'past simple') are kept in place
        # so they continue contributing to article matching.
        cleaned_issue = _strip_long_quoted_phrases(issue_lower)

        extra_tokens: list[str] = []
        for vi_term, en_terms in _VI_EN:
            if vi_term in cleaned_issue:
                extra_tokens.extend(en_terms)

        # Also include raw issue words (catches English terms Claude might include,
        # e.g. "past simple", "the", slug-like words). The `\b...\b` word-
        # boundary anchors are critical: without them, `[a-z]{3,}` chops
        # accented Vietnamese into 3-char ASCII fragments — e.g. "thiếu"
        # yields "thi", which then substring-matches "this" / "thing" /
        # "third" across most mapping haystacks and causes the Sprint 7c
        # production routing bug. With `\b`, only fully-ASCII standalone
        # words pass.
        raw_words = [
            w for w in re.findall(r"\b[a-z]{3,}\b", cleaned_issue)
            if w not in _VN_STOP_TOKENS
        ]

        all_tokens = set(extra_tokens + raw_words)
        if not all_tokens:
            logger.info(
                "matcher_match event=skipped reason=no_tokens issue=%r matched=False",
                issue_preview,
                extra={"event": "matcher_match", "reason": "no_tokens",
                       "issue": issue_preview, "matched": False},
            )
            return None

        token_count = max(len(all_tokens), 1)
        slug_scores: dict[str, float] = {}

        # Pre-compile word-boundary token patterns. Each token must match
        # at a word START in the haystack — `\btoken` (start anchor only,
        # no end). This rejects spurious substring hits like "refer" in
        # "prefer" or "her" in "there", while still allowing "verb" to
        # match "verbs" (suffix-permissive).
        token_patterns = {
            tok: re.compile(rf"\b{re.escape(tok)}", re.IGNORECASE)
            for tok in all_tokens
        }

        def _count_hits(haystack: str) -> int:
            return sum(1 for pat in token_patterns.values() if pat.search(haystack))

        # ── Tier 1: mapping keywords + examples + summary ──────────────────
        # `_load_mappings()` is keyed by slug and already drops
        # `deferred_until` entries, so this loop scores only active,
        # currently-loaded mappings against the issue tokens.
        for slug, mappings in self._load_mappings().items():
            best_for_slug = 0.0
            for m in mappings:
                haystack_parts: list[str] = []
                haystack_parts.extend(
                    str(k).lower() for k in (m.get("feedback_keywords") or [])
                )
                haystack_parts.extend(
                    str(p).lower() for p in (m.get("user_phrase_examples") or [])
                )
                haystack_parts.append(str(m.get("feedback_pattern_summary", "")).lower())
                haystack = " | ".join(haystack_parts)

                hits = _count_hits(haystack)
                if hits == 0:
                    continue
                score = min(1.0, hits / token_count)
                if score > best_for_slug:
                    best_for_slug = score
            if best_for_slug > 0.0:
                slug_scores[slug] = best_for_slug

        # ── Tier 2: article title + tags (halved weight) ───────────────────
        # Only competes when Tier 1 score for the same slug is weaker, OR
        # when the slug has no mapping at all (preserves title-fallback
        # routing for the ~70 articles still without curated mappings).
        # Body text deliberately excluded — was the Sprint 7b bug source.
        # Same word-boundary token matching as Tier 1.
        for item in self.search_index:
            slug = item["slug"]
            title_lower = item["title"].lower()
            tags_lower  = " ".join(
                str(t) for t in item.get("tags", []) if t is not None
            ).lower()

            title_score = 0.0
            tag_score   = 0.0
            for tok, pat in token_patterns.items():
                if pat.search(title_lower): title_score += 0.5
                if pat.search(tags_lower):  tag_score   += 0.3
            if title_score == 0.0 and tag_score == 0.0:
                continue

            tier_2 = min(1.0, (title_score + tag_score) / token_count)
            existing = slug_scores.get(slug, 0.0)
            slug_scores[slug] = max(existing, tier_2 * 0.5)

        # ── Pick winner ────────────────────────────────────────────────────
        if not slug_scores:
            logger.info(
                "matcher_match event=skipped reason=below_threshold "
                "issue=%r best_score=%.3f threshold=%.2f matched=False",
                issue_preview, 0.0, _MATCH_THRESHOLD,
                extra={"event": "matcher_match", "reason": "below_threshold",
                       "issue": issue_preview, "best_score": 0.0,
                       "threshold": _MATCH_THRESHOLD, "matched": False},
            )
            return None

        best_slug = max(slug_scores, key=slug_scores.get)
        best_score = slug_scores[best_slug]

        if best_score < _MATCH_THRESHOLD:
            logger.info(
                "matcher_match event=skipped reason=below_threshold "
                "issue=%r best_score=%.3f threshold=%.2f matched=False",
                issue_preview, best_score, _MATCH_THRESHOLD,
                extra={"event": "matcher_match", "reason": "below_threshold",
                       "issue": issue_preview, "best_score": round(best_score, 3),
                       "threshold": _MATCH_THRESHOLD, "matched": False},
            )
            return None

        best_item = next(
            (x for x in self.search_index if x["slug"] == best_slug), None
        )
        if best_item is None:
            # Mapping references a slug whose article isn't indexed (deploy
            # skew, file removed, etc.). Treat as no-match — never return a
            # broken slug to callers.
            logger.info(
                "matcher_match event=skipped reason=slug_missing_from_index "
                "best_slug=%s best_score=%.3f matched=False",
                best_slug, best_score,
                extra={"event": "matcher_match",
                       "reason": "slug_missing_from_index",
                       "best_slug": best_slug,
                       "best_score": round(best_score, 3),
                       "matched": False},
            )
            return None

        logger.info(
            "matcher_match event=hit path=score issue=%r matched_slug=%s score=%.3f",
            issue_preview, best_slug, best_score,
            extra={"event": "matcher_match", "path": "score",
                   "issue": issue_preview, "matched_slug": best_slug,
                   "score": round(best_score, 3), "matched": True},
        )
        return {
            "slug":     best_slug,
            "category": best_item["category"],
            "title":    best_item["title"],
            "score":    round(best_score, 3),
        }

    # ── Anchor resolution (Sprint 4 Phase 4) ────────────────────────────
    # Lazy-loaded mapping file index: target_slug → list of mappings.
    # Mappings with `deferred_until` set are skipped defensively even
    # though Sprint 3 resolved all current deferrals — protects against
    # future mappings shipped before their target anchors land.
    _mappings_by_slug: dict[str, list[dict]] | None = None

    def _load_mappings(self) -> dict[str, list[dict]]:
        if self._mappings_by_slug is not None:
            return self._mappings_by_slug
        idx: dict[str, list[dict]] = {}
        if not MAPPING_FILE.exists():
            self._mappings_by_slug = idx
            return idx
        try:
            data = yaml.safe_load(MAPPING_FILE.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc:
            logger.warning("[grammar] mapping file unparseable, anchor resolution disabled: %s", exc)
            self._mappings_by_slug = idx
            return idx
        for m in data.get("mappings") or []:
            if m.get("deferred_until"):
                continue  # defensive: skip even when drift gate would catch it
            target_file = m.get("target_file") or ""
            slug = Path(target_file).stem if target_file else None
            if not slug:
                continue
            idx.setdefault(slug, []).append(m)
        self._mappings_by_slug = idx
        return idx

    def find_best_anchor(self, issue: str, slug: str) -> str | None:
        """Resolve the best-matching anchor id within the given article
        slug for a Vietnamese grammar issue string.

        Scoring: keyword overlap of issue tokens against each mapping's
        `feedback_keywords[]` + `user_phrase_examples[]`. Shares the
        `_MATCH_THRESHOLD` floor with `find_best_match` for consistency.
        Returns None when no mapping resolves above threshold for this
        slug.
        """
        # Sprint 6.5 diagnostic: every branch logs an event so the canary
        # tells us whether (a) we never even reached the scoring loop,
        # (b) the slug had no mappings loaded, (c) tokens couldn't be
        # extracted, (d) the best score fell below threshold, or (e) the
        # success path fired.
        issue_preview = (issue or "")[:160]
        if not issue or not slug:
            logger.info(
                "anchor_resolve event=skipped reason=empty_input "
                "issue=%r slug=%s matched=False",
                issue_preview, slug,
                extra={"event": "anchor_resolve", "reason": "empty_input",
                       "issue": issue_preview, "slug": slug, "matched": False},
            )
            return None
        mappings = self._load_mappings().get(slug)
        if not mappings:
            logger.info(
                "anchor_resolve event=skipped reason=no_mappings_for_slug "
                "issue=%r slug=%s matched=False",
                issue_preview, slug,
                extra={"event": "anchor_resolve",
                       "reason": "no_mappings_for_slug",
                       "issue": issue_preview, "slug": slug, "matched": False},
            )
            return None

        # Sprint 7c.1: mirror find_best_match's hardening — stop-word
        # filter + word-boundary haystack matching. Unlike find_best_match
        # (which relies on `_VI_EN` expansion to surface English search
        # terms), this layer's job is anchor selection within an already-
        # routed slug, so Vietnamese tokens directly substring-matching
        # Vietnamese keyword chunks ("sai thì", "thiếu chủ ngữ") is the
        # primary signal. Keep the Unicode `\w`-aware regex but anchor it
        # at word boundaries so accent-stripped fragments don't leak in.
        issue_lower = issue.lower()
        issue_tokens = {
            w for w in re.findall(r"\b[\w]{3,}\b", issue_lower, flags=re.UNICODE)
            if w not in _VN_STOP_TOKENS
        }
        if not issue_tokens:
            logger.info(
                "anchor_resolve event=skipped reason=no_tokens "
                "issue=%r slug=%s matched=False",
                issue_preview, slug,
                extra={"event": "anchor_resolve", "reason": "no_tokens",
                       "issue": issue_preview, "slug": slug, "matched": False},
            )
            return None

        # Pre-compile word-boundary patterns — `\btoken` (start anchor
        # only) so suffixes still match (e.g. \bverb matches "verbs")
        # but prefix-only matches like "refer" inside "prefer" are
        # rejected.
        token_patterns = {
            tok: re.compile(rf"\b{re.escape(tok)}", re.IGNORECASE)
            for tok in issue_tokens
        }

        best_score = 0.0
        best_anchor: str | None = None

        for m in mappings:
            haystack_parts: list[str] = []
            haystack_parts.extend(str(k).lower() for k in (m.get("feedback_keywords") or []))
            haystack_parts.extend(str(p).lower() for p in (m.get("user_phrase_examples") or []))
            haystack_parts.append(str(m.get("feedback_pattern_summary", "")).lower())
            haystack = " | ".join(haystack_parts)

            hits = sum(1 for pat in token_patterns.values() if pat.search(haystack))
            if hits == 0:
                continue
            score = min(1.0, hits / max(len(issue_tokens), 1))
            if score > best_score:
                best_score = score
                best_anchor = m.get("target_anchor")

        if best_score < _MATCH_THRESHOLD:
            logger.info(
                "anchor_resolve event=skipped reason=below_threshold "
                "issue=%r slug=%s best_score=%.3f best_anchor=%s "
                "mapping_count=%d threshold=%.2f matched=False",
                issue_preview, slug, best_score, best_anchor, len(mappings),
                _MATCH_THRESHOLD,
                extra={"event": "anchor_resolve",
                       "reason": "below_threshold",
                       "issue": issue_preview, "slug": slug,
                       "best_score": round(best_score, 3),
                       "best_anchor": best_anchor,
                       "mapping_count": len(mappings),
                       "threshold": _MATCH_THRESHOLD, "matched": False},
            )
            return None
        logger.info(
            "anchor_resolve event=hit issue=%r slug=%s anchor=%s score=%.3f",
            issue_preview, slug, best_anchor, best_score,
            extra={"event": "anchor_resolve", "issue": issue_preview,
                   "slug": slug, "anchor": best_anchor,
                   "score": round(best_score, 3),
                   "mapping_count": len(mappings), "matched": True},
        )
        return best_anchor

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
