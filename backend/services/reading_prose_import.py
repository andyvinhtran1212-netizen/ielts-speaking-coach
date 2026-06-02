"""reading_prose_import.py — reading-rich-test-solution (Part A).

Parse the human-readable IELTS test + solution markdown pair (the
`docs/content-samples/reading-test-06/` format) into the SAME
`ParsedReadingTest` structure the strict-YAML L3 importer produces, so the
prose bundle flows through the proven validate → build → store pipeline.

Two linked files:
  • TEST md     — passages (title/subtitle/body, A–H paragraph labels),
                  question groups (> instruction) per type, <!-- IMG-PROMPT -->
                  blocks (extracted for the #374 block-image workflow) and the
                  ```text``` ASCII fallback diagram.
  • SOLUTION md — the authoritative answer keys live HERE (the test md has
                  none): a quick-answer table (Q | Type | Answer | Band), a
                  skill-distribution table, per-passage "Bản dịch sát nghĩa"
                  (VI translation) and per-Q rich solution blocks
                  (steps / source / vocab / paraphrase / trap / tips).

The rich per-Q solution rides reading_questions.payload.solution and the VI
translation rides reading_passages.metadata.translation_vi (Pattern #15 — no
schema change; same as #372/#374). IMG-PROMPT blocks ride passage metadata.

Code-authoritative (D0-approved): a prose scanner, isolated from the strict
parser so it can't regress the YAML path.
"""

from __future__ import annotations

import re
from typing import Optional

from services.content_import_service import (
    ParsedReadingTest,
    slugify,
)


# ── Type-label + skill-code mappings ──────────────────────────────────

# Human type labels (quick-answer table / instruction) → DB question_type enum.
_TYPE_LABEL_TO_ENUM = {
    "diagram label completion":  "diagram_label_completion",
    "flow chart completion":     "flow_chart_completion",
    "true/false/not given":      "true_false_not_given",
    "yes/no/not given":          "yes_no_not_given",
    "sentence completion":       "sentence_completion",
    "summary completion":        "summary_completion",
    "note completion":           "notes_completion",
    "notes completion":          "notes_completion",
    "table completion":          "table_completion",
    "form completion":           "form_completion",
    "matching headings":         "matching_headings",
    "matching information":      "matching_information",
    "matching features":         "matching_features",
    "matching sentence endings": "matching_sentence_endings",
    "multiple choice":           "mcq_single",
    "short answer":              "short_answer",
}

# Solution skill codes → the reading_questions.skill_tag enum (best-effort; the
# precise code is also preserved in payload.solution.skill_code so nothing is
# lost). PARA (paraphrase recognition) has no dedicated enum → 'detail'.
_SKILL_CODE_TO_TAG = {
    "LEX":    "vocabulary_in_context",
    "INFER":  "inference",
    "SKIM":   "skimming",
    "SCAN":   "scanning",
    "PARA":   "detail",
    "NGD":    "writer_view_TFNG",
    "DETAIL": "detail",
    "COHES":  "reference_cohesion",
}

_DASH = r"[–—\-]"   # en-dash / em-dash / hyphen, all used interchangeably


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def _clean_prompt(s: str) -> str:
    """Tidy a question prompt for display (reading-display-fixes A). Diagram/
    flow prompts are lifted from the solution's quoted "Câu hỏi (diagram)"
    field, which wraps the text in quotes and uses ASCII flow arrows — those
    render as literal artifacts in the exam diagram block. Strip one surrounding
    quote pair and normalise '-->' / '->' to '→'."""
    s = _norm(s)
    s = re.sub(r'^["“”\'](.*)["“”\']$', r"\1", s).strip()
    s = s.replace("-->", "→").replace("->", "→")
    return s


# ── Quick-answer table → {q_num: {type, answer, alternatives, band}} ──

_QA_ROW_RE = re.compile(
    r"^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*([\d.]+)\s*\|\s*$"
)
# "kilometre *(hoặc kilometer)*" / "31 per cent *(hoặc 31% / 31 percent)*"
_ALT_RE = re.compile(r"^(.*?)\s*\*\(\s*hoặc\s*(.+?)\s*\)\*\s*$")


