"""Regression cohort: original evidence vs proposals, plus paid retry outcomes."""
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from models.writing_feedback import GraderConfig, Pass2Refinement, Pass3Rewrites, WritingFeedback
from services import ai_usage_logger as ledger
from services import gemini_writing_grader as grader_module
from services.writing_feedback_grounding import (
    UngroundedWritingFeedbackError, validate_writing_grounding,
)
from tests.test_gemini_writing_grader import VALID_FEEDBACK


ESSAY = "Governments should invest in dedicated bus lanes and employment centres. Discounted tickets can help students."
BAD_CLAIM = "Từ vựng chính xác. Em sử dụng tự nhiên các cụm từ như 'dedicated bus lanes', 'employment centres', 'subsidies' mà không gượng ép."


def feedback(claim="Em dùng 'dedicated bus lanes' phù hợp."):
    data = copy.deepcopy(VALID_FEEDBACK)
    data["mistakeAnalysis"] = []
    data["criteriaFeedback"]["lexicalResource"]["feedback"] = claim
    data["improvedEssay"] = "Targeted subsidies could support low-income families."
    return WritingFeedback(**data)


@pytest.mark.parametrize("claim", [
    BAD_CLAIM,
    "Em nên tiếp tục sử dụng 'subsidies'.",
    "Em có thể duy trì cách dùng 'subsidies'.",
    "Em nên phát huy vốn từ như 'subsidies'.",
    "You should continue using 'subsidies'.",
    "You could keep using 'subsidies'.",
    "Em nên trả lời 'như thế nào', nhưng em đã dùng 'subsidies' rất tốt.",
    "Em sử dụng 'NHƯ THẾ NÀO' chính xác.",
    "Em dùng 'subsidies\nsupport' phù hợp.",
    "Em dùng 'Governments ... subsidies' phù hợp.",
    "Em dùng 'employment centres ... dedicated bus lanes' phù hợp.",
    'Em dùng “subsidies” rất chính xác.',
    'Em dùng `subsidies` rất chính xác.',
    'Em dùng ‘subsidies’ rất chính xác.',
    "Em có thể dùng 'support', nhưng em đã dùng 'subsidies' tự nhiên.",
    "You used 'could' and 'subsidies' effectively.",
])
def test_rejects_rewrite_language_attributed_to_original(claim):
    with pytest.raises(UngroundedWritingFeedbackError) as caught:
        validate_writing_grounding(feedback(claim), ESSAY + ' They could improve services.')
    assert caught.value.issues
    assert "subsidies" not in str(caught.value)  # operational logs exclude prose


@pytest.mark.parametrize("claim,essay", [
    ("Em dùng 'dedicated bus lanes' phù hợp.", ESSAY),
    ("Em nên tiếp tục sử dụng 'dedicated bus lanes'.", ESSAY),
    ("Cần dùng 'however' để nối hai ý.", ESSAY),
    ("You need to use 'however' to link the ideas.", ESSAY),
    ("Em chưa trả lời câu hỏi 'NHƯ THẾ NÀO'.", ESSAY),
    ("The argument does not answer 'WHY'.", ESSAY),
    ("Em dùng 'Governments should… employment centres.' phù hợp.", ESSAY),
    ("Em dùng 'Discounted tickets...' phù hợp.", ESSAY),
    ("Em dùng 'EMPLOYMENT  CENTRES' phù hợp.", ESSAY),
    ("Em dùng “John's school” phù hợp.", "John’s school is nearby."),
    ("Em dùng 'John's school' phù hợp.", "John’s school is nearby."),
    ("Em dùng 'students' work' phù hợp.", "The students' work is useful."),
    ("Em dùng ‘John’s school’ phù hợp.", "John's school is nearby."),
    ("Em dùng ‘students’ work’ phù hợp.", "The students' work is useful."),
    ("Em có thể dùng 'subsidies' để nâng cấp cách diễn đạt.", ESSAY),
    ("Bài chưa sử dụng 'subsidies'.", ESSAY),
    ("You could use 'subsidies' or 'financial support'.", ESSAY),
    ("Replace 'discounted tickets' with 'targeted subsidies'.", ESSAY),
    ("Thay 'discounted tickets' bằng 'targeted subsidies'.", ESSAY),
])
def test_preserves_real_quotes_and_explicit_proposals(claim, essay):
    result = feedback(claim)
    before = result.model_dump()
    validate_writing_grounding(result, essay)
    assert result.model_dump() == before  # no text edits or score manipulation


