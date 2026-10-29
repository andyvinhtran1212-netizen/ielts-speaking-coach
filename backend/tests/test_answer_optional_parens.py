"""PC-J61: optional key groups expand independently without losing old forms."""

from itertools import product
import re

import pytest

from services import listening_test_grader as listening, reading_test_grader as reading


@pytest.mark.parametrize("user", ["carsharing", "car-sharing", "car sharing"])
def test_optional_inline_hyphen(user):
    assert listening.answer_matches(user, "car(-)sharing", [])


@pytest.mark.parametrize("user", [
    "13 January", "13th January", "13th of January", "the 13 January",
    "the 13th of January", "13 of January", "the 13th January",
    "the 13 of January",
])
def test_independent_optional_date_groups(user):
    assert listening.answer_matches(user, "(the) 13(th) (of) January", [])


@pytest.mark.parametrize("key,user,correct", [
    ("(the) 13(th) (of) January", "13th of", False),
    ("(unique) expeditions", "expeditions", True),
    ("(unique) expeditions", "unique expeditions", True),
    ("(unique) expeditions", "unique", False),
    ("(land) surface", "surface", True),
    ("(land) surface", "land surface", True),
    ("(land) surface", "the land surface", False),
    ("car(-)sharing", "sharing", False),
    ("design(s)", "design", True),
    ("design(s)", "designs", True),
    ("car (-) sharing", "carsharing", False),
    ("car(-) sharing", "carsharing", False),
    ("car (-)sharing", "carsharing", False),
    ("car (-) sharing", "car sharing", True),
])
def test_required_text_and_authored_spacing(key, user, correct):
    assert listening.answer_matches(user, key, []) is correct


@pytest.mark.parametrize("user,correct", [
    ("harbor", True), ("harbour", True), ("the harbour", True),
    ("the harbor", False),
])
def test_alternatives_do_not_inherit_optional_words(user, correct):
    assert listening.answer_matches(user, "(the) harbour", ["harbor"]) is correct


def test_optional_groups_also_expand_in_alternatives_and_spaced_slash_parts():
    assert listening.answer_matches("carsharing", "other", ["car(-)sharing"])
    assert listening.answer_matches("13th January", "other / (the) 13(th) (of) January", [])
    assert listening.answer_matches("carsharing", "other", ["other / car(-)sharing"])
    assert listening.answer_matches("input/output", "input/output", [])
    assert not listening.answer_matches("input", "input/output", [])
    assert not listening.answer_matches("carsharing", "other/car(-)sharing", [])


def test_four_groups_generate_every_combination():
    key = "(a) (b) (c) (d) tail"
    expected = {
        " ".join([word for word, keep in zip("abcd", flags) if keep] + ["tail"])
        for flags in product([False, True], repeat=4)
    }
    variants = {v.strip() for v in listening._optional_paren_variants(key)}
    assert variants == expected
    assert len(variants) == 16
    for user in expected:
        assert listening.answer_matches(user, key, [])


def test_five_groups_keep_only_legacy_behavior():
    key = "car(-)sharing (a) (b) (c) (d)"
    assert listening._optional_paren_variants(key) == [
        "car sharing    ", "car-sharing a b c d",
    ]
    assert listening.answer_matches("car sharing", key, [])
    assert listening.answer_matches("car-sharing a b c d", key, [])
    assert listening.answer_matches(key, key, [])
    assert not listening.answer_matches("carsharing", key, [])
    assert not listening.answer_matches("car-sharing a b c", key, [])


@pytest.mark.parametrize("key", [
    "car(-)sharing", "(the) 13(th) (of) January", "(unique) expeditions",
    "(land) surface", "design(s)", "(a)(b) tail", "((a)) tail", "(a) tail)",
])
def test_both_legacy_forms_and_exact_key_still_match(key):
    for user in [
        re.sub(r"\s*\([^()]+\)\s*", " ", key),
        key.replace("(", "").replace(")", ""), key,
    ]:
        assert listening.answer_matches(user, key, [])


@pytest.mark.parametrize("user", ["an) apron", "((an) apron", "an (apron"])
def test_malformed_user_parentheses_are_still_rejected(user):
    assert not listening.answer_matches(user, "(an) apron", [])


@pytest.mark.parametrize("key,user", [
    ("car(-)sharing", "carsharing"),
    ("(the) 13(th) (of) January", "13th January"),
    ("(unique) expeditions", "unique expeditions"),
])
def test_response_policy_bypasses_optional_expansion(key, user):
    policy = {
        "version": 1, "policy_id": "pc-j61-synthetic-v1", "kind": "literal",
        "accepted_answers": [key], "settings": {},
        "provenance": {
            "source_item_id": "pc-j61-synthetic", "source_sha256": "a" * 64,
            "item_revision": "synthetic-v1", "reviewer": "synthetic-reviewer",
            "review_status": "ACCEPTED",
        },
    }
    assert listening.answer_matches(key, key, [], response_policy=policy)
    assert not listening.answer_matches(user, key, [user], response_policy=policy)


@pytest.mark.parametrize("grader", [listening, reading], ids=["listening", "reading"])
def test_shared_grader_accepts_snapshot_key_forms(grader):
    key = [
        {"q_num": 1, "answer": "car(-)sharing", "alternatives": []},
        {"q_num": 2, "answer": "(the) 13(th) (of) January", "alternatives": []},
        {"q_num": 3, "answer": "(the) 13(th) (of) January", "alternatives": []},
    ]
    answers = [
        {"q_num": 1, "user_answer": "carsharing"},
        {"q_num": 2, "user_answer": "13th of January"},
        {"q_num": 3, "user_answer": "13th of"},
    ]
    result = grader.grade_attempt(answers, key)
    assert result["score"] == 2
    assert result["max_score"] == 3
    assert [row["correct"] for row in result["per_question"]] == [True, True, False]
