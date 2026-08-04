"""Nạp bộ đề Speaking theo buổi — chạy qua ĐÚNG lệnh người ta gõ.

Mọi test ở đây gọi `main()` với `sys.argv` thật, không gọi thẳng hàm con: bỏ một
lời gọi ra khỏi `main()` phải làm test đỏ, nếu không thì chốt biến mất mà không
ai biết (bài học từ nhánh #917).
"""

from __future__ import annotations

import json
import sys
from unittest.mock import patch

import pytest

from scripts import import_speaking_lesson_sets as mod


# ── Supabase giả, GHI ĐƯỢC ────────────────────────────────────────────────────

class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, db, name):
        self._db, self._name = db, name
        self._rows = list(db.tables.get(name, []))

    def select(self, *_a, **_k): return self

    def eq(self, f, v):
        # TÍCH LUỸ, không ghi đè: chuỗi .eq(a).eq(b) mà chỉ giữ cái cuối thì một
        # bộ lọc biến mất và test về truy vấn nhiều điều kiện thành vô nghĩa.
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self

    def in_(self, f, vals):
        self._rows = [r for r in self._rows if r.get(f) in vals]
        return self

    def limit(self, *_a): return self
    def order(self, *_a, **_k): return self

    def range(self, start, end):
        # Cắt THẬT chứ không bỏ qua: bộ đọc phân trang dừng khi trang ngắn hơn
        # kích thước trang, nên một double trả nguyên danh sách sẽ khiến vòng lặp
        # ấy trông như đúng dù nó sai.
        self._rows = self._rows[start:end + 1]
        return self

    def execute(self): return _Resp(self._rows)

    def insert(self, payload):
        rows = payload if isinstance(payload, list) else [payload]
        made = []
        for r in rows:
            row = dict(r)
            row.setdefault("id", f"{self._name}-{len(self._db.tables.setdefault(self._name, [])) + 1}")
            row.setdefault("is_active", True)
            self._db.tables.setdefault(self._name, []).append(row)
            self._db.writes.append(("insert", self._name, row))
            made.append(row)
        return _Op(_Resp(made))

    def update(self, payload):
        return _Update(self._db, self._name, payload)


class _Op:
    def __init__(self, resp): self._resp = resp
    def execute(self): return self._resp


class _Update:
    def __init__(self, db, name, payload):
        self._db, self._name, self._payload, self._eq = db, name, dict(payload), {}

    def eq(self, f, v):
        self._eq[f] = v
        return self

    def execute(self):
        hit = []
        for row in self._db.tables.get(self._name, []):
            if all(str(row.get(k)) == str(v) for k, v in self._eq.items()):
                row.update(self._payload)
                hit.append(row)
        self._db.writes.append(("update", self._name, dict(self._payload), dict(self._eq)))
        return _Resp(hit)


class _DB:
    def __init__(self, **tables):
        self.tables = {k: [dict(r) for r in v] for k, v in tables.items()}
        self.writes: list = []

    def table(self, name):
        return _Table(self, name)


_COURSE = {"id": "course-c3", "code": "C3", "name": "Khóa nâng cao"}


def _doc(**over):
    d = {
        "course_code": "C3", "lesson_no": 1, "part": 1,
        "title": "Buổi 1", "description": "mô tả",
        "questions": [
            {"order_num": 1, "question_text": "When do you have breakfast?",
             "question_type": "time"},
            {"order_num": 2, "question_text": "How often do you read books?",
             "question_type": "personal"},
        ],
    }
    d.update(over)
    return d


def _run(tmp_path, db, doc, *flags):
    p = tmp_path / "set.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    argv = ["prog", "--file", str(p), *flags]
    with patch.object(mod, "supabase_admin", db), patch.object(sys, "argv", argv):
        return mod.main()


# ── Chạy thật ─────────────────────────────────────────────────────────────────

def test_a_new_set_lands_with_its_questions(tmp_path):
    db = _DB(courses=[_COURSE])
    assert _run(tmp_path, db, _doc(), "--commit") == 0
    assert len(db.tables["speaking_lesson_sets"]) == 1
    qs = db.tables["speaking_lesson_set_questions"]
    assert [q["question_text"] for q in qs] == [
        "When do you have breakfast?", "How often do you read books?"]


def test_level_comes_from_the_SHARED_mapping_not_a_second_copy(tmp_path):
    """Chép một bảng ánh xạ thứ hai vào bộ nạp là hẹn ngày hai kho chấm độ khó
    khác nhau cho cùng một kiểu hỏi."""
    db = _DB(courses=[_COURSE])
    _run(tmp_path, db, _doc(), "--commit")
    by_order = {q["order_num"]: q for q in db.tables["speaking_lesson_set_questions"]}
    assert by_order[1]["level"] == mod.LEVEL_OF_TYPE["time"]
    assert by_order[2]["level"] == mod.LEVEL_OF_TYPE["personal"]


