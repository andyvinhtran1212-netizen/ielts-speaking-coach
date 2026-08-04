"""migration 184 — RPC tạo bài giao nhận thêm LOẠI BÀI.

Đổi chữ ký của một hàm đang chạy là chỗ dễ hỏng theo những cách không lộ ra ngay:
hàm bị nạp chồng, quyền gọi mở lại, hoặc migration không chạy lại được. Cả ba
đều đi qua được một lần chạy đầu tiên trông hoàn toàn bình thường.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from tests.test_migration_175_178_class_model import _strip_comments

MIG = Path(__file__).resolve().parents[1] / "migrations" / \
    "184_fn_create_assignment_kind.sql"

_OLD_SIG = r"uuid,\s*text,\s*text,\s*uuid,\s*jsonb,\s*uuid,\s*text,\s*timestamptz,\s*timestamptz,\s*text,\s*uuid"
_NEW_SIG = _OLD_SIG + r",\s*text"


@pytest.fixture(scope="module")
def sql() -> str:
    assert MIG.is_file(), f"missing {MIG.name}"
    return _strip_comments(MIG.read_text(encoding="utf-8"))


def test_the_old_signature_is_dropped_first(sql):
    """`CREATE OR REPLACE` KHÔNG đổi được danh sách tham số — thêm một tham số
    sẽ tạo hàm THỨ HAI, và từ đó mọi lời gọi đều mơ hồ ("could not choose the
    best candidate function")."""
    assert re.search(rf"DROP\s+FUNCTION\s+IF\s+EXISTS\s+fn_create_class_assignment\s*\(\s*{_OLD_SIG}\s*\)",
                     sql, re.I)


def test_it_can_be_run_twice(sql):
    """Migration này chạy TAY trên prod. `CREATE` trần thì lần thứ hai đổ: chữ ký
    cũ đã biến mất nên DROP thành vô hiệu, còn chữ ký mới đã tồn tại. Một lần
    retry sau lỗi mạng không được biến thành giao dịch abort."""
    assert re.search(r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+fn_create_class_assignment", sql, re.I)
    assert not re.search(r"CREATE\s+FUNCTION\s+fn_create_class_assignment", sql, re.I)


def test_the_new_parameter_defaults_to_daily(sql):
    """Mọi lời gọi CŨ phải giữ nguyên hành vi — đường giao bài hằng ngày không
    được phải sửa một dòng nào."""
    assert re.search(r"p_kind\s+text\s+DEFAULT\s+'daily'", sql, re.I)
    assert re.search(r"COALESCE\s*\(\s*p_kind\s*,\s*'daily'\s*\)", sql, re.I)


def test_kind_is_written_INSIDE_the_same_insert(sql):
    """Không phải một UPDATE sau. Lệnh thứ hai hỏng sẽ để lại một bài ĐÃ PUBLISH
    mang sai loại — nhìn từ ngoài là bài hằng ngày hợp lệ, nên không có gì đỏ để
    báo, chỉ có phiếu làm bài dựng sai số ô."""
    ins = re.search(r"INSERT\s+INTO\s+class_assignments[\s\S]+?RETURNING", sql, re.I)
    assert ins, "không tìm thấy lệnh INSERT"
    assert re.search(r"\bkind\b", ins.group(0), re.I)
    assert not re.search(r"UPDATE\s+class_assignments", sql, re.I)


def test_execute_is_taken_back_from_client_roles(sql):
    """DROP xoá sạch phân quyền cũ, và PostgreSQL cấp EXECUTE cho PUBLIC trên
    MỌI hàm mới. Không cấp lại ở đây là mở đúng lỗ mig 179 đã bịt: một học viên
    đăng nhập biết cohort_id sẽ tự giao bài cho cả lớp."""
    assert re.search(rf"REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_create_class_assignment\s*\(\s*{_NEW_SIG}\s*\)\s*\n?\s*FROM\s+PUBLIC,\s*anon,\s*authenticated",
                     sql, re.I)
    assert re.search(rf"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.fn_create_class_assignment\s*\(\s*{_NEW_SIG}\s*\)\s*\n?\s*TO\s+service_role",
                     sql, re.I)


def test_the_privilege_lines_name_the_NEW_signature(sql):
    """Nêu chữ ký CŨ ở đây thì lệnh đổ (hàm không còn) hoặc — tệ hơn — im lặng
    không áp vào hàm nào, và hàm mới ở lại với EXECUTE cho PUBLIC."""
    for stmt in re.findall(r"(?:REVOKE|GRANT)\s+EXECUTE[\s\S]+?;", sql, re.I):
        if "fn_create_class_assignment" not in stmt:
            continue
        args = re.search(r"\(([^)]*)\)", stmt).group(1)
        assert args.count(",") == 11, f"chữ ký phải có 12 tham số: {args}"


def test_it_stays_security_definer_with_a_pinned_search_path(sql):
    """Mất SET search_path là mở đường tiêm schema vào một hàm chạy bằng quyền
    chủ sở hữu."""
    assert re.search(r"SECURITY\s+DEFINER", sql, re.I)
    assert re.search(r"SET\s+search_path\s*=\s*public,\s*pg_temp", sql, re.I)


def test_it_runs_as_one_transaction(sql):
    """DROP và CREATE phải cùng một giao dịch: giữa hai lệnh, hàm KHÔNG TỒN TẠI
    trong một hệ thống đang chạy."""
    assert re.search(r"^\s*BEGIN\s*;", sql, re.I | re.M)
    assert re.search(r"^\s*COMMIT\s*;", sql, re.I | re.M)


def test_the_roster_snapshot_logic_survived_the_copy(sql):
    """Thân hàm được CHÉP từ mig 179. Chép sót phần khoá sổ sĩ số sẽ đưa trở lại
    đúng lỗi mig 179 sinh ra để chữa: student_count không khớp số dòng đã tạo."""
    assert re.search(r"FOR\s+UPDATE", sql, re.I)
    assert re.search(r"RAISE\s+EXCEPTION\s+'empty_roster'", sql, re.I)
    assert re.search(r"INSERT\s+INTO\s+class_assignment_items", sql, re.I)