def _split_answer_cell(cell: str) -> tuple[str, list[str]]:
    cell = _norm(cell)
    m = _ALT_RE.match(cell)
    if not m:
        return cell, []
    primary = _norm(m.group(1))
    alts = [_norm(a) for a in re.split(r"\s*/\s*", m.group(2)) if _norm(a)]
    return primary, alts


def parse_quick_answers(sol_text: str) -> dict:
    out: dict[int, dict] = {}
    for line in sol_text.splitlines():
        m = _QA_ROW_RE.match(line)
        if not m:
            continue
        q_num = int(m.group(1))
        type_label = _norm(m.group(2))
        if type_label.lower() in ("type",):           # skip header row
            continue
        enum = _TYPE_LABEL_TO_ENUM.get(type_label.lower())
        if not enum:
            continue
        answer, alts = _split_answer_cell(m.group(3))
        try:
            band = float(m.group(4))
        except ValueError:
            band = None
        out[q_num] = {
            "question_type": enum,
            "type_label":    type_label,
            "answer":        answer,
            "alternatives":  alts,
            "band":          band,
        }
    return out


# ── Skill-distribution table → {q_num: skill_code} ────────────────────

def _expand_qrange(spec: str) -> list[int]:
    nums: list[int] = []
    for chunk in spec.split(","):
        chunk = _norm(chunk)
        if not chunk or chunk == "—":
            continue
        m = re.match(rf"^(\d+)\s*{_DASH}\s*(\d+)$", chunk)
        if m:
            nums.extend(range(int(m.group(1)), int(m.group(2)) + 1))
        elif chunk.isdigit():
            nums.append(int(chunk))
    return nums


def parse_skill_distribution(sol_text: str) -> dict:
    """{q_num: skill_code} from the '| Mã skill | … | Số câu | Các câu |' table."""
    out: dict[int, str] = {}
    for line in sol_text.splitlines():
        cells = [c.strip() for c in line.split("|")]
        # leading/trailing empties from the outer pipes
        cells = [c for c in cells if c != ""]
        if len(cells) != 4:
            continue
        code = cells[0]
        if code not in _SKILL_CODE_TO_TAG:
            continue
        for q in _expand_qrange(cells[3]):
            out[q] = code
    return out


# ── Per-passage VI translation → {passage_order: [paragraphs]} ────────

_PASSAGE_HDR_RE = re.compile(rf"^##\s+PASSAGE\s+(\d+)\s*{_DASH}", re.MULTILINE)
_TRANS_PARA_RE = re.compile(r"^\*\*Đoạn\s+[0-9A-Za-z]+\.\*\*\s*(.*)$")


def parse_translations(sol_text: str) -> dict:
    """{passage_order: 'para1\\n\\npara2…'} from each '### A. Bản dịch sát nghĩa'."""
    out: dict[int, str] = {}
    # Split the solution into per-passage chunks.
    matches = list(_PASSAGE_HDR_RE.finditer(sol_text))
    for i, m in enumerate(matches):
        order = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(sol_text)
        chunk = sol_text[start:end]
        # The translation lives between '### A. Bản dịch' and '### B. Giải'.
        a = re.search(r"###\s*A\.\s*Bản dịch[^\n]*\n", chunk)
        if not a:
            continue
        b = re.search(r"\n###\s*B\.", chunk)
        seg = chunk[a.end(): (b.start() if b else len(chunk))]
        paras = []
        for line in seg.splitlines():
            pm = _TRANS_PARA_RE.match(line.strip())
            if pm and _norm(pm.group(1)):
                paras.append(_norm(pm.group(1)))
        if paras:
            out[order] = "\n\n".join(paras)
    return out


# ── Per-Q rich solution blocks → {q_num: {steps, source_excerpt, …}} ──

_SOL_HDR_RE = re.compile(
    rf"^\*\*Câu\s+(\d+)\s*{_DASH}\s*Đáp án:\s*(.+?)\s*·\s*Kỹ năng:\s*(\w+)\s+(.+?)\s*·\s*Band\s*([\d.]+)\s*\*\*\s*$"
)
# field bullets: "- *Label:* value"
_SOL_FIELD_RE = re.compile(r"^-\s*\*([^:*]+):\*\s*(.*)$")

