"""Giao bài cho MỘT NHÓM, và bù học viên mới vào bài ĐÃ GIAO.

Hai lỗ hổng có thật của lớp đang chạy:

  · em vào lớp sau ngày giao không có dòng nào trong `class_assignment_items`,
    nên bài ấy VÔ HÌNH với em — còn bảng của giáo viên vẫn đếm em vào mẫu số
  · không giao riêng được cho một nhóm, nên muốn giao cho 3 em thì phải giao
    cho cả lớp rồi giải thích bằng miệng
"""

from __future__ import annotations

import inspect
import pathlib
import re

from services import class_assignment_service as svc

_MIG_PATH = (pathlib.Path(__file__).parent.parent / "migrations"
             / "193_assignment_subgroup_and_backfill.sql")
MIG = _MIG_PATH.read_text(encoding="utf-8")

# Lời chú GIẢI THÍCH vì sao không dùng `ON CONFLICT`, `DELETE`… nên đếm chữ trên
# nguyên tệp là đếm cả những chữ nói ngược lại. Bộ quét phải đọc MÃ.
CODE = re.sub(r"--[^\n]*", "", MIG)


def test_the_roster_filter_lives_inside_the_locked_snapshot():
    """Lọc SAU khi chụp sĩ số là mở lại đúng khe hở mà FOR UPDATE vừa đóng."""
    i = MIG.index("FROM (")
    j = MIG.index("FOR UPDATE", i)
    inner = MIG[i:j]
    assert "p_student_ids IS NULL OR id = ANY(p_student_ids)" in inner, \
        "phép lọc nhóm phải nằm TRONG truy vấn con có khoá dòng"


def test_a_student_from_another_class_cannot_be_assigned():
    """Không tin danh sách gửi lên: luôn giao với `cohort_id`."""
    i = MIG.index("FROM students")
    seg = MIG[i:i + 260]
    assert "cohort_id = p_cohort_id" in seg
    assert "p_student_ids" in seg
    assert seg.index("cohort_id = p_cohort_id") < seg.index("p_student_ids"), \
        "điều kiện lớp phải đi TRƯỚC, không phải một lựa chọn thay thế"


def test_an_empty_subgroup_is_refused_like_an_empty_class():
    assert "empty_roster" in MIG


def test_backfill_only_ever_adds():
    """Em đã rời lớp mà đã nộp bài thì bài ấy là chuyện đã xảy ra."""
    i = CODE.index("fn_backfill_assignment_items")
    body = CODE[i:CODE.index("$$;", i)].upper()
    for bad in ("DELETE", "TRUNCATE", "UPDATE CLASS_ASSIGNMENT_ITEMS"):
        assert bad not in body, f"bù người nhận không được {bad}"


def test_backfill_is_safe_to_run_twice():
    i = CODE.index("fn_backfill_assignment_items")
    body = CODE[i:CODE.index("$$;", i)]
    assert "NOT EXISTS" in body, "chạy lại lần hai không được đẻ dòng trùng"
    # `ON CONFLICT` sẽ ĐỔ chứ không bỏ qua: bảng không có ràng buộc duy nhất
    # trên (assignment_id, student_id).
    assert "ON CONFLICT" not in body


def test_backfill_refuses_an_unknown_assignment():
    i = CODE.index("fn_backfill_assignment_items")
    body = CODE[i:CODE.index("$$;", i)]
    assert "assignment_not_found" in body


def test_both_functions_are_backend_only():
    """DROP xoá sạch phân quyền cũ. Không cấp lại là mở đúng lỗ mig 179 đã bịt:
    một học viên đăng nhập biết cohort_id sẽ tự giao bài cho cả lớp."""
    for fn in ("fn_create_class_assignment", "fn_backfill_assignment_items"):
        revokes = re.findall(rf"REVOKE EXECUTE ON FUNCTION public\.{fn}\(", MIG)
        grants = re.findall(rf"GRANT  EXECUTE ON FUNCTION public\.{fn}\(", MIG)
        assert revokes, f"{fn}: thiếu REVOKE"
        assert grants, f"{fn}: thiếu GRANT"
    i = MIG.index("REVOKE EXECUTE ON FUNCTION public.fn_create_class_assignment")
    assert "anon" in MIG[i:i + 300] and "authenticated" in MIG[i:i + 300]
    assert "TO service_role" in MIG


def test_the_new_signature_is_dropped_before_being_recreated():
    """`CREATE OR REPLACE` không đổi được danh sách tham số — thêm một tham số
    sẽ tạo hàm THỨ HAI và mọi lời gọi thành mơ hồ."""
    d = MIG.index("DROP FUNCTION IF EXISTS fn_create_class_assignment")
    c = MIG.index("CREATE OR REPLACE FUNCTION fn_create_class_assignment")
    assert d < c
    # Đúng chữ ký CŨ (12 tham số của mig 184), không phải chữ ký mới.
    sig = MIG[d:c]
    assert sig.count("uuid[]") == 0, "DROP phải nhắm chữ ký CŨ, không có uuid[]"


def test_the_migration_runs_in_one_transaction():
    assert MIG.index("BEGIN;") < MIG.index("DROP FUNCTION")
    assert MIG.rindex("COMMIT;") > MIG.rindex("GRANT  EXECUTE")


def test_the_service_passes_none_for_the_whole_class():
    """KHÔNG TRUYỀN GÌ phải thành NULL (cả lớp).

    Chốt này trước đây ghim `list(student_ids) if student_ids else None` — tức
    là ghim đúng biểu thức CÓ LỖI, vì nó gộp `[]` vào cùng nhánh với None. Ghim
    một biểu thức thay vì một hành vi là thế: nó khoá cái sai lại (codex PR 945
    vòng 2). Nay ghim bất biến: không truyền = NULL, và `[]` KHÔNG phải NULL.
    """
    src = inspect.getsource(svc.create_class_assignment)
    assert "None if student_ids is None else list(student_ids)" in src


def test_backfill_maps_a_missing_assignment_to_404_not_500():
    src = inspect.getsource(svc.backfill_assignment_items)
    assert "assignment_not_found" in src and "AssignmentNotFoundError" in src


def test_an_explicit_empty_list_is_nobody_not_everybody():
    """`[]` biến thành NULL nghĩa là một lời giao-cho-vài-em không chọn ai bỗng
    thành giao CHO CẢ LỚP — 30 em nhận một bài không dành cho họ, và không có
    gì đỏ để báo (codex PR 945 vòng 2)."""
    for fn in (svc.create_class_assignment, svc.backfill_assignment_items):
        src = inspect.getsource(fn)
        assert "None if student_ids is None else list(student_ids)" in src, \
            f"{fn.__name__}: phải phân biệt [] với None, không dùng phép kiểm chân trị"
        assert "list(student_ids) if student_ids else None" not in src
