"""services/vocab_import.py — M3 vocab content importer (Slice-1).

Mirrors the proven content_import_service pattern (parse frontmatter → validate
→ structured {field,message} errors → upsert-by-slug, idempotent) but with the
vocab field set. One markdown file = one word, in the content_vocab format. The
VN gloss is EXTRACTED from the body's first paragraph and STORED (single source —
reuses vocab_content._first_paragraph_text so it matches the live grid exactly).

Write path is service-role (supabase_admin); the admin route gates require_admin.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import markdown
import yaml

from database import supabase_admin
from services.content_import_service import slugify, _split_frontmatter, FrontmatterError
from services.vocab_content import _first_paragraph_text, _MD_EXTENSIONS

logger = logging.getLogger(__name__)

# Columns the importer writes — MUST be a subset of migration 110's columns
# (test_vocab_import asserts this; the compose-500 #538 mock-vs-DB lesson).
_LIST_FIELDS = ("synonyms", "antonyms", "collocations", "related_words")
_SCALAR_FIELDS = (
    "level", "part_of_speech", "pronunciation", "definition_en", "example",
    "register", "common_error", "memory_hook", "source", "group",
)


@dataclass
class VocabParsed:
    headword: str
    slug: str
    category: str
    gloss_vi: str
    body_html: str
    scalars: dict = field(default_factory=dict)   # level/part_of_speech/…/group
    lists: dict = field(default_factory=dict)      # synonyms/antonyms/…
    raw_frontmatter: dict = field(default_factory=dict)

    def as_preview(self) -> dict:
        """Flat dict for the admin import preview."""
        return {
            "slug": self.slug, "headword": self.headword, "category": self.category,
            "gloss_vi": self.gloss_vi, "body_html": self.body_html,
            **self.scalars, **self.lists,
        }


def parse_vocab_markdown(text: str) -> VocabParsed:
    """One word's markdown (frontmatter + body) → VocabParsed. Raises
    FrontmatterError when no frontmatter block exists."""
    fm, body = _split_frontmatter(text)

    headword = str(fm.get("headword") or "").strip()
    slug = str(fm.get("slug") or "").strip()
    if not slug and headword:        # auto-slug from headword when omitted
        slug = slugify(headword)
    category = str(fm.get("category") or "").strip()

    scalars = {k: ("" if fm.get(k) is None else str(fm.get(k))) for k in _SCALAR_FIELDS}
    lists = {k: [str(x) for x in (fm.get(k) or []) if x is not None] for k in _LIST_FIELDS}

    md_proc = markdown.Markdown(extensions=_MD_EXTENSIONS)
    body_html = md_proc.convert(body)

    return VocabParsed(
        headword=headword, slug=slug, category=category,
        gloss_vi=_first_paragraph_text(body), body_html=body_html,
        scalars=scalars, lists=lists, raw_frontmatter=fm,
    )


def validate_vocab(p: VocabParsed, *, valid_categories: Optional[set] = None) -> list[dict]:
    """Return [{field, message}] — empty list = valid."""
    errors: list[dict] = []

    def err(f: str, m: str) -> None:
        errors.append({"field": f, "message": m})

    if not p.headword:
        err("headword", "Bắt buộc.")
    if not p.slug:
        err("slug", "Bắt buộc (tự sinh từ headword nếu thiếu).")
    elif not all(c.isalnum() or c == "-" for c in p.slug):
        err("slug", "Chỉ gồm chữ thường a–z, số 0–9 và dấu gạch ngang.")
    if not p.category:
        err("category", "Bắt buộc.")
    elif valid_categories and p.category not in valid_categories:
        err("category", f"Không thuộc danh mục hợp lệ: {', '.join(sorted(valid_categories))}.")
    return errors


def build_vocab_payload(p: VocabParsed, *, import_batch_id: Optional[str] = None) -> dict:
    """The upsert payload. Keys MUST be ⊆ migration 110 columns (schema test)."""
    payload = {
        "slug": p.slug, "headword": p.headword, "category": p.category,
        "gloss_vi": p.gloss_vi, "body_html": p.body_html,
        **p.scalars, **p.lists,
    }
    if import_batch_id is not None:
        payload["import_batch_id"] = import_batch_id
    return payload


def upsert_vocab_card(payload: dict) -> dict:
    """Idempotent upsert-by-slug (read-then-write — robust vs on_conflict + the
    partial-index gotcha). Returns {slug, action: 'created'|'updated'}."""
    slug = payload["slug"]
    existing = (
        supabase_admin.table("vocab_cards").select("id").eq("slug", slug).limit(1).execute()
    ).data
    if existing:
        supabase_admin.table("vocab_cards").update(payload).eq("slug", slug).execute()
        return {"slug": slug, "action": "updated"}
    supabase_admin.table("vocab_cards").insert(payload).execute()
    return {"slug": slug, "action": "created"}


def import_vocab_markdown(
    text: str, *, dry_run: bool = True, valid_categories: Optional[set] = None,
    import_batch_id: Optional[str] = None,
) -> dict:
    """Full pipeline for one word's markdown: parse → validate → (commit). Returns
    {parsed_data, validation_errors, dry_run, committed, action}."""
    try:
        parsed = parse_vocab_markdown(text)
    except FrontmatterError as exc:
        return {"parsed_data": None, "validation_errors": [{"field": "frontmatter", "message": str(exc)}],
                "dry_run": dry_run, "committed": None, "action": None}

    errors = validate_vocab(parsed, valid_categories=valid_categories)
    if errors or dry_run:
        return {"parsed_data": parsed.as_preview(), "validation_errors": errors,
                "dry_run": dry_run, "committed": None, "action": None}

    res = upsert_vocab_card(build_vocab_payload(parsed, import_batch_id=import_batch_id))
    return {"parsed_data": parsed.as_preview(), "validation_errors": [],
            "dry_run": False, "committed": res["slug"], "action": res["action"]}
