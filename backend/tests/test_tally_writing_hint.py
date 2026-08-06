"""Bảng "Xem ai nộp" phải nói được "em ấy CHƯA nộp tự luận".

Ca thật: giáo viên đi tìm bài tự luận của em Phương Anh Nguyễn và không thấy gì
— vì em ấy xong 9/9 chặng rồi dừng, chưa mở phần viết. Nút "Xem tự luận" không
hiện là ĐÚNG (không có gì để xem), nhưng chỗ đáng lẽ là một lời nhắc lại là một
ô TRỐNG, và ô trống đọc ra "tính năng hỏng" chứ không đọc ra "em ấy chưa làm".
"""

from __future__ import annotations

import inspect

import routers.admin_class_assignments as adm


def _src():
    return inspect.getsource(adm.assignment_tally)


def test_each_row_says_whether_the_task_even_has_writing():
    src = _src()
    assert '"writing_expected"' in src
    assert '"has_writing"' in src, "hai chuyện KHÁC nhau: có phần viết ≠ đã nộp"


def test_the_flag_travels_with_the_row_not_in_page_state():
    """Bộ vẽ MỘT DÒNG phải tự đủ để vẽ dòng ấy. Đọc một biến khai ngoài phạm vi
    thì nó chạy trên trang thật mà nổ ở mọi chỗ khác — kể cả bộ kiểm đang chạy
    chính nó (đã xảy ra khi làm việc này)."""
    src = _src()
    i = src.index('"writing_expected"')
    assert "writing_total > 0" in src[i:i + 120]


def test_the_count_is_read_before_the_row_loop():
    """Tính sau vòng lặp thì mọi dòng mang giá trị của lần vẽ TRƯỚC."""
    src = _src()
    assert src.index("writing_total, writing_ok = _course_writing_count") < src.index('"writing_expected"')


def test_a_bank_without_writing_shows_nothing_extra():
    """Bài Speaking/Reading không có phần viết — thêm một lời nhắc ở đó là nhiễu."""
    src = inspect.getsource(adm._course_writing_count)
    assert "if not bank_id:" in src and "return 0" in src
    assert 'eq("type", "writing")' in src


def test_a_failed_count_never_invents_a_writing_section():
    """Đọc hỏng mà trả một số > 0 là báo cả lớp chưa nộp một phần không tồn tại."""
    src = inspect.getsource(adm._course_writing_count)
    j = src.index("except Exception")
    assert "return 0" in src[j:j + 220]


def test_a_failed_writing_count_marks_the_tally_stale():
    """Đọc hỏng mà trả `0` thì mọi dòng mang `writing_expected: false` và lời
    nhắc "chưa nộp tự luận" biến mất y như thể bộ đề không có phần viết — hỏng
    đúng mục tiêu của chính bản vá này (codex cục bộ 05/08)."""
    src = inspect.getsource(adm._course_writing_count)
    assert "-> tuple[int, bool]" in src, "phải trả kèm cờ đọc-được"
    j = src.index("except Exception")
    assert "return 0, False" in src[j:]
    caller = _src()
    i = caller.index("writing_total, writing_ok = _course_writing_count")
    assert "if not writing_ok:" in caller[i:i + 200] and "stale = True" in caller[i:i + 260]
