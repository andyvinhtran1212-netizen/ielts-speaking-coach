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
READING_CONTENT_TYPES = ("reading_passage_l1", "reading_skill_exercise", "reading_full_test")
DIFFICULTY_LEVELS     = ("foundation", "intermediate", "advanced")
SKILL_TAGS            = ("skimming", "scanning", "detail", "main_idea",
                         "inference", "vocabulary_in_context",
                         "reference_cohesion", "writer_view_TFNG")
# Sprint 20.3 — content_type → reading_passages.library mapping.
# Sprint 20.5 — L3 full-test pipeline now LIVE.
_LIBRARY_BY_CONTENT_TYPE = {
    "reading_passage_l1":     "l1_vocab",
    "reading_skill_exercise": "l2_skill",
    "reading_full_test":      "l3_test",
}
# Sprint 20.5 — L3 module enum (Academic ships now; General Training = Phase B).
READING_TEST_MODULES = ("academic", "general_training")
# Sprint 20.2 — the question types L1 light-comprehension Qs may author
# (the DB CHECK in mig 086 allows the full IELTS set; the AUTHORING subset
# is restricted to the whitelist here, matching reading_content_format_v2.md).
#
# Sprint 20.14b — Phase B unlock: the 7 missing IELTS reading types
# join the whitelist. AVR-READ-002 seed exercises them; v2 spec §4.2 +
# §4.3 document the per-type authoring shape and grader semantics.
#   • mcq_multi               — choose N of M; answer is a list of labels
#   • matching_information    — pick paragraph letter (A–H of passage)
#   • matching_features       — match statement to feature A–E (with bank)
#   • matching_sentence_endings — match beginning to ending A–G (with bank)
#   • flow_chart_completion   — gap-fill in a vertical chain of boxes
#   • diagram_label_completion — gap-fill on a labeled diagram
# `summary_completion` keeps the same enum tag for BOTH the no-word-bank
# (§2A.10) and the with-word-bank (§2A.11) variants; the distinguishing
# signal is the presence of authored `options:` (word bank present ⇒
# word-bank variant). See §4.2 of the v2 spec.
READING_QUESTION_TYPES_PHASE1 = (
    "mcq_single", "true_false_not_given", "yes_no_not_given",
    "sentence_completion", "summary_completion", "notes_completion",
    "table_completion", "form_completion", "short_answer", "matching_headings",
    # Sprint 20.14b — Phase B types added:
    "mcq_multi", "matching_information", "matching_features",
    "matching_sentence_endings", "flow_chart_completion",
    "diagram_label_completion",
)
# Sprint 20.6.6 — question types that render a labelled-choice list and
# therefore REQUIRE author-level `options: [{label, text}, …]`. Other types
# (T/F/NG, Y/N/NG, *_completion without word bank, short_answer, matching_
# information) carry implied or free-text answers and don't need `options`.
# `matching_information` is the outlier in the matching family — its
# "options" are the paragraphs of the passage itself, identified by
# label inline, so the question doesn't author a separate bank.
_READING_QUESTION_TYPES_REQUIRE_OPTIONS = (
    "mcq_single", "matching_headings",
    # Sprint 20.14b — Phase B types with shared option banks:
    "mcq_multi", "matching_features", "matching_sentence_endings",
)

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


# ── Sprint 20.1/20.3 — Reading-module passage import (L1 + L2) ───────
# Single parser + validator + builder for both L1 vocab passages
# (`reading_passage_l1` → library='l1_vocab') and L2 skill-practice
# exercises (`reading_skill_exercise` → library='l2_skill'). L1 and L2
# differ only by the required `skill_focus` field and the derived
# library — everything else (title, slug, body, glossary, questions,
# image) is shared. Lands in reading_passages, NOT writing_tips (reading
# keeps its own tables per the cluster 20.0 Discovery watch-item).
# The router (admin_reading.py) owns the supabase upsert + auth.


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
    skill_focus:       Optional[str] = None
    translation_vi:    Optional[str] = None   # full Vietnamese passage translation
    questions:         list = field(default_factory=list)
    raw_frontmatter:   dict = field(default_factory=dict)

    @property
    def library(self) -> Optional[str]:
        """Derived `reading_passages.library` value (None when the
        content_type is unrecognised — validate flags that separately)."""
        return _LIBRARY_BY_CONTENT_TYPE.get(self.content_type or "")

    def as_preview(self) -> dict:
        """Flat dict for the admin import preview. library is derived from
        content_type so the preview matches the committed row."""
        return {
            "content_type":      self.content_type,
            "library":           self.library,
            "title":             self.title,
            "slug":              self.slug,
            "difficulty_level":  self.difficulty_level,
            "topic_tags":        self.topic_tags,
            "image_url":         self.image_url,
            "glossary":          self.glossary,
            "skill_focus":       self.skill_focus,
            "word_count":        self.word_count,
            "estimated_minutes": self.estimated_minutes,
            "published":         self.published,
            "question_count":    len(self.questions),
            "body_markdown":     self.body_markdown,
            "translation_vi":    self.translation_vi,   # dry-run preview confirms capture
        }


