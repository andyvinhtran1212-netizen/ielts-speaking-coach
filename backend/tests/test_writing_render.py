"""Tests for services.writing_render (Sprint W3 Phase 1)."""

from __future__ import annotations

from copy import deepcopy

import pytest

from models.writing_feedback import WritingFeedback
from services.writing_render import (
    _highlight_mistakes,
    render_feedback_html,
    render_plain_text,
)


# ── Reusable feedback fixtures ───────────────────────────────────────

def _l1_feedback() -> dict:
    """Level-1 minimal feedback — only mistakeAnalysis + AI + improved."""
    return {
        "overallBandScore": 6.0,
        "overallBandScoreSummary": "Bài đạt mức Band 6.0 với nhiều điểm cần cải thiện.",
        "keyTakeaways": {
            "strengths": ["Diễn đạt rõ ý chính"],
            "areasForImprovement": ["Cần đa dạng cấu trúc câu"],
        },
        "criteriaFeedback": {
            "mainCriterion":     {"title": "Task Response",       "explanation": "Đánh giá độ trả lời câu hỏi", "feedback": "Em đã trả lời chính câu hỏi.", "bandScore": 6},
            "coherenceCohesion": {"title": "Coherence & Cohesion", "explanation": "Độ trôi chảy và logic",       "feedback": "Logic đoạn còn rời rạc.",       "bandScore": 6},
            "lexicalResource":   {"title": "Lexical Resource",     "explanation": "Phong phú từ vựng",          "feedback": "Từ vựng cơ bản, chưa nâng cấp.", "bandScore": 6},
            "grammaticalRange":  {"title": "Grammatical Range",    "explanation": "Cấu trúc + độ chính xác",     "feedback": "Sai một số thì cơ bản.",         "bandScore": 6},
        },
        "mistakeAnalysis": [
            {"original": "I has been study", "mistakeType": "Grammar", "explanation": "Sai trợ động từ", "suggestion": "I have been studying", "criterion": "Grammatical Range"},
        ],
        "aiContentAnalysis": {"likelihood": 5, "explanation": "Bài tự nhiên, không có dấu hiệu AI."},
        "improvedEssay": "Improved version of the essay…\n\nSecond paragraph here.",
    }


def _l5_feedback() -> dict:
    """Level-5 full feedback — all conditional sections populated."""
    base = _l1_feedback()
    base.update({
        "ideaDevelopmentAnalysis": [
            {
                "paragraph": 2,
                "originalIdea": "Học sinh nên học bất cứ gì họ thích.",
                "issue": "Lập luận chưa rõ ràng",
                "explanation": "Cần ví dụ cụ thể.",
                "suggestion": {"instruction": "Thêm ví dụ về sinh viên ngành nghệ thuật", "example": "For instance, a literature graduate may contribute…"},
            },
        ],
        "coherenceAnalysis": [
            {
                "location": "Paragraph 2, sentence 3",
                "issue": "Sudden topic shift",
                "explanation": "Đoạn 2 đột ngột chuyển chủ đề.",
                "suggestion": {"instruction": "Thêm câu chuyển ý", "example": "However, recent studies suggest…"},
            },
        ],
        "counterargumentAnalysis": {
            "isPresent": False,
            "feedback": "Bài chưa có counterargument.",
            "suggestion": "Thêm một đoạn trình bày quan điểm đối lập.",
            "context": {"insertionPoint": "after paragraph 2", "reasoning": "Thêm cân bằng cho lập luận."},
        },
        "lexicalAnalysis": {
            "wordsToUpgrade": [
                {"original": "good", "context": "very good students", "suggestions": ["proficient", "competent"], "category": "Adjective"},
            ],
        },
        "sentenceStructureAnalysis": {
            "sentenceUpgrades": [
                {"original": "I think students should learn.", "rewritten": "It is my contention that students ought to pursue what genuinely intrigues them.", "explanation": "Nâng cấp từ đơn sang phức."},
            ],
        },
    })
    return base


# ── Level coverage ───────────────────────────────────────────────────

def test_render_l1_minimal():
    """Level 1 produces a complete document without conditional sections."""
    fb = WritingFeedback(**_l1_feedback())
    html = render_feedback_html(
        feedback=fb,
        essay_text="I has been study for years.",
        prompt_text="Some IELTS prompt.",
        task_type="task2",
        student_name="Nguyễn Văn A",
    )
    assert "Task 2 Analysis" in html
    assert "Key Takeaways" in html
    assert "Criteria Breakdown" in html
    assert "Detailed Issue Analysis" in html
    assert "Improved Essay" in html
    # No conditional sections at L1
    assert "Advanced Analysis" not in html


