"""services/listening_convert.py — Sprint 13.4.2 markdown parser.

Andy's authoring workflow switched from DOCX → Markdown after Sprint
13.4's DOCX parser surfaced 5 mismatches against real Cambridge IELTS
content. This module parses Andy's canonical 2-file Markdown bundle:

  * ``<test_id>_Question_Paper.md``    — student-facing prompts
  * ``<test_id>_Script_AnswerKey.md``  — transcript + speakers + answer key

The output schema matches Sprint 13.4's contract verbatim so the convert
router (POST /convert + POST /convert/commit) and ``listening_content``
ingest layer are untouched. The only router-side change is the file
extension allow-list (.docx → .md) + per-file size cap (5MB → 1MB).

Public API (stable across Sprint 13.4 → 13.4.2):

  parse_listening_test(qp_bytes, sa_bytes) -> dict
  parse_from_text(qp_text, sa_text)         -> dict
  section_to_content_payload(section, test_id_uuid, test_metadata) -> dict

The parser is regex + line-scan based. Andy's format is shallow enough
that a full Markdown AST adds no value — the recogniser is structural
(headings + blockquotes + tables + bullets) rather than semantic.

Canonical format spec lives in this module's docstrings + the matching
synthetic fixtures in tests/test_listening_convert.py.

Sprint 13.4 DOCX parser is preserved at the bottom as a comment block
labelled DEPRECATED — kept for emergency rollback only.
"""

from __future__ import annotations

import re
from typing import Any


# ── Marker stripping ────────────────────────────────────────────────────────

# Speaker tag bold-wrapped in transcript: **[F-BrE-30s-professional]**
_BOLD_SPEAKER_TAG_RE = re.compile(
    r"\*\*\[\s*[MFN]\s*-[^\]]+\]\*\*",
    re.IGNORECASE,
)

# Raw speaker tag (unbolded): [F-BrE-30s-professional]
_RAW_SPEAKER_TAG_RE = re.compile(
    r"\[\s*([MFN])\s*-\s*([A-Za-z]+)"
    r"(?:\s*-\s*([0-9]+s|teens|adult))?"
    r"(?:\s*-\s*([A-Za-z][A-Za-z\-]*))?"
    r"\s*\]",
    re.IGNORECASE,
)

# Bracket cue with colon payload: [emotion:polite] [pause:30s] [stress:word]
_DELIVERY_CUE_RE = re.compile(
    r"\[\s*(?:pace|pause|emphasis|stress|emotion|hesitation|chuckle)"
    r"\s*:\s*[^\]]+\]",
    re.IGNORECASE,
)

# Self-closing bracket flag: [hesitate] [breath] [sigh] [chuckle]
_FLAG_CUE_RE = re.compile(
    r"\[\s*(?:hesitate|breath|sigh|chuckle)\s*\]",
    re.IGNORECASE,
)

# (Q1), (Q11), ( Q 33 )
_QUESTION_MARKER_RE = re.compile(r"\(\s*Q\s*\d{1,2}\s*\)", re.IGNORECASE)


def strip_markers(raw: str) -> str:
    """Strip all known markers from a transcript, returning user-facing text.

    Order matters: bold-speaker tags first (longest pattern), then raw
    tags, delivery cues, self-closing flags, question pointers. Collapse
    horizontal whitespace inside lines, preserve paragraph breaks.
    """
    out = _BOLD_SPEAKER_TAG_RE.sub(" ", raw)
    out = _RAW_SPEAKER_TAG_RE.sub(" ", out)
    out = _DELIVERY_CUE_RE.sub(" ", out)
    out = _FLAG_CUE_RE.sub(" ", out)
    out = _QUESTION_MARKER_RE.sub(" ", out)
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r" *\n *", "\n", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


# ── Test-metadata extraction ────────────────────────────────────────────────

# H1 form: "# IELTS LISTENING — ILR-LIS-001" or
#         "# IELTS LISTENING — ILR-LIS-001 — Script & Answer Key"
# Separator must be whitespace-padded so ASCII hyphens INSIDE the test_id
# (e.g. ILR-LIS-001) are not mistaken for the field separator.
_H1_TEST_ID_RE = re.compile(
    r"^#\s+IELTS\s+LISTENING\s+[—–\-]\s+(\S+?)(?:\s+[—–\-]\s+.*)?$",
    re.MULTILINE | re.IGNORECASE,
)

# Bold-prefix metadata line: "**Field:** value"
_BOLD_PREFIX_LINE_RE = re.compile(
    r"^\s*\*\*([^:*]+):\*\*\s+(.+?)\s*$",
    re.MULTILINE,
)

# Bold-prefix → metadata-key map. Lookup is case-insensitive.
_METADATA_KEYS: dict[str, str] = {
    "test title":       "title",
    "target band":      "band_target",
    "time allowed":     "time_allowed",
    "total questions":  "total_questions",
    "total words":      "total_words",
    "accent profile":   "accent_profile_raw",
    "test id":          "test_id",
    "version":          "version",
    "date":             "created_at_source",
    "created at":       "created_at_source",
}


def _bold_prefix_lookup(text: str) -> dict[str, str]:
    """Return all bold-prefix `**Field:** value` lines as a dict."""
    out: dict[str, str] = {}
    for m in _BOLD_PREFIX_LINE_RE.finditer(text):
        key = m.group(1).strip().lower()
        val = m.group(2).strip()
        if key in _METADATA_KEYS and val:
            out[_METADATA_KEYS[key]] = val
    return out


def parse_test_metadata(qp_text: str, sa_text: str) -> dict[str, Any]:
    """Cross-reference both files for the test envelope.

    Test ID comes from the QP H1 (more reliable — the Script H1 may carry
    a "Script & Answer Key" suffix). Other fields prefer the Script file
    (it carries word count + accent profile that the QP omits) but fall
    back to the QP if missing.
    """
    qp_meta = _bold_prefix_lookup(qp_text)
    sa_meta = _bold_prefix_lookup(sa_text)
    # Script wins on overlap; fall back to QP for anything missing.
    merged = {**qp_meta, **sa_meta}

    test_id: str | None = None
    for source in (qp_text, sa_text):
        m = _H1_TEST_ID_RE.search(source)
        if m:
            test_id = m.group(1).strip()
            break

    out: dict[str, Any] = {
        "test_id":           test_id or merged.get("test_id"),
        "title":             merged.get("title"),
        "version":           merged.get("version") or "1.0",
        "band_target":       _safe_float(merged.get("band_target")),
        "total_questions":   _safe_int(merged.get("total_questions")),
        "total_words":       _safe_int(merged.get("total_words")),
        "accent_profile":    _parse_accent_profile(merged.get("accent_profile_raw") or ""),
        "themes":            parse_topic_distribution(sa_text),
        "time_allowed":      merged.get("time_allowed"),
        "source_format":     "cambridge_ielts_markdown",
        "created_at_source": merged.get("created_at_source"),
    }
    return out


def _safe_float(raw: str | None) -> float | None:
    if not raw:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", raw)
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def _safe_int(raw: str | None) -> int | None:
    if not raw:
        return None
    m = re.search(r"(\d[\d,]*)", raw)
    if not m:
        return None
    try:
        return int(m.group(1).replace(",", ""))
    except ValueError:
        return None