def parse_reading_passage(text: str) -> ParsedReadingPassage:
    """Parse a reading passage (L1 vocab OR L2 skill-exercise) — Markdown +
    YAML frontmatter. Raises FrontmatterError when no frontmatter block
    exists. glossary/questions/skill_focus are pulled here; shape
    validation is deferred to validate_reading_passage (which reads
    raw_frontmatter to flag non-list glossary/questions)."""
    fm, body = _split_frontmatter(text)
    raw_glossary = fm.get("glossary")
    raw_questions = fm.get("questions")

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
        skill_focus       = _as_str(fm.get("skill_focus")),
        translation_vi    = _as_str(fm.get("translation_vi")),
        questions         = raw_questions if isinstance(raw_questions, list) else [],
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

    # Sprint 20.3 — skill_focus rules differ by content type. Required for L2
    # skill-practice exercises (it's the primary skill the exercise targets);
    # ignored/optional for L1. Either way, if present it must be a valid D2 tag.
    if p.content_type == "reading_skill_exercise":
        if not p.skill_focus:
            err("skill_focus",
                f"Bài luyện kỹ năng (L2) bắt buộc 'skill_focus' "
                f"(một trong: {', '.join(SKILL_TAGS)}).")
        elif p.skill_focus not in SKILL_TAGS:
            err("skill_focus", f"Phải là một trong: {', '.join(SKILL_TAGS)}.")
    elif p.skill_focus is not None and p.skill_focus not in SKILL_TAGS:
        err("skill_focus", f"Phải là một trong: {', '.join(SKILL_TAGS)} (hoặc bỏ trống).")

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

    # Light comprehension questions (optional). Read raw so a non-list is flagged.
    raw_questions = p.raw_frontmatter.get("questions")
    if raw_questions is not None:
        errors.extend(validate_reading_questions(raw_questions))

    return errors


