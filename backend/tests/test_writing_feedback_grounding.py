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


def setup_provider(monkeypatch, responses, mistake_original="Discounted tickets can help students"):
    """Fake Gemini serving ``responses``. A pass-1 answer below band 8.5 now
    needs one real mistake, so an empty mistakeAnalysis is served with one
    grounded entry (``mistake_original`` must occur in the test's essay)."""
    calls, rows = [], []
    # Other tests may leave tasks tied to a closed event loop. Own this set.
    monkeypatch.setattr(ledger, "_PENDING_USAGE_TASKS", set())
    def generate(contents, **kwargs):
        calls.append(contents)
        payload = responses[min(len(calls) - 1, len(responses) - 1)]
        if isinstance(payload, WritingFeedback) and not payload.mistakeAnalysis:
            payload = payload.model_copy(update={"mistakeAnalysis": [MistakeAnalysis(
                original=mistake_original, mistakeType="Word Choice", explanation="...",
                suggestion=mistake_original + " more", criterion="Lexical Resource")]})
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
    )], mistake_original="They walked home")
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


@pytest.mark.parametrize("original", [
    "Governments should invest […] employment centres",   # omission marker
    "Governments should invest ... employment centres",
    "dedicated bus lanes/employment centres",              # slash-joined fragments
])
def test_strict_original_fields_do_not_take_prose_quote_conventions(original):
    from models.writing_feedback import MistakeAnalysis

    data = feedback()
    data.mistakeAnalysis = [MistakeAnalysis(
        original=original, mistakeType="Lexis", explanation="...",
        suggestion="...", criterion="Lexical Resource")]
    with pytest.raises(UngroundedWritingFeedbackError) as err:
        validate_writing_grounding(data, ESSAY)
    assert err.value.issues == [("mistakeAnalysis[0].original", original)]


def test_strict_original_fields_tolerate_only_edge_punctuation():
    # Staging repro (Claude, a4eeb1b4): a verbatim sentence closed with "."
    # where the essay continues with ",". Words stay verbatim and contiguous.
    from models.writing_feedback import MistakeAnalysis

    data = feedback()
    data.mistakeAnalysis = [MistakeAnalysis(
        original="dedicated bus lanes.", mistakeType="Lexis", explanation="...",
        suggestion="...", criterion="Lexical Resource")]
    assert validate_writing_grounding(data, ESSAY).dropped == []



# ── Staging evidence 2026-10-26 (offline repro of e48c78f7/a4eeb1b4/9beb6ab4) ──
# Short excerpts of the real QA essays and the real failing citation shapes.

from models.writing_feedback import MistakeAnalysis  # noqa: E402
from services import writing_feedback_grounding as grounding  # noqa: E402

RT_PROMPT = ("Some people think governments should spend more money on public transport "
             "than on roads. To what extent do you agree or disagree?")
RT_ESSAY = (
    "Expanding metro and bus networks is one of the most effective ways to improve air quality. "
    "It helps reduce inequality.\n\nIn rural areas, where populations are small and distances "
    "are long, public transport is rarely practical, so roads remain vital. Businesses benefit "
    "from a more reliable flow of workers and goods. Cheaper tickets could be offered to students "
    "and people with low incomes, and people on low incomes would gain most. Secondly, governments "
    "should give priority to public transport because it brings greater environmental, economic "
    "and social benefits to the majority of people."
)


def rt_feedback(**fields):
    data = copy.deepcopy(VALID_FEEDBACK)
    data["mistakeAnalysis"] = []
    for key, value in fields.items():
        if key in data["criteriaFeedback"]:
            data["criteriaFeedback"][key]["feedback"] = value
        else:
            data[key] = value
    return WritingFeedback(**data)


def mistake(original):
    return {"original": original, "mistakeType": "Word Choice", "explanation": "...",
            "suggestion": "A suggested rewrite.", "criterion": "Lexical Resource"}


def idea(text):
    return {"paragraph": 2, "originalIdea": "Roads remain vital.", "issue": "Needs a rebuttal",
            "explanation": text, "suggestion": {"instruction": "Explain", "example": "A new example."}}


def rt_validate(result, **kw):
    return validate_writing_grounding(result, RT_ESSAY, task_type="task2", prompt_text=RT_PROMPT, **kw)


@pytest.mark.parametrize("original", [
    "In rural areas, where populations are small and distances are long, public transport is rarely practical.",
    "Expanding metro and bus networks is one of the most effective ways",
    "EXPANDING METRO and bus networks",                                   # case
    "It helps reduce inequality. In rural areas",                         # paragraph break
    "It helps reduce   inequality.\nIn rural areas",                      # whitespace runs
    "Businesses benefit from a more reliable flow of workers and goods",
    "Busi​nesses benefit",                                           # zero-width char
    "metro and bus networks is one of the most effective ways",
])
def test_normalization_grounds_verbatim_strict_spans(original):
    result = rt_feedback(mistakeAnalysis=[mistake(original)])
    report = rt_validate(result)
    assert report.dropped == [] and report.warnings == []


@pytest.mark.parametrize("claim", [
    "Em dùng ‘reduce inequality’ chính xác.",                       # curly single quotes
    "Em dùng “a more reliable flow of workers and goods” tự nhiên.",  # curly double quotes
    "Em viết 'Expanding metro … air quality' rõ ràng.",              # Unicode ellipsis
    "Em viết 'distances are long, public transport is rarely practical,' rõ ràng.",
    "Em dùng 'low incomes/people with low incomes' hai lần.",        # slash-joined real fragments
])
def test_normalization_grounds_prose_citations(claim):
    result = rt_feedback(lexicalResource=claim)
    before = result.model_dump()
    report = rt_validate(result)
    assert report.dropped == [] and report.warnings == []
    assert result.model_dump() == before