def _parse_accent_profile(raw: str) -> list[str]:
    parts = re.split(r"[,;/|]", raw)
    return [p.strip() for p in parts if p.strip()]


# ── Topic distribution ─────────────────────────────────────────────────────


# "## Topic Distribution" heading followed by a 2-column markdown table.
_TOPIC_DIST_HEADING_RE = re.compile(
    r"^##\s+Topic\s+Distribution\s*$",
    re.MULTILINE | re.IGNORECASE,
)


def parse_topic_distribution(sa_text: str) -> dict[str, str]:
    """Extract the per-section theme map.

    Locates the ``## Topic Distribution`` heading, then reads the next
    markdown table. Rows shaped ``| S1 | Theme text |`` flow into
    ``{"s1": "Theme text"}``.
    """
    out: dict[str, str] = {}
    m = _TOPIC_DIST_HEADING_RE.search(sa_text)
    if not m:
        return out

    after = sa_text[m.end():]
    # Walk the next ~30 lines, capture pipe-delimited table rows. Stop
    # at the next heading or non-table line.
    table_seen = False
    for line in after.splitlines()[:30]:
        if line.strip().startswith("#") and table_seen:
            break
        if "|" not in line:
            if table_seen:
                break
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        # Skip header + separator rows.
        if len(cells) < 2:
            continue
        first = cells[0].lower()
        if first in {"section", ""} or re.fullmatch(r":?-+:?", first):
            table_seen = True
            continue
        sm = re.match(r"^s(\d)$", first)
        if sm:
            out[f"s{sm.group(1)}"] = cells[1]
            table_seen = True
    return out


# ── Section splitters ──────────────────────────────────────────────────────


# Question Paper sections: "## SECTION N"
_QP_SECTION_HEADER_RE = re.compile(
    r"^##\s+SECTION\s+([1-4])\s*$",
    re.MULTILINE | re.IGNORECASE,
)

# Script PART A sections: "### SECTION N (Sn)"
_SCRIPT_SECTION_HEADER_RE = re.compile(
    r"^###\s+SECTION\s+([1-4])\s*\(S\d\)\s*$",
    re.MULTILINE | re.IGNORECASE,
)

# Script PART A boundary — H2.
_SCRIPT_PART_A_RE = re.compile(
    r"^##\s+PART\s+A\b.*$",
    re.MULTILINE | re.IGNORECASE,
)

# Script PART B boundary — H2 (terminates PART A).
_SCRIPT_PART_B_RE = re.compile(
    r"^##\s+PART\s+B\b.*$",
    re.MULTILINE | re.IGNORECASE,
)


def split_qp_sections(qp_text: str) -> dict[int, str]:
    """Split the Question Paper into per-section text blocks (H2 ## SECTION N)."""
    return _split_by_headers(qp_text, _QP_SECTION_HEADER_RE, end_re=None)


def split_script_sections(sa_text: str) -> dict[int, str]:
    """Split the Script PART A into per-section text blocks
    (H3 ### SECTION N (Sn)). PART B (answer keys) is excluded.
    """
    part_a_match = _SCRIPT_PART_A_RE.search(sa_text)
    part_b_match = _SCRIPT_PART_B_RE.search(sa_text)
    start = part_a_match.end() if part_a_match else 0
    end   = part_b_match.start() if part_b_match else len(sa_text)
    return _split_by_headers(sa_text[start:end], _SCRIPT_SECTION_HEADER_RE, end_re=None)


def _split_by_headers(
    text: str,
    header_re: re.Pattern[str],
    *,
    end_re: re.Pattern[str] | None,
) -> dict[int, str]:
    headers: list[tuple[int, int]] = []        # (start_idx, section_num)
    for m in header_re.finditer(text):
        headers.append((m.end(), int(m.group(1))))

    out: dict[int, str] = {}
    for i, (start_idx, section_num) in enumerate(headers):
        if i + 1 < len(headers):
            end_idx = headers[i + 1][0] - len(header_re.pattern)  # approx
            # Use the actual match position for cleanliness.
            end_idx = headers[i + 1][0]
            # We want the body up to (but not including) the next header line.
            # headers[i+1][0] is the end of the next header line — search
            # backward for its start.
            next_match_start = text.rfind("##", 0, end_idx)
            if next_match_start == -1 or next_match_start < start_idx:
                next_match_start = end_idx
            end_idx = next_match_start
        else:
            end_idx = len(text)
        if end_re is not None:
            term = end_re.search(text, start_idx, end_idx)
            if term:
                end_idx = term.start()
        body = text[start_idx:end_idx].strip()
        if body:
            out[section_num] = body
    return out


# ── Per-section metadata + speakers + narrator + transcript ────────────────


_SPEAKER_LIST_ITEM_RE = re.compile(
    r"^-\s*`([^`]+)`\s*[—–\-]\s*"           # - `S1_F1` —
    r"([^(]+?)\s*\(([^)]*)\)\s*;\s*"        # name (role);
    r"voice:\s*`(\[[^\]]+\])`",              # voice: `[F-BrE-30s-professional]`
    re.MULTILINE,
)


def parse_section_speakers(section_text: str) -> list[dict[str, Any]]:
    """Extract speaker definitions from the per-section ``**Speakers:**`` list.

    Each list item is shaped ``- `S1_F1` — Helen (Course coordinator);
    voice: `[F-BrE-30s-professional]```. Multiple speakers per section.
    Falls back to raw transcript-tag scan if the list block is absent.
    """
    out: list[dict[str, Any]] = []
    for m in _SPEAKER_LIST_ITEM_RE.finditer(section_text):
        speaker_id, name, role, voice_tag = m.groups()
        out.append({
            "id":        speaker_id.strip(),
            "name":      name.strip(),
            "role":      role.strip(),
            "voice_tag": voice_tag.strip(),
            **_decompose_voice_tag(voice_tag.strip()),
        })
    if out:
        return out
    # Fallback: raw transcript-tag scan (Sprint 13.4 behavior).
    seen: dict[str, dict[str, Any]] = {}
    for m in _RAW_SPEAKER_TAG_RE.finditer(section_text):
        tag = m.group(0).strip()
        if tag in seen:
            continue
        gender, accent, age, register = m.groups()
        seen[tag] = {
            "id":        None,
            "name":      None,
            "role":      None,
            "voice_tag": tag,
            "gender":    gender.upper() if gender else None,
            "accent":    accent or None,
            "age":       age.lower() if age else None,
            "register":  register.lower() if register else None,
        }
    return list(seen.values())


def _decompose_voice_tag(tag: str) -> dict[str, str | None]:
    """Parse `[F-BrE-30s-professional]` → {gender, accent, age, register}."""
    m = _RAW_SPEAKER_TAG_RE.match(tag)
    if not m:
        return {"gender": None, "accent": None, "age": None, "register": None}
    gender, accent, age, register = m.groups()
    return {
        "gender":   gender.upper() if gender else None,
        "accent":   accent or None,
        "age":      age.lower() if age else None,
        "register": register.lower() if register else None,
    }


