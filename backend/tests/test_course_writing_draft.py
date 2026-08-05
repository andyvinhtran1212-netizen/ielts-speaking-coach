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
    i = src.index('rpc("fn_save_course_writing_draft"')
    sent = set(re.findall(r'"(p_\w+)":', src[i:src.index("}).execute()", i)]))
    assert sent == {"p_item", "p_user", "p_bank", "p_answers", "p_seq"}, \
        f"gửi cả tham số lạ: {sent}"
    # Và hàm SQL chỉ chạm bảng nháp — không đụng bảng bài-đã-chấm.
    k = CODE.index("fn_save_course_writing_draft")
    body = CODE[k:CODE.index("$$;", k)]
    assert "course_writing_submissions" not in body
    # Đường Python chỉ ĐỌC bảng đã-chấm (để biết đã nộp chưa), không ghi.
    tables = set(re.findall(r'table\("(\w+)"\)', src))
    assert tables == {"course_writing_submissions"}
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


def test_a_failed_draft_read_says_so_instead_of_looking_empty():
    """Trả `draft: null` khi ĐỌC HỎNG là nói dối: trang đọc `null` thành "máy
    chủ chưa có gì" rồi đẩy bản cục bộ lên ĐÈ dòng thật — một lỗi đọc tạm thời
    thành mất dữ liệu vĩnh viễn (codex PR 949 vòng 2).

    Cùng khuôn với `association_lookup_failed` của mặt đọc mã kích hoạt.
    """
    src = inspect.getsource(qs.course_writing_state)
    assert '"draft_unavailable"' in src
    assert "draft_unavailable = True" in _draft_block(), "nhánh đọc hỏng phải bật cờ"


# ── Thứ tự ghi (codex PR 949 vòng 3) ────────────────────────────────────────

def test_a_late_arriving_older_draft_is_ignored():
    """Lúc rời trang, lượt `keepalive` bắn NGAY chứ không xếp hàng sau lượt lưu
    tự động còn đang bay — nếu không, trang đóng trước khi request kịp được tạo
    ra, và `keepalive` không cứu được một request chưa tồn tại. Bắn ngay thì hai
    lượt có thể tới ngược thứ tự, nên máy chủ phải bỏ lượt CŨ."""
    assert "seq" in inspect.signature(qs.save_course_writing_draft).parameters
    i = CODE.index("ON CONFLICT (class_assignment_item_id) DO UPDATE")
    seg = CODE[i:CODE.index("RETURNING id INTO v_id", i)]
    assert "course_writing_drafts.seq <= EXCLUDED.seq" in seg
    assert "p_seq IS NULL OR" in seg, "lời gọi không gửi seq vẫn phải ghi được"


def test_the_sequence_check_is_inside_the_write_not_a_separate_select():
    """Kiểm bằng một SELECT riêng rồi mới ghi là HAI giao dịch: một lượt mang
    bản CŨ đọc được `seq` cũ, qua cửa kiểm, rồi ghi SAU lượt mang bản mới và đè
    lên nó — đúng ca `seq` sinh ra để chặn (codex PR 949 vòng 4)."""
    src = inspect.getsource(qs.save_course_writing_draft)
    assert "fn_save_course_writing_draft" in src, "phải ghi bằng MỘT câu lệnh"
    # Và KHÔNG được đọc `seq` ra rồi tự so trong Python.
    assert '.select("seq")' not in src
    assert "fn_save_course_writing_draft" in CODE


def test_a_seq_less_write_never_lowers_the_stored_counter():
    """Hạ số đã lưu xuống thì lượt sau của trang lại bị coi là bản cũ."""
    i = CODE.index("ON CONFLICT (class_assignment_item_id) DO UPDATE")
    seg = CODE[i:CODE.index("RETURNING id INTO v_id", i)]
    assert "GREATEST(course_writing_drafts.seq, EXCLUDED.seq)" in seg


def test_the_draft_write_function_is_backend_only():
    assert "REVOKE EXECUTE ON FUNCTION public.fn_save_course_writing_draft" in CODE
    assert "GRANT  EXECUTE ON FUNCTION public.fn_save_course_writing_draft" in CODE


def test_the_sequence_column_exists_and_defaults_to_zero():
    assert "ADD COLUMN IF NOT EXISTS seq bigint NOT NULL DEFAULT 0" in CODE


def test_the_state_hands_the_sequence_back_so_a_reload_does_not_restart_at_zero():
    """Đếm lại từ 0 sau khi tải lại trang thì mọi lượt gửi mới đều bị coi là bản
    cũ và bỏ qua — nháp đóng băng vĩnh viễn."""
    src = inspect.getsource(qs.course_writing_state)
    assert '"seq": int(draft.get("seq") or 0)' in src
    assert "answers, updated_at, seq" in src, "quên CHỌN cột thì đọc ra None"