def test_shipped_l3_calibration_question_is_not_learner_vocabulary():
    from pathlib import Path
    import re
    calibration = (Path(__file__).parents[1] / "prompts/writing/v2/calibration/l3_examples.md").read_text()
    items = json.loads(re.search(r"```json\n(.*?)\n```", calibration, re.S).group(1))
    data = feedback().model_dump()
    data["ideaDevelopmentAnalysis"] = items
    # Original ideas and 'studies show' occur here; the teaching question does not.
    essay = ESSAY + " Technology helps students learn faster. Studies show online learning is effective."
    validate_writing_grounding(WritingFeedback(**data), essay)


def test_word_boundaries_prevent_substring_evidence():
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(feedback("Em dùng 'bus' phù hợp."), "Business is important.")


@pytest.mark.parametrize("claim", [
    "Em nêu số liệu mà chỉ gọi chung là 'the group' thay vì nhóm 'twice a year'.",
    "Quên gọi tên nhóm 'twice a year', khiến số liệu thiếu nhãn.",
    "Bỏ sót tên nhóm danh mục 'Twice a year'.",
    "Cần định danh chính xác là 'twice a year' để phân biệt với nhóm khác.",
    "Em viết 'the group' chung chung, không rõ là nhóm 'Twice a year'.",
    "Em nhầm lẫn giữa tính từ 'dayly' với trạng từ 'daily'.",
    "Cần phân biệt giữa 'dayly' và 'daily'.",
])
def test_missing_task_labels_and_correction_contrasts_are_not_source_claims(claim):
    # Synthetic Task 1 cohort: the missing label and corrected spelling are
    # reference language, not words attributed to the learner's original.
    essay = "The group increased to 15 percent. They visit dayly."
    data = feedback().model_dump()
    data["criteriaFeedback"]["lexicalResource"]["feedback"] = claim
    data["keyTakeaways"]["areasForImprovement"] = [claim]
    data["ideaDevelopmentAnalysis"] = [{
        "paragraph": 1,
        "originalIdea": "The group increased to 15 percent.",
        "issue": claim, "explanation": claim,
        "suggestion": {"instruction": "Name the category.", "example": "The twice-a-year group increased."},
    }]
    data["coherenceAnalysis"] = [{
        "location": "Paragraph 1", "issue": claim, "explanation": claim,
        "suggestion": {"instruction": "Name the category.", "example": "The twice-a-year group increased."},
    }]
    result = WritingFeedback(**data)
    before = result.model_dump()
    validate_writing_grounding(result, essay)
    assert result.model_dump() == before


@pytest.mark.parametrize("claim", [
    "Em quên gọi tên nhóm, nhưng em đã dùng 'subsidies' chính xác.",
    "Cần định danh nhóm. Em dùng 'subsidies' hiệu quả.",
    "Em phân biệt giữa các nhóm; em đã viết 'subsidies'.",
    "Thay vì dùng từ chung chung, em đã dùng 'subsidies' chính xác.",
    "Không rõ là nhóm nào, nhưng em dùng 'subsidies' phù hợp.",
])
def test_reference_context_does_not_override_a_later_learner_attribution(claim):
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(feedback(claim), ESSAY)


def test_reference_context_cannot_hide_unsupported_strength_or_original():
    result = feedback()
    result.keyTakeaways.strengths = ["Phân biệt giữa 'subsidies' và 'support'."]
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(result, ESSAY)


@pytest.mark.parametrize("claim", [
    "Trong biểu đồ, nhóm 12% là nhóm 'twice a year'.",
    "Dữ liệu 12% thuộc về nhóm 'twice a year', nhưng bài thiếu tên nhóm.",
    "Em mô tả nhóm 'twice a year' nhưng lại gọi chung là 'the group'.",
    "Câu chuyển sang một nhóm không tên ('twice a year').",
    "Khi chưa giới thiệu rõ nhóm 'twice a year', số liệu sẽ khó hiểu.",
])
def test_task1_labels_have_a_reference_role_not_a_learner_wording_role(claim):
    essay = "The group increased to 15 percent."
    validate_writing_grounding(feedback(claim), essay, task_type="task1_academic")