def test_dash_variants_ground_both_ways():
    essay = "Public transport – buses and trains – reduces congestion."
    result = rt_feedback(lexicalResource="Em dùng 'transport - buses and trains — reduces' tốt.")
    validate_writing_grounding(result, essay)


@pytest.mark.parametrize("original", [
    "it is one of the most effective ways",                 # repro: invented subject "it"
    "bring greater environmental, economic and social benefits to the majority of people",  # "brings"
    "induce more driving",                                  # word the learner did not use
])
def test_fabricated_strict_span_is_never_grounded(original):
    result = rt_feedback(mistakeAnalysis=[mistake(original)])
    with pytest.raises(UngroundedWritingFeedbackError) as err:
        rt_validate(result)
    assert err.value.issues == [("mistakeAnalysis[0].original", original)]


@pytest.mark.parametrize("claim", [
    "Em trả lời đầy đủ câu hỏi 'to what extent', có lập trường rõ ràng.",
    "Em trả lời đầy đủ câu hỏi 'To what extent do you agree or disagree?' với lập trường rõ.",
    "Em dùng nhiều dạng câu: mệnh đề quan hệ, cấu trúc 'especially + danh sách'.",
    "Em thừa nhận vai trò của đường bộ nhưng chưa bảo vệ lập luận 'ưu tiên giao thông công cộng'.",
    "Em nêu rằng đường rộng hơn 'khuyến khích lái xe nhiều hơn' nhưng chưa giải thích.",
    "Ý chính chưa tách bạch rõ giữa 'giá' và 'chất lượng'.",
    "Nếu em chỉ rõ thuật ngữ chuyên môn như 'social mobility' (sự dịch chuyển xã hội) hoặc 'spatial inclusion', bài sẽ tốt hơn.",
    "Hiện tượng 'induced demand' chưa được gọi tên chính thức.",
    "Đây là một khái niệm quy hoạch kinh điển ('induced demand' - nhu cầu phát sinh).",
    "Em dùng 'Secondly' ở đoạn 3 nhưng đoạn 2 lại không có 'Firstly'.",
])
def test_reference_language_in_free_text_is_not_an_essay_citation(claim):
    result = rt_feedback(mainCriterion=claim, ideaDevelopmentAnalysis=[idea(claim)])
    before = result.model_dump()
    report = rt_validate(result)
    assert report.dropped == [] and report.warnings == []
    assert result.model_dump() == before


@pytest.mark.parametrize("claim", [
    "Em dùng 'make public transport free' rất tự nhiên.",   # prompt wording credited as learner's
    "Em sử dụng 'to what extent' chính xác.",
    "Em đã dùng 'giao thông công cộng' tốt.",               # Vietnamese wording credited as used
    "Em dùng thuật ngữ 'induced demand' chính xác.",        # term credited as used
    "Bài có mẫu câu 'induce more driving'.",                # no grammar notation
    "Bài có hiện tượng lặp từ 'subsidies' nhiều lần.",      # repetition claim, not a term
    "Em không có lỗi khi viết 'subsidies'.",                # absence must precede the quote
    "The essay lacks errors and uses 'subsidies' well.",
    "The essay's use of 'cliché' demonstrates lexical range.",   # accented English, not Vietnamese
    "Từ vựng phong phú, ví dụ 'naïve' và 'café'.",
    # Codex review #1729: nominal/possessive usage claims and naming verbs.
    "Your use of the term 'subsidies' demonstrates strong lexical range.",
    "Việc sử dụng thuật ngữ 'subsidies' trong bài thể hiện vốn từ rộng.",
    "The essay's use of the concept 'induced demand' is precise.",
    "Em gọi hiện tượng này là 'induced demand'.",
    "Cách em dùng khái niệm 'induced demand' rất chính xác.",
    "Việc sử dụng 'trợ cấp' thể hiện vốn từ học thuật.",
    "Your use of the question wording 'make public transport free' is apt.",
    "Em trả lời câu hỏi bằng cách dùng 'make public transport free'.",
])
def test_reference_exemptions_never_cover_learner_wording_claims(claim):
    prompt = RT_PROMPT + " Some say governments should make public transport free."
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(rt_feedback(lexicalResource=claim), RT_ESSAY, prompt_text=prompt)


def test_prompt_quote_needs_a_question_reference_and_the_prompt():
    claim = "Lập luận 'to what extent' rất hay."               # no reference to the question
    with pytest.raises(UngroundedWritingFeedbackError):
        rt_validate(rt_feedback(mainCriterion=claim))
    with pytest.raises(UngroundedWritingFeedbackError):       # no prompt passed
        validate_writing_grounding(
            rt_feedback(mainCriterion="Em trả lời câu hỏi 'to what extent'."), RT_ESSAY)


@pytest.mark.parametrize("claim,path", [
    ("Vốn từ rộng: 'reduce inequality', 'a reliable flow of workers and goods'.", "criteriaFeedback.lexicalResource.feedback"),
    ("Em dùng vốn từ chính xác: 'reduces inequality'.", "criteriaFeedback.lexicalResource.feedback"),
])
def test_near_miss_prose_misquote_is_a_warning_not_a_rejection(claim, path):
    result = rt_feedback(lexicalResource=claim)
    before = result.model_dump()
    report = rt_validate(result)
    assert report.warnings == [path] and report.dropped == []
    assert result.model_dump() == before
    assert report.metadata() == {"grounding_warning_count": 1, "grounding_warnings": [path]}