_BOLD_PREFIX_NAMED_RE = re.compile(
    r"^\s*\*\*([A-Za-z ]+):\*\*\s*(.+?)\s*$",
    re.MULTILINE,
)


def parse_section_metadata(section_text: str) -> dict[str, str | int | None]:
    """Extract ``**Context:**``, ``**Register:**``, ``**Word count:**``."""
    out: dict[str, Any] = {
        "context":     None,
        "register":    None,
        "word_count":  None,
    }
    for m in _BOLD_PREFIX_NAMED_RE.finditer(section_text):
        key = m.group(1).strip().lower()
        val = m.group(2).strip()
        if key == "context":
            out["context"] = val
        elif key == "register":
            out["register"] = val
        elif key in ("word count", "words"):
            out["word_count"] = _safe_int(val)
    return out


_NARRATOR_INTRO_HEADING_RE = re.compile(
    r"^\*\*Audio\s+intro\s*\(narrator\)\s*:?\*\*\s*$",
    re.MULTILINE | re.IGNORECASE,
)

_TRANSCRIPT_HEADING_RE = re.compile(
    r"^\*\*Transcript:?\*\*\s*$",
    re.MULTILINE | re.IGNORECASE,
)


def parse_narrator_intro(section_text: str) -> str:
    """Read the blockquote that follows ``**Audio intro (narrator):**``
    and return it cleaned of audio production markers.

    Joins consecutive ``> `` lines until the first non-blockquote line,
    then strips delivery cues like ``[pause:30s]`` / ``[emotion:polite]``
    so the cleaned text is safe to render to students. Sprint 13.5.5:
    these markers leaked into the student player as raw bracket spans
    before this. The raw transcript still preserves them for audio
    production via ``metadata.raw_transcript``.
    """
    m = _NARRATOR_INTRO_HEADING_RE.search(section_text)
    if not m:
        return ""
    after = section_text[m.end():]
    lines: list[str] = []
    for line in after.splitlines():
        stripped = line.strip()
        if not stripped:
            if lines:                             # blank ends the quote
                break
            continue
        if stripped.startswith(">"):
            lines.append(stripped.lstrip(">").strip())
            continue
        break
    joined = " ".join(lines).strip()
    return strip_markers(joined) if joined else ""


def extract_transcript(section_text: str) -> str:
    """Slice the section text from the ``**Transcript:**`` heading to EOF.

    Marker stripping is the caller's job (so we can also surface the raw
    transcript for ``metadata.raw_transcript``).
    """
    m = _TRANSCRIPT_HEADING_RE.search(section_text)
    if not m:
        return ""
    return section_text[m.end():].strip()


# ── Question-block parsing ─────────────────────────────────────────────────


# H3 question block: "### Questions 1-6" / "### Questions 11-15"
_QUESTION_BLOCK_RE = re.compile(
    r"^###\s+Questions?\s+(\d+)\s*[-–]\s*(\d+)\s*$",
    re.MULTILINE | re.IGNORECASE,
)

# Instruction blockquote(s) immediately under the question-block heading.
_BLOCKQUOTE_LINE_RE = re.compile(r"^>\s?(.*)$", re.MULTILINE)


_INSTRUCTION_HINTS: list[tuple[re.Pattern[str], str, str]] = [
    # (regex, q_type, template_kind)
    # q_type drives grading semantics (per-question match strategy).
    # template_kind drives the renderer layout — Sprint 13.5.2 adds the
    # finer split so the gap-fill family stops collapsing 5 distinct
    # IELTS layouts into one generic form.
    # B1 fix — allow a describing word between "the" and the noun:
    # "label the campus map", "label the venue plan" (was plan|diagram|map only).
    (re.compile(r"label the (?:[\w-]+\s+){0,3}(?:plan|diagram|map)\b", re.IGNORECASE),
        "mcq_letter_label",        "plan_label"),
    (re.compile(r"choose the correct letter", re.IGNORECASE),
        "mcq_3option",             "mcq_3option"),
    (re.compile(r"answer the questions?", re.IGNORECASE),
        "dictation_short_answer",  "short_answer"),
    (re.compile(r"complete the form", re.IGNORECASE),
        "dictation_gap_fill",      "form_completion"),
    (re.compile(r"complete the table", re.IGNORECASE),
        "dictation_gap_fill",      "table_completion"),
    (re.compile(r"complete the notes?", re.IGNORECASE),
        "dictation_gap_fill",      "notes_completion"),
    (re.compile(r"complete the sentences?", re.IGNORECASE),
        "dictation_gap_fill",      "sentence_completion"),
    (re.compile(r"complete the summary", re.IGNORECASE),
        "dictation_gap_fill",      "summary_completion"),
    # A3 (P2) — flow-chart completion reuses the gap-fill grading + a dedicated
    # renderer layout. "complete the flow-chart/flow chart/flowchart".
    (re.compile(r"complete the flow[\s-]?chart", re.IGNORECASE),
        "dictation_gap_fill",      "flow_chart_completion"),
]


# qtype marker (web reads this FIRST; regex above is the fallback). Content may
# author `<!-- qtype: flow_chart -->` OR `> [type: flow_chart]` under the
# `### Questions N-M` heading. The web NEVER depends on the marker existing —
# the regex hints still classify. Map extended as render lands per type
# (P2 flow_chart + the existing kinds; P3 matching; P4 mcq_multi).
_MARKER_TO_TYPE: dict[str, tuple[str, str]] = {
    "flow_chart":            ("dictation_gap_fill",     "flow_chart_completion"),
    "flow_chart_completion": ("dictation_gap_fill",     "flow_chart_completion"),
    "form_completion":       ("dictation_gap_fill",     "form_completion"),
    "table_completion":      ("dictation_gap_fill",     "table_completion"),
    "notes_completion":      ("dictation_gap_fill",     "notes_completion"),
    "summary_completion":    ("dictation_gap_fill",     "summary_completion"),
    "sentence_completion":   ("dictation_gap_fill",     "sentence_completion"),
    "short_answer":          ("dictation_short_answer",  "short_answer"),
    "mcq_3option":           ("mcq_3option",             "mcq_3option"),
    "plan_label":            ("mcq_letter_label",        "plan_label"),
}

_QTYPE_MARKER_RE = re.compile(
    r"(?:<!--\s*qtype:\s*([\w\- ]+?)\s*-->|\[type:\s*([\w\- ]+?)\s*\])",
    re.IGNORECASE,
)


def _read_qtype_marker(body: str) -> tuple[str, str] | None:
    """Read an explicit qtype marker from a question block. Returns
    (q_type, template_kind) or None when there's no marker / an unrecognised
    marker value (→ caller falls back to regex classify)."""
    m = _QTYPE_MARKER_RE.search(body or "")
    if not m:
        return None
    raw = (m.group(1) or m.group(2) or "").strip().lower()
    key = re.sub(r"[\s\-]+", "_", raw)
    return _MARKER_TO_TYPE.get(key)


