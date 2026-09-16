from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from scripts import sync_advanced_vocab_core30 as sync_module
from scripts.sync_advanced_vocab_core30 import sync
from services import advanced_vocab_package_validator as validator_module
from services.advanced_vocab_package_validator import (
    APPROVED_AUTHORED_INPUT_MAP_SHA256,
    CORE_LESSON_IDS,
    FIRST_RELEASE_LOCKED_REVISIONS,
    authored_input_map_revision,
    generated_package_revision,
    source_manifest_revision,
    validate_source_inputs_manifest as _validate_source_inputs_manifest,
    validate_listening_source_directory,
    validate_package as _validate_package,
)


HEADWORD_AUDIO_BYTES = b"shared headword clip"
EXAMPLE_AUDIO_BYTES = b"shared example clip"
LISTENING_AUDIO_BYTES = b"lesson listening clip"
WRITING_SVG_BYTES = b"<svg>writing chart</svg>"
WRITING_PNG_BYTES = b"writing chart png"
HEADWORD_AUDIO_SHA = hashlib.sha256(HEADWORD_AUDIO_BYTES).hexdigest()
EXAMPLE_AUDIO_SHA = hashlib.sha256(EXAMPLE_AUDIO_BYTES).hexdigest()
LISTENING_AUDIO_SHA = hashlib.sha256(LISTENING_AUDIO_BYTES).hexdigest()
WRITING_SVG_SHA = hashlib.sha256(WRITING_SVG_BYTES).hexdigest()
WRITING_PNG_SHA = hashlib.sha256(WRITING_PNG_BYTES).hexdigest()


def validate_package(package_path: Path):
    source = json.loads(
        (package_path / "source-inputs-manifest.json").read_text()
    )
    with patch.dict(
        validator_module.FIRST_RELEASE_LOCKED_REVISIONS,
        source["locked_revisions"],
        clear=True,
    ):
        return _validate_package(package_path)


