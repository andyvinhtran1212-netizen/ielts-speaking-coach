"""Pure validation for an Advanced Vocabulary self-paced package.

The importer must fail before touching the database.  This module deliberately
has no FastAPI, Supabase or filesystem mutation: the CLI supplies a package
directory, and callers receive a complete error/warning report.

The first-release contract is documented in
``docs/ADVANCED_VOCAB_SELF_PACED_SPEC.md``.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable


CORE_LESSON_IDS = tuple(f"ADV-T{i:02d}" for i in range(1, 31))
CORE_LESSON_SET = frozenset(CORE_LESSON_IDS)
CORE_REVIEW_IDS = tuple(f"R{i:02d}" for i in range(1, 7))
CORE_REVIEW_SET = frozenset(CORE_REVIEW_IDS)
ALLOWED_INPUTS = frozenset({"choice", "text", "boolean", "syllable", "match"})
ALLOWED_ACTIVITY_POLICIES = {
    "interaction_policy": frozenset({
        "auto_graded", "practice_recording", "read_only", "self_check",
    }),
    "grading_policy": frozenset({"automatic", "none", "self_check"}),
    "completion_policy": frozenset({"required", "optional", "reference_only"}),
    "reveal_policy": frozenset({
        "admin_only", "after_attempt", "after_guided_retry", "always",
    }),
}
NON_READY_AUDIO = frozenset({
    "missing", "pending_render", "rendered_review_required", "uploaded",
    "qc_failed", "source_script_missing",
})
WRITING_ACTIVITY_TYPE = "writing_reference"
SPEAKING_ACTIVITY_TYPE = "speaking_practice"
LISTENING_ACTIVITY_TYPE = "listening_lab"
READING_ACTIVITY_TYPE = "reading_lab"
LISTENING_LEARNER_QUESTION_FIELDS = frozenset({
    "question_number", "question_type", "stem", "options",
})
LISTENING_LEARNER_OPTION_FIELDS = frozenset({"key", "letter", "text"})
QUIZ_AUTHORED_ITEM_FIELDS = frozenset({
    "accept", "answer", "answer_index", "case_sensitive",
    "counts_toward_mastery", "explain", "headword", "hint", "input",
    "item_id", "legacy_id", "lexeme_id", "mask", "note", "options",
    "pair", "pairs", "points", "prompt", "question_type", "segments",
    "skill", "subtype", "type", "why_wrong",
})
QUIZ_OPTION_FIELDS = frozenset({"key", "letter", "text"})
SHA256_RE = re.compile(r"[0-9a-f]{64}", re.IGNORECASE)


@dataclass(frozen=True)
class ValidationIssue:
    severity: str
    code: str
    path: str
    message: str


@dataclass
class ValidationReport:
    package_path: str
    errors: list[ValidationIssue] = field(default_factory=list)
    warnings: list[ValidationIssue] = field(default_factory=list)
    checked_lessons: int = 0

    @property
    def schema_valid(self) -> bool:
        return not self.errors

    @property
    def publish_ready(self) -> bool:
        return self.schema_valid and not self.warnings

    def add(self, severity: str, code: str, path: Path | str, message: str) -> None:
        issue = ValidationIssue(severity, code, str(path), message)
        (self.errors if severity == "error" else self.warnings).append(issue)

    def to_dict(self) -> dict[str, Any]:
        return {
            "package_path": self.package_path,
            "schema_valid": self.schema_valid,
            "publish_ready": self.publish_ready,
            "checked_lessons": self.checked_lessons,
            "summary": {"errors": len(self.errors), "warnings": len(self.warnings)},
            "errors": [asdict(i) for i in self.errors],
            "warnings": [asdict(i) for i in self.warnings],
        }


def _read_json(path: Path, report: ValidationReport) -> dict[str, Any] | None:
    if not path.is_file():
        report.add("error", "FILE_MISSING", path, "Required JSON file is missing.")
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        report.add("error", "JSON_INVALID", path, f"Cannot parse JSON: {exc}")
        return None
    if not isinstance(value, dict):
        report.add("error", "JSON_ROOT_TYPE", path, "JSON root must be an object.")
        return None
    return value


def _canonical_checksum(value: dict[str, Any]) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _checksum_without(value: dict[str, Any], *field_path: str) -> str:
    clone = json.loads(json.dumps(value, ensure_ascii=False))
    parent: Any = clone
    for key in field_path[:-1]:
        parent = parent.get(key) if isinstance(parent, dict) else None
    if isinstance(parent, dict):
        parent.pop(field_path[-1], None)
    return _canonical_checksum(clone)


def lesson_content_checksum(lesson: dict[str, Any]) -> str:
    """Return the canonical lesson checksum without trusting embedded provenance."""
    return _checksum_without(lesson, "provenance", "content_checksum")


def _manifest_lesson_ids(manifest: dict[str, Any]) -> list[str]:
    rows = manifest.get("lessons") or []
    if not isinstance(rows, list):
        return []
    return [str(row.get("lesson_id") or "") for row in rows if isinstance(row, dict)]


def _manifest_review_ids(manifest: dict[str, Any]) -> list[str]:
    rows = manifest.get("reviews") or []
    if not isinstance(rows, list):
        return []
    return [str(row.get("review_id") or "") for row in rows if isinstance(row, dict)]


def _object_field(parent: dict[str, Any], key: str, path: Path,
                  report: ValidationReport, *, required: bool = True) -> dict[str, Any]:
    value = parent.get(key)
    if isinstance(value, dict):
        return value
    if value is not None or required:
        report.add("error", "OBJECT_FIELD_INVALID", path,
                   f"{key} must be an object.")
    return {}


def _walk(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _activities(lesson: dict[str, Any]) -> list[dict[str, Any]]:
    direct = lesson.get("activities")
    if isinstance(direct, list):
        return [a for a in direct if isinstance(a, dict)]
    flow = lesson.get("learning_flow")
    if isinstance(flow, dict) and isinstance(flow.get("activities"), list):
        return [a for a in flow["activities"] if isinstance(a, dict)]
    return []


def _validate_manifest(root: Path, manifest: dict[str, Any], report: ValidationReport) -> None:
    if not isinstance(manifest.get("lessons"), list):
        report.add("error", "MANIFEST_LESSONS_TYPE", root / "course-manifest.json",
                   "Manifest lessons must be an array.")
    ids = _manifest_lesson_ids(manifest)
    duplicates = sorted(k for k, n in Counter(ids).items() if k and n > 1)
    if duplicates:
        report.add("error", "DUPLICATE_LESSON_ID", root / "course-manifest.json",
                   f"Duplicate lesson IDs: {', '.join(duplicates)}")

    actual = set(ids)
    missing = sorted(CORE_LESSON_SET - actual)
    extras = sorted(actual - CORE_LESSON_SET)
    if missing:
        report.add("error", "CORE_LESSONS_MISSING", root / "course-manifest.json",
                   f"Missing first-release core lessons: {', '.join(missing)}")
    if extras:
        report.add("error", "NON_CORE_LESSONS_IN_RELEASE", root / "course-manifest.json",
                   f"First release must contain only T01-T30; remove: {', '.join(extras)}")
    if len(ids) != 30:
        report.add("error", "CORE_LESSON_COUNT", root / "course-manifest.json",
                   f"Expected 30 manifest lessons, found {len(ids)}.")

    audience = manifest.get("audience")
    if audience != "assigned_only":
        report.add("error", "AUDIENCE_POLICY", root / "course-manifest.json",
                   "Release 1 manifest must declare audience='assigned_only'.")

    review_ids = _manifest_review_ids(manifest)
    if set(review_ids) != CORE_REVIEW_SET or len(review_ids) != 6:
        report.add("error", "CORE_REVIEW_SET", root / "course-manifest.json",
                   "Release 1 manifest must contain exactly R01-R06 once each.")

    package_checksum = str(manifest.get("package_checksum") or "")
    if not SHA256_RE.fullmatch(package_checksum):
        report.add("error", "PACKAGE_CHECKSUM_INVALID", root / "course-manifest.json",
                   "Manifest package_checksum must be a SHA-256 hex digest.")
    elif package_checksum != _checksum_without(manifest, "package_checksum"):
        report.add("error", "PACKAGE_CHECKSUM_MISMATCH", root / "course-manifest.json",
                   "Manifest content no longer matches package_checksum.")


def _validate_mcq_options(lesson: dict[str, Any], path: Path,
                          report: ValidationReport) -> None:
    for node in _walk(lesson):
        q_type = str(node.get("question_type") or node.get("type") or "").lower()
        options = node.get("options")
        if q_type not in {"mcq", "choice"} or not isinstance(options, list):
            continue
        qid = node.get("item_id") or node.get("question_number") or node.get("id") or "?"
        if len(options) < 2:
            report.add("error", "MCQ_OPTION_COUNT", path,
                       f"Question {qid} needs at least two options; found {len(options)}.")
        keys: list[str] = []
        for index, option in enumerate(options):
            if isinstance(option, dict):
                keys.append(str(option.get("letter") or option.get("key") or index))
            else:
                keys.append(str(index))
        duplicate_keys = sorted(k for k, n in Counter(keys).items() if n > 1)
        if duplicate_keys:
            report.add("error", "MCQ_DUPLICATE_OPTION_KEY", path,
                       f"Question {qid} repeats option keys: {', '.join(duplicate_keys)}")
        if "answer_index" in node:
            answer_index = node["answer_index"]
            if (not isinstance(answer_index, int) or isinstance(answer_index, bool)
                    or not 0 <= answer_index < len(options)):
                report.add("error", "MCQ_ANSWER_INVALID", path,
                           f"Question {qid} has invalid answer_index={answer_index!r}.")
        elif "answer" in node:
            answer = node["answer"]
            if isinstance(answer, int) and not isinstance(answer, bool):
                valid_answer = 0 <= answer < len(options)
            else:
                valid_answer = str(answer) in keys
            if not valid_answer:
                report.add("error", "MCQ_ANSWER_INVALID", path,
                           f"Question {qid} answer={answer!r} does not identify an option.")


def _validate_activity_policies(lesson: dict[str, Any], path: Path,
                                report: ValidationReport) -> None:
    activities = _activities(lesson)
    if not activities:
        report.add("error", "ACTIVITIES_MISSING", path,
                   "Lesson has editorial blocks but no normalized activities contract.")

    seen_ids: set[str] = set()
    writing = []
    speaking = []
    listening = []
    reading = []
    for activity in activities:
        aid = str(activity.get("activity_id") or "")
        if not aid:
            report.add("error", "ACTIVITY_ID_MISSING", path, "Every activity needs activity_id.")
        elif aid in seen_ids:
            report.add("error", "ACTIVITY_ID_DUPLICATE", path, f"Duplicate activity_id: {aid}")
        else:
            seen_ids.add(aid)

        for key in ("interaction_policy", "grading_policy", "completion_policy",
                    "reveal_policy"):
            if key not in activity:
                report.add("error", "ACTIVITY_POLICY_MISSING", path,
                           f"Activity {aid or '?'} is missing {key}.")
            elif activity[key] not in ALLOWED_ACTIVITY_POLICIES[key]:
                report.add("error", "ACTIVITY_POLICY_INVALID", path,
                           f"Activity {aid or '?'} has invalid {key}={activity[key]!r}.")
        if activity.get("activity_type") == WRITING_ACTIVITY_TYPE:
            writing.append(activity)
        if activity.get("activity_type") == SPEAKING_ACTIVITY_TYPE:
            speaking.append(activity)
        if activity.get("activity_type") == LISTENING_ACTIVITY_TYPE:
            listening.append(activity)
        if activity.get("activity_type") == READING_ACTIVITY_TYPE:
            reading.append(activity)

    is_core_lesson = str(lesson.get("lesson_id") or "") in CORE_LESSON_SET
    if is_core_lesson and len(writing) != 1:
        report.add("error", "WRITING_ACTIVITY_COUNT", path,
                   "Each core lesson needs exactly one Writing Insight reference; "
                   f"found {len(writing)}.")
    for activity in writing:
        valid = (
            activity.get("interaction_policy") == "read_only"
            and activity.get("submittable") is False
            and activity.get("grading_policy") == "none"
            and activity.get("completion_policy") == "reference_only"
            and activity.get("reveal_policy") == "always"
            and activity.get("teacher_assignment_required_for_grading") is True
        )
        if not valid:
            report.add("error", "WRITING_BOUNDARY_VIOLATION", path,
                       "Writing Insight must be non-submittable, ungraded, reference-only, "
                       "and require a teacher assignment for grading.")
        if is_core_lesson:
            content = activity.get("content") or {}
            tasks = content.get("tasks") if isinstance(content, dict) else None
            task_1 = tasks.get("task_1") if isinstance(tasks, dict) else None
            task_2 = tasks.get("task_2") if isinstance(tasks, dict) else None
            if not isinstance(task_1, dict) or not isinstance(task_2, dict):
                report.add("error", "WRITING_REFERENCE_TASKS_MISSING", path,
                           "Writing Insight must contain Task 1 and Task 2 references.")
                continue
            for task_name, task in (("Task 1", task_1), ("Task 2", task_2)):
                models = task.get("model_answers")
                bands = {
                    str(model.get("band") or "")
                    for model in models if isinstance(model, dict)
                } if isinstance(models, list) else set()
                if bands != {"7.0", "8.0"}:
                    report.add("error", "WRITING_MODEL_REFERENCES_INCOMPLETE", path,
                               f"{task_name} needs authored Band 7.0 and Band 8.0 references.")
            illustration_exts = {
                Path(str(ref)).suffix.lower()
                for ref in task_1.get("illustrations") or []
            }
            if not {".svg", ".png"} <= illustration_exts:
                report.add("error", "WRITING_TASK1_ARTWORK_INCOMPLETE", path,
                           "Task 1 needs both SVG and PNG illustration references.")
            idea_sections = task_2.get("idea_sections")
            if not isinstance(idea_sections, list) or len(idea_sections) < 12:
                report.add("error", "WRITING_TASK2_IDEAS_INCOMPLETE", path,
                           "Task 2 needs all 12 authored idea-bank sections.")

    if is_core_lesson and len(speaking) != 1:
        report.add("error", "SPEAKING_ACTIVITY_COUNT", path,
                   f"Each core lesson needs exactly one Speaking practice; found {len(speaking)}.")
    for activity in speaking:
        valid = (
            activity.get("interaction_policy") == "practice_recording"
            and activity.get("grading_policy") == "none"
            and activity.get("completion_policy") == "optional"
            and activity.get("graded_by_default") is False
        )
        if not valid:
            report.add("error", "SPEAKING_DEFAULT_GRADING", path,
                       "Speaking practice must be optional practice recording and "
                       "ungraded by default.")

    if is_core_lesson:
        if len(reading) != 1:
            report.add("error", "READING_ACTIVITY_COUNT", path,
                       f"Each core lesson needs exactly one Reading Lab; found {len(reading)}.")
        for activity in reading:
            content = activity.get("content") or {}
            passages = content.get("passages") if isinstance(content, dict) else None
            questions = content.get("questions") if isinstance(content, dict) else None
            solutions = content.get("solutions") if isinstance(content, dict) else None
            passage_count = len(passages) if isinstance(passages, list) else 0
            question_count = len(questions) if isinstance(questions, list) else 0
            if passage_count == 0:
                report.add("error", "READING_PASSAGE_MISSING", path,
                           "Reading Lab must contain at least one passage paragraph.")
            if question_count not in {13, 14}:
                report.add("error", "READING_QUESTION_COUNT", path,
                           f"Reading Lab must contain 13 or 14 questions; found {question_count}.")
            reading_question_rows = (
                questions if isinstance(questions, list) else []
            )
            if any(not isinstance(question, dict) for question in reading_question_rows):
                report.add("error", "READING_QUESTION_ITEM_TYPE", path,
                           "Every Reading question must be an object.")
            question_id_rows = [
                str(question.get("question_number") or "")
                for question in reading_question_rows if isinstance(question, dict)
            ]
            if "" in question_id_rows:
                report.add("error", "READING_QUESTION_ID_MISSING", path,
                           "Every Reading question needs a non-empty question_number.")
            duplicate_ids = sorted(
                question_id for question_id, occurrences in Counter(question_id_rows).items()
                if question_id and occurrences > 1
            )
            if duplicate_ids:
                report.add("error", "READING_QUESTION_ID_DUPLICATE", path,
                           "Reading question IDs must be unique; duplicates: "
                           + ", ".join(duplicate_ids))
            question_ids = set(question_id_rows)
            solution_ids = set(solutions) if isinstance(solutions, dict) else set()
            if question_ids != solution_ids:
                report.add("error", "READING_SOLUTION_COUNT", path,
                           "Reading solutions must map one-to-one to learner question IDs.")
            for qnum, solution in solutions.items() if isinstance(solutions, dict) else []:
                if not isinstance(solution, dict) or not str(solution.get("answer") or "").strip():
                    report.add("error", "READING_SOLUTION_INVALID", path,
                               f"Reading question {qnum or '?'} needs a private answer.")
            for question in reading_question_rows:
                if not isinstance(question, dict):
                    continue
                qnum = str(question.get("question_number") or "")
                leaked = {"answer", "answer_code", "answer_label", "evidence",
                          "distractor_analysis", "trap_analysis"} & set(question)
                if leaked:
                    report.add("error", "READING_ANSWER_LEAK", path,
                               "Reading learner question exposes private fields: "
                               + ", ".join(sorted(leaked)))
                options = question.get("options") or []
                if not isinstance(options, list) or any(
                    not isinstance(option, dict) for option in options
                ):
                    report.add(
                        "error", "READING_OPTION_ITEM_TYPE", path,
                        "Every Reading option must be an object.",
                    )
                    continue
                option_unexpected = sorted({
                    key
                    for option in options
                    for key in set(option) - LISTENING_LEARNER_OPTION_FIELDS
                })
                if option_unexpected:
                    report.add(
                        "error", "READING_OPTION_FIELD_UNEXPECTED", path,
                        "Reading options expose non-public fields: "
                        + ", ".join(option_unexpected),
                    )
                q_type = str(question.get("question_type") or "").strip().casefold()
                if q_type not in {"mcq", "choice"}:
                    continue
                option_keys = [
                    str(option.get("letter") or option.get("key") or "").strip()
                    for option in options
                ]
                if not option_keys or any(not key for key in option_keys):
                    report.add(
                        "error", "READING_MCQ_OPTION_KEY_INVALID", path,
                        f"Reading MCQ {qnum or '?'} needs a non-empty key for every option.",
                    )
                duplicate_keys = sorted(
                    key for key, occurrences in Counter(option_keys).items()
                    if key and occurrences > 1
                )
                if duplicate_keys:
                    report.add(
                        "error", "READING_MCQ_OPTION_KEY_DUPLICATE", path,
                        f"Reading MCQ {qnum or '?'} repeats option keys: "
                        + ", ".join(duplicate_keys),
                    )
                solution = solutions.get(qnum) if isinstance(solutions, dict) else None
                expected = str(
                    solution.get("answer") if isinstance(solution, dict) else ""
                ).strip().casefold()
                normalized_keys = {key.casefold() for key in option_keys if key}
                if expected not in normalized_keys:
                    report.add(
                        "error", "READING_MCQ_ANSWER_INVALID", path,
                        f"Reading MCQ {qnum or '?'} answer does not identify an option key.",
                    )

        if len(listening) != 1:
            report.add("error", "LISTENING_ACTIVITY_COUNT", path,
                       f"Each core lesson needs exactly one Listening Lab; found {len(listening)}.")
        for activity in listening:
            content = activity.get("content") or {}
            questions = content.get("questions") if isinstance(content, dict) else None
            solutions = content.get("solutions") if isinstance(content, dict) else None
            count = len(questions) if isinstance(questions, list) else 0
            if count != 6:
                report.add("error", "LISTENING_QUESTION_COUNT", path,
                           f"Listening Lab must contain exactly six questions; found {count}.")
            listening_question_rows = (
                questions if isinstance(questions, list) else []
            )
            if any(not isinstance(question, dict) for question in listening_question_rows):
                report.add("error", "LISTENING_QUESTION_ITEM_TYPE", path,
                           "Every Listening question must be an object.")
            question_rows = [
                question for question in listening_question_rows
                if isinstance(question, dict)
            ]
            nested_question_lists = [
                block.get("questions") or []
                for section in content.get("sections") or []
                if isinstance(section, dict)
                for block in section.get("question_blocks") or []
                if isinstance(block, dict)
            ] if isinstance(content, dict) else []
            if any(
                not isinstance(question, dict)
                for nested_questions in nested_question_lists
                for question in nested_questions
            ):
                report.add("error", "LISTENING_NESTED_QUESTION_ITEM_TYPE", path,
                           "Every nested Listening question must be an object.")
            nested_question_rows = [
                question
                for nested_questions in nested_question_lists
                for question in nested_questions
                if isinstance(question, dict)
            ]
            for question in [*question_rows, *nested_question_rows]:
                unexpected = set(question) - LISTENING_LEARNER_QUESTION_FIELDS
                option_unexpected = {
                    key
                    for option in question.get("options") or []
                    if isinstance(option, dict)
                    for key in set(option) - LISTENING_LEARNER_OPTION_FIELDS
                }
                if unexpected or option_unexpected:
                    leaked = sorted(unexpected | option_unexpected)
                    report.add(
                        "error", "LISTENING_ANSWER_LEAK", path,
                        "Listening learner question exposes non-public fields: "
                        + ", ".join(leaked),
                    )
            question_id_rows = [
                str(question.get("question_number") or "") for question in question_rows
            ]
            if "" in question_id_rows:
                report.add("error", "LISTENING_QUESTION_ID_MISSING", path,
                           "Every Listening question needs a non-empty question_number.")
            duplicate_ids = sorted(
                question_id for question_id, occurrences in Counter(question_id_rows).items()
                if question_id and occurrences > 1
            )
            if duplicate_ids:
                report.add("error", "LISTENING_QUESTION_ID_DUPLICATE", path,
                           "Listening question IDs must be unique; duplicates: "
                           + ", ".join(duplicate_ids))
            question_ids = set(question_id_rows)
            solution_ids = {
                str(question_id) for question_id in solutions
            } if isinstance(solutions, dict) else set()
            if question_ids != solution_ids:
                report.add("error", "LISTENING_SOLUTION_COUNT", path,
                           "Listening solutions must map one-to-one to learner question IDs.")
            for question in question_rows:
                question_id = str(question.get("question_number") or "")
                solution = solutions.get(question_id) if isinstance(solutions, dict) else None
                if not isinstance(solution, dict):
                    continue
                if not str(solution.get("answer") or "").strip():
                    report.add("error", "LISTENING_SOLUTION_ANSWER_INVALID", path,
                               f"Listening question {question_id or '?'} needs a private answer.")
                if not str(solution.get("evidence") or "").strip():
                    report.add("error", "LISTENING_SOLUTION_EVIDENCE_INVALID", path,
                               f"Listening question {question_id or '?'} needs "
                               "evidence replay text.")
                timing = solution.get("timing")
                answer_span = timing.get("answer_span") if isinstance(timing, dict) else None
                start = answer_span.get("start") if isinstance(answer_span, dict) else None
                end = answer_span.get("end") if isinstance(answer_span, dict) else None
                valid_span = (
                    isinstance(start, (int, float)) and not isinstance(start, bool)
                    and isinstance(end, (int, float)) and not isinstance(end, bool)
                    and 0 <= start < end
                )
                if not valid_span:
                    report.add("error", "LISTENING_SOLUTION_SPAN_INVALID", path,
                               f"Listening question {question_id or '?'} needs "
                               "a usable answer span.")
                if str(question.get("question_type") or "").lower() == "mcq":
                    option_keys = {
                        str(option.get("key") or option.get("letter") or "").strip()
                        for option in question.get("options") or []
                        if isinstance(option, dict)
                    }
                    if str(solution.get("answer") or "").strip() not in option_keys:
                        report.add("error", "LISTENING_MCQ_ANSWER_INVALID", path,
                                   f"Listening question {question_id or '?'} answer "
                                   "must match an option key.")
            release_status = str(activity.get("media_release_status") or "missing")
            if release_status != "approved":
                report.add("warning", "LISTENING_MEDIA_NOT_APPROVED", path,
                           f"Listening Lab media is {release_status}; learner playback is blocked.")


def _validate_unique_ids(rows: Any, keys: tuple[str, ...], path: Path,
                         report: ValidationReport, scope: str) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        report.add("error", f"{scope}_TYPE", path, f"{scope} must be an array.")
        return []
    objects: list[dict[str, Any]] = []
    seen = {key: set() for key in keys}
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            report.add("error", f"{scope}_ITEM_TYPE", path,
                       f"{scope}[{index}] must be an object.")
            continue
        objects.append(row)
        for key in keys:
            value = str(row.get(key) or "")
            if not value:
                report.add("error", f"{scope}_ID_MISSING", path,
                           f"{scope}[{index}] is missing {key}.")
            elif value in seen[key]:
                report.add("error", f"{scope}_ID_DUPLICATE", path,
                           f"Duplicate {key}={value!r} in {scope}.")
            else:
                seen[key].add(value)
    return objects


def _validate_provenance(lesson: dict[str, Any], path: Path,
                         report: ValidationReport) -> None:
    provenance = lesson.get("provenance")
    if not isinstance(provenance, dict):
        report.add("error", "PROVENANCE_MISSING", path,
                   "Lesson needs converter_version, content_checksum and source_checksums.")
        return
    if not str(provenance.get("converter_version") or "").strip():
        report.add("error", "CONVERTER_VERSION_MISSING", path,
                   "provenance.converter_version is required.")
    content_checksum = str(provenance.get("content_checksum") or "")
    if not SHA256_RE.fullmatch(content_checksum):
        report.add("error", "CONTENT_CHECKSUM_INVALID", path,
                   "provenance.content_checksum must be a SHA-256 hex digest.")
    elif content_checksum != lesson_content_checksum(lesson):
        report.add("error", "CONTENT_CHECKSUM_MISMATCH", path,
                   "Lesson content no longer matches provenance.content_checksum.")
    source_checksums = provenance.get("source_checksums")
    if not isinstance(source_checksums, dict) or not source_checksums:
        report.add("error", "SOURCE_CHECKSUMS_MISSING", path,
                   "provenance.source_checksums must map source paths to SHA-256 digests.")
        return
    for source_name, checksum in source_checksums.items():
        if not str(source_name).strip() or not SHA256_RE.fullmatch(str(checksum)):
            report.add("error", "SOURCE_CHECKSUM_INVALID", path,
                       f"Invalid source checksum entry for {source_name!r}.")


def _validate_lesson(
    lesson: dict[str, Any],
    path: Path,
    report: ValidationReport,
    *,
    vocab_audio_required: bool = False,
) -> None:
    lesson_id = str(lesson.get("lesson_id") or "")
    expected = path.parent.name
    if lesson_id != expected:
        report.add("error", "LESSON_PATH_ID_MISMATCH", path,
                   f"lesson_id={lesson_id!r} does not match folder {expected!r}.")

    vocabulary = _validate_unique_ids(
        lesson.get("vocabulary"), ("lexeme_id", "lesson_lexeme_id"), path, report,
        "VOCABULARY",
    )
    if len(vocabulary) != 24:
        count = len(vocabulary)
        report.add("error", "VOCABULARY_COUNT", path,
                   f"Expected exactly 24 vocabulary objects, found {count}.")

    runtime = _object_field(lesson, "runtime_contract", path, report)
    if runtime.get("completion_requires_submission") is not False:
        report.add("error", "LESSON_SUBMISSION_GATE", path,
                   "Lesson completion must not require a Writing/Speaking submission.")
    if runtime.get("completion_requires_revision_after_feedback") is not False:
        report.add("error", "LESSON_REVISION_GATE", path,
                   "Lesson completion must not require revision of an unassigned production task.")

    legacy_content = _object_field(lesson, "content", path, report, required=False)
    if isinstance(legacy_content, dict) and legacy_content.get("sections"):
        if legacy_content.get("visibility") != "admin_only":
            report.add("error", "EDITORIAL_CONTENT_VISIBILITY", path,
                       "Legacy editorial sections may contain answer keys and must be admin_only.")

    quiz = _object_field(lesson, "adaptive_quiz", path, report)
    items = quiz.get("items") or []
    items = _validate_unique_ids(items, ("item_id",), path, report, "QUIZ")
    for item in items:
        unexpected = sorted(set(item) - QUIZ_AUTHORED_ITEM_FIELDS)
        if unexpected:
            report.add(
                "error", "QUIZ_ITEM_FIELD_UNEXPECTED", path,
                f"Item {item.get('item_id') or '?'} has non-contract fields: "
                + ", ".join(unexpected),
            )
        option_unexpected = sorted({
            key
            for option in item.get("options") or []
            if isinstance(option, dict)
            for key in set(option) - QUIZ_OPTION_FIELDS
        })
        if option_unexpected:
            report.add(
                "error", "QUIZ_OPTION_FIELD_UNEXPECTED", path,
                f"Item {item.get('item_id') or '?'} has non-contract option fields: "
                + ", ".join(option_unexpected),
            )
        input_type = str(item.get("input") or "")
        if input_type not in ALLOWED_INPUTS:
            report.add("error", "QUIZ_INPUT_UNSUPPORTED", path,
                       f"Item {item.get('item_id') or '?'} has unsupported input={input_type!r}.")
        if input_type == "match" and item.get("lexeme_id"):
            report.add(
                "error", "QUIZ_SELECTABLE_MATCH_UNSUPPORTED", path,
                f"Item {item.get('item_id') or '?'} is a selectable match question, "
                "which the first-release learner does not support.",
            )
        if item.get("lexeme_id") and input_type != "match":
            has_expected = "answer" in item or "answer_index" in item
            expected = (
                item.get("answer") if "answer" in item
                else item.get("answer_index")
            )
            grading_valid = True
            if input_type == "choice":
                options = item.get("options")
                if not has_expected or not isinstance(options, list) or len(options) < 2:
                    grading_valid = False
                elif isinstance(expected, int) and not isinstance(expected, bool):
                    grading_valid = 0 <= expected < len(options)
                else:
                    option_keys = {
                        str(option.get("letter") or option.get("key") or index)
                        if isinstance(option, dict) else str(index)
                        for index, option in enumerate(options)
                    }
                    grading_valid = str(expected) in option_keys
            elif input_type == "boolean":
                grading_valid = has_expected and isinstance(expected, bool)
            elif input_type == "syllable":
                segments = item.get("segments")
                grading_valid = (
                    has_expected
                    and isinstance(expected, int)
                    and not isinstance(expected, bool)
                    and isinstance(segments, list)
                    and 0 <= expected < len(segments)
                )
            elif input_type == "text":
                accepted = item.get("accept")
                if isinstance(accepted, list):
                    grading_valid = bool(accepted) and all(
                        isinstance(value, str) and bool(value.strip())
                        for value in accepted
                    )
                elif isinstance(expected, list):
                    grading_valid = bool(expected) and all(
                        isinstance(value, str) and bool(value.strip())
                        for value in expected
                    )
                else:
                    grading_valid = (
                        has_expected
                        and isinstance(expected, str)
                        and bool(expected.strip())
                    )
            if not grading_valid:
                report.add(
                    "error", "QUIZ_GRADING_CONTRACT_INVALID", path,
                    f"Item {item.get('item_id') or '?'} has no usable "
                    f"{input_type or 'selectable'} answer contract.",
                )
        if "segments" in item:
            segments = item.get("segments")
            if input_type != "syllable":
                report.add(
                    "error", "QUIZ_SEGMENTS_INPUT_INVALID", path,
                    f"Item {item.get('item_id') or '?'} may expose segments only for syllable input.",
                )
            if (not isinstance(segments, list) or not segments
                    or any(not isinstance(segment, str) or not segment.strip()
                           for segment in segments)):
                report.add(
                    "error", "QUIZ_SEGMENTS_INVALID", path,
                    f"Item {item.get('item_id') or '?'} segments must be non-empty public strings.",
                )
        q_type = str(item.get("question_type") or item.get("type") or "").lower()
        if q_type in {"choice", "mcq"} and not ({"answer", "answer_index"} & item.keys()):
            report.add("error", "MCQ_ANSWER_MISSING", path,
                       f"Item {item.get('item_id') or '?'} needs one valid answer.")

    _validate_activity_policies(lesson, path, report)
    _validate_mcq_options(lesson, path, report)
    _validate_provenance(lesson, path, report)

    media = _object_field(lesson, "media", path, report)
    audio_rows = media.get("audio") or []
    if not isinstance(audio_rows, list):
        report.add("error", "MEDIA_AUDIO_TYPE", path, "media.audio must be an array.")
        audio_rows = []
    for audio in audio_rows:
        if not isinstance(audio, dict):
            continue
        status = str(audio.get("status") or "missing")
        if status in NON_READY_AUDIO:
            report.add("warning", "AUDIO_NOT_APPROVED", path,
                       f"Audio {audio.get('audio_id') or '?'} is {status}; learner "
                       "playback is blocked.")
        if status == "approved":
            source_status = str(audio.get("source_release_status") or "").upper()
            approval = audio.get("approval")
            if source_status and source_status != "APPROVED" and not isinstance(approval, dict):
                report.add(
                    "error", "MEDIA_APPROVAL_MISSING", path,
                    "Approved media with a non-approved source status needs an auditable "
                    "content-owner approval record.",
                )
            expected_path = str(audio.get("expected_audio_path") or "").strip()
            checksum = str(audio.get("checksum") or "").strip()
            if expected_path:
                asset = (path.parent / expected_path).resolve()
                try:
                    asset.relative_to(path.parent.resolve())
                except ValueError:
                    report.add("error", "MEDIA_PATH_UNSAFE", path, expected_path)
                else:
                    if not asset.is_file():
                        report.add("error", "MEDIA_FILE_MISSING", asset,
                                   "Approved Listening media is not packaged.")
                    elif not SHA256_RE.fullmatch(checksum):
                        report.add("error", "MEDIA_CHECKSUM_INVALID", path,
                                   "Approved Listening media needs a SHA-256 checksum.")
                    elif _sha256_file(asset) != checksum:
                        report.add("error", "MEDIA_CHECKSUM_MISMATCH", asset,
                                   "Listening media bytes do not match lesson metadata.")

    for vocab in vocabulary if isinstance(vocabulary, list) else []:
        if not str(vocab.get("common_error") or "").strip():
            report.add("warning", "COMMON_ERROR_MISSING", path,
                       "Lexeme "
                       f"{vocab.get('lexeme_id') or vocab.get('headword') or '?'} "
                       "lacks common_error.")
        if vocab_audio_required:
            for field, checksum_field in (
                ("audio_headword", "headword_checksum"),
                ("audio_example", "example_checksum"),
            ):
                relative = str(vocab.get(field) or "").strip()
                provenance = vocab.get("audio_provenance")
                checksum = (
                    str(provenance.get(checksum_field) or "")
                    if isinstance(provenance, dict) else ""
                )
                if not relative:
                    report.add("error", "VOCAB_AUDIO_MISSING", path,
                               f"{vocab.get('lesson_lexeme_id')} lacks {field}.")
                    continue
                asset = (path.parents[2] / relative).resolve()
                try:
                    asset.relative_to(path.parents[2].resolve())
                except ValueError:
                    report.add("error", "VOCAB_AUDIO_PATH_UNSAFE", path, relative)
                    continue
                if not asset.is_file():
                    report.add("error", "VOCAB_AUDIO_FILE_MISSING", asset,
                               f"Referenced by {vocab.get('lesson_lexeme_id')}.")
                elif not SHA256_RE.fullmatch(checksum):
                    report.add("error", "VOCAB_AUDIO_CHECKSUM_INVALID", path,
                               f"{vocab.get('lesson_lexeme_id')} lacks {checksum_field}.")
                elif _sha256_file(asset) != checksum:
                    report.add("error", "VOCAB_AUDIO_CHECKSUM_MISMATCH", asset,
                               f"Referenced by {vocab.get('lesson_lexeme_id')}.")


def validate_package(package_path: str | Path) -> ValidationReport:
    root = Path(package_path).expanduser().resolve()
    report = ValidationReport(package_path=str(root))
    manifest = _read_json(root / "course-manifest.json", report)
    if manifest is None:
        return report
    _validate_manifest(root, manifest, report)

    supplements = manifest.get("content_supplements")
    vocab_audio_required = bool(
        isinstance(supplements, dict) and supplements.get("vocabulary_audio")
    )

    ids = _manifest_lesson_ids(manifest)
    manifest_lessons = manifest.get("lessons") or []
    lesson_rows = manifest_lessons if isinstance(manifest_lessons, list) else []
    for lesson_id in ids:
        if not re.fullmatch(r"ADV-T\d{2}", lesson_id):
            report.add("error", "LESSON_ID_FORMAT", root / "course-manifest.json",
                       f"Invalid lesson ID format: {lesson_id!r}.")
            continue
        path = root / "lessons" / lesson_id / "lesson.json"
        lesson = _read_json(path, report)
        if lesson is None:
            continue
        report.checked_lessons += 1
        _validate_lesson(
            lesson, path, report, vocab_audio_required=vocab_audio_required
        )
        manifest_row = next(
            (row for row in lesson_rows if isinstance(row, dict)
             and row.get("lesson_id") == lesson_id),
            {},
        )
        lesson_provenance = lesson.get("provenance")
        lesson_checksum = (
            lesson_provenance.get("content_checksum")
            if isinstance(lesson_provenance, dict) else None
        )
        if manifest_row.get("content_checksum") != lesson_checksum:
            report.add("error", "MANIFEST_LESSON_CHECKSUM_MISMATCH", path,
                       "Manifest lesson checksum does not match the lesson file.")

    manifest_reviews = manifest.get("reviews") or []
    review_rows = manifest_reviews if isinstance(manifest_reviews, list) else []
    for review_id in _manifest_review_ids(manifest):
        if not re.fullmatch(r"R\d{2}", review_id):
            report.add("error", "REVIEW_ID_FORMAT", root / "course-manifest.json",
                       f"Invalid review ID format: {review_id!r}.")
            continue
        path = root / "reviews" / f"{review_id}.json"
        review = _read_json(path, report)
        if review is None:
            continue
        if str(review.get("review_id") or "") != review_id:
            report.add("error", "REVIEW_PATH_ID_MISMATCH", path,
                       f"review_id does not match manifest ID {review_id}.")
        items = _validate_unique_ids(
            review.get("items"), ("item_id",), path, report, "REVIEW_ITEM",
        )
        if not items:
            report.add("error", "REVIEW_ITEMS_MISSING", path,
                       f"{review_id} must contain at least one review item.")
        _validate_mcq_options({"items": items}, path, report)
        expected_lessons = [f"T{i:02d}" for i in range(1, int(review_id[1:]) * 5 + 1)]
        if review.get("review_of_lessons") != expected_lessons:
            report.add("error", "REVIEW_LESSON_SCOPE", path,
                       f"{review_id} must have cumulative scope through "
                       f"T{len(expected_lessons):02d}.")
        provenance_value = review.get("provenance")
        provenance = provenance_value if isinstance(provenance_value, dict) else {}
        review_checksum = str(provenance.get("content_checksum") or "")
        if not SHA256_RE.fullmatch(review_checksum):
            report.add("error", "REVIEW_CHECKSUM_INVALID", path,
                       "Review provenance.content_checksum must be SHA-256.")
        elif review_checksum != _checksum_without(review, "provenance", "content_checksum"):
            report.add("error", "REVIEW_CHECKSUM_MISMATCH", path,
                       "Review content no longer matches provenance.content_checksum.")

        manifest_row = next(
            (row for row in review_rows if isinstance(row, dict)
             and row.get("review_id") == review_id),
            {},
        )
        if manifest_row.get("content_checksum") != review_checksum:
            report.add("error", "MANIFEST_REVIEW_CHECKSUM_MISMATCH", path,
                       "Manifest review checksum does not match the review file.")

    generated_dirs = {p.name for p in (root / "lessons").glob("ADV-T*") if p.is_dir()}
    unreferenced = sorted(generated_dirs - set(ids))
    if unreferenced:
        report.add("warning", "UNREFERENCED_LESSON_DIR", root / "lessons",
                   f"Directories not referenced by manifest: {', '.join(unreferenced)}")
    return report


def validate_listening_source_directory(
    source_path: str | Path,
    report: ValidationReport | None = None,
) -> ValidationReport:
    """Add pre-converter checks for the 30 canonical Listening JSON files."""
    root = Path(source_path).expanduser().resolve()
    if report is None:
        report = ValidationReport(package_path=str(root))
    files = sorted(root.glob("VOC-ADV-LIS-LSN-T??.json"))
    if len(files) != 30:
        report.add("error", "LISTENING_SOURCE_COUNT", root,
                   f"Expected 30 core Listening source files, found {len(files)}.")

    for path in files:
        source = _read_json(path, report)
        if source is None:
            continue
        _validate_mcq_options(source, path, report)
        questions: list[dict[str, Any]] = []
        answers: list[dict[str, Any]] = []
        for section in source.get("sections") or []:
            if not isinstance(section, dict):
                continue
            for block in section.get("question_blocks") or []:
                if not isinstance(block, dict):
                    continue
                questions.extend(q for q in block.get("questions") or [] if isinstance(q, dict))
                answers.extend(a for a in block.get("answers") or [] if isinstance(a, dict))
        if len(questions) != 6:
            report.add("error", "LISTENING_SOURCE_QUESTION_COUNT", path,
                       f"Expected six questions, found {len(questions)}.")
        answer_numbers = [
            str(a.get("qnum") or a.get("question_number") or "") for a in answers
        ]
        duplicate_answers = sorted(
            key for key, count in Counter(answer_numbers).items() if key and count > 1
        )
        if duplicate_answers:
            report.add("error", "LISTENING_SOURCE_ANSWER_DUPLICATE", path,
                       "Duplicate answer records for questions: "
                       f"{', '.join(duplicate_answers)}.")
        answer_by_q = {
            str(a.get("qnum") or a.get("question_number") or ""): a
            for a in answers
        }
        for question in questions:
            qnum = str(question.get("question_number") or question.get("qnum") or "")
            answer = answer_by_q.get(qnum)
            if not answer:
                report.add("error", "LISTENING_SOURCE_ANSWER_MISSING", path,
                           f"Question {qnum or '?'} has no answer record.")
                continue
            if not str(answer.get("evidence") or "").strip():
                report.add("error", "LISTENING_SOURCE_EVIDENCE_MISSING", path,
                           f"Question {qnum or '?'} has no evidence text.")
            if str(question.get("question_type") or "").lower() == "mcq":
                options = question.get("options") or []
                option_keys = {
                    str(option.get("letter") or option.get("key") or "")
                    for option in options if isinstance(option, dict)
                }
                if str(answer.get("answer") or "") not in option_keys:
                    report.add("error", "LISTENING_SOURCE_ANSWER_INVALID", path,
                               f"Question {qnum or '?'} answer does not identify an option.")
    return report
