"""Spec0016 typed gold cases; provenance below is synthetic, not source approval."""

import copy

import pytest

from services import listening_test_grader as listening, reading_test_grader as reading
from services.content_import_service import build_reading_question_payloads, validate_reading_questions
from services.mock_response_policy import (
    ResponsePolicyError, attach_response_policies, authored_response_policies,
    policy_answer_matches, response_policy_ref, validate_response_policy,
)


def policy(kind, forms, **settings):
    return {
        "version": 1, "policy_id": "synthetic-gold-item-v1", "kind": kind,
        "accepted_answers": forms, "settings": settings,
        "provenance": {
            "source_item_id": "synthetic-gold-item", "source_sha256": "a" * 64,
            "item_revision": "synthetic-v1", "reviewer": "synthetic-independent-reviewer",
            "review_status": "ACCEPTED",
        },
    }


@pytest.mark.parametrize("user,correct", [
    ("11000", True), ("11,000", True), ("+11,000", True),
    ("eleven thousand", True), ("-11000", False), ("11.000", False),
    ("110.00", False), ("11001", False), ("11,00", False),
    ("1,1000", False), ("11000kg", False), ("11000 people", False),
    ("eleven thousand people", False), ("NaN", False), ("1.1e4", False),
])
def test_reviewed_english_integer_preserves_meaning(user, correct):
    p = policy("number", ["11000", "11,000", "eleven thousand"], locale="en")
    assert listening.answer_matches(user, "11000", ["anything"], response_policy=p) is correct


@pytest.mark.parametrize("user,expected", [("1.10", True), ("1.1", True), ("1.01", False), ("1,10", False), ("-1.10", False)])
def test_decimal_value_and_sign(user, expected):
    assert policy_answer_matches(user, policy("number", ["1.10"], locale="en")) is expected


def test_number_locale_unit_and_negative_zero_are_explicit():
    p = policy("number", ["11.000 kg"], locale="de", unit="kg")
    assert policy_answer_matches("11000 kg", p)
    assert not policy_answer_matches("11,000 kg", p)
    assert not policy_answer_matches("11000 g", p)
    assert not policy_answer_matches("11000", p)
    assert not policy_answer_matches("11000 KG", p)
    assert not policy_answer_matches("-0", policy("number", ["0"], locale="en"))


@pytest.mark.parametrize("user,correct", [
    ("0412665903", True), ("0412 665 903", True), ("0412-665-903", True),
    ("412665903", False), ("0412665904", False), ("+0412665903", False),
    ("0412.665.903", False), ("0412665903 ext 12", False),
    ("(0412)665903", False),
])
def test_phone_preserves_zero_digits_and_only_configured_separators(user, correct):
    p = policy("phone", ["0412665903"], presentation_separators=[" ", "-"])
    assert policy_answer_matches(user, p) is correct


@pytest.mark.parametrize("user,correct", [
    ("0412 665 903 ext. 007", True), ("0412665903 x007", True),
    ("0412665903 ext 7", False), ("0412665903 ext 008", False),
    ("0412665903", False), ("0412665903007", False),
])
def test_phone_extension_identity(user, correct):
    p = policy("phone", ["0412665903 ext 007"], presentation_separators=[" "], extension_markers=["ext", "ext.", "x"])
    assert policy_answer_matches(user, p) is correct


def test_literal_has_only_reviewed_forms_no_plural_synonym_or_optional_word_rule():
    p = policy("literal", ["hair"])
    assert policy_answer_matches(" HAIR ", p)
    assert not policy_answer_matches("hairs", p)
    assert not policy_answer_matches("hair.", p)
    assert not policy_answer_matches("fur", p)
    assert not policy_answer_matches("11000", policy("literal", ["11,000"]))
    assert not policy_answer_matches("food consumption", policy("literal", ["(food) consumption"]))
    assert policy_answer_matches("hairs", policy("literal", ["hair", "hairs"]))
    assert policy_answer_matches("two-dimensional material", policy("literal", ["2D material", "two-dimensional material"]))