@pytest.mark.parametrize("claim", [
    "Em dùng 'a reliable flow of new workers' tốt.",          # adds a word
    "Em dùng 'roads remain not vital' tốt.",                  # adds a negation
    "Em dùng 'transport is practical' tốt.",                  # omits the essay's "rarely"
    "Em dùng 'goods reliable flow' tốt.",                     # order changed
    "Em dùng 'subsidies reduce inequality' tốt.",
])
def test_near_miss_never_accepts_new_or_reordered_words(claim):
    if "transport is practical" in claim:
        # Omitting one essay word ("rarely") inside the window is a near miss;
        # the guard only downgrades it to a warning, never grounds it.
        assert rt_validate(rt_feedback(lexicalResource=claim)).warnings
        return
    with pytest.raises(UngroundedWritingFeedbackError):
        rt_validate(rt_feedback(lexicalResource=claim))


@pytest.mark.parametrize("essay,claim", [
    ("Governments should not build wider roads.", "Em dùng 'should build wider roads'."),
    ("Governments shouldn't subsidize cars.", "You used 'Governments subsidize cars' effectively."),
    ("People wouldn't pay higher fares.", "Em dùng 'People pay higher fares'."),
    ("Cities haven't expanded bus lanes.", "Em dùng 'Cities expanded bus lanes'."),
    ("Drivers never share cars.", "Em dùng 'Drivers share cars'."),
])
def test_near_miss_never_skips_an_essay_negation(essay, claim):
    # Codex review #1729: contractions are negations too.
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(rt_feedback(lexicalResource=claim), essay)


@pytest.mark.parametrize("essay,claim", [
    ("A plan can help.", "You used 'A plane can help' effectively."),
    ("Many cars pollute.", "Em dùng 'Many care pollute'."),
    ("People hope for change.", "Em dùng 'People hop for change'."),
    ("Prices increased sharply.", "Em dùng 'Prices increase sharply'."),   # tense is not tolerated
    ("Drivers are using buses.", "Em dùng 'Drivers are use buses'."),
])
def test_near_miss_never_matches_different_words(essay, claim):
    # Codex review #1729: only plural/third-person -s is an inflectional near miss.
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(rt_feedback(lexicalResource=claim), essay)


@pytest.mark.parametrize("essay,claim", [
    ("It helps reduce inequality.", "Em dùng 'reduces inequality'."),
    ("Expanding bus networks helps.", "Em dùng 'Expanding buses networks helps'."),
    ("Large cities need trams.", "Em dùng 'Large city needs trams'."),
    ("Many cars pollute.", "Em dùng 'Many car pollute'."),
])
def test_near_miss_keeps_plural_and_third_person_agreement(essay, claim):
    report = validate_writing_grounding(rt_feedback(lexicalResource=claim), essay)
    assert report.warnings == ["criteriaFeedback.lexicalResource.feedback"]


def test_strict_fields_never_use_near_miss():
    result = rt_feedback(mistakeAnalysis=[mistake("reduces inequality")])
    with pytest.raises(UngroundedWritingFeedbackError):
        rt_validate(result)


# PC-J03 staging repro (2026-10-28, Sonnet 5.5 on the 8 post-#1729 essays):
# 21 of 29 failed citations were rubric, absence, suggestion or grammar
# references, not essay quotes.
@pytest.mark.parametrize("claim", [
    "Tuy nhiên, các ý chủ yếu dừng ở mức 'stated', chưa 'extended' đầy đủ.",
    "Vì vậy Task Response chưa đạt mức 'extended and supported' của Band 7.",
    "Band 7+ cần ý được 'extended and supported', không chỉ khẳng định.",
    "Band 7+ cần ý được 'extended', tức có thêm bước 'vì thế dẫn đến điều gì'.",
    "Đây là chỗ cần 'extend' ý để đạt band 8.",
    "Người chấm sẽ coi đây là ý 'stated' thay vì 'extended'.",
    "Ideas are 'relevant, extended and supported' only at Band 8.",
    "Liên kết dùng linh hoạt, không lạm dụng 'Firstly/Secondly'.",
    "Em dùng liên kết như 'It helps', khá tự nhiên, không bị lạm dụng 'Firstly/Secondly'.",
    "The essay avoids overusing 'Firstly'.",
    "Band 7 đòi hỏi ý được 'extended and supported', còn bài này mới ở mức 'relevant but underdeveloped' nên dừng ở band 6.",
    "Em cũng lặp 'public transport' nhiều lần mà ít dùng từ thay thế như 'mass transit', 'rail and bus networks'.",
    "Cần thêm từ vựng ít phổ biến hơn (vd. 'alleviate', 'mitigate', 'urban sprawl') để lên Band 7.5.",
    "Thử thêm phân từ, câu chẻ ('It is X that...') hoặc đảo ngữ để tăng độ linh hoạt.",
    "Hiện tượng em mô tả (đường mới kéo theo nhu cầu lái xe) có tên gọi là 'induced demand'.",
    "Em trả lời đúng trọng tâm 'to what extent' với lập trường rõ.",
    "Em nối được ý, nhưng bước 'So what?' còn ngắn.",
    "Một vài chỗ chưa tự nhiên như 'It helps' (tự nhiên hơn: 'give higher priority' hoặc 'prioritise').",
    "Em không lạm dụng từ nối kiểu cơ học như 'Firstly... Secondly...', đây là điểm cộng.",
])
def test_band_descriptor_and_overuse_references_are_not_essay_citations(claim):
    result = rt_feedback(mainCriterion=claim, coherenceCohesion=claim, ideaDevelopmentAnalysis=[idea(claim)])
    before = result.model_dump()
    report = rt_validate(result)
    assert report.dropped == [] and report.warnings == []
    assert result.model_dump() == before


