"""Sprint 20.14b — Phase B grader + AVR-READ-002 seed validation.

The Phase B unlock adds 7 reading question types to the importer
whitelist (mcq_multi, matching_information, matching_features,
matching_sentence_endings, summary_completion-with-word-bank,
flow_chart_completion, diagram_label_completion). The grader for most
of them piggybacks on the existing `answer_matches` (letter / text
matching with diacritic + UK/US norm from Sprint 20.13c). The
exception is `mcq_multi`, which uses set-equality (all-or-nothing
scoring per IELTS marking-guide convention).

This file pins:
  * mcq_multi set-equality (exact match wins, missing or extra picks fail)
  * matching_* letter matching reuses existing path (regression check)
  * AVR-READ-002 seed parses + validates [] + builds clean
"""

from __future__ import annotations

from pathlib import Path

from services.content_import_service import (
    READING_QUESTION_TYPES_PHASE1,
    build_reading_test_payloads,
    parse_reading_test,
    validate_reading_test,
)
from services.reading_test_grader import grade_attempt


_CONTENT_DIR = Path(__file__).parent.parent / "content" / "reading"


# ── Whitelist additions ───────────────────────────────────────────────


def test_phase_b_types_in_whitelist():
    # Sprint 20.14b — the 7 Phase B types must be author-able.
    for t in ("mcq_multi", "matching_information", "matching_features",
              "matching_sentence_endings", "flow_chart_completion",
              "diagram_label_completion"):
        assert t in READING_QUESTION_TYPES_PHASE1, f"{t} missing from whitelist"


# ── mcq_multi set-equality (all-or-nothing) ───────────────────────────


def _ak_mcq_multi(answer):
    return [{
        "q_num":         1,
        "question_type": "mcq_multi",
        "answer":        answer,
        "alternatives":  [],
        "skill_tag":     "detail",
        "passage_order": 1,
    }]


def test_mcq_multi_exact_match_passes():
    r = grade_attempt(
        [{"q_num": 1, "user_answer": "A,C"}],
        _ak_mcq_multi(["A", "C"]),
    )
    assert r["per_question"][0]["correct"] is True


def test_mcq_multi_order_independent():
    r = grade_attempt(
        [{"q_num": 1, "user_answer": "C,A"}],
        _ak_mcq_multi(["A", "C"]),
    )
    assert r["per_question"][0]["correct"] is True


def test_mcq_multi_whitespace_tolerant():
    r = grade_attempt(
        [{"q_num": 1, "user_answer": "A , C"}],
        _ak_mcq_multi(["A", "C"]),
    )
    assert r["per_question"][0]["correct"] is True


def test_mcq_multi_semicolon_separator_works():
    # The grader splits on both `,` and `;` so a future serialiser swap
    # doesn't silently fail grading.
    r = grade_attempt(
        [{"q_num": 1, "user_answer": "A;C"}],
        _ak_mcq_multi(["A", "C"]),
    )
    assert r["per_question"][0]["correct"] is True


def test_mcq_multi_extra_pick_fails():
    # User picks 3 when 2 are correct — all-or-nothing per IELTS rules.
    r = grade_attempt(
        [{"q_num": 1, "user_answer": "A,B,C"}],
        _ak_mcq_multi(["A", "C"]),
    )
    assert r["per_question"][0]["correct"] is False


def test_mcq_multi_missing_pick_fails():
    r = grade_attempt(
        [{"q_num": 1, "user_answer": "A"}],
        _ak_mcq_multi(["A", "C"]),
    )
    assert r["per_question"][0]["correct"] is False


def test_mcq_multi_wrong_set_fails():
    r = grade_attempt(
        [{"q_num": 1, "user_answer": "B,D"}],
        _ak_mcq_multi(["A", "C"]),
    )
    assert r["per_question"][0]["correct"] is False


def test_mcq_multi_empty_user_answer_fails():
    r = grade_attempt(
        [{"q_num": 1, "user_answer": ""}],
        _ak_mcq_multi(["A", "C"]),
    )
    assert r["per_question"][0]["correct"] is False


def test_mcq_multi_case_insensitive():
    r = grade_attempt(
        [{"q_num": 1, "user_answer": "a,c"}],
        _ak_mcq_multi(["A", "C"]),
    )
    assert r["per_question"][0]["correct"] is True


# ── matching_* family (letter match — regression on existing path) ────


def test_matching_information_letter_match():
    ak = [{
        "q_num": 1, "question_type": "matching_information",
        "answer": "B", "alternatives": [], "passage_order": 1,
        "skill_tag": "scanning",
    }]
    r = grade_attempt([{"q_num": 1, "user_answer": "B"}], ak)
    assert r["per_question"][0]["correct"] is True
    r = grade_attempt([{"q_num": 1, "user_answer": "C"}], ak)
    assert r["per_question"][0]["correct"] is False


def test_matching_features_letter_match():
    ak = [{
        "q_num": 1, "question_type": "matching_features",
        "answer": "D", "alternatives": [], "passage_order": 1,
        "skill_tag": "detail",
    }]
    assert grade_attempt([{"q_num": 1, "user_answer": "D"}], ak)["per_question"][0]["correct"]
    assert not grade_attempt([{"q_num": 1, "user_answer": "A"}], ak)["per_question"][0]["correct"]


