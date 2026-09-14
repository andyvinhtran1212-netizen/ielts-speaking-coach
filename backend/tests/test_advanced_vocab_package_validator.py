from __future__ import annotations

import json
from pathlib import Path

from services.advanced_vocab_package_validator import (
    CORE_LESSON_IDS,
    validate_listening_source_directory,
    validate_package,
)


def _activity(aid: str, activity_type: str, **extra):
    value = {
        "activity_id": aid,
        "activity_type": activity_type,
        "interaction_policy": "auto_graded",
        "grading_policy": "automatic",
        "completion_policy": "required",
        "reveal_policy": "after_attempt",
    }
    value.update(extra)
    return value


def _lesson(lesson_id: str) -> dict:
    return {
        "lesson_id": lesson_id,
        "vocabulary": [
            {"lexeme_id": f"{lesson_id}-lex-{i}",
             "lesson_lexeme_id": f"{lesson_id}__lex-{i}",
             "headword": f"word-{i}",
             "common_error": "A precise usage note."}
            for i in range(24)
        ],
        "adaptive_quiz": {
            "items": [{"item_id": f"{lesson_id}-q1", "type": "mcq", "input": "choice",
                       "answer": 0,
                       "options": [{"key": "A", "text": "One"},
                                   {"key": "B", "text": "Two"}]}]
        },
        "activities": [
            _activity(f"{lesson_id}-learn", "adaptive_practice"),
            _activity(
                f"{lesson_id}-listening", "listening_lab",
                content={
                    "questions": [
                        {"question_number": i, "question_type": "note_completion",
                         "stem": f"Question {i}", "options": []}
                        for i in range(1, 7)
                    ]
                },
                media_release_status="approved",
            ),
            _activity(
                f"{lesson_id}-writing", "writing_reference",
                interaction_policy="read_only", grading_policy="none",
                completion_policy="reference_only", reveal_policy="always",
                submittable=False, teacher_assignment_required_for_grading=True,
            ),
            _activity(
                f"{lesson_id}-speaking", "speaking_practice",
                interaction_policy="practice_recording", grading_policy="none",
                completion_policy="optional", reveal_policy="always",
                graded_by_default=False,
            ),
        ],
        "runtime_contract": {
            "completion_requires_submission": False,
            "completion_requires_revision_after_feedback": False,
        },
        "provenance": {
            "converter_version": "1.0.0",
            "content_checksum": "a" * 64,
            "source_checksums": {f"source/{lesson_id}.docx": "b" * 64},
        },
        "media": {"audio": [{"audio_id": f"{lesson_id}-audio", "status": "approved"}]},
    }


