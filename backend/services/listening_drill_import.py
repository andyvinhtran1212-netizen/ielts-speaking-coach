"""Skill-drill importer — turn a drill Source_JSON into the SAME row shapes the
Cambridge full/mini-test pipeline produces, so the existing player + grader +
review consume drills unchanged.

A skill drill is, structurally, a 1-section mini test that isolates ONE IELTS
listening question type (flowchart, form, note, sentence, summary, table, mcq,
mcq_multi, matching, map, short_answer). We reuse
``listening_convert.build_exercises`` (block-shaped exercises → the player/grader
contract) and mirror ``listening_fulltest_import.build_section_persistence``'s
payload enrichment (per-question ``audio_windows`` + ``solutions`` +
``transcript_anchors``).

Public API:
    parse_drill(source_json, timings) -> DrillParseResult

The router stamps ids / test_id / content_id and inserts (see the
``/admin/listening/drills/import`` commit route). ``parse_drill`` is pure and
deterministic — no DB, no network — so it is unit-testable against the real
Source_JSON files.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import listening_convert as lc
from .listening_grader import build_turn_segments


# ── render → (q_type, template_kind) ───────────────────────────────────────
# Keyed off the drill block's ``render`` field. Values reuse the canonical
# marker map in listening_convert so a drill's exercises are byte-identical to
# what Andy's markdown importer emits (same variant + template_kind the player
# switches on).
_RENDER_TO_MARKER: dict[str, str] = {
    "flowchart":    "flow_chart",
    "form":         "form_completion",
    "note":         "notes_completion",
    "sentence":     "sentence_completion",
    "summary":      "summary_completion",
    "table":        "table_completion",
    "short_answer": "short_answer",
    "mcq":          "mcq_3option",
    "mcq_multi":    "mcq_multi",
    "matching":     "matching",
    "map":          "plan_label",
}

# Short, stable skill key for grouping on the Skills-Practice page. Same set of
# 11 keys the frontend renders section cards for.
_RENDER_TO_SKILL: dict[str, str] = {
    "flowchart":    "flowchart",
    "form":         "form",
    "note":         "note",
    "sentence":     "sentence",
    "summary":      "summary",
    "table":        "table",
    "short_answer": "short_answer",
    "mcq":          "mcq",
    "mcq_multi":    "mcq_multi",
    "matching":     "matching",
    "map":          "map",
}

# A run of underscores (the drill's gap placeholder, e.g. "__________") OR a
# lone "___". Used to split completion prompts into prefix / suffix.
_GAP_RE = re.compile(r"_{2,}")

# TTS / authoring markers embedded in a drill's audio_script. We keep the
# stressed word, drop the rest, so the review transcript pane reads cleanly.
_STRESS_RE = re.compile(r"\[stress:\s*([^\]]+?)\s*\]", re.IGNORECASE)
_BRACKET_CUE_RE = re.compile(r"\[(?:emotion|pause|sfx|emphasis|tone)[^\]]*\]", re.IGNORECASE)
_QMARK_RE = re.compile(r"\(Q\d+\)", re.IGNORECASE)


@dataclass
class DrillParseResult:
    """Everything the commit route needs to persist one drill. The router stamps
    ids and inserts; ``parse_drill`` never touches the DB."""
    test_metadata: dict[str, Any] = field(default_factory=dict)
    content_row: dict[str, Any] = field(default_factory=dict)
    exercise_rows: list[dict[str, Any]] = field(default_factory=list)
    cue_points: list[dict[str, Any]] = field(default_factory=list)
    section_num: int = 0
    question_count: int = 0
    has_audio: bool = False
    audio_duration_seconds: float | None = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ── small helpers ──────────────────────────────────────────────────────────

def _to_int(q: Any) -> int | None:
    try:
        return int(str(q).strip())
    except (TypeError, ValueError):
        return None


def _split_gap(text: str) -> tuple[str, str]:
    """Split a completion prompt on its gap placeholder into (prefix, suffix).
    If there's no placeholder, the whole text is the prefix (gap rendered
    after it)."""
    m = _GAP_RE.search(text or "")
    if not m:
        return (text or "").strip(), ""
    return text[: m.start()].strip(), text[m.end():].strip()


def _strip_placeholder(text: str) -> str:
    """Remove the gap placeholder from a prompt (flow-chart / short-answer
    render puts the gap AFTER the prompt, so a literal blank would double up)."""
    return re.sub(r"\s{2,}", " ", _GAP_RE.sub(" ", text or "")).strip()


def _clean_transcript_text(text: str) -> str:
    out = _STRESS_RE.sub(r"\1", text or "")
    out = _BRACKET_CUE_RE.sub(" ", out)
    out = _QMARK_RE.sub(" ", out)
    out = re.sub(r"[ \t]+", " ", out)
    return out.strip()


def _answer_entry(a: dict[str, Any]) -> dict[str, Any] | None:
    q = _to_int(a.get("qnum") if "qnum" in a else a.get("q_num"))
    if q is None:
        return None
    return {
        "q_num":           q,
        "answer":          str(a.get("answer") or "").strip(),
        "alternatives":    list(a.get("accept") or a.get("alternatives") or []),
        "notes":           a.get("notes") or "",
        "trap_mechanisms": list(a.get("trap_mechanisms") or []),
    }


# ── per-render internal-block builders ─────────────────────────────────────
# Each returns the internal block shape build_exercises() consumes:
#   {q_type, template_kind, instruction, questions[], template?/metadata?, q_range}

def _block_flowchart(blk: dict, q_type: str, tk: str) -> dict:
    qs = [{"q_num": _to_int(s.get("qnum")), "prompt": _strip_placeholder(s.get("label", ""))}
          for s in blk.get("steps", []) if _to_int(s.get("qnum")) is not None]
    return _wrap(q_type, tk, blk, qs)


def _block_form(blk: dict, q_type: str, tk: str) -> dict:
    rows: list[dict[str, Any]] = []
    qs: list[dict[str, Any]] = []
    for ln in blk.get("lines", []):
        if isinstance(ln, str):
            rows.append({"text": ln})
            continue
        q = _to_int(ln.get("qnum"))
        label = ln.get("label", "")
        suffix = ln.get("suffix")
        if q is None:
            # Non-gap labelled line, possibly an "(Example)" hint in suffix.
            if suffix and "(example)" in str(suffix).lower():
                rows.append({"label": label, "example": re.sub(r"\s*\(example\)\s*$", "", suffix, flags=re.IGNORECASE)})
            else:
                rows.append({"label": label, "text": suffix or ""})
            continue
        row: dict[str, Any] = {"label": label, "q_num": q}
        if suffix:
            row["suffix"] = suffix
        rows.append(row)
        qs.append({"q_num": q, "prompt": label})
    return _wrap(q_type, tk, blk, qs, template={"title": blk.get("title", ""), "heading": blk.get("title", ""), "rows": rows})


def _block_note(blk: dict, q_type: str, tk: str) -> dict:
    items: list[dict[str, Any]] = []
    qs: list[dict[str, Any]] = []
    for ln in blk.get("lines", []):
        if isinstance(ln, str):
            items.append({"text": ln})
            continue
        q = _to_int(ln.get("qnum"))
        label = ln.get("label", "")
        if q is None:
            items.append({"text": label})
            continue
        prefix, suffix = _split_gap(label)
        item: dict[str, Any] = {"q_num": q, "prefix": prefix}
        if suffix:
            item["suffix"] = suffix
        items.append(item)
        qs.append({"q_num": q, "prompt": label})
    template = {"heading": blk.get("title", ""), "groups": [{"items": items}]}
    return _wrap(q_type, tk, blk, qs, template=template)


def _block_sentence(blk: dict, q_type: str, tk: str) -> dict:
    sentences: list[dict[str, Any]] = []
    qs: list[dict[str, Any]] = []
    for ln in blk.get("lines", []):
        q = _to_int(ln.get("qnum"))
        if q is None:
            continue
        prefix, suffix = _split_gap(ln.get("text", ""))
        sentences.append({"q_num": q, "prefix": prefix, "suffix": suffix})
        qs.append({"q_num": q, "prompt": ln.get("text", "")})
    return _wrap(q_type, tk, blk, qs, template={"title": blk.get("title", ""), "sentences": sentences})


def _block_summary(blk: dict, q_type: str, tk: str) -> dict:
    # Drill: "(1) ___" tokens → renderer wants "{{Q1}}".
    paragraph = re.sub(r"\(\s*(\d+)\s*\)\s*_{2,}", lambda m: "{{Q%s}}" % m.group(1), blk.get("summary_text", ""))
    qs = [{"q_num": _to_int(q.get("qnum")), "prompt": q.get("sentence", "")}
          for q in blk.get("questions", []) if _to_int(q.get("qnum")) is not None]
    return _wrap(q_type, tk, blk, qs, template={"title": blk.get("title", ""), "paragraph": paragraph})


def _block_table(blk: dict, q_type: str, tk: str) -> dict:
    def cell(c: Any) -> Any:
        m = re.fullmatch(r"\{Q(\d+)\}", str(c).strip())
        return {"q_num": int(m.group(1))} if m else c
    rows = [[cell(c) for c in row] for row in blk.get("rows", [])]
    prompts = {_to_int(q.get("qnum")): q.get("question", "") for q in blk.get("questions", [])}
    qs = [{"q_num": q, "prompt": prompts.get(q, "")} for q in sorted(p for p in prompts if p is not None)]
    template = {"heading": blk.get("title", ""), "headers": blk.get("columns", []), "rows": rows}
    return _wrap(q_type, tk, blk, qs, template=template)


def _block_mcq(blk: dict, q_type: str, tk: str) -> dict:
    qs = []
    for q in blk.get("questions", []):
        qn = _to_int(q.get("qnum"))
        if qn is None:
            continue
        qs.append({"q_num": qn, "prompt": q.get("stem", ""), "options": q.get("options", [])})
    return _wrap(q_type, tk, blk, qs)


def _block_short(blk: dict, q_type: str, tk: str) -> dict:
    qs = [{"q_num": _to_int(q.get("qnum")), "prompt": q.get("stem", "")}
          for q in blk.get("questions", []) if _to_int(q.get("qnum")) is not None]
    return _wrap(q_type, tk, blk, qs)


def _block_matching(blk: dict, q_type: str, tk: str) -> dict:
    options = blk.get("options", [])
    qs = [{"q_num": _to_int(q.get("qnum")), "prompt": q.get("text", "")}
          for q in blk.get("questions", []) if _to_int(q.get("qnum")) is not None]
    meta = {"match_options": options, "letter_options": [o.get("letter") for o in options if o.get("letter")]}
    return _wrap(q_type, tk, blk, qs, metadata=meta)


def _block_mcq_multi(blk: dict, q_type: str, tk: str) -> dict:
    prompt = blk.get("prompt", "")
    qnums = [_to_int(x) for x in blk.get("qnums", [])]
    qs = [{"q_num": q, "prompt": prompt} for q in qnums if q is not None]
    meta = {"match_options": blk.get("options", []), "choose": blk.get("select") or len(qs)}
    return _wrap(q_type, tk, blk, qs, metadata=meta)


def _block_map(blk: dict, q_type: str, tk: str, answers: list[dict]) -> dict:
    qs = [{"q_num": _to_int(q.get("qnum")), "prompt": q.get("location", q.get("prompt", ""))}
          for q in blk.get("questions", []) if _to_int(q.get("qnum")) is not None]
    letters = sorted({a["answer"] for a in answers if a.get("answer")})
    meta = {"letter_options": letters or ["A", "B", "C", "D", "E", "F", "G", "H"]}
    return _wrap(q_type, tk, blk, qs, metadata=meta)


def _wrap(q_type: str, tk: str, blk: dict, questions: list[dict],
          template: dict | None = None, metadata: dict | None = None) -> dict:
    qnums = [q["q_num"] for q in questions if q.get("q_num") is not None]
    q_range = (min(qnums), max(qnums)) if qnums else (0, 0)
    block: dict[str, Any] = {
        "q_type":        q_type,
        "template_kind": tk,
        "instruction":   blk.get("rubric", ""),
        "questions":     questions,
        "q_range":       q_range,
    }
    if template:
        block["template"] = template
    if metadata:
        block["metadata"] = metadata
    return block


_RENDER_BUILDERS = {
    "flowchart":    _block_flowchart,
    "form":         _block_form,
    "note":         _block_note,
    "sentence":     _block_sentence,
    "summary":      _block_summary,
    "table":        _block_table,
    "mcq":          _block_mcq,
    "short_answer": _block_short,
    "matching":     _block_matching,
    "mcq_multi":    _block_mcq_multi,
}


# ── transcript (display pane) ──────────────────────────────────────────────

def _build_transcript(section: dict) -> tuple[str, dict[int, int]]:
    """Join the section's audio_script into a display transcript
    (``**Name:** text`` paragraphs, TTS markers stripped) and compute a
    per-question paragraph anchor from the ``(Qn)`` markers."""
    tag_to_name: dict[str, str] = {}
    for sp in section.get("speakers", []):
        vp = sp.get("voice_profile")
        if vp and sp.get("name"):
            tag_to_name[vp] = sp["name"]
    paras: list[str] = []
    anchors: dict[int, int] = {}
    for turn in section.get("audio_script", []):
        raw = turn.get("text", "")
        for qn in re.findall(r"\(Q(\d+)\)", raw, re.IGNORECASE):
            anchors.setdefault(int(qn), len(paras))
        name = tag_to_name.get(turn.get("speaker_tag", ""), "")
        clean = _clean_transcript_text(raw)
        paras.append(f"**{name}:** {clean}" if name else clean)
    return "\n\n".join(paras), anchors


# ── main entry ─────────────────────────────────────────────────────────────

def parse_drill(source_json: dict[str, Any], timings: dict[str, Any] | None = None) -> DrillParseResult:
    """Parse one drill Source_JSON (+ optional timings.json) into persistable
    rows. Pure/deterministic. Collects errors (block/import invalid) and
    warnings (missing audio → publishable metadata but not student-ready)."""
    res = DrillParseResult()
    sj = source_json or {}
    test_ext = (sj.get("test_id") or sj.get("drill_id") or "").strip()
    if not test_ext:
        res.errors.append("Thiếu test_id / drill_id trong Source JSON.")
    sections = sj.get("sections") or []
    if len(sections) != 1:
        res.warnings.append(f"Drill có {len(sections)} section (kỳ vọng 1).")
    if not sections:
        res.errors.append("Drill không có section nào.")
        return res

    section = sections[0]
    section_num = int(section.get("section_number") or 1)
    res.section_num = section_num

    # Determine the drill's single skill from its (single) render.
    blocks_json = section.get("question_blocks") or []
    renders = {b.get("render") for b in blocks_json}
    if not blocks_json:
        res.errors.append("Section không có question_block nào.")
        return res
    skill_render = blocks_json[0].get("render")
    skill = _RENDER_TO_SKILL.get(skill_render or "", skill_render or "unknown")

    # Build internal blocks + the flat answer list, then reuse build_exercises.
    internal_blocks: list[dict[str, Any]] = []
    flat_answers: list[dict[str, Any]] = []
    map_svg_by_range: dict[tuple[int, int], str] = {}

    for blk in blocks_json:
        render = blk.get("render")
        marker = _RENDER_TO_MARKER.get(render or "")
        if not marker or marker not in lc._MARKER_TO_TYPE:
            res.errors.append(f"Không hỗ trợ render '{render}' (block {blk.get('block_id')}).")
            continue
        q_type, tk = lc._MARKER_TO_TYPE[marker]

        # answers: mcq_multi keeps its per-qnum answers[] like the others.
        block_answers = [_answer_entry(a) for a in blk.get("answers", [])]
        block_answers = [a for a in block_answers if a]
        flat_answers.extend(block_answers)

        if render == "map":
            ib = _block_map(blk, q_type, tk, block_answers)
        else:
            builder = _RENDER_BUILDERS.get(render)
            if builder is None:
                res.errors.append(f"Thiếu builder cho render '{render}'.")
                continue
            ib = builder(blk, q_type, tk)
        internal_blocks.append(ib)
        if render == "map" and blk.get("map_svg"):
            map_svg_by_range[ib["q_range"]] = blk["map_svg"]

    exercises = lc.build_exercises(internal_blocks, flat_answers, section_num)

    # Enrich payloads: audio_windows + solutions + transcript_anchors + map_svg.
    transcript, anchors = _build_transcript(section)
    q_windows = _question_windows(timings)
    solutions_by_q = {a["q_num"]: {"answer": a["answer"], "why_correct": a["notes"],
                                   "trap": ", ".join(a["trap_mechanisms"])}
                      for a in flat_answers}
    for ex in exercises:
        lo, hi = ex["q_range"]
        rng = range(lo, hi + 1)
        ex["payload"]["audio_windows"] = {str(q): q_windows[q] for q in rng if q in q_windows}
        ex["payload"]["solutions"] = {str(q): solutions_by_q[q] for q in rng if q in solutions_by_q}
        ex["payload"]["transcript_anchors"] = {str(q): anchors[q] for q in rng if q in anchors}
        svg = map_svg_by_range.get((lo, hi))
        if svg:
            ex["payload"]["map_svg"] = svg

    res.exercise_rows = exercises
    res.question_count = sum(len(ex["payload"].get("answers", [])) for ex in exercises)

    # Audio presence (from timings/manifest passed by the router).
    res.has_audio = bool(timings and (timings.get("full_test") or timings.get("sections")))
    if timings:
        res.audio_duration_seconds = _timings_duration(timings)
    if not res.has_audio:
        res.warnings.append("Chưa có audio cho drill này — import metadata nhưng chưa mở cho học sinh (Sắp có).")

    accent = lc.infer_accent_tag([{"accent": a} for a in (sj.get("accent_profile") or [])])
    cefr = lc.infer_cefr_level(sj.get("target_band"))
    sec_id = f"S{section_num}"

    res.cue_points = [{"type": "section", "section_num": section_num, "timestamp_seconds": 0}]
    res.test_metadata = {
        "test_id":        test_ext,
        "title":          sj.get("title") or test_ext,
        "band_target":    sj.get("target_band"),
        "accent_profile": list(sj.get("accent_profile") or []),
        "themes":         dict(sj.get("topic_tags") or {}),
        # Mig 157 — test_type là cột thật (CHECK full|mini|drill).
        "test_type":      "drill",
        "metadata": {
            "source_format":   "listening-drill-v1",
            "section_offsets": {sec_id: 0},
            "drill_type":      skill,
            "level":           sj.get("level") or "",
            "task":            _task_from_id(test_ext),
            "cluster":         sj.get("cluster") or "",
        },
    }
    # Per-turn dictation segments (audio-clip windows) from timings turns.
    # A drill's audio IS the section file (starts at 0) → offset 0. Empty
    # when timings has no turns or they don't align → free scrub.
    content_metadata = {
        "source_format": "listening-drill-v1",
        "drill_type":    skill,
        "level":         sj.get("level") or "",
    }
    dictation_segments = build_turn_segments(
        transcript, _section_turns(timings, section_num), offset=0.0)
    if dictation_segments:
        content_metadata["dictation_segments"] = dictation_segments

    res.content_row = {
        "source_type":            "test_section",
        "section_num":            section_num,
        "audio_storage_path":     None,   # full_premixed: audio on the test row
        "audio_duration_seconds": 0,
        "audio_size_bytes":       0,
        "title":         f"{test_ext} — {sj.get('title') or 'Skill drill'}",
        "transcript":    transcript,
        "accent_tag":    accent,
        "cefr_level":    cefr,
        "ielts_section": section_num,
        "topic_tags":    [test_ext, skill, sj.get("level") or ""],
        "status":        "draft",
        "is_premium":    False,
        "metadata":      content_metadata,
    }
    return res


# ── timings helpers ────────────────────────────────────────────────────────

def _section_turns(timings: dict[str, Any] | None, section_num: int) -> list[dict]:
    """timings.json → the matching section's ``turns[]`` as [{start, end}]
    (section-relative). Matched by section id number (S2 → 2)."""
    if not timings:
        return []
    for sec in (timings.get("sections") or []):
        digits = "".join(c for c in str(sec.get("id") or "") if c.isdigit())
        if digits and int(digits) == section_num:
            return [{"start": t["start"], "end": t["end"]}
                    for t in (sec.get("turns") or [])
                    if t.get("start") is not None and t.get("end") is not None]
    return []


def _question_windows(timings: dict[str, Any] | None) -> dict[int, dict[str, Any]]:
    """Flatten timings.json question windows → {q_num: {start, end, section}}.
    A drill is single-section, so windows are section-relative == absolute
    (section offset 0), matching the mini-test rebase."""
    out: dict[int, dict[str, Any]] = {}
    if not timings:
        return out
    for sec in timings.get("sections", []):
        sid = sec.get("id")
        for q, w in (sec.get("questions") or {}).items():
            qn = _to_int(q)
            if qn is None or not isinstance(w, dict):
                continue
            if w.get("start") is None or w.get("end") is None:
                continue
            out[qn] = {"start": round(float(w["start"]), 2),
                       "end": round(float(w["end"]), 2), "section": sid}
    return out


def _timings_duration(timings: dict[str, Any]) -> float | None:
    ft = timings.get("full_test") or {}
    if ft.get("duration"):
        return round(float(ft["duration"]), 2)
    secs = timings.get("sections") or []
    if secs and secs[0].get("duration"):
        return round(float(secs[0]["duration"]), 2)
    return None


def _task_from_id(test_id: str) -> str:
    m = re.search(r"-T(\d+)\b", test_id or "", re.IGNORECASE)
    return f"T{m.group(1)}" if m else ""
