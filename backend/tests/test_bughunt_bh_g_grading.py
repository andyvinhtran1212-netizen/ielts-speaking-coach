"""Báo cáo săn lỗi BH-G: chấm bài tập (#67 #93 #94).

#78/#87 (dictation filler, token "...") KHÔNG sửa trong grade_dictation: hàm đó
là chính sách đóng băng legacy-whitespace-v1 (services/dictation_grading_version);
đổi nó là đổi điểm giữa chừng của lượt đã bắt đầu. lexical-v2 đã chấm đúng cả hai.
"""
import pytest

from services import course_writing_grader as cwg
from services import sentence_lab_grader as slg
from services import vocab_unit_rules as vocab_units


def test_course_writing_ok_counts_issues_beyond_the_display_cap():
    # #67: 6 lỗi chữ hoa rồi mới tới lỗi ngữ pháp ⇒ cắt [:6] trước khi tính ok.
    caps = [{"before": f"word{i}", "after": f"Word{i}", "type": "mechanics"} for i in range(6)]
    grammar = {"before": "he go", "after": "he goes", "type": "grammar"}
    item = {"qid": "q1", "prompt": "p", "explain": "", "answer": "he go to school"}
    out, _ = cwg._build_results(
        [item], {"q1": {"qid": "q1", "corrected": "He goes to school",
                        "issues": caps + [grammar]}},
    )
    assert out[0]["ok"] is False
    assert len(out[0]["issues"]) == 6


def test_zero_gap_frame_is_not_widened_to_four():
    # #93
    task = {"task_type": "productive_transfer", "answer_key": {
        "required_frames": [[["have", "has"], ["impact"]]],
        "maximum_gap_words": 0, "minimum_words": 1,
    }}
    got = vocab_units.grade_response(task, {"answer": "Technology has a very big impact."})
    assert got["score"] < 1.0


def test_quoting_the_learners_own_correct_sentence_is_not_a_reveal():
    # #94
    sentence = "the cat sat on the mat today"
    assert slg._reveals(f'Câu "{sentence}" của em đã đúng.', [sentence], [sentence]) is False
    assert slg._reveals(f"Đáp án: {sentence}", [sentence], ["a cat sit mat"]) is True


def test_quoting_a_longer_learner_sentence_that_contains_the_answer_is_not_a_reveal():
    # CR #2701: câu của học viên dài hơn lời giải và chứa trọn nó — điểm giống
    # "câu của em" thấp hơn, nhưng đoạn vẫn là trích lại câu của em ấy.
    assert slg._reveals(
        "You wrote: the cat sat on the mat.",
        ["the cat sat on the mat"],
        ["Yesterday the cat sat on the mat quietly."],
    ) is False
    # Lộ đáp án thật vẫn bị bắt dù học viên viết câu dài khác hẳn.
    assert slg._reveals(
        "Try: the cat sat on the mat.",
        ["the cat sat on the mat"],
        ["Yesterday a dog ran across the yard quietly."],
    ) is True


@pytest.mark.parametrize("gap", ["", "abc", [1]])
def test_non_numeric_maximum_gap_words_is_a_rule_error(gap):
    task = {"task_type": "productive_transfer", "answer_key": {
        "required_frames": [[["have", "has"], ["impact"]]],
        "maximum_gap_words": gap, "minimum_words": 1,
    }}
    with pytest.raises(vocab_units.VocabUnitRuleError):
        vocab_units.grade_response(task, {"answer": "Technology has a big impact."})