# label (lowercased, accent-bearing) → solution key
_SOL_FIELD_MAP = [
    ("các bước ra đáp án",      "steps"),
    ("trích đoạn nguồn",        "source_excerpt"),
    ("từ vựng",                 "vocab"),
    ("paraphrase",              "paraphrase"),
    ("phân tích bẫy & kỹ năng", "trap_analysis"),
    ("phân tích bẫy",           "trap_analysis"),
    ("mẹo làm bài",             "tips"),
    ("câu hỏi",                 "question_text"),
]


def _field_key(label: str) -> Optional[str]:
    low = _norm(label).lower()
    # strip a trailing parenthetical like "Câu hỏi (diagram)"
    low = re.sub(r"\s*\(.*?\)\s*$", "", low)
    for prefix, key in _SOL_FIELD_MAP:
        if low.startswith(prefix):
            return key
    return None


def parse_rich_solutions(sol_text: str) -> dict:
    """{q_num: {band, skill_code, skill_name, steps, source_excerpt, vocab[],
    paraphrase, trap_analysis, tips, question_text}} from the '### B. Giải chi
    tiết' blocks. vocab is split on ';' into a list; other fields are prose."""
    lines = sol_text.splitlines()
    out: dict[int, dict] = {}
    cur_q: Optional[int] = None
    cur: dict = {}
    cur_field: Optional[str] = None

    def flush():
        if cur_q is not None:
            v = cur.get("vocab")
            if isinstance(v, str):
                cur["vocab"] = [x for x in (_norm(p) for p in v.split(";")) if x]
            out[cur_q] = {k: val for k, val in cur.items() if val not in (None, "", [])}

    for line in lines:
        h = _SOL_HDR_RE.match(line.strip())
        if h:
            flush()
            cur_q = int(h.group(1))
            code = _norm(h.group(3))
            try:
                band = float(h.group(5))
            except ValueError:
                band = None
            cur = {
                "answer_display": _norm(h.group(2)),
                "skill_code":     code,
                "skill_name":     _norm(h.group(4)),
                "band":           band,
            }
            cur_field = None
            continue
        if cur_q is None:
            continue
        # reading-display-fixes C — stop field capture at a structural boundary
        # (a markdown heading "## PASSAGE"/"### A./B.", a "---" rule, or a
        # "**Đoạn …**" translation paragraph). A real "**Câu N —" header is
        # handled above; without this guard the last field (Mẹo) over-captures
        # the NEXT passage's content (the reported bleed).
        if re.match(r"^(#{1,6}\s|-{3,}\s*$|\*\*Đoạn\b)", line.strip()):
            flush(); cur_q = None; cur = {}; cur_field = None
            continue
        fm = _SOL_FIELD_RE.match(line.strip())
        if fm:
            key = _field_key(fm.group(1))
            cur_field = key
            if key:
                cur[key] = _norm(fm.group(2))
        elif cur_field and line.strip():
            # continuation line for the current field
            cur[cur_field] = _norm((cur.get(cur_field) or "") + " " + line.strip())
    flush()
    return out


# ── Test md → passages + question groups + IMG-PROMPT ─────────────────

_IMG_PROMPT_RE = re.compile(
    r'<!--\s*IMG-PROMPT\s+id="([^"]*)"\s+type="([^"]*)"\s+qrange="([^"]*)"\s*-->'
    r"\s*```imageprompt\s*\n(.*?)\n```\s*<!--\s*/IMG-PROMPT\s*-->",
    re.DOTALL,
)
_TEST_PASSAGE_RE = re.compile(r"^##\s+READING PASSAGE\s+(\d+)\s*$", re.MULTILINE)
_QGROUP_RE = re.compile(rf"^###\s+Questions\s+(\d+)\s*{_DASH}\s*(\d+)\s*$", re.MULTILINE)
_STATEMENT_RE = re.compile(r"^\*\*(\d+)\*\*\s+(.*)$")
_MCQ_OPT_RE = re.compile(r"^\*\*([A-D])\*\*\s+(.*)$")
_HEADING_OPT_RE = re.compile(r"^>\s*([ivxIVX]+)\s+(\S.*)$")


