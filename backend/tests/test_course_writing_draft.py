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


def _draft_block() -> str:
    """Khối đọc nháp trong `course_writing_state`.

    Cắt theo MỐC KẾT THÚC THẬT (`return {`), không đếm ký tự: thêm vài dòng chú
    thích là khối trôi ra ngoài cửa sổ và chốt đỏ vì một lý do không liên quan
    tới hành vi. Đã xảy ra ba lần trong đúng phiên làm việc này.
    """
    src = inspect.getsource(qs.course_writing_state)
    i = src.index("course_writing_drafts")
    return src[i:src.index("return {", i)]


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
    """Ghim thứ ĐƯỢC GỬI ĐI, không quét chữ: quét chữ khớp cả tên mô-đun
    `course_writing_grader` lẫn chính lời chú giải thích vì sao không dùng nó.
    """
    src = inspect.getsource(qs.save_course_writing_draft)
    i = src.index("row = {")
    written = set(re.findall(r'"(\w+)":', src[i:src.index("}", i)]))
    assert written == {"class_assignment_item_id", "user_id", "bank_id",
                       "attempt_no", "answers", "updated_at"}, \
        f"ghi cả cột lạ: {written}"
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
    seg = _draft_block()
    assert "except Exception" in seg and "draft = None" in seg


# ── Thiết kế đã ĐẢO: máy đang gõ là nguồn thật ──────────────────────────────

def test_the_server_copy_is_a_backup_not_the_source_of_truth():
    """Bản đầu cho máy chủ làm nguồn thật, và đẻ ra ba đường mất bài (codex cục
    bộ 05/08). Đảo lại thì không cần số thứ tự, không cần ghi nguyên tử, và
    không cần cờ "không đọc được" — lượt ghi sau cùng thắng là đủ, vì nguồn thật
    nằm ở máy đang gõ.
    """
    src = inspect.getsource(qs.save_course_writing_draft)
    assert "seq" not in inspect.signature(qs.save_course_writing_draft).parameters
    assert "seq" not in src, "bộ máy thứ tự phải được xoá hẳn, không để lại nửa vời"
    assert "course_writing_drafts" in CODE
    assert "fn_save_course_writing_draft" not in src


def test_a_failed_draft_read_is_simply_no_backup():
    """Không đọc được bản dự phòng và chưa có bản dự phòng dẫn tới CÙNG một hành
    động (dùng bản trong máy), nên không tách chúng bằng một cờ riêng nữa."""
    src = inspect.getsource(qs.course_writing_state)
    assert "draft_unavailable" not in src
    seg = _draft_block()
    assert "except Exception" in seg and "draft = None" in seg


def test_the_cleanup_is_its_own_migration_not_an_edit_to_194():
    """`apply_migrations.sh` bỏ qua mọi tệp đã có tên trong sổ
    `_schema_migrations`. Sửa thẳng vào 194 thì môi trường nào đã chạy bản 194
    cũ sẽ giữ `seq` và hàm cũ VĨNH VIỄN, trong khi mã mới không dùng chúng
    (codex cục bộ 05/08)."""
    m195 = (pathlib.Path(__file__).parent.parent / "migrations"
            / "195_drop_course_writing_draft_seq.sql").read_text(encoding="utf-8")
    assert "DROP COLUMN IF EXISTS seq" in m195
    assert "DROP FUNCTION IF EXISTS fn_save_course_writing_draft" in m195
    # 194 chỉ TẠO — không được mang lệnh dọn, và không được nhắc tới seq.
    assert "seq" not in CODE
    assert "DROP" not in CODE