def test_date_acceptance_is_explicit_unambiguous_and_same_calendar_value():
    p = policy("date", ["4 May 2026", "May 4, 2026", "2026-05-04"])
    assert policy_answer_matches("May 4, 2026", p)
    assert not policy_answer_matches("04/05/2026", p)
    assert not policy_answer_matches("4 May", p)  # Not reviewed for this item.
    assert not policy_answer_matches("5 May 2026", p)
    for forms in (["04/05/2026"], ["4 May", "5 May"], ["31 February"]):
        with pytest.raises(ResponsePolicyError):
            validate_response_policy(policy("date", forms))


def test_word_limit_remains_authoritative():
    p = policy("literal", ["two-dimensional material"])
    p["max_words"] = 2
    assert policy_answer_matches("two-dimensional material", p)
    assert not policy_answer_matches("a two-dimensional material", p)
    p["max_words"] = 1
    with pytest.raises(ResponsePolicyError):
        validate_response_policy(p)


@pytest.mark.parametrize("alter", [
    lambda p: p.update(version=2), lambda p: p.update(kind=[]),
    lambda p: p["provenance"].update(review_status="PENDING"),
    lambda p: p["provenance"].update(source_sha256="unknown"),
    lambda p: p["provenance"].update(reviewer=""),
    lambda p: p["settings"].update(strip_all_punctuation=True),
    lambda p: p.update(accepted_answers=["11000", "-11000"]),
    lambda p: p["settings"].pop("locale"),
])
def test_invalid_or_unreviewed_metadata_fails_closed(alter):
    p = policy("number", ["11000"], locale="en")
    alter(p)
    with pytest.raises(ResponsePolicyError):
        validate_response_policy(p)


def rows(skill, p, answer="11000"):
    if skill == "reading":
        return [{"q_num": 1, "answer": {"answer": answer, "response_policy": p}, "passage_id": "p1"}]
    return [{"payload": {"answers": [{"q_num": 1, "answer": answer, "response_policy": p}]}}]


@pytest.mark.parametrize("skill,grader", [("reading", reading), ("listening", listening)])
def test_real_collector_and_grader_only_activate_explicit_frozen_policies(skill, grader):
    source = rows(skill, policy("number", ["11000"], locale="en"))
    legacy_key = grader.collect_answer_key(source)
    user = [{"q_num": 1, "user_answer": "-11000"}]
    # Keep historical active semantics; adding metadata alone cannot upgrade it.
    assert grader.grade_attempt(user, legacy_key)["score"] == 1
    frozen = copy.deepcopy(source)
    pinned = authored_response_policies(skill, frozen)
    key = grader.collect_answer_key(frozen, pinned_policies=pinned)
    assert grader.grade_attempt(user, key)["score"] == 0
    result = grader.grade_attempt([{"q_num": 1, "user_answer": "11,000"}], key)
    assert result["score"] == 1
    assert result["per_question"][0]["response_policy_ref"] == response_policy_ref(pinned[1])
    assert result["per_question"][0]["alternatives"] == []
    assert "accepted_answers" not in result["per_question"][0]["response_policy_ref"]
    source[:] = rows(skill, policy("number", ["999"], locale="en"), "999")
    assert grader.grade_attempt([{"q_num": 1, "user_answer": "11,000"}], key)["score"] == 1
    assert grader.grade_attempt([{"q_num": 1, "user_answer": "999"}], key)["score"] == 0


def test_pinned_policy_key_binding_and_json_question_identity():
    p = policy("number", ["11000"], locale="en")
    assert attach_response_policies([{"q_num": 1, "answer": "11000"}], {"1": p})[0]["response_policy"] == p
    for key, mapping in [([{"q_num": 1, "answer": "999"}], {1: p}),
                         ([{"q_num": 1, "answer": "11000"}], {2: p})]:
        with pytest.raises(ResponsePolicyError):
            attach_response_policies(key, mapping)


