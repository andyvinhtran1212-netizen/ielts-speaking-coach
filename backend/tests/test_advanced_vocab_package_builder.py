from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.advanced_vocab_package_builder import (
    build_package,
    build_writing_reference,
    parse_frontmatter_records,
    sanitize_listening_source,
    split_assessment,
)


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


def test_writing_reference_excludes_full_model_essays():
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

    with pytest.raises(ValueError, match="Expected one topic DOCX"):
        build_package(source, output)

    assert not output.exists()
    assert list(tmp_path.glob(".output.building-*")) == []


def test_builder_rejects_output_inside_canonical_source(tmp_path: Path):
    source = tmp_path / "source"
    source.mkdir()

    with pytest.raises(ValueError, match="outside the canonical source tree"):
        build_package(source, source / "generated")
