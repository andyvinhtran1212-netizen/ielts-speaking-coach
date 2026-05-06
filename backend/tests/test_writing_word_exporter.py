"""Tests for services.writing_word_exporter (Sprint W3 Phase 2)."""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone

import pytest
from docx import Document

from models.writing_feedback import WritingFeedback
from services.writing_word_exporter import (
    build_filename,
    render_essay_to_docx,
)


# ── Fixtures ─────────────────────────────────────────────────────────

def _l1_payload() -> dict:
    return {
        "overallBandScore": 6.0,
        "overallBandScoreSummary": "Bài đạt mức Band 6.0.",
        "keyTakeaways": {
            "strengths": ["Diễn đạt rõ ý"],
            "areasForImprovement": ["Cần đa dạng cấu trúc câu"],
        },
        "criteriaFeedback": {
            "mainCriterion":     {"title": "Task Response",       "explanation": "x", "feedback": "y", "bandScore": 6},
            "coherenceCohesion": {"title": "Coherence & Cohesion", "explanation": "x", "feedback": "y", "bandScore": 6},
            "lexicalResource":   {"title": "Lexical Resource",     "explanation": "x", "feedback": "y", "bandScore": 6},
            "grammaticalRange":  {"title": "Grammatical Range",    "explanation": "x", "feedback": "y", "bandScore": 6},
        },
        "mistakeAnalysis": [
            {"original": "I has been study", "mistakeType": "Grammar", "explanation": "Sai trợ động từ", "suggestion": "I have been studying", "criterion": "Grammatical Range"},
        ],
        "aiContentAnalysis": {"likelihood": 5, "explanation": "Bài tự nhiên."},
        "improvedEssay": "Improved version.",
    }


def _l5_payload() -> dict:
    payload = _l1_payload()
    payload.update({
        "ideaDevelopmentAnalysis": [
            {"paragraph": 2, "originalIdea": "Học sinh nên học gì họ thích.", "issue": "Chưa rõ", "explanation": "Cần ví dụ.", "suggestion": {"instruction": "Thêm ví dụ", "example": "For instance…"}},
        ],
        "coherenceAnalysis": [
            {"location": "Para 2", "issue": "Topic shift", "explanation": "Đột ngột.", "suggestion": {"instruction": "Câu chuyển ý", "example": "However…"}},
        ],
        "counterargumentAnalysis": {"isPresent": False, "feedback": "Chưa có.", "suggestion": "Thêm đoạn đối lập.", "context": {"insertionPoint": "after p2", "reasoning": "Cân bằng."}},
        "lexicalAnalysis": {"wordsToUpgrade": [{"original": "good", "context": "very good", "suggestions": ["proficient"], "category": "Adjective"}]},
        "sentenceStructureAnalysis": {"sentenceUpgrades": [{"original": "I think.", "rewritten": "It is my contention.", "explanation": "Phức hơn."}]},
    })
    return payload


def _build(payload: dict, *, essay="My essay.", code="S001", task="task2") -> tuple[bytes, str]:
    fb = WritingFeedback(**payload)
    return render_essay_to_docx(
        feedback=fb,
        essay_text=essay,
        prompt_text="Sample prompt.",
        task_type=task,
        student_name="Trần Trọng Vinh",
        student_code=code,
    )


def _open(docx_bytes: bytes) -> Document:
    return Document(io.BytesIO(docx_bytes))


# ── Filename ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("task,expected_t", [
    ("task1_academic", "T1"),
    ("task1_general",  "T1"),
    ("task2",          "T2"),
])
def test_filename_uses_correct_task_suffix(task, expected_t):
    name = build_filename(student_code="S001", task_type=task)
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    assert name == f"S001_{today}_{expected_t}.docx"


def test_filename_sanitises_unsafe_student_code():
    """Slashes, spaces, etc. dropped — nothing breaks Content-Disposition."""
    name = build_filename(student_code="S/001 hack..", task_type="task2")
    assert "/" not in name
    assert " " not in name
    assert ".." not in name
    assert name.endswith(".docx")


def test_filename_falls_back_when_code_empty():
    name = build_filename(student_code="", task_type="task2")
    assert name.startswith("student_")


# ── Output structure ─────────────────────────────────────────────────

def test_l1_doc_opens_and_has_expected_headings():
    docx_bytes, filename = _build(_l1_payload())
    assert filename.endswith(".docx")
    assert len(docx_bytes) > 1000  # non-trivial size

    doc = _open(docx_bytes)
    headings = [
        p.text for p in doc.paragraphs if p.style and p.style.name.startswith("Heading")
    ]
    # Required L1 sections
    assert "Task 2 Analysis" in headings  # H1
    assert "Overall Band Score" in headings
    assert "Key Takeaways" in headings
    assert "Criteria Breakdown" in headings
    assert "Original Essay (Mistakes Highlighted)" in headings
    assert "Detailed Issue Analysis" in headings
    assert "Improved Essay (Band 8.0+)" in headings
    # No Advanced Analysis at L1
    assert "Advanced Analysis" not in headings


