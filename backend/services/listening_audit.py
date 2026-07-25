"""Listening content audit engine.

Runs QA checks against ALREADY-PERSISTED listening rows (tests + content +
exercises) — no re-import needed — so admins can verify, fix in place, and
re-check. Three layers:

  • structural_checks  — ports listening_fulltest_import._validate to DB rows:
    question contiguity, every q has an answer + a valid audio_window, transcript
    present, template_kind known, type-specific payload present.
  • audio_bounds_checks — audio present + window ⊆ audio duration.
  • llm_content_audit   — (separate, LLM-backed) answer-in-transcript / solution
    consistency / prompt clarity. Lives here as `build_llm_audit_prompt` +
    `parse_llm_audit`; the network call is injected by the router.

The hydrate/check functions are PURE (take fetched rows, return issues) so they
unit-test without a DB. The router fetches rows via supabase_admin and calls them.

Issue shape: {q_num: int|None, dimension: str, severity: 'error'|'warning',
code: str, message: str, resolved: bool}. dimension ∈ DIMENSIONS.
"""

from __future__ import annotations

from typing import Any

from . import listening_convert as lc

DIMENSIONS = ("structure", "question", "script", "solution", "timeline", "audio")

# Known template_kinds a persisted exercise may carry (from the importer map),
# plus the standalone skill types that also live in listening_exercises.
_KNOWN_TEMPLATE_KINDS = set(tk for _, tk in lc._MARKER_TO_TYPE.values()) | {
    "dictation", "gist", "true_false", "mcq",  # standalone skill exercises
}

# A small tolerance (s) when checking a window sits inside the audio duration —
# encoders round durations, so allow a hair past the end.
_DURATION_SLACK_S = 1.5


def _issue(dimension: str, severity: str, code: str, message: str,
           q_num: int | None = None) -> dict[str, Any]:
    return {"q_num": q_num, "dimension": dimension, "severity": severity,
            "code": code, "message": message, "resolved": False}


def _to_int(q: Any) -> int | None:
    try:
        return int(str(q).strip())
    except (TypeError, ValueError):
        return None


# ── hydrate ────────────────────────────────────────────────────────────────

def hydrate_test(test: dict, contents: list[dict], exercises: list[dict]) -> dict:
    """Assemble a normalized audit view from raw DB rows. PURE.

    contents: listening_content rows for the test (any section count).
    exercises: listening_exercises rows (payload carries answers/windows/etc).
    """
    by_content: dict[str, list[dict]] = {}
    for ex in exercises:
        by_content.setdefault(ex.get("content_id"), []).append(ex)

    md = test.get("metadata") or {}
    sections: list[dict] = []
    all_questions: list[dict] = []

    for c in sorted(contents, key=lambda r: (r.get("section_num") or 0)):
        sec_num = c.get("section_num")
        # Per-section audio duration: a mini/drill stores audio on the TEST row
        # (full_premixed); a parts test stores it on the content row.
        audio_dur = (c.get("audio_duration_seconds")
                     or test.get("full_audio_duration_seconds")
                     or test.get("assembled_audio_duration_seconds"))
        q_rows: list[dict] = []
        for ex in sorted(by_content.get(c["id"], []), key=lambda e: (e.get("order_num") or 0)):
            p = ex.get("payload") or {}
            tk = p.get("template_kind")
            answers = {(_to_int(a.get("q_num"))): a for a in (p.get("answers") or [])}
            windows = {(_to_int(k)): v for k, v in (p.get("audio_windows") or {}).items()}
            sols = {(_to_int(k)): v for k, v in (p.get("solutions") or {}).items()}
            for q in (p.get("questions") or []):
                qn = _to_int(q.get("q_num"))
                ans = answers.get(qn) or {}
                entry = {
                    "q_num":         qn,
                    "section_num":   sec_num,
                    "exercise_id":   ex.get("id"),
                    "template_kind": tk,
                    "variant":       p.get("variant"),
                    "prompt":        q.get("prompt") or "",
                    "options":       q.get("options"),
                    "answer":        ans.get("answer"),
                    "alternatives":  ans.get("alternatives") or [],
                    "solution":      sols.get(qn) or {},
                    "notes":         (ans.get("notes") or (sols.get(qn) or {}).get("why_correct") or ""),
                    "audio_window":  windows.get(qn),
                    "metadata":      p.get("metadata") or {},
                    "map_svg":       p.get("map_svg"),
                    "map_image":     p.get("map_image_storage_path"),
                    "audio_duration": audio_dur,
                }
                q_rows.append(entry)
                all_questions.append(entry)
        sections.append({
            "section_num":    sec_num,
            "content_id":     c["id"],
            "transcript":     (c.get("transcript") or ""),
            "audio_duration": audio_dur,
            "questions":      q_rows,
        })

    return {
        "uuid":        test.get("id"),
        "test_id":     test.get("test_id"),
        "status":      test.get("status"),
        "test_type":   test.get("test_type") or md.get("test_type"),
        "metadata":    md,
        "full_audio_storage_path":      test.get("full_audio_storage_path"),
        "assembled_audio_storage_path": test.get("assembled_audio_storage_path"),
        "full_audio_duration_seconds":  test.get("full_audio_duration_seconds"),
        "sections":    sections,
        "all_questions": all_questions,
    }


