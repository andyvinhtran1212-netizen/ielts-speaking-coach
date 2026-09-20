"""Strict provider-response contract for one-shot Controlled Rewrite grading."""

import pytest

from services.advanced_vocab_rewrite_grader import _normalize_feedback


ITEMS = [
    {"item_id": "rewrite-01", "prompt": "Rewrite one", "answer": "Answer one"},
    {"item_id": "rewrite-02", "prompt": "Rewrite two", "answer": "Answer two"},
]


def _payload(*, ok=True):
    return {
        "results": [
            {
                "item_id": item["item_id"],
                "corrected": item["answer"],
                "grammar_notes": [],
                "style_note": "Tự nhiên.",
                "target_usage_note": "Đúng từ mục tiêu.",
                "ok": ok,
            }
            for item in ITEMS
        ],
        "overall": {"strengths": ["Rõ ý"], "focus": []},
    }


def test_normalize_feedback_preserves_real_false_boolean():
    feedback = _normalize_feedback(_payload(ok=False), ITEMS)
    assert [row["ok"] for row in feedback["results"]] == [False, False]


@pytest.mark.parametrize("invalid", ["false", "true", None, 0, 1, [], {}])
def test_normalize_feedback_rejects_non_boolean_ok(invalid):
    with pytest.raises(ValueError, match="ok must be a boolean"):
        _normalize_feedback(_payload(ok=invalid), ITEMS)


def test_normalize_feedback_rejects_duplicate_ids_even_if_set_matches():
    payload = _payload()
    payload["results"].append(payload["results"][0].copy())
    with pytest.raises(ValueError, match="IDs do not match"):
        _normalize_feedback(payload, ITEMS)


@pytest.mark.parametrize("field,value", [
    ("grammar_notes", "not a list"),
    ("style_note", ["not a string"]),
    ("target_usage_note", None),
])
def test_normalize_feedback_rejects_wrong_note_shapes(field, value):
    payload = _payload()
    payload["results"][0][field] = value
    with pytest.raises(ValueError):
        _normalize_feedback(payload, ITEMS)
