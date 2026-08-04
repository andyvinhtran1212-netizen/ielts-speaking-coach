"""Cờ "bài này cần người xem lại" — cho CẢ hai loại bài Speaking.

Rủi ro lớn nhất của một danh sách cảnh báo không phải là bỏ sót, mà là NHIỄU:
tuần nào cũng đầy thì tuần sau không ai mở nữa. Nên phần lớn phép kiểm dưới đây
là về việc cờ KHÔNG nổ khi không cần.
"""

from __future__ import annotations

import pytest

from services import speaking_flags as mod


def _r(**over):
    base = {"grading_status": "completed", "overall_band": 6.0,
            "duration_seconds": 45.0, "transcript": "I usually have breakfast at seven.",
            "score_confidence": "high", "submitted": True}
    base.update(over)
    return base


def _codes(rows):
    return [f["code"] for f in rows]


# ── Bài bình thường thì SẠCH ─────────────────────────────────────────────────

def test_a_normal_answer_raises_nothing():
    assert mod.flag_response(_r()) == []


def test_a_merely_low_band_is_NOT_a_flag():
    """Band 4.0 là một sự thật về trình độ, không phải một sự cố. Gắn cờ cho nó
    sẽ biến danh sách "cần xem lại" thành danh sách "học viên yếu" — mà lớp nào
    cũng có, nên hôm sau không ai mở nữa."""
    assert mod.flag_response(_r(overall_band=4.0)) == []


def test_medium_confidence_is_not_flagged():
    """Trên prod `medium` chiếm 1.034/6.219 bài — một phần sáu. Gắn cờ mức ấy là
    tự dìm chết cả danh sách."""
    assert mod.flag_response(_r(score_confidence="medium")) == []


# ── Chấm hỏng: nặng nhất, và KHÔNG phải lỗi học viên ─────────────────────────

def test_a_failed_grading_is_flagged_high():
    f = mod.flag_response(_r(grading_status="failed"))
    assert _codes(f) == ["grading_failed"]
    assert f[0]["severity"] == "high"


def test_submitted_without_a_band_is_also_a_failed_grading():
    """Học viên đã nộp mà không có điểm — nhìn từ sổ cái thì y hệt "chưa làm",
    nên phải nói rõ lỗi nằm ở phía hệ thống."""
    assert _codes(mod.flag_response(_r(overall_band=None))) == ["grading_failed"]


def test_a_session_still_in_progress_is_NOT_a_failed_grading():
    """`submitted=False` là bài đang làm dở, chưa tới lúc có điểm."""
    assert mod.flag_response(_r(overall_band=None, submitted=False)) == []


def test_a_failed_grading_suppresses_the_quality_flags():
    """Chưa có điểm thì mọi phán đoán về chất lượng đều dựa trên một số không tồn
    tại. Xếp ba cờ chồng lên nhau chỉ làm dòng ấy khó đọc, không thêm việc gì."""
    f = mod.flag_response(_r(grading_status="failed", score_confidence="low",
                             duration_seconds=3, transcript=""))
    assert _codes(f) == ["grading_failed"]


# ── Chất lượng bản ghi ───────────────────────────────────────────────────────

def test_low_confidence_is_flagged_with_what_to_do():
    f = mod.flag_response(_r(score_confidence="low"))
    assert _codes(f) == ["low_confidence"]
    assert "Nghe lại" in f[0]["action"]


def test_an_answer_under_ten_seconds_is_flagged():
    """Phân vị 1 của độ dài trên prod là 14,4 giây, nên mốc 10 nằm dưới 1% ngắn
    nhất — hiếm thật, không phải một ngưỡng bắt nhầm cả lớp."""
    assert "too_short" in _codes(mod.flag_response(_r(duration_seconds=6)))


def test_an_answer_at_the_median_length_is_not_flagged():
    assert mod.flag_response(_r(duration_seconds=43)) == []


def test_an_unknown_duration_is_not_treated_as_short():
    """None là KHÔNG BIẾT. Coi nó là ngắn sẽ gắn cờ cho mọi bài thiếu số liệu."""
    assert mod.flag_response(_r(duration_seconds=None)) == []


def test_an_empty_transcript_is_flagged_as_no_speech():
    assert "no_speech" in _codes(mod.flag_response(_r(transcript="   ")))


def test_a_PURGED_transcript_is_not_flagged_as_no_speech():
    """`transcript` bị dọn ở mốc 60 ngày (jobs/retention_sweep.py). None ở đây là
    KHÔNG CÒN LƯU, không phải "không có tiếng" — gắn cờ theo nó sẽ biến TOÀN BỘ
    bài cũ thành đáng ngờ vào đúng ngày cơ chế dọn được bật."""
    assert mod.flag_response(_r(transcript=None)) == []


# ── Cờ sư phạm: so với CHÍNH EM ẤY ───────────────────────────────────────────

def test_a_real_drop_against_the_students_own_median_is_flagged():
    f = mod.flag_student(submitted_bands=[7.0, 7.0, 7.0, 5.5],
                         recent_states=["submitted"] * 4)
    assert _codes(f) == ["band_drop"]
    assert "7.0" in f[0]["why"] and "5.5" in f[0]["why"]