# ── structural checks (port of _validate for DB rows) ──────────────────────

def structural_checks(h: dict) -> list[dict]:
    issues: list[dict] = []
    qs = h["all_questions"]
    qnums = sorted(q["q_num"] for q in qs if q["q_num"] is not None)

    if not qnums:
        issues.append(_issue("structure", "error", "no_questions",
                             "Test không có câu hỏi nào."))
        return issues

    # contiguity 1..max
    last = qnums[-1]
    missing = [n for n in range(1, last + 1) if n not in set(qnums)]
    if missing:
        issues.append(_issue("structure", "error", "gap",
                             f"Thiếu câu (không liên tục): {missing} (kỳ vọng 1–{last})."))
    dupes = [n for n in set(qnums) if qnums.count(n) > 1]
    if dupes:
        issues.append(_issue("structure", "error", "duplicate_qnum",
                             f"Câu bị trùng số: {sorted(dupes)}."))

    for q in qs:
        n = q["q_num"]
        if n is None:
            issues.append(_issue("structure", "error", "bad_qnum",
                                 "Có câu không đọc được q_num."))
            continue
        # template_kind known
        tk = q["template_kind"]
        if tk not in _KNOWN_TEMPLATE_KINDS:
            issues.append(_issue("question", "error", "unknown_template",
                                 f"template_kind lạ: {tk!r}.", q_num=n))
        # answer present (letter/word). mcq_multi answer is a letter per slot.
        if q["answer"] in (None, "", []):
            issues.append(_issue("question", "error", "no_answer",
                                 "Thiếu đáp án.", q_num=n))
        # type-specific payload present
        meta = q.get("metadata") or {}
        # An mcq_3option EXERCISE can hold a het-block short-answer item (no
        # options, a WORD answer) — that's valid and renders as a text gap. Only
        # flag a truly-MCQ item (letter answer A–H) that's missing its options.
        ans = q.get("answer")
        is_letter_ans = (isinstance(ans, str) and len(ans.strip()) == 1
                         and ans.strip().upper() in "ABCDEFGH")
        if tk == "mcq_3option" and not q.get("options") and is_letter_ans:
            issues.append(_issue("question", "error", "no_options",
                                 "MCQ (đáp án là chữ cái) thiếu options A/B/C.", q_num=n))
        if tk in ("matching", "mcq_multi") and not meta.get("match_options"):
            issues.append(_issue("question", "error", "no_match_options",
                                 f"{tk} thiếu metadata.match_options.", q_num=n))
        if tk == "plan_label" and not (q.get("map_svg") or q.get("map_image")):
            issues.append(_issue("question", "error", "no_map_image",
                                 "Câu bản đồ chưa có map_svg / map image.", q_num=n))
        # audio window present + valid
        win = q.get("audio_window")
        if not win:
            issues.append(_issue("timeline", "error", "no_window",
                                 "Thiếu audio_window (không nghe lại được theo câu).", q_num=n))
        elif win.get("start") is None or win.get("end") is None or win["end"] <= win["start"]:
            issues.append(_issue("timeline", "error", "bad_window",
                                 f"audio_window không hợp lệ: {win.get('start')}–{win.get('end')}.", q_num=n))

    # transcript per section
    for s in h["sections"]:
        if not (s["transcript"] or "").strip():
            issues.append(_issue("script", "error", "no_transcript",
                                 f"Section {s['section_num']} thiếu transcript."))

    # band_conversion sanity (optional metadata)
    bc = (h["metadata"] or {}).get("band_conversion")
    if bc:
        bands = [row.get("band") for row in bc if isinstance(row, dict)]
        if any(b is None for b in bands):
            issues.append(_issue("structure", "warning", "band_conversion",
                                 "band_conversion có dòng thiếu 'band'."))
    return issues


# ── audio-bounds checks ────────────────────────────────────────────────────

def audio_bounds_checks(h: dict) -> list[dict]:
    issues: list[dict] = []
    has_audio = bool(h.get("full_audio_storage_path") or h.get("assembled_audio_storage_path")
                     or any(s.get("audio_duration") for s in h["sections"]))
    if not has_audio:
        issues.append(_issue("audio", "error", "no_audio",
                             "Test chưa có audio (full/assembled/section)."))
        return issues

    for q in h["all_questions"]:
        win = q.get("audio_window")
        dur = q.get("audio_duration")
        if not win or dur is None:
            continue
        end = win.get("end")
        if end is not None and end > dur + _DURATION_SLACK_S:
            issues.append(_issue("audio", "error", "window_past_end",
                                 f"audio_window end={end:.1f}s vượt thời lượng audio {dur:.1f}s "
                                 f"(có thể audio bị thay/cắt sau khi set window).", q_num=q["q_num"]))
    return issues


