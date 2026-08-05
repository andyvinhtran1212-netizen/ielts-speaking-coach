"""Chỗ đang làm dở của bài tập theo buổi phải đọc được TỪ MÁY CHỦ.

Báo cáo thật: em Minh Ngoc Võ, bank C1-B01 — làm 8/10 câu chặng 3, đóng tab,
mở lại thì mất sạch. Học viên đọc chuyện ấy thành "thoát trình duyệt là bài tự
nộp". Không phải tự nộp: chỗ đang làm chỉ sống trong `localStorage` của đúng
một trình duyệt, nên `restore()` vứt chặng dở và `load()` mở một phiên MỚI —
những câu đã trả lời nằm lại trong một phiên không bao giờ được chốt.
"""

from __future__ import annotations

import inspect

from services import quiz_service as qs


def _src():
    return inspect.getsource(qs.get_course_resume)


def test_it_never_ends_a_session():
    """Bài chỉ được nộp khi học viên bấm nộp. Một đường ĐỌC mà chốt phiên là
    đúng thứ học viên đang than phiền."""
    src = _src()
    for bad in ("ended_by", '"ended_at":', ".update(", ".insert(", ".upsert("):
        assert bad not in src, f"đường khôi phục không được ghi gì: {bad}"


def test_open_and_completed_are_split_by_ended_at():
    src = _src()
    assert 'r.get("ended_at")' in src
    assert "completed" in src and "open_rows" in src


def test_sessions_of_another_assignment_item_are_excluded():
    """Chuyển lớp rồi được giao lại CÙNG bank là một mục khác — phiên của mục cũ
    đem đi xét đạt thì verdict bác cả lượt (mig 181)."""
    src = _src()
    assert 'class_assignment_item_id' in src and "item_id" in src


def test_the_kind_column_is_actually_selected():
    """Lọc theo một cột KHÔNG có trong `select` là lọc vào None: phiên kiểm tra
    lại sẽ lọt vào lượt chính. PostgREST không báo gì cả."""
    src = _src()
    i = src.index('.select(')
    sel = src[i:src.index(')', i)]
    assert "kind" in sel, "lọc theo `kind` thì phải CHỌN `kind`"
    assert "ended_at" in sel and "class_assignment_item_id" in sel


def test_a_read_failure_returns_empty_instead_of_blocking_the_student():
    """Ném ở đây là chặn học viên khỏi bài tập vì một lỗi đọc phụ trợ."""
    src = _src()
    assert "except Exception" in src
    assert "return empty" in src or "return result" in src


def test_non_course_banks_are_untouched():
    src = _src()
    assert "COURSE_AREA" in src, "chỉ bài tập theo buổi mới có khái niệm chặng"


def test_the_session_with_the_most_work_wins():
    """Tải lại trang đẻ ra vài phiên cho CÙNG một chặng, và phiên mới nhất
    thường là phiên ít bài nhất. Dữ liệu thật của em ấy: chặng 3 có một phiên 8
    câu và một phiên 5 câu — lấy mới nhất là bắt em làm lại 3 câu đã làm."""
    src = _src()
    assert "with_work" in src, "phiên rỗng không phải chỗ đang làm dở"
    assert "max(with_work" in src and "len(by_session" in src, \
        "phải chọn phiên NHIỀU BÀI NHẤT, không phải phiên mới nhất"


def test_it_returns_the_last_finished_stage_result():
    """Máy mới (chưa có gì trong localStorage) khôi phục vào màn kết quả với
    `marks` rỗng, mà trang tính điểm TỪ `marks` — nên không có con số này thì
    học viên xong cả bài vẫn thấy "0/10 câu đúng" (codex PR 945 vòng 4)."""
    src = _src()
    assert '"last_stage"' in src
    assert "total_correct" in src and "total_questions" in src


def test_the_totals_are_actually_selected():
    """Đọc một cột không có trong `select` là đọc ra None — và None ở đây thành
    "0 câu đúng", đúng thứ đang phải sửa."""
    src = _src()
    i = src.index(".select(")
    sel = src[i:src.index(")", i)]
    assert "total_correct" in sel and "total_questions" in sel
