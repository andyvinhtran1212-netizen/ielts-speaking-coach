"""Existing Reading import must retain authored instructions and word limits."""

from copy import deepcopy

import pytest
import yaml

from services.content_import_service import (
    build_reading_test_payloads,
    parse_reading_test,
    validate_reading_test,
)


def _document():
    return {
        "content_type": "reading_full_test",
        "test_id": "PRIVATE-REVISION-01",
        "title": "Private source revision",
        "published": False,
        "module": "academic",
        "passage_count": 1,
        "total_questions": 3,
        "passages": [{
            "slug": "private-revision-01-p1",
            "passage_order": 1,
            "title": "An invented practice passage",
            "body_markdown": "A. A fictional harbour used fresh water.\n\nG. The closing paragraph contrasts different views.",
            "questions": [
                {
                    "q_num": 1,
                    "question_type": "matching_information",
                    "prompt": "A comparison between two views",
                    "instruction": "Read paragraphs A–G.\nNB You may use a letter more than once.",
                    "template": {"paragraph_labels": list("ABCDEFG")},
                    "answer": "G",
                    "alternatives": [],
                    "skill_tag": "scanning",
                    "solution": {"source_excerpt": "The closing paragraph contrasts different views."},
                },
                {
                    "q_num": 2,
                    "question_type": "notes_completion",
                    "prompt": "The harbour used fresh {{2}}.",
                    "word_limit": "ONE WORD ONLY",
                    "template": {"summary_text": "The harbour used fresh {{2}}."},
                    "answer": "water",
                    "alternatives": ["Water"],
                    "skill_tag": "scanning",
                    "solution": {"tips": "Copy the noun from the fictional passage."},
                },
                {
                    "q_num": 3,
                    "question_type": "summary_completion",
                    "prompt": "The closing paragraph contrasts {{3}}.",
                    "instruction": "  Write a letter from the bank, A–J.\nKeep one answer in each box.  ",
                    "options": [{"label": "A", "text": "one location"}, {"label": "J", "text": "different views"}],
                    "template": {"summary_text": "The closing paragraph contrasts {{3}}."},
                    "answer": "J",
                    "alternatives": [],
                    "skill_tag": "scanning",
                    "solution": {"question_text": "The closing paragraph contrasts ____.", "vocab": ["contrast = compare differences"]},
                },
            ],
        }],
    }


def _parse(document):
    return parse_reading_test("---\n" + yaml.safe_dump(document, allow_unicode=True) + "---\n")


def test_existing_import_roundtrip_preserves_authored_fields_and_protected_answers():
    document = _document()
    original = deepcopy(document)
    parsed = _parse(document)
    assert validate_reading_test(parsed) == []
    plan = build_reading_test_payloads(parsed)
    assert plan["test_row"]["status"] == "draft"
    assert plan["test_row"]["test_id"] == document["test_id"]
    assert plan["passage_rows"][0]["status"] == "draft"
    slug, rows = plan["passage_questions"][0]
    assert slug == document["passages"][0]["slug"]
    for authored, row in zip(document["passages"][0]["questions"], rows, strict=True):
        expected_payload = {
            key: authored[key]
            for key in ("instruction", "word_limit", "options", "template", "solution")
            if key in authored
        }
        assert row["payload"] == expected_payload
        assert row["answer"] == {"answer": authored["answer"], "alternatives": authored["alternatives"]}
        assert row["q_num"] == authored["q_num"]
        assert row["prompt"] == authored["prompt"]
        assert row["question_type"] == authored["question_type"]
        assert row["skill_tag"] == authored["skill_tag"]
    assert document == original


@pytest.mark.parametrize("field_name", ["instruction", "word_limit"])
@pytest.mark.parametrize("invalid", [None, True, 2, [], {}, "", " \n "])
def test_import_rejects_invalid_authored_instruction_fields_without_coercion(field_name, invalid):
    document = _document()
    document["passages"][0]["questions"][0][field_name] = invalid
    errors = validate_reading_test(_parse(document))
    assert any(f"'{field_name}:'" in error["message"] for error in errors)


def test_absent_authored_instruction_fields_keep_the_legacy_payload_shape():
    document = _document()
    for question in document["passages"][0]["questions"]:
        question.pop("instruction", None)
        question.pop("word_limit", None)
    parsed = _parse(document)
    assert validate_reading_test(parsed) == []
    for _, rows in build_reading_test_payloads(parsed)["passage_questions"]:
        for row in rows:
            assert "instruction" not in row["payload"]
            assert "word_limit" not in row["payload"]