@pytest.mark.parametrize("claim,task", [
    ("Trong biểu đồ, nhóm 'invented category' tăng.", "task2"),
    ("Em đã dùng nhóm 'invented category' chính xác.", "task1_academic"),
    ("Trong biểu đồ, em đã dùng 'invented category' chính xác.", "task1_academic"),
    ("Trong biểu đồ, bài viết gọi nhóm này là 'invented category'.", "task1_academic"),
    ("Trong biểu đồ, bài viết gọi là nhóm 'invented category'.", "task1_academic"),
    ("Trong biểu đồ, bài làm này dùng nhóm 'invented category'.", "task1_academic"),
    ("The essay calls this group 'invented category'.", "task1_academic"),
])
def test_task_reference_never_exempts_explicit_learner_wording(claim, task):
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(feedback(claim), ESSAY, task_type=task)


@pytest.mark.parametrize("pattern", ["before + V-ing", "before/after + V-ing", "The share was X in Y, then rose to Z"])
def test_abstract_grammar_descriptions_are_not_literal_quotes(pattern):
    claim = f"Bài có mẫu câu dạng '{pattern}'."
    result = feedback(claim)
    result.keyTakeaways.strengths = [claim]
    result.sentenceStructureAnalysis = {"current_essay_observation": claim}
    validate_writing_grounding(result, "The share fell before rising in 2015.")


def test_grammar_notation_does_not_relax_original_excerpt_validation():
    data = feedback().model_dump()
    data["mistakeAnalysis"] = [{
        "original": "before + V-ing", "mistakeType": "Grammar",
        "explanation": "Fix the clause.", "suggestion": "A suggested rewrite.",
        "criterion": "Grammatical Range and Accuracy",
    }]
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(WritingFeedback(**data), ESSAY)


@pytest.mark.parametrize("source_field", ["originalIdea", "location"])
def test_grammar_notation_does_not_relax_source_idea_or_location(source_field):
    data = feedback().model_dump()
    source = "Cấu trúc 'S + V-ing'"
    suggestion = {"instruction": "Clarify the source.", "example": "A proposed sentence."}
    if source_field == "originalIdea":
        data["ideaDevelopmentAnalysis"] = [{
            "paragraph": 1, "originalIdea": source, "issue": "Issue",
            "explanation": "Explanation", "suggestion": suggestion,
        }]
    else:
        data["coherenceAnalysis"] = [{
            "location": source, "issue": "Issue", "explanation": "Explanation",
            "suggestion": suggestion,
        }]
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(WritingFeedback(**data), ESSAY)


@pytest.mark.parametrize("claim", [
    "Cụm 'Looking back' dùng sai nghĩa của phrasal verb 'look back'.",
    "Cụm 'Looking back' chưa phù hợp để 'look back' ở đây.",
    "Cụm 'Looking back' chưa phù hợp để 'nhìn lại' ở đây.",
    "Em dùng 'dayly' thay cho trạng từ 'daily'.",
])
def test_grounded_lemma_translation_and_correction_contrasts(claim):
    validate_writing_grounding(feedback(claim), "Looking back was unnecessary. They visit dayly.")


@pytest.mark.parametrize("claim", [
    "Cụm 'Walking away' dùng sai nghĩa của phrasal verb 'turn back'.",
    "Cụm 'Walking away' có vấn đề; em đã dùng 'quay lại' tốt.",
    "Dùng sai nghĩa của phrasal verb 'turn back'.",
])
def test_gloss_context_requires_a_grounded_source_and_lemma(claim):
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(feedback(claim), "Walking away was unnecessary.")