def test_render_l5_full_includes_all_sections():
    """Level 5 surfaces every advanced sub-section."""
    fb = WritingFeedback(**_l5_feedback())
    html = render_feedback_html(
        feedback=fb,
        essay_text="My essay.",
        prompt_text="Prompt.",
        task_type="task2",
        student_name="A",
    )
    assert "Advanced Analysis" in html
    # Sprint 2.5.4 renamed "Vocabulary Upgrade" → "Vocabulary & Collocation"
    # and "Idea Development / Data Selection" → "Idea Development & Coherence".
    assert "Vocabulary &amp; Collocation" in html or "Vocabulary & Collocation" in html
    assert "Sentence Structure Analysis" in html
    assert "Idea Development" in html
    assert "Counterargument" in html


@pytest.mark.parametrize("task_type,label", [
    ("task1_academic", "Task 1 Academic Analysis"),
    ("task1_general",  "Task 1 General Analysis"),
    ("task2",          "Task 2 Analysis"),
])
def test_render_uses_correct_task_label(task_type, label):
    fb = WritingFeedback(**_l1_feedback())
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type=task_type, student_name="A",
    )
    # Sprint 2.5.4 inlines style on <h1> — match label without bracketing the whole tag.
    assert f">{label}</h1>" in html


# ── Vietnamese diacritics + escaping ─────────────────────────────────

def test_render_preserves_vietnamese_diacritics():
    fb = WritingFeedback(**_l1_feedback())
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="Trần Trọng Vinh",
    )
    # Diacritics survive verbatim (UTF-8 in template <meta charset>)
    assert "Trần Trọng Vinh" in html
    assert "Bài đạt mức Band" in html


def test_render_escapes_html_in_essay_text():
    """Adversarial essay content with <script> must be escaped, not executed."""
    fb = WritingFeedback(**_l1_feedback())
    nasty = '<script>alert("xss")</script>'
    html = render_feedback_html(
        feedback=fb, essay_text=nasty, prompt_text="y",
        task_type="task2", student_name="A",
    )
    # Raw <script> never appears
    assert "<script>" not in html
    # Escaped form does
    assert "&lt;script&gt;" in html


def test_render_escapes_html_in_mistake_text():
    """Mistake `original` field also goes through autoescape."""
    payload = _l1_feedback()
    payload["mistakeAnalysis"][0]["original"] = '<img src=x onerror=alert(1)>'
    fb = WritingFeedback(**payload)
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    assert "<img src=x" not in html
    assert "&lt;img" in html


# ── Mistake highlighter ──────────────────────────────────────────────

def test_highlight_wraps_each_mistake():
    """Sprint 2.5.4: highlight switched from yellow <mark> to red-bg
    inline span (#FEE2E2) so the paste into Google Docs survives
    without an external stylesheet."""
    fb = WritingFeedback(**_l1_feedback())
    html = render_feedback_html(
        feedback=fb,
        essay_text="I has been study for years. Many other things happened.",
        prompt_text="x", task_type="task2", student_name="A",
    )
    assert 'background:#FEE2E2' in html
    assert "I has been study" in html


def test_highlight_handles_empty_essay():
    fb = WritingFeedback(**_l1_feedback())
    out = _highlight_mistakes("", fb)
    assert str(out) == ""


def test_highlight_no_overlapping_spans():
    """A longer mistake string shouldn't be shadowed by a shorter substring
    of itself, and matched intervals must merge so highlights never nest."""
    payload = _l1_feedback()
    payload["mistakeAnalysis"] = [
        {"original": "study",            "mistakeType": "G", "explanation": "x", "suggestion": "y", "criterion": "z"},
        {"original": "I has been study", "mistakeType": "G", "explanation": "x", "suggestion": "y", "criterion": "z"},
    ]
    fb = WritingFeedback(**payload)
    out = str(_highlight_mistakes("I has been study for years.", fb))
    # The full phrase appears highlighted exactly once; the inner "study"
    # interval is merged into the longer one so we don't get two stacked spans.
    assert out.count('background:#FEE2E2') == 1
    # Highlight balance: every <span style=...> opener has a closing </span>.
    assert out.count('<span style="background:#FEE2E2;">') == out.count('</span>')


# ── Empty-array tolerance ────────────────────────────────────────────

def test_render_handles_empty_mistake_array():
    payload = _l1_feedback()
    payload["mistakeAnalysis"] = []
    fb = WritingFeedback(**payload)
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    # Section header skipped when no mistakes
    assert "Detailed Issue Analysis" not in html