@pytest.mark.parametrize("claim", [
    "Em dùng từ 'extended' rất chính xác ở mức band 7.",          # usage claim
    "Your use of 'supported' fits the Band 7 descriptor.",          # nominal usage claim
    "Ý của em 'extended' rất tốt.",                                 # no band/rubric context
    "Vốn từ ở mức band 7 với 'subsidies'.",                         # not a descriptor term
    "Ở mức band 7, 'extended and supported by subsidies' là đúng.",  # term plus new words
    "Em lạm dụng 'Firstly' ở mọi đoạn.",                            # overuse claims usage
    "Em không lạm dụng 'Firstly', nhưng dùng 'subsidies' rất tốt.",  # absence covers one quote only
    "Ở mức band 7, ý 'relevant and subsidised' là đủ.",              # non-rubric word in the quote
    "Bài ở mức 'relevant' của band 6.",                              # no development term
    "Em dùng từ đồng nghĩa 'subsidies' tốt.",                        # synonym praise, not a lack
    "Em ít dùng 'subsidies'.",                                       # "rarely uses" claims some use
    "Từ vựng tốt (vd. 'subsidies').",                                # "vd." is not a proposal
    "Câu chẻ của em 'It is subsidies that help' rất hay.",          # no grammar notation
    "Từ em dùng được gọi là 'subsidies'.",                           # naming with a usage claim
    "Em không lạm dụng từ nối mà dùng từ như 'subsidies'.",         # usage verb ends the absence
    "Em dùng 'subsidies' (tự nhiên hơn: 'grants').",                 # the quote before the label
    "Em trả lời rõ, bước 'subsidies' hay.",                          # "bước" covers question labels only
    # Repro 72c07a2a / f02739d9: praised topic word absent from the essay.
    "Vốn từ đúng chủ đề: 'reduce inequality', 'transferable' hợp ngữ cảnh.",
])
def test_band_descriptor_and_overuse_exemptions_never_cover_usage_claims(claim):
    with pytest.raises(UngroundedWritingFeedbackError):
        rt_validate(rt_feedback(lexicalResource=claim))


# Codex #1796 (line 593): rubric words credited as learner vocabulary, by a
# noun before the quote or a usage verb after it, are not rubric references.
@pytest.mark.parametrize("claim", [
    "Vốn từ đạt Band 7 nhờ các từ 'extended' và 'supported'.",
    "Đạt Band 7 nhờ từ 'extended' và 'supported'.",
    "Ở mức Band 7, 'extended' và 'supported' được em dùng chính xác.",
    "Band 7 for using 'extended' and 'supported'.",
    "The Band 7 words 'extended' and 'supported' fit your essay.",
])
@pytest.mark.parametrize("criterion", ["lexicalResource", "mainCriterion"])
def test_band_descriptor_exemption_never_covers_vocabulary_credit(claim, criterion):
    with pytest.raises(UngroundedWritingFeedbackError) as err:
        rt_validate(rt_feedback(**{criterion: claim}))
    assert [span for _, span in err.value.issues] == ["extended", "supported"]


def test_band_descriptor_terms_stay_unsupported_in_source_only_fields():
    claim = "Ý được 'extended and supported' ở mức Band 7."
    result = rt_feedback(keyTakeaways={"strengths": [claim], "areasForImprovement": ["Cần ví dụ."]})
    with pytest.raises(UngroundedWritingFeedbackError) as err:
        rt_validate(result)
    assert [p for p, _ in err.value.issues] == ["keyTakeaways.strengths[0]"]


# Owner decision 2026-10-28 (PC-J03): strengths may quote the task question.
# The other source-only fields and every learner-wording claim stay strict.
@pytest.mark.parametrize("claim", [
    "Em trả lời trực tiếp câu hỏi 'To what extent do you agree or disagree?' với lập trường rõ ràng.",
    "Bài viết trả lời đúng trọng tâm 'to what extent' ngay từ mở bài.",
    "Bám sát yêu cầu đề bài 'spend more money on public transport than on roads'.",
    "The essay answers the question 'To what extent do you agree or disagree?' directly.",
    "Lập trường rõ (câu hỏi 'To what extent…'), nhất quán đến kết bài.",
])
def test_strengths_may_quote_the_task_question(claim):
    result = rt_feedback(keyTakeaways={"strengths": [claim], "areasForImprovement": ["Cần ví dụ."]})
    before = result.model_dump()
    report = rt_validate(result)
    assert report.dropped == [] and report.warnings == []
    assert result.model_dump() == before


@pytest.mark.parametrize("claim", [
    "Em dùng 'to what extent' chính xác.",                              # usage claim
    "Từ vựng sát đề bài: 'spend more money on public transport'.",      # #1654 canary: lexis credit
    "Bám sát đề bài với cụm từ 'public transport than on roads'.",
    "Your vocabulary matches the task: 'spend more money'.",
    "Câu hỏi 'spend more money on public transport' được em viết lại tự nhiên.",  # wording verb after
    "Em nên tiếp tục trả lời câu hỏi 'to what extent'.",               # continuation presupposes use
    "Lập luận 'to what extent' rất hay.",                               # no question reference
    "Em trả lời câu hỏi 'subsidies are effective' rõ ràng.",            # not in the prompt
])
def test_strengths_task_question_quote_never_credits_learner_wording(claim):
    result = rt_feedback(keyTakeaways={"strengths": [claim], "areasForImprovement": ["Cần ví dụ."]})
    with pytest.raises(UngroundedWritingFeedbackError) as err:
        rt_validate(result)
    assert [p for p, _ in err.value.issues] == ["keyTakeaways.strengths[0]"]