def validate_reading_questions(questions: Any) -> list[dict]:
    """Validate the `questions` block (L1 comprehension Qs, L2 exercises, L3
    per-passage Qs all share this validator). Each item must follow the FLAT
    author shape — see reading_content_format_v2.md §4. Empty list = valid
    (passages may have no comprehension Qs).

    Sprint 20.6.6 (F1+F2 — silent→loud):

    * F1 — `payload:` at the question top level and dict-valued `answer:` are
      the **nested storage shape** (what the builder produces, not what the
      author writes). The v1 spec example accidentally leaked that shape; the
      old validator let it through, and the builder silently dropped
      `payload.options` + double-nested the answer (rows that render without
      choices and never grade correctly). We now reject both **loudly** so
      content authors see the error at dry-run instead of in production.
    * F2 — `mcq_single` and `matching_headings` render a labelled-choice list;
      a missing/empty `options:` makes the question render with the prompt
      and no choices. Require `options:` for those types, and verify each
      entry is `{label, text}`.
    """
    errors: list[dict] = []

    def err(message: str) -> None:
        errors.append({"field": "questions", "message": message})

    if not isinstance(questions, list):
        err("questions phải là danh sách câu hỏi.")
        return errors

    seen_qnums: set = set()
    for i, q in enumerate(questions):
        label = f"Câu hỏi #{i + 1}"
        if not isinstance(q, dict):
            err(f"{label}: phải là các cặp key: value.")
            continue
        qn = q.get("q_num")
        if not isinstance(qn, int) or isinstance(qn, bool) or qn <= 0:
            err(f"{label}: cần 'q_num' là số nguyên dương.")
        elif qn in seen_qnums:
            err(f"{label}: q_num {qn} bị trùng.")
        else:
            seen_qnums.add(qn)
        qtype = q.get("question_type")
        if qtype not in READING_QUESTION_TYPES_PHASE1:
            err(f"{label}: 'question_type' phải là một trong "
                f"{', '.join(READING_QUESTION_TYPES_PHASE1)}.")
        if not _as_str(q.get("prompt")):
            err(f"{label}: thiếu 'prompt'.")

        # F1 — `payload:` at the question top level is the v1-spec nested
        # storage shape. The builder constructs `payload` itself from the
        # author's top-level `options:` / `template:`; an author-level
        # `payload:` is always a sign the file follows the wrong template
        # (and would silently drop the options).
        if "payload" in q:
            err(f"{label}: KHÔNG đặt 'payload:' ở cấp câu hỏi — đó là cấu trúc "
                "lưu trữ DB, không phải định dạng tác giả. Đặt 'options:' "
                "(và 'template:' nếu có) trực tiếp ở cấp câu hỏi. "
                "Xem reading_content_format_v2.md §4.")

        # F1 — `answer:` must be a string (or a list of strings for the
        # Phase B `mcq_multi`). A dict-valued `answer:` is the nested storage
        # shape (`{answer: "B", alternatives: []}`) and would double-nest
        # at build time, breaking every student attempt.
        ans = q.get("answer")
        if isinstance(ans, dict):
            err(f"{label}: 'answer:' phải là chuỗi (vd: answer: \"B\"), "
                "không phải dict {answer, alternatives}. Đó là cấu trúc lưu "
                "trữ DB — đặt 'alternatives:' riêng ở cấp câu hỏi. "
                "Xem reading_content_format_v2.md §4.")
        elif ans is None or (isinstance(ans, str) and not ans.strip()) or \
                (isinstance(ans, list) and not ans):
            err(f"{label}: thiếu 'answer'.")

        # `alternatives:` (when present) must be a list. The builder silently
        # coerces non-list values to []; the validator now flags this so the
        # author notices spelling/T-F shortcuts they intended to allow.
        alts = q.get("alternatives")
        if alts is not None and not isinstance(alts, list):
            err(f"{label}: 'alternatives:' phải là danh sách chuỗi "
                "(vd: [\"F\", \"false\"]); một chuỗi đơn sẽ bị bỏ qua.")

        # F2 — options-list questions need a non-empty `options:` of
        # {label, text} entries. (Other Phase 1 types — T/F/NG, Y/N/NG,
        # *_completion, short_answer — don't need options.)
        if qtype in _READING_QUESTION_TYPES_REQUIRE_OPTIONS:
            opts = q.get("options")
            if not isinstance(opts, list) or not opts:
                err(f"{label}: '{qtype}' bắt buộc có 'options:' "
                    "là danh sách không rỗng các mục {label, text} ở cấp "
                    "câu hỏi. Xem reading_content_format_v2.md §4.2.")
            else:
                for j, opt in enumerate(opts):
                    if not isinstance(opt, dict) or \
                            not _as_str(opt.get("label")) or \
                            not _as_str(opt.get("text")):
                        err(f"{label}: options[{j}] cần 'label' và 'text'.")
                        break  # one option-shape error per question is enough

        if q.get("skill_tag") not in SKILL_TAGS:
            err(f"{label}: 'skill_tag' phải là một trong "
                f"{', '.join(SKILL_TAGS)}.")

    return errors