def test_running_it_twice_does_not_create_a_second_set(tmp_path):
    """Nhận diện bằng (khoá, buổi, part) — đúng khoá của chỉ mục duy nhất mig 183."""
    db = _DB(courses=[_COURSE])
    _run(tmp_path, db, _doc(), "--commit")
    _run(tmp_path, db, _doc(title="Buổi 1 (sửa tên)"), "--commit")
    assert len(db.tables["speaking_lesson_sets"]) == 1
    assert db.tables["speaking_lesson_sets"][0]["title"] == "Buổi 1 (sửa tên)"
    assert len(db.tables["speaking_lesson_set_questions"]) == 2


def test_editing_a_question_CLEARS_its_audio_pointer(tmp_path):
    """Bản đọc cũ đang nói một đề KHÁC. Giữ con trỏ nghĩa là học viên nghe một
    đằng còn bộ chấm đọc một nẻo — và không ai nhìn ra."""
    db = _DB(courses=[_COURSE])
    _run(tmp_path, db, _doc(), "--commit")
    for q in db.tables["speaking_lesson_set_questions"]:
        q["audio_url"], q["audio_path"] = "https://cdn/cu.mp3", "sp/cu.mp3"

    doc = _doc()
    doc["questions"][0]["question_text"] = "When do you usually have breakfast?"
    _run(tmp_path, db, doc, "--commit")

    by_order = {q["order_num"]: q for q in db.tables["speaking_lesson_set_questions"]}
    assert by_order[1]["audio_url"] is None and by_order[1]["audio_path"] is None
    # Câu KHÔNG đổi lời thì giữ nguyên bản đọc — render lại cả bộ vì một câu là
    # lãng phí, và làm mồ côi file cũ trong Storage.
    assert by_order[2]["audio_url"] == "https://cdn/cu.mp3"


def test_a_question_dropped_from_the_file_is_DISABLED_not_deleted(tmp_path):
    """Câu đã được giao cho một lớp mà biến mất khỏi bảng sẽ làm hỏng bản chụp đề
    của bài giao ấy."""
    db = _DB(courses=[_COURSE])
    _run(tmp_path, db, _doc(), "--commit")
    doc = _doc()
    doc["questions"] = doc["questions"][:1]
    _run(tmp_path, db, doc, "--commit")

    rows = db.tables["speaking_lesson_set_questions"]
    assert len(rows) == 2, "phải GIỮ dòng, chỉ tắt"
    assert {r["order_num"]: r["is_active"] for r in rows} == {1: True, 2: False}


# ── Từ chối trước khi ghi ─────────────────────────────────────────────────────

def test_a_dry_run_writes_NOTHING(tmp_path):
    db = _DB(courses=[_COURSE])
    assert _run(tmp_path, db, _doc()) == 0
    assert db.writes == []


def test_dry_run_wins_even_when_commit_is_also_passed(tmp_path):
    """Gõ cả hai cờ là người ta đang lưỡng lự — nghiêng về phía KHÔNG ghi."""
    db = _DB(courses=[_COURSE])
    _run(tmp_path, db, _doc(), "--commit", "--dry-run")
    assert db.writes == []


def test_a_duplicate_order_num_is_refused_BEFORE_anything_is_written(tmp_path):
    """Một tệp hỏng nửa chừng để lại bộ đề thiếu câu mà VẪN giao được."""
    db = _DB(courses=[_COURSE])
    doc = _doc()
    doc["questions"][1]["order_num"] = 1
    with pytest.raises(SystemExit):
        _run(tmp_path, db, doc, "--commit")
    assert db.writes == []


def test_an_empty_question_is_refused(tmp_path):
    db = _DB(courses=[_COURSE])
    doc = _doc()
    doc["questions"][0]["question_text"] = "   "
    with pytest.raises(SystemExit):
        _run(tmp_path, db, doc, "--commit")
    assert db.writes == []


def test_an_unknown_course_code_is_refused_by_name(tmp_path):
    db = _DB(courses=[_COURSE])
    with pytest.raises(SystemExit) as exc:
        _run(tmp_path, db, _doc(course_code="C9"), "--commit")
    assert "C9" in str(exc.value)


def test_comment_keys_in_the_file_are_not_treated_as_data(tmp_path):
    db = _DB(courses=[_COURSE])
    doc = _doc()
    doc["_note"] = ["giải thích cho người soạn"]
    assert _run(tmp_path, db, doc, "--commit") == 0
    assert "_note" not in db.tables["speaking_lesson_sets"][0]


