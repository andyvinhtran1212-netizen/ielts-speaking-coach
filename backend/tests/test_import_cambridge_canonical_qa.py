from __future__ import annotations

import sys
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import import_cambridge_canonical_qa as importer  # noqa: E402


def _q(number: int, text: str, options: dict[str, str], qtype: str = "multi-select"):
    return {"number": number, "text": text, "options": options, "question_type": qtype}


def test_choose_two_groups_are_chunked_even_when_option_banks_repeat():
    options = {"A": "one", "B": "two", "C": "three", "D": "four", "E": "five"}
    rows = [
        _q(17, "Choose TWO letters, A–E.\nFirst stem", options),
        _q(18, "Choose TWO letters, A–E.\nFirst stem", options),
        _q(19, "Choose TWO letters, A–E.\nSecond stem", options),
        _q(20, "Choose TWO letters, A–E.\nSecond stem", options),
    ]

    groups = importer._listening_groups(rows)

    assert [[q["number"] for q in group] for group in groups] == [[17, 18], [19, 20]]
    assert all(group[0]["_effective_type"] == "multi-select" for group in groups)


def test_shared_box_multi_select_is_classified_as_matching():
    options = {"A": "one", "B": "two", "C": "three"}
    text = "Choose SIX answers from the box and write the correct letter, A-I, next to Questions 11-16."
    rows = [_q(number, f"{text}\nItem {number}", options) for number in range(11, 17)]

    groups = importer._listening_groups(rows)

    assert len(groups) == 1
    assert groups[0][0]["_effective_type"] == "matching"


def test_answer_arrays_are_alternatives_unless_authored_as_whole_set():
    assert importer._answer(["twenty", "20"]) == {
        "answer": "twenty",
        "alternatives": ["20"],
    }
    assert importer._answer(["A", "D"], whole_set=True) == {
        "answer": "A, D",
        "alternatives": [],
    }


def test_deterministic_ids_are_stable_and_domain_separated():
    assert importer._uuid("cambridge-13-test-1:reading:test") == importer._uuid(
        "cambridge-13-test-1:reading:test"
    )
    assert importer._uuid("cambridge-13-test-1:reading:test") != importer._uuid(
        "cambridge-13-test-1:listening:test"
    )