# ── roll-up ────────────────────────────────────────────────────────────────

def summarize(issues: list[dict]) -> dict:
    errs = sum(1 for i in issues if i["severity"] == "error" and not i.get("resolved"))
    warns = sum(1 for i in issues if i["severity"] == "warning" and not i.get("resolved"))
    return {
        "error_count": errs,
        "warning_count": warns,
        "status": "has_issues" if errs else "passed",
    }


def run_structural(h: dict) -> dict:
    """Fast, no-LLM pass. Returns {issues, health}."""
    issues = structural_checks(h) + audio_bounds_checks(h)
    return {"issues": issues, "health": summarize(issues)}


# ── LLM content audit (network call injected by the router) ────────────────

_AUDIT_SYSTEM = (
    "You are auditing IELTS Listening content. For each question decide if there "
    "is a CONTENT problem. Check ONLY:\n"
    "1) answer_in_script: is the keyed answer actually supported by the transcript "
    "(verbatim or clear paraphrase)? If not → error.\n"
    "2) solution_consistency: does the explanation/notes contradict the keyed "
    "answer? If so → error.\n"
    "3) prompt_clarity: is the question prompt EMPTY or genuinely nonsensical? → warning.\n"
    "IMPORTANT: completion-family questions (form/note/table/sentence/summary/"
    "flow_chart/short_answer) render the blank as a SEPARATE input widget, so a "
    "prompt with no visible '___'/underscore is NORMAL — do NOT flag prompt_clarity "
    "for a missing blank indicator. Only flag truly empty or garbled prompts.\n"
    "Return ONLY a JSON array; each item "
    '{"q_num":N,"code":"answer_in_script|solution_consistency|prompt_clarity",'
    '"severity":"error|warning","message":"short vi"}. '
    "Empty array [] if all fine. No prose."
)


def build_llm_audit_user(h: dict) -> str:
    """The per-test content block (transcript + every question's
    answer/solution/prompt) the LLM audits against `_AUDIT_SYSTEM`."""
    lines: list[str] = []
    for s in h["sections"]:
        lines.append(f"\n=== SECTION {s['section_num']} TRANSCRIPT ===\n{s['transcript'][:6000]}")
        for q in s["questions"]:
            lines.append(
                f"\nQ{q['q_num']} [{q['template_kind']}] prompt={q['prompt']!r} "
                f"answer={q['answer']!r} alt={q['alternatives']} "
                f"notes={(q['notes'] or '')[:400]!r}")
    return "\n".join(lines)


async def llm_content_audit(h: dict, invoke) -> list[dict]:
    """Run the LLM content pass. `invoke` is an async callable
    (system_prompt, user_message) -> str (e.g. a grading provider's `.invoke`).
    Any provider error → a single 'audit_inconclusive' warning (never raises)."""
    user = build_llm_audit_user(h)
    try:
        raw = await invoke(_AUDIT_SYSTEM, user)
    except Exception as exc:  # provider/network/content-policy — degrade, don't crash
        return [_issue("solution", "warning", "audit_inconclusive",
                       f"LLM audit lỗi ({type(exc).__name__}) — cần xem tay.")]
    return parse_llm_audit(raw)


def parse_llm_audit(raw: str) -> list[dict]:
    """Parse the LLM's JSON array into issue dicts. Tolerant: on any parse
    failure returns a single 'inconclusive' warning rather than raising."""
    import json
    import re
    m = re.search(r"\[.*\]", raw or "", re.DOTALL)
    if not m:
        # No JSON array at all — the model didn't follow format (a genuine
        # "all fine" answer is the literal "[]", which DOES match above).
        return [_issue("solution", "warning", "audit_inconclusive",
                       "LLM audit không trả JSON — cần xem tay.")]
    try:
        arr = json.loads(m.group(0))
    except Exception:
        return [_issue("solution", "warning", "audit_inconclusive",
                       "LLM audit không parse được kết quả — cần xem tay.")]
    out: list[dict] = []
    _dim = {"answer_in_script": "solution", "solution_consistency": "solution",
            "prompt_clarity": "question"}
    for it in arr if isinstance(arr, list) else []:
        if not isinstance(it, dict):
            continue
        code = str(it.get("code") or "llm_flag")
        sev = it.get("severity") if it.get("severity") in ("error", "warning") else "warning"
        out.append(_issue(_dim.get(code, "solution"), sev, code,
                          str(it.get("message") or "LLM flagged"),
                          q_num=_to_int(it.get("q_num"))))
    return out