def test_render_handles_empty_takeaways():
    payload = _l1_feedback()
    payload["keyTakeaways"] = {"strengths": [], "areasForImprovement": []}
    fb = WritingFeedback(**payload)
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    # Em-dash placeholder, no crash
    assert "Key Takeaways" in html
    assert "—" in html


# ── plain-text fallback ──────────────────────────────────────────────

def test_render_plain_text_strips_tags_and_keeps_text():
    fb = WritingFeedback(**_l1_feedback())
    html = render_feedback_html(
        feedback=fb, essay_text="My essay.", prompt_text="Prompt.",
        task_type="task2", student_name="Trần A",
    )
    plain = render_plain_text(html)
    assert "<" not in plain
    assert ">" not in plain
    assert "Task 2 Analysis" in plain
    assert "Trần A" in plain
    # Vietnamese diacritics survive
    assert "Bài đạt" in plain


def test_render_plain_text_unescapes_entities():
    """&amp; should become & in the plain-text output."""
    payload = _l1_feedback()
    payload["overallBandScoreSummary"] = "Q&A about <foo> things."
    fb = WritingFeedback(**payload)
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    plain = render_plain_text(html)
    assert "Q&A" in plain
    assert "<foo>" in plain  # angle brackets restored as-is in plain text


# ── Sprint 2.5.4: spec colour palette + structure pins ───────────────


def test_render_overall_band_uses_blue():
    """Overall band display is always blue (#2563EB) per spec — band
    threshold colouring moved to per-criterion cells."""
    payload = _l1_feedback()
    payload["overallBandScore"] = 5.0  # would have been 'low' under old threshold
    fb = WritingFeedback(**payload)
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    # The band block colour token is rendered uppercase via the palette.
    assert "color:#2563EB" in html.replace("color: #2563EB", "color:#2563EB")


def test_render_takeaway_colour_palette():
    """Strengths cell uses green palette; Improvements cell uses yellow."""
    fb = WritingFeedback(**_l1_feedback())
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    # Compact palette — token-based check (uppercase hex from palette).
    assert "#16A34A" in html  # green
    assert "#CA8A04" in html  # yellow
    assert "#F0FDF4" in html  # green bg
    assert "#FEFCE8" in html  # yellow bg


def test_render_takeaways_strengths_appear():
    """Strength + improvement strings still surface (no class system anymore)."""
    fb = WritingFeedback(**_l1_feedback())
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    assert "Diễn đạt rõ ý chính" in html
    assert "Cần đa dạng cấu trúc câu" in html


def test_render_criteria_grid_renders_all_four():
    """Spec 2×2 grid: all four IELTS criterion titles + band scores
    surface, even though the underlying schema is the named bundle
    (mainCriterion / coherenceCohesion / lexicalResource / grammaticalRange)."""
    payload = _l1_feedback()
    payload["criteriaFeedback"]["lexicalResource"]["bandScore"] = 8
    payload["criteriaFeedback"]["grammaticalRange"]["bandScore"] = 4
    fb = WritingFeedback(**payload)
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    # All four criteria titles render
    assert "Task Response" in html
    assert "Coherence &amp; Cohesion" in html
    assert "Lexical Resource" in html
    assert "Grammatical Range" in html
    # Band scores render as plain integers (no /9 suffix per spec).
    assert ">8<" in html  # lexical
    assert ">4<" in html  # grammar


def test_render_includes_footer():
    """Sprint 2.5.4 footer credit line."""
    fb = WritingFeedback(**_l1_feedback())
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    assert "Aver Learning" in html


def test_render_lexical_handles_pydantic_words_to_upgrade():
    """LexicalAnalysis.wordsToUpgrade renders into the 3-col table."""
    fb = WritingFeedback(**_l5_feedback())
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    # Original word + upgrade comma-joined surface.
    assert "good" in html
    assert "proficient" in html
    # 3-col Lexical Upgrade Table heading.
    assert "Upgrade (Band 8+)" in html


def test_render_counterargument_skipped_for_task1():
    """Task 1 essays don't have counterarguments — section must be hidden."""
    payload = _l5_feedback()
    fb = WritingFeedback(**payload)
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task1_academic", student_name="A",
    )
    assert "Counterargument" not in html


# ── Smoke: ensure deepcopy of payload doesn't mutate fixtures ────────

def test_fixture_isolation_smoke():
    a = _l1_feedback()
    b = deepcopy(a)
    b["overallBandScore"] = 1.0
    assert a["overallBandScore"] == 6.0