def test_source_fields_checked_but_suggestions_and_history_preserved():
    result = feedback()
    data = result.model_dump()
    data["lexicalAnalysis"] = {"wordsToUpgrade": [{
        "original": "Discounted tickets", "context": "Discounted tickets can help students.",
        "suggestions": ["targeted subsidies"], "category": "Precision",
    }]}
    data["sentenceStructureAnalysis"] = {
        "sentenceUpgrades": [{"original": "Discounted tickets can help students.",
                              "rewritten": "Targeted subsidies benefit vulnerable families."}],
        "common_issues": [{"examples": ["I used subsidies in an earlier essay."]}],
    }
    result = WritingFeedback(**data)
    validate_writing_grounding(result, ESSAY)
    result.lexicalAnalysis.wordsToUpgrade[0].original = "subsidies"
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(result, ESSAY)


@pytest.mark.parametrize("schema,payload", [
    (Pass2Refinement, {"added_mistakes": [{"original": "Invented source phrase", "mistakeType": "Word choice",
        "explanation": "Wrong", "suggestion": "A new proposal", "criterion": "Lexical Resource"}]}),
    (Pass3Rewrites, {"sentence_rewrites": [{"original_sentence": "Invented source phrase", "rewritten_sentence": "A new proposal"}]}),
])
def test_deep_passes_cannot_reintroduce_unsupported_originals(schema, payload):
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(schema(**payload), ESSAY)


def setup_provider(monkeypatch, responses):
    calls, rows = [], []
    # Other tests may leave tasks tied to a closed event loop. Own this set.
    monkeypatch.setattr(ledger, "_PENDING_USAGE_TASKS", set())
    def generate(contents, **kwargs):
        calls.append(contents)
        payload = responses[min(len(calls) - 1, len(responses) - 1)]
        return SimpleNamespace(
            candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="STOP"))],
            text=payload.model_dump_json(),
            usage_metadata=SimpleNamespace(prompt_token_count=100, candidates_token_count=50, thoughts_token_count=20),
        )
    monkeypatch.setattr(grader_module.genai, "configure", lambda **kw: None)
    model = MagicMock(generate_content=generate)
    factory = MagicMock(return_value=model)
    monkeypatch.setattr(grader_module.genai, "GenerativeModel", factory)
    monkeypatch.setattr(grader_module.asyncio, "sleep", AsyncMock())
    async def capture(row):
        rows.append(row)
    monkeypatch.setattr(ledger, "_insert_async", capture)
    return grader_module.GeminiWritingGrader(api_key="test"), calls, rows, factory


async def drain_usage():
    # Await the actual scheduled ledger tasks; do not replace logging with mocks.
    import asyncio
    for _ in range(10):
        pending = list(ledger._PENDING_USAGE_TASKS)
        if not pending:
            return
        await asyncio.gather(*pending)


@pytest.mark.asyncio
@pytest.mark.parametrize("task_type,accepted", [("task1_academic", True), ("task2", False)])
async def test_task_reference_context_reaches_the_real_validation_boundary(monkeypatch, task_type, accepted):
    claim = "Trong biểu đồ, nhóm 'twice a year' tăng."
    grader, calls, rows, _ = setup_provider(monkeypatch, [feedback(claim)])
    config = GraderConfig(task_type=task_type, prompt_text="Frequency chart", essay_text=ESSAY,
                          analysis_level=3, selected_model="gemini-3.8-flash")
    if accepted:
        result = await grader.grade_essay(config)
        assert result.feedback.criteriaFeedback.lexicalResource.feedback == claim
    else:
        with pytest.raises(UngroundedWritingFeedbackError):
            await grader.grade_essay(config)
    await drain_usage()
    assert len(calls) == len(rows) == (1 if accepted else grader_module.MAX_RETRIES)


@pytest.mark.asyncio
@pytest.mark.parametrize("lemma,accepted", [("walk", True), ("talk", False)])
async def test_single_word_gloss_at_real_retry_boundary(monkeypatch, lemma, accepted):
    grader, calls, rows, _ = setup_provider(monkeypatch, [feedback(
        f"Cụm 'walked' dùng sai nghĩa của '{lemma}'.",
    )])
    config = GraderConfig(task_type="task2", prompt_text="Walking", essay_text="They walked home.",
                          analysis_level=3, selected_model="gemini-3.8-flash")
    if accepted:
        await grader.grade_essay(config)
    else:
        with pytest.raises(UngroundedWritingFeedbackError):
            await grader.grade_essay(config)
    await drain_usage()
    assert len(calls) == len(rows) == (1 if accepted else grader_module.MAX_RETRIES)