def test_l5_doc_includes_all_advanced_subsections():
    docx_bytes, _ = _build(_l5_payload())
    doc = _open(docx_bytes)
    headings = [
        p.text for p in doc.paragraphs if p.style and p.style.name.startswith("Heading")
    ]
    assert "Advanced Analysis" in headings
    assert "Vocabulary Upgrade" in headings
    assert "Sentence Structure Analysis" in headings
    assert "Idea Development / Data Selection" in headings
    assert "Coherence & Flow" in headings
    assert "Counterargument" in headings


def test_l1_doc_skips_advanced_when_no_data():
    """Defence: even if a sub-section is set to an empty list, the heading
    must still be skipped."""
    payload = _l1_payload()
    payload["lexicalAnalysis"] = {"wordsToUpgrade": []}
    payload["sentenceStructureAnalysis"] = {"sentenceUpgrades": []}
    payload["coherenceAnalysis"] = []
    payload["ideaDevelopmentAnalysis"] = []
    docx_bytes, _ = _build(payload)
    doc = _open(docx_bytes)
    headings = [p.text for p in doc.paragraphs if p.style and p.style.name.startswith("Heading")]
    assert "Advanced Analysis" not in headings


# ── Content sanity ───────────────────────────────────────────────────

def test_doc_contains_overall_band_text():
    docx_bytes, _ = _build(_l1_payload())
    doc = _open(docx_bytes)
    full = "\n".join(p.text for p in doc.paragraphs)
    assert "6.0 / 9.0" in full
    assert "Bài đạt mức Band 6.0." in full
    # Vietnamese diacritics survive
    assert "Trần Trọng Vinh" in full


def test_doc_contains_mistake_table_rows():
    docx_bytes, _ = _build(_l1_payload())
    doc = _open(docx_bytes)
    # Find the mistakes table (5 columns: # / Original / Type / Explanation / Suggestion)
    mistake_tables = [t for t in doc.tables if len(t.columns) == 5]
    assert mistake_tables, "5-col mistakes table missing"
    table = mistake_tables[0]
    # 1 header + 1 mistake row
    assert len(table.rows) == 2
    assert table.rows[1].cells[1].text == "I has been study"
    assert table.rows[1].cells[4].text == "I have been studying"


def test_doc_highlights_mistakes_in_essay():
    """Each mistake's `original` should be wrapped in a yellow-highlighted run."""
    docx_bytes, _ = _build(
        _l1_payload(),
        essay="I has been study for many years now.",
    )
    doc = _open(docx_bytes)
    yellow_runs = [
        run.text for p in doc.paragraphs for run in p.runs
        if _is_yellow_highlight(run)
    ]
    assert "I has been study" in yellow_runs


def test_doc_handles_empty_mistakes_list_without_table():
    payload = _l1_payload()
    payload["mistakeAnalysis"] = []
    docx_bytes, _ = _build(payload)
    doc = _open(docx_bytes)
    headings = [p.text for p in doc.paragraphs if p.style and p.style.name.startswith("Heading")]
    assert "Detailed Issue Analysis" not in headings


# ── Helpers ──────────────────────────────────────────────────────────

def _is_yellow_highlight(run) -> bool:
    """Inspect run XML for w:highlight w:val='yellow' (set by the exporter)."""
    rPr = run._r.find("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rPr")
    if rPr is None:
        return False
    hl = rPr.find("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}highlight")
    if hl is None:
        return False
    return hl.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val") == "yellow"


# ── W3.2 Phase 3: threshold colors + native bullets ──────────────────

from services.writing_word_exporter import _band_color, _COLOR_TEAL, _COLOR_AMBER, _COLOR_RED


@pytest.mark.parametrize("score,expected", [
    (8.0, _COLOR_TEAL),   # high → teal
    (7.0, _COLOR_TEAL),   # boundary → teal
    (6.5, _COLOR_AMBER),  # mid → amber
    (5.5, _COLOR_AMBER),  # boundary → amber
    (5.0, _COLOR_RED),    # low → red
    (3.5, _COLOR_RED),    # well below
])
def test_band_color_threshold(score, expected):
    assert _band_color(score) == expected


def _band_run_color(doc):
    """The first run after the 'Overall Band Score' heading carries the
    coloured band text."""
    found_heading = False
    for p in doc.paragraphs:
        if found_heading and p.runs:
            return p.runs[0].font.color.rgb
        if p.style and p.style.name.startswith("Heading") and p.text == "Overall Band Score":
            found_heading = True
    return None


def test_doc_overall_band_color_low_band():
    """Low band (< 5.5) gets the red threshold color, not teal."""
    payload = _l1_payload()
    payload["overallBandScore"] = 4.5
    payload["criteriaFeedback"]["mainCriterion"]["bandScore"] = 4
    payload["criteriaFeedback"]["coherenceCohesion"]["bandScore"] = 4
    payload["criteriaFeedback"]["lexicalResource"]["bandScore"] = 4
    payload["criteriaFeedback"]["grammaticalRange"]["bandScore"] = 4
    docx_bytes, _ = _build(payload)
    doc = _open(docx_bytes)
    assert _band_run_color(doc) == _COLOR_RED


