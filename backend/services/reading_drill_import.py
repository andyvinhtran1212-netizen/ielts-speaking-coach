"""reading_drill_import.py — single-passage skill-drill → ParsedReadingTest.

Parses the `03_Drills_By_Type/` drill + solution markdown pair (one passage,
one question type, 7 questions) into the SAME `ParsedReadingTest` structure the
strict-YAML L3 importer produces, so the drills flow through the proven
validate → build → store pipeline and land as Reading **mini** tests
(`reading_tests.test_type = 'mini'`, mig 158).

Why a separate scanner (not `reading_prose_import`): the drill format differs
from the full-test prose format on every structural anchor, so the full-test
parser silently returns 0 passages / 0 questions on a drill file:

  full test                        drill
  ─────────────────────────────    ──────────────────────────────────────
  ## READING PASSAGE 1             ## Passage — <Title>
  ### Questions 1-13               ## Questions 1–7   (en-dash, h2)
  **1** statement                  1. statement       (ordered list)
  | Q | Type | Answer | Band |     | Q | Type | Answer | Band | Skill |
                                   | Q | Type | Answer | Accept | Band | Skill |

Isolated from both existing parsers so it cannot regress them.

RENDER CONTRACT (this is why per-type prompt building differs — see
`_QUESTION_BUILDERS`): in reading, ONLY `passages.body_markdown` is
markdown-rendered. Question prompts and note/summary templates are emitted as
plain-text DOM nodes, so any `**bold**` left in them shows literal asterisks to
the student. `_plain()` strips inline emphasis from everything except the
passage body.

`template.summary_text` (the ONE flowing block with inline numbered blanks) is
only honoured by the renderer for `summary_completion` + `notes_completion`
(reading-exam.js ~line 689). Table / flow-chart / diagram / sentence completion
therefore get SELF-CONTAINED per-question prompts instead — a prompt that says
"(see table above)" with no table above is an unanswerable question. Keeping
the prompts self-contained also preserves compatibility with older renderers.
"""

from __future__ import annotations

import re
from typing import Optional

from services.content_import_service import ParsedReadingTest, slugify
from services.reading_prose_import import (
    _SKILL_CODE_TO_TAG,
    parse_rich_solutions,
    parse_skill_distribution,
)


_DASH = r"[–—\-]"


# ── Per-question solution header ──────────────────────────────────────
#
# The full-test dialect (`reading_prose_import._SOL_HDR_RE`) requires a skill
# NAME after the skill code and nothing after the closing `**`:
#
#     **Câu 1 — Đáp án: X · Kỹ năng: SCAN Định vị thông tin · Band 5.5**
#
# The drill corpus writes four further dialects, and the strict regex silently
# skips ALL of them — every `- *Các bước…*` bullet is then dropped and the
# question lands with an EMPTY solution, so the review page renders no
# "Xem lời giải" toggle at all (72/168 drill solutions, incl. TC-L2-T1
# "Bringing Back the Mangroves"):
#
#     … · Kỹ năng: PARA · Band 6.5**              code only, no name
#     **Câu 1 — Đoạn A · Đáp án: …                paragraph ref before the answer
#     **Câu 3 (Đoạn B) — Đáp án: …                paragraph ref after the number
#     … · Số từ: 1–2 · Kỹ năng: …                 word-count segment
#     … · Band 8.5–9.0**  /  Band 6.0**  ⟵ *…*    band range / trailing note
#
# Same 5 positional groups as the strict one so `parse_rich_solutions` reads it
# unchanged; the extra segments are non-capturing.
_DRILL_SOL_HDR_RE = re.compile(
    r"^\*\*Câu\s+(\d+)"                            # 1 q_num
    r"(?:\s*\(\s*Đoạn\s+[0-9A-Za-z]+\s*\))?"       #   "(Đoạn B)"
    rf"\s*{_DASH}\s*"
    r"(?:Đoạn\s+[0-9A-Za-z]+\s*·\s*)?"             #   "Đoạn A ·"
    r"Đáp án:\s*(.+?)\s*·\s*"                      # 2 answer_display
    r"(?:Số từ:[^·]*·\s*)?"                        #   "Số từ: 1–2 ·"
    r"Kỹ năng:\s*([A-Za-z]+)"                      # 3 skill_code
    r"(?:\s+([^·]*?))?\s*·\s*"                     # 4 skill_name (optional)
    r"Band\s*([\d.]+)"                             # 5 band
    r"[^*\n]*\*\*[^\n]*$"                          #   band range / trailing note
)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