def _classify_instruction(instruction: str) -> tuple[str, str]:
    """Classify a block's instruction blockquote.

    Returns ``(q_type, template_kind)``. ``q_type`` keeps grading
    semantics ("dictation_gap_fill" etc.); ``template_kind`` is the
    fine-grained layout ("form_completion", "table_completion",
    "notes_completion", "summary_completion", "sentence_completion",
    "short_answer", "mcq_3option", "plan_label"). Sprint 13.5.2.
    """
    for pattern, q_slug, t_slug in _INSTRUCTION_HINTS:
        if pattern.search(instruction):
            return q_slug, t_slug
    return "unknown", "unknown"


# Bullet-style gap fill: "- Field: **N** ___________"
_BULLET_GAP_RE = re.compile(
    r"^\s*[-*+]\s+(.+?)\s*[:：]\s*£?\s*\**(\d{1,2})\**\s+_+\s*$",
    re.MULTILINE,
)

# Plain "**N** _____" bullet without colon-label (notes / summary)
_PLAIN_NUM_GAP_RE = re.compile(
    r"^\s*[-*+]?\s*\**(\d{1,2})\**\s+_+",
    re.MULTILINE,
)

# Table cell gap: "N ………" (Unicode horizontal ellipsis variants).
_TABLE_CELL_GAP_RE = re.compile(
    r"(\d{1,2})\s+[…\.]+",
)

# Short-answer / plan-label / sentence / MCQ: "**N.** Some text"
# Andy's canonical format puts the dot INSIDE the bold wrappers
# (`**9.** What…`) for leading numbered prompts. Inline gaps use
# `**N**` without dot — handled separately by _INLINE_NUM_GAP_RE.
_NUM_DOT_PROMPT_RE = re.compile(
    r"^\s*\*\*(\d{1,2})\.\*\*\s+(.+?)\s*$",
    re.MULTILINE,
)

# MCQ nested option line: "   - **A** option text." / "- **B** ..."
_MCQ_OPTION_LINE_RE = re.compile(
    r"^\s+[-*+]\s+\**([A-H])\**\s+(.+?)\s*$",
    re.MULTILINE,
)

# Example italic-wrapped row in form: "_Daniel Brennan (Example)_"
_EXAMPLE_ITALIC_RE = re.compile(r"_[^_]*\(Example\)[^_]*_", re.IGNORECASE)

# Summary-style inline gap: "...word **N** ___________ word..."
_INLINE_NUM_GAP_RE = re.compile(r"\*\*(\d{1,2})\*\*\s+_+")

# H4 heading inside a block — used as the form/table/notes title.
_BLOCK_H4_RE = re.compile(r"^\s*####\s+(.+?)\s*$", re.MULTILINE)

# Markdown table row: "| cell | cell |".
_TABLE_ROW_RE = re.compile(r"^\s*\|(.+)\|\s*$", re.MULTILINE)
_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?\s*-+\s*(\|\s*-+\s*)+\|?\s*$")

# Form bullet that ALSO captures whether the value slot is a literal
# "(Example)" italic block (Daniel Brennan) vs a numbered gap "**N**".
_FORM_BULLET_LINE_RE = re.compile(
    r"^\s*[-*+]\s+(.+?)\s*[:：]\s*(.+?)\s*$",
    re.MULTILINE,
)

# Sentence-style row — Andy's canonical Cambridge IELTS format:
#   `**27.** Before doing any research, the group must submit an ___ application.`
#   `**35.** The first electric street lighting technology was the ___ lamp.`
#
# Sprint 13.5.3: relaxed from the earlier double-anchor `**N.** … **N** ___`
# shape after Andy's real-world ILR-LIS-001 markdown showed only a single
# `**N.**` anchor with the gap somewhere inline. Underscore run is `_{3,}`
# so short (`___`) and long (`___________`) gaps both match. The first
# gap on the line wins; trailing prose becomes the suffix.
_SENTENCE_INLINE_RE = re.compile(
    r"^[ \t]*\*\*(\d{1,2})\.\*\*[ \t]+(.*?)_{3,}\.?[ \t]*(.*?)[ \t]*$",
    re.MULTILINE,
)


def parse_question_blocks(qp_section_text: str) -> list[dict[str, Any]]:
    """Parse one Question Paper section into a list of question-block dicts.

    Each block carries: ``{q_range: (lo, hi), instruction, q_type,
    questions: [{q_num, prompt, q_type, options?}, ...], metadata}``.
    """
    block_matches = list(_QUESTION_BLOCK_RE.finditer(qp_section_text))
    out: list[dict[str, Any]] = []

    for i, m in enumerate(block_matches):
        lo, hi = int(m.group(1)), int(m.group(2))
        start = m.end()
        end = (
            block_matches[i + 1].start()
            if i + 1 < len(block_matches)
            else len(qp_section_text)
        )
        body = qp_section_text[start:end]

        instruction = _first_blockquote(body)
        # P2 — explicit marker wins; regex classify is the fallback.
        marker = _read_qtype_marker(body)
        q_type, template_kind = marker if marker else _classify_instruction(instruction)

        meta: dict[str, Any] = {}
        if q_type == "mcq_letter_label":
            meta["map_description"] = _extract_map_description(body)
            meta["letter_options"] = list("ABCDEFGH")
            # Sprint 13.5.9 — pick up Andy's curated AI image-generation
            # prompt from the `<details>` block immediately after the
            # question block (if present). ``None`` means the image-gen
            # service will fall back to its template prompt.
            custom_prompt = _extract_custom_image_prompt(body)
            if custom_prompt:
                meta["map_image_custom_prompt"] = custom_prompt

        questions = _extract_questions(body, q_type, lo, hi)
        template = _extract_template(body, template_kind, lo, hi)

        out.append({
            "q_range":       (lo, hi),
            "instruction":   instruction,
            "q_type":        q_type,
            "template_kind": template_kind,
            "template":      template,
            "questions":     questions,
            "metadata":      meta,
        })
    return out


# ── Structural template extractors (Sprint 13.5.2) ─────────────────────────


def _extract_template(
    body: str, template_kind: str, q_lo: int, q_hi: int,
) -> dict[str, Any]:
    """Extract layout-specific structural context for the renderer.

    Returns a dict with keys that depend on ``template_kind``:

      form_completion     → {heading, rows: [{label, q_num | example}]}
      table_completion    → {heading, headers, rows: [[cell, …]]}
      notes_completion    → {heading, groups: [{heading?, items: [str]}]}
      sentence_completion → {sentences: [{q_num, prefix, suffix}]}
      summary_completion  → {paragraph: "<text with {{Q38}} tokens>"}
      mcq_3option         → {} (questions[] carry their own context)
      plan_label          → {} (metadata.map_description carries context)
      short_answer        → {} (questions[].prompt is enough)

    Each extractor is tolerant of missing structure; if the parser
    cannot find a clean template it returns an empty/empty-list value
    and the frontend falls back to the legacy gap-input layout.
    """
    in_range = lambda n: q_lo <= n <= q_hi      # noqa: E731
    body_no_example = _EXAMPLE_ITALIC_RE.sub("", body)

    if template_kind == "form_completion":
        return _extract_form_template(body, in_range)
    if template_kind == "table_completion":
        return _extract_table_template(body_no_example, in_range)
    if template_kind == "notes_completion":
        return _extract_notes_template(body_no_example, in_range)
    if template_kind == "summary_completion":
        return _extract_summary_template(body_no_example, in_range)
    if template_kind == "sentence_completion":
        return _extract_sentence_template(body_no_example, in_range)
    return {}


