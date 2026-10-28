"""CM-1028-FX4 — Reading Test 1 (AVR-READ-001) editorial fixes.

Vinh approved nine fixes on 2026-10-28 (Leader chat, "duyệt"):

* Q8, Q11, Q26, Q29, Q30 — stems rewritten so each admits exactly one
  supported answer; every primary key is unchanged.
* Q12, Q13, Q36, Q37 — accepted alternatives that fail the displayed task
  (wrong phrase, over the word limit, ungrammatical in the summary frame)
  are removed.

Source of the decisions: /workspace/content-drafts/reading-t1-explanations-1028.md
("Questions requiring editorial decisions") and the CM handoff ticket
20261028-0931-content-manager-fix-reading-t1-keys.md. The test runs the real
parse → build → collect_answer_key → grade chain so a revert in the seed is
caught before any re-import.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from services.content_import_service import (
    build_reading_test_payloads,
    parse_reading_test,
    validate_reading_test,
)
from services.reading_test_grader import collect_answer_key, grade_attempt

_SEED = Path(__file__).parent.parent / "content" / "reading" / "l3-academic-reading-test-1.md"

_APPROVED_STEMS = {
    8:  ("true_false_not_given",
         "Most hand-made goods are sold within the conventional retail system.", "FALSE"),
    11: ("short_answer",
         "Up to how many times more expensive can a hand-thrown mug be than an "
         "industrial mug? (ONE word)", "ten"),
    26: ("short_answer",
         "Which city incorporates new water channels as a standard part of large "
         "redevelopments?", "Copenhagen"),
    29: ("yes_no_not_given",
         "The writer associates slow-wave sleep with transferring information to "
         "long-term storage.", "YES"),
    30: ("yes_no_not_given",
         "Students who sleep little and rely on caffeine are likely to retain more "
         "of what they read.", "NO"),
}

# q_num → (primary key, removed alternative)
_REMOVED_ALTERNATIVES = {
    12: ("maker's choices", "maker choices"),
    13: ("higher end", "the higher end"),
    36: ("replay", "replays"),
    37: ("cortex", "the cortex"),
}


def _questions() -> dict[int, dict]:
    parsed = parse_reading_test(_SEED.read_text(encoding="utf-8"))
    assert validate_reading_test(parsed) == []
    plan = build_reading_test_payloads(parsed)
    return {q["q_num"]: q for _slug, rows in plan["passage_questions"] for q in rows}


def _answer_key() -> list[dict]:
    rows = [{**q, "passage_id": "p"} for q in _questions().values()]
    return collect_answer_key(rows, {"p": 1})


@pytest.mark.parametrize("q_num", sorted(_APPROVED_STEMS))
def test_approved_stem_is_seeded_with_unchanged_key(q_num):
    question_type, prompt, key = _APPROVED_STEMS[q_num]
    q = _questions()[q_num]
    assert q["question_type"] == question_type
    assert q["prompt"] == prompt
    assert q["answer"]["answer"] == key


def test_q26_question_stem_no_longer_names_singapore_as_redeveloper():
    # The old sentence-completion stem attributed redevelopment channels to
    # Singapore as well; the passage says that only of Copenhagen.
    assert "Singapore" not in _questions()[26]["prompt"]


@pytest.mark.parametrize("q_num", sorted(_REMOVED_ALTERNATIVES))
def test_invalid_alternative_is_removed_and_graded_wrong(q_num):
    primary, removed = _REMOVED_ALTERNATIVES[q_num]
    q = _questions()[q_num]
    assert q["answer"]["answer"] == primary
    assert removed not in q["answer"]["alternatives"]

    key = [k for k in _answer_key() if k["q_num"] == q_num]
    assert grade_attempt([{"q_num": q_num, "user_answer": primary}], key)["score"] == 1
    assert grade_attempt([{"q_num": q_num, "user_answer": removed}], key)["score"] == 0


def test_q11_numeric_variant_still_accepted():
    key = [k for k in _answer_key() if k["q_num"] == 11]
    assert grade_attempt([{"q_num": 11, "user_answer": "10"}], key)["score"] == 1