@pytest.mark.asyncio
async def test_regenerates_before_return_and_accounts_for_rejected_attempt(monkeypatch):
    grader, calls, rows, factory = setup_provider(monkeypatch, [feedback(BAD_CLAIM), feedback()])
    result = await grader.grade_essay(GraderConfig(
        task_type="task2", prompt_text="Discuss transport subsidies.", essay_text=ESSAY, analysis_level=3,
        selected_model="gemini-3.8-flash", usage_event_prefix="grounding:test",
    ))
    await drain_usage()
    assert result.model_used == "gemini-3.8-flash" and len(calls) == 2
    assert "subsidies" not in result.feedback.criteriaFeedback.lexicalResource.feedback
    assert "subsidies" in result.feedback.improvedEssay
    assert "Regenerate the complete" in calls[1]
    assert "Source grounding" in factory.call_args.kwargs["system_instruction"]
    assert [r["status"] for r in rows] == ["invalid_response", "success"]
    assert rows[0]["error_code"] == "ungrounded_feedback"
    assert len({r["usage_event_id"] for r in rows}) == 2
    assert all(r["input_tokens"] == 100 and r["output_tokens"] == 50 and r["thinking_tokens"] == 20 and r["cost_usd_est"] > 0 for r in rows)
    assert all("subsidies" not in json.dumps(r) for r in rows)


@pytest.mark.asyncio
async def test_persistent_bad_evidence_fails_with_existing_retry_budget(monkeypatch):
    grader, calls, rows, _ = setup_provider(monkeypatch, [feedback(BAD_CLAIM)])
    with pytest.raises(UngroundedWritingFeedbackError):
        await grader.grade_essay(GraderConfig(
            task_type="task2", prompt_text="Transport", essay_text=ESSAY, analysis_level=3,
            selected_model="gemini-3.8-flash", usage_event_prefix="grounding:failure",
        ))
    await drain_usage()
    assert len(calls) == grader_module.MAX_RETRIES == 3
    assert len(rows) == 3 and all(r["status"] == "invalid_response" for r in rows)


@pytest.mark.asyncio
async def test_valid_feedback_needs_no_extra_provider_call(monkeypatch):
    grader, calls, rows, _ = setup_provider(monkeypatch, [feedback()])
    await grader.grade_essay(GraderConfig(task_type="task2", prompt_text="Transport", essay_text=ESSAY, analysis_level=3))
    await drain_usage()
    assert len(calls) == len(rows) == 1 and rows[0]["status"] == "success"


@pytest.mark.asyncio
@pytest.mark.parametrize("claim,accepted", [
    ("Ví dụ: 'Targeted subsidies could support students.'", True),
    ("Example: 'Targeted subsidies could support students.'", True),
    ("Ví dụ minh họa: 'targeted subsidies' hoặc 'financial support'.", True),
    ("For example, 'targeted subsidies' or 'financial support'.", True),
    ("Suggestion: 'Targeted subsidies could support students.'", True),
    ("Suggested wording: 'Targeted subsidies could support students.'", True),
    ("Proposed revision: 'Targeted subsidies could support students.'", True),
    ("The essay's suggestion, 'targeted subsidies', is effective.", False),
    ("The essay suggested 'targeted subsidies' convincingly.", False),
    ("You suggested 'targeted subsidies' effectively.", False),
    ("Your suggested wording: 'targeted subsidies'.", False),
    ("The proposed revision, 'targeted subsidies', is effective.", False),
    ("Good organization. Suggested wording: 'targeted subsidies'.", True),
    ("Suggestion: 'targeted subsidies' or 'financial support'.", True),
    ("You used 'Targeted subsidies could support students.'", False),
    ("Em dùng từ rất tốt, ví dụ: 'targeted subsidies'.", False),
    ("You used precise language. For example: 'targeted subsidies'.", False),
    ("Ví dụ: 'targeted subsidies'. Em đã dùng 'financial support' rất tốt.", False),
])
async def test_example_labels_at_real_retry_boundary(monkeypatch, claim, accepted):
    grader, calls, rows, _ = setup_provider(monkeypatch, [feedback(claim)])
    config = GraderConfig(task_type="task2", prompt_text="Transport", essay_text=ESSAY,
                          analysis_level=3, selected_model="gemini-3.8-flash")
    if accepted:
        result = await grader.grade_essay(config)
        assert result.feedback.criteriaFeedback.lexicalResource.feedback == claim
    else:
        with pytest.raises(UngroundedWritingFeedbackError):
            await grader.grade_essay(config)
    await drain_usage()
    assert len(calls) == len(rows) == (1 if accepted else grader_module.MAX_RETRIES)
    assert all(r["status"] == ("success" if accepted else "invalid_response") for r in rows)


