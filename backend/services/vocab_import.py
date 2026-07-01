"""services/vocab_import.py — M3 vocab content importer.

Mirrors the proven content_import_service pattern (parse frontmatter → validate
→ structured {field,message} errors → upsert-by-slug, idempotent) but with the
vocab field set. The VN gloss is EXTRACTED from the body's first paragraph and
STORED (single source — reuses vocab_content._first_paragraph_text so it matches
the live grid exactly).

A file may hold ONE word (the original content_vocab shape) or MANY words
concatenated (one lesson per file — see split_word_blocks / import_vocab_file).
Each block is parsed + validated independently so one bad block never aborts the
rest, and the commit is all-or-nothing so a lesson is never half-imported.

Write path is service-role (supabase_admin); the admin route gates require_admin.
"""

from __future__ import annotations

import logging
import re
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
_LIST_FIELDS = ("synonyms", "antonyms", "collocations", "related_words", "word_family")
_SCALAR_FIELDS = (
    "level", "part_of_speech", "pronunciation", "definition_en", "definition_vi", "example",
    "register", "common_error", "memory_hook", "source", "group",
    # Slice-2 — optional orthographic syllabification (e.g. "me-TROP-o-lis").
    # Missing → "" (graceful); the card falls back to the IPA stress parser.
    "syllables",
)


def _normalize_category(raw) -> str:
    """Normalize a frontmatter category into a clean ASCII URL slug — the form
    stored in vocab_cards.category and used as the /articles/{cat}/… path segment.

    Reuses slugify (lowercase + trim, đ→d, strip accents, space/underscore →
    single hyphen, collapse multi-hyphen). This REPLACES the old yaml whitelist:
    any well-formed category is accepted, so a new topic is added just by naming
    it in the frontmatter. We only normalize the *form* (no synonym merging) — so
    "Business Finance"/"business_finance"/"Business  Finance" → "business-finance"
    and "Technology "/"technology" → "technology". An empty/blank category stays
    "" so validate_vocab still flags it as required (slugify would yield a
    placeholder otherwise)."""
    if not str(raw or "").strip():
        return ""
    return slugify(str(raw))


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
    category = _normalize_category(fm.get("category"))

    scalars = {k: ("" if fm.get(k) is None else str(fm.get(k))) for k in _SCALAR_FIELDS}
    lists = {k: [str(x) for x in (fm.get(k) or []) if x is not None] for k in _LIST_FIELDS}

    md_proc = markdown.Markdown(extensions=_MD_EXTENSIONS)
    body_html = md_proc.convert(body)

    return VocabParsed(
        headword=headword, slug=slug, category=category,
        gloss_vi=_first_paragraph_text(body), body_html=body_html,
        scalars=scalars, lists=lists, raw_frontmatter=fm,
    )


def validate_vocab(p: VocabParsed) -> list[dict]:
    """Return [{field, message}] — empty list = valid.

    Category-runtime (Slice-A): there is NO category whitelist any more — a
    category is accepted as long as it normalizes to a non-empty slug (done in
    parse_vocab_markdown). We still require the field to be present; a new topic
    is added simply by naming it in the frontmatter (it auto-surfaces via
    DISTINCT-from-DB in vocab_content._build_indexes)."""
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
    return errors


def build_vocab_payload(p: VocabParsed, *, import_batch_id: Optional[str] = None) -> dict:
    """The upsert payload. Keys MUST be ⊆ vocab_cards columns (mig 110 + 111
    syllables) — the schema-aware test pins this (#538 lesson)."""
    payload = {
        "slug": p.slug, "headword": p.headword, "category": p.category,
        "gloss_vi": p.gloss_vi, "body_html": p.body_html,
        **p.scalars, **p.lists,
    }
    if import_batch_id is not None:
        payload["import_batch_id"] = import_batch_id
    return payload


def upsert_vocab_card(payload: dict) -> dict:
    """Idempotent upsert-by-(category, slug) (read-then-write — robust vs
    on_conflict + the partial-index gotcha). Returns {slug, action}.

    Identity is (category, slug), NOT slug alone (mig 122): the SAME headword may
    live in several topics, so uploading a word already present under a DIFFERENT
    category INSERTS a new card for the new topic instead of moving the existing
    one — the word is never silently dropped from its original topic. Re-uploading
    the same word under the SAME category still updates in place (idempotent).

    Stamps topic_id from the card's category (resolve/create the matching vocab
    topic) so the topic spine stays in sync on every write — not just the mig-117
    one-time backfill."""
    if "topic_id" not in payload and payload.get("category"):
        from services.topic_service import resolve_topic_id_for_category  # avoid import cycle
        tid = resolve_topic_id_for_category(payload["category"])
        if tid:
            payload["topic_id"] = tid
    slug = payload["slug"]
    category = payload.get("category")
    existing = (
        supabase_admin.table("vocab_cards").select("id")
        .eq("slug", slug).eq("category", category).limit(1).execute()
    ).data
    if existing:
        supabase_admin.table("vocab_cards").update(payload).eq(
            "slug", slug).eq("category", category).execute()
        return {"slug": slug, "action": "updated"}
    supabase_admin.table("vocab_cards").insert(payload).execute()
    return {"slug": slug, "action": "created"}