def build_reading_question_payloads(questions: list, passage_id: str) -> list[dict]:
    """Map validated question dicts to reading_questions row payloads. Splits
    the render-time fields (options/template → payload JSONB) from the answer
    key ({answer, alternatives} → answer JSONB) so the student fetch can strip
    the key column."""
    rows: list[dict] = []
    for i, q in enumerate(questions):
        payload: dict = {}
        if isinstance(q.get("options"), list):
            payload["options"] = q["options"]
        if isinstance(q.get("template"), dict):
            payload["template"] = q["template"]
        # reading-rich-test-solution — the detailed "chữa bài" solution rides
        # payload.solution (Pattern #15; no schema change). Shape: {band, steps,
        # source_excerpt, vocab, paraphrase, trap_analysis, tips, skill_code}.
        if isinstance(q.get("solution"), dict) and q["solution"]:
            payload["solution"] = q["solution"]
        alternatives = q.get("alternatives")
        rows.append({
            "passage_id":    passage_id,
            "q_num":         q.get("q_num"),
            "question_type": q.get("question_type"),
            "prompt":        _as_str(q.get("prompt")),
            "payload":       payload,
            "answer":        {
                "answer":       q.get("answer"),
                "alternatives": alternatives if isinstance(alternatives, list) else [],
            },
            "skill_tag":     q.get("skill_tag"),
            "sub_skill":     _as_str(q.get("sub_skill")),
            "explanation":   _as_str(q.get("explanation")),
            "order_num":     i + 1,
        })
    return rows


def build_reading_passage_payload(p: ParsedReadingPassage, slug: str) -> dict:
    """Map a validated passage to a reading_passages row payload. library is
    DERIVED from content_type (Sprint 20.3 generalisation): L1 → 'l1_vocab',
    L2 → 'l2_skill'. The `published` bool maps to the status enum. skill_focus
    is persisted for L2 (the schema CHECK in mig 086 allows it for L1/L3 too
    but the column is L2-meaningful). `created_by` is stamped by the router on
    INSERT only."""
    payload = {
        "library":           p.library,
        "slug":              slug,
        "title":             p.title,
        "body_markdown":     p.body_markdown,
        "difficulty_level":  p.difficulty_level,
        "topic_tags":        p.topic_tags,
        "image_url":         p.image_url,
        "glossary":          p.glossary if isinstance(p.glossary, list) else [],
        "skill_focus":       p.skill_focus,
        "word_count":        p.word_count,
        "estimated_minutes": p.estimated_minutes,
        "status":            "published" if p.published else "draft",
    }
    # Full Vietnamese translation lives in the metadata JSONB (no schema change —
    # reading_passages.metadata is the catch-all). Only written when present, so
    # passages without a translation keep their existing metadata untouched.
    if p.translation_vi:
        payload["metadata"] = {"translation_vi": p.translation_vi}
    return payload


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


# ── Sprint 20.5 — L3 full-test import (reading_full_test) ─────────────
# L3 is structurally different from L1/L2: a single .md file describes ONE
# reading_tests row + 3 reading_passages rows (library='l3_test', passage_order
# 1..3) + their reading_questions (40 total, q_num continuous across the test).
# Implementation choice (Code-authoritative per the 20.4-spec note): the entire
# test shape is carried in YAML frontmatter (test metadata + passages list +
# questions per passage). The markdown body of the .md file is intentionally
# unused — keeps parsing trivial (no markdown-header scanning, no fenced-JSON
# extraction) and reuses the L1 questions-in-YAML idiom.


@dataclass
class ParsedReadingTest:
    content_type:       Optional[str]
    test_id:            Optional[str]
    title:              Optional[str]
    module:             Optional[str]
    time_limit_minutes: Optional[int]
    passage_count:      Optional[int]
    total_questions:    Optional[int]
    band_target:        Optional[float]
    published:          bool
    passages:           list                       # list of raw passage dicts
    raw_frontmatter:    dict = field(default_factory=dict)

    @property
    def library(self) -> Optional[str]:
        return _LIBRARY_BY_CONTENT_TYPE.get(self.content_type or "")

    def as_preview(self) -> dict:
        passage_summary = []
        total_qs = 0
        for p in self.passages:
            if not isinstance(p, dict):
                continue
            qs = p.get("questions") if isinstance(p.get("questions"), list) else []
            total_qs += len(qs)
            passage_summary.append({
                "passage_order": p.get("passage_order"),
                "title":         p.get("title"),
                "slug":          p.get("slug"),
                "word_count":    p.get("word_count"),
                "question_count": len(qs),
            })
        return {
            "content_type":       self.content_type,
            "library":            self.library,
            "test_id":            self.test_id,
            "title":              self.title,
            "module":             self.module,
            "time_limit_minutes": self.time_limit_minutes,
            "passage_count":      self.passage_count,
            "total_questions":    self.total_questions,
            "band_target":        self.band_target,
            "published":          self.published,
            "passages":           passage_summary,
            "question_count":     total_qs,
        }