def _meta_value(test_text: str, field: str) -> Optional[str]:
    m = re.search(rf"^\|\s*{re.escape(field)}\s*\|\s*(.+?)\s*\|\s*$",
                  test_text, re.MULTILINE)
    return _norm(m.group(1)) if m else None


def _instruction_type(instruction: str) -> Optional[str]:
    """Infer the question_type enum from a group's blockquote instruction."""
    t = instruction.lower()
    if "label the diagram" in t or "label the" in t and "diagram" in t:
        return "diagram_label_completion"
    if "flow" in t and "chart" in t:
        return "flow_chart_completion"
    if "true" in t and "false" in t and "not given" in t:
        return "true_false_not_given"
    if ("yes" in t and "no" in t and "not given" in t) or "views of the writer" in t:
        return "yes_no_not_given"
    if "correct heading" in t or "list of headings" in t:
        return "matching_headings"
    if "which paragraph contains" in t:
        return "matching_information"
    if "complete the notes" in t:
        return "notes_completion"
    if "complete the sentences" in t:
        return "sentence_completion"
    if "complete the summary" in t:
        return "summary_completion"
    if "choose the correct letter" in t or "a, b, c or d" in t:
        return "mcq_single"
    return None


def _parse_test_md(test_text: str) -> dict:
    """{test_id, title, band_target, passages:[…], q_to_passage:{}, prompts:{},
    options:{}, group_type:{}}."""
    title_m = re.search(r"^#\s+(.*)$", test_text, re.MULTILINE)
    title = _norm(title_m.group(1)) if title_m else None
    test_id = _meta_value(test_text, "Test ID")
    band_raw = _meta_value(test_text, "Target band")
    try:
        band_target = float(band_raw) if band_raw else None
    except ValueError:
        band_target = None

    passages: list[dict] = []
    q_to_passage: dict[int, int] = {}
    prompts: dict[int, str] = {}
    options: dict[int, list] = {}
    group_type: dict[int, str] = {}

    pmatches = list(_TEST_PASSAGE_RE.finditer(test_text))
    for i, pm in enumerate(pmatches):
        order = int(pm.group(1))
        start = pm.end()
        end = pmatches[i + 1].start() if i + 1 < len(pmatches) else len(test_text)
        chunk = test_text[start:end]

        # IMG-PROMPT extraction (before stripping anything).
        img_prompts = [
            {"id": _norm(im.group(1)), "type": _norm(im.group(2)),
             "qrange": _norm(im.group(3)), "prompt": im.group(4).strip()}
            for im in _IMG_PROMPT_RE.finditer(chunk)
        ]

        # Title = first '### …'; subtitle = the *italic* line just after it.
        tm = re.search(r"^###\s+(.*)$", chunk, re.MULTILINE)
        ptitle = _norm(tm.group(1)) if tm else f"Passage {order}"
        subtitle = None
        body_start = tm.end() if tm else 0
        after = chunk[body_start:]
        sm = re.search(r"^\s*\*(.+?)\*\s*$", after, re.MULTILINE)
        if sm and sm.start() < 200:
            subtitle = _norm(sm.group(1))

        # Body = everything from the title up to the first question group / IMG.
        gmatches = list(_QGROUP_RE.finditer(chunk))
        body_end = gmatches[0].start() if gmatches else len(chunk)
        body = chunk[body_start:body_end]
        body = _IMG_PROMPT_RE.sub("", body)
        body = re.sub(r"```text\b.*?```", "", body, flags=re.DOTALL)   # ASCII handled separately
        if subtitle:
            body = re.sub(r"^\s*\*" + re.escape(subtitle) + r"\*\s*$", "", body,
                          count=1, flags=re.MULTILINE)
        body_markdown = body.strip()

        passages.append({
            "passage_order": order,
            "title":         ptitle,
            "subtitle":      subtitle,
            "body_markdown": body_markdown,
            "img_prompts":   img_prompts,
        })

        # Question groups inside this passage.
        for gi, gm in enumerate(gmatches):
            g_lo, g_hi = int(gm.group(1)), int(gm.group(2))
            g_start = gm.end()
            g_end = gmatches[gi + 1].start() if gi + 1 < len(gmatches) else len(chunk)
            gtext = chunk[g_start:g_end]
            for q in range(g_lo, g_hi + 1):
                q_to_passage[q] = order

            # Instruction = leading blockquote lines.
            instr_lines = [l[1:].strip() for l in gtext.splitlines()
                           if l.lstrip().startswith(">")]
            instruction = " ".join(instr_lines)
            gtype = _instruction_type(instruction)
            for q in range(g_lo, g_hi + 1):
                if gtype:
                    group_type[q] = gtype

            # Shared heading options (matching_headings) from the instruction.
            heading_opts = []
            for l in gtext.splitlines():
                hm = _HEADING_OPT_RE.match(l)
                if hm:
                    heading_opts.append({"label": _norm(hm.group(1)),
                                         "text": _norm(hm.group(2))})

            # Per-question bodies. MCQ stems carry inline A–D options.
            cur_q = None
            for raw in gtext.splitlines():
                stm = _STATEMENT_RE.match(raw.strip())
                if stm:
                    cur_q = int(stm.group(1))
                    prompts[cur_q] = _norm(stm.group(2))
                    if heading_opts:
                        options[cur_q] = list(heading_opts)
                    continue
                opm = _MCQ_OPT_RE.match(raw.strip())
                if opm and cur_q is not None:
                    options.setdefault(cur_q, []).append(
                        {"label": opm.group(1), "text": _norm(opm.group(2))})

    return {
        "test_id":      test_id,
        "title":        title,
        "band_target":  band_target,
        "passages":     passages,
        "q_to_passage": q_to_passage,
        "prompts":      prompts,
        "options":      options,
        "group_type":   group_type,
    }