def test_bare_example_label_in_strengths_still_claims_learner_usage():
    result = feedback()
    result.keyTakeaways.strengths = ["Ví dụ: 'targeted subsidies'."]
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(result, ESSAY)


@pytest.mark.parametrize("field", ["strengths", "originalIdea", "location", "current_essay_observation"])
@pytest.mark.parametrize("claim,accepted", [
    ("Example: 'targeted subsidies'", False),
    ("Suggestion: 'targeted subsidies'", False),
    ("You could use 'targeted subsidies'", False),
    ("Example: 'dedicated bus lanes'", True),
])
def test_source_only_fields_never_use_proposal_exemptions(field, claim, accepted):
    data = feedback().model_dump()
    proposed = {"instruction": "Add detail", "example": "Targeted subsidies could help."}
    if field == "strengths":
        data["keyTakeaways"]["strengths"] = [claim]
    elif field == "originalIdea":
        data["ideaDevelopmentAnalysis"] = [{"paragraph": 2, "originalIdea": claim,
            "issue": "Needs detail", "explanation": "Explain the mechanism", "suggestion": proposed}]
    elif field == "location":
        data["coherenceAnalysis"] = [{"location": claim, "issue": "Needs a transition",
            "explanation": "Clarify the connection", "suggestion": proposed}]
    else:
        data["sentenceStructureAnalysis"] = {field: claim}
    result = WritingFeedback(**data)
    if accepted:
        validate_writing_grounding(result, ESSAY)
    else:
        with pytest.raises(UngroundedWritingFeedbackError) as caught:
            validate_writing_grounding(result, ESSAY)
        assert len(caught.value.issues) == 1 and field in caught.value.issues[0][0]


@pytest.mark.parametrize("claim", [
    "Em dùng “dedicated bus lanes,” rất tự nhiên.",            # punctuation inside the quotes
    "Em viết “Governments should invest in dedicated bus lanes.” rõ ràng.",
    'Em viết "Governments should invest […] employment centres" rõ ràng.',
    "Em viết 'Governments should (...) bus lanes' mạch lạc.",
    "Em dùng “Discounted tickets can help students!” hợp lý.",
])
def test_prose_quoting_conventions_still_cite_the_essay(claim):
    validate_writing_grounding(feedback(claim), ESSAY)


@pytest.mark.parametrize("claim", [
    "Em dùng “subsidies,” rất tự nhiên.",
    "Em dùng “dedicated train lanes.” rất tự nhiên.",
    'Em viết "Governments should invest […] subsidies" rõ ràng.',
    "Em viết 'employment centres (...) Governments' mạch lạc.",     # order still enforced
])
def test_prose_quoting_conventions_never_admit_fabricated_spans(claim):
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(feedback(claim), ESSAY)


def test_strict_original_fields_do_not_take_prose_quote_conventions():
    from models.writing_feedback import MistakeAnalysis

    data = feedback()
    data.mistakeAnalysis = [MistakeAnalysis(
        original="dedicated bus lanes.", mistakeType="Lexis", explanation="...",
        suggestion="...", criterion="Lexical Resource")]
    with pytest.raises(UngroundedWritingFeedbackError) as err:
        validate_writing_grounding(data, ESSAY)
    assert err.value.issues == [("mistakeAnalysis[0].original", "dedicated bus lanes.")]