def parse_reading_test(text: str) -> ParsedReadingTest:
    """Parse an L3 full-test markdown file (YAML-only frontmatter). The body of
    the .md is unused for L3 — all test data lives in frontmatter."""
    fm, _body = _split_frontmatter(text)
    raw_passages = fm.get("passages")
    return ParsedReadingTest(
        content_type       = _as_str(fm.get("content_type")),
        test_id            = _as_str(fm.get("test_id")),
        title              = _as_str(fm.get("title")),
        module             = _as_str(fm.get("module")) or "academic",
        time_limit_minutes = _as_opt_int(fm.get("time_limit_minutes")) or 60,
        passage_count      = _as_opt_int(fm.get("passage_count")) or 3,
        total_questions    = _as_opt_int(fm.get("total_questions")) or 40,
        band_target        = _as_opt_float(fm.get("band_target")),
        published          = bool(fm.get("published", False)),
        passages           = raw_passages if isinstance(raw_passages, list) else [],
        raw_frontmatter    = fm,
    )


_TEST_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{1,63}$")


def validate_reading_test(p: ParsedReadingTest) -> list[dict]:
    """Validate an L3 parsed test. Returns a list of {field, message} errors.
    Checks test metadata, the 3-passage structure, and each passage's questions
    (via validate_reading_questions for type/skill_tag/answer-key shape)."""
    errors: list[dict] = []

    def err(fieldname: str, message: str) -> None:
        errors.append({"field": fieldname, "message": message})

    if p.content_type != "reading_full_test":
        err("content_type", "L3 phải dùng content_type=reading_full_test.")
    if not p.test_id or not _TEST_ID_RE.match(p.test_id):
        err("test_id", "test_id bắt buộc (chữ/số/dấu - hoặc _; ví dụ 'AVR-READ-001').")
    if not p.title or len(p.title) < 2:
        err("title", "Bắt buộc, tối thiểu 2 ký tự.")
    elif len(p.title) > 200:
        err("title", "Tối đa 200 ký tự.")
    if p.module not in READING_TEST_MODULES:
        err("module", f"Phải là một trong: {', '.join(READING_TEST_MODULES)}.")
    if not isinstance(p.time_limit_minutes, int) or p.time_limit_minutes <= 0:
        err("time_limit_minutes", "Phải là số nguyên dương (phút).")
    if not isinstance(p.passage_count, int) or not (1 <= p.passage_count <= 3):
        err("passage_count", "Phải là 1–3.")
    if not isinstance(p.total_questions, int) or not (1 <= p.total_questions <= 40):
        err("total_questions", "Phải là 1–40.")
    if p.band_target is not None and not (1.0 <= p.band_target <= 9.0):
        err("band_target", "band_target phải nằm trong 1.0–9.0 (hoặc bỏ trống).")

    # Passages list shape.
    if not isinstance(p.passages, list) or not p.passages:
        err("passages", "passages phải là danh sách (1–3 mục).")
        return errors

    if len(p.passages) != p.passage_count:
        err("passages", f"Số passages ({len(p.passages)}) khác passage_count ({p.passage_count}).")

    seen_orders: set = set()
    seen_slugs: set = set()
    all_q_nums: list[int] = []

    for i, pas in enumerate(p.passages):
        label = f"Passage #{i + 1}"
        if not isinstance(pas, dict):
            err("passages", f"{label}: phải là các cặp key: value.")
            continue
        order = pas.get("passage_order")
        if not isinstance(order, int) or not (1 <= order <= 3):
            err("passages", f"{label}: 'passage_order' phải là 1–3.")
        elif order in seen_orders:
            err("passages", f"{label}: passage_order {order} bị trùng.")
        else:
            seen_orders.add(order)
        slug = _as_str(pas.get("slug"))
        if not slug or not _SLUG_RE.match(slug):
            err("passages", f"{label}: 'slug' bắt buộc (chữ thường a–z, số, gạch ngang).")
        elif slug in seen_slugs:
            err("passages", f"{label}: slug '{slug}' bị trùng.")
        else:
            seen_slugs.add(slug)
        if not _as_str(pas.get("title")):
            err("passages", f"{label}: 'title' bắt buộc.")
        body = pas.get("body_markdown")
        if not (isinstance(body, str) and body.strip()):
            err("passages", f"{label}: 'body_markdown' không được để trống.")
        elif len(body) > MAX_BODY_CHARS:
            err("passages", f"{label}: 'body_markdown' vượt quá {MAX_BODY_CHARS} ký tự.")

        qs = pas.get("questions") if isinstance(pas.get("questions"), list) else None
        if not qs:
            err("passages", f"{label}: 'questions' phải là danh sách câu hỏi.")
            continue
        # Reuse the L1 per-question validator (type/skill_tag/answer shape).
        q_errs = validate_reading_questions(qs)
        for e in q_errs:
            errors.append({"field": "passages", "message": f"{label} → {e['message']}"})
        for q in qs:
            if isinstance(q, dict) and isinstance(q.get("q_num"), int):
                all_q_nums.append(q["q_num"])

    # q_num must be unique + continuous across the WHOLE test (1..total_questions).
    if all_q_nums:
        dups = {n for n in all_q_nums if all_q_nums.count(n) > 1}
        if dups:
            err("passages", f"q_num bị trùng giữa các passages: {sorted(dups)}.")
        if len(all_q_nums) != p.total_questions:
            err("passages",
                f"Tổng số câu hỏi ({len(all_q_nums)}) khác total_questions ({p.total_questions}).")

    return errors


