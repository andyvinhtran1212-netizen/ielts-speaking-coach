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


def test_word_boundaries_prevent_substring_evidence():
    with pytest.raises(UngroundedWritingFeedbackError):
        validate_writing_grounding(feedback("Em dùng 'bus' phù hợp."), "Business is important.")


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
