"""Unit tests for services/d1_quality — the stricter #7 vocab distractor gate."""

from services import d1_quality as q


def _payload(**over):
    p = {
        "word": "resilient",
        "answer": "resilient",
        "sentence": "Children can be remarkably ___ after a difficult experience at school.",
        "distractors": ["fragile", "hostile", "curious"],
    }
    p.update(over)
    return p


def test_clean_payload_passes():
    assert q.validate_d1_quality(_payload()) == []
    assert q.is_quality(_payload())


def test_answer_leak_flagged():
    # the target word also appears elsewhere in the sentence
    p = _payload(sentence="A resilient child is often ___ under pressure.", answer="resilient")
    errs = q.validate_d1_quality(p)
    assert any("lộ đáp án" in e for e in errs)


def test_distractor_in_sentence_flagged():
    p = _payload(sentence="Some children are fragile, but others stay ___ under stress.",
                 distractors=["fragile", "hostile", "curious"])
    errs = q.validate_d1_quality(p)
    assert any("fragile" in e and "trong câu" in e for e in errs)


def test_multiword_distractor_flagged():
    p = _payload(distractors=["fragile", "very hostile", "curious"])
    errs = q.validate_d1_quality(p)
    assert any("MỘT từ" in e for e in errs)


def test_two_blanks_flagged():
    p = _payload(sentence="Children can be ___ and also ___ after school.")
    errs = q.validate_d1_quality(p)
    assert any("ĐÚNG một chỗ trống" in e for e in errs)


def test_no_blank_flagged():
    p = _payload(sentence="Children can be remarkably strong after a difficult experience.")
    errs = q.validate_d1_quality(p)
    assert any("ĐÚNG một chỗ trống" in e for e in errs)


def test_distractor_equals_answer_flagged():
    p = _payload(distractors=["resilient", "hostile", "curious"])
    errs = q.validate_d1_quality(p)
    assert any("trùng đáp án" in e for e in errs)


def test_duplicate_distractors_flagged():
    p = _payload(distractors=["fragile", "fragile", "curious"])
    errs = q.validate_d1_quality(p)
    assert any("trùng một distractor" in e for e in errs)


def test_wrong_distractor_count_flagged():
    p = _payload(distractors=["fragile", "hostile"])
    errs = q.validate_d1_quality(p)
    assert any("đúng 3 distractor" in e for e in errs)


def test_leak_check_ignores_the_blank_itself():
    # the answer being the blanked word must NOT count as a leak
    assert q.validate_d1_quality(_payload()) == []
