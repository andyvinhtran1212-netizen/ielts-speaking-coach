"""services/writing_render.py — HTML render for Writing Coach feedback.

Renders WritingFeedback + essay context into a self-contained HTML
document. Sprint 2.5.4 refactor: structure + colour palette now
matches Andy's export spec, shared with writing_word_exporter.py via
the helpers below.

Contract:
  • render_feedback_html(...) → HTML string (clipboard / Copy formatted)
  • render_plain_text(...)    → strips HTML for fallback
  • Helpers extract typed/dict shapes into a flat dict context that the
    Word exporter consumes too — single source of truth for shape
    normalisation.

Inline styles only in the template — Google Docs strips <style> blocks
on paste. Autoescape is enabled; the only |safe usage is on
highlighted_essay_html which escapes its own input before wrapping.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any, Iterable, Optional

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup

from models.writing_feedback import WritingFeedback


_TEMPLATE_DIR = Path(__file__).parent.parent / "templates"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(["html", "j2", "html.j2"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


_TASK_LABELS: dict[str, str] = {
    "task1_academic": "Task 1 Academic Analysis",
    "task1_general":  "Task 1 General Analysis",
    "task2":          "Task 2 Analysis",
}


# ── Shared colour palette (Sprint 2.5.4 spec) ────────────────────────
# Hex values pinned by the spec — same across HTML and Word exports.
COLOR_SUBHEADING = "#334155"
COLOR_BODY       = "#475569"
COLOR_MUTED      = "#94A3B8"
COLOR_GREEN      = "#16A34A"   # strengths
COLOR_GREEN_BG   = "#F0FDF4"
COLOR_YELLOW     = "#CA8A04"   # improvements
COLOR_YELLOW_BG  = "#FEFCE8"
COLOR_RED        = "#DC2626"   # errors
COLOR_RED_BG     = "#FEE2E2"   # essay highlight
COLOR_BLUE       = "#2563EB"   # scores
COLOR_GRAY_BG    = "#F1F5F9"
COLOR_BORDER     = "#E2E8F0"


# ── Public API ───────────────────────────────────────────────────────

def render_feedback_html(
    *,
    feedback: WritingFeedback,
    essay_text: str,
    prompt_text: str,
    task_type: str,
    student_name: str = "",
) -> str:
    """Render feedback as a self-contained HTML document.

    Pulls structured fields off the Pydantic model — by the time
    feedback reaches this function it has been validated, so admin-
    edited shape variations live in the admin-grade UI, not here.
    """
    ctx = {
        "task_label":        _TASK_LABELS.get(task_type, "Writing Analysis"),
        "student_name":      student_name,
        "prompt_text":       prompt_text,
        "overall_band":      _format_band(feedback.overallBandScore),
        "overall_summary":   feedback.overallBandScoreSummary or "",
        "takeaways":         _build_takeaways_ctx(_takeaways_dict(feedback)),
        "criteria_grid_rows": _build_criteria_grid_rows(_criteria_list(feedback)),
        "highlighted_essay_html": _build_highlighted_essay_html(
            essay_text, [_mistake_dict(m) for m in (feedback.mistakeAnalysis or [])]
        ),
        "mistakes":          _normalize_mistakes(
            [_mistake_dict(m) for m in (feedback.mistakeAnalysis or [])]
        ),
        "lexical_summary":   _extract_lexical_summary(feedback.lexicalAnalysis),
        "lexical_upgrades":  _extract_lexical_upgrades(feedback.lexicalAnalysis),
        "sentence_structures": _extract_sentence_structures(
            feedback.sentenceStructureAnalysis
        ),
        "idea_development_paragraphs": _extract_idea_paragraphs(
            feedback.ideaDevelopmentAnalysis
        ),
        "counterargument":   _extract_counterargument(
            feedback.counterargumentAnalysis, task_type
        ),
        "improved_essay_lines": _split_essay_paragraphs(
            _extract_improved_essay_text(feedback.improvedEssay)
        ),
        "ai_content":        _extract_ai_content(feedback.aiContentAnalysis),
        # Palette tokens for the template (no global <style> block).
        "C_SUBHEAD":  COLOR_SUBHEADING, "C_BODY":   COLOR_BODY,
        "C_MUTED":    COLOR_MUTED,
        "C_GREEN":    COLOR_GREEN,      "C_GREEN_BG":  COLOR_GREEN_BG,
        "C_YELLOW":   COLOR_YELLOW,     "C_YELLOW_BG": COLOR_YELLOW_BG,
        "C_RED":      COLOR_RED,        "C_RED_BG":    COLOR_RED_BG,
        "C_BLUE":     COLOR_BLUE,
        "C_GRAY_BG":  COLOR_GRAY_BG,    "C_BORDER":    COLOR_BORDER,
    }
    ctx["has_advanced"] = bool(
        ctx["lexical_upgrades"] or ctx["lexical_summary"] or
        ctx["sentence_structures"] or ctx["idea_development_paragraphs"] or
        ctx["counterargument"]
    )

    template = _env.get_template("writing/output.html.j2")
    return template.render(**ctx)


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE  = re.compile(r"[ \t\r]+")


def render_plain_text(html_text: str) -> str:
    """Strip HTML to a clipboard-friendly plain-text fallback."""
    text = re.sub(r"</(?:p|tr|h1|h2|h3|h4|li|ul|table|div)>", "\n", html_text, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = _TAG_RE.sub("", text)
    text = html.unescape(text)
    text = _WS_RE.sub(" ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ── Highlighter — kept for backwards-compat with existing tests ──────

def _highlight_mistakes(essay_text: str, feedback: WritingFeedback) -> Markup:
    """Wrap each mistake's `original` in a red-background span.

    Sprint 2.5.4 swaps yellow `<mark>` for an inline-styled span so the
    paste into Google Docs survives without external CSS. Same single-
    pass non-overlapping invariant as before — longer mistakes still
    win at any given position.
    """
    if not essay_text:
        return Markup("")

    intervals = find_highlight_intervals(
        essay_text,
        [_mistake_dict(m) for m in (feedback.mistakeAnalysis or [])],
    )
    return Markup(_apply_highlights_html(essay_text, intervals))


def _iter_mistake_originals(feedback: WritingFeedback) -> Iterable[str]:
    for m in feedback.mistakeAnalysis or []:
        if m.original:
            yield m.original


# ── Shape normalisation helpers (shared with Word exporter) ──────────

def _format_band(score: Optional[float]) -> str:
    if score is None:
        return "—"
    try:
        return f"{float(score):.1f}"
    except (TypeError, ValueError):
        return str(score)


def _mistake_dict(m: Any) -> dict:
    """Coerce a Pydantic MistakeAnalysis OR raw dict to a flat dict.

    Maps Pydantic `mistakeType` → spec `type` (and accepts either).
    """
    if isinstance(m, dict):
        return {
            "original":    m.get("original", "") or "",
            "type":        m.get("type") or m.get("mistakeType") or m.get("category") or "—",
            "explanation": m.get("explanation", "") or "",
            "suggestion":  m.get("suggestion", "") or "",
        }
    return {
        "original":    getattr(m, "original", "") or "",
        "type":        getattr(m, "mistakeType", "") or getattr(m, "type", "") or "—",
        "explanation": getattr(m, "explanation", "") or "",
        "suggestion":  getattr(m, "suggestion", "") or "",
    }


def _takeaways_dict(feedback: WritingFeedback) -> dict:
    kt = feedback.keyTakeaways
    if not kt:
        return {}
    return {
        "strengths":            list(getattr(kt, "strengths", []) or []),
        "areasForImprovement":  list(getattr(kt, "areasForImprovement", []) or []),
    }


def _criteria_list(feedback: WritingFeedback) -> list[dict]:
    """Flatten CriteriaFeedbackBundle into the spec's list shape.

    Maps Pydantic `{title, bandScore, explanation, feedback}` →
    `{criterion, band, summary, detailedFeedback}` so the template +
    Word path can iterate uniformly. Order pinned to TR / CC / LR / GR.
    """
    cf = feedback.criteriaFeedback
    if not cf:
        return []
    out: list[dict] = []
    for attr in ("mainCriterion", "coherenceCohesion", "lexicalResource", "grammaticalRange"):
        c = getattr(cf, attr, None)
        if not c:
            continue
        out.append({
            "criterion":        c.title,
            "band":             c.bandScore,
            "summary":          c.explanation or "",
            "detailedFeedback": c.feedback or "",
        })
    return out


def _build_takeaways_ctx(kt: dict) -> dict:
    """Normalise keyTakeaways to {strengths, areas_for_improvement}."""
    if not kt:
        return {"strengths": [], "areas_for_improvement": []}
    s = kt.get("strengths") or []
    if isinstance(s, str):
        s = [s]
    a = kt.get("areasForImprovement") or kt.get("areas_for_improvement") or []
    if isinstance(a, str):
        a = [a]
    return {"strengths": list(s), "areas_for_improvement": list(a)}


def _build_criteria_grid_rows(criteria: list[dict]) -> list[list[dict]]:
    """Reshape a flat criteria list into rows of 2 for the 2×2 grid.

    Each criterion's `detailedFeedback` is parsed for **Strengths:** /
    **Improvements:** Markdown patterns; when neither matches, the
    plain text is preserved in `detailed_text` for fallback rendering.
    """
    enriched: list[dict] = []
    for c in criteria:
        df = c.get("detailedFeedback") or c.get("detailed_feedback") or ""
        strengths, improvements, plain = _parse_markdown_strengths_improvements(df)
        enriched.append({
            "criterion":     c.get("criterion") or "—",
            "band":          c.get("band", "—"),
            "summary":       c.get("summary", ""),
            "strengths":     strengths,
            "improvements":  improvements,
            "detailed_text": plain,
        })
    rows: list[list[dict]] = []
    for i in range(0, len(enriched), 2):
        rows.append(enriched[i:i + 2])
    return rows


def find_highlight_intervals(essay_text: str, mistakes: list[dict]) -> list[tuple[int, int]]:
    """Return non-overlapping (start, end) intervals for every
    mistake.original substring (≥3 chars) in the essay.

    Shared by HTML + Word renderers. Sorting + merging keeps a single
    pass through the essay deterministic regardless of mistake order.
    """
    if not essay_text:
        return []
    intervals: list[tuple[int, int]] = []
    for m in mistakes or []:
        orig = (m.get("original") or "").strip()
        if not orig or len(orig) < 3:
            continue
        idx = 0
        while True:
            found = essay_text.find(orig, idx)
            if found == -1:
                break
            intervals.append((found, found + len(orig)))
            idx = found + len(orig)
    if not intervals:
        return []
    intervals.sort()
    merged = [intervals[0]]
    for start, end in intervals[1:]:
        if start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _apply_highlights_html(essay_text: str, intervals: list[tuple[int, int]]) -> str:
    """Wrap matched intervals in a red-bg <span>; escape everything."""
    if not intervals:
        return _wrap_paragraphs(essay_text)
    parts: list[str] = []
    last = 0
    for start, end in intervals:
        if start > last:
            parts.append(html.escape(essay_text[last:start]))
        parts.append(
            f'<span style="background:{COLOR_RED_BG};">'
            f'{html.escape(essay_text[start:end])}</span>'
        )
        last = end
    if last < len(essay_text):
        parts.append(html.escape(essay_text[last:]))
    inlined = "".join(parts)
    # Wrap each blank-line paragraph in <p>; preserve highlighted spans.
    paragraphs = inlined.split("\n\n")
    return "".join(f"<p style=\"margin:0 0 8pt;\">{para}</p>" for para in paragraphs if para.strip())


def _wrap_paragraphs(essay_text: str) -> str:
    if not essay_text:
        return ""
    return "".join(
        f"<p style=\"margin:0 0 8pt;\">{html.escape(p)}</p>"
        for p in essay_text.split("\n\n") if p.strip()
    )


def _build_highlighted_essay_html(essay_text: str, mistakes: list[dict]) -> Markup:
    intervals = find_highlight_intervals(essay_text, mistakes)
    return Markup(_apply_highlights_html(essay_text, intervals))


def _normalize_mistakes(mistakes: list[dict]) -> list[dict]:
    return [_mistake_dict(m) for m in (mistakes or [])]


# ── Lexical (handles 4 input shapes) ─────────────────────────────────

def _extract_lexical_summary(lex: Any) -> str:
    if isinstance(lex, dict):
        return str(lex.get("summary") or "")
    return ""


def _extract_lexical_upgrades(lex: Any) -> list[dict]:
    """Normalise lexicalAnalysis to a list of {original, upgrade}.

    Tolerates:
      • Pydantic LexicalAnalysis (.wordsToUpgrade with .original/.suggestions)
      • dict {wordsToUpgrade: [...]} or {examples: [...]}
      • flat dict {original_word: "upgrade"} (admin-edited shape)
      • bare list of upgrade objects or strings
    """
    if not lex:
        return []

    # Pydantic typed object
    words_attr = getattr(lex, "wordsToUpgrade", None)
    if words_attr:
        return [
            {
                "original": getattr(w, "original", "") or "",
                "upgrade":  ", ".join(getattr(w, "suggestions", []) or []) or
                            (getattr(w, "suggestion", "") or ""),
                "context":  getattr(w, "context", "") or "",
                "category": getattr(w, "category", "") or "",
            }
            for w in words_attr
        ]

    if isinstance(lex, dict):
        if isinstance(lex.get("wordsToUpgrade"), list):
            return _extract_lexical_upgrades(lex["wordsToUpgrade"])
        if isinstance(lex.get("examples"), list):
            return [
                {"original": e.get("original", "") or "",
                 "upgrade":  e.get("upgrade") or e.get("suggestion") or ""}
                for e in lex["examples"] if isinstance(e, dict)
            ]
        if isinstance(lex.get("suggestions"), list):
            return _extract_lexical_upgrades(lex["suggestions"])
        # Flat {word: upgrade} map — skip known wrapper keys.
        WRAPPER = {"summary", "examples", "wordsToUpgrade", "suggestions",
                   "upgrades", "strengths"}
        flat = [(k, v) for k, v in lex.items()
                if k not in WRAPPER and not isinstance(v, (list, dict))]
        if flat:
            return [{"original": str(k), "upgrade": str(v)} for k, v in flat]
        return []

    if isinstance(lex, list):
        out: list[dict] = []
        for item in lex:
            if isinstance(item, str):
                out.append({"original": item, "upgrade": ""})
                continue
            if not isinstance(item, dict) and not hasattr(item, "original"):
                continue
            get = (item.get if isinstance(item, dict) else lambda k, default="": getattr(item, k, default))
            orig = get("original") or get("originalWord") or get("word") or get("from") or ""
            sugg = (
                get("upgrade") or get("suggestion") or get("suggestedUpgrade")
                or get("upgraded") or get("to") or get("improved") or ""
            )
            if not sugg:
                multi = get("suggestions")
                if isinstance(multi, list) and multi:
                    sugg = ", ".join(str(s) for s in multi)
            out.append({"original": str(orig), "upgrade": str(sugg)})
        return out

    return []


# ── Sentence structure (legacy + Phase-1.5c) ─────────────────────────

def _extract_sentence_structures(ss: Any) -> list[dict]:
    """Flatten sentenceStructureAnalysis to [{original, improved, technique}].

    The model is `Optional[dict]` accepting two shapes:
      • legacy `{sentenceUpgrades: [{original, rewritten, explanation}]}`
      • Phase-1.5c `{summary, common_issues, focus_theme, ...}` (no per-sentence rewrites)

    Phase-1.5c structured shape doesn't have rewritable sentence pairs,
    so this returns [] for it; the focus-theme rendering lives elsewhere.
    """
    if not ss or not isinstance(ss, dict):
        return []
    upgrades = ss.get("sentenceUpgrades")
    if isinstance(upgrades, list):
        return [
            {
                "original":  u.get("original", "") or "",
                "improved":  u.get("rewritten") or u.get("improved") or "",
                "technique": u.get("explanation") or u.get("technique") or "",
            }
            for u in upgrades if isinstance(u, dict)
        ]
    examples = ss.get("examples")
    if isinstance(examples, list):
        return [
            {
                "original":  e.get("original", "") or "",
                "improved":  e.get("improved") or e.get("rewritten") or "",
                "technique": e.get("technique") or e.get("explanation") or "",
            }
            for e in examples if isinstance(e, dict)
        ]
    return []


# ── Idea development ─────────────────────────────────────────────────

def _extract_idea_paragraphs(ida: Any) -> list[dict]:
    """Normalise ideaDevelopmentAnalysis to [{index, heading, original, commentary, suggestion}]."""
    if not ida:
        return []
    items: list = []
    if isinstance(ida, list):
        items = ida
    elif isinstance(ida, dict) and isinstance(ida.get("paragraphs"), list):
        items = ida["paragraphs"]
    else:
        return []

    out: list[dict] = []
    for i, item in enumerate(items, 1):
        if isinstance(item, dict):
            get = item.get
        else:
            get = lambda k, default="": getattr(item, k, default)
        idx = get("paragraph") if get("paragraph") is not None else get("index", i)
        # Suggestion may be {instruction, example} or a plain string.
        sug = get("suggestion")
        if isinstance(sug, dict):
            sug_text = sug.get("instruction", "") or ""
            if sug.get("example"):
                sug_text = f"{sug_text} — {sug['example']}".strip(" —")
        elif hasattr(sug, "instruction"):
            sug_text = (sug.instruction or "")
            if getattr(sug, "example", None):
                sug_text = f"{sug_text} — {sug.example}".strip(" —")
        else:
            sug_text = str(sug or "")
        out.append({
            "index":      idx if idx is not None else i,
            "heading":    get("issue") or get("heading") or "",
            "original":   get("originalIdea") or get("original") or "",
            "commentary": get("explanation") or get("commentary") or "",
            "suggestion": sug_text,
        })
    return out


# ── Counterargument ──────────────────────────────────────────────────

def _extract_counterargument(ca: Any, task_type: str) -> Optional[dict]:
    """Map Pydantic counterargumentAnalysis → {summary, points}.

    Skipped for Task 1. Pulls `feedback` as the summary and folds
    `suggestion` into a single-item points list since the spec asks for
    a bulleted points block. `isPresent: True` collapses the whole
    section (the student already wrote one).
    """
    if not ca:
        return None
    if task_type and task_type.startswith("task1"):
        return None
    if isinstance(ca, str):
        return {"summary": ca, "points": []}

    get = (ca.get if isinstance(ca, dict) else lambda k, default="": getattr(ca, k, default))
    is_present = bool(get("isPresent", False))
    if is_present and not get("feedback") and not get("suggestion"):
        return None

    summary = get("summary") or get("feedback") or ""
    points = get("points") or []
    if isinstance(points, str):
        points = [points]
    if not points:
        sugg = get("suggestion")
        if sugg:
            points = [str(sugg)]
    if not summary and not points:
        return None
    return {"summary": str(summary), "points": [str(p) for p in points]}


# ── Improved essay + AI content ──────────────────────────────────────

def _extract_improved_essay_text(value: Any) -> str:
    if not value:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        return (value.get("text") or value.get("essay") or "").strip()
    return ""


def _split_essay_paragraphs(text: str) -> list[str]:
    """Split essay text on blank lines (paragraph breaks).

    Falls back to single-line splitting if no blank lines are present
    so a one-block essay still renders something.
    """
    if not text:
        return []
    parts = [p.strip() for p in text.split("\n\n") if p.strip()]
    if parts:
        return parts
    return [line.strip() for line in text.split("\n") if line.strip()]


def _extract_ai_content(ai: Any) -> Optional[dict]:
    if not ai:
        return None
    get = (ai.get if isinstance(ai, dict) else lambda k, default="": getattr(ai, k, default))
    likelihood = get("likelihood", None)
    explanation = get("explanation", "") or ""
    if likelihood is None and not explanation:
        return None
    return {"likelihood": likelihood, "explanation": explanation}


# ── Markdown helper ──────────────────────────────────────────────────

_MD_STRENGTHS_RE = re.compile(
    r"\*\*Strengths?:?\*\*[:\s]*(.*?)(?=\*\*[A-Z]|$)",
    re.DOTALL | re.IGNORECASE,
)
_MD_IMPROVEMENTS_RE = re.compile(
    r"\*\*(?:Improvements?|Areas?\s+for\s+Improvement|Weaknesses?):?\*\*[:\s]*(.*?)(?=\*\*[A-Z]|$)",
    re.DOTALL | re.IGNORECASE,
)


def _parse_markdown_strengths_improvements(text: str) -> tuple[list[str], list[str], str]:
    """Extract bullets under **Strengths:** / **Improvements:** headings.

    Returns (strengths, improvements, plain). When neither pattern
    matches, `plain` carries the original text so callers can still
    render the body. When at least one matches, `plain` is empty so the
    caller doesn't double-render the source.
    """
    if not text or "**" not in text:
        return [], [], text

    s_match = _MD_STRENGTHS_RE.search(text)
    i_match = _MD_IMPROVEMENTS_RE.search(text)

    def _bullets(raw: str) -> list[str]:
        return [
            line.strip("•- ").strip()
            for line in raw.strip().split("\n")
            if line.strip("•- ").strip()
        ]

    strengths = _bullets(s_match.group(1)) if s_match else []
    improvements = _bullets(i_match.group(1)) if i_match else []
    plain = "" if (strengths or improvements) else text
    return strengths, improvements, plain