def _block_h4(body: str) -> str:
    m = _BLOCK_H4_RE.search(body)
    return m.group(1).strip() if m else ""


def _extract_form_template(body: str, in_range) -> dict[str, Any]:
    """Form completion — collect labelled rows. Examples are preserved
    as ``{label, example}`` so the renderer can render them grey, and
    numbered gaps as ``{label, q_num}``.
    """
    rows: list[dict[str, Any]] = []
    for m in _FORM_BULLET_LINE_RE.finditer(body):
        label = m.group(1).strip()
        value = m.group(2).strip()
        # Skip the H4 inside the body (regex above won't match it but be
        # defensive).
        if label.startswith("####"):
            continue
        example_m = re.match(r"^_([^_]+)\(Example\)[^_]*_", value, re.IGNORECASE)
        if example_m:
            rows.append({"label": label, "example": example_m.group(1).strip()})
            continue
        gap_m = re.search(r"\*\*(\d{1,2})\*\*", value)
        if gap_m:
            n = int(gap_m.group(1))
            if in_range(n):
                # Preserve any prefix text before the bold number (e.g. "£").
                prefix = value[: gap_m.start()].strip()
                rows.append({
                    "label":  label,
                    "q_num":  n,
                    "prefix": prefix,
                })
                continue
        # Anything else (rare in canonical fixtures) — preserve as text.
        rows.append({"label": label, "text": value})
    return {"heading": _block_h4(body), "rows": rows}


def _extract_table_template(body: str, in_range) -> dict[str, Any]:
    """Table completion — slurp the markdown table into headers + rows.
    A gap cell containing ``N ………`` is normalised to a ``{q_num}`` dict.
    """
    table_rows: list[list[str]] = []
    for m in _TABLE_ROW_RE.finditer(body):
        line = m.group(0).strip()
        if _TABLE_SEPARATOR_RE.match(line):
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        table_rows.append(cells)
    if not table_rows:
        return {"heading": _block_h4(body), "headers": [], "rows": []}
    headers, body_rows = table_rows[0], table_rows[1:]
    out_rows: list[list[Any]] = []
    for row in body_rows:
        cells_out: list[Any] = []
        for cell in row:
            gap = re.match(r"^(\d{1,2})\s+[…\.]+\s*$", cell)
            if gap:
                n = int(gap.group(1))
                if in_range(n):
                    cells_out.append({"q_num": n})
                    continue
            cells_out.append(cell)
        out_rows.append(cells_out)
    return {"heading": _block_h4(body), "headers": headers, "rows": out_rows}


def _extract_notes_template(body: str, in_range) -> dict[str, Any]:
    """Notes completion — flat bullet list under an H4. Andy's fixtures
    so far have a single group, but the schema is forward-compatible
    with multiple grouped sub-headings (H5 lines).
    """
    items: list[Any] = []
    for line in body.splitlines():
        s = line.strip()
        if not s or not s.startswith(("-", "*", "+")):
            continue
        # Sprint 13.5.5 — Andy's source markdown sometimes carries a
        # leading Unicode bullet inside the markdown bullet
        # (`- • Travellers …`) which rendered as a doubled bullet. Strip
        # any leading Unicode bullet glyph after the markdown bullet.
        s_content = s.lstrip("-*+").strip()
        s_content = re.sub(r"^[•·●○◦∙]\s*", "", s_content)
        gap_m = re.search(r"\*\*(\d{1,2})\*\*\s+_+\.?\s*(.*?)$", s_content)
        if gap_m:
            n = int(gap_m.group(1))
            if in_range(n):
                items.append({
                    "q_num":  n,
                    "prefix": s_content[: gap_m.start()].strip(),
                    "suffix": gap_m.group(2).strip(),
                })
                continue
        items.append({"text": s_content})
    return {
        "heading": _block_h4(body),
        "groups":  [{"items": items}] if items else [],
    }


def _extract_summary_template(body: str, in_range) -> dict[str, Any]:
    """Summary completion — find the paragraph following the
    instruction blockquote and replace each ``**N** _____`` with a
    ``{{QN}}`` token so the renderer can split + interleave gap inputs.
    """
    # Drop everything up to (and including) the first blockquote +
    # following blank lines, then take the next prose paragraph(s).
    bq_match = re.search(r"^>\s.*(?:\n>\s.*)*\n", body, re.MULTILINE)
    rest = body[bq_match.end():] if bq_match else body
    # Sprint 13.5.5 — bound the paragraph at the first horizontal-rule
    # separator so the END OF QUESTION PAPER footer (`**END OF QUESTION
    # PAPER**` + Test ID + format-version lines) doesn't get slurped
    # into Q40's context. Andy's canonical markdown uses `---` as the
    # end-of-paper boundary.
    rest = re.split(r"\n\s*-{3,}\s*(?:\n|$)", rest, maxsplit=1)[0]
    # Strip leading H4 if present — summary fixtures don't have one
    # but be defensive.
    rest = _BLOCK_H4_RE.sub("", rest, count=1).strip()
    paragraph = " ".join(line.strip() for line in rest.splitlines() if line.strip())
    paragraph = re.sub(r"\s+", " ", paragraph).strip()
    if not paragraph:
        return {"paragraph": ""}
    def replace_gap(m: re.Match[str]) -> str:
        n = int(m.group(1))
        return f"{{{{Q{n}}}}}" if in_range(n) else m.group(0)
    tokenised = re.sub(r"\*\*(\d{1,2})\*\*\s+_+", replace_gap, paragraph)
    # Collapse stray double spaces after substitution.
    tokenised = re.sub(r"\s+", " ", tokenised).strip()
    return {"paragraph": tokenised}


def _extract_sentence_template(body: str, in_range) -> dict[str, Any]:
    """Sentence completion — capture ``**N.** prefix **N** ___ suffix``
    so the renderer can show a full sentence with an inline gap rather
    than just the prompt + bare input.
    """
    sentences: list[dict[str, Any]] = []
    for m in _SENTENCE_INLINE_RE.finditer(body):
        n = int(m.group(1))
        if not in_range(n):
            continue
        sentences.append({
            "q_num":  n,
            "prefix": m.group(2).strip(),
            "suffix": m.group(3).strip(),
        })
    return {"sentences": sentences}


def _first_blockquote(body: str) -> str:
    """Return the first contiguous blockquote (joined ``>`` lines)."""
    lines = body.splitlines()
    collected: list[str] = []
    started = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(">"):
            collected.append(stripped.lstrip(">").strip())
            started = True
            continue
        if started:
            break
    return " ".join(collected).strip()


# ── Sprint 13.5.9 — custom AI image prompt extraction ──────────────────────
#
# Andy curates Cambridge-specific image-generation prompts (north arrow,
# letter positions, verification checklist) inside a `<details>` block
# placed directly after a plan-label question block. The block looks
# roughly like:
#
#     <details>
#     <summary>📐 AI image-generation prompt for this map</summary>
#
#     ... full curated prompt (markdown allowed) ...
#
#     </details>
#
# The parser surfaces the body verbatim on
# ``metadata.map_image_custom_prompt`` so the image-gen service can
# bypass its template and send Andy's prompt straight to the model.

