"""migration 183 — kho đề Speaking theo buổi + loại bài giao.

Chốt những tính chất mà một `CREATE TABLE` viết vội sẽ làm sai ở ĐÚNG chỗ này,
và mỗi cái đều có một cách hỏng cụ thể trên prod.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from tests.test_migration_175_178_class_model import _strip_comments

MIG = Path(__file__).resolve().parents[1] / "migrations" / \
    "183_speaking_lesson_sets.sql"


@pytest.fixture(scope="module")
def sql() -> str:
    assert MIG.is_file(), f"missing {MIG.name}"
    return _strip_comments(MIG.read_text(encoding="utf-8"))


def test_the_bank_belongs_to_a_COURSE_not_a_cohort(sql):
    """"Để admin dùng lại" chỉ đúng nếu bộ đề sống ở tầng khoá. Gắn vào
    `cohorts` là chép lại đúng cái làm `class_lessons` không tái dùng được."""
    assert re.search(r"course_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+courses", sql, re.I)
    assert not re.search(r"speaking_lesson_sets[\s\S]{0,600}?cohort_id", sql, re.I)


def test_one_set_per_course_lesson_and_part(sql):
    assert re.search(
        r"CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_speaking_lesson_set\s+"
        r"ON\s+speaking_lesson_sets\s*\(\s*course_id\s*,\s*lesson_no\s*,\s*part\s*\)",
        sql, re.I)


def test_deleting_a_set_takes_its_questions_with_it(sql):
    """Câu hỏi không có nghĩa gì nếu tách khỏi bộ — để lại mồ côi thì bộ nạp lần
    sau sẽ đâm vào ràng buộc thứ tự của những dòng không ai còn thấy."""
    assert re.search(
        r"set_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+speaking_lesson_sets\s*\(\s*id\s*\)"
        r"\s+ON\s+DELETE\s+CASCADE", sql, re.I)


def test_the_order_constraint_only_covers_ACTIVE_questions(sql):
    """Bộ nạp TẮT câu bị bỏ khỏi tệp chứ không xoá. Một ràng buộc toàn bảng sẽ
    chặn việc soạn câu mới vào đúng vị trí vừa tắt — tức là chặn việc sửa bài."""
    m = re.search(r"CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_slsq_order_active"
                  r"[\s\S]{0,200}?;", sql, re.I)
    assert m, "thiếu chỉ mục thứ tự"
    assert re.search(r"WHERE\s+is_active", m.group(0), re.I)


def test_a_question_carries_BOTH_audio_columns(sql):
    """`audio_url` một mình không trả lời được "bản đọc này có đúng là bản đọc của
    LỜI HIỆN TẠI không". `audio_path` là băm của chính câu đọc, nên nó mới là thứ
    đối chiếu được."""
    body = re.search(r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+speaking_lesson_set_questions"
                     r"[\s\S]+?\n\);", sql, re.I).group(0)
    assert re.search(r"\baudio_url\s+TEXT", body, re.I)
    assert re.search(r"\baudio_path\s+TEXT", body, re.I)


def test_topic_label_is_NULLABLE(sql):
    """Bộ đề một buổi rải khắp nhiều chủ đề, nên "không có chủ đề" là trạng thái
    BÌNH THƯỜNG. Bắt buộc điền sẽ ép người soạn bịa ra một nhãn, và học viên sẽ
    nghe một lời dẫn sai."""
    body = re.search(r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+speaking_lesson_set_questions"
                     r"[\s\S]+?\n\);", sql, re.I).group(0)
    m = re.search(r"topic_label\s+TEXT([^,\n]*)", body, re.I)
    assert m, "thiếu cột topic_label"
    assert "NOT NULL" not in m.group(1).upper()


def test_existing_gives_are_backfilled_as_daily_without_guessing(sql):
    """Mọi dòng đang có đều là bài hằng ngày, nên giá trị mặc định là một HẰNG SỐ
    chứ không phải một phép suy luận từ dữ liệu."""
    assert re.search(r"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+kind\s+TEXT\s+NOT\s+NULL\s+"
                     r"DEFAULT\s+'daily'", sql, re.I)
    assert re.search(r"CHECK\s*\(\s*kind\s+IN\s*\(\s*'daily'\s*,\s*'lesson'\s*\)\s*\)",
                     sql, re.I)


def test_the_kind_check_is_added_only_if_missing(sql):
    """Chạy lại migration không được đổ vì ràng buộc đã tồn tại —
    `ADD CONSTRAINT` không có dạng `IF NOT EXISTS`."""
    assert re.search(r"pg_constraint[\s\S]{0,200}?class_assignments_kind_check", sql, re.I)


def test_it_runs_as_one_transaction(sql):
    """Nửa chừng thất bại sẽ để lại bảng bộ đề mà không có bảng câu hỏi — trạng
    thái mà bộ nạp sẽ đâm vào chứ không phát hiện ra."""
    assert re.search(r"^\s*BEGIN\s*;", sql, re.I | re.M)
    assert re.search(r"^\s*COMMIT\s*;", sql, re.I | re.M)


def test_every_create_is_idempotent(sql):
    creates = re.findall(r"CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(?!IF\s+NOT\s+EXISTS)",
                         sql, re.I)
    assert not creates, f"{len(creates)} lệnh CREATE thiếu IF NOT EXISTS"


# ── Vòng review 1: chốt bảo mật và mốc sửa đổi ────────────────────────────────

def test_both_tables_enable_RLS(sql):
    """Cả 7 bảng cùng cụm (topics, topic_questions, courses, cohorts,
    class_lessons, class_assignments, class_assignment_items) đều đã bật RLS. Để
    trần hai bảng này là tạo ra bảng public DUY NHẤT của cụm không có chốt — một
    client cầm khoá anon sửa được `question_text` hay `audio_url`, và lần giao
    bài sau đọc dữ liệu đã bị bơm ấy như sự thật chính thức."""
    for t in ("speaking_lesson_sets", "speaking_lesson_set_questions"):
        assert re.search(rf"ALTER\s+TABLE\s+{t}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY",
                         sql, re.I), f"{t} chưa bật RLS"


def test_the_policies_are_admin_only_and_check_writes_too(sql):
    """Thiếu WITH CHECK thì chính sách chặn ĐỌC mà vẫn cho GHI — đúng nửa nguy
    hiểm của lỗ hổng."""
    pols = re.findall(r"CREATE\s+POLICY[\s\S]+?;", sql, re.I)
    assert len(pols) == 2, f"cần đúng 2 policy, thấy {len(pols)}"
    for p in pols:
        assert re.search(r"FOR\s+ALL\s+TO\s+authenticated", p, re.I)
        assert re.search(r"USING\s*\(\s*public\.is_current_user_admin\(\)\s*\)", p, re.I)
        assert re.search(r"WITH\s+CHECK\s*\(\s*public\.is_current_user_admin\(\)\s*\)", p, re.I)


def test_policies_are_dropped_first_so_a_rerun_does_not_fail(sql):
    """CREATE POLICY không có dạng IF NOT EXISTS."""
    assert len(re.findall(r"DROP\s+POLICY\s+IF\s+EXISTS", sql, re.I)) == 2


def test_updated_at_is_actually_maintained(sql):
    """Một cột `updated_at` khai ra rồi không ai ghi thì TỆ HƠN là không có: nó
    trông như một mốc sửa đổi, nên người đi kiểm sau sẽ tin nó và kết luận sai
    rằng bộ đề chưa hề bị đụng tới."""
    trigs = re.findall(r"CREATE\s+TRIGGER[\s\S]+?EXECUTE\s+FUNCTION\s+"
                       r"update_updated_at_column\(\)\s*;", sql, re.I)
    assert len(trigs) == 2, f"cần trigger cho cả hai bảng, thấy {len(trigs)}"
    assert len(re.findall(r"DROP\s+TRIGGER\s+IF\s+EXISTS", sql, re.I)) == 2
