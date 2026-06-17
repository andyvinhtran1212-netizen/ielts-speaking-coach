"""services/listening_fulltest_import.py — listening-fulltest-md-import (Phase A).

ADDITIVE importer for a listening FULL TEST authored as a 4-file pack (v1.1
"mass-production ready"):

    <ID>_Question_Paper.md   — student-facing prompts (same format the existing
                               2-file convert already parses → REUSED here)
    <ID>_Solution.md         — per-question rich chữa-bài: answer, audio:// window,
                               skills, VN translation, vocab+IPA, paraphrase,
                               traps, script extract, why-correct + a Quick
                               Answer Key table + band-conversion table
    timings.json             — section_offsets + per-question windows (section-rel)
    full_test.mp3            — one premixed file (uploaded to Supabase Storage,
                               NOT parsed here)

The legacy 2-file convert (`listening_convert.parse_from_text`) is untouched.
This module reuses its Question-Paper parsing (sections, question blocks,
templates, IMG-PROMPT) and layers the NEW Solution + timings parsing on top,
merging answer + audio window + rich solution into each question.

Authoritative replay window (commission 2026-06-06, Andy): the absolute
full_test window from the Solution `audio://` links, VALIDATED at import to
equal `timings.questions[q] + section_offsets[section]` within ±0.1s — fail-loud
on divergence (this is the "increase accuracy" lever). No migration: everything
rides existing JSONB (Pattern #15); solution is stripped during the live test
and revealed only in the review (reading #376 pattern).

Pure functions — the router decodes bytes + does the supabase writes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlparse

from services import listening_convert as lc

# Tolerance for the audio:// ↔ timings cross-check (seconds). Generous enough
# for float rounding, tight enough to catch a real section-offset mistake.
_WINDOW_TOLERANCE_S = 0.1
_EXPECTED_QUESTIONS = 40
_EXPECTED_SECTIONS = 4

_AUDIO_RE = re.compile(r"audio://[^\s)\"']+")
_QBLOCK_RE = re.compile(r"^###\s+Q(\d+)\b(.*?)(?=^###\s+Q\d+\b|\Z)", re.MULTILINE | re.DOTALL)
# A field label at line start: **<label>:**  (value may be inline OR multi-line
# until the next label — captured by slicing between label positions).
_FIELD_LABEL_RE = re.compile(r"^\*\*([^*\n][^\n]*?):\*\*[ \t]*", re.MULTILINE)


@dataclass
class FullTestParseResult:
    metadata: dict = field(default_factory=dict)
    sections: list = field(default_factory=list)
    questions: list = field(default_factory=list)   # 40 merged question dicts
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    display_transcript: dict = field(default_factory=dict)   # section_num -> [paragraph str]
    transcript_anchors: dict = field(default_factory=dict)    # q_num -> paragraph index

    @property
    def ok(self) -> bool:
        return not self.errors

    def as_preview(self) -> dict:
        return {
            "metadata":       self.metadata,
            "section_count":  len(self.sections),
            "question_count": len(self.questions),
            "questions":      self.questions,
            "errors":         self.errors,
            "warnings":       self.warnings,
            "ok":             self.ok,
        }


# ── audio:// link ──────────────────────────────────────────────────────────

def parse_audio_link(url: str) -> dict | None:
    """`audio://full_test.mp3?start=126.32&end=135.64&q=1&section=S1` →
    {file, start, end, q, section}. Returns None on a malformed link."""
    try:
        p = urlparse(url)
        qs = parse_qs(p.query)
        return {
            "file":    (p.netloc or p.path).lstrip("/"),
            "start":   float(qs["start"][0]),
            "end":     float(qs["end"][0]),
            "q":       int(qs["q"][0]),
            "section": qs.get("section", [None])[0],
        }
    except (KeyError, ValueError, IndexError):
        return None


# ── Quick Answer Key table ─────────────────────────────────────────────────

_QAK_CELL_RE = re.compile(r"\*\*(\d+)\.\*\*\s*([^|]+?)\s*(?=\||$)")


def split_answer_variants(raw: str) -> tuple[str, list[str]]:
    """A Quick-Answer-Key cell → (canonical, alternatives) for the grader.
    Handles the two authoring conventions:
      • `"12 / twelve"`   → ("12", ["twelve"])         — slash = accepted forms
      • `"(the) police"`  → ("police", ["the police"]) — (x) = optional word
    The grader normalises case/spacing, so we only enumerate word-level forms."""
    raw = (raw or "").strip()
    if not raw:
        return "", []
    parts = [p.strip() for p in raw.split("/") if p.strip()]
    forms: list[str] = []
    for p in parts:
        # optional words in parentheses → both with and without
        if "(" in p and ")" in p:
            with_opt = re.sub(r"[()]", "", p)
            with_opt = re.sub(r"\s+", " ", with_opt).strip()
            without_opt = re.sub(r"\s*\([^)]*\)\s*", " ", p)
            without_opt = re.sub(r"\s+", " ", without_opt).strip()
            for f in (without_opt, with_opt):
                if f and f not in forms:
                    forms.append(f)
        elif p not in forms:
            forms.append(p)
    if not forms:
        return raw, []
    return forms[0], forms[1:]


def parse_quick_answer_key(solution_text: str) -> dict[int, str]:
    """The `## Quick Answer Key` table → {q_num: answer}. Cells look like
    `**1.** Brighton`. Robust to the 4-column section layout."""
    out: dict[int, str] = {}
    # Bound to the QAK section so stray `**N.**` elsewhere can't leak in.
    m = re.search(r"##\s*Quick Answer Key(.*?)(?=\n##\s|\Z)", solution_text, re.DOTALL)
    region = m.group(1) if m else solution_text
    for cell in _QAK_CELL_RE.finditer(region):
        q = int(cell.group(1))
        ans = cell.group(2).strip().strip("|").strip()
        if ans:
            out[q] = ans
    return out


# ── Band-conversion table ──────────────────────────────────────────────────

def parse_band_conversion(solution_text: str) -> list[dict]:
    """`Raw score (40) | Band` table → [{raw_min, raw_max, band}]."""
    out: list[dict] = []
    m = re.search(r"Band conversion[\s\S]*?\n((?:[ \t]*\|.*\n)+)", solution_text)
    if not m:
        return out
    for row in m.group(1).splitlines():
        cells = [c.strip() for c in row.strip().strip("|").split("|")]
        if len(cells) != 2 or "Raw" in cells[0] or set(cells[0]) <= set("-: "):
            continue
        rng = re.findall(r"\d+", cells[0])
        band = re.findall(r"\d+(?:\.\d+)?", cells[1])
        if rng and band:
            out.append({
                "raw_min": int(rng[-1]), "raw_max": int(rng[0]),
                "band": float(band[0]),
            })
    return out


# ── Per-question Solution blocks ───────────────────────────────────────────

# Ordered, COLLISION-FREE label → key rules. Order matters: the most specific
# predicate wins first. (e.g. "📝 Dịch sát đoạn chứa đáp án (VN)" contains
# "đáp án" but must NOT be read as the answer — so `answer` requires the label
# to START with "Answer". "Keyword ↔ Paraphrase mapping" must beat the bare
# "Paraphrase" rule, so it's listed earlier.)
def _classify_field(label: str) -> str | None:
    L = label.strip()
    low = L.lower()
    rules = [
        ("answer",          lambda: low.startswith("answer")),
        ("relisten",        lambda: "re-listen" in low or "relisten" in low),
        ("translation_vi",  lambda: "dịch" in low),
        ("vocab_focus",     lambda: "trọng tâm" in low),
        ("vocab",           lambda: "từ vựng" in low or low.startswith("vocab")),
        ("paraphrase_map",  lambda: "keyword" in low or "mapping" in low),
        ("paraphrase",      lambda: "paraphrase" in low),
        ("trap_mechanisms", lambda: "mechanism" in low or "cơ chế" in low),
        ("trap",            lambda: "bẫy" in low or "trap" in low),
        ("skills",          lambda: "kĩ năng" in low or "kỹ năng" in low or "skill" in low),
        ("script",          lambda: "script" in low or "đoạn audio" in low or "trích" in low),
        ("why_correct",     lambda: "why correct" in low or "vì sao" in low),
    ]
    for key, pred in rules:
        if pred():
            return key
    return None


def parse_solution_blocks(solution_text: str) -> dict[int, dict]:
    """Each `### Q{n}` block → {q_num: {answer, audio_window, skills,
    translation_vi, vocab(_focus), paraphrase(_map), trap(_mechanisms),
    script, why_correct, relisten}}. Field VALUES are captured multi-line
    (label position → next label), so list/table fields survive. Rich prose is
    kept as raw markdown — the review UI renders it (XSS-safe)."""
    out: dict[int, dict] = {}
    for m in _QBLOCK_RE.finditer(solution_text):
        q_num = int(m.group(1))
        body = m.group(2)
        rec: dict[str, Any] = {}

        # audio:// window (authoritative replay window for this question)
        am = _AUDIO_RE.search(body)
        if am:
            link = parse_audio_link(am.group(0))
            if link:
                rec["audio_window"] = {
                    "start": link["start"], "end": link["end"],
                    "section": link["section"], "file": link["file"],
                }

        labels = list(_FIELD_LABEL_RE.finditer(body))
        for i, fm in enumerate(labels):
            key = _classify_field(fm.group(1))
            if not key:
                continue
            val_start = fm.end()
            val_end = labels[i + 1].start() if i + 1 < len(labels) else len(body)
            val = body[val_start:val_end].strip()
            if key == "answer":
                val = re.sub(r"^\*\*(.*?)\*\*$", r"\1", val).strip()
            if val and key not in rec:
                rec[key] = val
        out[q_num] = rec
    return out


# ── timings.json ───────────────────────────────────────────────────────────

def parse_timings(timings: dict) -> dict:
    """Flatten timings.json → {section_offsets, questions:{q:{start,end,
    section, abs_start, abs_end}}} where abs_* are full_test-relative."""
    offsets = (timings.get("full_test") or {}).get("section_offsets") or {}
    questions: dict[int, dict] = {}
    for sec in timings.get("sections") or []:
        sid = sec.get("id")
        off = float(offsets.get(sid, 0.0))
        for q_str, w in (sec.get("questions") or {}).items():
            q = int(q_str)
            start = float(w["start"]); end = float(w["end"])
            questions[q] = {
                "section": sid, "start": start, "end": end,
                "abs_start": round(start + off, 2), "abs_end": round(end + off, 2),
            }
    return {"section_offsets": offsets, "questions": questions}


# ── Full transcript (pack v1.2) ────────────────────────────────────────────
# v1.2 Solution.md adds two blocks at the tail:
#   `# Transcript (bản đọc …)`  — DISPLAY copy: `## Section N`, each turn a
#       blank-line-separated paragraph `**Name (role):** spoken text`. No cues,
#       no (Qn) markers. → what the review pane shows.
#   `# Audio Transcript / Script đầy đủ` — SOURCE copy: `### SECTION N (SN)`,
#       turns split by `**[VOICE-CODE]**` speaker lines, carrying `[cue]`
#       directives + `(Qn)` answer markers. → used ONLY to anchor each Qn to a
#       display paragraph (the two copies are the same dialogue, same order).
_DISPLAY_BLOCK_RE = re.compile(
    r"^#[ \t]+Transcript[ \t]*\(bản đọc[^\n]*\n(.*?)(?=^#[ \t])", re.MULTILINE | re.DOTALL)
_FULLSCRIPT_BLOCK_RE = re.compile(
    r"^#[ \t]+Audio Transcript[ \t]*/[ \t]*Script đầy đủ[^\n]*\n(.*?)(?=^#[ \t])",
    re.MULTILINE | re.DOTALL)
_DISPLAY_SEC_RE = re.compile(r"^##[ \t]+Section[ \t]+(\d+)\b[^\n]*$", re.MULTILINE)
_FULL_SEC_RE = re.compile(r"^###[ \t]+SECTION[ \t]+(\d+)\b[^\n]*$", re.MULTILINE)
_SPEAKER_LINE_RE = re.compile(r"^\*\*\[[^\]]+\]\*\*[ \t]*$", re.MULTILINE)
_SPEAKER_PREFIX_RE = re.compile(r"^\*\*[^*]+\*\*")     # **Name (role):** at a display paragraph head


def _spoken_tokens(text: str, strip_speaker: bool = False) -> list[str]:
    """Normalise a turn/paragraph to its spoken words for matching: drop the
    leading **speaker** label (display side), `[cue]` directives, `(Qn)` markers
    and punctuation; lowercase; split. Spelled-out letters (B-R-I-G-H-T-O-N)
    survive as single-char tokens — which makes the answer turn distinctive."""
    if strip_speaker:
        text = _SPEAKER_PREFIX_RE.sub(" ", text.strip())
    text = re.sub(r"\[[^\]]*\]", " ", text)        # production cues
    text = re.sub(r"\(Q\d+\)", " ", text)          # answer markers
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return [t for t in text.lower().split() if t]


def parse_display_transcript(solution_text: str) -> dict[int, list[str]]:
    """`# Transcript (bản đọc)` → {section_num: [paragraph, …]} verbatim (label
    + spoken text kept; the frontend renders the **bold** label). {} if absent."""
    m = _DISPLAY_BLOCK_RE.search(solution_text)
    if not m:
        return {}
    parts = _DISPLAY_SEC_RE.split(m.group(1))   # [pre, '1', body1, '2', body2, …]
    out: dict[int, list[str]] = {}
    for i in range(1, len(parts), 2):
        sec = int(parts[i])
        paras = [p.strip() for p in re.split(r"\n[ \t]*\n", parts[i + 1]) if p.strip()]
        if paras:
            out[sec] = paras
    return out


def parse_fullscript_qturns(solution_text: str) -> dict[int, list[str]]:
    """`# Audio Transcript / Script đầy đủ` → {q_num: spoken_tokens_of_its_turn}.
    A turn carrying two markers (e.g. Q7 & Q8 share one sentence) maps both to
    the same tokens → both anchor to the same display paragraph (dedup falls out
    naturally). {} if absent."""
    m = _FULLSCRIPT_BLOCK_RE.search(solution_text)
    if not m:
        return {}
    parts = _FULL_SEC_RE.split(m.group(1))
    out: dict[int, list[str]] = {}
    for i in range(1, len(parts), 2):
        for turn in _SPEAKER_LINE_RE.split(parts[i + 1]):
            qs = [int(x) for x in re.findall(r"\(Q(\d+)\)", turn)]
            if not qs:
                continue
            toks = _spoken_tokens(turn)
            for q in qs:
                out[q] = toks
    return out


def compute_transcript_anchors(
    display: dict[int, list[str]],
    qturns: dict[int, list[str]],
    questions: list[dict],
) -> dict[int, int]:
    """For each question, pick the display paragraph (within the question's
    section) whose spoken words best contain the question's source turn → return
    {q_num: paragraph_index}. Best = max shared-token count, tie-broken by
    containment ratio. Questions with no usable turn are left unanchored (the
    caller warns); we never emit a wrong index."""
    para_tokens: dict[int, list[set]] = {
        sec: [set(_spoken_tokens(p, strip_speaker=True)) for p in paras]
        for sec, paras in display.items()
    }
    anchors: dict[int, int] = {}
    for q in questions:
        n = q["q_num"]
        src = qturns.get(n)
        sec = q.get("section_num")
        paras = para_tokens.get(sec)
        if not src or not paras:
            continue
        src_set = set(src)
        best_i, best_overlap, best_ratio = -1, 0, 0.0
        for i, pt in enumerate(paras):
            overlap = len(src_set & pt)
            ratio = overlap / max(1, len(src_set))
            if overlap > best_overlap or (overlap == best_overlap and ratio > best_ratio):
                best_i, best_overlap, best_ratio = i, overlap, ratio
        # require a real match (≥4 shared tokens AND ≥40% of the turn present)
        if best_i >= 0 and best_overlap >= 4 and best_ratio >= 0.4:
            anchors[n] = best_i
    return anchors


# ── Public entry point ─────────────────────────────────────────────────────

def parse_fulltest(qp_text: str, solution_text: str, timings: dict) -> FullTestParseResult:
    """Parse + cross-validate the 3 text artifacts into a merged 40-question
    structure ready for persistence. Fail-loud: every gap is an explicit error."""
    res = FullTestParseResult()

    # ── Question Paper (REUSE the existing convert parser) ──
    qp_meta = lc.parse_test_metadata(qp_text, solution_text)
    qp_sections = lc.split_qp_sections(qp_text)
    # Mini test: accept 1–4 sections (a full test is exactly 4, a mini is 1).
    # The DB CHECK is section_num BETWEEN 1 AND 4, so 1–4 is always valid; the
    # rest of the pipeline (questions, persistence) is already data-driven.
    if not (1 <= len(qp_sections) <= _EXPECTED_SECTIONS):
        res.errors.append(
            f"Question Paper có {len(qp_sections)} section (kỳ vọng 1–{_EXPECTED_SECTIONS} "
            f"dòng `## SECTION N`).")

    qak = parse_quick_answer_key(solution_text)
    sol_blocks = parse_solution_blocks(solution_text)
    tim = parse_timings(timings)

    res.metadata = {
        "test_id":           qp_meta.get("test_id"),
        "title":             qp_meta.get("title"),
        "band_target":       qp_meta.get("band_target"),
        "accent_profile":    qp_meta.get("accent_profile") or [],
        "topic_distribution": lc.parse_topic_distribution(solution_text),
        "band_conversion":   parse_band_conversion(solution_text),
        "section_offsets":   tim["section_offsets"],
        "format_version":    "listening-fulltest-v1.1",
    }

    # ── Per-section question blocks → merged questions ──
    seen_q: set[int] = set()
    for section_num in sorted(qp_sections):
        blocks = lc.parse_question_blocks(qp_sections[section_num])
        sec_id = f"S{section_num}"
        sec_qcount = 0
        for block in blocks:
            # W-0 — never classify a block as a guess silently. An `unknown`
            # q_type means the instruction matched no marker + no regex; warn so
            # the admin preview shows a red banner instead of mis-rendering.
            if block.get("q_type") == "unknown":
                q_nums = [q.get("q_num") for q in block.get("questions", [])]
                res.warnings.append(
                    f"Câu {q_nums}: không nhận diện được dạng câu hỏi "
                    f"(thiếu marker <!-- qtype --> và không khớp regex) — "
                    f"web sẽ render fallback, cần kiểm tra."
                )
            for q in block.get("questions", []):
                q_num = q["q_num"]
                seen_q.add(q_num)
                sec_qcount += 1
                canonical, alternatives = split_answer_variants(qak.get(q_num) or "")
                merged = {
                    "q_num":         q_num,
                    "section":       sec_id,
                    "section_num":   section_num,
                    "question_type": block["q_type"],
                    "template_kind": block.get("template_kind"),
                    "prompt":        q.get("prompt", ""),
                    "options":       q.get("options"),
                    "img_prompt":    (block.get("metadata") or {}).get("map_image_custom_prompt"),
                    "answer":        canonical or None,
                    "alternatives":  alternatives,
                    "solution":      sol_blocks.get(q_num, {}),
                }
                # Replay window: audio:// is authoritative; validate vs timings.
                sol = sol_blocks.get(q_num) or {}
                win = sol.get("audio_window")
                merged["audio_window"] = (
                    {"start": win["start"], "end": win["end"], "section": win.get("section") or sec_id}
                    if win else None
                )
                res.questions.append(merged)
        res.sections.append({"id": sec_id, "section_num": section_num, "question_count": sec_qcount})

    res.questions.sort(key=lambda x: x["q_num"])

    # ── Full transcript (v1.2) + per-question anchors ──
    res.display_transcript = parse_display_transcript(solution_text)
    if res.display_transcript:
        qturns = parse_fullscript_qturns(solution_text)
        res.transcript_anchors = compute_transcript_anchors(
            res.display_transcript, qturns, res.questions)
        res.metadata["format_version"] = "listening-fulltest-v1.2"
        res.metadata["transcript_source"] = "fulltext"
        missing = [q["q_num"] for q in res.questions
                   if q["q_num"] not in res.transcript_anchors]
        if missing:
            res.warnings.append(
                f"Transcript anchor thiếu cho câu {missing} — bản đọc highlight "
                f"sẽ không nhảy tới đoạn cho các câu này (kiểm tra (Qn) trong "
                f"'Script đầy đủ').")
    else:
        # Backward-compat: pack v1.1 has no transcript block → joined-extracts
        # fallback (build_section_persistence) + a dry-run warning, not a hard fail.
        res.metadata["transcript_source"] = "joined-extracts"
        res.warnings.append(
            "Pack không có block '# Transcript (bản đọc)' — dùng fallback "
            "joined-extracts (v1.1). Transcript pane sẽ chỉ là các trích đoạn "
            "theo câu, không phải bản đọc đầy đủ.")

    # ── Fail-loud validation ──
    _validate(res, qak, sol_blocks, tim, seen_q)
    return res


# ── Persistence builders (A2) — pure; the router stamps ids + does I/O ──────

_ACCENT_MAP = {"bre": "uk_rp", "ame": "us_general", "ame_": "us_general",
               "use": "us_general", "us": "us_general", "ause": "au",
               "aue": "au", "au": "au", "cae": "ca", "ca": "ca"}


def _accent_tag(profile: list | None) -> str:
    mapped = {_ACCENT_MAP.get(re.sub(r"[^a-z]", "", (a or "").lower()), "other")
              for a in (profile or [])}
    if not mapped:
        return "other"
    return mapped.pop() if len(mapped) == 1 else "other"


def build_cue_points(section_offsets: dict) -> list[dict]:
    """section_offsets {S1:31.22,…} → cue_points for the student player
    (full_premixed mode highlights sections at these full_test timestamps)."""
    out = []
    for sid, off in (section_offsets or {}).items():
        m = re.search(r"\d+", sid or "")
        if not m:
            continue
        out.append({"type": "section", "section_num": int(m.group()),
                    "timestamp_seconds": round(float(off), 2)})
    return sorted(out, key=lambda c: c["section_num"])


def build_section_persistence(res: "FullTestParseResult", qp_text: str) -> list[dict]:
    """Per section → {section_num, content_row, exercise_rows}. Exercises are
    BLOCK-SHAPED (one row per Question-Paper block, via the existing
    build_exercises) so the existing player + grader consume them unchanged;
    each payload is ENRICHED with per-question audio_windows + solutions for the
    review. The router stamps id / test_id / content_id and inserts."""
    qp_sections = lc.split_qp_sections(qp_text)
    by_q = {q["q_num"]: q for q in res.questions}
    accent = _accent_tag(res.metadata.get("accent_profile"))
    cefr = lc.infer_cefr_level(res.metadata.get("band_target"))
    topic = res.metadata.get("topic_distribution") or {}
    offsets = res.metadata.get("section_offsets") or {}
    test_ext = res.metadata.get("test_id") or "test"

    out: list[dict] = []
    for section_num in sorted(qp_sections):
        sec_id = f"S{section_num}"
        sec_questions = [q for q in res.questions if q["section_num"] == section_num]
        blocks = lc.parse_question_blocks(qp_sections[section_num])
        answers = [{"q_num": q["q_num"], "answer": q["answer"] or "",
                    "alternatives": q.get("alternatives") or []} for q in sec_questions]
        exercises = lc.build_exercises(blocks, answers, section_num)
        anchors = res.transcript_anchors or {}
        for ex in exercises:
            lo, hi = ex["q_range"]
            ex["payload"]["audio_windows"] = {
                str(q): by_q[q]["audio_window"]
                for q in range(lo, hi + 1) if by_q.get(q) and by_q[q].get("audio_window")
            }
            ex["payload"]["solutions"] = {
                str(q): by_q[q]["solution"]
                for q in range(lo, hi + 1) if by_q.get(q)
            }
            # v1.2: per-question paragraph index into the section's display
            # transcript (Pattern #15 — rides the payload JSONB, no migration).
            ex["payload"]["transcript_anchors"] = {
                str(q): anchors[q] for q in range(lo, hi + 1) if q in anchors
            }

        # v1.2: the full DISPLAY transcript (bản đọc) is the source of truth for
        # the pane. v1.1 fallback: synthesise from the per-question script
        # extracts (the review still shows them per question).
        disp = (res.display_transcript or {}).get(section_num)
        if disp:
            transcript = "\n\n".join(disp)
        else:
            script_bits = [by_q[q]["solution"].get("script")
                           for q in sorted(by_q) if by_q[q]["section_num"] == section_num]
            transcript = "\n\n".join(s for s in script_bits if s) \
                or "(Transcript chi tiết theo từng câu — xem bài chữa.)"
        theme = topic.get(sec_id.lower()) or topic.get(f"s{section_num}") or ""
        theme_slug = re.sub(r"[^a-z0-9]+", "-", theme.lower()).strip("-")

        out.append({
            "section_num": section_num,
            "content_row": {
                "source_type":            "test_section",
                "section_num":            section_num,
                "audio_storage_path":     None,    # full-premixed: audio on the test row
                "audio_duration_seconds": 0,
                "audio_size_bytes":       0,
                "title":                  f"{test_ext} — Section {section_num}: {theme or 'Untitled'}",
                "transcript":             transcript,
                "accent_tag":             accent,
                "cefr_level":             cefr,
                "ielts_section":          section_num,
                "topic_tags":             [test_ext, f"section-{section_num}"] + ([theme_slug] if theme_slug else []),
                "status":                 "draft",
                "is_premium":             False,
                "metadata": {
                    "source_format":     res.metadata.get("format_version", "listening-fulltest-v1.1"),
                    "transcript_source": res.metadata.get("transcript_source", "joined-extracts"),
                    "theme":             theme,
                    "section_offset":    offsets.get(sec_id),
                },
            },
            "exercise_rows": exercises,
        })
    return out


def _validate(res: FullTestParseResult, qak: dict, sol_blocks: dict,
              tim: dict, seen_q: set[int]) -> None:
    # Questions must be contiguous from 1..max (no gaps). A full test runs 1..40;
    # a mini runs 1..M (M = however many the QP declares). Don't hard-require 40
    # so a 1-section mini imports cleanly.
    last_q = max(seen_q) if seen_q else 0
    missing_qp = [q for q in range(1, last_q + 1) if q not in seen_q]
    if missing_qp:
        res.errors.append(f"Question Paper thiếu câu: {missing_qp} (kỳ vọng liên tục 1–{last_q}).")
    if not seen_q:
        res.errors.append("Question Paper không có câu hỏi nào.")
    elif len(seen_q) > _EXPECTED_QUESTIONS:
        res.warnings.append(f"Question Paper có {len(seen_q)} câu (> {_EXPECTED_QUESTIONS}).")

    for q in res.questions:
        n = q["q_num"]
        # every question must have an answer (Quick Answer Key)
        if not q.get("answer"):
            res.errors.append(f"Q{n}: thiếu đáp án trong Quick Answer Key.")
        # every question must have a replay window (audio://)
        win = q.get("audio_window")
        if not win:
            res.errors.append(f"Q{n}: thiếu audio:// replay window trong Solution.")
            continue
        if win["end"] <= win["start"]:
            res.errors.append(f"Q{n}: audio window không hợp lệ (end ≤ start: {win['start']}–{win['end']}).")
        # cross-check audio:// == timings.questions[q] + section_offset (±0.1s)
        t = tim["questions"].get(n)
        if not t:
            res.warnings.append(f"Q{n}: không có timing trong timings.json để đối chiếu.")
        else:
            if abs(win["start"] - t["abs_start"]) > _WINDOW_TOLERANCE_S or \
               abs(win["end"] - t["abs_end"]) > _WINDOW_TOLERANCE_S:
                res.errors.append(
                    f"Q{n}: audio:// window ({win['start']}–{win['end']}) lệch với "
                    f"timings+offset ({t['abs_start']}–{t['abs_end']}) quá ±{_WINDOW_TOLERANCE_S}s "
                    f"— section {t['section']}.")

    # exactly 4 sections, each with 10 questions
    if len(res.sections) == _EXPECTED_SECTIONS:
        for s in res.sections:
            if s["question_count"] != 10:
                res.warnings.append(f"{s['id']}: {s['question_count']} câu (kỳ vọng 10).")