# ── Assemble the ParsedReadingTest ────────────────────────────────────

def build_parsed_reading_test_from_prose(
    test_text: str, sol_text: str, published: bool = False,
) -> ParsedReadingTest:
    """Merge the test + solution prose into a ParsedReadingTest (content_type
    reading_full_test) carrying answers, per-Q rich solution (payload.solution),
    per-passage VI translation + IMG-PROMPT (passage metadata)."""
    qa = parse_quick_answers(sol_text)
    skills = parse_skill_distribution(sol_text)
    rich = parse_rich_solutions(sol_text)
    trans = parse_translations(sol_text)
    test = _parse_test_md(test_text)

    test_id = test["test_id"] or "UNKNOWN"
    q_to_passage = test["q_to_passage"]

    # Group questions by passage_order.
    by_passage: dict[int, list] = {}
    for q_num in sorted(qa.keys()):
        a = qa[q_num]
        order = q_to_passage.get(q_num)
        if order is None:
            continue
        r = rich.get(q_num, {})
        # prompt: prefer the test-extracted statement/MCQ stem; else the
        # solution's "Câu hỏi"; else a generic label (diagram/note blanks).
        prompt = _clean_prompt(test["prompts"].get(q_num) or r.get("question_text") or f"Câu {q_num}")
        skill_code = (r.get("skill_code") or skills.get(q_num) or "").upper()
        skill_tag = _SKILL_CODE_TO_TAG.get(skill_code, "detail")

        solution = {
            k: r[k] for k in
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
            "skill_tag":     skill_tag,
            "sub_skill":     skill_code or None,
        }
        opts = test["options"].get(q_num)
        if opts:
            q["options"] = opts
        if solution:
            q["solution"] = solution
        by_passage.setdefault(order, []).append(q)

    passages = []
    for pas in test["passages"]:
        order = pas["passage_order"]
        slug = slugify(f"{test_id} p{order} {pas['title']}")
        passages.append({
            "passage_order":  order,
            "slug":           slug,
            "title":          pas["title"],
            "body_markdown":  pas["body_markdown"],
            "topic_tags":     [],
            "translation_vi": trans.get(order),
            "img_prompts":    pas.get("img_prompts") or [],
            "questions":      by_passage.get(order, []),
        })

    total = sum(len(p["questions"]) for p in passages)
    return ParsedReadingTest(
        content_type       = "reading_full_test",
        test_id            = test_id,
        title              = test["title"] or test_id,
        module             = "academic",
        time_limit_minutes = 60,
        passage_count      = len(passages),
        total_questions    = total,
        band_target        = test["band_target"],
        published          = published,
        passages           = passages,
        raw_frontmatter    = {},
    )