def test_matching_sentence_endings_letter_match():
    ak = [{
        "q_num": 1, "question_type": "matching_sentence_endings",
        "answer": "F", "alternatives": [], "passage_order": 1,
        "skill_tag": "main_idea",
    }]
    assert grade_attempt([{"q_num": 1, "user_answer": "F"}], ak)["per_question"][0]["correct"]


# ── summary_completion word-bank (letter) vs no-bank (text) ──────────


def test_summary_completion_word_bank_letter_match():
    # Word-bank variant — answer is a single label.
    ak = [{
        "q_num": 1, "question_type": "summary_completion",
        "answer": "H", "alternatives": [], "passage_order": 3,
        "skill_tag": "detail",
    }]
    assert grade_attempt([{"q_num": 1, "user_answer": "H"}], ak)["per_question"][0]["correct"]


def test_summary_completion_no_bank_text_match():
    # No-bank variant — same enum tag, but the answer is free text.
    ak = [{
        "q_num": 1, "question_type": "summary_completion",
        "answer": "twenty", "alternatives": ["20"], "passage_order": 3,
        "skill_tag": "detail",
    }]
    assert grade_attempt([{"q_num": 1, "user_answer": "twenty"}], ak)["per_question"][0]["correct"]
    assert grade_attempt([{"q_num": 1, "user_answer": "20"}],     ak)["per_question"][0]["correct"]
    assert not grade_attempt([{"q_num": 1, "user_answer": "ten"}],ak)["per_question"][0]["correct"]


# ── flow / diagram completion (text norm) ────────────────────────────


def test_flow_chart_completion_text_match():
    ak = [{
        "q_num": 1, "question_type": "flow_chart_completion",
        "answer": "seeds", "alternatives": [],
        "passage_order": 3, "skill_tag": "scanning",
    }]
    assert grade_attempt([{"q_num": 1, "user_answer": "seeds"}],  ak)["per_question"][0]["correct"]
    assert grade_attempt([{"q_num": 1, "user_answer": "SEEDS"}],  ak)["per_question"][0]["correct"]
    assert not grade_attempt([{"q_num": 1, "user_answer": "plants"}], ak)["per_question"][0]["correct"]


def test_diagram_label_completion_text_match():
    ak = [{
        "q_num": 1, "question_type": "diagram_label_completion",
        "answer": "supermarket", "alternatives": [],
        "passage_order": 3, "skill_tag": "detail",
    }]
    assert grade_attempt([{"q_num": 1, "user_answer": "supermarket"}], ak)["per_question"][0]["correct"]


# ── AVR-READ-002 seed: parse + validate + build ──────────────────────


def test_avr_read_002_seed_parses():
    md = (_CONTENT_DIR / "l3-academic-reading-test-2.md").read_text(encoding="utf-8")
    parsed = parse_reading_test(md)
    assert parsed.test_id == "AVR-READ-002"
    assert parsed.total_questions == 40
    assert len(parsed.passages) == 3


def test_avr_read_002_seed_validates_clean():
    md = (_CONTENT_DIR / "l3-academic-reading-test-2.md").read_text(encoding="utf-8")
    parsed = parse_reading_test(md)
    errs = validate_reading_test(parsed)
    assert errs == [], f"unexpected validation errors: {errs}"


def test_avr_read_002_seed_builds_payload_rows():
    md = (_CONTENT_DIR / "l3-academic-reading-test-2.md").read_text(encoding="utf-8")
    parsed = parse_reading_test(md)
    out = build_reading_test_payloads(parsed)
    assert out["test_row"]["test_id"] == "AVR-READ-002"
    # All 7 Phase B types should appear in the built questions.
    seen_types: set[str] = set()
    for _slug, qs in out["passage_questions"]:
        for q in qs:
            seen_types.add(q["question_type"])
    for required in ("mcq_multi", "matching_information", "matching_features",
                     "matching_sentence_endings", "summary_completion",
                     "flow_chart_completion", "diagram_label_completion"):
        assert required in seen_types, f"AVR-READ-002 missing type {required}"


def test_avr_read_002_mcq_multi_grades_correctly_end_to_end():
    """End-to-end: parse seed → build payloads → fashion a fake graded
    attempt where the user picks the right TWO labels on Q4 → mcq_multi
    branch in grade_attempt scores it correct."""
    md = (_CONTENT_DIR / "l3-academic-reading-test-2.md").read_text(encoding="utf-8")
    parsed = parse_reading_test(md)
    out = build_reading_test_payloads(parsed)
    # Q4 (Passage 1) is the first mcq_multi in the seed; answer key ["B","C"].
    answer_key = []
    for _slug, qs in out["passage_questions"]:
        for q in qs:
            if q["question_type"] == "mcq_multi" and q["q_num"] == 4:
                answer_key.append({
                    "q_num":         q["q_num"],
                    "question_type": q["question_type"],
                    "answer":        q["answer"]["answer"],
                    "alternatives":  q["answer"]["alternatives"],
                    "passage_order": 1,
                    "skill_tag":     q["skill_tag"],
                })
                break
    assert answer_key, "did not find Q4 mcq_multi in built payloads"
    r = grade_attempt([{"q_num": 4, "user_answer": "B,C"}], answer_key)
    assert r["per_question"][0]["correct"] is True
    r = grade_attempt([{"q_num": 4, "user_answer": "B,D"}], answer_key)
    assert r["per_question"][0]["correct"] is False
