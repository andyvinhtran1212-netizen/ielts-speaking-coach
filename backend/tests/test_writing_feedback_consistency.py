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


@pytest.mark.parametrize("explanation", [
    "Đây không phải là lỗi sai số liệu mà là lỗi dùng từ.",
    "Day khong phai la loi sai so lieu ma la loi dung tu.",
    "Không phải sai số liệu, mà là collocation chưa tự nhiên.",
    "Cụm từ không làm sai số liệu nhưng chưa tự nhiên.",
    "Cum tu khong lam sai so lieu nhung chua tu nhien.",
    "This is not an incorrect data issue but a word-choice error.",
])
def test_data_error_negated_within_its_clause_keeps_word_choice(feedback, explanation):
    # Codex r4422064967: negation separated from the data phrase by a few words
    # in the same clause still denies the data error.
    feedback.mistakeAnalysis[2].explanation = explanation
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.mistakeAnalysis[2].mistakeType == "Word Choice"
    assert feedback.mistakeAnalysis[2].criterion == "Lexical Resource"


@pytest.mark.parametrize("explanation", [
    "Cụm từ không chỉ sai số liệu mà còn chưa tự nhiên.",
    "Cum tu khong chi sai so lieu ma con chua tu nhien.",
    "The phrase is not only inaccurate data but also informal.",
    "Không chỉ sai số liệu, câu còn chưa tự nhiên.",
    "Cụm từ không những sai số liệu mà còn chưa tự nhiên.",
    "The phrase is not just inaccurate data but also informal.",
    "The phrase is not merely inaccurate data but also informal.",
    "The phrase isn't only inaccurate data but also informal.",
], ids=["cr-vietnamese", "cr-unaccented", "cr-english", "cr-leading",
        "khong-nhung", "not-just", "not-merely", "contraction"])
def test_additive_data_errors_are_relabelled(feedback, explanation):
    # Codex r4423566302: "not only X but also Y" affirms both criticisms.
    mistake = feedback.mistakeAnalysis[2]
    mistake.explanation = explanation
    repair_writing_consistency(feedback, "task1_academic")
    assert mistake.mistakeType == "Data Accuracy"
    assert mistake.criterion == "Task Achievement"
    assert mistake.explanation == explanation


@pytest.mark.parametrize("explanation", [
    "Cụm từ bị đánh dấu không chỉ vì sai số liệu mà còn vì chưa tự nhiên.",
    "Cum tu bi danh dau khong chi vi sai so lieu ma con vi chua tu nhien.",
    "Cụm từ bị đánh dấu không chỉ do sai số liệu mà còn do collocation.",
    "Cụm từ bị đánh dấu không những vì sai số liệu mà còn vì collocation.",
    "The phrase is flagged not only because the figures are wrong but also for word choice.",
    "The phrase is flagged not just because the figures are wrong but also for word choice.",
    "The phrase is flagged not merely because the figures are wrong but also for word choice.",
    "The criticism isn't only because the figures are wrong but also because the wording is informal.",
], ids=["khong-chi-vi", "unaccented", "khong-chi-do", "khong-nhung-vi",
        "not-only-because", "not-just-because", "not-merely-because", "contraction"])
def test_additive_cause_still_affirms_data_error(feedback, explanation):
    mistake = feedback.mistakeAnalysis[2]
    mistake.explanation = explanation
    repair_writing_consistency(feedback, "task1_academic")
    assert mistake.mistakeType == "Data Accuracy"
    assert mistake.criterion == "Task Achievement"
    assert mistake.explanation == explanation


@pytest.mark.parametrize("explanation", [
    "Số liệu này sai.",
    "So lieu nay sai.",
    "Đây không phải lỗi dùng từ mà là lỗi sai số liệu.",
    "Day khong phai loi dung tu ma la loi sai so lieu.",
    "Collocation không tự nhiên và sai số liệu biểu đồ.",
    "Không chỉ dùng từ chưa tự nhiên mà còn sai số liệu.",
    "This is not a word-choice issue but the figures are wrong.",
])
def test_data_error_outside_the_negated_clause_is_still_relabelled(feedback, explanation):
    feedback.mistakeAnalysis[2].explanation = explanation
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.mistakeAnalysis[2].mistakeType == "Data Accuracy"
    assert feedback.mistakeAnalysis[2].criterion == "Task Achievement"


