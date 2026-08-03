"""Ánh xạ kiểu hỏi → độ khó phải có CĂN CỨ, và không được đoán bừa."""

from __future__ import annotations

from scripts.label_speaking_question_levels import LEVEL_OF_TYPE, SKIP_TYPES


def test_every_question_type_in_the_live_bank_is_mapped():
    """Chín kiểu hỏi đang có thật trong kho. Thiếu một cái là script bỏ qua nó
    trong im lặng và bộ đề "trải đều" thiếu mất một mảng."""
    live = {"personal", "opinion", "comparison", "time", "place",
            "prediction", "cause_effect", "solution", "cuecard"}
    assert live - set(LEVEL_OF_TYPE) - SKIP_TYPES == set()


def test_recalling_a_fact_is_easier_than_arguing_a_cause():
    """Độ khó ở đây là MỨC ĐÒI HỎI TƯ DUY, không phải độ dài câu hỏi.
    Nhớ lại một sự việc về chính mình (thì đơn) dễ hơn nêu ý kiến kèm lý do
    (mệnh đề nguyên nhân), và cả hai dễ hơn lập luận nhân-quả hay dự đoán
    (thì phức, thể giả định)."""
    order = {"easy": 0, "medium": 1, "hard": 2}
    assert order[LEVEL_OF_TYPE["personal"]] < order[LEVEL_OF_TYPE["opinion"]]
    assert order[LEVEL_OF_TYPE["opinion"]] < order[LEVEL_OF_TYPE["cause_effect"]]
    assert order[LEVEL_OF_TYPE["opinion"]] < order[LEVEL_OF_TYPE["prediction"]]


def test_the_three_recall_types_share_one_level():
    """personal / place / time đều là nhớ lại một sự việc — tách chúng ra ba mức
    khác nhau là bịa ra một khác biệt không có thật."""
    assert (LEVEL_OF_TYPE["personal"] == LEVEL_OF_TYPE["place"]
            == LEVEL_OF_TYPE["time"] == "easy")


def test_a_cue_card_is_not_labelled():
    """Part 2 là MỘT tấm thẻ; không có nhiều câu để trải đều dễ–khó, nên nhãn
    ở đó không phục vụ việc gì."""
    assert "cuecard" in SKIP_TYPES
    assert "cuecard" not in LEVEL_OF_TYPE


def test_only_the_three_agreed_levels_are_used():
    """Cột có CHECK constraint (mig 182) — một mức thứ tư sẽ đổ ở lệnh ghi chứ
    không đổ ở đây, tức là đổ giữa lượt chạy hàng trăm câu."""
    assert set(LEVEL_OF_TYPE.values()) == {"easy", "medium", "hard"}