def test_strengths_task_question_quote_needs_the_prompt():
    claim = "Em trả lời câu hỏi 'to what extent'."
    result = rt_feedback(keyTakeaways={"strengths": [claim], "areasForImprovement": ["Cần ví dụ."]})
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(result, RT_ESSAY, task_type="task2")


# Codex #1796 (line 153): "Your answer ..." names the learner's text, so a
# prompt quote credited to it is a wording claim in every field.
@pytest.mark.parametrize("claim", [
    "Your answer uses 'spend more money' effectively.",
    "Your answer includes 'spend more money' effectively.",
    "Câu trả lời của em chứa 'spend more money'.",
    "The task wording 'spend more money' is used effectively.",
    "Em trả lời câu hỏi, 'spend more money' được em viết lại tốt.",
])
def test_task_question_exemption_never_covers_wording_claims(claim):
    for criterion in ("lexicalResource", "mainCriterion"):
        with pytest.raises(UngroundedWritingFeedbackError) as err:
            rt_validate(rt_feedback(**{criterion: claim}))
        assert [span for _, span in err.value.issues] == ["spend more money"]
    result = rt_feedback(keyTakeaways={"strengths": [claim], "areasForImprovement": ["Cần ví dụ."]})
    with pytest.raises(UngroundedWritingFeedbackError) as err:
        rt_validate(result)
    assert [p for p, _ in err.value.issues] == ["keyTakeaways.strengths[0]"]


@pytest.mark.parametrize("field", ["originalIdea", "location", "current_essay_observation"])
def test_other_source_only_fields_still_reject_task_question_quotes(field):
    claim = "Em trả lời câu hỏi 'to what extent'."
    data = rt_feedback().model_dump()
    proposed = {"instruction": "Add detail", "example": "A new example."}
    if field == "originalIdea":
        data["ideaDevelopmentAnalysis"] = [{"paragraph": 2, "originalIdea": claim,
            "issue": "Needs detail", "explanation": "Explain the mechanism", "suggestion": proposed}]
    elif field == "location":
        data["coherenceAnalysis"] = [{"location": claim, "issue": "Needs a transition",
            "explanation": "Clarify the connection", "suggestion": proposed}]
    else:
        data["sentenceStructureAnalysis"] = {field: claim}
    with pytest.raises(UngroundedWritingFeedbackError) as err:
        rt_validate(WritingFeedback(**data))
    assert len(err.value.issues) == 1 and field in err.value.issues[0][0]


def test_near_miss_accepts_auxiliary_agreement_but_not_tense():
    essay = "Companies that adopt this model are likely to have happier and more productive employees."
    claim = "Cách diễn đạt hơi dài dòng ('is likely to have happier and more productive employees')."
    report = validate_writing_grounding(rt_feedback(lexicalResource=claim), essay)
    assert report.warnings == ["criteriaFeedback.lexicalResource.feedback"]
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(
            rt_feedback(lexicalResource="Em dùng 'were likely to have happier employees'."), essay)
    # Strict originals keep the learner's verb form exactly.
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(
            rt_feedback(mistakeAnalysis=[mistake("this model is likely to have")]), essay)


@pytest.mark.parametrize("essay,claim", [
    # Repro a4eeb1b4: "brings greater environmental, economic and social benefits".
    (RT_ESSAY, "Có một số collocation tốt như 'give priority to' và 'bring benefits'."),
    # Repro a915f0f8: the essay says "gives these groups access to jobs".
    ("Public transport gives these groups access to jobs.", "Cụm 'give them access to jobs' khá an toàn."),
])
def test_repro_real_misquotes_in_criterion_feedback_still_reject(essay, claim):
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(rt_feedback(lexicalResource=claim), essay)


def test_degradation_drops_only_the_bad_list_items_and_reports_paths():
    good = ["Expanding metro and bus networks", "reduce inequality", "a more reliable flow",
            "people with low incomes", "the majority of people"]
    bad = {2: "it is one of the most effective ways",
           4: "bring greater environmental, economic and social benefits to the majority of people"}
    items = [mistake(bad.get(i, text)) for i, text in enumerate(good)]
    result = rt_feedback(mistakeAnalysis=items)
    report = rt_validate(result)
    assert report.dropped == ["mistakeAnalysis[2]", "mistakeAnalysis[4]"]
    assert [m.original for m in result.mistakeAnalysis] == [good[0], good[1], good[3]]
    assert report.metadata() == {"grounding_dropped_count": 2,
                                 "grounding_dropped": ["mistakeAnalysis[2]", "mistakeAnalysis[4]"]}
    assert "inequality" not in json.dumps(report.metadata())   # paths only