_DETAILS_BLOCK_RE = re.compile(
    r"<details>\s*"
    r"<summary>(?P<summary>.*?)</summary>"
    r"(?P<body>.*?)"
    r"</details>",
    re.DOTALL | re.IGNORECASE,
)

# Matches "AI image-generation prompt" / "AI image generation prompt" /
# "AI Image-Generation Prompt for this map" — tolerant of dashes and
# casing, but the keywords must appear (so a `<details>` block with an
# unrelated summary like "Speaker notes" is ignored).
_AI_PROMPT_SUMMARY_RE = re.compile(
    r"AI\s+image[\s\-]*generation\s+prompt",
    re.IGNORECASE,
)

# Sprint 13.5.9.1 — Andy's actual summaries carry presentation HTML
# (emoji + `<strong>` wrapping the title + a trailing dash hint). The
# unwrapped substring "AI image-generation prompt" still appears inside
# them, but stripping the tags before matching makes the contract
# robust against future formats (e.g. `<em>`, links, nested spans).
_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _extract_custom_image_prompt(body: str) -> str | None:
    """Find the first `<details>` block whose summary mentions an
    AI image-generation prompt and return its body verbatim.

    Returns ``None`` when no matching block exists; the image-gen
    service then falls back to its template prompt.
    """
    for m in _DETAILS_BLOCK_RE.finditer(body):
        summary_raw = (m.group("summary") or "").strip()
        # Defensive: drop any inline HTML before searching for the
        # phrase so emoji-prefixed / `<strong>`-wrapped summaries match
        # the same as bare-text summaries.
        summary_clean = _HTML_TAG_RE.sub(" ", summary_raw).strip()
        if not _AI_PROMPT_SUMMARY_RE.search(summary_clean):
            continue
        prompt = (m.group("body") or "").strip()
        if not prompt:
            return None
        return prompt
    return None


def _extract_map_description(body: str) -> str:
    """Plan/map label blocks carry a second blockquote shaped
    ``> **Map description:** ...``. Return its text payload (after the
    bold label) if present, otherwise empty.
    """
    for bq in _ALL_BLOCKQUOTES_RE.finditer(body):
        # Strip the ``> `` prefixes line-by-line so the body text starts
        # at ``**Map description:**`` rather than at the blockquote marker.
        lines: list[str] = []
        for raw_line in bq.group(1).splitlines():
            lines.append(raw_line.lstrip(">").strip())
        text = " ".join(l for l in lines if l).strip()
        m = re.match(
            r"\*\*Map description:?\*\*\s*(.+)$",
            text,
            re.IGNORECASE | re.DOTALL,
        )
        if m:
            return m.group(1).strip()
    return ""


_ALL_BLOCKQUOTES_RE = re.compile(
    r"((?:^>.*$\n?)+)",
    re.MULTILINE,
)


def _extract_questions(
    body: str, q_type: str, q_lo: int, q_hi: int,
) -> list[dict[str, Any]]:
    """Per-question extraction dispatched by question type."""
    # Strip italic Example rows so they never sneak into any branch.
    body = _EXAMPLE_ITALIC_RE.sub("", body)
    in_range = lambda n: q_lo <= n <= q_hi      # noqa: E731

    if q_type == "mcq_3option":
        return _extract_mcq(body, in_range)
    if q_type == "mcq_letter_label":
        return _extract_plan_label(body, in_range)
    if q_type == "dictation_short_answer":
        return _extract_short_answer(body, in_range)
    # All gap_fill variants — try multiple shapes (form bullet, table
    # cell, plain numeric, inline-summary).
    return _extract_gap_fill(body, in_range)


def _extract_gap_fill(body: str, in_range) -> list[dict[str, Any]]:
    found: dict[int, dict[str, Any]] = {}

    for m in _BULLET_GAP_RE.finditer(body):
        label = m.group(1).strip()
        n = int(m.group(2))
        if in_range(n) and n not in found:
            found[n] = {
                "q_num":  n,
                "prompt": label,
                "q_type": "dictation_gap_fill",
                "variant": "form_bullet",
            }

    for m in _TABLE_CELL_GAP_RE.finditer(body):
        n = int(m.group(1))
        if in_range(n) and n not in found:
            found[n] = {
                "q_num":  n,
                "prompt": "",                   # row context too costly to capture
                "q_type": "dictation_gap_fill",
                "variant": "table_cell",
            }

    for m in _INLINE_NUM_GAP_RE.finditer(body):
        n = int(m.group(1))
        if in_range(n) and n not in found:
            found[n] = {
                "q_num":  n,
                "prompt": "",
                "q_type": "dictation_gap_fill",
                "variant": "inline",
            }

    # Sprint 13.5.3 — sentence-completion shape with a single `**N.**`
    # anchor and the gap somewhere on the rest of the line (3+
    # underscores). This was missing pre-13.5.3, so S3 Q27-30 + S4
    # Q35-37 silently dropped out of the questions list.
    for m in _SENTENCE_INLINE_RE.finditer(body):
        n = int(m.group(1))
        if in_range(n) and n not in found:
            prefix = m.group(2).strip()
            suffix = m.group(3).strip()
            # Keep the full sentence in `prompt` so old consumers
            # (Sprint 13.5 grader, mini-test summary, etc.) still see
            # context; the template extractor carries the structural
            # prefix/suffix split for the IELTS-authentic renderer.
            full = (prefix + " ___ " + suffix).strip()
            found[n] = {
                "q_num":  n,
                "prompt": full,
                "q_type": "dictation_gap_fill",
                "variant": "sentence_inline",
            }

    return [found[k] for k in sorted(found)]


def _extract_short_answer(body: str, in_range) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in _NUM_DOT_PROMPT_RE.finditer(body):
        n = int(m.group(1))
        if not in_range(n):
            continue
        prompt = m.group(2).strip().rstrip("_").rstrip(".").strip()
        prompt = re.sub(r"_+$", "", prompt).strip()
        out.append({
            "q_num":   n,
            "prompt":  prompt,
            "q_type":  "dictation_short_answer",
            "variant": "short_answer",
        })
    return out


def _extract_mcq(body: str, in_range) -> list[dict[str, Any]]:
    """Match each `**N.** Prompt` then collect its nested `- **A**`
    options up to the next numbered prompt (or section end).
    """
    # Find every "**N.** prompt" anchor in line-number order.
    anchors: list[tuple[int, int, str]] = []     # (offset, q_num, prompt)
    for m in _NUM_DOT_PROMPT_RE.finditer(body):
        n = int(m.group(1))
        if in_range(n):
            anchors.append((m.start(), n, m.group(2).strip()))

    out: list[dict[str, Any]] = []
    for i, (offset, n, prompt) in enumerate(anchors):
        end = anchors[i + 1][0] if i + 1 < len(anchors) else len(body)
        slice_ = body[offset:end]
        options: list[dict[str, str]] = []
        for opt in _MCQ_OPTION_LINE_RE.finditer(slice_):
            options.append({
                "letter": opt.group(1),
                "text":   opt.group(2).strip().rstrip(".").strip(),
            })
        out.append({
            "q_num":   n,
            "prompt":  prompt,
            "q_type":  "mcq_3option",
            "options": options,
            "variant": "mcq",
        })
    return out


