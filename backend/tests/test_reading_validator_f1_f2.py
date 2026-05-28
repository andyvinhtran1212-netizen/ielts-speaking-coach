"""Sprint 20.6.6 — validator hardening (F1+F2) regression tests.

The Sprint 20.6.5 spec audit (PR #329) flagged two silent-failure modes:

* F1 — the v1-spec NESTED question shape (`payload: {options: …}` and
  `answer: {answer, alternatives}`) parses + validates clean, but the
  builder silently drops `payload.options` and double-nests the answer.
  Every imported question then renders with no choices and grades wrong.

* F2 — `mcq_single` / `matching_headings` with a missing `options:`
  parses + validates clean, but the rendered question has no choices.

Sprint 20.6.6 turns both into **loud dry-run failures**. These tests
cover the new validator paths, plus the closing of the existing seed
test coverage gap (which stopped at parse + validate and missed the
build-step regression).
"""

from __future__ import annotations

from pathlib import Path

from services.content_import_service import (
    build_reading_question_payloads,
    build_reading_test_payloads,
    parse_reading_test,
    validate_reading_questions,
    validate_reading_test,
)
from services.reading_test_grader import collect_answer_key, grade_attempt


_CONTENT_DIR = Path(__file__).parent.parent / "content" / "reading"


# ── F1 — Reject the nested storage shape at author level ──────────────


def _flat_mcq(**override):
    """A valid FLAT mcq_single question — tests start from this and mutate."""
    base = {
        "q_num":         1,
        "question_type": "mcq_single",
        "prompt":        "What?",
        "options":       [{"label": "A", "text": "a"}, {"label": "B", "text": "b"}],
        "answer":        "A",
        "alternatives":  [],
        "skill_tag":     "detail",
    }
    base.update(override)
    return base


def test_flat_question_validates_clean_baseline():
    """Sanity: a FLAT question (the v2 author shape) passes the new validator."""
    assert validate_reading_questions([_flat_mcq()]) == []


def test_f1_rejects_payload_at_question_top_level():
    """F1a — author-level `payload:` is the nested storage shape leaking back;
    the builder ignores it and silently drops the options. Reject loudly."""
    q = _flat_mcq()
    q["payload"] = {"options": [{"label": "A", "text": "a"}]}
    errors = validate_reading_questions([q])
    assert errors, "validator should reject author-level payload:"
    msgs = " ".join(e["message"] for e in errors)
    assert "payload" in msgs.lower()
    assert "v2" in msgs or "§4" in msgs, (
        f"error should point to v2 §4 — got: {msgs}"
    )


def test_f1_rejects_dict_valued_answer():
    """F1b — `answer: {answer: "B", alternatives: []}` is the v1 nested shape;
    the builder double-nests it and the grader can never match it."""
    q = _flat_mcq()
    q["answer"] = {"answer": "A", "alternatives": []}
    errors = validate_reading_questions([q])
    assert errors, "validator should reject dict-valued answer:"
    msgs = " ".join(e["message"] for e in errors)
    assert "answer" in msgs
    assert "chuỗi" in msgs or "string" in msgs.lower()
    assert "v2" in msgs or "§4" in msgs


def test_f1_accepts_string_answer():
    """Regression guard: the new validator must NOT reject the FLAT shape."""
    q = _flat_mcq()
    q["answer"] = "A"
    assert validate_reading_questions([q]) == []


def test_f1_accepts_list_answer_for_future_mcq_multi():
    """The grader supports list-valued primary answer (`mcq_multi` Phase B).
    The validator should accept a non-empty list without flagging it as 'nested'."""
    q = _flat_mcq()
    q["answer"] = ["A", "B"]
    assert validate_reading_questions([q]) == []


def test_f1_still_flags_missing_answer():
    """Existing 'missing answer' guard must still fire on None / "" / []."""
    for bad in (None, "", "   ", []):
        q = _flat_mcq()
        q["answer"] = bad
        errors = validate_reading_questions([q])
        assert errors, f"expected error for answer={bad!r}"
        assert any("answer" in e["message"] for e in errors)


def test_alternatives_must_be_a_list():
    """Tight F2-adjacent — alternatives was previously silently coerced to []
    if non-list, hiding the author's intent. Now flagged."""
    q = _flat_mcq()
    q["alternatives"] = "F"   # author meant ["F"] but the builder silently drops it
    errors = validate_reading_questions([q])
    assert errors
    assert any("alternatives" in e["message"] for e in errors)


# ── F2 — Require options for option-list question types ──────────────


def test_f2_rejects_mcq_single_without_options():
    q = _flat_mcq()
    del q["options"]
    errors = validate_reading_questions([q])
    assert errors
    msgs = " ".join(e["message"] for e in errors)
    assert "options" in msgs
    assert "mcq_single" in msgs
    assert "v2" in msgs or "§4" in msgs


def test_f2_rejects_mcq_single_with_empty_options():
    q = _flat_mcq(options=[])
    errors = validate_reading_questions([q])
    assert errors
    assert any("options" in e["message"] for e in errors)


def test_f2_rejects_matching_headings_without_options():
    q = _flat_mcq(question_type="matching_headings", answer="i",
                  skill_tag="skimming")
    del q["options"]
    errors = validate_reading_questions([q])
    assert errors
    msgs = " ".join(e["message"] for e in errors)
    assert "matching_headings" in msgs
    assert "options" in msgs


