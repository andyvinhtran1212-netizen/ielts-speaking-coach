"""Align AI-authored overall-band claims after deterministic band rounding."""

import math
import re

from services.gemini_writing_grader import (
    GeminiWritingGrader,
    MISSING_IMAGE_CAVEAT_MARKER,
    summary_flags_missing_image,
)


# Match score language, never a quantity merely equal to an old band.
# Kept in sync with instructor-compose-util.js by shared preview/persist tests.
_BAND_CLAIM = re.compile(
    r"(?:^|[^\w])(?:band(?:\s+score)?|score|điểm|overall|kết\s+quả(?:\s+tổng\s+thể)?|"
    r"your\s+(?:essay|writing)\s+(?:achieves|scores|is\s+at)|"
    r"(?:bài(?:\s+(?:viết|làm))?(?:\s+(?:này|của\s+(?:em|bạn)))?|em|bạn)"
    r"\s+(?:hiện\s+)?(?:đạt|ở(?:\s+mức)?))\s*"
    r"(?:(?:hiện tại|tổng|của em|của bạn|bài này|là|is|ở|mức|band|score)\s+)*"
    r"[:=]?\s*(?P<band>[0-9](?:[.,]\d+)?)"
    r"(?!\w|[.,]\d|\s*(?:phút|câu|từ|đoạn|lần|ý|minutes?|words?|sentences?|paragraphs?)\b)",
    re.IGNORECASE,
)
# Accept the "overall" wording _BAND_CLAIM recognises ("target overall is 7.0"),
# so target advice is not mistaken for a wrong attained score.
_TARGET_BAND = re.compile(
    r"(?:^|[^\w])(?:để\s+(?:lên|đạt(?:\s+được)?)|muốn[^.!?;:\n,]*?|"
    r"to\s+(?:reach|achieve|get)|target|aim(?:ing)?\s+(?:for|at)|goal|"
    r"mục\s+tiêu[^.!?;:\n,]*?)"
    r"\s+(?:(?:is|là)\s+)?(?:(?:an?|the)\s+)?"
    r"(?:band(?:\s+score)?|overall(?:\s+band)?(?:\s+score)?)(?:\s+of)?"
    r"\s*(?:(?:is|là)\s+)?[:=]?\s*"
    r"(?P<band>[0-9](?:[.,]\d+)?)(?!\w|[.,]\d)",
    re.IGNORECASE,
)


def _has_stale_claim(sentence: str, overall: float) -> bool:
    # Match each target's number, so a later current-band claim in the same
    # sentence cannot hide behind advice ("target band 7, currently band 5.5").
    targets = {
        match.end("band") for match in _TARGET_BAND.finditer(sentence)
        if float(match["band"].replace(",", ".")) >= overall
    }
    return any(
        float(match["band"].replace(",", ".")) != overall
        and match.end("band") not in targets
        for match in _BAND_CLAIM.finditer(sentence)
    )


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
        caveat = (
            GeminiWritingGrader._MISSING_IMAGE_CAVEAT
            if summary_flags_missing_image(summary) else ""
        )
        body = summary
        while summary_flags_missing_image(body):
            body = body.lstrip()
            marker_end = body.index(MISSING_IMAGE_CAVEAT_MARKER) + len(MISSING_IMAGE_CAVEAT_MARKER)
            end = re.search(r"[.!?](?:\s|$)|[\r\n]", body[marker_end:])
            body = body[marker_end + end.end():].lstrip() if end else ""
        sentences = re.split(r"(?<=[.!?])\s+", body)
        kept = [sentence for sentence in sentences if not _has_stale_claim(sentence, overall)]
        removed_claim = len(kept) != len(sentences)
        if removed_claim or caveat:
            qualitative = " ".join(kept)
            feedback["overallBandScoreSummary"] = (
                caveat + (f"Bài viết đạt band {overall:.1f}. " if removed_claim else "")
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