def test_degradation_covers_sentence_upgrades_strengths_and_ideas():
    result = rt_feedback(
        keyTakeaways={"strengths": ["Em dùng 'reduce inequality'.", "Em dùng 'induce more driving'.",
                                    "Lập luận rõ ràng."], "areasForImprovement": ["Cần ví dụ."]},
        ideaDevelopmentAnalysis=[idea("Em dùng 'subsidies' tốt."), idea("Rõ ràng."), idea("Ổn.")],
        sentenceStructureAnalysis={"sentenceUpgrades": [
            {"original": "It helps reduce inequality.", "rewritten": "A rewrite."},
            {"original": "It helps reduce poverty.", "rewritten": "A rewrite."},
        ]},
    )
    report = rt_validate(result)
    assert report.dropped == ["ideaDevelopmentAnalysis[0]", "keyTakeaways.strengths[1]",
                              "sentenceStructureAnalysis.sentenceUpgrades[1]"]
    assert len(result.keyTakeaways.strengths) == 2 and len(result.ideaDevelopmentAnalysis) == 2
    assert result.sentenceStructureAnalysis["sentenceUpgrades"] == [
        {"original": "It helps reduce inequality.", "rewritten": "A rewrite."}]


@pytest.mark.parametrize("fields", [
    # Single-valued field: no item to drop.
    {"lexicalResource": "Em dùng 'subsidies' tự nhiên.",
     "mistakeAnalysis": [mistake("induce more driving"), mistake("reduce inequality")]},
    # Last item of a list.
    {"mistakeAnalysis": [mistake("induce more driving")]},
    # More than half of a list.
    {"mistakeAnalysis": [mistake("induce more driving"), mistake("new words"), mistake("reduce inequality")]},
    # More than MAX_DROPPED_ITEMS in total.
    {"mistakeAnalysis": [mistake(t) for t in ("x1 x1", "x2 x2", "x3 x3", "a more reliable flow",
                                              "people with low incomes", "the majority of people")],
     "keyTakeaways": {"strengths": ["Em dùng 'zzz'.", "Ổn.", "Tốt."], "areasForImprovement": ["Cần ví dụ."]}},
])
def test_severe_failures_still_reject_without_editing(fields):
    result = rt_feedback(**fields)
    before = result.model_dump()
    with pytest.raises(UngroundedWritingFeedbackError) as err:
        rt_validate(result)
    assert result.model_dump() == before                     # nothing dropped on rejection
    assert len(err.value.issues) >= 1


def test_max_dropped_items_constant_is_the_documented_threshold():
    assert grounding.MAX_DROPPED_ITEMS == 3


# Staging error_detail path shapes (2026-10-26, #1726 validator) replayed with
# the span classes the offline repro of the same essays and prompts produced.
FABRICATED = "Em dùng 'induce more driving' rất tự nhiên."
TASK_QUESTION = "Em trả lời trực tiếp câu hỏi 'To what extent', lập trường rõ ràng."


def upgrades(bad=None):
    good = ["Expanding metro and bus networks is one of the most effective ways to improve air quality.",
            "It helps reduce inequality.",
            "Businesses benefit from a more reliable flow of workers and goods.",
            "Cheaper tickets could be offered to students and people with low incomes,",
            # Repro a4eeb1b4 r2 [4]: the essay continues with "," not ".".
            "In rural areas, where populations are small and distances are long, public transport is rarely practical."]
    return {"sentenceUpgrades": [{"original": (bad or {}).get(i, text), "rewritten": "A rewrite."}
                                 for i, text in enumerate(good)]}


def takeaways(strengths=None, areas=None):
    base_s = ["Lập trường rõ ràng.", "Mạch lạc.", "Từ vựng chính xác như 'reduce inequality'."]
    base_a = ["Cần ví dụ cụ thể.", "Cần dùng 'nevertheless' thay vì lặp 'however'.",
              "Ý chính chưa tách bạch rõ giữa 'giá' và 'chất lượng'."]
    for i, text in (strengths or {}).items():
        base_s[i] = text
    for i, text in (areas or {}).items():
        base_a[i] = text
    return {"strengths": base_s, "areasForImprovement": base_a}


def three_ideas(i=None, text=None):
    items = [idea("Rõ ràng."), idea("Ổn."), idea("Cần thêm ví dụ.")]
    if i is not None:
        items[i] = idea(text)
    return items


@pytest.mark.parametrize("fields,dropped,warnings", [
    # e48c78f7 #1: mainCriterion + ideaDevelopmentAnalysis[2].explanation (term).
    ({"mainCriterion": TASK_QUESTION,
      "ideaDevelopmentAnalysis": three_ideas(2, "Hiện tượng 'induced demand' chưa được gọi tên chính thức.")},
     [], []),
    # ... and when [2].explanation is a real fabrication, only that item goes.
    ({"mainCriterion": TASK_QUESTION, "ideaDevelopmentAnalysis": three_ideas(2, FABRICATED)},
     ["ideaDevelopmentAnalysis[2]"], []),
    # e48c78f7 repair: keyTakeaways.strengths[2] near-miss -> warning; fabrication -> dropped.
    ({"keyTakeaways": takeaways(strengths={2: "Từ vựng chính xác như 'reduces inequality'."})},
     [], ["keyTakeaways.strengths[2]"]),
    ({"keyTakeaways": takeaways(strengths={2: FABRICATED})}, ["keyTakeaways.strengths[2]"], []),
    # a4eeb1b4 #1: mainCriterion + ideaDevelopmentAnalysis[1].explanation (concept).
    ({"mainCriterion": "Em trả lời đầy đủ câu hỏi 'to what extent', có lập trường rõ ràng.",
      "ideaDevelopmentAnalysis": three_ideas(
          1, "Đây là một khái niệm quy hoạch đô thị kinh điển ('induced demand' - nhu cầu phát sinh).")},
     [], []),
    # a4eeb1b4 repair: coherenceCohesion absence, areasForImprovement[1],[2] near-miss
    # and proposal, sentenceUpgrades[4] edge punctuation, [2] a real misquote.
    ({"coherenceCohesion": "Em dùng 'Secondly' ở đoạn 3 nhưng đoạn 2 lại không có 'Firstly'.",
      "keyTakeaways": takeaways(areas={1: "Cụm 'reduces inequality' cần ví dụ.",
                                       2: "Nên dùng 'mass transit' thay cho 'public transport'."}),
      "sentenceStructureAnalysis": upgrades({2: "it is one of the most effective ways"})},
     ["sentenceStructureAnalysis.sentenceUpgrades[2]"], ["keyTakeaways.areasForImprovement[1]"]),
    # 9beb6ab4 #1: full task question + areasForImprovement[1],[2] (proposal, Vietnamese).
    ({"mainCriterion": "Em trả lời đầy đủ câu hỏi 'To what extent do you agree or disagree?' với lập trường rõ.",
      "keyTakeaways": takeaways()},
     [], []),
])
def test_staging_path_shapes_are_accepted_by_the_rule_that_owns_them(fields, dropped, warnings):
    report = rt_validate(rt_feedback(**fields))
    assert report.dropped == dropped and report.warnings == warnings