@pytest.mark.parametrize("explanation", [
    "Em không đọc kỹ nên sai số liệu năm 2010.",
    "Em khong doc ky nen sai so lieu nam 2010.",
    "Không cẩn thận nên sai số liệu.",
    "Em không để ý chú thích vì số liệu bị sai.",
    "Em không xem chú thích do đó sai số liệu.",
    "The writer does not notice that the figures are wrong.",
    "The student did not check the axis so the data is wrong.",
])
def test_causal_link_ends_the_negation_before_a_data_error(feedback, explanation):
    # CR P3 (PR-2053 re-review 3): "nên/vì/do/so/because/that" start a new
    # clause, so the negated verb before them does not deny the data error.
    feedback.mistakeAnalysis[2].explanation = explanation
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.mistakeAnalysis[2].mistakeType == "Data Accuracy"
    assert feedback.mistakeAnalysis[2].criterion == "Task Achievement"


@pytest.mark.parametrize("explanation", [
    "Không phải do sai số liệu mà do collocation.",
    "Không phải vì số liệu sai, mà vì collocation chưa tự nhiên.",
    "Đây không phải là lỗi do sai số liệu.",
    "This is not because the figures are wrong; the collocation is unnatural.",
    "It is not that the data is wrong; the verb is unnatural.",
])
def test_negation_that_governs_the_cause_still_denies_the_data_error(feedback, explanation):
    feedback.mistakeAnalysis[2].explanation = explanation
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.mistakeAnalysis[2].mistakeType == "Word Choice"
    assert feedback.mistakeAnalysis[2].criterion == "Lexical Resource"


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


@pytest.mark.parametrize("key,claim", [
    ("summary", "Bài này và các bài trước đều không có lỗi cấu trúc câu lặp lại."),
    ("current_essay_observation", "Bài này và các bài trước đều không có lỗi cấu trúc câu lặp lại."),
    ("summary", "Cả bài này lẫn các bài trước đều không có lỗi cấu trúc câu lặp lại."),
    ("current_essay_observation",
     "This essay and the previous essays have no repeated errors in sentence structure."),
])
def test_joint_current_and_history_denials_are_removed_when_history_has_errors(feedback, key, claim):
    # CR P3 (PR-2053 re-review 2): naming the current essay does not license
    # the same sentence's denial about previous essays that common_issues lists.
    feedback.sentenceStructureAnalysis["common_issues"] = [{"pattern": "run-on", "count": 3}]
    feedback.sentenceStructureAnalysis[key] = claim
    repair_writing_consistency(feedback, "task1_academic")
    assert "lặp lại" not in feedback.sentenceStructureAnalysis[key]
    assert "repeated" not in feedback.sentenceStructureAnalysis[key]


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


@pytest.mark.parametrize("key,claim,expected", [
    ("current_essay_observation", "Bài này chủ yếu sử dụng câu đơn; lỗi hòa hợp chủ vị ở đoạn 2 cần sửa.",
     "Lỗi hòa hợp chủ vị ở đoạn 2 cần sửa."),
    ("current_essay_observation", "Lỗi mạo từ ở đoạn 1 cần sửa, nhưng bài này chủ yếu dùng câu đơn.",
     "Lỗi mạo từ ở đoạn 1 cần sửa."),
    ("summary", "This essay only uses simple sentences; the article errors in paragraph 2 need fixing.",
     "The article errors in paragraph 2 need fixing."),
    ("current_essay_observation", "Bài này chủ yếu dùng câu đơn. Lỗi hòa hợp chủ vị cần sửa.",
     "Lỗi hòa hợp chủ vị cần sửa."),
    ("current_essay_observation", "Bài này đã có câu phức; các bài trước chỉ dùng câu đơn.",
     "Bài này đã có câu phức; các bài trước chỉ dùng câu đơn."),
    ("current_essay_observation", "Mặc dù bài này chủ yếu dùng câu đơn.",
     "Tham khảo các lỗi và gợi ý cụ thể trong phần phân tích."),
])
@pytest.mark.parametrize("gra", [7, 8])
def test_high_gra_removes_only_the_low_range_clause(feedback, key, claim, expected, gra):
    # Codex r4422256128: an independent warning sharing the sentence with a
    # blanket low-range clause survives; a history clause is not current.
    feedback.criteriaFeedback.grammaticalRange.bandScore = gra
    feedback.sentenceStructureAnalysis = {key: claim}
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.sentenceStructureAnalysis[key] == expected


@pytest.mark.parametrize("claim", [
    "Em không biết nên chỉ dùng câu đơn.",
    "Không may là em chủ yếu dùng câu đơn.",
])
def test_causal_link_or_unfortunately_does_not_shield_a_low_range_claim(feedback, claim):
    # CR P3 (PR-2053 re-review 3): neither "không ... nên" nor "không may"
    # (unfortunately) negates the low-range claim that follows.
    feedback.sentenceStructureAnalysis = {"current_essay_observation": claim}
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.sentenceStructureAnalysis["current_essay_observation"] != claim


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


