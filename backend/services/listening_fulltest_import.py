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


# ── Public entry point ─────────────────────────────────────────────────────

def parse_fulltest(qp_text: str, solution_text: str, timings: dict) -> FullTestParseResult:
    """Parse + cross-validate the 3 text artifacts into a merged 40-question
    structure ready for persistence. Fail-loud: every gap is an explicit error."""
    res = FullTestParseResult()

    # ── Question Paper (REUSE the existing convert parser) ──
    qp_meta = lc.parse_test_metadata(qp_text, solution_text)
    qp_sections = lc.split_qp_sections(qp_text)
    if len(qp_sections) != _EXPECTED_SECTIONS:
        res.errors.append(
            f"Question Paper có {len(qp_sections)} section (kỳ vọng {_EXPECTED_SECTIONS} dòng `## SECTION N`).")

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
            for q in block.get("questions", []):
                q_num = q["q_num"]
                seen_q.add(q_num)
                sec_qcount += 1
                merged = {
                    "q_num":         q_num,
                    "section":       sec_id,
                    "section_num":   section_num,
                    "question_type": block["q_type"],
                    "template_kind": block.get("template_kind"),
                    "prompt":        q.get("prompt", ""),
                    "options":       q.get("options"),
                    "img_prompt":    (block.get("metadata") or {}).get("map_image_custom_prompt"),
                    "answer":        qak.get(q_num),
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

    # ── Fail-loud validation ──
    _validate(res, qak, sol_blocks, tim, seen_q)
    return res


def _validate(res: FullTestParseResult, qak: dict, sol_blocks: dict,
              tim: dict, seen_q: set[int]) -> None:
    # 40 questions present in the Question Paper
    missing_qp = [q for q in range(1, _EXPECTED_QUESTIONS + 1) if q not in seen_q]
    if missing_qp:
        res.errors.append(f"Question Paper thiếu câu: {missing_qp} (kỳ vọng 1–{_EXPECTED_QUESTIONS}).")
    if len(seen_q) != _EXPECTED_QUESTIONS:
        res.warnings.append(f"Question Paper có {len(seen_q)} câu (kỳ vọng {_EXPECTED_QUESTIONS}).")

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
