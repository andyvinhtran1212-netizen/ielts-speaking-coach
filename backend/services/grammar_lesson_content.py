"""Frozen, practice-only content for assigned MASTER30 lessons.

v1 retains reviewed Grammar Wiki Quick Checks. v2 uses independently authored
MASTER30 practice and frozen teaching notes, approved by a senior content gate.
Neither package selects diagnostic, confirmation or holdout questions.
"""

from __future__ import annotations

import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any


CONTENT_ROOT = Path(__file__).resolve().parents[1] / "content"
PRACTICE_ROOT = CONTENT_ROOT / "master30-assigned-practice"
CURRENT_VERSION = "v2"
_VERSION_RE = re.compile(r"^v[1-9][0-9]*$")
_LESSON_RE = re.compile(r"^M30-B(?:0[1-9]|[12][0-9]|30)$")
REVIEW_FIELDS = (
    "title", "focus", "lesson_notes", "learning_objectives", "questions",
    "coverage_review",
)


def _canonical_bytes(value: dict[str, Any]) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def content_sha256(value: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def reviewed_content_sha256(lesson: dict[str, Any]) -> str:
    """Match the actual teaching/practice fields read by the independent reviewer."""
    if any(key not in lesson for key in REVIEW_FIELDS):
        raise ValueError("Reviewed MASTER30 content fields are missing")
    return content_sha256({key: lesson[key] for key in REVIEW_FIELDS})


def _validate_v2_review(data: dict[str, Any]) -> None:
    expected = {f"M30-B{number:02d}" for number in range(1, 31)}
    if set(data["lessons"]) != expected:
        raise ValueError("MASTER30 v2 needs all thirty reviewed lessons")
    review = json.loads((PRACTICE_ROOT / "v2-review.json").read_text(encoding="utf-8"))
    if (review.get("version") != "v2" or review.get("decision") != "approved"
            or review.get("reviewer_role") != "senior_content_gate"
            or set(review.get("lessons", {})) != expected):
        raise ValueError("MASTER30 v2 senior content approval is missing")
    for lesson_id, lesson in data["lessons"].items():
        approval = review["lessons"][lesson_id]
        if (approval.get("decision") != "approved"
                or approval.get("content_sha256") != reviewed_content_sha256(lesson)):
            raise ValueError(f"Senior content approval does not match {lesson_id}")
        if (not isinstance(lesson.get("lesson_notes"), str)
                or len(lesson["lesson_notes"].strip()) < 1000
                or not isinstance(lesson.get("learning_objectives"), list)
                or not lesson["learning_objectives"]
                or not all(isinstance(v, str) and v.strip()
                           for v in lesson["learning_objectives"])
                or lesson.get("source_kind") != "master30-authored-practice"):
            raise ValueError(f"Missing reviewed teaching/provenance for {lesson_id}")


@lru_cache(maxsize=8)
def load_version(version: str = CURRENT_VERSION) -> dict[str, Any]:
    if not _VERSION_RE.fullmatch(version):
        raise ValueError("Invalid Grammar lesson practice version")
    path = PRACTICE_ROOT / f"{version}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != version or not isinstance(data.get("lessons"), dict):
        raise ValueError("Grammar lesson practice package is invalid")
    if version == "v2":
        _validate_v2_review(data)
    all_question_ids: set[str] = set()
    for lesson_id, lesson in data["lessons"].items():
        if not _LESSON_RE.fullmatch(lesson_id):
            raise ValueError(f"Invalid Grammar lesson ID: {lesson_id}")
        article = lesson.get("article")
        if version != "v2" or article:
            article = article or {}
            category, slug = article.get("category"), article.get("slug")
            if (not isinstance(category, str) or not isinstance(slug, str)
                    or not re.fullmatch(r"[a-z0-9-]+", category)
                    or not re.fullmatch(r"[a-z0-9-]+", slug)):
                raise ValueError(f"Missing article for {lesson_id}")
            if not (CONTENT_ROOT / category / f"{slug}.md").is_file():
                raise ValueError(f"Missing Grammar Wiki article for {lesson_id}")
        if version != "v2" and not str(lesson.get("source_bank_code") or "").startswith("G-"):
            raise ValueError(f"Missing reviewed Quick Check provenance for {lesson_id}")
        questions = lesson.get("questions")
        if not isinstance(questions, list) or not 8 <= len(questions) <= 20:
            raise ValueError(f"Grammar lesson {lesson_id} needs eight to twenty questions")
        seen: set[str] = set()
        for question in questions:
            qid = question.get("id")
            options = question.get("options")
            answer = question.get("correct_index")
            if (
                not isinstance(qid, str) or not qid or qid in seen
                or not isinstance(question.get("prompt"), str)
                or not isinstance(question.get("explanation"), str)
                or not question["explanation"].strip()
                or not isinstance(options, list) or len(options) < 2
                or not all(isinstance(option, str) for option in options)
                or type(answer) is not int or not 0 <= answer < len(options)
            ):
                raise ValueError(f"Invalid practice question in {lesson_id}: {qid}")
            seen.add(qid)
            if version == "v2":
                mechanisms = question.get("distractor_mechanisms")
                provenance = question.get("provenance") or {}
                if (qid in all_question_ids
                        or not qid.startswith(f"M30P2-{lesson_id[-3:]}-")
                        or len(options) != 4
                        or any(not value.strip() for value in options)
                        or len({value.strip().casefold() for value in options}) != 4
                        or not isinstance(mechanisms, list) or len(mechanisms) != 4
                        or mechanisms[answer] is not None
                        or any(not isinstance(value, str) or value not in
                               {"N1", "N2", "N3", "N4", "N5", "N6"}
                               for index, value in enumerate(mechanisms) if index != answer)
                        or provenance.get("kind") != "newly_authored"
                        or not str(provenance.get("basis") or "").strip()):
                    raise ValueError(f"Invalid reviewed MASTER30 practice: {qid}")
                all_question_ids.add(qid)
    return data


def lesson_content(
    lesson_id: str, version: str = CURRENT_VERSION
) -> dict[str, Any] | None:
    if not _LESSON_RE.fullmatch(lesson_id):
        return None
    try:
        return load_version(version)["lessons"].get(lesson_id)
    except FileNotFoundError:
        return None


def public_lesson(
    lesson: dict[str, Any], answers: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Release a key and explanation only after that question was answered."""
    answered = answers or {}
    questions = []
    for row in lesson["questions"]:
        question = {
            "id": row["id"],
            "prompt": row["prompt"],
            "options": row["options"],
        }
        saved = answered.get(row["id"])
        if isinstance(saved, dict):
            question.update({
                "selected_index": saved["selected_index"],
                "is_correct": saved["is_correct"],
                "correct_index": row["correct_index"],
                "explanation": row["explanation"],
            })
        questions.append(question)
    return {
        "focus": lesson["focus"],
        "article": lesson.get("article"),
        "lesson_notes": lesson.get("lesson_notes"),
        "learning_objectives": lesson.get("learning_objectives", []),
        "questions": questions,
    }