def import_vocab_markdown(
    text: str, *, dry_run: bool = True,
    import_batch_id: Optional[str] = None,
) -> dict:
    """Full pipeline for ONE word's markdown: parse → validate → (commit). Returns
    {parsed_data, validation_errors, dry_run, committed, action}. Kept for the
    migrate-in script (content_vocab is one-word-per-file); the admin route uses
    import_vocab_file, which also accepts many-words-per-file."""
    try:
        parsed = parse_vocab_markdown(text)
    except FrontmatterError as exc:
        return {"parsed_data": None, "validation_errors": [{"field": "frontmatter", "message": str(exc)}],
                "dry_run": dry_run, "committed": None, "action": None}

    errors = validate_vocab(parsed)
    if errors or dry_run:
        return {"parsed_data": parsed.as_preview(), "validation_errors": errors,
                "dry_run": dry_run, "committed": None, "action": None}

    res = upsert_vocab_card(build_vocab_payload(parsed, import_batch_id=import_batch_id))
    return {"parsed_data": parsed.as_preview(), "validation_errors": [],
            "dry_run": False, "committed": res["slug"], "action": res["action"]}


# ── Multi-word (one-lesson-per-file) import ───────────────────────────────────

_FENCE_RE = re.compile(r"^---[ \t]*$")


def split_word_blocks(text: str) -> list[str]:
    r"""A lesson file = N word-blocks concatenated, each a standard
    ``---\n<frontmatter>\n---\n<body>`` document (the content_vocab shape). Split
    it so each block can be parsed independently.

    A ``---`` line only OPENS a new block when the text up to the next ``---``
    parses as a YAML *dict* (frontmatter). A markdown horizontal-rule ``---``
    inside a body (whose between-fences text isn't ``key: value``) is therefore
    NOT a block boundary — so a word's prose can't accidentally split it. A
    single-word file returns ``[text]`` unchanged (backward-compat); a file with
    no frontmatter at all returns ``[text]`` too, so the per-block parser raises
    the same FrontmatterError as before."""
    raw = (text or "").lstrip("﻿")
    lines = raw.splitlines()
    n = len(lines)

    def _opens_block(i: int) -> bool:
        if i >= n or not _FENCE_RE.match(lines[i]):
            return False
        j = i + 1
        while j < n and not _FENCE_RE.match(lines[j]):
            j += 1
        if j >= n:
            return False                       # no closing fence
        try:
            return isinstance(yaml.safe_load("\n".join(lines[i + 1:j])), dict)
        except yaml.YAMLError:
            return False

    blocks: list[str] = []
    i = 0
    while i < n:
        while i < n and lines[i].strip() == "":   # tolerate blank separators
            i += 1
        if i >= n:
            break
        if not _opens_block(i):
            # No frontmatter opens here. Nothing parsed yet → hand the whole file
            # to the single-doc parser (preserves the old FrontmatterError path);
            # otherwise it's trailing junk after the last block — stop.
            if not blocks:
                return [raw]
            break
        # closing fence of this block
        j = i + 1
        while j < n and not _FENCE_RE.match(lines[j]):
            j += 1
        # body runs until the next block-opening fence (or EOF)
        k = j + 1
        while k < n and not _opens_block(k):
            k += 1
        blocks.append("\n".join(lines[i:k]).strip() + "\n")
        i = k

    return blocks or [raw]


