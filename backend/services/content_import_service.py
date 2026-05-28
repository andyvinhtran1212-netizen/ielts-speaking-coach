"""services/content_import_service.py — Sprint 19.1C content import.

Parses an uploaded Markdown-with-YAML-frontmatter file into a structured
content item for the writing_tips store, and validates it per content_type
(see docs/clusters/19_x/content_format_v1.md — the authoring contract).

Design: parse + validate + payload-build are PURE functions (no DB, no
auth) so they unit-test trivially. The router (admin_writing_tips.py) owns
the supabase upsert + auth, mirroring how the other writing routers keep
DB calls inline.

Frontmatter parsing uses pyyaml (already a dependency) + a manual fence
split — `python-frontmatter` is NOT installed, and a hand-rolled split
keeps us zero-new-dep (Pattern #15 / #42 correction to the commission's
library guess).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Optional

import yaml

CONTENT_TYPES = ("tip", "knowledge", "sample", "outline")
TASK_TYPES    = ("task_1", "task_2", "both")

_COMMON_KEYS  = {"content_type", "title", "slug", "task_type",
                 "category", "published", "display_order"}
_SAMPLE_KEYS  = {"target_band", "word_count", "prompt_id"}
_OUTLINE_KEYS = {"structure"}
_TYPE_KEYS    = _SAMPLE_KEYS | _OUTLINE_KEYS

# ── Sprint 20.1 — Reading module (cluster 20.x) ───────────────────────
# L1 vocab-reading passages reuse this service's frontmatter splitter +
# slugify, with their own parse/validate/build (reading keeps its OWN
# tables — reading_passages — per the cluster 20.0 Discovery watch-item;
# this is NOT routed into writing_tips). L2/L3 structured question import
# is a separate pipeline (Sprints 20.3/20.5), not handled here.
READING_CONTENT_TYPES = ("reading_passage_l1",)
DIFFICULTY_LEVELS     = ("foundation", "intermediate", "advanced")
SKILL_TAGS            = ("skimming", "scanning", "detail", "main_idea",
                         "inference", "vocabulary_in_context",
                         "reference_cohesion", "writer_view_TFNG")

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
                      r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
# Opening fence must be the very first line; body is everything after the
# closing fence.
_FRONTMATTER_RE = re.compile(r"^﻿?---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n?(.*)$", re.DOTALL)

MAX_BODY_CHARS = 50_000


class FrontmatterError(Exception):
    """Raised when the file has no parseable YAML frontmatter block."""


@dataclass
class ParsedContent:
    content_type:  Optional[str]
    title:         Optional[str]
    slug:          Optional[str]
    task_type:     Optional[str]
    category:      Optional[str]
    published:     bool
    display_order: int
    body_markdown: str
    type_data:     dict = field(default_factory=dict)
    raw_frontmatter: dict = field(default_factory=dict)

    def as_preview(self) -> dict:
        """Flat dict for the admin import preview (frontmatter table +
        body). type_data is surfaced inline so the preview shows the
        per-type extras too."""
        return {
            "content_type":  self.content_type,
            "title":         self.title,
            "slug":          self.slug,
            "task_type":     self.task_type,
            "category":      self.category,
            "published":     self.published,
            "display_order": self.display_order,
            "type_data":     self.type_data,
            "body_markdown": self.body_markdown,
        }


def slugify(text: str) -> str:
    """ASCII URL slug from a (possibly Vietnamese) title — no external dep.

    đ/Đ don't decompose under NFKD, so map them first; then strip combining
    accents, lowercase, and collapse non-alphanumerics to single hyphens.
    Shared with the admin tips router (imported there as _slugify)."""
    s = (text or "").strip().lower()
    s = s.replace("đ", "d")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "tip"


def _split_frontmatter(text: str) -> tuple[dict, str]:
    """Split a Markdown file into (frontmatter dict, stripped body).

    Shared by the writing-tips parser and the Sprint 20.1 reading-passage
    parser. Raises FrontmatterError when no parseable YAML frontmatter
    block exists at the top of the file."""
    m = _FRONTMATTER_RE.match(text or "")
    if not m:
        raise FrontmatterError(
            "Không tìm thấy frontmatter YAML. File phải bắt đầu bằng '---' "
            "rồi tới các trường, rồi '---', rồi nội dung."
        )

    raw_yaml, body = m.group(1), m.group(2)
    try:
        fm = yaml.safe_load(raw_yaml) or {}
    except yaml.YAMLError as exc:
        raise FrontmatterError(f"Frontmatter YAML không hợp lệ: {exc}")
    if not isinstance(fm, dict):
        raise FrontmatterError("Frontmatter phải là các cặp key: value.")

    return fm, (body or "").strip()


def parse_markdown_with_frontmatter(text: str) -> ParsedContent:
    """Split frontmatter + body, then route type-specific keys into
    type_data. Raises FrontmatterError when no frontmatter block exists."""
    fm, body = _split_frontmatter(text)

    type_data = {k: fm[k] for k in _TYPE_KEYS if k in fm}

    return ParsedContent(
        content_type  = _as_str(fm.get("content_type")),
        title         = _as_str(fm.get("title")),
        slug          = _as_str(fm.get("slug")),
        task_type     = _as_str(fm.get("task_type")),
        category      = _as_str(fm.get("category")),
        published     = bool(fm.get("published", False)),
        display_order = _as_int(fm.get("display_order", 0)),
        body_markdown = body,
        type_data     = type_data,
        raw_frontmatter = fm,
    )


def validate_content(p: ParsedContent) -> list[dict]:
    """Return a list of {field, message} errors. Empty list = valid."""
    errors: list[dict] = []

    def err(fieldname: str, message: str) -> None:
        errors.append({"field": fieldname, "message": message})

    # ── Common fields ──
    if p.content_type not in CONTENT_TYPES:
        err("content_type", f"Phải là một trong: {', '.join(CONTENT_TYPES)}.")
    if not p.title or len(p.title) < 2:
        err("title", "Bắt buộc, tối thiểu 2 ký tự.")
    elif len(p.title) > 200:
        err("title", "Tối đa 200 ký tự.")
    if p.task_type not in TASK_TYPES:
        err("task_type", f"Phải là một trong: {', '.join(TASK_TYPES)}.")
    if not p.body_markdown:
        err("body_markdown", "Nội dung không được để trống.")
    elif len(p.body_markdown) > MAX_BODY_CHARS:
        err("body_markdown", f"Nội dung vượt quá {MAX_BODY_CHARS} ký tự.")
    if p.slug and not _SLUG_RE.match(p.slug):
        err("slug", "Chỉ gồm chữ thường a–z, số 0–9 và dấu gạch ngang.")
    if p.category and len(p.category) > 80:
        err("category", "Tối đa 80 ký tự.")

    # ── Type-specific ──
    if p.content_type == "sample":
        tb = p.type_data.get("target_band")
        if not isinstance(tb, (int, float)) or isinstance(tb, bool) or not (0 <= tb <= 9):
            err("target_band", "Bài mẫu cần target_band là số từ 0 đến 9.")
        wc = p.type_data.get("word_count")
        if not isinstance(wc, int) or isinstance(wc, bool) or wc <= 0:
            err("word_count", "Bài mẫu cần word_count là số nguyên dương.")
        pid = p.type_data.get("prompt_id")
        if pid is not None and not (isinstance(pid, str) and _UUID_RE.match(pid)):
            err("prompt_id", "prompt_id phải là UUID hợp lệ (hoặc bỏ trống).")

    elif p.content_type == "outline":
        structure = p.type_data.get("structure")
        if not isinstance(structure, list) or not structure:
            err("structure", "Dàn bài cần 'structure' là danh sách các mục.")
        else:
            for i, item in enumerate(structure):
                if not isinstance(item, dict) or not item.get("heading"):
                    err("structure", f"Mục #{i + 1} thiếu 'heading'.")
                elif not isinstance(item.get("points"), list):
                    err("structure", f"Mục #{i + 1} cần 'points' là danh sách.")

    return errors


def build_db_payload(p: ParsedContent, slug: str) -> dict:
    """Map a validated ParsedContent to a writing_tips row payload.
    `created_by` is stamped by the router on INSERT only (preserved on
    update)."""
    return {
        "content_type":  p.content_type,
        "title":         p.title,
        "slug":          slug,
        "task_type":     p.task_type,
        "category":      p.category,
        "published":     p.published,
        "display_order": p.display_order,
        "body_markdown": p.body_markdown,
        "type_data":     p.type_data,
    }


# ── Sprint 20.1 — L1 vocab-reading passage import ─────────────────────
# Reuses _split_frontmatter + slugify above; lands in reading_passages
# (library='l1_vocab'), NOT writing_tips. The router (admin_reading.py)
# owns the supabase upsert + auth, mirroring the writing import split.


@dataclass
class ParsedReadingPassage:
    content_type:      Optional[str]
    title:             Optional[str]
    slug:              Optional[str]
    difficulty_level:  Optional[str]
    topic_tags:        list
    image_url:         Optional[str]
    glossary:          list
    word_count:        Optional[int]
    estimated_minutes: Optional[int]
    published:         bool
    body_markdown:     str
    raw_frontmatter:   dict = field(default_factory=dict)

    def as_preview(self) -> dict:
        """Flat dict for the admin import preview. library is fixed to
        l1_vocab so the preview matches the committed reading_passages row."""
        return {
            "content_type":      self.content_type,
            "library":           "l1_vocab",
            "title":             self.title,
            "slug":              self.slug,
            "difficulty_level":  self.difficulty_level,
            "topic_tags":        self.topic_tags,
            "image_url":         self.image_url,
            "glossary":          self.glossary,
            "word_count":        self.word_count,
            "estimated_minutes": self.estimated_minutes,
            "published":         self.published,
            "body_markdown":     self.body_markdown,
        }


def parse_reading_passage(text: str) -> ParsedReadingPassage:
    """Parse an L1 vocab-reading passage (Markdown + YAML frontmatter).
    Raises FrontmatterError when no frontmatter block exists. glossary is
    coerced to a list here; validate_reading_passage checks its shape (and
    reads raw_frontmatter to flag a non-list glossary)."""
    fm, body = _split_frontmatter(text)
    raw_glossary = fm.get("glossary")

    return ParsedReadingPassage(
        content_type      = _as_str(fm.get("content_type")),
        title             = _as_str(fm.get("title")),
        slug              = _as_str(fm.get("slug")),
        difficulty_level  = _as_str(fm.get("difficulty_level")),
        topic_tags        = _as_str_list(fm.get("topic_tags")),
        image_url         = _as_str(fm.get("image_url")),
        glossary          = raw_glossary if isinstance(raw_glossary, list) else [],
        word_count        = _as_opt_int(fm.get("word_count")),
        estimated_minutes = _as_opt_int(fm.get("estimated_minutes")),
        published         = bool(fm.get("published", False)),
        body_markdown     = body,
        raw_frontmatter   = fm,
    )


def validate_reading_passage(p: ParsedReadingPassage) -> list[dict]:
    """Return a list of {field, message} errors. Empty list = valid."""
    errors: list[dict] = []

    def err(fieldname: str, message: str) -> None:
        errors.append({"field": fieldname, "message": message})

    if p.content_type not in READING_CONTENT_TYPES:
        err("content_type", f"Phải là một trong: {', '.join(READING_CONTENT_TYPES)}.")
    if not p.title or len(p.title) < 2:
        err("title", "Bắt buộc, tối thiểu 2 ký tự.")
    elif len(p.title) > 200:
        err("title", "Tối đa 200 ký tự.")
    if not p.body_markdown:
        err("body_markdown", "Nội dung không được để trống.")
    elif len(p.body_markdown) > MAX_BODY_CHARS:
        err("body_markdown", f"Nội dung vượt quá {MAX_BODY_CHARS} ký tự.")
    if p.slug and not _SLUG_RE.match(p.slug):
        err("slug", "Chỉ gồm chữ thường a–z, số 0–9 và dấu gạch ngang.")
    if p.difficulty_level is not None and p.difficulty_level not in DIFFICULTY_LEVELS:
        err("difficulty_level",
            f"Phải là một trong: {', '.join(DIFFICULTY_LEVELS)} (hoặc bỏ trống).")
    if p.image_url is not None and not p.image_url.startswith(("http://", "https://")):
        err("image_url", "image_url phải là URL hợp lệ (http/https).")

    # glossary (optional) — list of {term, definition}. Read raw so a
    # non-list value is flagged rather than silently coerced to [].
    raw_glossary = p.raw_frontmatter.get("glossary")
    if raw_glossary is not None:
        if not isinstance(raw_glossary, list):
            err("glossary", "glossary phải là danh sách các mục {term, definition}.")
        else:
            for i, item in enumerate(raw_glossary):
                if not isinstance(item, dict) or not item.get("term") or not item.get("definition"):
                    err("glossary", f"Mục glossary #{i + 1} cần 'term' và 'definition'.")

    return errors


def build_reading_passage_payload(p: ParsedReadingPassage, slug: str) -> dict:
    """Map a validated L1 passage to a reading_passages row payload.
    library is fixed to 'l1_vocab'; the `published` bool maps to the status
    enum. `created_by` is stamped by the router on INSERT only."""
    return {
        "library":           "l1_vocab",
        "slug":              slug,
        "title":             p.title,
        "body_markdown":     p.body_markdown,
        "difficulty_level":  p.difficulty_level,
        "topic_tags":        p.topic_tags,
        "image_url":         p.image_url,
        "glossary":          p.glossary if isinstance(p.glossary, list) else [],
        "word_count":        p.word_count,
        "estimated_minutes": p.estimated_minutes,
        "status":            "published" if p.published else "draft",
    }


# ── small coercion helpers (YAML can hand back odd types) ─────────────


def _as_str(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, str):
        return v.strip() or None
    return str(v)


def _as_int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _as_opt_int(v: Any) -> Optional[int]:
    """int or None (None preserved — distinguishes 'absent' from 0)."""
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _as_str_list(v: Any) -> list:
    """Coerce a YAML scalar/sequence into a list of non-empty strings."""
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    if isinstance(v, str) and v.strip():
        return [v.strip()]
    return []