def test_reading_import_keeps_policy_in_protected_answer_only():
    q = {"q_num": 1, "question_type": "short_answer", "prompt": "How many?",
         "answer": "11000", "skill_tag": "scanning",
         "response_policy": policy("number", ["11000"], locale="en")}
    assert validate_reading_questions([q]) == []
    stored = build_reading_question_payloads([q], "p1")[0]
    assert stored["answer"]["response_policy"] == q["response_policy"]
    assert "response_policy" not in stored["payload"]
    q["answer"] = "999"
    assert validate_reading_questions([q])
    with pytest.raises(ResponsePolicyError):
        build_reading_question_payloads([q], "p1")
    q["answer"] = "11000"
    q["response_policy"]["provenance"]["review_status"] = "PENDING"
    assert validate_reading_questions([q])
    with pytest.raises(ResponsePolicyError):
        build_reading_question_payloads([q], "p1")


def test_policy_metadata_never_survives_student_payload_projection():
    source = rows("listening", policy("number", ["11000"], locale="en"))
    projected = listening.strip_answer_keys(source)
    assert "answers" not in projected[0]["payload"]
    assert source[0]["payload"]["answers"][0]["response_policy"]


def test_explicit_pinned_review_forms_ignore_unreviewed_legacy_alternatives():
    p = policy("number", ["11000", "11,000"], locale="en")
    key = attach_response_policies([{"q_num": 1, "answer": "11000", "alternatives": ["wrong words"]}], {1: p})
    for grader in (reading, listening):
        result = grader.grade_attempt([{"q_num": 1, "user_answer": "wrong words"}], key)
        assert result["score"] == 0
        assert result["per_question"][0]["alternatives"] == ["11,000"]


def test_partial_or_ambiguous_group_pin_is_rejected_before_grading():
    key = [{"q_num": n, "answer": answer, "group_key": "pair"} for n, answer in [(1, "A"), (2, "D")]]
    with pytest.raises(ResponsePolicyError):
        attach_response_policies(key, {1: policy("option_id", ["A"])})
    with pytest.raises(ResponsePolicyError):
        attach_response_policies(key, {1: policy("option_id", ["A"], case_sensitive=True),
                                       2: policy("option_id", ["D"], case_sensitive=False)})


@pytest.mark.parametrize("grader", [reading, listening])
def test_new_grouped_ids_retain_any_order_consume_once_and_reject_punctuation(grader):
    key = [{"q_num": n, "answer": answer, "group_key": "pair",
            "question_type": "mcq_single", "group_type": "grouped_mcq_single",
            "template_kind": "mcq_multi", "response_policy": policy("option_id", [answer])}
           for n, answer in [(1, "A"), (2, "D")]]
    assert grader.grade_attempt([{"q_num": 1, "user_answer": "D"}, {"q_num": 2, "user_answer": "A"}], key)["score"] == 2
    assert grader.grade_attempt([{"q_num": 1, "user_answer": "A"}, {"q_num": 2, "user_answer": "A"}], key)["score"] == 1
    assert grader.grade_attempt([{"q_num": 1, "user_answer": ".A"}, {"q_num": 2, "user_answer": "D"}], key)["score"] == 1
    partially_correct = grader.grade_attempt([{"q_num": 1, "user_answer": "D"}, {"q_num": 2, "user_answer": "Z"}], key)
    assert [row["rationale_q_num"] for row in partially_correct["per_question"]] == [2, 1]
    key[1]["response_policy"] = policy("option_id", ["A", "D"])
    with pytest.raises(ResponsePolicyError):
        grader.grade_attempt([{"q_num": 1, "user_answer": "A"}, {"q_num": 2, "user_answer": "A"}], key)


@pytest.mark.parametrize("answer,correct", [("C,A", True), ("A; C", True), ("A,A,C", False), ("A,C,C", False), (".A,C", False), ("A,C,", False), ("A,C,D", False)])
def test_new_reading_multi_select_retains_cardinality(answer, correct):
    key = [{"q_num": 1, "question_type": "mcq_multi", "answer": ["A", "C"],
            "response_policy": policy("option_id", ["A", "C"])}]
    assert reading.grade_attempt([{"q_num": 1, "user_answer": answer}], key)["per_question"][0]["correct"] is correct
