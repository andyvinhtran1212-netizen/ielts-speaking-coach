"""Post-processing only: no providers or database calls."""

from copy import deepcopy

import pytest

from services.gemini_writing_grader import (
    GeminiWritingGrader,
    summary_flags_missing_image,
)
from services.writing_band_consistency import align_overall_band_feedback


def _feedback(model_band=5.5, current_band=5.5, average=6.7):
    return {
        "overallBandScore": model_band,
        "overallBandScoreSummary": f"Bài này đạt band {model_band}.",
        "bandTrajectoryAnalysis": {
            "current_band": current_band,
            "average_last_5": average,
            "trend": "improving",
            "criteria_breakdown": [{"criterion": "Task Achievement", "average": 5.5}],
            "trend_explanation": f"Bài này ở band {current_band}, thấp hơn trung bình.",
            "next_target": f"Từ band {current_band}, hãy cố gắng lên band 6.0.",
        },
        "criteriaFeedback": {"mainCriterion": {"bandScore": 5}},
        "improvedEssay": "The value was 5.5 in 2012.",
    }


@pytest.mark.parametrize("model,current,final,average,comparison", [
    (5.5, 5.5, 6.0, 6.7, "thấp hơn"),  # PC-J166 reported shape
    (5.5, 5.5, 6.5, 6.0, "cao hơn"),   # comparison crosses the average
    (7.0, 7.0, 6.0, 6.5, "thấp hơn"),  # final band can go down
    (5.5, 5.5, 6.0, 6.0, "bằng"),
    (6.0, 5.5, 6.0, 6.7, "thấp hơn"),  # WM-1029: stale trajectory alone
    (5.5, 6.0, 6.0, 6.7, "thấp hơn"),  # numeric trajectory right, prose still old
])
def test_corrected_band_rebuilds_claims_without_rewriting_history(
    model, current, final, average, comparison,
):
    feedback = _feedback(model, current, average)
    original = deepcopy(feedback)
    align_overall_band_feedback(feedback, final)

    trajectory = feedback["bandTrajectoryAnalysis"]
    assert feedback["overallBandScore"] == trajectory["current_band"] == final
    assert f"band {final:.1f}" in feedback["overallBandScoreSummary"]
    assert f"band {final:.1f}" in trajectory["trend_explanation"]
    assert comparison in trajectory["trend_explanation"]
    assert f"({average:g})" in trajectory["trend_explanation"]
    assert f"band {final + 0.5:.1f}" in trajectory["next_target"]
    for key in ("average_last_5", "trend", "criteria_breakdown"):
        assert trajectory[key] == original["bandTrajectoryAnalysis"][key]
    assert feedback["criteriaFeedback"] == original["criteriaFeedback"]
    assert feedback["improvedEssay"] == original["improvedEssay"]


def test_matching_band_preserves_narrative_and_is_idempotent():
    feedback = _feedback(6.0, 6.0)
    original = deepcopy(feedback)
    align_overall_band_feedback(feedback, 6.0)
    assert feedback == original

    feedback = _feedback()
    align_overall_band_feedback(feedback, 6.0)
    aligned = deepcopy(feedback)
    align_overall_band_feedback(feedback, 6.0)
    assert feedback == aligned


@pytest.mark.parametrize("current", [None, "old", True, float("nan"), {}, 10])
def test_missing_or_invalid_current_band_is_repaired(current):
    feedback = _feedback(6.0, current)
    align_overall_band_feedback(feedback, 6.0)
    assert feedback["bandTrajectoryAnalysis"]["current_band"] == 6.0
    assert "band 6.0" in feedback["bandTrajectoryAnalysis"]["trend_explanation"]


@pytest.mark.parametrize("average", [None, "unknown", True, float("inf"), {}, 10])
def test_invalid_average_does_not_break_grading_or_invent_comparison(average):
    feedback = _feedback(average=average)
    align_overall_band_feedback(feedback, 6.0)
    assert feedback["bandTrajectoryAnalysis"]["trend_explanation"] == "Bài này đạt band 6.0."


@pytest.mark.parametrize("trajectory", [None, {}])
def test_absent_history_stays_absent_and_empty_trajectory_is_repaired(trajectory):
    feedback = _feedback()
    feedback["bandTrajectoryAnalysis"] = trajectory
    align_overall_band_feedback(feedback, 6.0)
    if trajectory is None:
        assert feedback["bandTrajectoryAnalysis"] is None
    else:
        assert feedback["bandTrajectoryAnalysis"]["current_band"] == 6.0


@pytest.mark.parametrize("prefix", ["", "  "])
def test_qualitative_overview_and_missing_image_caveat_survive(prefix):
    feedback = _feedback()
    feedback["overallBandScoreSummary"] = "Bố cục rõ ràng. Cần kiểm tra lại số liệu."
    summary = feedback["overallBandScoreSummary"]
    align_overall_band_feedback(feedback, 6.0)
    assert feedback["overallBandScoreSummary"] == summary

    feedback = _feedback()
    feedback["overallBandScoreSummary"] = (
        prefix + GeminiWritingGrader._MISSING_IMAGE_CAVEAT + feedback["overallBandScoreSummary"]
    )
    align_overall_band_feedback(feedback, 6.0)
    assert summary_flags_missing_image(feedback["overallBandScoreSummary"])
    assert "band 6.0" in feedback["overallBandScoreSummary"]
    assert "5.5" not in feedback["overallBandScoreSummary"]


@pytest.mark.parametrize("score", ["5.5", "5,5", "5", "5.0"])
def test_numeric_summary_is_rebuilt_and_keeps_essay_specific_advice(score):
    feedback = _feedback()
    feedback["overallBandScoreSummary"] = (
        f"Bài này đạt band {score}. Bố cục rõ ràng. Cần kiểm tra lại số liệu."
    )
    align_overall_band_feedback(feedback, 6.0)
    assert feedback["overallBandScoreSummary"] == (
        "Bài viết đạt band 6.0. Bố cục rõ ràng. Cần kiểm tra lại số liệu."
    )


def test_unrelated_numbers_in_qualitative_advice_are_preserved():
    feedback = _feedback()
    advice = "Bố cục có 2 phần rõ ràng. Cần kiểm tra số liệu 2012 và 2024."
    feedback["overallBandScoreSummary"] = f"Bài này đạt 5.5. {advice}"
    align_overall_band_feedback(feedback, 6.0)
    assert feedback["overallBandScoreSummary"] == f"Bài viết đạt band 6.0. {advice}"


def test_target_does_not_exceed_band_nine():
    feedback = _feedback(8.5, 8.5)
    align_overall_band_feedback(feedback, 9.0)
    assert feedback["bandTrajectoryAnalysis"]["next_target"].startswith("Duy trì band 9.0")