@pytest.mark.parametrize("claim", [
    "Cụm 'levelled off' phù hợp, nhưng em không cần thay đổi gì.",
    "Cum 'levelled off' phu hop, nhung em khong can thay doi gi.",
    "Cụm 'levelled off' rất tự nhiên; bài viết không có lỗi từ vựng nào.",
    "The phrase 'levelled off' is natural and you can reuse it.",
    "The phrase 'levelled off' is appropriate; you don't need to change it.",
])
def test_reassurance_does_not_revive_praise_of_flagged_phrases(feedback, claim):
    # CR P3 (PR-2053 re-review 2): "không cần", "không có lỗi" and English
    # "can" (the de-accented spelling of "cần") are not warnings.
    feedback.overallBandScoreSummary = claim
    repair_writing_consistency(feedback, "task1_academic")
    assert "levelled off" not in feedback.overallBandScoreSummary


@pytest.mark.parametrize("claim,warning", [
    ("Cụm 'levelled off' phù hợp, nhưng em cần kiểm tra lại số liệu.", "cần kiểm tra lại"),
    ("Cum 'levelled off' phu hop, nhung em can kiem tra lai so lieu.", "can kiem tra lai"),
    ("Cụm 'levelled off' phù hợp, nhưng em cần dùng thêm câu phức.", "cần dùng thêm"),
    ("Cụm 'levelled off' tự nhiên; bài viết không có lỗi nào ngoài việc sai số liệu năm 2010.",
     "sai số liệu"),
    ("Cụm 'levelled off' phù hợp, nhưng em không nên lặp lại nó quá nhiều.", "không nên"),
    ("Cụm 'levelled off' phù hợp, nhưng câu này chưa rõ ràng.", "chưa rõ ràng"),
    ("The phrase 'levelled off' is natural, but you need to check the 2010 figure.", "need to check"),
])
def test_real_warnings_beside_reassurance_words_are_kept(feedback, claim, warning):
    feedback.overallBandScoreSummary = claim
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.overallBandScoreSummary == claim
    assert warning in feedback.overallBandScoreSummary


def test_unscoped_denial_cannot_hide_known_lexical_patterns_when_syntax_history_is_absent(feedback):
    feedback.sentenceStructureAnalysis = {"summary": "Chưa có pattern lặp lại."}
    repair_writing_consistency(feedback, "task1_academic")
    assert "Chưa có pattern" not in feedback.sentenceStructureAnalysis["summary"]
    assert feedback.recurringPatterns["stillRecurring"] == ["Word Choice (9 lần)"]


@pytest.mark.parametrize("still,summary", [
    (["Word Choice (9 lần)"], "Không có lỗi ngữ pháp lặp lại."),
    (["Word Choice (9 lần)"], "Không có lỗi ngữ pháp lặp lại; lỗi dùng từ vẫn xuất hiện."),
    (["Word Choice (9 lần)"], "No recurring errors in grammar; word choice still repeats."),
    (["Lỗi hòa hợp chủ vị"], "Không có lỗi từ vựng lặp lại; lỗi hòa hợp chủ vị vẫn còn."),
])
def test_recurring_denial_of_another_error_type_is_kept(feedback, still, summary):
    # Codex r4422256138: a denial about grammar does not contradict lexical
    # errors that still recur, and the affirmative clause beside it stays.
    feedback.recurringPatterns = {"summary": summary, "improvements": [], "stillRecurring": still}
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.recurringPatterns["summary"] == summary
    assert feedback.recurringPatterns["stillRecurring"] == still


@pytest.mark.parametrize("still,summary,expected", [
    (["Word Choice (9 lần)"], "Không có lỗi dùng từ lặp lại.", "Các mẫu lỗi còn lặp lại được liệt kê bên dưới."),
    (["Word Choice (9 lần)"], "Không có lỗi ngữ pháp hay từ vựng lặp lại.",
     "Các mẫu lỗi còn lặp lại được liệt kê bên dưới."),
    (["Word Choice (9 lần)"], "Không có lỗi lặp lại.", "Các mẫu lỗi còn lặp lại được liệt kê bên dưới."),
    (["Word Choice (9 lần)"], "Không có lỗi lặp lại; em tiến bộ rõ.", "Em tiến bộ rõ."),
    (["Subject-verb agreement"], "Không có lỗi ngữ pháp lặp lại.",
     "Các mẫu lỗi còn lặp lại được liệt kê bên dưới."),
    (["Word Choice (9 lần)"], "Em tiến bộ về ngữ pháp. No recurring errors in vocabulary.",
     "Em tiến bộ về ngữ pháp."),
])
def test_recurring_denial_of_a_listed_error_type_is_still_removed(feedback, still, summary, expected):
    feedback.recurringPatterns = {"summary": summary, "improvements": [], "stillRecurring": still}
    repair_writing_consistency(feedback, "task1_academic")
    assert feedback.recurringPatterns["summary"] == expected
    assert feedback.recurringPatterns["stillRecurring"] == still


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