def import_vocab_file(
    text: str, *, dry_run: bool = True,
    import_batch_id: Optional[str] = None,
) -> dict:
    """Import a lesson file of ONE-OR-MANY word blocks.

    Each block is parsed + validated INDEPENDENTLY (one bad block never aborts
    the others — every error surfaces in one pass so the editor fixes them once).
    Duplicate slugs WITHIN the file are a batch error. Commit is ALL-OR-NOTHING:
    if any block has an error (frontmatter / validation / duplicate-in-batch)
    nothing is written — fix the file and re-upload. Idempotent (upsert-by-slug).

    Returns a superset of import_vocab_markdown's shape:
      {dry_run, blocks:[{index, headword, slug, parsed_data, action,
       validation_errors}], validation_errors:[{block, headword, field, message}],
       committed_ids:[slug], summary:{total, created, updated, errors},
       duplicate_slugs:[slug], parsed_data, action}
    parsed_data/action mirror the single block when the file holds exactly one."""
    chunks = split_word_blocks(text)

    blocks: list[dict] = []
    for idx, chunk in enumerate(chunks):
        entry: dict = {"index": idx, "headword": "", "slug": "", "_cat": "",
                       "parsed_data": None, "action": None, "validation_errors": []}
        try:
            parsed = parse_vocab_markdown(chunk)
        except FrontmatterError as exc:
            entry["validation_errors"].append({"field": "frontmatter", "message": str(exc)})
            entry["_parsed"] = None
            blocks.append(entry)
            continue
        entry["headword"] = parsed.headword
        entry["slug"] = parsed.slug
        entry["_cat"] = parsed.category   # for per-(category, slug) dedup below
        entry["parsed_data"] = parsed.as_preview()
        entry["validation_errors"] = validate_vocab(parsed)
        entry["_parsed"] = parsed
        blocks.append(entry)

    # Duplicate (category, slug) within the SAME file → batch error on every
    # colliding block. Identity is per-category (mig 122): the same word under two
    # DIFFERENT categories in one file is allowed (it lands in two topics); only a
    # true same-category repeat is a duplicate.
    seen: dict[tuple[str, str], list[int]] = {}
    for b in blocks:
        if b["slug"]:
            seen.setdefault((b["_cat"], b["slug"]), []).append(b["index"])
    dup_pairs = {pair for pair, idxs in seen.items() if len(idxs) > 1}
    duplicate_slugs = sorted({slug for (_cat, slug) in dup_pairs})
    for b in blocks:
        if b["slug"] and (b["_cat"], b["slug"]) in dup_pairs:
            b["validation_errors"].append({
                "field": "slug",
                "message": f"Trùng '{b['slug']}' (cùng chủ đề '{b['_cat']}') với block khác trong file.",
            })

    has_errors = any(b["validation_errors"] for b in blocks)

    # Dry-run: look up which (category, slug) pairs already exist so the preview
    # shows "thêm mới" vs "cập nhật". Matched per-pair (mig 122) — the same slug
    # under a NEW category forecasts "created", not "updated".
    if dry_run:
        checkable = [b["slug"] for b in blocks if b["slug"] and not b["validation_errors"]]
        if checkable:
            ex = (supabase_admin.table("vocab_cards")
                  .select("slug, category").in_("slug", checkable).execute())
            existing_pairs = {(r.get("category"), r.get("slug")) for r in (ex.data or [])}
            for b in blocks:
                if b["slug"] and not b["validation_errors"]:
                    b["db_action"] = "updated" if (b["_cat"], b["slug"]) in existing_pairs else "created"

    committed_ids: list[str] = []
    if not dry_run and not has_errors:
        for b in blocks:
            res = upsert_vocab_card(
                build_vocab_payload(b["_parsed"], import_batch_id=import_batch_id))
            b["action"] = res["action"]
            committed_ids.append(res["slug"])

    flat_errors = [
        {"block": b["index"], "headword": b["headword"],
         "field": e["field"], "message": e["message"]}
        for b in blocks for e in b["validation_errors"]
    ]
    summary = {
        "total":            len(blocks),
        "created":          sum(1 for b in blocks if b["action"] == "created"),
        "updated":          sum(1 for b in blocks if b["action"] == "updated"),
        "errors":           sum(1 for b in blocks if b["validation_errors"]),
        "forecast_created": sum(1 for b in blocks if b.get("db_action") == "created"),
        "forecast_updated": sum(1 for b in blocks if b.get("db_action") == "updated"),
    }
    pub_blocks = [{k: v for k, v in b.items() if k not in ("_parsed", "_cat")} for b in blocks]

    result = {
        "dry_run": dry_run,
        "blocks": pub_blocks,
        "validation_errors": flat_errors,
        "committed_ids": committed_ids,
        "summary": summary,
        "duplicate_slugs": duplicate_slugs,
        # Backward-compat single-block mirrors (the simple FE preview + the
        # existing route tests read these top-level fields).
        "parsed_data": pub_blocks[0]["parsed_data"] if len(pub_blocks) == 1 else None,
        "action":      pub_blocks[0]["action"] if len(pub_blocks) == 1 else None,
    }
    return result
