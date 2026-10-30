"""Real grading orchestration with mocked providers, including final Deep merge."""

import json
from pathlib import Path

import pytest

from models.writing_feedback import GraderConfig
from test_gemini_writing_grader import writing_providers  # Reuse the SDK/ledger fakes.


ESSAY = (
    "The proportion of 18-30 year olds rose. The gap narrowed. "
    "It levelled off after a dramatic increase. The other group rose rapidly."
)


def _payload():
    return json.loads((Path(__file__).parent / "fixtures/writing_task1_consistency.json").read_text())


def _config(**overrides):
    return GraderConfig(task_type="task1_academic", prompt_text="Describe the chart.",
                        essay_text=ESSAY, analysis_level=3, **overrides)


@pytest.fixture(autouse=True)
def no_failure_log_database_calls(monkeypatch):
    from services import ai_failure_log

    monkeypatch.setattr(ai_failure_log, "schedule_usage_log", lambda coro: coro.close())


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["anthropic", "gemini"])
@pytest.mark.parametrize("tier", ["standard", "instructor"])
async def test_repairs_cost_no_extra_provider_call(writing_providers, monkeypatch, provider, tier):
    from config import settings

    state = writing_providers
    state.claude = state.gemini = [json.dumps(_payload())]
    if provider == "gemini":
        monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    result = await state.grader.grade_essay(_config(grading_tier=tier))

    assert len(state.claude_requests) == (provider == "anthropic")
    assert len(state.gemini_calls) == (provider == "gemini")
    assert result.feedback.criteriaFeedback.mainCriterion.title == "Task Achievement"
    assert result.feedback.mistakeAnalysis[0].mistakeType == "Data Accuracy"
    assert "levelled off" not in result.feedback.criteriaFeedback.lexicalResource.feedback
    assert "18–30-year-olds" in result.feedback.improvedEssay
    assert result.feedback.bandTrajectoryAnalysis["criteria_breakdown"][0]["criterion"] == "Task Achievement"
    assert result.feedback.overallBandScoreSummary.startswith("⚠️ Chấm không có hình")
    assert len(state.rows) == 1 and state.rows[0]["status"] == "success"
    assert result.grading_tier.value == tier


@pytest.mark.asyncio
@pytest.mark.parametrize("fail_pass3", [False, True])
async def test_deep_final_merge_rechecks_added_errors_and_changed_gra(writing_providers, fail_pass3):
    state = writing_providers
    payload = _payload()
    payload["criteriaFeedback"]["grammaticalRange"]["bandScore"] = 6
    payload["criteriaFeedback"]["lexicalResource"]["feedback"] = "Em dùng 'rose rapidly' phù hợp."
    state.claude = [json.dumps(payload)]
    state.gemini = [json.dumps({
        "band_score_adjustments": {"grammaticalRange": 7},
        "added_mistakes": [{"original": "rose rapidly", "mistakeType": "Word Choice",
                            "explanation": "Mô tả sai so với số liệu biểu đồ.",
                            "suggestion": "rose gradually", "criterion": "Lexical Resource"}],
    }), RuntimeError("mock pass 3 failure") if fail_pass3 else '{"sentence_rewrites": []}']
    result = await state.grader.grade_essay(_config(grading_tier="deep"))

    assert len(state.claude_requests) == 1
    assert len(state.gemini_calls) == (4 if fail_pass3 else 2)  # Existing retry budget only.
    assert result.feedback.criteriaFeedback.grammaticalRange.bandScore == 7
    assert "đơn giản" not in result.feedback.sentenceStructureAnalysis["summary"]
    assert "rose rapidly" not in result.feedback.criteriaFeedback.lexicalResource.feedback
    assert result.feedback.mistakeAnalysis[-1].mistakeType == "Data Accuracy"
    assert result.feedback.criteriaFeedback.mainCriterion.title == "Task Achievement"
    assert ("degraded" in result.prompt_version) == fail_pass3
