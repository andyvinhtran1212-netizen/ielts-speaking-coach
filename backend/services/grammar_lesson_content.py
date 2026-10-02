"""Frozen, practice-only content for assigned MASTER30 lessons.

These questions come from reviewed Grammar Wiki Quick Checks. They are not
selected from any MASTER30 diagnostic, confirmation, or holdout pool.
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
CURRENT_VERSION = "v1"
_VERSION_RE = re.compile(r"^v[1-9][0-9]*$")
_LESSON_RE = re.compile(r"^M30-B(?:0[1-9]|[12][0-9]|30)$")


def _canonical_bytes(value: dict[str, Any]) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def content_sha256(value: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


@lru_cache(maxsize=8)
def load_version(version: str = CURRENT_VERSION) -> dict[str, Any]:
    if not _VERSION_RE.fullmatch(version):
        raise ValueError("Invalid Grammar lesson practice version")
    path = PRACTICE_ROOT / f"{version}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != version or not isinstance(data.get("lessons"), dict):
        raise ValueError("Grammar lesson practice package is invalid")
    for lesson_id, lesson in data["lessons"].items():
        if not _LESSON_RE.fullmatch(lesson_id):
            raise ValueError(f"Invalid Grammar lesson ID: {lesson_id}")
        article = lesson.get("article") or {}
        category, slug = article.get("category"), article.get("slug")
        if not isinstance(category, str) or not isinstance(slug, str):
            raise ValueError(f"Missing article for {lesson_id}")
        if not (CONTENT_ROOT / category / f"{slug}.md").is_file():
            raise ValueError(f"Missing Grammar Wiki article for {lesson_id}")
        if not str(lesson.get("source_bank_code") or "").startswith("G-"):
            raise ValueError(f"Missing reviewed Quick Check provenance for {lesson_id}")
        questions = lesson.get("questions")
        if not isinstance(questions, list) or len(questions) < 8:
            raise ValueError(f"Grammar lesson {lesson_id} needs at least eight questions")
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
        "article": lesson["article"],
        "questions": questions,
    }
