"""Mặt đọc: học viên làm bài tập theo buổi TRONG BAO LÂU, vướng ở đâu.

Cho tới nay `quiz_attempts` không có mặt đọc nào cho bài tập theo buổi, nên ba
câu hỏi của giáo viên đều không trả lời được — và quan trọng nhất là "em ấy
đang làm dở hay đã bỏ cuộc", vốn trốn chung trong đám "chưa nộp".
"""

from __future__ import annotations

import inspect

from services import quiz_service as qs


def _src():
    return inspect.getsource(qs.course_attempt_report)


def test_time_comes_from_finished_stages_not_wall_clock():
    """Đóng tab rồi mở lại hôm sau thì `ended_at - started_at` là "một ngày
    rưỡi": đúng về đồng hồ, vô nghĩa về việc học."""
    src = _src()
    assert 'x.get("duration_sec")' in src
    assert "ended_at" in src and "started_at" in src
    # KHÔNG được lấy hiệu hai mốc ấy làm thời lượng.
    assert 'x["ended_at"] - x["started_at"]' not in src


def test_the_four_states_are_all_distinguished():
    src = _src()
    for st in ("doing", "done", "stalled", "untouched"):
        assert f'"{st}"' in src, f"thiếu trạng thái {st}"


def test_stalled_needs_a_real_silence_not_just_an_open_session():
    """Tải lại trang đẻ ra phiên mới; gọi mọi phiên mở là "bỏ dở" sẽ báo động
    giả cho cả lớp."""
    src = _src()
    assert "timedelta(hours=24)" in src


def test_empty_sessions_do_not_count_as_in_progress():
    """Phiên rỗng do tải lại trang từng nhiều hơn phiên thật."""
    src = _src()
    assert "with_work" in src
    i = src.index("live = ")
    assert "with_work" in src[i:i + 160], "đang-làm-dở phải đòi phiên CÓ BÀI"


def test_retake_sessions_are_excluded():
    """Phiên kiểm tra lại là mẫu nhỏ ngẫu nhiên — trộn vào là làm sai cả thời
    lượng lẫn số chặng."""
    src = _src()
    assert 'x.get("kind") or "run"' in src


def test_ids_are_chunked_and_rows_are_paged():
    """Hai giới hạn KHÁC NHAU: PostgREST cắt ở 1000 dòng mà không báo, còn
    `in.(...)` quá dài làm mặt đọc 500 thay vì hiện được gì."""
    src = _src()
    assert "_REPORT_IDS" in src
    assert "_report_pages" in src
    pager = inspect.getsource(qs._report_pages)
    assert ".range(" in pager, "không phân trang thì im lặng mất dòng thứ 1001"


def test_the_report_never_writes():
    src = _src()
    for bad in (".update(", ".insert(", ".upsert(", ".delete("):
        assert bad not in src, f"mặt ĐỌC không được {bad}"


def test_a_read_failure_returns_an_empty_report_not_a_500():
    src = _src()
    assert "except Exception" in src and "return out" in src


def test_the_axes_carry_both_how_wrong_and_how_slow():
    """"Sai nhiều" và "tốn thời gian" là hai vấn đề khác nhau: câu sai nhiều là
    chưa hiểu, câu chậm mà đúng là chưa thạo."""
    src = _src()
    assert '"wrong"' in src and '"median_sec"' in src


def test_stalled_students_sort_to_the_top():
    """Dòng giáo viên cần nhìn thấy trước là dòng đã bỏ cuộc."""
    src = _src()
    assert 'r["state"] != "stalled"' in src