def _extract_plan_label(body: str, in_range) -> list[dict[str, Any]]:
    """Plan/map labels share one set of A-H options for the whole block;
    each numbered item is just a label. We pin the label name as the
    prompt and surface the shared option set on each question (consumer
    can dedup if needed).
    """
    out: list[dict[str, Any]] = []
    for m in _NUM_DOT_PROMPT_RE.finditer(body):
        n = int(m.group(1))
        if not in_range(n):
            continue
        label = m.group(2).strip().rstrip("_").strip()
        label = re.sub(r"_+$", "", label).strip()
        out.append({
            "q_num":   n,
            "prompt":  label,
            "q_type":  "mcq_letter_label",
            "variant": "plan_label",
            "options": [{"letter": L, "text": ""} for L in list("ABCDEFGH")],
        })
    return out


# ── Answer-key parsing ─────────────────────────────────────────────────────


_PART_B_RE = re.compile(
    r"^##\s+PART\s+B\b.*$",
    re.MULTILINE | re.IGNORECASE,
)

_ANSWER_KEY_HEADER_RE = re.compile(
    r"^###\s+SECTION\s+([1-4])\s*[—–\-]\s*Answer\s+Key\s*$",
    re.MULTILINE | re.IGNORECASE,
)


def parse_answer_keys(sa_text: str) -> dict[int, list[dict[str, Any]]]:
    """Locate ``## PART B`` then every ``### SECTION N — Answer Key`` table.

    Each row yields ``{q_num, answer, notes, trap_mechanisms: [...]}``.
    Bold wrappers on answers are stripped. Alternative answers separated
    by ``/`` are surfaced via the ``alternatives`` field for downstream
    grading.
    """
    out: dict[int, list[dict[str, Any]]] = {1: [], 2: [], 3: [], 4: []}
    part_b = _PART_B_RE.search(sa_text)
    if not part_b:
        return out
    after = sa_text[part_b.end():]

    headers = list(_ANSWER_KEY_HEADER_RE.finditer(after))
    for i, h in enumerate(headers):
        section_num = int(h.group(1))
        start = h.end()
        end = headers[i + 1].start() if i + 1 < len(headers) else len(after)
        body = after[start:end]
        out[section_num] = _parse_answer_table(body)
    return out


