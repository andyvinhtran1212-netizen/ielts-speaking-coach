"""Pure validation and deterministic grading rules for curated vocab units.

No database, web-framework, or environment imports belong here. Content CI and
editors can therefore validate a pilot package offline without Supabase secrets.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

GRADER_VERSION = "vocab-unit-rules-v1"
MASTERY_DIMENSIONS = (
    "meaning_recall",
    "usage_control",
    "productive_transfer",
)
REVIEW_TYPES = ("language", "pedagogy", "assessment")


class VocabUnitRuleError(ValueError):
    """Content or learner input is incompatible with the deterministic rules."""


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _normalise_answer(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    value = re.sub(r"[^\w'\-]+", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()


def _contains_phrase(answer: str, phrase: str) -> bool:
    """Token-boundary phrase match; avoids `to` matching `today`, etc."""
    return bool(phrase) and f" {phrase} " in f" {answer} "


def grade_response(task: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
    """Deterministically grade a task; caller-supplied correctness is ignored."""
    raw_answer = response.get("answer")
    if not isinstance(raw_answer, str):
        raise VocabUnitRuleError("Câu trả lời phải là văn bản")
    answer = raw_answer.strip()
    if not answer:
        raise VocabUnitRuleError("Câu trả lời không được để trống")
    if len(answer) > 1200:
        raise VocabUnitRuleError("Câu trả lời dài quá giới hạn 1.200 ký tự")
    key = task.get("answer_key")
    if not isinstance(key, dict):
        raise VocabUnitRuleError("Task chưa có answer key hợp lệ")

    normalised = _normalise_answer(answer)
    accepted = [_normalise_answer(item) for item in _string_list(key.get("accepted"))]
    task_type = str(task.get("task_type") or "")
    score = 0.0

    if task_type in {"meaning_recall", "error_repair", "controlled_gap"}:
        mode = key.get("match", "exact")
        if mode == "exact":
            score = 1.0 if normalised in accepted else 0.0
        elif mode == "contains_all":
            score = 1.0 if accepted and all(
                _contains_phrase(normalised, item) for item in accepted
            ) else 0.0
        else:
            raise VocabUnitRuleError(f"Kiểu chấm '{mode}' chưa được hỗ trợ")
    elif task_type == "productive_transfer":
        required_groups = key.get("required_groups") or []
        if not isinstance(required_groups, list):
            raise VocabUnitRuleError("required_groups phải là một mảng")
        group_hits = 0
        for group in required_groups:
            alternatives = [_normalise_answer(item) for item in _string_list(group)]
            if alternatives and any(_contains_phrase(normalised, item) for item in alternatives):
                group_hits += 1
        minimum_words = int(key.get("minimum_words") or 0)
        word_ok = len(normalised.split()) >= minimum_words
        forbidden = [_normalise_answer(item) for item in _string_list(key.get("forbidden"))]
        forbidden_ok = not any(_contains_phrase(normalised, item) for item in forbidden)
        denominator = max(1, len(required_groups) + 2)
        score = (group_hits + int(word_ok) + int(forbidden_ok)) / denominator
    else:
        raise VocabUnitRuleError(f"Task type '{task_type}' chưa được hỗ trợ")

    score = round(max(0.0, min(1.0, score)), 4)
    correct = score == 1.0
    return {
        "correct": correct,
        "score": score,
        "feedback_vi": key.get("success_vi") if correct else key.get("retry_vi"),
        "model_answer": key.get("model_answer"),
    }


def validate_for_publish(
    content: dict[str, Any],
    sources: list[Any],
    tasks: list[dict[str, Any]],
) -> list[str]:
    """Strict editorial validation, separate from the legacy card importer."""
    errors: list[str] = []
    required_text = (
        "title_vi",
        "learning_goal_vi",
        "sense",
        "construction",
        "communicative_function",
        "why_vietnamese_learners_struggle",
        "meaning_vi",
        "usage_vi",
        "contrast_vi",
        "production_prompt_vi",
        "memory_hook_vi",
    )
    for field in required_text:
        if not _text(content.get(field)):
            errors.append(f"content.{field} là bắt buộc")
    examples = content.get("examples")
    if not isinstance(examples, list) or len(examples) < 3:
        errors.append("content.examples cần ít nhất 3 ngữ cảnh khác nhau")
    else:
        for index, example in enumerate(examples, start=1):
            if not isinstance(example, dict) or not _text(example.get("en")) or not _text(example.get("vi")):
                errors.append(f"content.examples[{index}] cần en và vi")
    if not isinstance(sources, list) or not sources:
        errors.append("sources cần ít nhất 1 nguồn biên tập")
    else:
        for index, source in enumerate(sources, start=1):
            if not isinstance(source, dict) or not _text(source.get("title")) or not _text(source.get("url")):
                errors.append(f"sources[{index}] cần title và url")
    active_tasks = [task for task in tasks if task.get("status") == "active"]
    dimensions = {task.get("dimension") for task in active_tasks}
    missing = set(MASTERY_DIMENSIONS) - dimensions
    if missing:
        errors.append(f"Thiếu task active cho dimensions: {', '.join(sorted(missing))}")
    if len(active_tasks) < 4:
        errors.append("Cần ít nhất 4 task active cho một published version")
    for index, task in enumerate(active_tasks, start=1):
        if not _text(task.get("prompt")):
            errors.append(f"tasks[{index}].prompt là bắt buộc")
        if not isinstance(task.get("answer_key"), dict):
            errors.append(f"tasks[{index}].answer_key phải là object")
    return errors
