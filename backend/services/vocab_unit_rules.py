"""Pure validation and deterministic grading rules for curated vocab units.

No database, web-framework, or environment imports belong here. Content CI and
editors can therefore validate a pilot package offline without Supabase secrets.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

GRADER_VERSION = "vocab-unit-rules-v1"
MASTERY_DIMENSIONS = (
    "meaning_recall",
    "usage_control",
    "productive_transfer",
)
REVIEW_TYPES = ("language", "pedagogy", "assessment")


class VocabUnitRuleError(ValueError):
    """Content or learner input is incompatible with the deterministic rules."""


def canonical_version_hash(
    content: dict[str, Any],
    sources: list[Any],
    tasks: list[dict[str, Any]],
) -> str:
    """Hash every authored input that defines an immutable learning version."""
    artifact = {"content": content, "sources": sources, "tasks": tasks}
    raw = json.dumps(
        artifact, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


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


def _matches_ordered_frame(
    answer: str,
    frame: list[Any],
    maximum_gap_words: int,
) -> bool:
    """Match trusted token slots in order without accepting arbitrary regexes."""
    tokens = answer.split()
    slots = [
        [candidate.split() for candidate in (
            _normalise_answer(item) for item in _string_list(slot)
        ) if candidate]
        for slot in frame
    ]
    if not slots or any(not slot for slot in slots):
        return False

    @lru_cache(maxsize=None)
    def match_slot(slot_index: int, previous_end: int) -> bool:
        if slot_index >= len(slots):
            return True
        for candidate in slots[slot_index]:
            width = len(candidate)
            latest = len(tokens) - width
            for start in range(previous_end, latest + 1):
                if slot_index and start - previous_end > maximum_gap_words:
                    break
                if tokens[start:start + width] != candidate:
                    continue
                if match_slot(slot_index + 1, start + width):
                    return True
        return False

    return match_slot(0, 0)


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
        checks = group_hits + int(word_ok) + int(forbidden_ok)
        denominator = len(required_groups) + 2
        required_frames = key.get("required_frames") or []
        if required_frames:
            if not isinstance(required_frames, list) or any(
                not isinstance(frame, list) for frame in required_frames
            ):
                raise VocabUnitRuleError("required_frames phải là một mảng frame")
            if len(required_frames) > 8 or any(
                len(frame) < 2 or len(frame) > 8 for frame in required_frames
            ):
                raise VocabUnitRuleError("required_frames vượt giới hạn 8 frame/8 slot")
            if any(
                not isinstance(slot, list)
                or not slot
                or len(slot) > 24
                or any(
                    not isinstance(item, str) or not item.strip() or len(item) > 80
                    for item in slot
                )
                for frame in required_frames
                for slot in frame
            ):
                raise VocabUnitRuleError("required_frames có slot không hợp lệ")
            maximum_gap_words = int(key.get("maximum_gap_words") or 4)
            if maximum_gap_words < 0 or maximum_gap_words > 20:
                raise VocabUnitRuleError("maximum_gap_words phải nằm trong khoảng 0–20")
            frame_ok = any(
                _matches_ordered_frame(normalised, frame, maximum_gap_words)
                for frame in required_frames
            )
            checks += int(frame_ok)
            denominator += 1
        score = checks / max(1, denominator)
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
                continue
            parsed = urlparse(_text(source.get("url")))
            if parsed.scheme != "https" or not parsed.hostname:
                errors.append(f"sources[{index}].url phải là HTTPS URL hợp lệ")
    active_tasks = [task for task in tasks if task.get("status") == "active"]
    dimensions = {task.get("dimension") for task in active_tasks}
    missing = set(MASTERY_DIMENSIONS) - dimensions
    if missing:
        errors.append(f"Thiếu task active cho dimensions: {', '.join(sorted(missing))}")
    if len(active_tasks) < 4:
        errors.append("Cần ít nhất 4 task active cho một published version")
    expected_dimensions = {
        "meaning_recall": "meaning_recall",
        "error_repair": "usage_control",
        "controlled_gap": "usage_control",
        "productive_transfer": "productive_transfer",
    }
    for index, task in enumerate(active_tasks, start=1):
        if not _text(task.get("prompt")):
            errors.append(f"tasks[{index}].prompt là bắt buộc")
        key = task.get("answer_key")
        if not isinstance(key, dict):
            errors.append(f"tasks[{index}].answer_key phải là object")
            continue
        task_type = str(task.get("task_type") or "")
        expected = expected_dimensions.get(task_type)
        if not expected:
            errors.append(f"tasks[{index}].task_type không được hỗ trợ")
            continue
        if task.get("dimension") != expected:
            errors.append(
                f"tasks[{index}].dimension phải là {expected} cho {task_type}"
            )
        sample = key.get("model_answer")
        if not isinstance(sample, str) or not sample.strip():
            accepted = _string_list(key.get("accepted"))
            sample = accepted[0] if accepted else None
        if not sample:
            errors.append(f"tasks[{index}] thiếu model answer để kiểm định")
            continue
        try:
            sample_result = grade_response(task, {"answer": sample})
        except (VocabUnitRuleError, TypeError, ValueError) as exc:
            errors.append(f"tasks[{index}] không chấm được model answer: {exc}")
        else:
            if sample_result["correct"] is not True:
                errors.append(
                    f"tasks[{index}] tự chấm sai model answer "
                    f"(score={sample_result['score']})"
                )
    return errors
