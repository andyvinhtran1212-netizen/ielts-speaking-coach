from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from services import advanced_vocab_package_builder as builder_module
from services.advanced_vocab_package_builder import (
    _extract_objectives,
    build_package,
    build_writing_reference,
    parse_frontmatter_records,
    sanitize_reading_source,
    sanitize_listening_source,
    split_assessment,
)
from services.advanced_vocab_package_validator import (
    FIRST_RELEASE_LOCKED_REVISIONS,
    source_manifest_revision,
)


def _source_manifest(root: Path, overrides: Path | None = None) -> Path:
    source_file = root / "declared.txt"
    source_file.write_bytes(b"declared")
    manifest = {
        "schema_version": "1.0.0",
        "source_id": "builder-fixture",
        "origin": "Product owner",
        "rights": "Aver Learning product use",
        "locked_revisions": dict(FIRST_RELEASE_LOCKED_REVISIONS),
        "release_patterns": {"source": ["declared.txt"]},
        "inputs": [{
            "root": "source",
            "path": "declared.txt",
            "sha256": hashlib.sha256(b"declared").hexdigest(),
            "role": "fixture",
            "lesson_ids": [],
        }],
    }
    if overrides is not None:
        manifest["release_patterns"]["common_error_overrides"] = [overrides.name]
        manifest["inputs"].append({
            "root": "common_error_overrides",
            "path": overrides.name,
            "sha256": hashlib.sha256(overrides.read_bytes()).hexdigest(),
            "role": "common_error_overrides",
            "lesson_ids": [],
        })
    manifest["source_revision"] = source_manifest_revision(manifest)
    path = root.parent / "source-inputs-manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path


def test_reading_sanitizer_keeps_passage_and_hides_answers():
    source = {
        "test_id": "VOC-ADV-RDG-LSN-T01",
        "title": "Reading lesson",
        "passages": [{"paragraph": "A", "text": "Learner passage"}],
        "question_material": ["Choose the correct answer."],
        "items": [{
            "question_number": 1,
            "question_type": "MCQ",
            "stem": "What is the purpose?",
            "options": [{"letter": "A", "text": "One"}, {"letter": "B", "text": "Two"}],
            "answer": "B",
            "evidence": "Private evidence",
            "trap_analysis": "Private trap",
        }],
    }

    content = sanitize_reading_source(source)

    assert content["passages"][0]["text"] == "Learner passage"
    assert "answer" not in content["questions"][0]
    assert "evidence" not in content["questions"][0]
    assert content["solutions"]["1"] == {
        "answer": "B", "evidence": "Private evidence", "trap_analysis": "Private trap",
    }


def test_writing_objectives_are_normalized_to_reference_only():
    part = {"blocks": [
        {"type": "heading", "text": "0.1 Can-do"},
        {"type": "list_item", "text": "Viết model essay Band 8"},
        {"type": "list_item", "text": "Áp dụng hedging trong Writing Task 2 essays"},
        {"type": "list_item", "text": "Dùng 24 từ trong ngữ cảnh"},
    ]}

    objectives = _extract_objectives(part)

    assert objectives == [
        "Phân tích đề Writing và tham khảo ý tưởng, dàn bài, ngôn ngữ hữu ích trước khi làm assignment do giáo viên giao",
        "Dùng 24 từ trong ngữ cảnh",
    ]


def test_parse_repeated_frontmatter_records(tmp_path: Path):
    path = tmp_path / "cards.md"
    path.write_text(
        "---\nheadword: First\n---\nBody one\n\n"
        "---\nheadword: Second\n---\nBody two\n",
        encoding="utf-8",
    )

    records = parse_frontmatter_records(path)

    assert records == [
        ({"headword": "First"}, "Body one"),
        ({"headword": "Second"}, "Body two"),
    ]


def test_listening_sanitizer_separates_visible_options_and_rationales():
    source = {
        "test_id": "VOC-ADV-LIS-LSN-T01",
        "title": "Test",
        "sections": [{
            "section_id": "S3",
            "audio_script": [{"speaker": "A", "text": "Private transcript"}],
            "question_blocks": [{
                "block_id": "B1",
                "questions": [{
                    "question_number": 1,
                    "question_type": "mcq",
                    "options": [
                        {"letter": "A", "text": "Learner option A"},
                        {"letter": "B", "text": "Learner option B"},
                        {"letter": "A", "text": "Correct — explanation"},
                        {"letter": "B", "text": "Distractor — explanation"},
                    ],
                }],
                "answers": [{"qnum": "1", "answer": "A", "evidence": "Evidence"}],
            }],
        }],
    }
    timings = {"question_index": {"1": {"start": 10.0, "end": 20.0}}}

    content = sanitize_listening_source(source, timings)

    assert [option["letter"] for option in content["questions"][0]["options"]] == ["A", "B"]
    assert content["solutions"]["1"]["distractor_rationales"] == {
        "A": "Correct — explanation",
        "B": "Distractor — explanation",
    }
    assert "audio_script" not in content["sections"][0]
    assert content["private_support"]["visibility"] == "admin_only"