# Inline-emphasis strip. Everything outside `body_markdown` is rendered as a
# plain-text node, so `**x**` / `*x*` would show literal asterisks (the R8r/R3
# defect class fixed at the import layer in PR #814).
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)
_ITAL_RE = re.compile(r"(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)")


def _plain(s: str) -> str:
    s = _BOLD_RE.sub(r"\1", s or "")
    s = _ITAL_RE.sub(r"\1", s)
    return s


def _plain_field(v):
    """`_plain()` over a solution field — str, list[str], or a non-text value.

    The review page (`reading-review.js formatProse`) escapes HTML and renders
    only backticks + quoted spans; it does NOT read markdown, so `**a third**`
    reaches the learner as literal asterisks. Solution prose is authored with
    emphasis throughout, so it needs the same strip the prompts already get.
    Backticks are preserved — formatProse turns those into `<code>`.
    """
    if isinstance(v, str):
        return _plain(v)
    if isinstance(v, list):
        return [_plain(x) if isinstance(x, str) else x for x in v]
    return v


# ── Answer-cell expansion ─────────────────────────────────────────────
#
# The grader (`listening_test_grader.normalize_answer`) strips only SURROUNDING
# punctuation, so a stored key of "(digital) model" normalises to "digital)
# model" and NOTHING a student types can ever match it. Optional-word
# parentheses must therefore be expanded into real alternatives at import time.
#
#   "(digital) model"          → "model"          + ["digital model"]
#   "ultraviolet (radiation)"  → "ultraviolet"    + ["ultraviolet radiation"]
#   "supporting (accept: X)"   → "supporting"     + ["X"]
#
# The SHORTER (required-words-only) form is always the primary answer.

_ACCEPT_INLINE_RE = re.compile(r"^(.*?)\s*\(\s*accept:\s*(.+?)\s*\)\s*$", re.I)
_PAREN_RE = re.compile(r"\s*\(([^)]*)\)\s*")


def _variants(cell: str) -> list[str]:
    """Expand one answer cell into every accepted surface form, shortest first."""
    cell = _norm(cell)
    if not cell or cell in ("—", "-", "–"):
        return []
    m = _PAREN_RE.search(cell)
    if not m:
        return [cell]
    without = _norm(_PAREN_RE.sub(" ", cell))
    with_ = _norm(cell.replace("(", "").replace(")", ""))
    return [v for v in (without, with_) if v]


def _split_accept(cell: str) -> list[str]:
    """The `Accept` column: entries separated by ';' or '/'."""
    cell = _norm(cell)
    if not cell or cell in ("—", "-", "–"):
        return []
    out: list[str] = []
    for chunk in re.split(r"\s*[;/]\s*", cell):
        out.extend(_variants(chunk))
    return out


def _norm_key(s: str) -> str:
    """Dedup key — mirrors the grader's case/punctuation-insensitive compare."""
    return re.sub(r"[^\w\s]", "", (s or "").lower()).strip()