# ── Vòng review 1: đủ trường, và chỉ xoá audio khi CÂU ĐỌC đổi ────────────────

def test_metadata_only_changes_are_synced_too(tmp_path):
    """Bản đầu chỉ so `question_text`, nên đổi mọi thứ khác đều bị bỏ qua trong
    im lặng: script báo "không cập nhật gì" trong khi tệp đã đổi thật."""
    db = _DB(courses=[_COURSE])
    _run(tmp_path, db, _doc(), "--commit")
    doc = _doc()
    doc["questions"][0]["question_type"] = "opinion"      # → level đổi theo
    _run(tmp_path, db, doc, "--commit")
    row = [q for q in db.tables["speaking_lesson_set_questions"]
           if q["order_num"] == 1][0]
    assert row["question_type"] == "opinion"
    assert row["level"] == mod.LEVEL_OF_TYPE["opinion"]


def test_a_metadata_change_does_NOT_throw_away_the_audio(tmp_path):
    """Xoá audio vì một cái nhãn là bắt render lại cả bộ — tốn tiền, và bỏ lại
    file cũ mồ côi trong Storage."""
    db = _DB(courses=[_COURSE])
    _run(tmp_path, db, _doc(), "--commit")
    for q in db.tables["speaking_lesson_set_questions"]:
        q["audio_url"], q["audio_path"] = "https://cdn/cu.mp3", "sp/cu.mp3"
    doc = _doc()
    doc["questions"][0]["question_type"] = "opinion"
    _run(tmp_path, db, doc, "--commit")
    row = [q for q in db.tables["speaking_lesson_set_questions"]
           if q["order_num"] == 1][0]
    assert row["audio_url"] == "https://cdn/cu.mp3"


def test_adding_a_topic_label_DOES_throw_away_the_audio(tmp_path):
    """`topic_label` đi thẳng vào câu đọc ("Let's talk about food."). Giữ bản đọc
    cũ nghĩa là học viên nghe một câu, bộ chấm đọc một câu khác."""
    db = _DB(courses=[_COURSE])
    _run(tmp_path, db, _doc(), "--commit")
    for q in db.tables["speaking_lesson_set_questions"]:
        q["audio_url"], q["audio_path"] = "https://cdn/cu.mp3", "sp/cu.mp3"
    doc = _doc()
    doc["questions"][0]["topic_label"] = "Food"
    _run(tmp_path, db, doc, "--commit")
    row = [q for q in db.tables["speaking_lesson_set_questions"]
           if q["order_num"] == 1][0]
    assert row["topic_label"] == "Food"
    assert row["audio_url"] is None and row["audio_path"] is None


def test_re_importing_an_UNCHANGED_file_writes_nothing(tmp_path):
    """Nếu không thì mỗi lần chạy lại là một mẻ ghi vô ích, và `updated_at` của
    cả bộ bị dời — xoá mất dấu vết ai sửa gì lúc nào."""
    db = _DB(courses=[_COURSE])
    _run(tmp_path, db, _doc(), "--commit")
    before = len(db.writes)
    _run(tmp_path, db, _doc(), "--commit")
    new_question_writes = [w for w in db.writes[before:]
                           if w[1] == "speaking_lesson_set_questions"]
    assert new_question_writes == []


# ── Vòng review 1: từ chối MỌI thứ DB sẽ từ chối, TRƯỚC khi ghi ───────────────

def test_an_invalid_level_is_refused_before_any_write(tmp_path):
    """Để DB bắt nghĩa là bắt ở GIỮA vòng ghi — bộ đề và vài câu đầu đã nằm
    trong bảng, còn lại một bộ `is_active` THIẾU CÂU mà vẫn giao được."""
    db = _DB(courses=[_COURSE])
    doc = _doc()
    doc["questions"][0]["level"] = "advanced"
    with pytest.raises(SystemExit) as exc:
        _run(tmp_path, db, doc, "--commit")
    assert "advanced" in str(exc.value)
    assert db.writes == []


def test_a_negative_order_num_is_refused_before_any_write(tmp_path):
    db = _DB(courses=[_COURSE])
    doc = _doc()
    doc["questions"][0]["order_num"] = -1
    with pytest.raises(SystemExit):
        _run(tmp_path, db, doc, "--commit")
    assert db.writes == []


def test_a_part_outside_1_to_3_is_refused_before_any_write(tmp_path):
    db = _DB(courses=[_COURSE])
    with pytest.raises(SystemExit):
        _run(tmp_path, db, _doc(part=4), "--commit")
    assert db.writes == []