def test_listening_sanitizer_rejects_unexpected_duplicate_options():
    source = {
        "sections": [{
            "question_blocks": [{
                "questions": [{
                    "question_number": 1,
                    "question_type": "mcq",
                    "options": [
                        {"letter": "A", "text": "First learner option"},
                        {"letter": "A", "text": "Another learner option"},
                    ],
                }],
                "answers": [{"qnum": "1", "answer": "A", "evidence": "Evidence"}],
            }],
        }],
    }

    with pytest.raises(ValueError, match="Unexpected duplicate option"):
        sanitize_listening_source(source, {"question_index": {}})


def _section(section_id: str, headings: list[tuple[str, str]]) -> dict:
    blocks = []
    for heading, body in headings:
        blocks.extend([
            {"type": "heading", "text": heading, "level": 4},
            {"type": "paragraph", "text": body},
        ])
    return {"section_id": section_id, "title": section_id, "blocks": blocks}


def test_writing_reference_fallback_excludes_full_model_essays():
    sections = [
        _section("part_3", [("Main Ideas Bank", "Fallback ideas")]),
        _section("part_7", [
            ("(a) Đề bài", "Task 1 prompt"),
            ("(c) Gợi ý dàn bài", "Task 1 outline"),
            ("(e) Bài mẫu BAND 7.0", "Full Task 1 model"),
        ]),
        _section("part_8", [
            ("(1) Đề bài", "Task 2 prompt"),
            ("(3) Ý tưởng hai chiều", "Two-sided ideas"),
            ("(4) Gợi ý dàn bài", "Task 2 outline"),
            ("(7) Bài luận mẫu BAND 7.0", "Full Task 2 model"),
        ]),
    ]

    reference = build_writing_reference(sections)
    rendered = json.dumps(reference, ensure_ascii=False)

    assert "Task 1 prompt" in rendered
    assert "Task 2 prompt" in rendered
    assert "Two-sided ideas" in rendered
    assert "Full Task 1 model" not in rendered
    assert "Full Task 2 model" not in rendered
    assert reference["annotated_examples"] == []


def test_writing_reference_uses_question_banks_models_ideas_and_artwork():
    sections = [
        _section("part_3", [("Main Ideas Bank", "Fallback ideas")]),
        _section("part_7", [("(a) Đề bài", "Legacy Task 1 prompt")]),
        _section("part_8", [("(1) Đề bài", "Legacy Task 2 prompt")]),
    ]
    wt1 = [
        {"type": "heading", "text": "T01 — FAMILY · [LINE]", "level": 1},
        {"type": "heading", "text": "ĐỀ BÀI (Question)", "level": 2},
        {"type": "paragraph", "text": "Task 1 bank prompt"},
        {"type": "heading", "text": "BẢNG SỐ LIỆU GỐC", "level": 2},
        {"type": "table", "rows": [["Year", "Value"], ["2020", "38%"]]},
        {"type": "heading", "text": "BÀI MẪU BAND 7.0", "level": 2},
        {"type": "paragraph", "text": "Full Task 1 Band 7 reference"},
        {"type": "heading", "text": "BÀI MẪU BAND 8.0", "level": 2},
        {"type": "paragraph", "text": "Full Task 1 Band 8 reference"},
        {"type": "heading", "text": "Khác biệt Band 7 → Band 8", "level": 2},
        {"type": "paragraph", "text": "Task 1 comparison"},
    ]
    wt2 = [
        {"type": "heading", "text": "T01 — FAMILY · [DISCUSSION]", "level": 2},
        {"type": "paragraph", "text": "ĐỀ BÀI (Question)"},
        {"type": "table", "rows": [["Task 2 bank prompt"]]},
        {"type": "paragraph", "text": "BÀI MẪU BAND 7.0"},
        {"type": "paragraph", "text": "Full Task 2 Band 7 reference"},
        {"type": "paragraph", "text": "BÀI MẪU BAND 8.0"},
        {"type": "paragraph", "text": "Full Task 2 Band 8 reference"},
        {"type": "paragraph", "text": "▸ Khác biệt Band 7 → Band 8"},
        {"type": "paragraph", "text": "Task 2 comparison"},
    ]
    ideas = [{"type": "heading", "text": "T01 — FAMILY", "level": 1}]
    for index in range(1, 13):
        ideas.extend([
            {"type": "heading", "text": f"{index}. Idea angle", "level": 2},
            {"type": "paragraph", "text": f"Idea {index}"},
        ])
    ideas.extend([
        {"type": "heading", "text": "★ WORD BANK", "level": 2},
        {"type": "paragraph", "text": "close-knit family"},
    ])

    reference = build_writing_reference(
        sections,
        topic_code="T01",
        wt1_bank_blocks=wt1,
        wt2_bank_blocks=wt2,
        wt2_idea_blocks=ideas,
        illustration_refs=["assets/wt1/T01_Family.svg", "assets/wt1/T01_Family.png"],
    )

    assert reference["excluded_content"] == []
    assert reference["model_answers_visibility"] == "collapsed_reference"
    assert reference["tasks"]["task_1"]["task_type"] == "LINE"
    assert len(reference["tasks"]["task_1"]["model_answers"]) == 2
    assert reference["tasks"]["task_1"]["illustrations"] == [
        "assets/wt1/T01_Family.svg", "assets/wt1/T01_Family.png",
    ]
    assert len(reference["tasks"]["task_2"]["idea_sections"]) == 12
    rendered = json.dumps(reference, ensure_ascii=False)
    assert "Full Task 1 Band 8 reference" in rendered
    assert "Full Task 2 Band 8 reference" in rendered


