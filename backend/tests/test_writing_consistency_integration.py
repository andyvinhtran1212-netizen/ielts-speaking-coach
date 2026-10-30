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


def _config(task_type="task1_academic", **overrides):
    return GraderConfig(task_type=task_type, prompt_text="Describe the chart.",
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


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["anthropic", "gemini"])
@pytest.mark.parametrize("tier", ["standard", "deep", "instructor"])
@pytest.mark.parametrize("task_type", ["task1_academic", "task2"])
async def test_repair_failure_keeps_unrepaired_feedback_and_grades(
    writing_providers, monkeypatch, caplog, provider, tier, task_type,
):
    from config import settings
    from services import gemini_writing_grader as gwg

    state = writing_providers
    state.claude = [json.dumps(_payload())]
    state.gemini = ([json.dumps(_payload())] if provider == "gemini" else []) + [
        '{"band_score_adjustments": {}}', '{"sentence_rewrites": []}',
    ]
    if provider == "gemini":
        monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")

    # Capture the entire paid result immediately before the final repair.
    grade_tier = getattr(state.grader, f"_grade_{tier}")
    original = {}

    async def capture_unrepaired(config, loader):
        result = await grade_tier(config, loader)
        original["result"] = result.model_dump()
        original["feedback"] = result.feedback
        return result

    monkeypatch.setattr(state.grader, f"_grade_{tier}", capture_unrepaired)
    repair_calls = []

    def broken_repair(feedback, task_type):
        repair_calls.append(task_type)
        assert feedback is not original["feedback"]
        feedback.criteriaFeedback.mainCriterion.title = "partially repaired"
        feedback.keyTakeaways.strengths.clear()
        feedback.sentenceStructureAnalysis["common_issues"].append({"pattern": "partial"})
        feedback.bandTrajectoryAnalysis["criteria_breakdown"][0]["criterion"] = "partial"
        # Exception messages can contain learner/model text; only the type is safe.
        raise RuntimeError(f"repair bug: {ESSAY} {feedback.overallBandScoreSummary}")

    monkeypatch.setattr(gwg, "repair_writing_consistency", broken_repair)
    with caplog.at_level("INFO", logger=gwg.logger.name):
        result = await state.grader.grade_essay(_config(task_type, grading_tier=tier))

    assert repair_calls == [task_type]
    assert result.feedback is original["feedback"]
    assert result.model_dump() == original["result"]
    assert result.feedback.criteriaFeedback.mainCriterion.title == "Task Response"
    assert "levelled off" in result.feedback.criteriaFeedback.lexicalResource.feedback
    assert len(state.claude_requests) == (provider == "anthropic")
    assert len(state.gemini_calls) == (provider == "gemini") + (2 if tier == "deep" else 0)
    assert len(state.rows) == (3 if tier == "deep" else 1)
    assert all(row["status"] == "success" for row in state.rows)
    warnings = [r for r in caplog.records if r.name == gwg.logger.name and r.levelno >= 30]
    assert len(warnings) == 1
    assert warnings[0].getMessage() == (
        "[grader] consistency repair failed, keeping unrepaired feedback: RuntimeError"
    )
    assert warnings[0].exc_info is None
    assert "repair bug" not in caplog.text
    assert ESSAY not in caplog.text
    assert original["feedback"].overallBandScoreSummary not in caplog.text
    assert "consistency repairs:" not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("sections", [
    {"sentenceStructureAnalysis": None, "bandTrajectoryAnalysis": None},
    {"sentenceStructureAnalysis": {}, "bandTrajectoryAnalysis": {}},
    {"sentenceStructureAnalysis": [], "bandTrajectoryAnalysis": {"criteria_breakdown": []}},
    {"sentenceStructureAnalysis": {"summary": [], "current_essay_observation": {"custom": None}},
     "bandTrajectoryAnalysis": {"criteria_breakdown": [None, [], 7, {}], "summary": None}},
    {"sentenceStructureAnalysis": {"summary": "Custom summary", "sentenceUpgrades": []},
     "bandTrajectoryAnalysis": {"criteria_breakdown": 7}},
], ids=["null", "empty-dicts", "empty-lists", "free-form-dicts", "repair-type-error"])
async def test_optional_analysis_shapes_cannot_lose_a_paid_grade(writing_providers, sections, caplog):
    state = writing_providers
    payload = _payload()
    payload.update(sections)
    state.claude = [json.dumps(payload)]

    result = await state.grader.grade_essay(_config())

    assert len(state.claude_requests) == 1 and state.gemini_calls == []
    assert len(state.rows) == 1 and state.rows[0]["status"] == "success"
    if sections["bandTrajectoryAnalysis"] == {"criteria_breakdown": 7}:
        # A valid free-form dict can fail halfway through repair. Keep all of it.
        expected = state.grader._parse_response(json.dumps(payload))
        state.grader._inject_missing_image_caveat(expected)
        assert result.feedback.model_dump() == expected.model_dump()
        assert "consistency repair failed" in caplog.text
    else:
        assert result.feedback.criteriaFeedback.mainCriterion.title == "Task Achievement"
        assert "18–30-year-olds" in result.feedback.improvedEssay
        assert "consistency repair failed" not in caplog.text
