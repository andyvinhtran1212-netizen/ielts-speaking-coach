"""services/writing_word_exporter.py — .docx export for Writing Coach (W3 Phase 2).

Builds a Word file natively (python-docx) from the same render context
as services/writing_render.py. We do NOT convert HTML → docx — instead
both renderers consume the same WritingFeedback + essay tuple and walk
the same section structure modeled on Andy's sample Word file.

Why native build (vs htmldocx / html2docx):
  • python-docx is pure Python (no system deps — Railway-friendly).
  • htmldocx is unmaintained (last release 2021, fragile parsing).
  • Going native preserves Word's native styles (Heading 1/2/3, table
    headers, list paragraphs) which Andy's existing workflow expects.

Filename contract: {student_code}_{YYYYMMDD}_T{1|2}.docx
"""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone
from typing import Iterable

from docx import Document
from docx.shared import Pt, RGBColor
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

from models.writing_feedback import WritingFeedback


_TASK_LABELS: dict[str, str] = {
    "task1_academic": "Task 1 Academic Analysis",
    "task1_general":  "Task 1 General Analysis",
    "task2":          "Task 2 Analysis",
}


# ── Color palette (W3.2 Phase 3) ─────────────────────────────────────
# Threshold matches W3.2 Phase 4 HTML render so the .docx export and the
# clipboard paste are visually consistent.

_COLOR_TEAL  = RGBColor(0x0D, 0x94, 0x88)  # band ≥ 7.0
_COLOR_AMBER = RGBColor(0xCA, 0x8A, 0x04)  # 5.5 ≤ band < 7.0
_COLOR_RED   = RGBColor(0xDC, 0x26, 0x26)  # band < 5.5


def _band_color(score: float) -> RGBColor:
    """Threshold-coded color for an IELTS band score."""
    if score is None:
        return _COLOR_TEAL
    if score >= 7.0:
        return _COLOR_TEAL
    if score >= 5.5:
        return _COLOR_AMBER
    return _COLOR_RED


# ── Public API ───────────────────────────────────────────────────────

def render_essay_to_docx(
    *,
    feedback: WritingFeedback,
    essay_text: str,
    prompt_text: str,
    task_type: str,
    student_name: str,
    student_code: str,
) -> tuple[bytes, str]:
    """Build .docx bytes + suggested filename for one essay's feedback."""
    doc = Document()
    _build_document(
        doc=doc,
        feedback=feedback,
        essay_text=essay_text,
        prompt_text=prompt_text,
        task_type=task_type,
        student_name=student_name,
    )
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.read(), build_filename(student_code=student_code, task_type=task_type)