def expand_answer(primary_cell: str, accept_cell: str = "") -> tuple[str, list[str]]:
    """→ (answer, alternatives), deduped, answer excluded from alternatives."""
    inline_alts: list[str] = []
    cell = _norm(primary_cell)
    m = _ACCEPT_INLINE_RE.match(cell)
    if m:
        cell = _norm(m.group(1))
        for chunk in re.split(r"\s*[;/]\s*", m.group(2)):
            inline_alts.extend(_variants(chunk))

    forms = _variants(cell)
    if not forms:
        return "", []
    answer, rest = forms[0], forms[1:]

    alts: list[str] = []
    seen = {_norm_key(answer)}
    for cand in [*rest, *inline_alts, *_split_accept(accept_cell)]:
        k = _norm_key(cand)
        if k and k not in seen:
            seen.add(k)
            alts.append(cand)
    return answer, alts


# ── Solution: quick-answer table (variable column count) ──────────────

_TYPE_LABEL_TO_ENUM = {
    "true/false/not given":             "true_false_not_given",
    "yes/no/not given":                 "yes_no_not_given",
    "matching headings":                "matching_headings",
    "sentence completion":              "sentence_completion",
    "summary completion":               "summary_completion",
    "summary completion (no box)":      "summary_completion",
    "summary completion (with box)":    "summary_completion",
    "summary completion (without box)": "summary_completion",
    "note completion":                  "notes_completion",
    "notes completion":                 "notes_completion",
    "table completion":                 "table_completion",
    "flow-chart completion":            "flow_chart_completion",
    "flow chart completion":            "flow_chart_completion",
    "diagram label":                    "diagram_label_completion",
    "diagram label completion":         "diagram_label_completion",
    "short-answer":                     "short_answer",
    "short answer":                     "short_answer",
    "short-answer questions":           "short_answer",
    "multiple choice":                  "mcq_single",
}

# MH numbers its rows "1 (A)" — the paragraph letter rides along.
_QNUM_CELL_RE = re.compile(r"^(\d+)\s*(?:\(([A-Z])\))?$")


def _tables(text: str) -> list[list[list[str]]]:
    """Split markdown into CONTIGUOUS pipe-table blocks.

    Grouping matters: a drill solution may carry a second table right below the
    quick-answer one (DL adds `| Q | answer | answer_accept |`). Flattening every
    pipe row into a single list makes the second table's rows inherit the first
    table's header positions, so its answers get read as type labels and the
    real answers are dropped. Each block keeps its own header row.
    """
    tables: list[list[list[str]]] = []
    cur: list[list[str]] = []
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("|") and line.endswith("|") and len(line) > 1:
            cells = [c.strip() for c in line[1:-1].split("|")]
            if all(set(c) <= {"-", ":", " "} for c in cells):   # separator row
                continue
            cur.append(cells)
        elif cur:
            tables.append(cur)
            cur = []
    if cur:
        tables.append(cur)
    return tables


def _table_rows(text: str) -> list[list[str]]:
    return [row for tbl in _tables(text) for row in tbl]


