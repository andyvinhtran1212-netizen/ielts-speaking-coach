"""Unit tests for services/quiz_why_wrong — the #7a per-distractor gate."""

from services import quiz_why_wrong as qw


def _mcq(**over):
    q = {"type": "mcq", "options": ["a", "b", "c", "d"], "answer": 0}
    q.update(over)
    return q


# ── wrong_option_indices ──────────────────────────────────────────────────────

def test_wrong_indices_mcq():
    assert qw.wrong_option_indices(_mcq(answer=0)) == [1, 2, 3]
    assert qw.wrong_option_indices(_mcq(answer=2)) == [0, 1, 3]


def test_wrong_indices_boolean_is_none():
    assert qw.wrong_option_indices({"type": "boolean", "answer": True}) is None


def test_wrong_indices_typed_input_is_none():
    assert qw.wrong_option_indices({"type": "gap_type", "answer": "coal"}) is None


# ── optional-when-absent ──────────────────────────────────────────────────────

def test_absent_ok_when_not_required():
    assert qw.validate_why_wrong(_mcq(), "q1") == []


def test_absent_fails_when_required():
    errs = qw.validate_why_wrong(_mcq(), "q1", required=True)
    assert errs and "thiếu 'why_wrong'" in errs[0]


# ── coverage ──────────────────────────────────────────────────────────────────

def test_full_coverage_passes():
    q = _mcq(why_wrong={"1": "b sai vì X", "2": "c sai vì Y", "3": "d sai vì Z"})
    assert qw.validate_why_wrong(q, "q1", required=True) == []
    assert qw.has_why_wrong(q)


def test_missing_one_wrong_option_fails():
    q = _mcq(why_wrong={"1": "b sai", "2": "c sai"})  # missing index 3
    errs = qw.validate_why_wrong(q, "q1", required=True)
    assert any("index 3" in e for e in errs)


def test_empty_reason_flagged():
    q = _mcq(why_wrong={"1": "b sai", "2": "  ", "3": "d sai"})
    errs = qw.validate_why_wrong(q, "q1")
    assert any("why_wrong[2]' trống" in e for e in errs)


def test_key_pointing_at_correct_answer_flagged():
    q = _mcq(answer=0, why_wrong={"0": "không nên có", "1": "b", "2": "c", "3": "d"})
    errs = qw.validate_why_wrong(q, "q1")
    assert any("ĐÁP ÁN ĐÚNG" in e for e in errs)


def test_non_index_key_flagged():
    q = _mcq(why_wrong={"1": "b", "2": "c", "3": "d", "x": "bad"})
    errs = qw.validate_why_wrong(q, "q1")
    assert any("không phải chỉ-số" in e for e in errs)


def test_wrong_type_why_wrong_flagged():
    q = _mcq(why_wrong=["a", "b"])  # list, not dict
    errs = qw.validate_why_wrong(q, "q1")
    assert errs and "phải là dict" in errs[0]
