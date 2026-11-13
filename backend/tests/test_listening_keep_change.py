"""Synthetic KEEP/CHANGE import → persisted key → normal grading contract."""
import copy
import hashlib
import json

import pytest

from services import listening_convert as convert
from services import listening_fulltest_import as importer
from services import listening_test_grader as grader
from services.mock_response_policy import authored_response_policies


QP = """# Synthetic contact check
## SECTION 1
### Questions 1-2
<!-- qtype: keep_change -->
> Choose KEEP or CHANGE and correct the printed value.
**1.** Cedar Avenue.
**2.** Northfield ZX4 8QP
"""


def pack(second="CHANGE: Westfield ZX4 9QP / ZX4 9QP / 9QP"):
    solution = f"""## Quick Answer Key
| **1.** KEEP | **2.** {second} |
## Solutions
### Q1
**Answer:** KEEP
**Replay:** audio://full_test.mp3?start=1&end=3&q=1&section=S1
**Vì sao đúng:** Địa chỉ in sẵn khớp với lời nói.
### Q2
**Answer:** {second}
**Replay:** audio://full_test.mp3?start=4&end=6&q=2&section=S1
**Vì sao đúng:** Người nói sửa mã bưu điện thành 9QP.
"""
    timings = {"full_test": {"section_offsets": {"S1": 0}}, "sections": [
        {"id": "S1", "questions": {"1": {"start": 1, "end": 3}, "2": {"start": 4, "end": 6}}}
    ]}
    return solution, timings


def parsed_rows():
    solution, timings = pack()
    parsed = importer.parse_fulltest(QP, solution, timings)
    assert parsed.ok, parsed.errors
    return parsed, importer.build_section_persistence(parsed, QP)[0]["exercise_rows"]


def test_marker_extracts_printed_values_without_stripping_punctuation():
    block = convert.parse_question_blocks(QP)[0]
    assert block["q_type"] == block["template_kind"] == "keep_change"
    assert [(q["q_num"], q["printed_value"]) for q in block["questions"]] == [
        (1, "Cedar Avenue."), (2, "Northfield ZX4 8QP")]


def test_import_preview_persistence_and_policy_plumbing():
    parsed, rows = parsed_rows()
    assert parsed.as_preview()["questions"][1]["question_type"] == "keep_change"
    assert rows[0]["exercise_type"] == "dictation"
    payload = rows[0]["payload"]
    assert payload["template_kind"] == payload["variant"] == "keep_change"
    assert payload["questions"][1]["printed_value"] == "Northfield ZX4 8QP"
    assert payload["answers"] == [
        {"q_num": 1, "answer": "KEEP", "alternatives": [], "keep_change_action": "KEEP"},
        {"q_num": 2, "answer": "Westfield ZX4 9QP", "alternatives": ["ZX4 9QP", "9QP"], "keep_change_action": "CHANGE"},
    ]
    assert authored_response_policies("listening", rows) == {}
    public = grader.strip_answer_keys(rows)
    assert "answers" not in public[0]["payload"]
    assert public[0]["payload"]["questions"][1]["printed_value"] == "Northfield ZX4 8QP"


@pytest.mark.parametrize("raw, expected", [
    ("KEEP", ("KEEP", "KEEP", [])),
    ("CHANGE: Harbour Road / Harbor Road", ("CHANGE", "Harbour Road", ["Harbor Road"])),
])
def test_answer_key_parse(raw, expected):
    assert importer.parse_keep_change_answer(raw, 2) == expected


@pytest.mark.parametrize("raw", ["", "UNCHANGED", "CHANGE", "CHANGE: ", "KEEP: value", "CHANGE: value /", "CHANGE: a | b"])
def test_bad_answer_key_shape_identifies_question(raw):
    with pytest.raises(ValueError, match="Q2"):
        importer.parse_keep_change_answer(raw, 2)


def test_bad_shape_is_import_error_in_quick_key_or_solution():
    solution, timings = pack("MAYBE")
    assert any("Q2" in error and "keep_change" in error for error in importer.parse_fulltest(QP, solution, timings).errors)
    solution, timings = pack()
    solution = solution.replace("**Answer:** KEEP", "**Answer:** MAYBE")
    assert any("Q1" in error and "keep_change" in error for error in importer.parse_fulltest(QP, solution, timings).errors)


