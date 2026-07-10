"""Unit tests for services/reading_solution_depth — the stricter #6 gate."""

from services import reading_solution_depth as depth


def _two_steps():
    return [
        {"action": "locate", "instruction_vi": "Quét tìm từ khóa."},
        {"action": "confirm", "instruction_vi": "Xác nhận đáp án."},
    ]


# ── wrong_options ─────────────────────────────────────────────────────────────

def test_wrong_options_mcq():
    q = {
        "question_type": "mcq_single",
        "options": [{"label": "A", "text": "x"}, {"label": "B", "text": "y"}, {"label": "C", "text": "z"}],
        "answer": "B",
    }
    assert depth.wrong_options(q) == ["A", "C"]


def test_wrong_options_tfng_implicit():
    q = {"question_type": "true_false_not_given", "answer": "FALSE"}
    assert depth.wrong_options(q) == ["TRUE", "NOT GIVEN"]


def test_wrong_options_mcq_multi_list_answer():
    # "choose TWO" → answer is a list; wrong = every option not in it
    q = {
        "question_type": "mcq_multi",
        "options": [{"label": "A"}, {"label": "B"}, {"label": "C"}, {"label": "D"}, {"label": "E"}],
        "answer": ["B", "C"],
    }
    assert depth.wrong_options(q) == ["A", "D", "E"]


def test_wrong_options_gapfill_is_none():
    # short-answer / gap-fill has no fixed distractor set
    q = {"question_type": "sentence_completion", "answer": "coal"}
    assert depth.wrong_options(q) is None


# ── depth gate ────────────────────────────────────────────────────────────────

def test_missing_solution_fails():
    errs = depth.validate_solution_depth({"question_type": "sentence_completion", "answer": "coal"}, "q1")
    assert errs and "thiếu 'solution'" in errs[0]


def test_one_step_solution_too_shallow():
    q = {
        "question_type": "sentence_completion", "answer": "coal",
        "solution": {"solution_steps": [{"action": "locate", "instruction_vi": "Tìm."}]},
    }
    errs = depth.validate_solution_depth(q, "q1")
    assert any("≥ 2 bước" in e for e in errs)


def test_gapfill_two_steps_no_distractor_needed_passes():
    q = {
        "question_type": "sentence_completion", "answer": "coal",
        "solution": {"solution_steps": _two_steps()},
    }
    assert depth.validate_solution_depth(q, "q1") == []
    assert depth.is_deep(q)


def test_mcq_missing_distractor_analysis_fails():
    q = {
        "question_type": "mcq_single",
        "options": [{"label": "A"}, {"label": "B"}, {"label": "C"}],
        "answer": "B",
        "solution": {"solution_steps": _two_steps()},  # no distractor_analysis
    }
    errs = depth.validate_solution_depth(q, "q1")
    assert any("distractor_analysis" in e and "A" in e and "C" in e for e in errs)


def test_mcq_full_distractor_coverage_passes():
    q = {
        "question_type": "mcq_single",
        "options": [{"label": "A"}, {"label": "B"}, {"label": "C"}],
        "answer": "B",
        "solution": {
            "solution_steps": _two_steps(),
            "distractor_analysis": [
                {"option": "A", "why_wrong_vi": "A sai vì lệch nghĩa."},
                {"option": "C", "why_wrong_vi": "C sai vì ngoài phạm vi đoạn."},
            ],
        },
    }
    assert depth.validate_solution_depth(q, "q1") == []


def test_mcq_partial_distractor_coverage_fails():
    q = {
        "question_type": "mcq_single",
        "options": [{"label": "A"}, {"label": "B"}, {"label": "C"}],
        "answer": "B",
        "solution": {
            "solution_steps": _two_steps(),
            "distractor_analysis": [{"option": "A", "why_wrong_vi": "A sai."}],  # missing C
        },
    }
    errs = depth.validate_solution_depth(q, "q1")
    assert any("['C']" in e or "C" in e for e in errs)


def test_empty_why_wrong_flagged():
    q = {
        "question_type": "true_false_not_given", "answer": "TRUE",
        "solution": {
            "solution_steps": _two_steps(),
            "distractor_analysis": [
                {"option": "FALSE", "why_wrong_vi": "  "},
                {"option": "NOT GIVEN", "why_wrong_vi": "NG sai."},
            ],
        },
    }
    errs = depth.validate_solution_depth(q, "q1")
    assert any("why_wrong_vi' trống" in e for e in errs)


def test_require_distractors_false_skips_coverage():
    q = {
        "question_type": "mcq_single",
        "options": [{"label": "A"}, {"label": "B"}],
        "answer": "A",
        "solution": {"solution_steps": _two_steps()},
    }
    assert depth.validate_solution_depth(q, "q1", require_distractors=False) == []
