"""Mọi cột được `.select()` phải TỒN TẠI trong lược đồ.

VÌ SAO CẦN. `_load_pinned_class_questions` từng chọn `class_assignments.part` —
một cột KHÔNG TỒN TẠI (Part nằm trong `content_config`, mig 177). PostgREST từ
chối cả câu lệnh, và fail-closed biến nó thành 503: **mọi bài Speaking lớp đều
chặn học viên**. Toàn bộ test vẫn xanh, vì bộ giả `_Table.select()` bỏ qua danh
sách cột — nó không mô hình hoá thứ duy nhất đang hỏng.

Bộ kiểm này đọc mã thật, rút các cột được chọn, và so với lược đồ ghi ở đây.
Lược đồ được kiểm tay một lần với prod; thêm cột mới thì cập nhật cả hai chỗ —
đúng chỗ nên tốn công.

CỐ Ý không gọi DB: test phải chạy được khi không có mạng (bộ test này vốn đã
treo vì gọi Supabase thật — xem bộ nhớ dự án).
"""

from __future__ import annotations

import pathlib
import re

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]

# Cột THẬT, đã đối chiếu với prod 2026-08-04.
_SCHEMA = {
    "class_assignments": {
        "id", "cohort_id", "lesson_id", "skill", "content_id", "content_config",
        "title", "instructions", "due_at", "publish_at", "status", "assigned_by",
        "created_at", "updated_at",
    },
    "class_assignment_items": {
        "id", "assignment_id", "student_id", "state", "submitted_at", "score",
        "artifact_kind", "artifact_id", "created_at", "updated_at",
    },
    "topic_questions": {
        "id", "topic_id", "part", "order_num", "question_text", "question_type",
        "cue_card_bullets", "cue_card_reflection", "is_active", "created_at",
        "audio_url", "audio_path", "level",
    },
    "topics": {"id", "title", "part", "category", "is_active", "last_rotated_at",
               "created_at", "updated_at"},
}

_SELECT = re.compile(
    r'table\(\s*"(?P<table>\w+)"\s*\)\s*(?:\n\s*)?\.select\(\s*(?P<cols>(?:"[^"]*"\s*(?:\n\s*)?)+)',
    re.M,
)


def _sources():
    for d in ("routers", "services"):
        for f in sorted((_ROOT / d).glob("*.py")):
            yield f


def _selected_columns():
    """(file, bảng, cột) cho mọi .select() trên các bảng có trong _SCHEMA."""
    for f in _sources():
        src = f.read_text(encoding="utf-8")
        for m in _SELECT.finditer(src):
            table = m.group("table")
            if table not in _SCHEMA:
                continue
            raw = "".join(re.findall(r'"([^"]*)"', m.group("cols")))
            if "*" in raw:
                continue          # select("*") không kiểm được, và cũng không sai
            for col in raw.split(","):
                col = col.strip()
                # bỏ phần embed của PostgREST: "tên_bảng!inner(...)"
                if not col or "(" in col or "!" in col:
                    continue
                yield f"{f.parent.name}/{f.name}", table, col


def test_the_scan_actually_finds_queries():
    """Regex không khớp gì thì test này 'xanh' mà chẳng kiểm gì — đúng cái bẫy
    đã ghi trong bộ nhớ dự án."""
    found = list(_selected_columns())
    assert len(found) >= 10, f"chỉ rút được {len(found)} cột — regex hỏng?"


@pytest.mark.parametrize("where,table,col", list(_selected_columns()),
                         ids=lambda v: str(v))
def test_every_selected_column_exists(where, table, col):
    assert col in _SCHEMA[table], (
        f"{where} chọn {table}.{col} — cột này KHÔNG có trong lược đồ. "
        f"PostgREST sẽ từ chối CẢ câu lệnh, không chỉ bỏ qua cột thừa."
    )
