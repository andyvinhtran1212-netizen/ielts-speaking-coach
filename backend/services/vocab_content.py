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
LISTS_FILE      = CONTENT_DIR / "_lists.yaml"      # exam-list manifest (AWL/TOEIC/THPT)

_MD_EXTENSIONS  = ["tables", "fenced_code", "attr_list"]


class VocabContentService:
    def __init__(self):
        # Keyed by slug (best-effort related-word resolution). NOT a full census:
        # a slug shared across categories collides here — use _all_articles /
        # articles_by_cat_slug for counting and detail lookup (mig 122).
        self.articles_by_slug:     dict[str, dict]       = {}
        # Canonical identity is (category, slug) — a word may live in several
        # topics, so detail lookup and the full census key on the pair.
        self.articles_by_cat_slug: dict[tuple, dict]     = {}
        self._all_articles:        list[dict]            = []   # FULL census (KP + get_all_articles)
        # CURATED = self-authored topic vocab (no `lists`); EXAM = AWL/TOEIC/THPT
        # import (non-empty `lists`). The two are kept apart so the "my vocab"
        # surfaces never mix in exam-list words (see _is_exam / _build_indexes).
        self._curated_articles:    list[dict]            = []
        self._exam_articles:       list[dict]            = []
        self.articles_by_category: dict[str, list[dict]] = {}   # CURATED, keyed by category
        self.exam_by_list:         dict[str, list[dict]] = {}   # EXAM, keyed by each list slug
        self._exam_lists_meta:     list[dict]            = []   # from _lists.yaml (+ family)
        self.all_categories:       list[dict]            = []
        self.headword_index:       list[dict]            = []  # for prefix search (CURATED)
        self._valid_categories:    set[str]              = set()
        self.last_modified:        Optional[datetime]    = None  # G2: cache key (MAX updated_at)
        self._source:             str                    = "markdown"  # "db" | "markdown"
        self._load_categories()
        self._load_lists()
        self._load_all()

    def reload(self) -> None:
        """G1 — rebuild the in-memory index from the source of truth. Called
        after an admin upload commits so a new word appears without a restart."""
        self.articles_by_slug = {}
        self.articles_by_cat_slug = {}
        self._all_articles = []
        self._curated_articles = []
        self._exam_articles = []
        self.articles_by_category = {}
        self.exam_by_list = {}
        self._exam_lists_meta = []
        self.all_categories = []
        self.headword_index = []
        self._valid_categories = set()
        self.last_modified = None
        self._load_categories()
        self._load_lists()
        self._load_all()

    # ── Category manifest ────────────────────────────────────────────────────

    def _load_categories(self) -> None:
        if not CATEGORIES_FILE.exists():
            logger.warning("[vocab] categories manifest not found: %s", CATEGORIES_FILE)
            return
        raw: dict = yaml.safe_load(CATEGORIES_FILE.read_text(encoding="utf-8")) or {}
        for cat in raw.get("categories", []):
            self._valid_categories.add(cat["slug"])

    # ── Exam-list manifest (AWL / TOEIC / THPT) ──────────────────────────────

    def _load_lists(self) -> None:
        """Load the exam-list manifest (_lists.yaml) that powers the exam-prep
        area. Each entry gets a `family` (awl/toeic/thpt) derived from its slug so
        the browse tree can group lists by exam type. Absent file → no exam lists
        (the exam area just renders empty)."""
        self._exam_lists_meta = []
        if not LISTS_FILE.exists():
            return
        raw: dict = yaml.safe_load(LISTS_FILE.read_text(encoding="utf-8")) or {}
        for lst in raw.get("lists", []):
            slug = lst.get("slug")
            if not slug:
                continue
            self._exam_lists_meta.append({
                "slug":        slug,
                "title":       lst.get("title") or _prettify(slug),
                "description": lst.get("description", ""),
                "exam_source": lst.get("exam_source", ""),
                "order":       lst.get("order", 999),
                "family":      _exam_family_of(slug),
            })
        self._exam_lists_meta.sort(key=lambda m: m["order"])

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
            # PostgREST caps a single response at ~1000 rows, so a bare select("*")
            # silently drops everything past the first page once the table grows
            # beyond it — the browse index and KP seed would just not see those
            # words. Page through with range() until a short page signals the end.
            rows: list[dict] = []
            _PAGE = 1000
            start = 0
            while True:
                # order() on the PK gives a STABLE total order across page requests —
                # without it PostgREST/Postgres don't guarantee row order, so a
                # concurrent reload()/import could shift a row between offsets and
                # duplicate one while skipping another.
                res = (supabase_admin.table("vocab_cards").select("*")
                       .order("id").range(start, start + _PAGE - 1).execute())
                batch = res.data or []
                rows.extend(batch)
                if len(batch) < _PAGE:
                    break
                start += _PAGE
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
            "word_family":    list(r.get("word_family") or []),   # mig112 — "Họ từ" (≠ related)
            # Exam-list axis (mig135): a non-empty `lists` marks this as AWL/TOEIC/
            # THPT import vocab → served by the exam-prep area, kept OUT of the
            # self-curated topic surfaces (see _is_exam).
            "lists":          list(r.get("lists") or []),
            "tested_in":      list(r.get("tested_in") or []),
            "gloss_vi":       r.get("gloss_vi") or "",
            "definition_en":  r.get("definition_en") or "",
            "definition_vi":  r.get("definition_vi") or "",       # mig112 — curated VN (else gloss_vi)
            "example":        r.get("example") or "",
            "html":           r.get("body_html") or "",
            # Slice-2 — orthographic syllabification (e.g. "me-TROP-o-lis"); the
            # card renders an orthographic specimen when present, else IPA fallback.
            "syllables":      r.get("syllables") or "",
            # Slice-2 — pregenerated audio URLs (null until pregen stamps them; the
            # FE ▶ prefers these and falls back to speechSynthesis when absent).
            "audio_headword": r.get("audio_headword") or "",
            "audio_example":  r.get("audio_example") or "",
            # V-article re-skin — structured fields surfaced for the v2 detail card
            # (callouts + foot). Empty for the seed words (their content lives in
            # the markdown body), so the card hides those sections gracefully.
            "register":       r.get("register") or "",
            "common_error":   r.get("common_error") or "",
            "memory_hook":    r.get("memory_hook") or "",
            "source":         r.get("source") or "",
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

    @staticmethod
    def _is_exam(a: dict) -> bool:
        """True when a card carries a non-empty `lists` (AWL/TOEIC/THPT exam-list
        membership) — i.e. it belongs in the exam-prep area's lists. NOTE: this
        alone does NOT hide the card from topics; a curated lesson word may also
        carry an exam list (dual membership). Use _is_exam_only for the topic gate."""
        return bool(a.get("lists"))

    @staticmethod
    def _is_lesson(a: dict) -> bool:
        """True when a card belongs to a curated lesson — its `source` is an
        'L<NN> Group X' stamp (the upload provenance). A lesson word stays in its
        topic even when it also carries an exam list."""
        return bool(_LESSON_SRC_RE.match((a.get("source") or "").strip()))

    @staticmethod
    def _is_exam_only(a: dict) -> bool:
        """True when a card must be HIDDEN from the curated topic surfaces: it has
        an exam list AND is NOT part of a curated lesson (a pure AWL/TOEIC/THPT
        import). A lesson word that also carries an exam list is NOT exam-only — it
        shows in BOTH its topic and the exam list (dual membership)."""
        return VocabContentService._is_exam(a) and not VocabContentService._is_lesson(a)

    def _build_indexes(self, articles: list[dict]) -> None:
        self._all_articles = list(articles)   # full census — no dedup by slug (KP)
        # Detail maps span ALL cards so any card (curated OR exam) stays reachable
        # by its own (category, slug) / slug — the article detail page + related
        # resolution must resolve exam cards too.
        for a in articles:
            self.articles_by_slug[a["slug"]] = a
            self.articles_by_cat_slug[(a["category"], a["slug"])] = a

        # Topic vs exam split (dual-membership aware):
        #  • CURATED (shown in topics)  = everything EXCEPT exam-only imports.
        #  • EXAM-LISTED (shown in exam) = every card with a `lists` membership.
        # A lesson word that also carries an exam list is in BOTH sets.
        self._curated_articles = [a for a in articles if not self._is_exam_only(a)]
        self._exam_articles    = [a for a in articles if self._is_exam(a)]

        # Topic grouping — CURATED only (drives the 'my vocab' browse + study).
        for a in self._curated_articles:
            self.articles_by_category.setdefault(a["category"], []).append(a)
        for cat in self.articles_by_category:
            self.articles_by_category[cat].sort(
                key=lambda x: x.get("headword", x["slug"])
            )

        # Exam grouping — keyed by EACH list slug (a card may belong to several
        # lists, e.g. awl-sublist-1 + toeic-core, so it appears under each).
        for a in self._exam_articles:
            for lst in (a.get("lists") or []):
                self.exam_by_list.setdefault(str(lst), []).append(a)
        for lst in self.exam_by_list:
            self.exam_by_list[lst].sort(key=lambda x: x.get("headword", x["slug"]))

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

        # headword prefix-search index — CURATED only (the 'my vocab' wiki search).
        self.headword_index = [
            {
                "slug":     a["slug"],
                "category": a["category"],
                "headword": a["headword"],
            }
            for a in self._curated_articles
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
            "word_family":    [str(x) for x in (fm.get("word_family") or []) if x is not None],
            # Exam-list axis — same role as the DB path (marks AWL/TOEIC/THPT vocab).
            "lists":          [str(x) for x in (fm.get("lists") or []) if x is not None],
            "tested_in":      [str(x) for x in (fm.get("tested_in") or []) if x is not None],
            # VE1 (word-library grid): a short VN gloss for the mini-card. The 20
            # words have NO structured VN field — the gloss is the body's first
            # paragraph (e.g. "**Tiên tiến nhất…** — …"), so extract it. A word
            # whose body has none just gets "" (never breaks).
            "gloss_vi":       _first_paragraph_text(body),
            # VE1 forward-compat for VC1 (Andy fills these later). ADDITIVE — a
            # word without the frontmatter key gets "" and no existing field changes.
            "definition_en":  str(fm.get("definition_en") or ""),
            "definition_vi":  str(fm.get("definition_vi") or ""),   # mig112 curated VN
            "example":        str(fm.get("example") or ""),
            "syllables":      str(fm.get("syllables") or ""),   # Slice-2 orthographic
            # V-article re-skin — structured card fields (forward-compat; empty for
            # the seed words). Audio is markdown-absent → "" (DB path stamps it).
            "register":       str(fm.get("register") or ""),
            "common_error":   str(fm.get("common_error") or ""),
            "memory_hook":    str(fm.get("memory_hook") or ""),
            "source":         str(fm.get("source") or ""),
            "audio_headword": "",
            "audio_example":  "",
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
            # V-article re-skin — mini-card "N collocations" footer (count only,
            # keeps the categories payload small).
            "n_collocations": len(a.get("collocations") or []),
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
        # FULL census (mig 122) — curated AND exam cards. Kept full because the KP
        # registry (vocab_slugs) + the KP seed validate/reference every card,
        # including AWL/TOEIC/THPT imports. For the 'my vocab' wiki listing use
        # get_curated_articles(), which drops the exam-list words.
        return [self._summary(a) for a in self._all_articles]

    def get_curated_articles(self) -> list[dict]:
        """Flat summaries of SELF-CURATED words only (exam-list vocab excluded) —
        the 'my vocab' wiki flat listing / client-side search source."""
        return [self._summary(a) for a in self._curated_articles]

    def get_article(self, category: str, slug: str) -> Optional[dict]:
        # Disambiguate by (category, slug): the same slug can exist in multiple
        # categories, so a slug-only lookup could return the wrong card (or miss
        # this one entirely when another category's card overwrote the slug key).
        a = self.articles_by_cat_slug.get((category, slug))
        if not a:
            return None
        related = self._resolve_related(a.get("related_words") or [])
        return {**a, "related_words": related}

    def get_category_cards(self, category: str) -> Optional[list[dict]]:
        """Full vocab cards (rich fields) for one category — the study-stack source
        for topic-scoped flashcards/exercises. Returns None when the category is
        unknown (router 404s); a known-but-empty category returns []. Same per-card
        shape as get_article (related_words resolved to objects)."""
        known = category in self._valid_categories or category in self.articles_by_category
        if not known:
            return None
        cards = self.articles_by_category.get(category, [])
        return [
            {**a, "related_words": self._resolve_related(a.get("related_words") or [])}
            for a in cards
        ]

    def search_prefix(self, prefix: str) -> list[dict]:
        """Simple case-insensitive prefix match on headword (CURATED only —
        headword_index excludes exam-list vocab)."""
        if not prefix:
            return []
        q = prefix.lower()
        return [
            item for item in self.headword_index
            if item["headword"].lower().startswith(q)
        ][:20]

    # ── Exam-prep area (AWL / TOEIC / THPT) ──────────────────────────────────

    def get_exam_families(self) -> list[dict]:
        """Browse tree for the exam-prep area: families (AWL/TOEIC/THPT) → their
        lists, each with a live card count (from exam_by_list). Lists with 0 cards
        are still shown so the target set is visible. Ordered awl→toeic→thpt; lists
        in their manifest order."""
        fam_titles = dict(_EXAM_FAMILIES)
        fams: dict[str, dict] = {}
        for meta in self._exam_lists_meta:
            fam = meta["family"]
            fams.setdefault(fam, {
                "family": fam,
                "title":  fam_titles.get(fam, fam.upper()),
                "lists":  [],
            })
            fams[fam]["lists"].append({
                "slug":        meta["slug"],
                "title":       meta["title"],
                "description": meta.get("description", ""),
                "exam_source": meta.get("exam_source", ""),
                "count":       len(self.exam_by_list.get(meta["slug"], [])),
            })
        order = {f: i for i, (f, _t) in enumerate(_EXAM_FAMILIES)}
        return sorted(fams.values(), key=lambda f: order.get(f["family"], 99))

    def get_exam_cards(self, list_slug: str) -> Optional[list[dict]]:
        """Full rich cards for one exam list — the flashcard/study source for the
        exam-prep area (same per-card shape as get_category_cards). Returns None
        when the list slug is unknown (router 404s); a known-but-empty list → []."""
        known = (any(m["slug"] == list_slug for m in self._exam_lists_meta)
                 or list_slug in self.exam_by_list)
        if not known:
            return None
        cards = self.exam_by_list.get(list_slug, [])
        return [
            {**a, "related_words": self._resolve_related(a.get("related_words") or [])}
            for a in cards
        ]

    def get_exam_list_title(self, list_slug: str) -> str:
        """Human title for an exam list slug (falls back to a prettified slug)."""
        for m in self._exam_lists_meta:
            if m["slug"] == list_slug:
                return m["title"]
        return _prettify(list_slug)


# ── Module-level helpers ─────────────────────────────────────────────────────

# A curated lesson word's `source` is an "L<NN> Group X" stamp (upload provenance);
# this marks it as lesson content even when it also carries an exam `lists` tag, so
# it stays in its topic (dual membership) instead of moving to the exam area only.
_LESSON_SRC_RE = re.compile(r"^L\d")

# Exam families (ordered) for the exam-prep browse tree. The card's `lists` slugs
# map to a family by prefix (awl-sublist-1 → awl, toeic-core → toeic, …).
_EXAM_FAMILIES = (
    ("awl",   "AWL — Academic Word List"),
    ("toeic", "TOEIC"),
    ("thpt",  "THPT Quốc gia"),
)


def _exam_family_of(list_slug: str) -> str:
    s = str(list_slug or "")
    if s.startswith("awl"):
        return "awl"
    if s.startswith("toeic"):
        return "toeic"
    if s.startswith("thpt"):
        return "thpt"
    return "other"


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
