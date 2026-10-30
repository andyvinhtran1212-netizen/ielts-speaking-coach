"""PC-J167 synthetic regression cohort: no database or real providers."""

import json
from copy import deepcopy
from pathlib import Path

import pytest

from models.writing_feedback import WritingFeedback
from services.writing_feedback_consistency import repair_writing_consistency
from services.writing_prompt_loader import WritingPromptLoader
from services.writing_history import format_history_for_prompt


@pytest.fixture
def feedback():
    payload = json.loads((Path(__file__).parent / "fixtures/writing_task1_consistency.json").read_text())
    return WritingFeedback.model_validate(payload)


def test_reported_task1_failures_are_repaired_without_changing_scores_or_history(feedback):
    before = feedback.model_dump()
    paths = repair_writing_consistency(feedback, "task1_academic")
    assert feedback.criteriaFeedback.mainCriterion.title == "Task Achievement"
    assert feedback.bandTrajectoryAnalysis["criteria_breakdown"][0]["criterion"] == "Task Achievement"
    assert [m.mistakeType for m in feedback.mistakeAnalysis] == ["Data Accuracy", "Data Accuracy", "Word Choice"]
    assert all(m.criterion == "Task Achievement" for m in feedback.mistakeAnalysis[:2])
    assert "levelled off" not in feedback.criteriaFeedback.lexicalResource.feedback
    assert "'rose'" in feedback.criteriaFeedback.lexicalResource.feedback
    assert feedback.keyTakeaways.strengths == ["Overview rõ ràng."]
    # summary is the five-essay overview (Codex r4421899085): its unscoped
    # low-range sentence is history and stays; the pattern denial is scoped.
    assert feedback.sentenceStructureAnalysis["summary"] == (
        "Cấu trúc câu đơn giản, cần câu phức. "
        "Chưa ghi nhận mẫu lỗi cấu trúc câu lặp lại trong dữ liệu cấu trúc câu.")
    assert "mâu thuẫn logic" not in feedback.coherenceAnalysis[0].explanation.lower()
    assert "sai so với dữ liệu biểu đồ" in feedback.coherenceAnalysis[0].issue
    assert "18–30-year-olds" in feedback.improvedEssay
    assert feedback.recurringPatterns == before["recurringPatterns"]
    assert feedback.overallBandScore == before["overallBandScore"]
    for key, item in before["criteriaFeedback"].items():
        assert getattr(feedback.criteriaFeedback, key).bandScore == item["bandScore"]
    assert [m.original for m in feedback.mistakeAnalysis] == [m["original"] for m in before["mistakeAnalysis"]]
    assert [m.suggestion for m in feedback.mistakeAnalysis] == [m["suggestion"] for m in before["mistakeAnalysis"]]
    assert paths and all("levelled off" not in path for path in paths)
    assert repair_writing_consistency(feedback, "task1_academic") == []


@pytest.mark.parametrize("task", ["task1_academic", "task1_general", "task2"])
def test_task_type_is_authoritative_for_all_criterion_labels(feedback, task):
    feedback.criteriaFeedback.mainCriterion.title = "Unreliable model label"
    repair_writing_consistency(feedback, task)
    expected = "Task Achievement" if task.startswith("task1") else "Task Response"
    assert feedback.criteriaFeedback.mainCriterion.title == expected
    assert feedback.bandTrajectoryAnalysis["criteria_breakdown"][0]["criterion"] == expected
    assert feedback.bandTrajectoryAnalysis["criteria_breakdown"][1]["criterion"] == "Lexical Resource"
    if task != "task1_academic":
        assert all(m.mistakeType == "Word Choice" for m in feedback.mistakeAnalysis)