def build_reading_test_payloads(p: ParsedReadingTest) -> dict:
    """Map a validated L3 test to a 3-table insert plan:
      • test_row     — one reading_tests row (insert/update keyed by test_id)
      • passage_rows — 3 reading_passages rows (library='l3_test'; passage_id
                       is assigned by the DB on insert; the router fills
                       passage_id back into each question row before inserting)
      • passage_questions — list of (slug, [question_row_without_passage_id])
                       tuples so the router can fan questions out by passage.
    """
    test_row = {
        "test_id":            p.test_id,
        "title":              p.title,
        "module":             p.module or "academic",
        "time_limit_minutes": p.time_limit_minutes or 60,
        "passage_count":      p.passage_count or len(p.passages),
        "total_questions":    p.total_questions or sum(len(pas.get("questions") or []) for pas in p.passages),
        "band_target":        p.band_target,
        "status":             "published" if p.published else "draft",
    }

    passage_rows: list[dict] = []
    passage_questions: list[tuple] = []
    for pas in p.passages:
        slug = _as_str(pas.get("slug"))
        prow = {
            "library":          "l3_test",
            "slug":             slug,
            "title":            _as_str(pas.get("title")),
            "body_markdown":    pas.get("body_markdown"),
            "passage_order":    pas.get("passage_order"),
            "word_count":       _as_opt_int(pas.get("word_count")),
            "estimated_minutes": _as_opt_int(pas.get("estimated_minutes")),
            "topic_tags":       _as_str_list(pas.get("topic_tags")),
            "status":           "published" if p.published else "draft",
        }
        # reading-rich-test-solution — passage translation + extracted IMG-PROMPT
        # blocks ride reading_passages.metadata JSONB (Pattern #15, like #372).
        meta: dict = {}
        if _as_str(pas.get("translation_vi")):
            meta["translation_vi"] = pas.get("translation_vi")
        if isinstance(pas.get("img_prompts"), list) and pas["img_prompts"]:
            meta["img_prompts"] = pas["img_prompts"]
        if meta:
            prow["metadata"] = meta
        passage_rows.append(prow)
        # Build per-question payloads WITHOUT passage_id (router fills it).
        qs = pas.get("questions") or []
        q_rows_partial = build_reading_question_payloads(qs, passage_id="__placeholder__")
        for r in q_rows_partial:
            r.pop("passage_id", None)
        passage_questions.append((slug, q_rows_partial))

    return {
        "test_row":          test_row,
        "passage_rows":      passage_rows,
        "passage_questions": passage_questions,
    }


def _as_opt_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