def build_filename(*, student_code: str, task_type: str) -> str:
    """{student_code}_{YYYYMMDD}_T{1|2}.docx — sanitised for safe filename use."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    task_num = "2" if task_type == "task2" else "1"
    safe_code = re.sub(r"[^A-Za-z0-9_-]", "", student_code) or "student"
    return f"{safe_code}_{today}_T{task_num}.docx"


# ── Internals ────────────────────────────────────────────────────────

def _build_document(
    *,
    doc: Document,
    feedback: WritingFeedback,
    essay_text: str,
    prompt_text: str,
    task_type: str,
    student_name: str,
) -> None:
    label = _TASK_LABELS.get(task_type, "Writing Analysis")
    doc.add_heading(label, level=1)
    if student_name:
        meta = doc.add_paragraph()
        meta.add_run(student_name).italic = True

    # ── Overall Band Score ──
    doc.add_heading("Overall Band Score", level=2)
    band_p = doc.add_paragraph()
    band_run = band_p.add_run(f"{feedback.overallBandScore:.1f} / 9.0")
    band_run.bold = True
    band_run.font.size = Pt(20)
    band_run.font.color.rgb = _band_color(feedback.overallBandScore)
    doc.add_paragraph(feedback.overallBandScoreSummary)

    # ── Key Takeaways ──
    doc.add_heading("Key Takeaways", level=2)
    table = doc.add_table(rows=2, cols=2)
    table.style = "Light Grid Accent 1"
    table.rows[0].cells[0].text = "Strengths"
    table.rows[0].cells[1].text = "Areas for Improvement"
    _bold_first_row(table)
    _fill_bullets(table.rows[1].cells[0], feedback.keyTakeaways.strengths)
    _fill_bullets(table.rows[1].cells[1], feedback.keyTakeaways.areasForImprovement)

    # ── Criteria 2x2 ──
    doc.add_heading("Criteria Breakdown", level=2)
    cf = feedback.criteriaFeedback
    crit_table = doc.add_table(rows=2, cols=2)
    crit_table.style = "Light Grid Accent 1"
    _fill_criterion_cell(crit_table.rows[0].cells[0], cf.mainCriterion)
    _fill_criterion_cell(crit_table.rows[0].cells[1], cf.coherenceCohesion)
    _fill_criterion_cell(crit_table.rows[1].cells[0], cf.lexicalResource)
    _fill_criterion_cell(crit_table.rows[1].cells[1], cf.grammaticalRange)

    # ── Original Essay ──
    doc.add_heading("Original Essay (Mistakes Highlighted)", level=2)
    if prompt_text:
        prompt_p = doc.add_paragraph()
        r = prompt_p.add_run("Prompt: ")
        r.bold = True
        prompt_p.add_run(prompt_text)
    _add_essay_with_highlights(doc, essay_text, feedback)

    # ── Detailed Issue Analysis ──
    if feedback.mistakeAnalysis:
        doc.add_heading("Detailed Issue Analysis", level=2)
        m_table = doc.add_table(rows=1 + len(feedback.mistakeAnalysis), cols=5)
        m_table.style = "Light Grid Accent 1"
        header = m_table.rows[0].cells
        header[0].text = "#"
        header[1].text = "Original Text"
        header[2].text = "Issue Type"
        header[3].text = "Explanation"
        header[4].text = "Suggestion"
        _bold_first_row(m_table)
        for i, m in enumerate(feedback.mistakeAnalysis, start=1):
            row = m_table.rows[i].cells
            row[0].text = str(i)
            row[1].text = m.original or ""
            row[2].text = m.mistakeType or ""
            row[3].text = m.explanation or ""
            row[4].text = m.suggestion or ""

    # ── Advanced Analysis (only if at least one sub-section has data) ──
    has_lex   = bool(feedback.lexicalAnalysis and feedback.lexicalAnalysis.wordsToUpgrade)
    has_sent  = bool(feedback.sentenceStructureAnalysis and feedback.sentenceStructureAnalysis.sentenceUpgrades)
    has_idea  = bool(feedback.ideaDevelopmentAnalysis)
    has_coh   = bool(feedback.coherenceAnalysis)
    has_count = bool(feedback.counterargumentAnalysis)

    if has_lex or has_sent or has_idea or has_coh or has_count:
        doc.add_heading("Advanced Analysis", level=2)

    if has_lex:
        doc.add_heading("Vocabulary Upgrade", level=3)
        words = feedback.lexicalAnalysis.wordsToUpgrade
        v_table = doc.add_table(rows=1 + len(words), cols=3)
        v_table.style = "Light Grid Accent 1"
        v_table.rows[0].cells[0].text = "Your Phrase"
        v_table.rows[0].cells[1].text = "Band 8+ Alternatives"
        v_table.rows[0].cells[2].text = "Category / Context"
        _bold_first_row(v_table)
        for i, w in enumerate(words, start=1):
            row = v_table.rows[i].cells
            cell0 = row[0].paragraphs[0]
            cell0.add_run(w.original or "").italic = True
            if w.context:
                row[0].add_paragraph(w.context).runs[0].font.size = Pt(9)
            row[1].text = ", ".join(w.suggestions or [])
            row[2].text = w.category or ""

    if has_sent:
        doc.add_heading("Sentence Structure Analysis", level=3)
        for s in feedback.sentenceStructureAnalysis.sentenceUpgrades:
            _kv_paragraph(doc, "Original:", s.original or "", italic_value=True)
            _kv_paragraph(doc, "Rewritten:", s.rewritten or "")
            doc.add_paragraph(s.explanation or "")

    if has_idea:
        doc.add_heading("Idea Development / Data Selection", level=3)
        for item in feedback.ideaDevelopmentAnalysis:
            _kv_paragraph(doc, f"Paragraph {item.paragraph}:", item.issue or "")
            if item.originalIdea:
                _kv_paragraph(doc, "Original idea:", item.originalIdea, italic_value=True)
            doc.add_paragraph(item.explanation or "")
            if item.suggestion:
                sugg_text = item.suggestion.instruction or ""
                if item.suggestion.example:
                    sugg_text = f"{sugg_text} — {item.suggestion.example}"
                _kv_paragraph(doc, "Suggestion:", sugg_text)

    if has_coh:
        doc.add_heading("Coherence & Flow", level=3)
        for c in feedback.coherenceAnalysis:
            label_text = c.location or "Issue"
            _kv_paragraph(doc, f"{label_text}:", c.issue or "")
            doc.add_paragraph(c.explanation or "")
            if c.suggestion:
                sugg_text = c.suggestion.instruction or ""
                if c.suggestion.example:
                    sugg_text = f"{sugg_text} — {c.suggestion.example}"
                _kv_paragraph(doc, "Suggestion:", sugg_text)

    if has_count:
        doc.add_heading("Counterargument", level=3)
        ca = feedback.counterargumentAnalysis
        _kv_paragraph(doc, "Present in essay:", "Có" if ca.isPresent else "Không")
        if ca.feedback:
            doc.add_paragraph(ca.feedback)
        if ca.suggestion:
            _kv_paragraph(doc, "Suggestion:", ca.suggestion)
        if ca.context:
            ctx_p = doc.add_paragraph()
            ctx_p.add_run(
                f"Insertion point: {ca.context.insertionPoint} — {ca.context.reasoning}"
            ).font.size = Pt(9)

    # ── AI Content Analysis ──
    if feedback.aiContentAnalysis:
        doc.add_heading("AI Content Analysis", level=2)
        _kv_paragraph(
            doc,
            "Likelihood AI-generated:",
            f"{feedback.aiContentAnalysis.likelihood}%",
        )
        doc.add_paragraph(feedback.aiContentAnalysis.explanation or "")

    # ── Improved Essay ──
    doc.add_heading("Improved Essay (Band 8.0+)", level=2)
    for paragraph in (feedback.improvedEssay or "").split("\n\n"):
        if paragraph.strip():
            doc.add_paragraph(paragraph.strip())


# ── Cell / paragraph helpers ─────────────────────────────────────────

def _bold_first_row(table) -> None:
    for cell in table.rows[0].cells:
        for paragraph in cell.paragraphs:
            for run in paragraph.runs:
                run.bold = True


def _fill_bullets(cell, items: Iterable[str]) -> None:
    """Replace cell content with a Word-native bullet list (style='List Bullet').

    python-docx tables ship with one empty paragraph per cell; we reuse
    it for the first item so we don't leave a stray blank line at the
    top of the cell (W3.2 Phase 3: switched from "• " prefix runs to
    Word's built-in bullet style — Andy's first-use feedback noted the
    prior render had no bullets).
    """
    items = list(items or [])
    if not items:
        cell.text = "—"
        return
    cell.paragraphs[0].text = ""
    for i, item in enumerate(items):
        if i == 0:
            p = cell.paragraphs[0]
            p.text = ""
        else:
            p = cell.add_paragraph()
        p.style = "List Bullet"
        p.add_run(item)


def _fill_criterion_cell(cell, criterion) -> None:
    """Render one criterion: title (bold) + band (threshold-coloured) +
    explanation (italic) + feedback paragraph.

    W3.2 Phase 3: the band score colour now follows the same threshold as
    the overall band — teal/amber/red — so a low criterion stands out
    instead of misleadingly rendering teal."""
    cell.paragraphs[0].text = ""
    title_p = cell.paragraphs[0]
    title_run = title_p.add_run(criterion.title)
    title_run.bold = True
    band_run = title_p.add_run(f"  {criterion.bandScore}/9")
    band_run.bold = True
    band_run.font.color.rgb = _band_color(criterion.bandScore)

    if criterion.explanation:
        exp_p = cell.add_paragraph()
        exp_p.add_run(criterion.explanation).italic = True
    if criterion.feedback:
        cell.add_paragraph(criterion.feedback)


def _kv_paragraph(doc, key: str, value: str, *, italic_value: bool = False):
    """Bold key + value run on the same line."""
    p = doc.add_paragraph()
    p.add_run(key + " ").bold = True
    run = p.add_run(value)
    if italic_value:
        run.italic = True
    return p


# ── Mistake-highlight inside the original essay paragraphs ───────────

def _add_essay_with_highlights(doc, essay_text: str, feedback: WritingFeedback) -> None:
    """Add the essay paragraphs to the doc, wrapping each mistake's
    `original` substring with a yellow highlight run.

    Mirrors writing_render._highlight_mistakes' invariants: longest-first
    + single non-overlapping regex pass so longer mistakes win at any
    given position and we never get nested highlights.
    """
    if not essay_text:
        return

    originals: list[str] = []
    seen: set[str] = set()
    for m in feedback.mistakeAnalysis or []:
        s = (m.original or "").strip()
        if s and s not in seen:
            originals.append(s)
            seen.add(s)
    originals.sort(key=len, reverse=True)
    pattern = (
        re.compile("|".join(re.escape(o) for o in originals))
        if originals else None
    )

    for raw in essay_text.split("\n\n"):
        if not raw.strip():
            continue
        p = doc.add_paragraph()
        if pattern is None:
            p.add_run(raw)
            continue
        last = 0
        for match in pattern.finditer(raw):
            if match.start() > last:
                p.add_run(raw[last:match.start()])
            mark_run = p.add_run(match.group(0))
            _highlight_run_yellow(mark_run)
            last = match.end()
        if last < len(raw):
            p.add_run(raw[last:])


def _highlight_run_yellow(run) -> None:
    """Set Word's yellow highlight on a run (matches <mark> in HTML render)."""
    rPr = run._r.get_or_add_rPr()
    highlight = OxmlElement("w:highlight")
    highlight.set(qn("w:val"), "yellow")
    rPr.append(highlight)