@pytest.mark.parametrize("claim", [
    "Cấu trúc câu đơn giản, cần câu phức.",
    "Bài này chủ yếu sử dụng câu đơn.",
    "The current essay only uses simple sentences.",
    "Bài này chưa có câu phức.",
])
@pytest.mark.parametrize("gra", [6, 7, 8])
def test_structure_claims_follow_gra_without_raising_the_band(feedback, claim, gra):
    feedback.criteriaFeedback.grammaticalRange.bandScore = gra
    feedback.sentenceStructureAnalysis = {"current_essay_observation": claim}
    repair_writing_consistency(feedback, "task1_academic")
    assert (feedback.sentenceStructureAnalysis["current_essay_observation"] == claim) == (gra < 7)
    assert feedback.criteriaFeedback.grammaticalRange.bandScore == gra


@pytest.mark.parametrize("claim", [
    "Qua 5 bài trước, cấu trúc câu đơn giản.",
    "Câu này đơn giản; có thể ghép với câu kế tiếp.",
    "Bài có câu phức nhưng cần sử dụng linh hoạt hơn.",
    "Cần thêm câu phức khi so sánh hai nhóm.",
    "Earlier essays only use simple sentences.",
    "Bài này không chỉ sử dụng câu đơn.",
    "Bài này không thiếu câu phức.",
])
def test_specific_advice_and_explicit_history_survive_high_gra(feedback, claim):
    feedback.sentenceStructureAnalysis = {"summary": claim}
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.sentenceStructureAnalysis["summary"] == claim


@pytest.mark.parametrize("claim", [
    "Các cấu trúc câu đơn giản được sử dụng hiệu quả, xen kẽ với câu phức.",
    "Bài này chủ yếu dùng câu đơn nhưng kết hợp tốt với câu phức.",
    "Simple sentences are used effectively alongside complex structures.",
])
@pytest.mark.parametrize("gra", [7, 8])
def test_positive_mixed_structure_observations_survive_high_gra(feedback, claim, gra):
    feedback.criteriaFeedback.grammaticalRange.bandScore = gra
    feedback.sentenceStructureAnalysis = {"summary": claim}
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.sentenceStructureAnalysis["summary"] == claim


@pytest.mark.parametrize("claim", [
    "Cấu trúc câu đơn giản, thiếu đa dạng.",
    "Cấu trúc câu đơn giản, cần đa dạng hơn.",
    "Cấu trúc câu đơn giản, không hiệu quả.",
    "The essay only uses simple sentences and needs more variety.",
])
def test_negated_or_aspirational_range_words_do_not_shield_blanket_claims(feedback, claim):
    feedback.sentenceStructureAnalysis = {"current_essay_observation": claim}
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.sentenceStructureAnalysis["current_essay_observation"] != claim


@pytest.mark.parametrize("claim", [
    "Từ 'informations' là sai dù các số liệu được mô tả chính xác.",
    "Từ 'informations' chưa đúng, các số liệu được mô tả chính xác.",
    "The word 'informations' is wrong, although the figures are accurate.",
    "Mặc dù các số liệu chính xác, từ 'informations' cần sửa thành 'information'.",
])
def test_criticism_of_a_flagged_word_survives_praise_of_something_else(feedback, claim):
    feedback.mistakeAnalysis[2].original = "informations"
    feedback.criteriaFeedback.lexicalResource.feedback = claim
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.criteriaFeedback.lexicalResource.feedback == claim


@pytest.mark.parametrize("claim", [
    "Từ 'informations' được dùng chính xác.",
    "The word 'informations' is used accurately and natural.",
])
def test_explicit_praise_of_a_flagged_word_is_still_removed(feedback, claim):
    feedback.mistakeAnalysis[2].original = "informations"
    feedback.criteriaFeedback.lexicalResource.feedback = claim
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.criteriaFeedback.lexicalResource.feedback != claim


@pytest.mark.parametrize("claim", [
    "Cụm 'levelled off' chưa chính xác.",
    "Cụm 'levelled off' không phù hợp với xu hướng này.",
    "The phrase 'levelled off' is not accurate.",
    "The phrase 'levelled off' is inaccurate and inappropriate.",
    "Thay 'levelled off' bằng 'rose' để mô tả chính xác.",
    "For accurate reporting, replace 'levelled off' with 'rose'.",
    "Ở bài trước, em dùng 'levelled off' chính xác.",
    "Trong bản sửa, 'levelled off' phù hợp với câu mới.",
    "Em dùng 'rose' phù hợp; tuy nhiên 'levelled off' chưa chính xác.",
    "Em dùng 'levelled office' phù hợp.",
])
def test_criticism_contrasts_and_other_phrases_are_preserved(feedback, claim):
    feedback.criteriaFeedback.lexicalResource.feedback = claim
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.criteriaFeedback.lexicalResource.feedback == claim


