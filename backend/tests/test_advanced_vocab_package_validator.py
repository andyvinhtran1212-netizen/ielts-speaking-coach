from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from scripts import sync_advanced_vocab_core30 as sync_module
from scripts.sync_advanced_vocab_core30 import sync
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


def _checksum_without(value: dict, *field_path: str) -> str:
    clone = json.loads(json.dumps(value, ensure_ascii=False))
    parent = clone
    for key in field_path[:-1]:
        parent = parent[key]
    parent.pop(field_path[-1], None)
    payload = json.dumps(
        clone, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    return hashlib.sha256(payload).hexdigest()


def _lesson(lesson_id: str) -> dict:
    lesson = {
        "lesson_id": lesson_id,
        "vocabulary": [
            {"lexeme_id": f"{lesson_id}-lex-{i}",
             "lesson_lexeme_id": f"{lesson_id}__lex-{i}",
             "headword": f"word-{i}",
             "common_error": "A precise usage note."}
            for i in range(24)
        ],
        "adaptive_quiz": {
            "items": [
                {"item_id": f"{lesson_id}-q1", "type": "mcq", "input": "choice",
                 "answer": 0,
                 "options": [{"key": "A", "text": "One"},
                             {"key": "B", "text": "Two"}]},
                *[
                    item
                    for i in range(24)
                    for item in (
                        {
                            "item_id": f"{lesson_id}-lex-{i}-recognition",
                            "lexeme_id": f"{lesson_id}-lex-{i}",
                            "type": "mcq", "input": "choice",
                            "prompt": f"Recognise word {i}.", "answer": 0,
                            "options": [
                                {"key": "A", "text": "Correct"},
                                {"key": "B", "text": "Wrong"},
                            ],
                        },
                        {
                            "item_id": f"{lesson_id}-lex-{i}-production",
                            "lexeme_id": f"{lesson_id}-lex-{i}",
                            "type": "gap_text", "input": "text",
                            "prompt": f"Produce word {i}.",
                            "accept": [f"word-{i}"],
                        },
                    )
                ],
            ]
        },
        "activities": [
            _activity(f"{lesson_id}-learn", "adaptive_practice"),
            _activity(
                f"{lesson_id}-reading", "reading_lab",
                content={
                    "passages": [{"paragraph": "A", "text": "Passage"}],
                    "questions": [
                        {"question_number": i, "question_type": "Summary Completion",
                         "stem": f"Question {i}", "options": []}
                        for i in range(1, 14)
                    ],
                    "solutions": {
                        str(i): {"answer": f"answer-{i}", "evidence": "Evidence"}
                        for i in range(1, 14)
                    },
                },
            ),
            _activity(
                f"{lesson_id}-listening", "listening_lab",
                content={
                    "questions": [
                        {"question_number": i,
                         "question_type": "mcq" if i == 4 else "note_completion",
                         "stem": f"Question {i}",
                         "options": ([{"letter": "A", "text": "One"},
                                      {"letter": "B", "text": "Two"}]
                                     if i == 4 else [])}
                        for i in range(1, 7)
                    ],
                    "solutions": {
                        str(i): {
                            "answer": "A" if i == 4 else f"answer-{i}",
                            "evidence": f"Evidence for question {i}",
                            "timing": {"answer_span": {
                                "start": i * 10, "end": i * 10 + 2,
                            }},
                        }
                        for i in range(1, 7)
                    },
                },
                media_release_status="approved",
            ),
            _activity(
                f"{lesson_id}-writing", "writing_reference",
                content={
                    "tasks": {
                        "task_1": {
                            "illustrations": ["assets/wt1/topic.svg", "assets/wt1/topic.png"],
                            "model_answers": [
                                {"band": "7.0", "blocks": [{"text": "Model 7"}]},
                                {"band": "8.0", "blocks": [{"text": "Model 8"}]},
                            ],
                        },
                        "task_2": {
                            "idea_sections": [
                                {"heading": f"Idea {i}", "blocks": []}
                                for i in range(1, 13)
                            ],
                            "model_answers": [
                                {"band": "7.0", "blocks": [{"text": "Model 7"}]},
                                {"band": "8.0", "blocks": [{"text": "Model 8"}]},
                            ],
                        },
                    }
                },
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
            "source_checksums": {f"source/{lesson_id}.docx": "b" * 64},
        },
        "media": {"audio": [{"audio_id": f"{lesson_id}-audio", "status": "approved"}]},
    }
    lesson["provenance"]["content_checksum"] = _checksum_without(
        lesson, "provenance", "content_checksum"
    )
    return lesson


def _write_package(root: Path, ids=CORE_LESSON_IDS) -> None:
    lesson_rows = []
    for lesson_id in ids:
        folder = root / "lessons" / lesson_id
        folder.mkdir(parents=True)
        lesson = _lesson(lesson_id)
        (folder / "lesson.json").write_text(json.dumps(lesson), encoding="utf-8")
        lesson_rows.append({
            "lesson_id": lesson_id,
            "content_checksum": lesson["provenance"]["content_checksum"],
        })

    review_rows = []
    for number in range(1, 7):
        review_id = f"R{number:02d}"
        review = {
            "review_id": review_id,
            "review_of_lessons": [f"T{i:02d}" for i in range(1, number * 5 + 1)],
            "items": [{
                "item_id": f"ADV-{review_id}__q1",
                "type": "mcq",
                "answer": 0,
                "options": ["One", "Two"],
            }],
            "provenance": {},
        }
        review["provenance"]["content_checksum"] = _checksum_without(
            review, "provenance", "content_checksum"
        )
        folder = root / "reviews"
        folder.mkdir(exist_ok=True)
        (folder / f"{review_id}.json").write_text(json.dumps(review), encoding="utf-8")
        review_rows.append({
            "review_id": review_id,
            "content_checksum": review["provenance"]["content_checksum"],
        })

    manifest = {
        "course_id": "ADV-VOCAB",
        "audience": "assigned_only",
        "lessons": lesson_rows,
        "reviews": review_rows,
    }
    manifest["package_checksum"] = _checksum_without(manifest, "package_checksum")
    (root / "course-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def _rewrite_lesson_with_checksums(root: Path, lesson: dict) -> None:
    lesson_id = lesson["lesson_id"]
    lesson["provenance"]["content_checksum"] = _checksum_without(
        lesson, "provenance", "content_checksum"
    )
    path = root / "lessons" / lesson_id / "lesson.json"
    path.write_text(json.dumps(lesson), encoding="utf-8")
    manifest_path = root / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest_lesson = next(
        row for row in manifest["lessons"] if row["lesson_id"] == lesson_id
    )
    manifest_lesson["content_checksum"] = lesson["provenance"]["content_checksum"]
    manifest["package_checksum"] = _checksum_without(manifest, "package_checksum")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")


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


def test_writing_reference_requires_models_artwork_and_idea_bank(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    writing = next(a for a in lesson["activities"] if a["activity_type"] == "writing_reference")
    tasks = writing["content"]["tasks"]
    tasks["task_1"]["model_answers"] = [{"band": "7.0", "blocks": []}]
    tasks["task_1"]["illustrations"] = ["assets/wt1/topic.svg"]
    tasks["task_2"]["idea_sections"] = tasks["task_2"]["idea_sections"][:11]
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert {
        "WRITING_MODEL_REFERENCES_INCOMPLETE",
        "WRITING_TASK1_ARTWORK_INCOMPLETE",
        "WRITING_TASK2_IDEAS_INCOMPLETE",
    } <= _codes(report)


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


def test_modified_lesson_fails_checksum_validation(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["title"] = "Changed after build"
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "CONTENT_CHECKSUM_MISMATCH" in _codes(report)


def test_review_scope_is_cumulative_at_each_checkpoint(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "reviews" / "R02.json"
    review = json.loads(path.read_text())
    review["review_of_lessons"] = ["T06", "T07", "T08", "T09", "T10"]
    path.write_text(json.dumps(review), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "REVIEW_LESSON_SCOPE" in _codes(report)


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


def test_quiz_rejects_non_contract_private_fields(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    item = lesson["adaptive_quiz"]["items"][0]
    item["correct_answer"] = "A"
    item["options"][0]["feedback"] = "Private explanation"
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)

    assert {
        "QUIZ_ITEM_FIELD_UNEXPECTED", "QUIZ_OPTION_FIELD_UNEXPECTED",
    } <= _codes(report)


def test_quiz_segments_are_public_strings_for_syllable_input_only(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    choice = lesson["adaptive_quiz"]["items"][0]
    choice["segments"] = ["not", "allowed"]
    lesson["adaptive_quiz"]["items"].append({
        "item_id": "ADV-T01-segment-leak",
        "type": "stress",
        "input": "syllable",
        "answer": 0,
        "segments": {"answer": "secret"},
    })
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)

    assert {"QUIZ_SEGMENTS_INPUT_INVALID", "QUIZ_SEGMENTS_INVALID"} <= _codes(report)


def test_scoped_match_question_is_rejected_but_editorial_match_is_retained(
        tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["adaptive_quiz"]["items"].extend([
        {
            "item_id": "ADV-T01-selectable-match",
            "lexeme_id": lesson["vocabulary"][0]["lexeme_id"],
            "type": "matching",
            "input": "match",
            "pairs": [{"left": "A", "right": "B"}],
            "answer": ["B"],
        },
        {
            "item_id": "ADV-T01-editorial-match",
            "type": "matching",
            "input": "match",
            "pairs": [{"left": "A", "right": "B"}],
            "answer": ["B"],
        },
    ])
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)

    matching_issues = [
        issue for issue in report.errors
        if issue.code == "QUIZ_SELECTABLE_MATCH_UNSUPPORTED"
    ]
    assert len(matching_issues) == 1
    assert "selectable-match" in matching_issues[0].message


def test_selectable_items_require_compatible_grading_contracts(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lexeme = lesson["vocabulary"][0]["lexeme_id"]
    valid_items = [
        {
            "item_id": "ADV-T01-valid-boolean", "lexeme_id": lexeme,
            "type": "true_false", "input": "boolean", "answer": False,
            "prompt": "True or false?",
        },
        {
            "item_id": "ADV-T01-valid-syllable", "lexeme_id": lexeme,
            "type": "stress", "input": "syllable", "answer": 1,
            "segments": ["one", "two"], "prompt": "Choose the stress.",
        },
        {
            "item_id": "ADV-T01-valid-text", "lexeme_id": lexeme,
            "type": "gap_text", "input": "text", "accept": ["answer"],
            "prompt": "Complete the gap.",
        },
    ]
    lesson["adaptive_quiz"]["items"].extend(valid_items)
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    assert validate_package(tmp_path).publish_ready is True

    valid_items[0].pop("answer")
    valid_items[1]["answer"] = 2
    valid_items[2]["accept"] = []
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    issues = [
        issue for issue in validate_package(tmp_path).errors
        if issue.code == "QUIZ_GRADING_CONTRACT_INVALID"
    ]
    assert len(issues) == 3
    assert all(
        any(item_id in issue.message for issue in issues)
        for item_id in ("valid-boolean", "valid-syllable", "valid-text")
    )


def test_selectable_prompts_and_non_choice_options_fail_closed(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lexeme = lesson["vocabulary"][0]["lexeme_id"]
    lesson["adaptive_quiz"]["items"].extend([
        {
            "item_id": "ADV-T01-missing-prompt", "lexeme_id": lexeme,
            "type": "true_false", "input": "boolean", "answer": True,
        },
        {
            "item_id": "ADV-T01-numeric-prompt", "lexeme_id": lexeme,
            "type": "gap_text", "input": "text", "accept": ["answer"],
            "prompt": 42,
        },
        {
            "item_id": "ADV-T01-boolean-options", "lexeme_id": lexeme,
            "type": "true_false", "input": "boolean", "answer": True,
            "prompt": "True or false?", "options": ["True", "False"],
        },
    ])
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    prompt_issues = [
        issue for issue in report.errors if issue.code == "QUIZ_PROMPT_INVALID"
    ]

    assert len(prompt_issues) == 2
    assert "QUIZ_NON_CHOICE_OPTIONS_INVALID" in _codes(report)


def test_selectable_inventory_requires_recognition_and_production_per_lexeme(
        tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    missing_lexeme = lesson["vocabulary"][0]["lexeme_id"]
    lesson["adaptive_quiz"]["items"] = [
        item for item in lesson["adaptive_quiz"]["items"]
        if not (
            item.get("lexeme_id") == missing_lexeme
            and item.get("input") == "text"
        )
    ]
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    report = validate_package(tmp_path)

    assert "QUIZ_SELECTABLE_INVENTORY_INCOMPLETE" in _codes(report)


def test_selectable_choice_rejects_blank_object_option_identity(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    choice = next(
        item for item in lesson["adaptive_quiz"]["items"]
        if item.get("lexeme_id") and item.get("input") == "choice"
    )
    choice["options"][0] = {"letter": "", "key": "A", "text": "Correct"}
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    report = validate_package(tmp_path)

    assert "QUIZ_OPTION_ID_INVALID" in _codes(report)


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


def test_reading_and_listening_reject_non_object_questions(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    reading = next(a for a in lesson["activities"] if a["activity_type"] == "reading_lab")
    listening = next(
        a for a in lesson["activities"] if a["activity_type"] == "listening_lab"
    )
    reading["content"]["questions"][0] = "not-an-object"
    listening["content"]["questions"][0] = "not-an-object"
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)

    assert {
        "READING_QUESTION_ITEM_TYPE", "LISTENING_QUESTION_ITEM_TYPE",
    } <= _codes(report)


def test_listening_requires_complete_replayable_solution_map(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    listening = next(a for a in lesson["activities"] if a["activity_type"] == "listening_lab")
    solutions = listening["content"]["solutions"]
    solutions.pop("1")
    solutions["2"]["evidence"] = ""
    solutions["3"]["timing"].pop("answer_span")
    solutions["5"]["answer"] = ""
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)

    assert {
        "LISTENING_SOLUTION_COUNT",
        "LISTENING_SOLUTION_ANSWER_INVALID",
        "LISTENING_SOLUTION_EVIDENCE_INVALID",
        "LISTENING_SOLUTION_SPAN_INVALID",
    } <= _codes(report)


def test_listening_mcq_answer_must_match_an_option_key(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    listening = next(a for a in lesson["activities"] if a["activity_type"] == "listening_lab")
    listening["content"]["solutions"]["4"]["answer"] = "C"
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)

    assert "LISTENING_MCQ_ANSWER_INVALID" in _codes(report)


def test_section_mcqs_use_the_learner_letter_key_precedence(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    reading = next(a for a in lesson["activities"] if a["activity_type"] == "reading_lab")
    reading["content"]["questions"][0].update({
        "question_type": "mcq",
        "options": [
            {"letter": "", "key": "A", "text": "Unanswerable"},
            {"letter": "B", "key": "Y", "text": "Other"},
        ],
    })
    reading["content"]["solutions"]["1"]["answer"] = "A"
    listening = next(
        a for a in lesson["activities"] if a["activity_type"] == "listening_lab"
    )
    listening_mcq = listening["content"]["questions"][3]
    listening_mcq["options"] = [
        {"letter": "A", "key": "X", "text": "Learner submits A"},
        {"letter": "B", "key": "Y", "text": "Other"},
    ]
    listening["content"]["solutions"]["4"]["answer"] = "X"
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    report = validate_package(tmp_path)

    assert {
        "READING_MCQ_OPTION_KEY_INVALID",
        "LISTENING_MCQ_ANSWER_INVALID",
    } <= _codes(report)


def test_listening_question_ids_must_be_unique_and_non_empty(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    listening = next(a for a in lesson["activities"] if a["activity_type"] == "listening_lab")
    listening["content"]["questions"][0]["question_number"] = ""
    listening["content"]["questions"][1]["question_number"] = 3
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)

    assert {
        "LISTENING_QUESTION_ID_MISSING",
        "LISTENING_QUESTION_ID_DUPLICATE",
    } <= _codes(report)


def test_listening_rejects_private_fields_in_both_question_representations(
        tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    listening = next(
        a for a in lesson["activities"] if a["activity_type"] == "listening_lab"
    )
    listening["content"]["questions"][0]["answer"] = "leaked"
    listening["content"]["sections"] = [{
        "question_blocks": [{
            "questions": [{
                "question_number": 2, "question_type": "note_completion",
                "stem": "Question 2", "options": [],
                "transcript": "private transcript",
            }],
        }],
    }]
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)

    assert "LISTENING_ANSWER_LEAK" in _codes(report)


def test_sync_revalidates_current_source_instead_of_trusting_stale_qa(tmp_path: Path):
    _write_package(tmp_path)
    (tmp_path / "QA_REPORT.json").write_text(json.dumps({
        "publish_ready": True,
        "summary": {"errors": 0, "warnings": 0},
    }), encoding="utf-8")
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    listening = next(a for a in lesson["activities"] if a["activity_type"] == "listening_lab")
    listening["content"]["questions"][1]["question_number"] = 1
    lesson["provenance"]["content_checksum"] = _checksum_without(
        lesson, "provenance", "content_checksum"
    )
    path.write_text(json.dumps(lesson), encoding="utf-8")
    manifest_path = tmp_path / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["lessons"][0]["content_checksum"] = lesson["provenance"]["content_checksum"]
    manifest["package_checksum"] = _checksum_without(manifest, "package_checksum")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(SystemExit, match="hiện tại không đạt publish-ready"):
        sync(tmp_path, write=False)


def test_listening_figure_sync_uses_canonical_source_checksum(
        tmp_path: Path, monkeypatch):
    package = tmp_path / "package"
    course_source = tmp_path / "course"
    source_figure = course_source / "Listening_Lessons_Web" / "Figures" / "map.svg"
    source_figure.parent.mkdir(parents=True)
    source_figure.write_bytes(b"canonical-v1")
    public = tmp_path / "public"
    target = public / "ADV-T11" / "listening" / "map.svg"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"stale")
    monkeypatch.setattr(sync_module, "_PUBLIC", public)

    with pytest.raises(SystemExit, match="Snapshot deploy không khớp source"):
        sync_module._sync_listening_figure(
            package, course_source, "ADV-T11", "Figures/map.svg", write=False,
        )

    sync_module._sync_listening_figure(
        package, course_source, "ADV-T11", "Figures/map.svg", write=True,
    )
    assert target.read_bytes() == b"canonical-v1"

    source_figure.write_bytes(b"canonical-v2")
    with pytest.raises(SystemExit, match="Snapshot deploy không khớp source"):
        sync_module._sync_listening_figure(
            package, course_source, "ADV-T11", "Figures/map.svg", write=False,
        )


def test_lesson_sync_retains_checksum_versioned_snapshots(tmp_path: Path, monkeypatch):
    content = tmp_path / "content"
    content.mkdir()
    monkeypatch.setattr(sync_module, "_CONTENT", content)
    source_v1 = tmp_path / "v1.json"
    lesson_v1 = _lesson("ADV-T01")
    source_v1.write_text(json.dumps(lesson_v1), encoding="utf-8")
    checksum_v1 = lesson_v1["provenance"]["content_checksum"]

    sync_module._sync_lesson(source_v1, "ADV-T01", checksum_v1, write=True)

    source_v2 = tmp_path / "v2.json"
    lesson_v2 = json.loads(json.dumps(lesson_v1))
    lesson_v2["title"] = "Advanced T01 v2"
    lesson_v2["provenance"]["content_checksum"] = _checksum_without(
        lesson_v2, "provenance", "content_checksum"
    )
    checksum_v2 = lesson_v2["provenance"]["content_checksum"]
    source_v2.write_text(json.dumps(lesson_v2), encoding="utf-8")

    sync_module._sync_lesson(source_v2, "ADV-T01", checksum_v2, write=True)

    assert json.loads((content / "ADV-T01.json").read_text())["title"].endswith("v2")
    assert (content / "versions" / "ADV-T01" / f"{checksum_v1}.json").is_file()
    assert (content / "versions" / "ADV-T01" / f"{checksum_v2}.json").is_file()


def test_media_sync_retains_byte_identical_checksum_versions(tmp_path: Path, monkeypatch):
    public = tmp_path / "public"
    monkeypatch.setattr(sync_module, "_PUBLIC", public)
    canonical = public / "ADV-T01" / "listening" / "full_test.mp3"
    checksum_v1 = "1" * 64
    checksum_v2 = "2" * 64
    source_v1 = tmp_path / "v1.mp3"
    source_v2 = tmp_path / "v2.mp3"
    source_v1.write_bytes(b"listening-v1")
    source_v2.write_bytes(b"listening-v2")

    sync_module._sync_asset(
        source_v1, canonical, "ADV-T01", checksum_v1, write=True,
    )
    sync_module._archive_asset_snapshot("ADV-T01", checksum_v1, write=True)
    sync_module._sync_asset(
        source_v2, canonical, "ADV-T01", checksum_v2, write=True,
    )

    assert canonical.read_bytes() == b"listening-v2"
    assert (public / "versions" / "ADV-T01" / checksum_v1
            / "listening" / "full_test.mp3").read_bytes() == b"listening-v1"
    assert (public / "versions" / "ADV-T01" / checksum_v2
            / "listening" / "full_test.mp3").read_bytes() == b"listening-v2"


@pytest.mark.parametrize("extension", ["svg", "png"])
@pytest.mark.parametrize("write", [False, True])
def test_writing_asset_sync_rejects_bytes_changed_after_lesson_build(
        tmp_path: Path, monkeypatch, extension: str, write: bool):
    package = tmp_path / "package"
    lesson_id = "ADV-T01"
    ref = f"assets/wt1/topic.{extension}"
    source_asset = package / "lessons" / lesson_id / ref
    source_asset.parent.mkdir(parents=True)
    original = f"original-{extension}".encode()
    source_asset.write_bytes(original)
    lesson = {
        "lesson_id": lesson_id,
        "provenance": {"source_checksums": {
            f"Advanced/06_WT1_Illustrations/topic.{extension}":
                hashlib.sha256(original).hexdigest(),
        }},
    }
    public = tmp_path / "public"
    monkeypatch.setattr(sync_module, "_PUBLIC", public)
    content_checksum = "a" * 64
    sync_module._sync_writing_asset(
        package, lesson, lesson_id, ref, content_checksum, write=True,
    )
    source_asset.write_bytes(b"tampered-after-build")

    with pytest.raises(SystemExit, match="Sai checksum source asset"):
        sync_module._sync_writing_asset(
            package, lesson, lesson_id, ref, content_checksum, write=write,
        )

def test_reading_requires_thirteen_questions_and_no_answer_leak(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    reading = next(a for a in lesson["activities"] if a["activity_type"] == "reading_lab")
    reading["content"]["questions"] = reading["content"]["questions"][:12]
    reading["content"]["solutions"] = {
        key: value for key, value in reading["content"]["solutions"].items()
        if int(key) <= 12
    }
    reading["content"]["questions"][0]["answer"] = "leaked"
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert {"READING_QUESTION_COUNT", "READING_ANSWER_LEAK"} <= _codes(report)


def test_reading_question_ids_must_be_unique_and_non_empty(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    reading = next(a for a in lesson["activities"] if a["activity_type"] == "reading_lab")
    reading["content"]["questions"][0]["question_number"] = ""
    reading["content"]["questions"][1]["question_number"] = 3
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)

    assert {
        "READING_QUESTION_ID_MISSING",
        "READING_QUESTION_ID_DUPLICATE",
    } <= _codes(report)


def test_reading_rejects_private_option_fields(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    reading = next(a for a in lesson["activities"] if a["activity_type"] == "reading_lab")
    reading["content"]["questions"][0]["options"] = [{
        "letter": "A", "text": "Visible", "correct": True, "evidence": "Private",
    }]
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)

    assert "READING_OPTION_FIELD_UNEXPECTED" in _codes(report)


def test_reading_rejects_unexpected_top_level_and_passage_fields(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    reading = next(a for a in lesson["activities"] if a["activity_type"] == "reading_lab")
    reading["content"]["answer_key"] = {"1": "private"}
    reading["content"]["passages"][0]["private_support"] = "private"
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    report = validate_package(tmp_path)

    assert {
        "READING_CONTENT_FIELD_UNEXPECTED",
        "READING_PASSAGE_FIELD_UNEXPECTED",
    } <= _codes(report)


@pytest.mark.parametrize("question_count", [13, 14])
def test_reading_mcq_solution_must_match_unique_option_key(
        tmp_path: Path, question_count: int):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    reading = next(a for a in lesson["activities"] if a["activity_type"] == "reading_lab")
    first = reading["content"]["questions"][0]
    first.update({
        "question_type": "mcq",
        "options": [
            {"key": "A", "text": "Correct"},
            {"key": "B", "text": "Wrong"},
        ],
    })
    reading["content"]["solutions"]["1"]["answer"] = "A"
    if question_count == 14:
        reading["content"]["questions"].append({
            "question_number": 14,
            "question_type": "Summary Completion",
            "stem": "Question 14",
            "options": [],
        })
        reading["content"]["solutions"]["14"] = {
            "answer": "answer-14", "evidence": "Evidence",
        }
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    assert validate_package(tmp_path).publish_ready is True

    reading["content"]["solutions"]["1"]["answer"] = "Z"
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    assert "READING_MCQ_ANSWER_INVALID" in _codes(validate_package(tmp_path))


def test_warning_prevents_publish_ready_without_invalidating_schema(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["media"]["audio"][0]["status"] = "rendered_review_required"
    lesson["vocabulary"][0]["common_error"] = ""
    lesson["provenance"]["content_checksum"] = _checksum_without(
        lesson, "provenance", "content_checksum"
    )
    path.write_text(json.dumps(lesson), encoding="utf-8")
    manifest_path = tmp_path / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest_lesson = next(
        row for row in manifest["lessons"] if row["lesson_id"] == "ADV-T01"
    )
    manifest_lesson["content_checksum"] = lesson["provenance"]["content_checksum"]
    manifest["package_checksum"] = _checksum_without(manifest, "package_checksum")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    report = validate_package(tmp_path)
    assert report.schema_valid is True
    assert report.publish_ready is False
    assert {i.code for i in report.warnings} == {"AUDIO_NOT_APPROVED", "COMMON_ERROR_MISSING"}


def test_nonapproved_source_needs_auditable_owner_approval(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["media"]["audio"][0]["source_release_status"] = "REVIEW_REQUIRED"
    lesson["provenance"]["content_checksum"] = _checksum_without(
        lesson, "provenance", "content_checksum"
    )
    path.write_text(json.dumps(lesson), encoding="utf-8")
    manifest_path = tmp_path / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["lessons"][0]["content_checksum"] = lesson["provenance"]["content_checksum"]
    manifest["package_checksum"] = _checksum_without(manifest, "package_checksum")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    report = validate_package(tmp_path)

    assert "MEDIA_APPROVAL_MISSING" in _codes(report)
    assert _codes(report) == {"MEDIA_APPROVAL_MISSING"}


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