@pytest.mark.parametrize("fields,paths", [
    # a4eeb1b4 repair if every list path were a real fabrication: 4 items > MAX_DROPPED_ITEMS
    # and 2 of 3 areasForImprovement (more than half).
    ({"keyTakeaways": takeaways(areas={1: FABRICATED, 2: FABRICATED}),
      "sentenceStructureAnalysis": upgrades({2: "it is one of the most effective ways",
                                             4: "public transport is rarely practical in rural areas"})},
     ["keyTakeaways.areasForImprovement[1]", "keyTakeaways.areasForImprovement[2]",
      "sentenceStructureAnalysis.sentenceUpgrades[2].original",
      "sentenceStructureAnalysis.sentenceUpgrades[4].original"]),
    # 9beb6ab4 #1 if areasForImprovement[1],[2] were fabrications: within the cap,
    # but only one of three areas would survive.
    ({"keyTakeaways": takeaways(areas={1: FABRICATED, 2: FABRICATED})},
     ["keyTakeaways.areasForImprovement[1]", "keyTakeaways.areasForImprovement[2]"]),
    # Single-valued criterion feedback is never dropped: a real usage claim rejects.
    ({"coherenceCohesion": "Em dùng 'Firstly' và 'Secondly' hợp lý.",
      "keyTakeaways": takeaways(areas={1: FABRICATED})},
     ["criteriaFeedback.coherenceCohesion.feedback", "keyTakeaways.areasForImprovement[1]"]),
])
def test_staging_path_shapes_still_reject_when_the_failures_are_real(fields, paths):
    result = rt_feedback(**fields)
    before = result.model_dump()
    with pytest.raises(UngroundedWritingFeedbackError) as err:
        rt_validate(result)
    assert [p for p, _ in err.value.issues] == paths
    assert result.model_dump() == before


def test_two_item_area_list_may_lose_one_item():
    # Seven of 21 observed answers have two areasForImprovement; one drop keeps half.
    result = rt_feedback(keyTakeaways={"strengths": ["Ổn."], "areasForImprovement": ["Cần ví dụ.", FABRICATED]})
    assert rt_validate(result).dropped == ["keyTakeaways.areasForImprovement[1]"]
    assert result.keyTakeaways.areasForImprovement == ["Cần ví dụ."]


def test_repair_instruction_lists_each_failed_path_and_truncated_span():
    long_span = "it is one of the most effective ways " * 10
    err = UngroundedWritingFeedbackError([
        ("criteriaFeedback.lexicalResource.feedback", "subsidies"),
        ("mistakeAnalysis[2].original", long_span),
    ])
    text = err.repair_instruction()
    assert '- criteriaFeedback.lexicalResource.feedback: "subsidies"' in text
    assert "- mistakeAnalysis[2].original: " + json.dumps(long_span[:grounding.REPAIR_SPAN_CHARS]) in text
    assert long_span not in text
    assert "character-for-character" in text and "Regenerate the complete" in text
    assert "subsidies" not in str(err)                       # log text stays paths only


def test_grounding_instruction_asks_for_verbatim_copies():
    assert "character-for-character" in grounding.GROUNDING_INSTRUCTION
    assert "task prompt" in grounding.GROUNDING_INSTRUCTION


@pytest.mark.asyncio
async def test_gemini_degraded_answer_is_served_and_ledgered(monkeypatch):
    items = [mistake(t) for t in ("Expanding metro and bus networks", "it is one of the most effective ways",
                                  "reduce inequality")]
    grader, calls, rows, _ = setup_provider(monkeypatch, [rt_feedback(mistakeAnalysis=items)])
    result = await grader.grade_essay(GraderConfig(
        task_type="task2", prompt_text=RT_PROMPT, essay_text=RT_ESSAY, analysis_level=3,
        selected_model="gemini-3.8-flash", usage_event_prefix="grounding:degrade",
        usage_resource_id="essay-123",
    ))
    await drain_usage()
    assert len(calls) == 1                                   # no regrade
    assert [m.original for m in result.feedback.mistakeAnalysis] == [
        "Expanding metro and bus networks", "reduce inequality"]
    assert [r["status"] for r in rows] == ["success"]
    meta = rows[0]["metadata"]
    assert meta["essay_id"] == "essay-123"
    assert meta["grounding_dropped"] == ["mistakeAnalysis[1]"] and meta["grounding_dropped_count"] == 1
    assert "effective ways" not in json.dumps(rows)


