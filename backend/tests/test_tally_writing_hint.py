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


# ── MỘT nơi tính điểm ghi sổ, cho cả BỐN người ghi ────────────────────────

def test_the_tally_uses_the_shared_rule_and_does_not_compute_its_own():
    """Bốn đường ghi cột `score` phải dùng CHUNG một luật. Bản trước mỗi bên tự
    tính độ sạch bài viết, và cái trôi ở đây xoá kết quả trắc nghiệm mà không
    kêu thành tiếng."""
    src = _src()
    assert "course_hand_in_score(" in src
    # Truyền `clean=`/`total=` VÀO luật là đúng; tự CHIA ở đây mới là sai. Chốt
    # phải phân biệt hai thứ ấy, nếu không nó cấm luôn cách gọi hợp lệ.
    assert "clean" not in src.split("course_hand_in_score(")[0][-400:], \
        "còn tính điểm TRƯỚC khi gọi luật chung"
    import re
    assert not re.search(r"clean[^\n]{0,30}/", src), "vẫn tự chia để ra phần trăm"


def test_only_ONE_place_in_the_backend_turns_essay_cleanliness_into_a_score():
    """Chốt ĐIỂM DANH, không phải chốt grep hai tệp tôi vừa sửa.

    Nó đã tự chứng minh giá trị: bản đầu tìm ra người ghi THỨ BA
    (`submit_course_writing`, đường chạy thật trên sản phẩm) mà tôi chưa nhìn
    tới. Rồi vòng review cục bộ tìm ra người thứ TƯ
    (`regrade_failed_course_writing`) mà chốt này VẪN hụt, vì nó chia cho
    `len(graded)` chứ không cho `total` — nên mẫu dưới đây nhận cả hai dạng.
    """
    import pathlib, re
    root = pathlib.Path(__file__).resolve().parents[1]
    pat = re.compile(r"clean[^\n]{0,30}/[^\n]{0,40}(total|len\()")
    offenders = []
    for f in sorted(list(root.glob("services/*.py")) + list(root.glob("routers/*.py"))):
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue
            if pat.search(line):
                offenders.append(f"{f.name}:{n}")
    assert offenders == ["quiz_service.py:" + str(_line_of_rule())], \
        f"thêm một nơi tự tính điểm bài viết: {offenders}"


def _line_of_rule() -> int:
    import inspect
    from services import quiz_service as qs
    src, start = inspect.getsourcelines(qs.course_hand_in_score)
    for i, line in enumerate(src):
        if "/ int(total)" in line:
            return start + i
    raise AssertionError("không thấy dòng tính trong course_hand_in_score")


def test_the_rule_is_fed_by_BANK_SHAPE_never_by_a_row_field():
    """Bất biến xoá cuộc ĐUA, và nó dễ mất mà không ai thấy.

    Hỏi "dòng này đã có mastery chưa" đúng về nghĩa nhưng lượt nộp tự luận đọc
    dòng TRƯỚC khi gọi model chấm rồi ghi SAU — một lượt xét kết quả chạy xen
    vào giữa (hai tab) là bị ghi đè y như cũ. Hình dạng bộ đề là nội dung tĩnh,
    đọc lúc nào cũng thế (codex cục bộ 07/08).

    Nên `has_mcq` phải đến từ `_course_bank_shape`/`_bank_shapes`, KHÔNG bao giờ
    từ `item[...]` hay `row[...]`.
    """
    import inspect, re
    from services import quiz_service as qs
    import routers.admin_class_assignments as adm

    sigs = []
    for src in (inspect.getsource(qs), inspect.getsource(adm)):
        sigs += re.findall(r"has_mcq=([^,\n]+)", src)
    assert sigs, "không thấy nơi gọi nào"
    for arg in sigs:
        assert "mastery" not in arg and "item[" not in arg and "it[" not in arg, \
            f"`has_mcq` lấy từ trạng thái DÒNG, cuộc đua quay lại: {arg}"
        assert ("_bank_shape" in arg or "_shapes" in arg or "mcq_total" in arg
                or "known" in arg), f"`has_mcq` không đến từ hình dạng bộ đề: {arg}"