def test_a_steady_LOW_student_is_not_flagged():
    """Một em band 5.0 đều đặn không có sự cố gì. So với LỚP thì em ấy đứng cuối,
    nhưng đó là một câu hỏi khác — và trả lời nó ở đây sẽ chôn mất em đang tụt."""
    assert mod.flag_student(submitted_bands=[5.0, 5.0, 5.0, 5.0],
                            recent_states=["submitted"] * 4) == []


def test_a_HIGH_student_who_slips_IS_flagged_even_though_still_above_average():
    f = mod.flag_student(submitted_bands=[8.0, 8.0, 8.0, 7.0],
                         recent_states=["submitted"] * 4)
    assert _codes(f) == ["band_drop"]


def test_half_a_band_is_within_normal_variation():
    assert mod.flag_student(submitted_bands=[6.5, 6.5, 6.5, 6.0],
                            recent_states=["submitted"] * 4) == []


def test_too_little_history_says_nothing():
    """Với hai bài cũ thì "trung vị" chỉ là một con số ngẫu nhiên."""
    assert mod.flag_student(submitted_bands=[7.0, 5.0],
                            recent_states=["submitted"] * 2) == []


def test_ONE_broken_recording_in_the_history_must_not_silence_a_real_drop():
    """Dùng TRUNG VỊ chứ không phải trung bình.

    Lịch sử [7.0, 7.0, 3.0] rồi bài mới 5.5 — cái 3.0 là một bản ghi hỏng, không
    phải trình độ. Trung vị của ba bài cũ là 7.0 ⇒ tụt 1.5 ⇒ NỔ, đúng. Trung
    bình là 5.67 ⇒ tụt 0.17 ⇒ IM LẶNG, sai — và im lặng đúng vào em đang cần
    được để ý.

    (Ca [7, 3, 7, 7] KHÔNG phân biệt được hai công thức: cả hai đều không nổ.
    Một phép thử như vậy trông đúng mà chẳng chứng minh gì.)"""
    f = mod.flag_student(submitted_bands=[7.0, 7.0, 3.0, 5.5],
                         recent_states=["submitted"] * 4)
    assert _codes(f) == ["band_drop"]


def test_a_single_bad_recording_alone_is_not_a_drop():
    """Chốt ngược: một bài hỏng ở CUỐI không được thành cờ sư phạm — đó là việc
    của cờ kỹ thuật (`grading_failed` / `low_confidence`), và hai họ cờ dẫn tới
    hai việc khác nhau."""
    assert mod.flag_student(submitted_bands=[7.0, 7.0, 7.0, 7.0],
                            recent_states=["submitted"] * 4) == []


def test_repeated_misses_are_flagged():
    f = mod.flag_student(submitted_bands=[],
                         recent_states=["submitted", "missing", "missing"])
    assert _codes(f) == ["falling_behind"]


def test_a_single_late_submission_is_not_flagged():
    """Trễ một lần là chuyện thường. Nhắn tin vì một lần trễ sẽ làm lời nhắc mất
    trọng lượng vào đúng lúc cần nó."""
    assert mod.flag_student(submitted_bands=[6.0] * 4,
                            recent_states=["submitted", "submitted", "late"]) == []


def test_only_the_recent_window_counts():
    """Bỏ hai bài từ ba tháng trước rồi nộp đều từ đó tới nay KHÔNG phải đang
    đuối — đó là đã khá lên."""
    old = ["missing", "missing"] + ["submitted"] * 5
    assert mod.flag_student(submitted_bands=[6.0] * 5, recent_states=old) == []


# ── Xếp mức ─────────────────────────────────────────────────────────────────

def test_worst_returns_the_highest_severity():
    flags = [mod._flag("a", "medium", "x", "y", "z"),
             mod._flag("b", "high", "x", "y", "z")]
    assert mod.worst(flags) == "high"


def test_worst_of_nothing_is_None():
    assert mod.worst([]) is None


# ── Mọi cờ phải NÓI ĐƯỢC VIỆC PHẢI LÀM ───────────────────────────────────────

@pytest.mark.parametrize("flags", [
    mod.flag_response(_r(grading_status="failed")),
    mod.flag_response(_r(score_confidence="low")),
    mod.flag_response(_r(duration_seconds=4)),
    mod.flag_response(_r(transcript="")),
    mod.flag_student(submitted_bands=[7.0, 7.0, 7.0, 5.0],
                     recent_states=["submitted"] * 4),
    mod.flag_student(submitted_bands=[], recent_states=["missing", "missing"]),
])
def test_every_flag_says_what_happened_why_and_what_to_do(flags):
    """Một cờ chỉ tô đỏ mà không nói việc phải làm sẽ bị bỏ qua sau vài lần —
    người ta không mở một danh sách mà mình không hành động được."""
    assert flags, "phép thử này vô nghĩa nếu không có cờ nào"
    for f in flags:
        assert f["label"] and f["why"] and f["action"]
        assert f["severity"] in ("high", "medium")
        # Việc phải làm là một CÂU MỆNH LỆNH, không phải mô tả lại vấn đề.
        assert f["action"] != f["why"]
