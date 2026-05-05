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
    assert "Overall Band Score" in html
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
    assert "Vocabulary Upgrade" in html
    assert "Sentence Structure Analysis" in html
    assert "Idea Development" in html
    assert "Coherence" in html
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
    assert f"<h1>{label}</h1>" in html


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
    fb = WritingFeedback(**_l1_feedback())
    html = render_feedback_html(
        feedback=fb,
        essay_text="I has been study for years. Many other things happened.",
        prompt_text="x", task_type="task2", student_name="A",
    )
    # The mistake's `original` is "I has been study"
    assert "<mark>I has been study</mark>" in html


def test_highlight_handles_empty_essay():
    fb = WritingFeedback(**_l1_feedback())
    out = _highlight_mistakes("", fb)
    assert str(out) == ""


def test_highlight_longest_match_first():
    """A longer mistake string shouldn't be shadowed by a shorter substring
    of itself appearing as a different mistake."""
    payload = _l1_feedback()
    payload["mistakeAnalysis"] = [
        {"original": "study",          "mistakeType": "G", "explanation": "x", "suggestion": "y", "criterion": "z"},
        {"original": "I has been study", "mistakeType": "G", "explanation": "x", "suggestion": "y", "criterion": "z"},
    ]
    fb = WritingFeedback(**payload)
    out = str(_highlight_mistakes("I has been study for years.", fb))
    # The full phrase wraps — no nested <mark>
    assert "<mark>I has been study</mark>" in out
    # And no broken nesting like "<mark>I has been <mark>study</mark></mark>"
    assert out.count("<mark>") == out.count("</mark>")


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


# ── W3.2 Phase 4: threshold band class + takeaway colour classes ─────

@pytest.mark.parametrize("score,expected_class", [
    (8.0, "band-high"),
    (7.0, "band-high"),
    (6.5, "band-mid"),
    (5.5, "band-mid"),
    (5.0, "band-low"),
    (3.5, "band-low"),
])
def test_render_includes_band_threshold_class(score, expected_class):
    """Overall band-score span carries the threshold class (high/mid/low)
    so clipboard paste into Google Docs colours by performance."""
    payload = _l1_feedback()
    payload["overallBandScore"] = score
    fb = WritingFeedback(**payload)
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    assert f'class="band-score {expected_class}"' in html


def test_render_strengths_use_strength_class():
    fb = WritingFeedback(**_l1_feedback())
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    assert '<li class="strength">Diễn đạt rõ ý chính</li>' in html


def test_render_improvements_use_improvement_class():
    fb = WritingFeedback(**_l1_feedback())
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    assert '<li class="improvement">Cần đa dạng cấu trúc câu</li>' in html


def test_render_criterion_band_uses_threshold_class():
    """Per-criterion crit-band span carries band-{high,mid,low} too."""
    payload = _l1_feedback()
    payload["criteriaFeedback"]["lexicalResource"]["bandScore"] = 8  # high
    payload["criteriaFeedback"]["grammaticalRange"]["bandScore"] = 4  # low
    fb = WritingFeedback(**payload)
    html = render_feedback_html(
        feedback=fb, essay_text="x", prompt_text="y",
        task_type="task2", student_name="A",
    )
    assert 'crit-band band-high">8/9' in html
    assert 'crit-band band-low">4/9' in html


# ── Smoke: ensure deepcopy of payload doesn't mutate fixtures ────────

def test_fixture_isolation_smoke():
    a = _l1_feedback()
    b = deepcopy(a)
    b["overallBandScore"] = 1.0
    assert a["overallBandScore"] == 6.0