def parse_quick_answers(sol_text: str, warnings: list) -> dict:
    """Parse `## Bảng đáp án nhanh` — column set varies by drill type
    (Q|Type|Answer|Band|Skill or Q|Type|Answer|Accept|Band|Skill), so columns
    are resolved by HEADER NAME rather than by position."""
    m = re.search(r"##\s*Bảng đáp án nhanh\s*\n(.*?)(?=\n##\s|\Z)", sol_text, re.DOTALL)
    if not m:
        warnings.append("Không tìm thấy bảng '## Bảng đáp án nhanh'.")
        return {}

    tables = _tables(m.group(1))
    if not tables:
        warnings.append("Bảng đáp án nhanh rỗng.")
        return {}

    # The section may hold TWO tables: the quick-answer grid, and (DL only) an
    # `answer_accept` grid listing extra accepted surface forms. Pick each by
    # header, and fold the second one's alternatives into the first.
    main: list[list[str]] | None = None
    extra_accept: dict[int, str] = {}
    for tbl in tables:
        header = [c.lower() for c in tbl[0]]
        if "q" in header and "type" in header and "answer" in header:
            if main is None:
                main = tbl
        elif "q" in header and any(h.startswith("answer_accept") for h in header):
            i_q2 = header.index("q")
            i_acc2 = next(i for i, h in enumerate(header) if h.startswith("answer_accept"))
            for cells in tbl[1:]:
                qm2 = _QNUM_CELL_RE.match(cells[i_q2]) if len(cells) > i_q2 else None
                if qm2 and len(cells) > i_acc2:
                    extra_accept[int(qm2.group(1))] = cells[i_acc2]

    if main is None:
        warnings.append("Bảng đáp án nhanh thiếu cột Q/Type/Answer.")
        return {}

    rows = main
    header = [c.lower() for c in rows[0]]
    i_q = header.index("q")
    i_type = header.index("type")
    i_ans = header.index("answer")
    i_accept = header.index("accept") if "accept" in header else None
    i_band = header.index("band") if "band" in header else None

    out: dict[int, dict] = {}
    for cells in rows[1:]:
        if len(cells) <= max(i_q, i_type, i_ans):
            continue
        qm = _QNUM_CELL_RE.match(cells[i_q])
        if not qm:
            continue
        q_num = int(qm.group(1))
        type_label = _norm(cells[i_type])
        enum = _TYPE_LABEL_TO_ENUM.get(type_label.lower())
        if not enum:
            warnings.append(
                f"Câu {q_num}: nhãn loại '{type_label}' chưa map — đáp án bị bỏ qua."
            )
            continue
        accept = cells[i_accept] if i_accept is not None and len(cells) > i_accept else ""
        if q_num in extra_accept:
            accept = f"{accept};{extra_accept[q_num]}" if _norm(accept) not in ("", "—") \
                else extra_accept[q_num]
        answer, alts = expand_answer(cells[i_ans], accept)
        if not answer:
            warnings.append(f"Câu {q_num}: ô Answer rỗng.")
            continue
        band = None
        if i_band is not None and len(cells) > i_band:
            try:
                band = float(cells[i_band])
            except ValueError:
                band = None
        out[q_num] = {
            "question_type": enum,
            "answer":        answer,
            "alternatives":  alts,
            "band":          band,
            "para_letter":   qm.group(2),
        }
    return out


def parse_translation(sol_text: str) -> Optional[str]:
    """The drill solution carries ONE passage, under
    `## Passage + Bản dịch sát nghĩa`, with `**Đoạn A.**`-prefixed paragraphs."""
    m = re.search(r"##\s*Passage\s*\+\s*Bản dịch[^\n]*\n(.*?)(?=\n##\s|\Z)",
                  sol_text, re.DOTALL)
    if not m:
        return None
    paras = []
    for raw in m.group(1).splitlines():
        line = raw.strip()
        pm = re.match(r"^\*\*Đoạn\s+([0-9A-Za-z]+)\.\*\*\s*(.*)$", line)
        if pm and _norm(pm.group(2)):
            paras.append(f"{pm.group(1)}. {_norm(_plain(pm.group(2)))}")
    return "\n\n".join(paras) if paras else None


# ── Drill: metadata + passage ─────────────────────────────────────────

def _meta(drill_text: str) -> dict:
    out = {}
    for cells in _table_rows(drill_text):
        if len(cells) == 2 and cells[0] not in ("Field",):
            out[cells[0]] = cells[1]
    return out


_QUESTIONS_HDR_RE = re.compile(rf"^##\s+Questions\s+(\d+)\s*{_DASH}\s*(\d+)\s*$", re.MULTILINE)
_PASSAGE_HDR_RE = re.compile(rf"^##\s+Passage\s*(?:{_DASH}\s*(.*))?$", re.MULTILINE)
# "[IMAGE_PROMPT: …]" is an image-GENERATION brief for the art pipeline, not
# student-facing content. It must never reach a prompt or a passage body.
_IMAGE_PROMPT_RE = re.compile(r"\[IMAGE_PROMPT:.*?\]", re.DOTALL)


