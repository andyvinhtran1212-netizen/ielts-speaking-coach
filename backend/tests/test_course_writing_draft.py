"""Bản NHÁP phần tự luận sống trên máy chủ.

Phần tự luận có MỘT lượt nộp duy nhất, nên học viên viết dần trong nhiều buổi.
Tới nay bản nháp chỉ nằm trong `localStorage`: đổi máy, xoá bộ nhớ trình duyệt,
hay dùng máy phòng lab là mất trắng — và không ai nhìn thấy được, kể cả chính
em ấy.

Đây đúng lớp lỗi đã sửa cho phần trắc nghiệm (bài làm dở chỉ sống trong bộ nhớ
tab). Sửa cùng một cách: máy chủ giữ, trình duyệt chỉ là bộ đệm.
"""

from __future__ import annotations

import inspect
import pathlib
import re

from services import quiz_service as qs

MIG = (pathlib.Path(__file__).parent.parent / "migrations"
       / "194_course_writing_drafts.sql").read_text(encoding="utf-8")
CODE = re.sub(r"--[^\n]*", "", MIG)      # bộ quét đọc MÃ, không đọc lời chú


def test_the_draft_table_is_keyed_to_the_assignment_item():
    """Giao lại cùng bộ bài là một lượt MỚI — nháp của lần trước không được rót
    vào lần này (cùng lý do mig 192)."""
    assert "class_assignment_item_id uuid NOT NULL" in CODE
    assert "uq_course_writing_draft_per_item" in CODE
    i = CODE.index("uq_course_writing_draft_per_item")
    assert "(class_assignment_item_id)" in CODE[i:i + 200]


def test_one_draft_row_per_item_not_one_per_save():
    """Không có ràng buộc duy nhất thì mỗi lần lưu đẻ thêm một dòng, và lần đọc
    sau không biết dòng nào là mới nhất."""
    assert "CREATE UNIQUE INDEX" in CODE


def test_the_draft_table_is_backend_only():
    """Supabase phơi mọi bảng trong `public` ra PostgREST. Không thu hồi thì một
    học viên đăng nhập ĐỌC được nháp của cả lớp — và GHI ĐÈ được chúng."""
    assert "ENABLE ROW LEVEL SECURITY" in CODE
    assert "REVOKE ALL ON TABLE course_writing_drafts FROM PUBLIC, anon, authenticated" in CODE
    assert "GRANT  ALL ON TABLE course_writing_drafts TO service_role" in CODE


def test_the_graded_table_is_left_alone():
    """`course_writing_submissions` mô tả một lượt ĐÃ CHẤM: items/total/clean/
    graded_at đều NOT NULL, và một index canh 'một lượt nộp mỗi bài giao'. Cho
    nháp vào đó buộc phải nới lỏng đúng những ràng buộc ấy."""
    assert "ALTER TABLE course_writing_submissions" not in CODE
    assert "DROP INDEX" not in CODE


def test_saving_a_draft_is_refused_after_submitting():
    """Một lượt chấm duy nhất: sau khi chấm, ghi tiếp chỉ tạo một bản nháp mãi
    mãi không ai đọc, nằm cạnh bài đã chấm như thể còn sửa được."""
    src = inspect.getsource(qs.save_course_writing_draft)
    assert "course_writing_submissions" in src
    assert "409" in src


def test_saving_a_draft_needs_a_live_assignment():
    """Không có bài giao còn hiệu lực = không có chỗ để gắn nháp. Nói ra thay vì
    ghi vào hư không."""
    src = inspect.getsource(qs.save_course_writing_draft)
    assert "_assignment_item_for" in src and "403" in src


def test_a_draft_answer_is_bounded_by_the_same_limit_as_a_submission():
    """Một bản nháp dài hơn thứ nộp được là một lời hứa suông."""
    src = inspect.getsource(qs.save_course_writing_draft)
    assert "course_writing_grader.MAX_ANSWER_CHARS" in src


def test_saving_a_draft_never_grades_or_finalises():
    """Ghim thứ ĐƯỢC GHI, không quét chữ: quét chữ khớp cả tên mô-đun
    `course_writing_grader` lẫn chính lời chú giải thích vì sao không dùng nó.
    """
    src = inspect.getsource(qs.save_course_writing_draft)
    i = src.index("row = {")
    written = set(re.findall(r'"(\w+)":', src[i:src.index("}", i)]))
    assert written == {"class_assignment_item_id", "user_id", "bank_id",
                       "answers", "updated_at"}, f"ghi cả cột lạ: {written}"
    # Và chỉ chạm ĐÚNG hai bảng: bảng nháp để ghi, bảng đã-chấm để hỏi.
    tables = set(re.findall(r'table\("(\w+)"\)', src))
    assert tables == {"course_writing_drafts", "course_writing_submissions"}
    i2 = src.index('table("course_writing_submissions")')
    assert ".select(" in src[i2:i2 + 90], "bảng đã-chấm chỉ được ĐỌC"


def test_the_draft_is_only_read_when_nothing_was_submitted():
    """Nộp rồi thì nháp là rác, và rót nó ra màn hình chỉ để một ngày nào đó nó
    đè lên bài đã chấm."""
    src = inspect.getsource(qs.course_writing_state)
    assert "if item and not sub:" in src


def test_a_broken_draft_read_never_blocks_the_writing_section():
    """Em ấy vẫn phải gõ được — chỉ là mất phần đã gõ trên máy khác."""
    src = inspect.getsource(qs.course_writing_state)
    i = src.index("course_writing_drafts")
    seg = src[i:i + 700]
    assert "except Exception" in seg and "draft = None" in seg