def _parse_answer_table(table_text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    header_cols: list[str] | None = None
    for line in table_text.splitlines():
        if "|" not in line:
            if header_cols is not None:
                # End of table at first non-pipe line.
                break
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if not cells or all(not c for c in cells):
            continue
        if all(re.fullmatch(r":?-+:?", c) for c in cells if c):
            continue                              # separator row
        if header_cols is None:
            header_cols = [c.lower() for c in cells]
            continue

        col_map = {h: cells[i] if i < len(cells) else ""
                   for i, h in enumerate(header_cols)}
        q_raw = col_map.get("q#") or col_map.get("q") or col_map.get("question") or ""
        if not q_raw:
            continue
        m = re.match(r"(\d{1,2})", q_raw)
        if not m:
            continue
        q_num = int(m.group(1))
        ans_raw = col_map.get("answer") or ""
        ans = re.sub(r"\*\*", "", ans_raw).strip()
        alternatives = [a.strip() for a in re.split(r"\s*/\s*", ans) if a.strip()]
        notes = col_map.get("notes") or ""
        trap_raw = col_map.get("trap mechanisms") or col_map.get("trap mechanism") or ""
        traps = [t.strip() for t in re.split(r"[,;]", trap_raw) if t.strip()]
        rows.append({
            "q_num":           q_num,
            "answer":          ans,
            "alternatives":    alternatives,
            "notes":           notes,
            "trap_mechanisms": traps,
        })
    rows.sort(key=lambda r: r["q_num"])
    return rows


# ── Exercise grouping ──────────────────────────────────────────────────────


_Q_TYPE_TO_EXERCISE: dict[str, str] = {
    "dictation_gap_fill":     "dictation",
    "dictation_short_answer": "dictation",
    "mcq_3option":            "mcq",
    "mcq_letter_label":       "mcq",
    "unknown":                "dictation",
}


def build_exercises(
    question_blocks: list[dict[str, Any]],
    answers: list[dict[str, Any]],
    section_num: int,
) -> list[dict[str, Any]]:
    """Convert per-section question blocks + answers into exercise rows.

    Sprint 13.4.2 lock: one exercise row per Question-Paper block. This
    matches Andy's authoring shape (each H3 ``### Questions X-Y`` is a
    single exercise the student attempts as a unit).
    """
    answer_by_q = {a["q_num"]: a for a in answers}
    out: list[dict[str, Any]] = []
    for idx, block in enumerate(question_blocks):
        exercise_type = _Q_TYPE_TO_EXERCISE.get(block["q_type"], "dictation")
        payload_questions = []
        payload_answers = []
        for q in block.get("questions", []):
            entry = {
                "q_num":  q["q_num"],
                "prompt": q.get("prompt", ""),
            }
            if q.get("options"):
                entry["options"] = q["options"]
            if q.get("variant"):
                entry["variant"] = q["variant"]
            payload_questions.append(entry)
            if q["q_num"] in answer_by_q:
                payload_answers.append(answer_by_q[q["q_num"]])

        payload: dict[str, Any] = {
            "variant":       block["q_type"],
            "template_kind": block.get("template_kind", "unknown"),
            "instruction":   block.get("instruction", ""),
            "questions":     payload_questions,
            "answers":       payload_answers,
        }
        # Sprint 13.5.2 — structural template for the IELTS-authentic
        # renderer. Empty dict when the block kind has no extra context
        # (mcq_3option, plan_label, short_answer all carry their own).
        template = block.get("template") or {}
        if template:
            payload["template"] = template
        if block.get("metadata"):
            payload["metadata"] = block["metadata"]

        out.append({
            "exercise_type": exercise_type,
            "variant":       block["q_type"],
            "section_num":   section_num,
            "order_num":     idx + 1,
            "q_range":       block["q_range"],
            "payload":       payload,
        })
    return out


# ── Accent + CEFR inference (unchanged from 13.4) ──────────────────────────


_ACCENT_TO_TAG = {
    "bre":  "uk_rp",
    "amer": "us_general",
    "ame":  "us_general",
    "use":  "us_general",
    "us":   "us_general",
    "ause": "au",
    "aue":  "au",
    "au":   "au",
    "cae":  "ca",
    "ca":   "ca",
}


def infer_accent_tag(speakers: list[dict[str, Any]]) -> str:
    accents = {
        (sp.get("accent") or "").lower()
        for sp in speakers
        if sp.get("accent")
    }
    if not accents:
        return "other"
    mapped = {_ACCENT_TO_TAG.get(a, "other") for a in accents}
    return mapped.pop() if len(mapped) == 1 else "other"


def infer_cefr_level(band_target: float | None) -> str | None:
    if band_target is None:
        return None
    if band_target >= 8.5:  return "C2"
    if band_target >= 7.0:  return "C1"
    if band_target >= 5.5:  return "B2"
    if band_target >= 4.0:  return "B1"
    return "A2"


# ── Public entry points ───────────────────────────────────────────────────


def parse_listening_test(
    question_paper_bytes: bytes,
    script_answerkey_bytes: bytes,
) -> dict[str, Any]:
    """Parse Andy's 2-file Markdown bundle.

    The router decodes bytes here; everything downstream is pure text.
    """
    qp_text = question_paper_bytes.decode("utf-8")
    sa_text = script_answerkey_bytes.decode("utf-8")
    return parse_from_text(qp_text, sa_text)


def parse_from_text(qp_text: str, sa_text: str) -> dict[str, Any]:
    """Pure-text entry point. Returns the Sprint 13.4 ConvertResult shape."""
    warnings: list[str] = []
    errors: list[str] = []

    metadata = parse_test_metadata(qp_text, sa_text)
    if not metadata.get("test_id"):
        errors.append(
            "Không tìm thấy Test ID trong heading H1 của Question Paper. "
            "Kiểm tra dòng đầu file (định dạng: # IELTS LISTENING — <TEST_ID>)."
        )

    qp_sections = split_qp_sections(qp_text)
    if len(qp_sections) != 4:
        warnings.append(
            f"Phát hiện {len(qp_sections)} sections trong Question Paper "
            f"(kỳ vọng 4 dòng `## SECTION N`)."
        )
    script_sections = split_script_sections(sa_text)
    if len(script_sections) != 4:
        warnings.append(
            f"Phát hiện {len(script_sections)} sections trong Script "
            f"(kỳ vọng 4 dòng `### SECTION N (Sn)` dưới `## PART A`)."
        )

    answer_keys = parse_answer_keys(sa_text)

    sections_out: list[dict[str, Any]] = []
    total_word_count = 0

    for section_num in (1, 2, 3, 4):
        qp_body = qp_sections.get(section_num, "")
        script_body = script_sections.get(section_num, "")

        if not qp_body and not script_body:
            warnings.append(f"Section {section_num} không có dữ liệu ở cả hai file.")
            continue

        section_meta = parse_section_metadata(script_body)
        speakers = parse_section_speakers(script_body)
        narrator_intro = parse_narrator_intro(script_body)
        transcript_raw = extract_transcript(script_body)
        transcript_clean = strip_markers(transcript_raw)

        word_count = section_meta.get("word_count") or len(re.findall(r"\b\w+\b", transcript_clean))
        total_word_count += word_count or 0

        question_blocks = parse_question_blocks(qp_body)
        # Flat questions list (back-compat with Sprint 13.4 schema).
        flat_questions: list[dict[str, Any]] = []
        for block in question_blocks:
            for q in block["questions"]:
                flat_questions.append({
                    "q_num":  q["q_num"],
                    "prompt": q["prompt"],
                    "q_type": q["q_type"],
                    **({"options": q["options"]} if q.get("options") else {}),
                    **({"variant": q["variant"]} if q.get("variant") else {}),
                })

        answers = answer_keys.get(section_num, [])

        if not flat_questions:
            warnings.append(
                f"Section {section_num} không có question nào — kiểm tra "
                f"H3 `### Questions X-Y` trong Question Paper."
            )
        if answers and flat_questions and len(answers) != len(flat_questions):
            warnings.append(
                f"Section {section_num} mismatch: {len(flat_questions)} questions "
                f"vs {len(answers)} answers."
            )

        exercises = build_exercises(question_blocks, answers, section_num)

        themes = metadata.get("themes") or {}
        theme_text = themes.get(f"s{section_num}", "")

        accent_tag = infer_accent_tag(speakers)
        cefr_level = infer_cefr_level(metadata.get("band_target"))

        sections_out.append({
            "section_num":      section_num,
            "title":            theme_text or f"Section {section_num}",
            "theme":            theme_text,
            "transcript_raw":   transcript_raw,
            "transcript_clean": transcript_clean,
            "speakers":         speakers,
            "word_count":       word_count,
            "accent_tag":       accent_tag,
            "cefr_level":       cefr_level,
            "ielts_section":    section_num,
            "questions":        flat_questions,
            "answers":          answers,
            "exercises":        exercises,
            "narrator_intro":   narrator_intro,
            "context":          section_meta.get("context"),
            "register":         section_meta.get("register"),
        })

    # Drift warning vs declared total words.
    declared_total = metadata.get("total_words")
    if declared_total and total_word_count:
        drift = abs(total_word_count - declared_total) / declared_total
        if drift > 0.10:
            warnings.append(
                f"Word count drift {int(drift * 100)}%: parser counted "
                f"{total_word_count}, metadata declared {declared_total}."
            )

    return {
        "test_metadata":     metadata,
        "sections":          sections_out,
        "warnings":          warnings,
        "errors":            errors,
        "_total_word_count": total_word_count,
    }


# ── Section → listening_content row payload (unchanged contract) ──────────


def section_to_content_payload(
    section: dict[str, Any],
    test_id_uuid: str,
    test_metadata: dict[str, Any],
) -> dict[str, Any]:
    """Build the ``listening_content`` INSERT payload for one section.

    Uses the Sprint 13.3.1 placeholder pattern (audio_storage_path=NULL,
    duration=0, size=0, status='draft'). Andy uploads MP3s later via
    the existing bulk-upload flow.
    """
    test_external = test_metadata.get("test_id") or "test"
    theme_slug = re.sub(r"[^a-z0-9]+", "-", (section.get("theme") or "").lower()).strip("-")
    topic_tags = [test_external, f"section-{section['section_num']}"]
    if theme_slug:
        topic_tags.append(theme_slug)

    return {
        "source_type":            "test_section",
        "test_id":                test_id_uuid,
        "section_num":            section["section_num"],
        "audio_storage_path":     None,
        "audio_duration_seconds": 0,
        "audio_size_bytes":       0,
        "title":                  f"{test_external} — Section {section['section_num']}: "
                                  f"{section.get('theme') or 'Untitled'}",
        "transcript":             section["transcript_clean"],
        "accent_tag":             section["accent_tag"],
        "cefr_level":             section.get("cefr_level"),
        "ielts_section":          section["ielts_section"],
        "topic_tags":             topic_tags,
        "status":                 "draft",
        "is_premium":             False,
        "metadata": {
            "source_format":   test_metadata.get("source_format") or "cambridge_ielts_markdown",
            "speakers":        section["speakers"],
            "raw_transcript":  section["transcript_raw"],
            "word_count":      section["word_count"],
            "theme":           section.get("theme"),
            "narrator_intro":  section.get("narrator_intro"),
            "context":         section.get("context"),
            "register":        section.get("register"),
        },
    }


# ──────────────────────────────────────────────────────────────────────────
# DEPRECATED — Sprint 13.4 DOCX parser
# ──────────────────────────────────────────────────────────────────────────
#
# The original implementation parsed Cambridge IELTS bundles from DOCX
# via python-docx. Andy's 2026-05-21 architecture pivot replaces that
# with the Markdown parser above; the DOCX path is retained here as a
# git-history reference only. See PR #234 for the full Sprint 13.4
# implementation if a rollback is ever needed.