def _parse_passage(drill_text: str) -> tuple[str, str, str]:
    """→ (title, body_markdown, questions_section)."""
    pm = _PASSAGE_HDR_RE.search(drill_text)
    qm = _QUESTIONS_HDR_RE.search(drill_text)
    if not pm or not qm:
        return "", "", ""
    title = _norm(_plain(pm.group(1) or ""))
    body = drill_text[pm.end():qm.start()]
    body = _IMAGE_PROMPT_RE.sub("", body).strip()
    return title, body, drill_text[qm.end():]


# ── Drill: per-type question extraction ───────────────────────────────

_NUM_ITEM_RE = re.compile(r"^(\d+)\.\s+(.*)$")
_ROMAN_ITEM_RE = re.compile(r"^([ivxlIVXL]+)[.)]\s+(\S.*)$")
# Blank runs: "……………", "...........", "____", "__________".
_BLANK_RUN_RE = re.compile(r"[.．…]{3,}|_{2,}")
# Numbered blank markers inside a note/summary/table template.
_MARK_BOLD_PAREN_RE = re.compile(r"\*\*\((\d{1,3})\)\*\*")   # **(1)**   — SUM
_MARK_BOLD_RE = re.compile(r"\*\*(\d{1,3})\*\*")             # **1**     — NC/TC


def _numbered_items(section: str) -> dict:
    """Ordered-list question stems ("1. text"), joined across wrapped lines."""
    out: dict[int, str] = {}
    cur: Optional[int] = None
    for raw in section.splitlines():
        line = raw.rstrip()
        m = _NUM_ITEM_RE.match(line.strip())
        if m:
            cur = int(m.group(1))
            out[cur] = _norm(m.group(2))
        elif cur is not None and line.strip() and not line.strip().startswith(("#", "|", "*", "[", ">")):
            out[cur] = _norm(out[cur] + " " + line.strip())
        elif not line.strip():
            cur = None
    return out


def _tidy(text: str) -> str:
    """Close the space a removed blank-run leaves in front of punctuation."""
    return _norm(re.sub(r"\s+([.,;:?!])", r"\1", text))


def _gap(text: str) -> str:
    """Normalise every blank run to one consistent gap glyph."""
    return _tidy(_BLANK_RUN_RE.sub("________", text))


def _build_statement(section: str, qa: dict, **_) -> dict:
    """TFNG / YNG / SAQ — the stem stands alone."""
    return {q: {"prompt": _plain(t)} for q, t in _numbered_items(section).items()}


def _build_sentence(section: str, qa: dict, **_) -> dict:
    """SC / FC / DL — self-contained stem carrying an inline gap."""
    out = {}
    for q, t in _numbered_items(section).items():
        text = _gap(_plain(t))
        # DL stems are "________ (descriptive hint)" — lead with the hint so the
        # prompt reads as a label instruction rather than a bare gap.
        dm = re.match(r"^_{3,}\s*\((.+)\)$", text)
        if dm:
            text = _norm(dm.group(1))
            text = text[0].upper() + text[1:] if text else text
        elif text and text[-1] not in ".?!":
            # The stem's final full stop is swallowed by the dot-leader blank
            # ("… a heated ............"); restore it so the step reads as a
            # sentence rather than trailing off.
            text += "."
        out[q] = {"prompt": text}
    return out


def _build_matching_headings(section: str, qa: dict, **_) -> dict:
    """MH — one shared roman-numeral heading bank on every question."""
    hm = re.search(r"\*\*List of Headings\*\*(.*?)(?=\n\s*\d+\.\s|\Z)", section, re.DOTALL)
    options = []
    if hm:
        for raw in hm.group(1).splitlines():
            om = _ROMAN_ITEM_RE.match(raw.strip())
            if om:
                options.append({"label": _norm(om.group(1)),
                                "text": _norm(_plain(om.group(2)))})
    out = {}
    for q, t in _numbered_items(section).items():
        out[q] = {"prompt": _norm(_plain(t)), "options": list(options)}
    return out


