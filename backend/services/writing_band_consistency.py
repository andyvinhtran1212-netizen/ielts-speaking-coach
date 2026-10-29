"""Align AI-authored overall-band claims after deterministic band rounding."""

import math
import re

from services.gemini_writing_grader import (
    GeminiWritingGrader,
    summary_flags_missing_image,
)


_SCORE_NUMBER = re.compile(r"(?<![\w.,])[0-9](?:[.,]\d+)?(?!\w|[.,]\d)")


def _band(value: object) -> float | None:
    """Trajectory is an untyped model dict; an unusable band is also stale."""
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and 0 <= number <= 9 else None


def align_overall_band_feedback(feedback: dict, overall: float) -> None:
    """Apply forward at grading/edit writes; never rewrite stored source versions.

    Numeric substitution cannot repair comparisons (e.g. 'below average' may
    become false), or distinguish a historical score from this essay's score.
    Rebuild the affected narrative from the final band instead, without AI.
    """
    model_band = feedback["overallBandScore"]
    feedback["overallBandScore"] = overall
    trajectory = feedback.get("bandTrajectoryAnalysis")
    # Composed versions start from a shallow copy of a source version's JSON.
    # Never let trajectory updates mutate that immutable source object.
    if isinstance(trajectory, dict):
        trajectory = dict(trajectory)
        feedback["bandTrajectoryAnalysis"] = trajectory
    trajectory_band = (
        _band(trajectory.get("current_band")) if isinstance(trajectory, dict) else None
    )
    trajectory_stale = (
        isinstance(trajectory, dict)
        and trajectory_band != overall
    )
    changed = model_band != overall or trajectory_stale

    if changed:
        summary = feedback["overallBandScoreSummary"]
        # Replace complete score-bearing sentences, rather than substituting
        # numbers inside historical/target comparisons. Keep qualitative advice.
        stale_bands = {model_band, trajectory_band} - {None, overall}

        def has_score_claim(sentence: str) -> bool:
            numbers = _SCORE_NUMBER.findall(sentence)
            return bool(numbers) and (
                bool(re.search(r"\bband\b", sentence, re.IGNORECASE))
                or any(_band(n.replace(",", ".")) in stale_bands for n in numbers)
            )

        caveat = (
            GeminiWritingGrader._MISSING_IMAGE_CAVEAT
            if summary_flags_missing_image(summary) else ""
        )
        body = summary.lstrip().removeprefix(caveat) if caveat else summary
        sentences = re.split(r"(?<=[.!?])\s+", body)
        kept = [sentence for sentence in sentences if not has_score_claim(sentence)]
        if len(kept) != len(sentences):
            qualitative = " ".join(kept)
            feedback["overallBandScoreSummary"] = (
                f"{caveat}Bài viết đạt band {overall:.1f}. "
                + (qualitative or
                   "Hãy dựa vào nhận xét theo từng tiêu chí để chọn điểm cần cải thiện.")
            )

    if not isinstance(trajectory, dict):
        return
    trajectory["current_band"] = overall
    if not changed:
        return

    explanation = f"Bài này đạt band {overall:.1f}"
    average = _band(trajectory.get("average_last_5"))
    if average is not None:
        comparison = (
            "cao hơn" if overall > average else
            "thấp hơn" if overall < average else "bằng"
        )
        explanation += f", {comparison} mức trung bình 5 bài gần nhất ({average:g})"
    trajectory["trend_explanation"] = explanation + "."
    trajectory["next_target"] = (
        f"Mục tiêu tiếp theo là band {min(9.0, overall + 0.5):.1f}; "
        "ưu tiên cải thiện theo nhận xét ở từng tiêu chí."
        if overall < 9 else
        "Duy trì band 9.0 và tiếp tục luyện tập để giữ chất lượng ổn định."
    )