def _write_package(root: Path, ids=CORE_LESSON_IDS) -> None:
    manifest = {
        "course_id": "ADV-VOCAB",
        "audience": "assigned_only",
        "lessons": [{"lesson_id": lesson_id} for lesson_id in ids],
    }
    (root / "course-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    for lesson_id in ids:
        folder = root / "lessons" / lesson_id
        folder.mkdir(parents=True)
        (folder / "lesson.json").write_text(json.dumps(_lesson(lesson_id)), encoding="utf-8")


def _codes(report) -> set[str]:
    return {issue.code for issue in report.errors}


def test_valid_first_release_contract_is_publish_ready(tmp_path: Path):
    _write_package(tmp_path)
    report = validate_package(tmp_path)
    assert report.checked_lessons == 30
    assert report.schema_valid is True
    assert report.publish_ready is True


def test_manifest_rejects_t31_to_t33_in_first_release(tmp_path: Path):
    _write_package(tmp_path, (*CORE_LESSON_IDS, "ADV-T31", "ADV-T32", "ADV-T33"))
    report = validate_package(tmp_path)
    assert "NON_CORE_LESSONS_IN_RELEASE" in _codes(report)
    assert "CORE_LESSON_COUNT" in _codes(report)


def test_writing_submission_and_revision_gates_are_rejected(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["runtime_contract"]["completion_requires_submission"] = True
    lesson["runtime_contract"]["completion_requires_revision_after_feedback"] = True
    writing = next(a for a in lesson["activities"] if a["activity_type"] == "writing_reference")
    writing.update({"submittable": True, "grading_policy": "automatic"})
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert {"LESSON_SUBMISSION_GATE", "LESSON_REVISION_GATE",
            "WRITING_BOUNDARY_VIOLATION"} <= _codes(report)


def test_each_core_lesson_requires_one_writing_reference(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["activities"] = [
        activity for activity in lesson["activities"]
        if activity["activity_type"] != "writing_reference"
    ]
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "WRITING_ACTIVITY_COUNT" in _codes(report)


def test_speaking_is_never_graded_by_default(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    speaking = next(a for a in lesson["activities"] if a["activity_type"] == "speaking_practice")
    speaking.update({"graded_by_default": True, "grading_policy": "automatic"})
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "SPEAKING_DEFAULT_GRADING" in _codes(report)


def test_each_core_lesson_requires_one_speaking_activity(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["activities"] = [
        activity for activity in lesson["activities"]
        if activity["activity_type"] != "speaking_practice"
    ]
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "SPEAKING_ACTIVITY_COUNT" in _codes(report)


def test_activity_policy_values_are_closed_enums(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["activities"][0]["grading_policy"] = "manual_someday"
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "ACTIVITY_POLICY_INVALID" in _codes(report)


def test_duplicate_mcq_option_keys_fail_closed(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["adaptive_quiz"]["items"][0]["options"].append(
        {"key": "A", "text": "Explanation leaked"}
    )
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "MCQ_DUPLICATE_OPTION_KEY" in _codes(report)


def test_mcq_answer_must_identify_an_existing_option(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["adaptive_quiz"]["items"][0]["answer"] = "C"
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "MCQ_ANSWER_INVALID" in _codes(report)


def test_mcq_requires_an_answer(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["adaptive_quiz"]["items"][0].pop("answer")
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "MCQ_ANSWER_MISSING" in _codes(report)


def test_quiz_and_vocabulary_ids_must_be_unique(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["vocabulary"][1]["lexeme_id"] = lesson["vocabulary"][0]["lexeme_id"]
    lesson["adaptive_quiz"]["items"].append(dict(lesson["adaptive_quiz"]["items"][0]))
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert {"VOCABULARY_ID_DUPLICATE", "QUIZ_ID_DUPLICATE"} <= _codes(report)


def test_lesson_requires_reproducible_provenance(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson.pop("provenance")
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "PROVENANCE_MISSING" in _codes(report)


def test_malformed_object_fields_report_errors_instead_of_crashing(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["runtime_contract"] = []
    lesson["adaptive_quiz"] = "broken"
    lesson["media"] = []
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "OBJECT_FIELD_INVALID" in _codes(report)


def test_listening_requires_six_questions_and_approved_media(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    listening = next(a for a in lesson["activities"] if a["activity_type"] == "listening_lab")
    listening["content"]["questions"].pop()
    listening["media_release_status"] = "rendered_review_required"
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "LISTENING_QUESTION_COUNT" in _codes(report)
    assert "LISTENING_MEDIA_NOT_APPROVED" in {i.code for i in report.warnings}


def test_warning_prevents_publish_ready_without_invalidating_schema(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["media"]["audio"][0]["status"] = "rendered_review_required"
    lesson["vocabulary"][0]["common_error"] = ""
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert report.schema_valid is True
    assert report.publish_ready is False
    assert {i.code for i in report.warnings} == {"AUDIO_NOT_APPROVED", "COMMON_ERROR_MISSING"}


def test_listening_source_rejects_distractor_explanations_as_duplicate_options(tmp_path: Path):
    for number in range(1, 31):
        options = [
            {"letter": "A", "text": "First"},
            {"letter": "B", "text": "Second"},
        ]
        if number == 1:
            options.append({"letter": "A", "text": "Correct — explanation leaked"})
        questions = [
            {"question_number": q, "question_type": "mcq" if q == 1 else "note_completion",
             "stem": f"Question {q}", "options": options if q == 1 else []}
            for q in range(1, 7)
        ]
        answers = [
            {"qnum": str(q), "answer": "A" if q == 1 else "word", "evidence": "Evidence"}
            for q in range(1, 7)
        ]
        source = {"sections": [{"question_blocks": [{"questions": questions, "answers": answers}]}]}
        path = tmp_path / f"VOC-ADV-LIS-LSN-T{number:02d}.json"
        path.write_text(json.dumps(source), encoding="utf-8")

    report = validate_listening_source_directory(tmp_path)
    assert "MCQ_DUPLICATE_OPTION_KEY" in _codes(report)


def test_listening_source_mcq_answer_must_match_an_option(tmp_path: Path):
    for number in range(1, 31):
        questions = [
            {
                "question_number": q,
                "question_type": "mcq" if q == 1 else "note_completion",
                "stem": f"Question {q}",
                "options": ([{"letter": "A", "text": "First"},
                             {"letter": "B", "text": "Second"}] if q == 1 else []),
            }
            for q in range(1, 7)
        ]
        answers = [
            {
                "qnum": str(q),
                "answer": "C" if number == 1 and q == 1 else ("A" if q == 1 else "word"),
                "evidence": "Evidence",
            }
            for q in range(1, 7)
        ]
        source = {"sections": [{"question_blocks": [{"questions": questions,
                                                       "answers": answers}]}]}
        path = tmp_path / f"VOC-ADV-LIS-LSN-T{number:02d}.json"
        path.write_text(json.dumps(source), encoding="utf-8")

    report = validate_listening_source_directory(tmp_path)
    assert "LISTENING_SOURCE_ANSWER_INVALID" in _codes(report)