def _template_from(block: str) -> str:
    """Note/summary block → flowing template with `{{N}}` markers."""
    t = _MARK_BOLD_PAREN_RE.sub(r"{{\1}}", block)
    t = _MARK_BOLD_RE.sub(r"{{\1}}", t)
    t = _BLANK_RUN_RE.sub("", t)
    t = _plain(t)                                  # renderer emits text nodes
    return "\n".join(_tidy(l) for l in t.splitlines()).strip()


_MARKER_RE = re.compile(r"\{\{\s*(\d{1,3})\s*\}\}")


def _context_prompt(block: str, q_num: int) -> str:
    """The fragment of a flowing block that owns gap `q_num`.

    The exam renders the whole block, so the per-Q `prompt` is unused there —
    but the REVIEW page prints `prompt` under every question card, where a
    placeholder like "Câu 3" tells the learner nothing. Give each question its
    own sentence/line, with its gap shown as a blank and the other gaps kept as
    "(N)" so they stay identifiable without leaking their answers.
    """
    needle = "{{%d}}" % q_num
    seg = next((l for l in block.splitlines() if needle in l), "")
    if len(seg) > 200:      # a flowing summary paragraph — narrow to one sentence
        seg = next((s for s in re.split(r"(?<=[.!?])\s+", seg) if needle in s), seg)
    if not seg:
        return f"Câu {q_num}"
    seg = seg.replace(needle, "________")
    seg = _MARKER_RE.sub(lambda m: f"({m.group(1)})", seg)
    return _tidy(re.sub(r"^[•\-*]\s+", "", seg.strip()))


def _build_flowing(section: str, qa: dict, **_) -> dict:
    """SUM / NC — ONE connected block; the run's first Q carries the template.

    Renderer honours `template.summary_text` for exactly these two types.
    """
    body = section
    im = re.search(r"^\s*\*\*(.+?)\*\*\s*$", body, re.MULTILINE)   # block title
    start = im.start() if im else 0
    block = _template_from(body[start:])
    q_nums = sorted(qa.keys())
    out = {q: {"prompt": _context_prompt(block, q)} for q in q_nums}
    if q_nums and "{{" in block:
        out[q_nums[0]]["template"] = {"summary_text": block}
    return out


def _build_table(section: str, qa: dict, **_) -> dict:
    """TC — the renderer drops `summary_text` for table_completion on the
    CURRENT frontend, so each cell becomes a self-contained prompt carrying its
    row label ("Past losses — About ________ of global mangrove cover …").
    Blank row labels inherit the previous row's group, matching the rowspan
    grouping in the source table."""
    out: dict[int, dict] = {}
    group = ""
    for cells in _table_rows(section):
        if len(cells) < 2:
            continue
        label = _norm(_plain(cells[0]))
        if label.lower() in ("topic", "detail"):
            continue
        if label:
            group = label
        marks = _MARK_BOLD_RE.findall(cells[1])
        if not marks:
            continue
        # A table cell writes the gap as marker + dot-leader ("**1** ……………"),
        # so drop the leader FIRST and let the marker itself become the single
        # gap. Substituting the marker first instead yields a double gap, and
        # running `_plain()` first destroys the marker (leaving a bare "1").
        raw = _BLANK_RUN_RE.sub("", cells[1])
        text = _tidy(_plain(_MARK_BOLD_RE.sub("________", raw)))
        out[int(marks[0])] = {"prompt": f"{group} — {text}" if group else text}
    return out


_QUESTION_BUILDERS = {
    "true_false_not_given":      _build_statement,
    "yes_no_not_given":          _build_statement,
    "short_answer":              _build_statement,
    "sentence_completion":       _build_sentence,
    "flow_chart_completion":     _build_sentence,
    "diagram_label_completion":  _build_sentence,
    "matching_headings":         _build_matching_headings,
    "summary_completion":        _build_flowing,
    "notes_completion":          _build_flowing,
    "table_completion":          _build_table,
}