def test_missing_solution_answer_is_import_error():
    solution, timings = pack()
    solution = solution.replace("**Answer:** KEEP", "**Answer:** ")
    assert any("Q1" in error and "keep_change" in error for error in importer.parse_fulltest(QP, solution, timings).errors)


@pytest.mark.parametrize("replacement", ["", "**2.** \n### Extra heading"])
def test_missing_printed_value_is_import_error(replacement):
    solution, timings = pack()
    result = importer.parse_fulltest(QP.replace("**2.** Northfield ZX4 8QP", replacement), solution, timings)
    assert any("Q2" in error and "printed value" in error for error in result.errors)


@pytest.mark.parametrize("q_num, user_answer, correct", [
    (1, "KEEP", True), (1, "CHANGE: Cedar Avenue.", False), (1, "", False),
    (1, "KEEP: Cedar Avenue", False),
    (2, "CHANGE: Westfield ZX4 9QP", True), (2, "CHANGE: zx4 9qp.", True),
    (2, "CHANGE: 9QP", True), (2, "CHANGE: Northfield ZX4 8QP", False),
    (2, "", False), (2, "CHANGE: ", False), (2, "KEEP", False), (2, "9QP", False),
])
def test_grading(q_num, user_answer, correct):
    _, rows = parsed_rows()
    key = [row for row in grader.collect_answer_key(rows) if row["q_num"] == q_num]
    result = grader.grade_attempt([{"q_num": q_num, "user_answer": user_answer}], key)
    assert result["score"] == int(correct)
    assert result["max_score"] == 1
    assert result["per_question"][0]["expected"] == ("KEEP" if q_num == 1 else "Westfield ZX4 9QP")


def test_printed_value_cannot_get_credit_even_if_in_key_variants():
    _, rows = parsed_rows()
    key = grader.collect_answer_key(rows)
    key[1]["alternatives"].append("Northfield ZX4 8QP")
    assert grader.grade_attempt([{"q_num": 2, "user_answer": "CHANGE: northfield zx4 8qp."}], key)["score"] == 0


def test_existing_unmarked_payload_stays_byte_identical():
    # Hash captured from the unmodified 18be527c importer for a synthetic
    # short-answer mini. Includes content metadata, solutions and payloads.
    qp = QP.replace("<!-- qtype: keep_change -->", "").replace(
        "Choose KEEP or CHANGE and correct the printed value.", "Answer the questions below.")
    solution, timings = pack("Harbour Road / Harbor Road")
    result = importer.parse_fulltest(qp, solution, timings)
    assert result.ok, result.errors
    rows = importer.build_section_persistence(result, qp)
    encoded = json.dumps(rows, sort_keys=True, ensure_ascii=False).encode()
    assert hashlib.sha256(encoded).hexdigest() == "8d879a08f68e4e411c46165db8e8127a13b4ee758e1d0150b2a6841b5762512b"


def test_pinned_literal_policies_still_validate_corrected_text():
    from services.mock_response_policy import ResponsePolicyError
    _, rows = parsed_rows()
    policy = {"version": 1, "policy_id": "synthetic/Q2/v1", "kind": "literal",
              "accepted_answers": ["Westfield ZX4 9QP", "9QP"], "settings": {},
              "provenance": {"source_item_id": "synthetic/Q2", "source_sha256": "a" * 64,
                             "item_revision": "v1", "reviewer": "synthetic-reviewer", "review_status": "ACCEPTED"}}
    rows[0]["payload"]["answers"][1]["response_policy"] = policy
    policies = authored_response_policies("listening", rows)
    key = grader.collect_answer_key(rows, pinned_policies=policies)
    assert grader.grade_attempt([{"q_num": 2, "user_answer": "CHANGE: 9QP"}], key)["score"] == 1
    invalid = copy.deepcopy(policy)
    invalid["kind"] = "keep_change"
    with pytest.raises(ResponsePolicyError):
        grader.collect_answer_key(rows, pinned_policies={2: invalid})