@pytest.mark.parametrize("explanation", [
    "Mô tả sai so với số liệu biểu đồ.",
    "Xu hướng không chính xác: khoảng cách tăng.",
    "The comparison contradicts the chart data.",
    "Incorrect figures are reported here.",
])
def test_data_errors_have_a_separate_type(feedback, explanation):
    feedback.mistakeAnalysis[0].explanation = explanation
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.mistakeAnalysis[0].mistakeType == "Data Accuracy"


def test_real_word_choice_and_internal_logic_errors_are_preserved(feedback):
    item = feedback.coherenceAnalysis[0]
    item.issue = "Mâu thuẫn logic"
    item.explanation = "Hai câu trong bài phủ định lẫn nhau."
    feedback.mistakeAnalysis[0].explanation = "Dùng sai collocation khi mô tả biểu đồ."
    before = item.model_dump()
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.mistakeAnalysis[0].mistakeType == "Word Choice"
    assert item.model_dump() == before


def test_negated_data_criticism_and_empty_optional_sections_are_unchanged(feedback):
    from models.writing_feedback import CounterargumentAnalysis

    feedback.mistakeAnalysis[0].explanation = "Không sai số liệu, nhưng collocation chưa tự nhiên."
    feedback.counterargumentAnalysis = CounterargumentAnalysis()
    feedback.criteriaFeedback.coherenceCohesion.feedback = ""
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.mistakeAnalysis[0].mistakeType == "Word Choice"
    assert feedback.counterargumentAnalysis.feedback == ""
    assert feedback.criteriaFeedback.coherenceCohesion.feedback == ""


@pytest.mark.parametrize("sections", [
    {"sentenceStructureAnalysis": None, "bandTrajectoryAnalysis": None, "recurringPatterns": None},
    {"sentenceStructureAnalysis": {}, "bandTrajectoryAnalysis": {}, "recurringPatterns": {}},
    {"sentenceStructureAnalysis": {"sentenceUpgrades": [], "common_issues": []},
     "bandTrajectoryAnalysis": {"criteria_breakdown": []}},
    {"sentenceStructureAnalysis": {"summary": None, "current_essay_observation": [], "custom": {}},
     "bandTrajectoryAnalysis": {"criteria_breakdown": [None, [], 7, {}], "summary": {"custom": []}}},
], ids=["null", "empty-dicts", "empty-lists", "free-form-dicts"])
def test_optional_analysis_shapes_preserve_unknown_data_and_still_repair(feedback, sections):
    for name, value in sections.items():
        setattr(feedback, name, deepcopy(value))
    feedback.keyTakeaways.strengths = []
    feedback.coherenceAnalysis = []
    feedback.ideaDevelopmentAnalysis = []
    before = deepcopy(sections)

    repair_writing_consistency(feedback, "task1_academic")

    assert {name: getattr(feedback, name) for name in sections} == before
    assert feedback.criteriaFeedback.mainCriterion.title == "Task Achievement"
    assert feedback.mistakeAnalysis[0].mistakeType == "Data Accuracy"
    assert "levelled off" not in feedback.criteriaFeedback.lexicalResource.feedback
    assert "18–30-year-olds" in feedback.improvedEssay


def test_unaffected_multiline_feedback_is_preserved_verbatim(feedback):
    text = "Đoạn mở đầu rõ ràng.\n\nCác đoạn thân bài được nhóm tốt."
    feedback.criteriaFeedback.coherenceCohesion.feedback = text
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.criteriaFeedback.coherenceCohesion.feedback == text