def test_assessment_is_split_into_self_check_prompts_and_solutions():
    blocks = [
        {"type": "paragraph", "text": "Rewrite this sentence"},
        {"type": "paragraph", "text": "ĐÁP ÁN THAM KHẢO (Answer key)"},
        {"type": "paragraph", "text": "Suggested rewrite"},
    ]

    assessment = split_assessment(blocks)

    assert assessment["prompts"][0]["text"] == "Rewrite this sentence"
    assert assessment["solutions"][0]["text"] == "Suggested rewrite"
    assert assessment["solutions_visibility"] == "after_attempt"


def test_builder_refuses_to_overwrite_existing_output(tmp_path: Path):
    source = tmp_path / "source"
    output = tmp_path / "output"
    source.mkdir()
    output.mkdir()

    with pytest.raises(FileExistsError, match="Refusing to overwrite"):
        build_package(source, output)


def test_failed_build_removes_private_staging_directory(tmp_path: Path):
    source = tmp_path / "source"
    output = tmp_path / "output"
    source.mkdir()
    overrides = tmp_path / "overrides.json"
    overrides.write_text('{"items": []}', encoding="utf-8")
    manifest = _source_manifest(source, overrides)

    with pytest.raises(ValueError, match="Expected one topic DOCX"):
        build_package(
            source,
            output,
            source_manifest_path=manifest,
            common_error_overrides_path=overrides,
        )

    assert not output.exists()
    assert list(tmp_path.glob(".output.building-*")) == []


def test_builder_rejects_consumed_override_missing_from_manifest(tmp_path: Path):
    source = tmp_path / "source"
    output = tmp_path / "output"
    source.mkdir()
    manifest = _source_manifest(source)
    overrides = tmp_path / "overrides.json"
    overrides.write_text('{"items": []}', encoding="utf-8")

    with pytest.raises(ValueError, match="Consumed common_error_overrides inputs"):
        build_package(
            source,
            output,
            source_manifest_path=manifest,
            common_error_overrides_path=overrides,
        )

    assert not output.exists()


def test_builder_never_promotes_an_invalid_generated_package(
        tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    source = tmp_path / "source"
    output = tmp_path / "output"
    source.mkdir()
    overrides = tmp_path / "overrides.json"
    overrides.write_text('{"items": []}', encoding="utf-8")
    manifest = _source_manifest(source, overrides)
    monkeypatch.setattr(
        builder_module,
        "_build_package_contents",
        lambda _source, staging, *_args: staging,
    )
    monkeypatch.setattr(
        builder_module,
        "validate_package",
        lambda _staging: SimpleNamespace(
            schema_valid=True,
            publish_ready=False,
            errors=[],
            warnings=[SimpleNamespace(code="AUDIO_NOT_APPROVED",
                                      message="Listening audio requires approval")],
        ),
    )

    with pytest.raises(ValueError, match="Generated package validation failed"):
        build_package(
            source,
            output,
            source_manifest_path=manifest,
            common_error_overrides_path=overrides,
        )

    assert not output.exists()
    assert list(tmp_path.glob(".output.building-*")) == []


def test_builder_rejects_substituted_source_before_output(tmp_path: Path):
    source = tmp_path / "source"
    output = tmp_path / "output"
    source.mkdir()
    manifest = _source_manifest(source)
    (source / "declared.txt").write_bytes(b"changed")

    with pytest.raises(ValueError, match="SOURCE_INPUT_CHECKSUM_MISMATCH"):
        build_package(source, output, source_manifest_path=manifest)

    assert not output.exists()


def test_builder_rejects_output_inside_canonical_source(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()

    with pytest.raises(ValueError, match="outside the canonical source tree"):
        build_package(source, source / "generated")