def test_f2_rejects_option_missing_label_or_text():
    q = _flat_mcq()
    q["options"] = [{"label": "A"}, {"label": "B", "text": "b"}]
    errors = validate_reading_questions([q])
    assert errors
    assert any("label" in e["message"] or "text" in e["message"] for e in errors)


def test_f2_does_not_require_options_for_tfng_or_ynng():
    """T/F/NG and Y/N/NG render implied choices — no options needed."""
    for qtype in ("true_false_not_given", "yes_no_not_given"):
        q = _flat_mcq(question_type=qtype, answer="TRUE" if "true" in qtype else "YES",
                      skill_tag="detail")
        del q["options"]
        assert validate_reading_questions([q]) == [], (
            f"{qtype} should not require options; got errors"
        )


def test_f2_does_not_require_options_for_completion_or_short_answer():
    """Free-typed answer types don't need options."""
    for qtype in ("sentence_completion", "summary_completion",
                  "notes_completion", "table_completion",
                  "form_completion", "short_answer"):
        q = _flat_mcq(question_type=qtype, answer="word", skill_tag="detail")
        del q["options"]
        assert validate_reading_questions([q]) == [], (
            f"{qtype} should not require options; got errors"
        )


# ── L3 dry-run rejects a malformed file loudly ────────────────────────


_L3_BROKEN_NESTED = """---
content_type: reading_full_test
test_id: BROKEN-001
title: Broken Nested Test
module: academic
time_limit_minutes: 60
passage_count: 1
total_questions: 1
published: true
passages:
  - passage_order: 1
    slug: broken-p1
    title: P1
    body_markdown: Long enough body for the validator.
    questions:
      - q_num: 1
        question_type: mcq_single
        prompt: x
        payload: { options: [{label: A, text: a}, {label: B, text: b}] }
        answer: { answer: "A", alternatives: [] }
        skill_tag: detail
---
"""


def test_l3_broken_nested_file_fails_dry_run_with_clear_errors():
    """The exact failure mode v2 §11/F1 documented — the original broken seed
    shape. Validator must surface multiple specific errors so the content
    agent can fix them before commit."""
    p = parse_reading_test(_L3_BROKEN_NESTED)
    errors = validate_reading_test(p)
    assert errors, "broken nested L3 file must produce validation errors"
    all_msgs = " ".join(e["message"] for e in errors)
    # All three F1/F2 paths fire on a single nested mcq_single:
    assert "payload" in all_msgs.lower(), "should flag author-level payload"
    assert "chuỗi" in all_msgs or "string" in all_msgs.lower(), (
        "should flag dict-valued answer"
    )
    assert "mcq_single" in all_msgs, "should flag missing options for mcq_single"
    # And every error points the author to the v2 spec section:
    assert any("v2" in e["message"] or "§4" in e["message"] for e in errors)


# ── Seed regression — close the coverage gap from 20.5 ────────────────


def test_corrected_l3_seed_builds_and_grades_correctly():
    """Sprint 20.5's `test_seed_l3_test_parses_and_validates_clean` stopped at
    parse + validate, so it missed the build-step regression (v2 §11/F1). This
    test rounds the seed through the **full** parse → validate → build →
    collect_answer_key → grade chain, locking the corrected shape forever."""
    text = (_CONTENT_DIR / "l3-academic-reading-test-1.md").read_text(encoding="utf-8")
    parsed = parse_reading_test(text)
    assert validate_reading_test(parsed) == []

    plan = build_reading_test_payloads(parsed)
    assert plan["test_row"]["test_id"] == "AVR-READ-001"
    assert len(plan["passage_rows"]) == 3

    # Every option-list question must have payload.options populated; every
    # answer must be a string (not a nested dict).
    option_types = {"mcq_single", "matching_headings"}
    fake_rows: list[dict] = []
    po_map: dict[str, int] = {}
    for i, (slug, q_rows) in enumerate(plan["passage_questions"]):
        pid = f"p-{slug}"
        po_map[pid] = i + 1
        for q in q_rows:
            if q["question_type"] in option_types:
                assert q["payload"].get("options"), (
                    f"Passage {slug!r} Q{q['q_num']}: payload.options empty "
                    f"(seed regressed to nested shape — see v2 §11/F1)"
                )
            assert isinstance(q["answer"]["answer"], str), (
                f"Passage {slug!r} Q{q['q_num']}: answer.answer is "
                f"{type(q['answer']['answer']).__name__}, expected str "
                f"(seed regressed to nested shape — see v2 §11/F1)"
            )
            fake_rows.append({
                "q_num":       q["q_num"],
                "answer":      q["answer"],
                "skill_tag":   q["skill_tag"],
                "explanation": q["explanation"],
                "passage_id":  pid,
            })

    # Perfect student: gives the primary answer to every Q → must score 40/40.
    key = collect_answer_key(fake_rows, po_map)
    user_answers = [{"q_num": ak["q_num"], "user_answer": ak["answer"]} for ak in key]
    result = grade_attempt(user_answers, key)
    assert result["score"] == 40 and result["max_score"] == 40, (
        f"corrected seed must grade to 40/40 for a perfect student "
        f"(got {result['score']}/{result['max_score']})"
    )
    assert result["band_estimate"] == 9.0
    # 13/13/14 split per the seed's intentional Cambridge-style structure.
    assert result["by_part"]["p1"]["total"] == 13
    assert result["by_part"]["p2"]["total"] == 13
    assert result["by_part"]["p3"]["total"] == 14