def test_pattern_denials_are_scoped_and_do_not_overwrite_history(feedback):
    feedback.recurringPatterns["summary"] = "Chưa có pattern lặp lại."
    feedback.sentenceStructureAnalysis["common_issues"] = [{"pattern": "run-on", "count": 3}]
    original = deepcopy(feedback.sentenceStructureAnalysis["common_issues"])
    repair_writing_consistency(feedback, "task1_academic")
    assert "Chưa có pattern" not in feedback.recurringPatterns["summary"]
    assert "Chưa có pattern" not in feedback.sentenceStructureAnalysis["summary"]
    assert feedback.sentenceStructureAnalysis["common_issues"] == original


@pytest.mark.parametrize("key,claim", [
    ("current_essay_observation", "Bài này không có lỗi cấu trúc câu lặp lại."),
    ("summary", "Bài này không có lỗi cấu trúc câu lặp lại như các bài trước."),
    ("current_essay_observation", "Không có lỗi cấu trúc câu lặp lại."),
])
def test_current_essay_improvement_survives_historical_structure_errors(feedback, key, claim):
    # Codex r4421525860: common_issues is copied from previous essays, so it
    # cannot contradict a claim that the current essay no longer repeats them.
    feedback.sentenceStructureAnalysis["common_issues"] = [{"pattern": "run-on", "count": 3}]
    feedback.sentenceStructureAnalysis[key] = claim
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.sentenceStructureAnalysis[key] == claim


@pytest.mark.parametrize("key,claim", [
    ("summary", "Các bài trước không có lỗi cấu trúc câu lặp lại."),
    ("current_essay_observation", "Các bài trước không có lỗi cấu trúc câu lặp lại."),
    ("summary", "Không có lỗi cấu trúc câu lặp lại."),
])
def test_stale_denials_of_historical_structure_errors_are_still_removed(feedback, key, claim):
    feedback.sentenceStructureAnalysis["common_issues"] = [{"pattern": "run-on", "count": 3}]
    feedback.sentenceStructureAnalysis[key] = claim
    repair_writing_consistency(feedback, "task1_academic")
    assert "lặp lại" not in feedback.sentenceStructureAnalysis[key]


@pytest.mark.parametrize("claim", [
    "Cấu trúc câu chủ yếu đơn giản.",
    "Em chủ yếu dùng câu đơn.",
])
@pytest.mark.parametrize("gra", [7, 8])
def test_history_summary_of_simple_range_survives_high_gra(feedback, claim, gra):
    # Codex r4421899085: summary is the five-essay overview, so an unscoped
    # low-range sentence there describes history, not the current GRA 7+ essay.
    feedback.criteriaFeedback.grammaticalRange.bandScore = gra
    feedback.sentenceStructureAnalysis = {
        "summary": claim,
        "current_essay_observation": "Bài này dùng nhiều câu phức hiệu quả.",
    }
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.sentenceStructureAnalysis["summary"] == claim


@pytest.mark.parametrize("key,claim", [
    ("summary", "Bài này chủ yếu sử dụng câu đơn."),
    ("summary", "The current essay only uses simple sentences."),
    ("current_essay_observation", "Cấu trúc câu chủ yếu đơn giản."),
    ("current_essay_observation", "Em chủ yếu dùng câu đơn."),
])
def test_blanket_current_essay_range_claims_are_still_removed_at_high_gra(feedback, key, claim):
    feedback.sentenceStructureAnalysis = {key: claim}
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.sentenceStructureAnalysis[key] != claim


@pytest.mark.parametrize("claim,warning", [
    ("Cụm 'levelled off' phù hợp, nhưng số liệu trong câu này sai và cần kiểm tra lại.",
     "số liệu trong câu này sai"),
    ("Cụm 'levelled off' phù hợp; tuy nhiên xu hướng không khớp với số liệu biểu đồ.",
     "không khớp với số liệu"),
    ("Cụm 'levelled off' tự nhiên, nhưng em nên kiểm tra lại con số năm 2010.",
     "nên kiểm tra lại con số"),
    ("The phrase 'levelled off' is appropriate, but the figures in this sentence are wrong.",
     "figures in this sentence are wrong"),
])
@pytest.mark.parametrize("field", ["overallBandScoreSummary", "lexicalResource"])
def test_warning_in_a_sentence_with_flagged_praise_is_never_dropped(feedback, claim, warning, field):
    # Codex r4421899092: praise of a flagged phrase in one clause must not
    # delete an independent warning in another clause of the same sentence.
    if field == "lexicalResource":
        feedback.criteriaFeedback.lexicalResource.feedback = claim
    else:
        feedback.overallBandScoreSummary = claim
    repair_writing_consistency(feedback, "task1_academic")
    result = (feedback.criteriaFeedback.lexicalResource.feedback if field == "lexicalResource"
              else feedback.overallBandScoreSummary)
    assert warning in result