def validate_source_inputs_manifest(manifest_path: Path, **kwargs):
    source = json.loads(manifest_path.read_text())
    with patch.dict(
        validator_module.FIRST_RELEASE_LOCKED_REVISIONS,
        source["locked_revisions"],
        clear=True,
    ):
        return _validate_source_inputs_manifest(manifest_path, **kwargs)


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
    checkpoint_review_id = f"R{((int(lesson_id[-2:]) - 1) // 5) + 1:02d}"
    lesson = {
        "lesson_id": lesson_id,
        "review": {"checkpoint_review_id": checkpoint_review_id},
        "vocabulary": [
            {"lexeme_id": f"{lesson_id}-lex-{i}",
             "lesson_lexeme_id": f"{lesson_id}__lex-{i}",
             "headword": f"word-{i}",
             "common_error": "A precise usage note.",
             "audio_headword": "assets/vocab-audio/headword.mp3",
             "audio_example": "assets/vocab-audio/example.mp3",
             "audio_provenance": {
                 "engine": "kokoro",
                 "model_tag": "v1.0",
                 "voice": "bf_emma",
                 "headword_checksum": HEADWORD_AUDIO_SHA,
                 "example_checksum": EXAMPLE_AUDIO_SHA,
             }}
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
                f"{lesson_id}-rewrite", "controlled_rewrite",
                interaction_policy="self_check", grading_policy="self_check",
                completion_policy="required", reveal_policy="after_attempt",
                submittable=False,
                content={
                    "prompts": [
                        {"text": "Phần A: Bài tập"},
                        *[
                            {"text": f"{i}. Rewrite sentence {i}."}
                            for i in range(1, 21)
                        ],
                    ],
                    "solutions": [
                        {"text": "Phần A: Đáp án"},
                        *[
                            {"text": f"{i}. Model answer {i}."}
                            for i in range(1, 21)
                        ],
                    ],
                },
            ),
            _activity(
                f"{lesson_id}-reading", "reading_lab",
                content={
                    "passages": [{"paragraph": "A", "text": "Passage"}],
                    "question_material": ["Answer the questions."],
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
            "source_checksums": {
                f"source/{lesson_id}.docx": "b" * 64,
                f"source/audio/{lesson_id}.mp3": LISTENING_AUDIO_SHA,
                "source/wt1/topic.svg": WRITING_SVG_SHA,
                "source/wt1/topic.png": WRITING_PNG_SHA,
            },
            "content_supplements": {
                "common_errors": {
                    "checksum": "c" * 64,
                    "item_count": 88,
                },
            },
        },
        "media": {
            "audio": [{
                "audio_id": f"{lesson_id}-audio",
                "role": "listening_full_test",
                "status": "approved",
                "expected_audio_path": "assets/audio/full_test.mp3",
                "source_path": f"source/audio/{lesson_id}.mp3",
                "checksum": LISTENING_AUDIO_SHA,
            }],
            "wt1_illustrations": [
                "assets/wt1/topic.svg", "assets/wt1/topic.png",
            ],
        },
    }
    lesson["provenance"]["content_checksum"] = _checksum_without(
        lesson, "provenance", "content_checksum"
    )
    return lesson


def _write_package(root: Path, ids=CORE_LESSON_IDS) -> None:
    root.mkdir(parents=True, exist_ok=True)
    source_manifest = {
        "schema_version": "1.0.0",
        "source_id": "test-core30-source",
        "origin": "Product-owner-provided fixture",
        "rights": "Test use",
        "locked_revisions": dict(FIRST_RELEASE_LOCKED_REVISIONS),
        "release_patterns": {
            "source": [
                "source/*.docx", "source/audio/*.mp3",
                "source/reviews/*.md", "source/wt1/*",
            ],
            "common_error_overrides": ["advanced_vocab_common_errors.json"],
            "vocab_audio_bundle": ["manifest.json", "clips/*.mp3"],
        },
        "inputs": [
            {
                "root": "source",
                "path": f"source/{lesson_id}.docx",
                "sha256": "b" * 64,
                "role": "topic_docx",
                "lesson_ids": [lesson_id],
            }
            for lesson_id in ids
        ] + [
            {
                "root": "source",
                "path": f"source/audio/{lesson_id}.mp3",
                "sha256": LISTENING_AUDIO_SHA,
                "role": "listening_audio",
                "lesson_ids": [lesson_id],
            }
            for lesson_id in ids
        ] + [
            {
                "root": "source",
                "path": f"source/reviews/R{number:02d}.md",
                "sha256": "d" * 64,
                "role": "review_markdown",
                "lesson_ids": [],
            }
            for number in range(1, 7)
        ] + [
            {
                "root": "source",
                "path": "source/wt1/topic.svg",
                "sha256": WRITING_SVG_SHA,
                "role": "writing_task1_illustration",
                "lesson_ids": list(ids),
            },
            {
                "root": "source",
                "path": "source/wt1/topic.png",
                "sha256": WRITING_PNG_SHA,
                "role": "writing_task1_illustration",
                "lesson_ids": list(ids),
            },
            {
                "root": "common_error_overrides",
                "path": "advanced_vocab_common_errors.json",
                "sha256": "c" * 64,
                "role": "common_error_overrides",
                "lesson_ids": [],
            },
            {
                "root": "vocab_audio_bundle",
                "path": "manifest.json",
                "sha256": "e" * 64,
                "role": "kokoro_manifest",
                "lesson_ids": [],
            },
            {
                "root": "vocab_audio_bundle",
                "path": "clips/headword.mp3",
                "sha256": HEADWORD_AUDIO_SHA,
                "role": "kokoro_clip",
                "lesson_ids": [],
            },
            {
                "root": "vocab_audio_bundle",
                "path": "clips/example.mp3",
                "sha256": EXAMPLE_AUDIO_SHA,
                "role": "kokoro_clip",
                "lesson_ids": [],
            },
        ],
    }
    source_manifest["locked_revisions"]["authored_input_map_sha256"] = (
        authored_input_map_revision(source_manifest)
    )
    audio_root = root / "assets" / "vocab-audio"
    audio_root.mkdir(parents=True)
    (audio_root / "headword.mp3").write_bytes(HEADWORD_AUDIO_BYTES)
    (audio_root / "example.mp3").write_bytes(EXAMPLE_AUDIO_BYTES)
    lesson_rows = []
    for lesson_id in ids:
        folder = root / "lessons" / lesson_id
        folder.mkdir(parents=True)
        listening_asset = folder / "assets" / "audio" / "full_test.mp3"
        listening_asset.parent.mkdir(parents=True)
        listening_asset.write_bytes(LISTENING_AUDIO_BYTES)
        writing_root = folder / "assets" / "wt1"
        writing_root.mkdir(parents=True)
        (writing_root / "topic.svg").write_bytes(WRITING_SVG_BYTES)
        (writing_root / "topic.png").write_bytes(WRITING_PNG_BYTES)
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
        review["provenance"].update({
            "source_path": f"source/reviews/{review_id}.md",
            "source_checksum": "d" * 64,
        })
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
        "source_revision": "",
        "content_supplements": {
            "common_errors": {
                "checksum": "c" * 64,
                "item_count": 88,
            },
            "vocabulary_audio": {
                "engine": "kokoro",
                "model_tag": "v1.0",
                "voice": "bf_emma",
                "card_count": 720,
                "clip_count": 1390,
                "bundle_checksum": FIRST_RELEASE_LOCKED_REVISIONS[
                    "kokoro_bundle_sha256"
                ],
            },
        },
        "lessons": lesson_rows,
        "reviews": review_rows,
    }
    source_manifest["locked_revisions"]["generated_package_sha256"] = (
        generated_package_revision(manifest)
    )
    source_manifest["source_revision"] = source_manifest_revision(source_manifest)
    manifest["source_revision"] = source_manifest["source_revision"]
    manifest["package_checksum"] = _checksum_without(manifest, "package_checksum")
    (root / "source-inputs-manifest.json").write_text(
        json.dumps(source_manifest), encoding="utf-8"
    )
    (root / "course-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def _refresh_fixture_locks(root: Path) -> None:
    source_path = root / "source-inputs-manifest.json"
    manifest_path = root / "course-manifest.json"
    source = json.loads(source_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    source["locked_revisions"]["authored_input_map_sha256"] = (
        authored_input_map_revision(source)
    )
    source["locked_revisions"]["generated_package_sha256"] = (
        generated_package_revision(manifest)
    )
    source["source_revision"] = source_manifest_revision(source)
    manifest["source_revision"] = source["source_revision"]
    manifest["package_checksum"] = _checksum_without(manifest, "package_checksum")
    source_path.write_text(json.dumps(source), encoding="utf-8")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")


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
    _refresh_fixture_locks(root)


def _codes(report) -> set[str]:
    return {issue.code for issue in report.errors}


def test_valid_first_release_contract_is_publish_ready(tmp_path: Path):
    _write_package(tmp_path)
    report = validate_package(tmp_path)
    assert report.checked_lessons == 30
    assert report.schema_valid is True
    assert report.publish_ready is True


def _write_source_manifest_fixture(root: Path) -> tuple[Path, Path]:
    source = root / "source"
    source.mkdir()
    (source / "T01.docx").write_bytes(b"locked source")
    manifest = {
        "schema_version": "1.0.0",
        "source_id": "source-fixture",
        "origin": "Product owner",
        "rights": "Aver Learning product use",
        "locked_revisions": dict(FIRST_RELEASE_LOCKED_REVISIONS),
        "release_patterns": {"source": ["*.docx"]},
        "inputs": [{
            "root": "source",
            "path": "T01.docx",
            "sha256": hashlib.sha256(b"locked source").hexdigest(),
            "role": "topic_docx",
            "lesson_ids": ["ADV-T01"],
        }],
    }
    manifest["locked_revisions"]["authored_input_map_sha256"] = (
        authored_input_map_revision(manifest)
    )
    manifest["source_revision"] = source_manifest_revision(manifest)
    path = root / "source-inputs-manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path, source


def test_source_manifest_rejects_missing_input(tmp_path: Path):
    manifest, source = _write_source_manifest_fixture(tmp_path)
    (source / "T01.docx").unlink()

    report = validate_source_inputs_manifest(manifest, roots={"source": source})

    assert "SOURCE_INPUT_MISSING" in _codes(report)


def test_source_manifest_rejects_substituted_input(tmp_path: Path):
    manifest, source = _write_source_manifest_fixture(tmp_path)
    (source / "T01.docx").write_bytes(b"substituted")

    report = validate_source_inputs_manifest(manifest, roots={"source": source})

    assert "SOURCE_INPUT_CHECKSUM_MISMATCH" in _codes(report)


def test_source_manifest_lock_rejects_recomputed_substituted_input(tmp_path: Path):
    manifest_path, source = _write_source_manifest_fixture(tmp_path)
    substituted = b"substituted and re-certified"
    (source / "T01.docx").write_bytes(substituted)
    manifest = json.loads(manifest_path.read_text())
    manifest["inputs"][0]["sha256"] = hashlib.sha256(substituted).hexdigest()
    manifest["source_revision"] = source_manifest_revision(manifest)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    report = validate_source_inputs_manifest(manifest_path, roots={"source": source})

    assert "SOURCE_INPUT_CHECKSUM_MISMATCH" not in _codes(report)
    assert "AUTHORED_INPUT_MAP_REVISION_MISMATCH" in _codes(report)


def test_authored_input_lock_uses_owner_approved_path_checksum_map():
    authored_checksum = "a" * 64
    override_checksum = "b" * 64
    manifest = {
        "inputs": [
            {
                "root": "source",
                "path": "Advanced/lesson.docx",
                "sha256": authored_checksum,
                "role": "topic_docx",
                "lesson_ids": ["ADV-T01"],
            },
            {
                "root": "source",
                "path": (
                    "Vocab_Quiz/Advanced_banks/review/"
                    "R01_InterleavedReview_T01-T05.md"
                ),
                "sha256": "d" * 64,
                "role": "checkpoint_review",
                "lesson_ids": ["ADV-T01"],
            },
            {
                "root": "common_error_overrides",
                "path": "advanced_vocab_common_error_overrides.json",
                "sha256": override_checksum,
                "role": "common_error_overrides",
                "lesson_ids": ["ADV-T01"],
            },
            {
                "root": "vocab_audio_bundle",
                "path": "manifest.json",
                "sha256": "c" * 64,
                "role": "vocab_audio_manifest",
                "lesson_ids": ["ADV-T01"],
            },
        ],
    }
    expected = hashlib.sha256(json.dumps(
        {
            "Advanced/lesson.docx": authored_checksum,
            "repo://backend/data/advanced_vocab_common_error_overrides.json": (
                override_checksum
            ),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")).hexdigest()

    assert authored_input_map_revision(manifest) == expected

    manifest["inputs"][0]["role"] = "renamed_metadata_role"
    manifest["inputs"][0]["lesson_ids"] = ["ADV-T02"]
    assert authored_input_map_revision(manifest) == expected


def test_source_manifest_rejects_recertified_role_and_lesson_metadata(tmp_path: Path):
    source = tmp_path / "source"
    relative = (
        "_CORRECTED/Advanced/01_Topics_Upgraded/Cluster_C1/"
        "T01_Family_Upbringing_Advanced_Upgraded.docx"
    )
    source_file = source / relative
    source_file.parent.mkdir(parents=True)
    source_file.write_bytes(b"locked topic")
    manifest = {
        "schema_version": "1.0.0",
        "source_id": "aver-learning-advanced-vocabulary-core30-2026-09-14",
        "origin": "Product owner",
        "rights": "Aver Learning product use",
        "locked_revisions": dict(FIRST_RELEASE_LOCKED_REVISIONS),
        "release_patterns": {"source": [relative]},
        "inputs": [{
            "root": "source",
            "path": relative,
            "sha256": hashlib.sha256(b"locked topic").hexdigest(),
            "role": "reading_source",
            "lesson_ids": ["ADV-T02"],
        }],
    }
    manifest["locked_revisions"]["authored_input_map_sha256"] = (
        APPROVED_AUTHORED_INPUT_MAP_SHA256
    )
    manifest["source_revision"] = source_manifest_revision(manifest)
    manifest_path = tmp_path / "source-inputs-manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    report = validate_source_inputs_manifest(manifest_path, roots={"source": source})

    assert {
        "SOURCE_INPUT_ROLE_MISMATCH", "SOURCE_INPUT_LESSONS_MISMATCH",
    } <= _codes(report)


def test_source_manifest_binds_clip_lessons_to_kokoro_cards(tmp_path: Path):
    audio = tmp_path / "audio"
    clips = audio / "clips"
    clips.mkdir(parents=True)
    clip_id = "a" * 64
    clip_bytes = b"kokoro clip"
    (clips / f"{clip_id}.mp3").write_bytes(clip_bytes)
    audio_manifest = {
        "cards": {
            "ADV-T01__lexeme": {
                "headword": {"clip_id": clip_id},
                "example": {"clip_id": clip_id},
            },
        },
    }
    (audio / "manifest.json").write_text(
        json.dumps(audio_manifest), encoding="utf-8"
    )
    manifest = {
        "schema_version": "1.0.0",
        "source_id": "aver-learning-advanced-vocabulary-core30-2026-09-14",
        "origin": "Product owner",
        "rights": "Aver Learning product use",
        "locked_revisions": dict(FIRST_RELEASE_LOCKED_REVISIONS),
        "release_patterns": {
            "vocab_audio_bundle": ["manifest.json", "clips/*.mp3"],
        },
        "inputs": [
            {
                "root": "vocab_audio_bundle",
                "path": "manifest.json",
                "sha256": hashlib.sha256(
                    (audio / "manifest.json").read_bytes()
                ).hexdigest(),
                "role": "vocab_audio_manifest",
                "lesson_ids": list(CORE_LESSON_IDS),
            },
            {
                "root": "vocab_audio_bundle",
                "path": f"clips/{clip_id}.mp3",
                "sha256": hashlib.sha256(clip_bytes).hexdigest(),
                "role": "vocab_audio_clip",
                "lesson_ids": ["ADV-T02"],
            },
        ],
    }
    manifest["locked_revisions"]["authored_input_map_sha256"] = (
        APPROVED_AUTHORED_INPUT_MAP_SHA256
    )
    manifest["source_revision"] = source_manifest_revision(manifest)
    manifest_path = tmp_path / "source-inputs-manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    report = validate_source_inputs_manifest(
        manifest_path, roots={"vocab_audio_bundle": audio}
    )

    assert "SOURCE_INPUT_LESSONS_MISMATCH" in _codes(report)


@pytest.mark.parametrize("cards", [[], "invalid"])
def test_source_manifest_reports_invalid_kokoro_cards_container(
        tmp_path: Path, cards: object):
    audio = tmp_path / "audio"
    audio.mkdir()
    audio_manifest_path = audio / "manifest.json"
    audio_manifest_path.write_text(json.dumps({"cards": cards}), encoding="utf-8")
    manifest = {
        "schema_version": "1.0.0",
        "source_id": "aver-learning-advanced-vocabulary-core30-2026-09-14",
        "origin": "Product owner",
        "rights": "Aver Learning product use",
        "locked_revisions": dict(FIRST_RELEASE_LOCKED_REVISIONS),
        "release_patterns": {"vocab_audio_bundle": ["manifest.json"]},
        "inputs": [{
            "root": "vocab_audio_bundle",
            "path": "manifest.json",
            "sha256": hashlib.sha256(audio_manifest_path.read_bytes()).hexdigest(),
            "role": "vocab_audio_manifest",
            "lesson_ids": list(CORE_LESSON_IDS),
        }],
    }
    manifest["locked_revisions"]["authored_input_map_sha256"] = (
        APPROVED_AUTHORED_INPUT_MAP_SHA256
    )
    manifest["source_revision"] = source_manifest_revision(manifest)
    manifest_path = tmp_path / "source-inputs-manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    report = validate_source_inputs_manifest(
        manifest_path, roots={"vocab_audio_bundle": audio}
    )

    assert "VOCAB_AUDIO_CARDS_INVALID" in _codes(report)

def test_source_manifest_rejects_undeclared_release_input(tmp_path: Path):
    manifest, source = _write_source_manifest_fixture(tmp_path)
    (source / "T02.docx").write_bytes(b"undeclared")

    report = validate_source_inputs_manifest(manifest, roots={"source": source})

    assert "SOURCE_INPUT_UNDECLARED" in _codes(report)


def test_source_manifest_rejects_wrong_avoc_locked_revision(tmp_path: Path):
    manifest_path, source = _write_source_manifest_fixture(tmp_path)
    manifest = json.loads(manifest_path.read_text())
    manifest["locked_revisions"]["kokoro_bundle_sha256"] = "f" * 64
    manifest["source_revision"] = source_manifest_revision(manifest)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    report = _validate_source_inputs_manifest(manifest_path, roots={"source": source})

    assert "LOCKED_REVISION_MISMATCH" in _codes(report)


def test_package_requires_locked_supplements(tmp_path: Path):
    _write_package(tmp_path)
    lesson_path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(lesson_path.read_text())
    lesson["vocabulary"][0].pop("audio_headword")
    lesson["vocabulary"][0].pop("audio_example")
    _rewrite_lesson_with_checksums(tmp_path, lesson)
    manifest_path = tmp_path / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest.pop("content_supplements")
    manifest["package_checksum"] = _checksum_without(manifest, "package_checksum")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    report = validate_package(tmp_path)

    assert "COMMON_ERROR_SUPPLEMENT_MISSING" in _codes(report)
    assert "VOCAB_AUDIO_SUPPLEMENT_MISSING" in _codes(report)
    assert "VOCAB_AUDIO_MISSING" in _codes(report)


def test_package_binds_clip_lesson_metadata_to_lesson_references(tmp_path: Path):
    _write_package(tmp_path)
    source_path = tmp_path / "source-inputs-manifest.json"
    source = json.loads(source_path.read_text())
    clip_row = next(
        row for row in source["inputs"]
        if row["root"] == "vocab_audio_bundle"
        and row["path"] == "clips/headword.mp3"
    )
    clip_row["lesson_ids"] = ["ADV-T01"]
    source["source_revision"] = source_manifest_revision(source)
    source_path.write_text(json.dumps(source), encoding="utf-8")

    manifest_path = tmp_path / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["source_revision"] = source["source_revision"]
    manifest["package_checksum"] = _checksum_without(
        manifest, "package_checksum"
    )
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    approved = source["locked_revisions"]["authored_input_map_sha256"]
    with patch.object(
        validator_module, "APPROVED_AUTHORED_INPUT_MAP_SHA256", approved
    ):
        report = validate_package(tmp_path)

    assert "VOCAB_AUDIO_INPUT_LESSONS_MISMATCH" in _codes(report)


def test_package_lock_rejects_recomputed_generated_artifact(tmp_path: Path):
    _write_package(tmp_path)
    manifest_path = tmp_path / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["title"] = "Substituted generated package"
    manifest["package_checksum"] = _checksum_without(manifest, "package_checksum")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    report = validate_package(tmp_path)

    assert "PACKAGE_CHECKSUM_MISMATCH" not in _codes(report)
    assert "GENERATED_PACKAGE_REVISION_MISMATCH" in _codes(report)


def test_package_rejects_review_source_outside_manifest(tmp_path: Path):
    _write_package(tmp_path)
    review_path = tmp_path / "reviews" / "R01.json"
    review = json.loads(review_path.read_text())
    review["provenance"]["source_checksum"] = "a" * 64
    review["provenance"]["content_checksum"] = _checksum_without(
        review, "provenance", "content_checksum"
    )
    review_path.write_text(json.dumps(review), encoding="utf-8")
    manifest_path = tmp_path / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["reviews"][0]["content_checksum"] = review["provenance"][
        "content_checksum"
    ]
    manifest["package_checksum"] = _checksum_without(manifest, "package_checksum")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    assert "REVIEW_SOURCE_NOT_IN_MANIFEST" in _codes(validate_package(tmp_path))


def test_generated_lock_rejects_recertified_review_body_substitution(tmp_path: Path):
    _write_package(tmp_path)
    substituted_checksum = "a" * 64

    source_path = tmp_path / "source-inputs-manifest.json"
    source = json.loads(source_path.read_text())
    source_review = next(
        row for row in source["inputs"]
        if row["root"] == "source" and row["path"] == "source/reviews/R01.md"
    )
    source_review["sha256"] = substituted_checksum
    source["source_revision"] = source_manifest_revision(source)
    source_path.write_text(json.dumps(source), encoding="utf-8")

    review_path = tmp_path / "reviews/R01.json"
    review = json.loads(review_path.read_text())
    review["provenance"]["source_checksum"] = substituted_checksum
    review["provenance"]["content_checksum"] = _checksum_without(
        review, "provenance", "content_checksum"
    )
    review_path.write_text(json.dumps(review), encoding="utf-8")

    manifest_path = tmp_path / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["source_revision"] = source["source_revision"]
    manifest["reviews"][0]["content_checksum"] = review["provenance"][
        "content_checksum"
    ]
    manifest["package_checksum"] = _checksum_without(
        manifest, "package_checksum"
    )
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    report = validate_package(tmp_path)

    assert "REVIEW_SOURCE_NOT_IN_MANIFEST" not in _codes(report)
    assert "PACKAGE_CHECKSUM_MISMATCH" not in _codes(report)
    assert "GENERATED_PACKAGE_REVISION_MISMATCH" in _codes(report)


def test_package_rejects_undeclared_kokoro_inputs(tmp_path: Path):
    _write_package(tmp_path)
    source_path = tmp_path / "source-inputs-manifest.json"
    source = json.loads(source_path.read_text())
    source["inputs"] = [
        row for row in source["inputs"]
        if row["root"] != "vocab_audio_bundle"
    ]
    source["release_patterns"].pop("vocab_audio_bundle")
    source["source_revision"] = source_manifest_revision(source)
    source_path.write_text(json.dumps(source), encoding="utf-8")
    manifest_path = tmp_path / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["source_revision"] = source["source_revision"]
    manifest["package_checksum"] = _checksum_without(manifest, "package_checksum")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    assert "VOCAB_AUDIO_SOURCE_NOT_IN_MANIFEST" in _codes(
        validate_package(tmp_path)
    )


def test_package_binds_each_vocab_clip_to_kokoro_manifest_input(tmp_path: Path):
    _write_package(tmp_path)
    source_path = tmp_path / "source-inputs-manifest.json"
    source = json.loads(source_path.read_text())
    headword = next(
        row for row in source["inputs"]
        if row["root"] == "vocab_audio_bundle"
        and row["path"] == "clips/headword.mp3"
    )
    headword["sha256"] = "f" * 64
    source["source_revision"] = source_manifest_revision(source)
    source_path.write_text(json.dumps(source), encoding="utf-8")
    manifest_path = tmp_path / "course-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["source_revision"] = source["source_revision"]
    manifest["package_checksum"] = _checksum_without(manifest, "package_checksum")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    assert "VOCAB_AUDIO_SOURCE_NOT_IN_MANIFEST" in _codes(
        validate_package(tmp_path)
    )


@pytest.mark.parametrize(
    ("mode", "expected_code"),
    [("path", "MEDIA_PATH_MISSING"), ("file", "MEDIA_FILE_MISSING")],
)
def test_package_requires_checksum_bound_listening_asset(
        tmp_path: Path, mode: str, expected_code: str):
    _write_package(tmp_path)
    lesson_path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(lesson_path.read_text())
    if mode == "path":
        lesson["media"]["audio"][0].pop("expected_audio_path")
        _rewrite_lesson_with_checksums(tmp_path, lesson)
    else:
        (lesson_path.parent / "assets" / "audio" / "full_test.mp3").unlink()

    assert expected_code in _codes(validate_package(tmp_path))


def test_package_binds_listening_media_to_authored_source_input(tmp_path: Path):
    _write_package(tmp_path)
    lesson_path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(lesson_path.read_text())
    lesson["media"]["audio"][0]["source_path"] = "source/ADV-T01.docx"
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    assert "LISTENING_AUDIO_SOURCE_MISMATCH" in _codes(
        validate_package(tmp_path)
    )


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


def test_writing_artwork_requires_packaged_source_matched_bytes(tmp_path: Path):
    _write_package(tmp_path)
    svg = tmp_path / "lessons" / "ADV-T01" / "assets" / "wt1" / "topic.svg"
    svg.unlink()
    assert "WRITING_TASK1_ARTWORK_MISSING" in _codes(validate_package(tmp_path))

    svg.write_bytes(b"<svg>substituted chart</svg>")
    assert "WRITING_TASK1_ARTWORK_SOURCE_MISMATCH" in _codes(
        validate_package(tmp_path)
    )


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


def test_each_core_lesson_requires_exactly_one_controlled_rewrite(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    rewrite = next(
        activity for activity in lesson["activities"]
        if activity["activity_type"] == "controlled_rewrite"
    )
    lesson["activities"] = [
        activity for activity in lesson["activities"] if activity is not rewrite
    ]
    path.write_text(json.dumps(lesson), encoding="utf-8")

    assert "CONTROLLED_REWRITE_ACTIVITY_COUNT" in _codes(
        validate_package(tmp_path)
    )

    duplicate = dict(rewrite)
    duplicate["activity_id"] = "ADV-T01-rewrite-duplicate"
    lesson["activities"].extend([rewrite, duplicate])
    path.write_text(json.dumps(lesson), encoding="utf-8")

    assert "CONTROLLED_REWRITE_ACTIVITY_COUNT" in _codes(
        validate_package(tmp_path)
    )


def test_controlled_rewrite_requires_runtime_policies_and_20_parsable_prompts(
        tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    rewrite = next(
        activity for activity in lesson["activities"]
        if activity["activity_type"] == "controlled_rewrite"
    )
    rewrite["interaction_policy"] = "auto_graded"
    rewrite["content"]["prompts"] = rewrite["content"]["prompts"][:-1]
    path.write_text(json.dumps(lesson), encoding="utf-8")

    assert {
        "CONTROLLED_REWRITE_POLICY_INVALID",
        "CONTROLLED_REWRITE_PROMPTS_INVALID",
    } <= _codes(validate_package(tmp_path))


def test_controlled_rewrite_requires_non_empty_private_solutions(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    rewrite = next(
        activity for activity in lesson["activities"]
        if activity["activity_type"] == "controlled_rewrite"
    )
    rewrite["content"]["solutions"] = []
    path.write_text(json.dumps(lesson), encoding="utf-8")

    assert "CONTROLLED_REWRITE_CONTENT_INVALID" in _codes(
        validate_package(tmp_path)
    )


def test_activity_policy_values_are_closed_enums(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["activities"][0]["grading_policy"] = "manual_someday"
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)
    assert "ACTIVITY_POLICY_INVALID" in _codes(report)


def test_non_object_activity_entry_fails_before_runtime_or_import(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["activities"].insert(0, "not-an-activity-object")
    path.write_text(json.dumps(lesson), encoding="utf-8")

    assert "ACTIVITY_ITEM_TYPE" in _codes(validate_package(tmp_path))


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


def test_option_keys_that_collide_after_grading_normalization_fail_every_section(
        tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["adaptive_quiz"]["items"][0]["options"][1]["key"] = "a"
    reading = next(
        activity for activity in lesson["activities"]
        if activity["activity_type"] == "reading_lab"
    )
    reading["content"]["questions"][0].update({
        "question_type": "mcq",
        "options": [
            {"key": "A", "text": "First"},
            {"key": "a", "text": "Second"},
        ],
    })
    reading["content"]["solutions"]["1"]["answer"] = "A"
    listening = next(
        activity for activity in lesson["activities"]
        if activity["activity_type"] == "listening_lab"
    )
    listening["content"]["questions"][3]["options"][1]["letter"] = "a"
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    report = validate_package(tmp_path)

    assert sum(
        issue.code == "MCQ_DUPLICATE_OPTION_KEY" for issue in report.errors
    ) >= 3


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


def test_deterministic_practice_selection_requires_48_unique_questions(
        tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    lesson["vocabulary"].pop()
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    report = validate_package(tmp_path)

    assert "PRACTICE_SELECTION_COUNT" in _codes(report)


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


def test_listening_rejects_mixed_object_and_string_options(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    listening = next(a for a in lesson["activities"] if a["activity_type"] == "listening_lab")
    listening["content"]["questions"][3]["options"].append("hidden string option")
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    report = validate_package(tmp_path)

    assert "LISTENING_OPTION_ITEM_TYPE" in _codes(report)


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
        "answer_key": "private section key",
        "question_blocks": [{
            "solution": "private block solution",
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
    leaks = [
        issue.message for issue in report.errors
        if issue.code == "LISTENING_ANSWER_LEAK"
    ]
    assert any("answer_key" in message for message in leaks)
    assert any("solution" in message for message in leaks)


def test_sync_revalidates_current_source_instead_of_trusting_stale_qa(
        tmp_path: Path, monkeypatch):
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

    monkeypatch.setattr(sync_module, "validate_package", validate_package)
    with pytest.raises(SystemExit, match="hiện tại không đạt publish-ready"):
        sync(tmp_path, write=False)


def test_listening_figure_sync_uses_canonical_source_checksum(
        tmp_path: Path, monkeypatch):
    package = tmp_path / "package"
    course_source = tmp_path / "course"
    source_figure = course_source / "Listening_Lessons_Web" / "Figures" / "map.svg"
    source_figure.parent.mkdir(parents=True)
    source_figure.write_bytes(b"canonical-v1")
    checksum = hashlib.sha256(b"canonical-v1").hexdigest()
    public = tmp_path / "public"
    target = public / "ADV-T11" / "listening" / "map.svg"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"stale")
    monkeypatch.setattr(sync_module, "_PUBLIC", public)

    with pytest.raises(SystemExit, match="Snapshot deploy không khớp source"):
        sync_module._sync_listening_figure(
            package, course_source, "ADV-T11", "Figures/map.svg", write=False,
            checksum=checksum,
        )

    sync_module._sync_listening_figure(
        package, course_source, "ADV-T11", "Figures/map.svg", write=True,
        checksum=checksum,
    )
    assert target.read_bytes() == b"canonical-v1"

    source_figure.write_bytes(b"canonical-v2")
    with pytest.raises(SystemExit, match="Sai checksum source asset"):
        sync_module._sync_listening_figure(
            package, course_source, "ADV-T11", "Figures/map.svg", write=False,
            checksum=checksum,
        )
    with pytest.raises(SystemExit, match="Sai checksum source asset"):
        sync_module._sync_listening_figure(
            package, course_source, "ADV-T11", "Figures/map.svg", write=True,
            checksum=checksum,
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


def test_sync_preflights_assets_before_replacing_lesson_snapshot(
        tmp_path: Path, monkeypatch):
    package = tmp_path / "package"
    lesson_id = "ADV-T01"
    _write_package(package, ids=(lesson_id,))
    lesson_path = package / "lessons" / lesson_id / "lesson.json"
    lesson = json.loads(lesson_path.read_text())

    for index, word in enumerate(lesson["vocabulary"]):
        audio_provenance = {}
        for field, checksum_field in (
            ("audio_headword", "headword_checksum"),
            ("audio_example", "example_checksum"),
        ):
            payload = f"{field}-{index}".encode()
            ref = f"lessons/{lesson_id}/assets/vocab-audio/{field}-{index}.mp3"
            asset = package / ref
            asset.parent.mkdir(parents=True, exist_ok=True)
            asset.write_bytes(payload)
            word[field] = ref
            audio_provenance[checksum_field] = hashlib.sha256(payload).hexdigest()
        word["audio_provenance"] = audio_provenance

    listening_payload = b"listening"
    listening_asset = package / "lessons" / lesson_id / "assets/audio/full_test.mp3"
    listening_asset.parent.mkdir(parents=True, exist_ok=True)
    listening_asset.write_bytes(listening_payload)
    lesson["media"]["audio"] = [{
        "audio_id": "listening", "role": "listening_full_test",
        "status": "approved", "expected_audio_path": "assets/audio/full_test.mp3",
        "checksum": hashlib.sha256(listening_payload).hexdigest(),
    }]

    writing_refs = ["assets/wt1/topic.svg", "assets/wt1/topic.png"]
    lesson["media"]["wt1_illustrations"] = writing_refs
    expected_writing = {ref: f"original-{Path(ref).suffix}".encode() for ref in writing_refs}
    for ref, payload in expected_writing.items():
        asset = package / "lessons" / lesson_id / ref
        asset.parent.mkdir(parents=True, exist_ok=True)
        asset.write_bytes(payload)
        lesson["provenance"]["source_checksums"][
            f"Advanced/06_WT1_Illustrations/{Path(ref).name}"
        ] = hashlib.sha256(payload).hexdigest()
    _rewrite_lesson_with_checksums(package, lesson)
    (package / "QA_REPORT.json").write_text(json.dumps({
        "publish_ready": True, "summary": {"errors": 0, "warnings": 0},
    }), encoding="utf-8")

    repo = tmp_path / "repo"
    content = repo / "backend/content/advanced_vocab"
    public = repo / "frontend/public/assets/advanced-vocab"
    monkeypatch.setattr(sync_module, "_EXPECTED_IDS", (lesson_id,))
    monkeypatch.setattr(sync_module, "_REPO", repo)
    monkeypatch.setattr(sync_module, "_CONTENT", content)
    monkeypatch.setattr(sync_module, "_PUBLIC", public)
    monkeypatch.setattr(sync_module, "validate_package", lambda _source: SimpleNamespace(
        publish_ready=True, to_dict=lambda: {"summary": {"errors": 0, "warnings": 0}},
    ))

    broken_svg = package / "lessons" / lesson_id / writing_refs[0]
    broken_svg.write_bytes(b"tampered-after-build")
    with pytest.raises(SystemExit, match="Sai checksum source asset"):
        sync_module.sync(package, write=True)
    assert not (content / f"{lesson_id}.json").exists()

    broken_svg.write_bytes(expected_writing[writing_refs[0]])
    dry_run_report = sync_module.sync(package, write=False)
    assert dry_run_report["lesson_count"] == 1
    assert not content.exists()
    assert not public.exists()

    sync_module.sync(package, write=True)
    checksum = lesson["provenance"]["content_checksum"]
    assert (content / f"{lesson_id}.json").is_file()
    assert (content / "reviews/R01.json").is_file()
    core_manifest = json.loads((content / "core30-manifest.json").read_text())
    assert core_manifest["review_count"] == 6
    assert core_manifest["lessons"][0]["checkpoint_review_id"] == "R01"
    assert core_manifest["lessons"][0]["checkpoint_review_checksum"] == (
        core_manifest["reviews"][0]["content_checksum"]
    )
    for review in core_manifest["reviews"]:
        review_id = review["review_id"]
        review_checksum = review["content_checksum"]
        canonical_review = content / "reviews" / f"{review_id}.json"
        versioned_review = (
            content / "versions" / "reviews" / review_id
            / f"{review_checksum}.json"
        )
        assert canonical_review.read_bytes() == versioned_review.read_bytes()
    for ref, payload in expected_writing.items():
        versioned = public / "versions" / lesson_id / checksum / "writing" / Path(ref).name
        assert versioned.read_bytes() == payload

    canonical_asset_root = public / lesson_id
    hidden_asset_root = public / f".{lesson_id}.missing"
    canonical_asset_root.rename(hidden_asset_root)
    with pytest.raises(SystemExit, match="snapshot asset không đầy đủ"):
        sync_module.sync(package, write=False)
    hidden_asset_root.rename(canonical_asset_root)

    canonical_review = content / "reviews/R01.json"
    hidden_review = content / "reviews/.R01.missing"
    canonical_review.rename(hidden_review)
    with pytest.raises(SystemExit, match="Snapshot review không đầy đủ"):
        sync_module.sync(package, write=False)
    hidden_review.rename(canonical_review)

    canonical_lesson = content / f"{lesson_id}.json"
    before = canonical_lesson.read_bytes()
    lesson["title"] = "A newer source revision"
    _rewrite_lesson_with_checksums(package, lesson)
    stale_asset = public / lesson_id / "listening" / "obsolete.mp3"
    stale_asset.write_bytes(b"stale")

    with pytest.raises(SystemExit, match="snapshot asset không đầy đủ"):
        sync_module.sync(package, write=True)

    assert canonical_lesson.read_bytes() == before


def test_prepare_reviews_rejects_unresolved_checkpoint_review(tmp_path: Path):
    package = tmp_path / "package"
    lesson_id = "ADV-T01"
    _write_package(package, ids=(lesson_id,))
    lesson_path = package / "lessons" / lesson_id / "lesson.json"
    lesson = json.loads(lesson_path.read_text())
    lesson["review"]["checkpoint_review_id"] = "R02"
    _rewrite_lesson_with_checksums(package, lesson)
    manifest = json.loads((package / "course-manifest.json").read_text())

    with pytest.raises(SystemExit, match="checkpoint_review_id phải là R01"):
        sync_module._prepare_reviews(
            package, manifest, [{"lesson_id": lesson_id, "lesson": lesson}],
        )


def test_prepare_reviews_rejects_review_checksum_mismatch(tmp_path: Path):
    package = tmp_path / "package"
    lesson_id = "ADV-T01"
    _write_package(package, ids=(lesson_id,))
    review_path = package / "reviews/R01.json"
    review = json.loads(review_path.read_text())
    review["items"][0]["options"][0] = "Tampered"
    review_path.write_text(json.dumps(review), encoding="utf-8")
    manifest = json.loads((package / "course-manifest.json").read_text())
    lesson = json.loads(
        (package / "lessons" / lesson_id / "lesson.json").read_text()
    )

    with pytest.raises(SystemExit, match="R01: nội dung không khớp"):
        sync_module._prepare_reviews(
            package, manifest, [{"lesson_id": lesson_id, "lesson": lesson}],
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


@pytest.mark.parametrize(
    "private_field",
    ["accepted_variants", "explanation", "correction", "solution"],
)
def test_reading_rejects_every_answer_bearing_learner_field(
        tmp_path: Path, private_field: str):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    reading = next(
        activity for activity in lesson["activities"]
        if activity["activity_type"] == "reading_lab"
    )
    reading["content"]["questions"][0][private_field] = "private"
    path.write_text(json.dumps(lesson), encoding="utf-8")

    report = validate_package(tmp_path)

    assert {
        "READING_ANSWER_LEAK", "READING_QUESTION_FIELD_UNEXPECTED",
    } <= _codes(report)


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


def test_reading_question_material_allows_only_public_strings(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    reading = next(
        activity for activity in lesson["activities"]
        if activity["activity_type"] == "reading_lab"
    )
    reading["content"]["question_material"].append({"answer": "secret"})
    path.write_text(json.dumps(lesson), encoding="utf-8")

    assert "READING_QUESTION_MATERIAL_INVALID" in _codes(
        validate_package(tmp_path)
    )


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


@pytest.mark.parametrize(
    ("question_type", "invalid_answer"),
    [("T/F/NG", "YES"), ("Y/N/NG", "FALSE")],
)
def test_reading_fixed_choice_solution_must_use_supported_answer(
        tmp_path: Path, question_type: str, invalid_answer: str):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    reading = next(
        activity for activity in lesson["activities"]
        if activity["activity_type"] == "reading_lab"
    )
    reading["content"]["questions"][0]["question_type"] = question_type
    reading["content"]["solutions"]["1"]["answer"] = invalid_answer
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    assert "READING_FIXED_CHOICE_ANSWER_INVALID" in _codes(
        validate_package(tmp_path)
    )


def test_listening_figure_requires_checksum(tmp_path: Path):
    _write_package(tmp_path)
    path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(path.read_text())
    listening = next(
        activity for activity in lesson["activities"]
        if activity["activity_type"] == "listening_lab"
    )
    listening["content"]["sections"] = [{"figure": "Figures/map.svg"}]
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    assert "LISTENING_FIGURE_CHECKSUM_INVALID" in _codes(
        validate_package(tmp_path)
    )


def test_listening_figure_requires_packaged_checksum_matched_bytes(tmp_path: Path):
    _write_package(tmp_path)
    lesson_path = tmp_path / "lessons" / "ADV-T01" / "lesson.json"
    lesson = json.loads(lesson_path.read_text())
    listening = next(
        activity for activity in lesson["activities"]
        if activity["activity_type"] == "listening_lab"
    )
    figure_bytes = b"<svg>locked map</svg>"
    figure_checksum = hashlib.sha256(figure_bytes).hexdigest()
    listening["content"]["sections"] = [{
        "figure": "Figures/map.svg",
        "figure_checksum": figure_checksum,
    }]
    lesson["provenance"]["source_checksums"]["source/Figures/map.svg"] = (
        figure_checksum
    )
    figure_path = lesson_path.parent / "Figures" / "map.svg"
    figure_path.parent.mkdir(parents=True)
    figure_path.write_bytes(figure_bytes)
    _rewrite_lesson_with_checksums(tmp_path, lesson)
    source_manifest_path = tmp_path / "source-inputs-manifest.json"
    source_manifest = json.loads(source_manifest_path.read_text())
    source_manifest["release_patterns"]["source"].append("source/Figures/*.svg")
    source_manifest["inputs"].append({
        "root": "source",
        "path": "source/Figures/map.svg",
        "sha256": figure_checksum,
        "role": "listening_figure",
        "lesson_ids": ["ADV-T01"],
    })
    source_manifest_path.write_text(json.dumps(source_manifest), encoding="utf-8")
    _refresh_fixture_locks(tmp_path)
    assert validate_package(tmp_path).publish_ready is True

    figure_path.unlink()
    assert "LISTENING_FIGURE_MISSING" in _codes(validate_package(tmp_path))

    figure_path.write_bytes(b"<svg>substituted map</svg>")
    assert "LISTENING_FIGURE_CHECKSUM_MISMATCH" in _codes(
        validate_package(tmp_path)
    )


def test_t11_listening_figure_must_match_hub_semantics_and_answer_keys(
        tmp_path: Path):
    _write_package(tmp_path)
    lesson_path = tmp_path / "lessons" / "ADV-T11" / "lesson.json"
    lesson = json.loads(lesson_path.read_text())
    listening = next(
        activity for activity in lesson["activities"]
        if activity["activity_type"] == "listening_lab"
    )
    relative = "source/Figures/VOC-ADV-LIS-LSN-T11_map.svg"
    figure_ref = "Figures/VOC-ADV-LIS-LSN-T11_map.svg"
    campus_bytes = b"<svg><text>CAMPUS MAP</text><text>D</text><text>F</text></svg>"
    campus_checksum = hashlib.sha256(campus_bytes).hexdigest()
    listening["content"]["sections"] = [{
        "figure": figure_ref,
        "figure_checksum": campus_checksum,
    }]
    listening["content"]["solutions"]["1"]["answer"] = "D"
    listening["content"]["solutions"]["2"]["answer"] = "F"
    lesson["provenance"]["source_checksums"][relative] = campus_checksum
    figure_path = lesson_path.parent / figure_ref
    figure_path.parent.mkdir(parents=True)
    figure_path.write_bytes(campus_bytes)
    _rewrite_lesson_with_checksums(tmp_path, lesson)

    source_manifest_path = tmp_path / "source-inputs-manifest.json"
    source_manifest = json.loads(source_manifest_path.read_text())
    source_manifest["release_patterns"]["source"].append("source/Figures/*.svg")
    source_manifest["inputs"].append({
        "root": "source",
        "path": relative,
        "sha256": campus_checksum,
        "role": "listening_figure",
        "lesson_ids": ["ADV-T11"],
    })
    source_manifest_path.write_text(json.dumps(source_manifest), encoding="utf-8")
    _refresh_fixture_locks(tmp_path)

    assert "LISTENING_FIGURE_CONTENT_MISMATCH" in _codes(
        validate_package(tmp_path)
    )

    hub_bytes = (
        b"<svg><text>WESTPORT INTERMODAL HUB</text>"
        b"<text>CENTRAL ATRIUM</text><text>COACH BAYS</text>"
        b"<text>INTERCITY RAIL PLATFORMS</text>"
        b"<text>ELEVATED WALKWAY</text><text>D</text><text>F</text></svg>"
    )
    hub_checksum = hashlib.sha256(hub_bytes).hexdigest()
    figure_path.write_bytes(hub_bytes)
    listening["content"]["sections"][0]["figure_checksum"] = hub_checksum
    lesson["provenance"]["source_checksums"][relative] = hub_checksum
    _rewrite_lesson_with_checksums(tmp_path, lesson)
    source_manifest = json.loads(source_manifest_path.read_text())
    source_row = next(
        row for row in source_manifest["inputs"] if row.get("path") == relative
    )
    source_row["sha256"] = hub_checksum
    source_manifest_path.write_text(json.dumps(source_manifest), encoding="utf-8")
    _refresh_fixture_locks(tmp_path)

    assert validate_package(tmp_path).publish_ready is True

    listening["content"]["solutions"]["2"]["answer"] = "E"
    _rewrite_lesson_with_checksums(tmp_path, lesson)
    assert "LISTENING_FIGURE_ANSWER_MISMATCH" in _codes(
        validate_package(tmp_path)
    )

    listening["content"]["solutions"]["1"] = "D"
    _rewrite_lesson_with_checksums(tmp_path, lesson)
    malformed_codes = _codes(validate_package(tmp_path))
    assert "LISTENING_SOLUTION_ITEM_TYPE" in malformed_codes
    assert "LISTENING_FIGURE_ANSWER_MISMATCH" in malformed_codes


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
    _refresh_fixture_locks(tmp_path)

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
    _refresh_fixture_locks(tmp_path)

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
