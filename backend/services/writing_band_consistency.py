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
# Bare "overall" often introduces a count ("Overall 3 main points"), so it is a
# claim only before band/score, ":"/"=" or a score modifier ("is", "là",
# "hiện tại", "của bạn"…), or a valid band that ends the clause (punctuation,
# a dash, "band"/"điểm", or a "/ 9", "out of 9", "trên 9" denominator).
_BAND_CLAIM = re.compile(
    r"(?:^|[^\w])(?:band(?:\s+score)?|score|điểm|"
    r"overall(?:\s+(?:band|score)|(?=\s*(?:[:=]|(?:hiện tại|tổng|của em|của bạn|bài này|là|is|ở|mức)\s))|"
    r"(?=\s+(?:[0-8](?:[.,][05])?|9(?:[.,]0)?)(?![.,]?\d)(?:[ \t]*(?:/|out[ \t]+of|trên)[ \t]*9(?:[.,]0)?(?![.,]?\d)|[ \t]*(?:[.!?;,:()\"'”’\r\n—–]|$)|[ \t]+-(?:\s|$)|[ \t]+(?:band|điểm)(?!\w))))|"
    r"kết\s+quả(?:\s+tổng\s+thể)?|"
    r"your\s+(?:essay|writing)\s+(?:achieves|scores|is\s+at)|"
    r"(?:bài(?:\s+(?:viết|làm))?(?:\s+(?:này|của\s+(?:em|bạn)))?|em|bạn)"
    r"\s+(?:hiện\s+)?(?:đạt|ở(?:\s+mức)?))\s*"
    r"(?:(?:hiện tại|tổng|của em|của bạn|bài này|là|is|ở|mức|band|score)\s+)*"
    r"[:=]?\s*(?P<band>[0-9](?:[.,]\d+)?)"
    r"(?!\w|[.,]\d|\s*(?:phút|câu|từ|đoạn|lần|ý|minutes?|words?|sentences?|paragraphs?|"
    r"ideas?|reasons?|examples?|arguments?|issues?|errors?|mistakes?|"
    r"ý\s+chính|luận\s+điểm|lỗi)\b)",
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


_SENTENCE_START = re.compile(r"[.!?]\s+|[\r\n]")
_WARNING = "⚠️"


def _targets(sentence: str, overall: float) -> set[int]:
    """End positions of advice targeting a band at or above the final band."""
    return {
        match.end("band") for match in _TARGET_BAND.finditer(sentence)
        if float(match["band"].replace(",", ".")) >= overall
    }


def _claims(sentence: str, overall: float) -> list[float]:
    # Match each target's number, so a later current-band claim in the same
    # sentence cannot hide behind advice ("target band 7, currently band 5.5").
    targets = _targets(sentence, overall)
    return [
        float(match["band"].replace(",", "."))
        for match in _BAND_CLAIM.finditer(sentence)
        if match.end("band") not in targets
    ]


def _has_stale_claim(sentence: str, overall: float) -> bool:
    return any(band != overall for band in _claims(sentence, overall))


def _has_current_claim(sentence: str, overall: float) -> bool:
    return overall in _claims(sentence, overall)


def _as_sentence(text: str) -> str:
    text = text.strip()
    text = text[:1].upper() + text[1:]
    return text if re.search(r"[.!?]$", text) else text + "."


def _without_stale_claim(sentence: str, overall: float) -> str | None:
    """Drop a stale-claim sentence, but keep target advice after a ';'.

    Keep only ';' clauses carrying their own target advice: any other clause
    may depend on the dropped score ("thấp hơn mức trung bình 6.0").
    """
    if not _has_stale_claim(sentence, overall):
        return sentence
    advice = [
        clause.strip() for clause in sentence.split(";")
        if _targets(clause, overall) and not _has_stale_claim(clause, overall)
    ]
    return _as_sentence("; ".join(advice)) if advice else None


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
        # Cut only the leading ⚠️ and the sentence/line holding the marker;
        # sentences written before the marker are content, not caveat.
        body = summary
        leading = []
        while summary_flags_missing_image(body):
            body = body.lstrip()[len(_WARNING):]
            marker = body.index(MISSING_IMAGE_CAVEAT_MARKER)
            start = max(
                (match.end() for match in _SENTENCE_START.finditer(body[:marker])), default=0
            )
            if body[:start].strip():
                leading.append(_as_sentence(body[:start]))
            marker_end = marker + len(MISSING_IMAGE_CAVEAT_MARKER)
            end = re.search(r"[.!?](?:\s|$)|[\r\n]", body[marker_end:])
            body = body[marker_end + end.end():].lstrip() if end else ""
        body = " ".join(part for part in [*leading, body] if part)
        sentences = re.split(r"(?<=[.!?])\s+", body)
        kept = [
            sentence for sentence in
            (_without_stale_claim(sentence, overall) for sentence in sentences)
            if sentence is not None
        ]
        removed_claim = any(_has_stale_claim(sentence, overall) for sentence in sentences)
        # A kept sentence may already state the final band; never repeat it.
        add_band = removed_claim and not any(
            _has_current_claim(sentence, overall) for sentence in kept
        )
        if removed_claim or caveat:
            qualitative = " ".join(kept)
            feedback["overallBandScoreSummary"] = (
                caveat + (f"Bài viết đạt band {overall:.1f}. " if add_band else "")
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