@pytest.mark.asyncio
async def test_gemini_rejection_rows_carry_essay_id_and_error_detail(monkeypatch):
    grader, calls, rows, _ = setup_provider(monkeypatch, [feedback(BAD_CLAIM), feedback()])
    await grader.grade_essay(GraderConfig(
        task_type="task2", prompt_text="Transport", essay_text=ESSAY, analysis_level=3,
        selected_model="gemini-3.8-flash", usage_event_prefix="grounding:detail",
        usage_resource_id="essay-456",
    ))
    await drain_usage()
    assert [r["status"] for r in rows] == ["invalid_response", "success"]
    assert rows[0]["error_code"] == "ungrounded_feedback"
    assert rows[0]["metadata"]["error_detail"] == (
        "Unsupported essay citations at criteriaFeedback.lexicalResource.feedback")
    assert all(r["metadata"]["essay_id"] == "essay-456" for r in rows)
    assert "subsidies" in calls[1] and "- criteriaFeedback.lexicalResource.feedback:" in calls[1]
    assert "subsidies" not in json.dumps(rows)


@pytest.mark.asyncio
async def test_gemini_schema_rejection_is_coded_invalid_json(monkeypatch):
    grader, calls, rows, _ = setup_provider(monkeypatch, [feedback()])
    bad = SimpleNamespace(
        candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="STOP"))],
        text='{"overallBandScore": "high", "padding": "................"}',
        usage_metadata=SimpleNamespace(prompt_token_count=10, candidates_token_count=5, thoughts_token_count=0),
    )
    good = feedback()
    responses = iter([bad])

    def generate(contents, **kwargs):
        calls.append(contents)
        item = next(responses, None)
        if item is not None:
            return item
        return SimpleNamespace(
            candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="STOP"))],
            text=good.model_dump_json(),
            usage_metadata=SimpleNamespace(prompt_token_count=10, candidates_token_count=5, thoughts_token_count=0),
        )
    grader_module.genai.GenerativeModel.return_value = MagicMock(generate_content=generate)
    await grader.grade_essay(GraderConfig(task_type="task2", prompt_text="Transport", essay_text=ESSAY,
                                          analysis_level=3, usage_resource_id="essay-789"))
    await drain_usage()
    assert rows[0]["error_code"] == "invalid_json"
    assert rows[0]["metadata"]["error_detail"].startswith("Schema validation failed:")
    assert "high" not in rows[0]["metadata"]["error_detail"]


# ── mistakeAnalysis minimum below band 8.5 ────────────────────────────

def _band(fb, band, mistakes):
    return fb.model_copy(update={"overallBandScore": band, "mistakeAnalysis": [
        MistakeAnalysis(**m) for m in mistakes]})


REAL = {"original": "Discounted tickets can help students", "mistakeType": "Word Choice",
        "explanation": "...", "suggestion": "Discounted tickets can support students",
        "criterion": "Lexical Resource"}
SAME = {**REAL, "suggestion": "Discounted  tickets can help students"}   # whitespace only


@pytest.mark.parametrize("band,mistakes,missing", [
    (8.0, [], True),
    (7.5, [SAME], True),             # non-corrections are dropped by essay_service
    (4.0, [], True),
    (8.0, [REAL], False),
    (7.5, [SAME, REAL], False),
    (8.5, [], False),
    (9.0, [], False),
])
def test_missing_mistake_analysis_scales_with_band(band, mistakes, missing):
    assert grounding.missing_mistake_analysis(_band(feedback(), band, mistakes)) is missing


@pytest.mark.parametrize("payload", [Pass2Refinement(), Pass3Rewrites()])
def test_missing_mistake_analysis_never_applies_to_deep_passes(payload):
    assert grounding.missing_mistake_analysis(payload) is False


def test_validated_text_rejects_then_accepts_with_metadata(monkeypatch):
    grader = grader_module.GeminiWritingGrader.__new__(grader_module.GeminiWritingGrader)
    text = _band(feedback(), 7.5, []).model_dump_json()
    with pytest.raises(grounding.MissingMistakeAnalysisError) as err:
        grader._validated_text(text, WritingFeedback, ESSAY, "task2", "Transport")
    assert err.value.error_code == "missing_mistake_analysis"
    assert str(err.value) == "mistakeAnalysis has no real correction at overallBandScore 7.5 (< 8.5)"
    assert err.value.validated[1]["mistake_analysis_missing"] is True
    accepted, meta = grader._validated_text(text, WritingFeedback, ESSAY, "task2", "Transport",
                                            accept_missing_mistakes=True)
    assert accepted == text and meta == {"mistake_analysis_missing": True}
    # Deep pass schemas with no items are untouched.
    assert grader._validated_text(Pass2Refinement().model_dump_json(), Pass2Refinement,
                                  ESSAY, "task2", "Transport")[1] == {}


def test_missing_mistake_repair_instruction_asks_for_verbatim_real_errors():
    text = grounding.MissingMistakeAnalysisError(7.0).repair_instruction()
    assert "overallBandScore 7" in text and "INCLUDING the learner's errors" in text
    assert "Never invent an error" in text and "do not raise the band" in text
    assert "faulty wording" in grounding.GROUNDING_INSTRUCTION


def test_missing_mistake_error_code_mapping():
    from services import ai_router

    assert ai_router.VALIDATION_ERROR_CODES["MissingMistakeAnalysisError"] == "missing_mistake_analysis"
    assert ai_router.validation_error_code(
        grounding.MissingMistakeAnalysisError(6.0)) == "missing_mistake_analysis"
