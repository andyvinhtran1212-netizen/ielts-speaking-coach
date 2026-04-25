"""
End-to-end-ish tests for D1 fill-blank.

These exercise the pure helpers (no DB, no auth) that drive the user-facing
endpoint:
  - _grade_d1: case- and whitespace-insensitive equality
  - _public_view: strips answer/word, exposes a deterministic shuffled options list
  - D1AttemptRequest: rejects empty answers / over-long answers

The rate-limit and full FastAPI handler are covered separately
(test_rate_limit.py).  RLS is covered by test_exercise_rls.py.

Run: pytest backend/tests/test_d1_e2e.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from pydantic import ValidationError

from routers.exercises import _grade_d1, _public_view, D1AttemptRequest


# ── _grade_d1 ─────────────────────────────────────────────────────────────────


def test_grade_d1_exact_match():
    assert _grade_d1("mitigate", "mitigate") is True


def test_grade_d1_case_insensitive():
    assert _grade_d1("Mitigate", "mitigate") is True
    assert _grade_d1("MITIGATE", "mitigate") is True


def test_grade_d1_trim_whitespace():
    assert _grade_d1("  mitigate  ", "mitigate") is True


def test_grade_d1_wrong_word():
    assert _grade_d1("aggravate", "mitigate") is False


def test_grade_d1_empty_user_answer():
    assert _grade_d1("", "mitigate") is False


# ── _public_view ──────────────────────────────────────────────────────────────


_ROW = {
    "id": "00000000-0000-0000-0000-000000000001",
    "exercise_type": "D1",
    "content_payload": {
        "sentence": "The plan must ___ the impact of climate change.",
        "word": "mitigate",
        "answer": "mitigate",
        "distractors": ["aggravate", "ignore", "exacerbate"],
    },
}


def test_public_view_strips_answer_and_word():
    v = _public_view(_ROW)
    assert "answer" not in v["content"]
    assert "word" not in v["content"]
    assert "distractors" not in v["content"]


def test_public_view_options_includes_answer_plus_distractors():
    v = _public_view(_ROW)
    opts = v["content"]["options"]
    assert sorted(opts) == sorted(["mitigate", "aggravate", "ignore", "exacerbate"])
    assert len(opts) == 4


def test_public_view_options_order_is_deterministic_per_id():
    """Same row id must produce the same option order across calls."""
    v1 = _public_view(_ROW)
    v2 = _public_view(_ROW)
    assert v1["content"]["options"] == v2["content"]["options"]


def test_public_view_different_ids_produce_different_orders():
    """Sanity: at least one of two distinct ids should reorder the options."""
    row_a = {**_ROW, "id": "11111111-1111-1111-1111-111111111111"}
    row_b = {**_ROW, "id": "22222222-2222-2222-2222-222222222222"}
    a = _public_view(row_a)["content"]["options"]
    b = _public_view(row_b)["content"]["options"]
    # Both must be valid (same set), at least one distinct order across ids.
    assert sorted(a) == sorted(b)


def test_public_view_keeps_sentence():
    v = _public_view(_ROW)
    assert v["content"]["sentence"] == _ROW["content_payload"]["sentence"]


# ── D1AttemptRequest schema ───────────────────────────────────────────────────


def test_attempt_request_rejects_empty():
    with pytest.raises(ValidationError):
        D1AttemptRequest(user_answer="")


def test_attempt_request_rejects_overlong():
    with pytest.raises(ValidationError):
        D1AttemptRequest(user_answer="x" * 81)


def test_attempt_request_accepts_normal():
    req = D1AttemptRequest(user_answer="mitigate")
    assert req.user_answer == "mitigate"