# ── Assemble ──────────────────────────────────────────────────────────

_BAND_RE = re.compile(r"target band\s*([\d.]+)")


def build_parsed_reading_test_from_drill(
    drill_text: str, sol_text: str, published: bool = False,
) -> ParsedReadingTest:
    """Merge one drill + its solution into a single-passage ParsedReadingTest."""
    warnings: list[str] = []
    qa = parse_quick_answers(sol_text, warnings)
    skills = parse_skill_distribution(sol_text)
    rich = parse_rich_solutions(sol_text, _DRILL_SOL_HDR_RE)
    translation = parse_translation(sol_text)

    meta = _meta(drill_text)
    test_id = _norm(meta.get("Test ID") or "")
    ptitle, body, section = _parse_passage(drill_text)
    if not test_id:
        warnings.append("Thiếu 'Test ID' trong bảng metadata của drill.")
    if not section:
        warnings.append("Không tìm thấy mục '## Questions N–M' trong drill.")

    band_target = None
    bm = _BAND_RE.search(meta.get("Cấp") or "")
    if bm:
        try:
            band_target = float(bm.group(1))
        except ValueError:
            band_target = None

    types = {a["question_type"] for a in qa.values()}
    if len(types) > 1:
        warnings.append(f"Drill trộn nhiều dạng câu hỏi: {sorted(types)}.")
    qtype = next(iter(types), None)

    built: dict = {}
    if qtype and section:
        builder = _QUESTION_BUILDERS.get(qtype)
        if builder:
            built = builder(section, qa)
        else:
            warnings.append(f"Chưa có builder cho dạng '{qtype}'.")

    questions = []
    for q_num in sorted(qa.keys()):
        a = qa[q_num]
        b = built.get(q_num) or {}
        r = rich.get(q_num, {})
        prompt = _norm(b.get("prompt") or r.get("question_text") or f"Câu {q_num}")
        if not b.get("prompt"):
            warnings.append(f"Câu {q_num}: không tách được đề bài từ drill.")
        skill_code = (r.get("skill_code") or skills.get(q_num) or "").upper()

        solution = {
            k: _plain_field(r[k]) for k in
            ("band", "skill_code", "skill_name", "steps", "source_excerpt",
             "vocab", "paraphrase", "trap_analysis", "tips")
            if r.get(k) not in (None, "", [])
        }
        if a.get("band") is not None:
            solution.setdefault("band", a["band"])

        q = {
            "q_num":         q_num,
            "question_type": a["question_type"],
            "prompt":        prompt,
            "answer":        a["answer"],
            "alternatives":  a["alternatives"],
            "skill_tag":     _SKILL_CODE_TO_TAG.get(skill_code, "detail"),
            "sub_skill":     skill_code or None,
        }
        if b.get("options"):
            q["options"] = b["options"]
        if b.get("template"):
            q["template"] = b["template"]
        if solution:
            q["solution"] = solution
        questions.append(q)

    title = ptitle or _norm(meta.get("Chủ đề") or test_id)
    passage = {
        "passage_order":  1,
        "slug":           slugify(f"{test_id} {title}"),
        "title":          title,
        "body_markdown":  body,
        "topic_tags":     [],
        "translation_vi": translation,
        "img_prompts":    [],
        "questions":      questions,
    }

    return ParsedReadingTest(
        content_type       = "reading_full_test",
        test_id            = test_id,
        title              = title,
        module             = "academic",
        time_limit_minutes = 15,
        passage_count      = 1,
        total_questions    = len(questions),
        band_target        = band_target,
        published          = published,
        passages           = [passage],
        raw_frontmatter    = {},
        warnings           = warnings,
    )