def test_doc_overall_band_color_mid_band():
    """Mid band (5.5 ≤ x < 7.0) gets amber."""
    payload = _l1_payload()
    payload["overallBandScore"] = 6.0
    docx_bytes, _ = _build(payload)
    doc = _open(docx_bytes)
    assert _band_run_color(doc) == _COLOR_AMBER


def test_doc_overall_band_color_high_band():
    """High band (≥ 7.0) keeps teal."""
    payload = _l1_payload()
    payload["overallBandScore"] = 7.5
    docx_bytes, _ = _build(payload)
    doc = _open(docx_bytes)
    assert _band_run_color(doc) == _COLOR_TEAL


def test_doc_takeaways_use_word_bullet_style():
    """Strengths + Areas for Improvement render with Word's 'List Bullet'
    style — Andy's first-use feedback noted the prior render had no
    visible bullet indents."""
    docx_bytes, _ = _build(_l1_payload())
    doc = _open(docx_bytes)
    # Key Takeaways is the first 2x2 table after the H1
    takeaways = doc.tables[0]
    bullet_styles = []
    for cell in (takeaways.rows[1].cells[0], takeaways.rows[1].cells[1]):
        for p in cell.paragraphs:
            if p.text:  # skip blank seed paragraph
                bullet_styles.append(p.style.name)
    assert bullet_styles, "no takeaway items rendered"
    assert all(s == "List Bullet" for s in bullet_styles), (
        f"Expected every populated takeaway paragraph to use 'List Bullet'; "
        f"got {bullet_styles}"
    )


# ── Phase 1.5c — sentenceStructureAnalysis dual-shape rendering ──────


def test_doc_renders_phase_1_5c_sentence_structure_shape():
    """Phase 1.5c overloads `sentenceStructureAnalysis` with the
    structured shape (summary + complexity + observation +
    common_issues + focus_theme). Word exporter must detect the
    `summary` key and render the structured block — including the
    focus theme heading + practice line — instead of trying to walk
    a non-existent `sentenceUpgrades` list.

    Pinning the focus_theme.title in the doc text guards against a
    regression where someone adds a Phase-1.5c branch but forgets to
    plumb the focus theme through (the theme is the most actionable
    output for the student)."""
    payload = _l1_payload()
    payload["sentenceStructureAnalysis"] = {
        "summary": "Em hay viết câu chạy không có dấu chấm.",
        "common_issues": [
            {"pattern": "Run-on sentence", "count": 4,
             "examples": ["I went home it was late."]},
        ],
        "complexity_indicator": "needs_more_simple",
        "current_essay_observation": "Bài này có 2 câu chạy.",
        "focus_theme": {
            "title": "Tách câu bằng dấu chấm + liên từ",
            "why":   "Em đang chạy câu — cần fix trước khi push complex structures.",
            "this_week_practice": "Viết 5 câu, mỗi câu kết bằng dấu chấm rõ ràng.",
        },
    }
    docx_bytes, _ = _build(payload)
    doc = _open(docx_bytes)

    headings = [
        p.text for p in doc.paragraphs
        if p.style and p.style.name.startswith("Heading")
    ]
    assert "Sentence Structure Analysis" in headings
    assert "Focus this week" in headings  # H4 sub-heading

    full_text = "\n".join(p.text for p in doc.paragraphs)
    # Summary + observation surface in body text.
    assert "Em hay viết câu chạy" in full_text
    assert "Bài này có 2 câu chạy" in full_text
    # Recurring pattern + count rendered.
    assert "Run-on sentence" in full_text
    assert "(4x)" in full_text
    # Focus theme title + practice line both surface.
    assert "Tách câu bằng dấu chấm" in full_text
    assert "Viết 5 câu" in full_text


def test_doc_renders_legacy_sentence_upgrades_shape():
    """The legacy `{sentenceUpgrades: [{original, rewritten,
    explanation}]}` shape must keep rendering unchanged — Phase 1.5c
    only fires for ≥5-essay students, so L4/L5 essays from new
    students still emit this shape via the system prompt.

    Phase 1.5c rework relaxed `sentenceStructureAnalysis` from a
    Pydantic class to `Optional[dict]`, so this test also pins the
    dict-access path (.get('sentenceUpgrades') vs .sentenceUpgrades)
    against a future regression where someone re-introduces attribute
    access without updating the field type."""
    payload = _l5_payload()
    # _l5_payload already provides legacy sentenceUpgrades — assert it
    # surfaces as before.
    docx_bytes, _ = _build(payload)
    doc = _open(docx_bytes)

    headings = [
        p.text for p in doc.paragraphs
        if p.style and p.style.name.startswith("Heading")
    ]
    assert "Sentence Structure Analysis" in headings
    # Phase-1.5c-only sub-heading must NOT appear when shape is legacy.
    assert "Focus this week" not in headings

    full_text = "\n".join(p.text for p in doc.paragraphs)
    # Original (italicised) + rewritten + explanation all surface.
    assert "I think." in full_text
    assert "It is my contention." in full_text
    assert "Phức hơn." in full_text
