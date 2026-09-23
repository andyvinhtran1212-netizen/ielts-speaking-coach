"""Pure, reveal-scoped feedback for LISTENING-0006 programme practice."""

from __future__ import annotations

from typing import Any

from services.listening_test_grader import grade_report_only_attempt


class FeedbackUnavailable(ValueError):
    """The authored review material cannot safely support a reveal."""


def build_guided_feedback(
    q_num: int,
    first_answer: str,
    exercise_rows: list[dict[str, Any]],
    replay_policy: str,
) -> dict[str, Any]:
    """Return only one revealed item's reviewed material, never the full key.

    The report-only grader remains the canonical objective comparison. Its
    aggregate return also contains unrevealed solutions and transcripts, so
    this function deliberately constructs an allowlisted single-item shape.
    """
    report = grade_report_only_attempt(
        [{"q_num": q_num, "user_answer": first_answer}], exercise_rows,
    )
    item = next(
        (value for value in report["per_question"] if value["q_num"] == q_num),
        None,
    )
    if not item or item["state"] not in {"checked", "unscored"}:
        raise FeedbackUnavailable("question has no valid review material")

    review = report["review"]
    raw_solution = review["solutions"].get(str(q_num)) or {}
    solution = raw_solution if isinstance(raw_solution, dict) else {}
    raw_self_review = review["self_review"].get(str(q_num)) or {}
    self_review = raw_self_review if isinstance(raw_self_review, dict) else {}
    raw_references = self_review.get("reference_answers")
    raw_facts = self_review.get("required_facts")
    raw_optional_facts = self_review.get("optional_facts")
    references = [str(value) for value in (
        raw_references if isinstance(raw_references, list) else []
    )
                  if isinstance(value, str) and value.strip()]
    facts = [str(value) for value in (
        raw_facts if isinstance(raw_facts, list) else []
    )
             if isinstance(value, str) and value.strip()]
    optional_facts = [str(value) for value in (
        raw_optional_facts if isinstance(raw_optional_facts, list) else []
    ) if isinstance(value, str) and value.strip()]
    rationale = str(self_review.get("rationale") or "").strip()
    core_info = str(self_review.get("core_info") or "").strip()
    answer_sentence = str(self_review.get("answer_sentence") or "").strip()
    if item["state"] == "unscored" and not (
        references or facts or optional_facts or rationale
        or core_info or answer_sentence
    ):
        raise FeedbackUnavailable("self-review reference is unavailable")

    raw_window = review["audio_windows"].get(str(q_num)) or {}
    window = None
    if replay_policy == "allowed" and isinstance(raw_window, dict):
        start, end = raw_window.get("start"), raw_window.get("end")
        if isinstance(start, (int, float)) and isinstance(end, (int, float)) \
                and 0 <= start < end:
            window = {"start": start, "end": end}

    return {
        "q_num": q_num,
        "first_answer": first_answer,
        "state": item["state"],
        "correct": item["correct"] if item["state"] == "checked" else None,
        "expected": item.get("expected") or [],
        "rationale": str(solution.get("rationale") or "").strip(),
        "reference_answers": references,
        "required_facts": facts,
        "optional_facts": optional_facts,
        "self_review_rationale": rationale,
        "core_info": core_info,
        "answer_sentence": answer_sentence,
        "audio_window": window,
    }
