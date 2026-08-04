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