def test_warning_in_a_strength_with_flagged_praise_is_never_dropped(feedback):
    claim = "Cụm 'levelled off' phù hợp, nhưng số liệu trong câu này sai."
    feedback.keyTakeaways.strengths = [claim, "Overview rõ ràng."]
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.keyTakeaways.strengths == [claim, "Overview rõ ràng."]


@pytest.mark.parametrize("claim", [
    "Cụm 'levelled off' phù hợp và tự nhiên.",
    "Cụm 'levelled off' phù hợp, nhưng 'the gap narrowed' cũng rất tự nhiên.",
    "Cụm 'levelled off' phù hợp. Số liệu trong câu này sai.",
])
def test_praise_only_sentences_of_flagged_phrases_are_still_removed(feedback, claim):
    feedback.overallBandScoreSummary = claim
    repair_writing_consistency(feedback, "task1_academic")
    assert "levelled off" not in feedback.overallBandScoreSummary
    if "sai" in claim:
        assert feedback.overallBandScoreSummary == "Số liệu trong câu này sai."


def test_unscoped_denial_cannot_hide_known_lexical_patterns_when_syntax_history_is_absent(feedback):
    feedback.sentenceStructureAnalysis = {"summary": "Chưa có pattern lặp lại."}
    repair_writing_consistency(feedback, "task1_academic")
    assert "Chưa có pattern" not in feedback.sentenceStructureAnalysis["summary"]
    assert feedback.recurringPatterns["stillRecurring"] == ["Word Choice (9 lần)"]


@pytest.mark.parametrize("text,expected", [
    ("18-30 year olds", "18–30-year-olds"),
    ("18–30 year-olds", "18–30-year-olds"),
    ("18-30-year-olds", "18–30-year-olds"),
    ("18–30-year-olds", "18–30-year-olds"),
    ("30 years old", "30 years old"),
    ("an 18-year-old learner", "an 18-year-old learner"),
])
def test_age_group_nouns_are_fixed_only_in_rewrite(feedback, text, expected):
    feedback.improvedEssay = text
    feedback.mistakeAnalysis[0].original = text
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.improvedEssay == expected
    assert feedback.mistakeAnalysis[0].original == text


@pytest.mark.parametrize("version", ["v1", "v2"])
@pytest.mark.parametrize("level", [1, 2, 3, 4, 5])
def test_consistency_prompt_reaches_every_supported_level(version, level):
    prompt = WritingPromptLoader(version).load(level)
    for instruction in ("Internal consistency check", 'mistakeType: "Data Accuracy"',
                        "criteria_breakdown", "GRA 7+", "18–30-year-olds"):
        assert instruction in prompt


@pytest.mark.parametrize("task", ["task1_academic", "task1_general", "task2"])
def test_history_prompt_uses_current_task_label_without_mutating_the_aggregate(task):
    trajectory = {"essays_analyzed": 5, "average_last_5": 6.7, "trend": "stable", "trend_delta": 0,
                  "criteria_breakdown": [{"criterion": "Task Response", "average": 6.7, "trend": "stable"}]}
    before = deepcopy(trajectory)
    prompt = format_history_for_prompt(None, trajectory, task_type=task)
    label = "Task Achievement" if task.startswith("task1") else "Task Response"
    assert f"{label}: average 6.7, trend stable" in prompt
    if task.startswith("task1"):
        assert "Task Response" not in prompt
    assert trajectory == before
