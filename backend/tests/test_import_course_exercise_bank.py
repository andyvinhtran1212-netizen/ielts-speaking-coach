"""Nạp một buổi bài tập giáo trình vào kho quiz — chạy qua ĐÚNG lệnh người ta gõ.

Thứ dễ hỏng nhất ở đây KHÔNG phải phép ánh xạ, mà là hai chỗ im lặng:

  · `why_wrong` bị RPC nuốt mất (jsonb_to_recordset khai cứng cột) — nhập xong
    đếm đủ 100 câu mà cột mới rỗng trơn, không lỗi nào để lần ra;
  · câu tự luận bị chấm bằng so chuỗi — đánh trượt mọi cách diễn đạt đúng khác.
"""

from __future__ import annotations

import json
import sys
from unittest.mock import patch

import pytest

from scripts import import_course_exercise_bank as mod
from tests.test_import_speaking_lesson_sets import _DB


_COURSE = {"id": "course-c1", "code": "C1", "name": "Khóa nền tảng tiếng Anh"}


def _mcq(qid="B01-A1-01", **over):
    r = {
        "id": qid, "dang": "A1", "muc": 2, "diem_day": "RB2",
        "de": "Phần in đậm lấp ô nào?\nThe council **opened** libraries.",
        "pa": ["M — độn thêm", "S — chủ ngữ", "V — động từ", "O — tân ngữ"],
        "dap_an": 0,
        "giai_thich": "RÀNG BUỘC 2 — độn thêm chen giữa S và V.",
        "bay": ["", "nhầm vị trí giữa hai dấu phẩy là S (N4)",
                "thấy Ving là nhận thành động từ (N3)", "gộp vào cụm danh từ (N2)"],
        "truc": "cụm giới từ độn thêm", "truc_nhom": "NONG-COT", "chieu": "dao",
    }
    r.update(over)
    return r


def _essay(qid="B01-E1-01", **over):
    r = {
        "id": qid, "dang": "E1", "muc": 1, "diem_day": "RB1",
        "de": "Viết lại, dùng từ khoá: are",
        "dap_an_mau": "The buildings are very modern.",
        "bien_the_chap_nhan": ["The district's buildings are very modern."],
        "giai_thich": "RÀNG BUỘC 1 — Adj không tự lấp ô V.",
        "tieu_chi": "Đúng khi có đủ S và V, dùng are. Thiếu be ⟹ 0 điểm.",
    }
    r.update(over)
    return r


def _run(tmp_path, db, rows, *flags, name="KBT-buoi-01.jsonl"):
    p = tmp_path / name
    p.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")
    argv = ["prog", "--file", str(p), "--course", "C1", *flags]
    with patch.object(mod, "supabase_admin", db), patch.object(sys, "argv", argv):
        return mod.main()


def _db(**over):
    return _DB(courses=[_COURSE], quiz_banks=[], quiz_questions=[], **over)


def _rpc_rows(db):
    """Các dòng đã được đẩy qua RPC thay câu hỏi."""
    return [w for w in db.writes if w[0] == "rpc"]


# ── Ánh xạ ───────────────────────────────────────────────────────────────────

def test_a_lesson_lands_as_one_bank_keyed_by_course_and_lesson(tmp_path):
    db = _db()
    assert _run(tmp_path, db, [_mcq(), _essay()], "--commit") == 0
    bank = db.tables["quiz_banks"][0]
    assert bank["course_id"] == "course-c1"
    assert bank["lesson_no"] == 1
    assert bank["code"] == "C1-B01"
    assert bank["skill_area"] == "course"


def test_the_lesson_number_is_read_from_the_file_name(tmp_path):
    db = _db()
    _run(tmp_path, db, [_mcq()], "--commit", name="KBT-buoi-07.jsonl")
    assert db.tables["quiz_banks"][0]["lesson_no"] == 7


def test_an_unreadable_file_name_is_refused_instead_of_guessing(tmp_path):
    """Đoán bừa số buổi sẽ ghi đè lên bài tập của một buổi khác."""
    db = _db()
    with pytest.raises(SystemExit) as exc:
        _run(tmp_path, db, [_mcq()], "--commit", name="bai-tap.jsonl")
    assert "--lesson" in str(exc.value)


def test_every_distractor_carries_its_trap(tmp_path):
    db = _db()
    _run(tmp_path, db, [_mcq()], "--commit")
    row = mod._mcq_row(_mcq(), 0)
    # Chỉ phương án SAI, khoá là CHỈ SỐ dạng chuỗi.
    assert set(row["why_wrong"]) == {"1", "2", "3"}
    assert "N4" in row["why_wrong"]["1"]


def test_the_CORRECT_option_gets_no_trap_entry(tmp_path):
    """Nguồn để ô của đáp án đúng rỗng. Đưa nó vào `why_wrong` sẽ hiện ra một
    dòng "vì sao sai" bên cạnh chính đáp án đúng."""
    row = mod._mcq_row(_mcq(dap_an=2), 0)
    assert "2" not in row["why_wrong"]
    assert set(row["why_wrong"]) == {"0", "1", "3"}


def test_the_teaching_axis_becomes_the_grouping_key(tmp_path):
    """`item_key` là chỗ sổ lỗi gom "em này sai ở đâu". Trục kiến thức mịn hơn
    mã dạng, nên nó mới trả lời được câu ấy."""
    assert mod._mcq_row(_mcq(), 0)["item_key"] == "cụm giới từ độn thêm"


def test_difficulty_becomes_points(tmp_path):
    assert mod._mcq_row(_mcq(muc=3), 0)["points"] == 3


# ── Tự luận KHÔNG chấm máy ───────────────────────────────────────────────────

def test_an_essay_item_is_never_auto_graded(tmp_path):
    """Nguồn có `tieu_chi` ("Thiếu be ⟹ 0 điểm") — chính người soạn coi đây là
    việc cần NGƯỜI chấm. So chuỗi sẽ đánh trượt mọi cách diễn đạt đúng khác."""
    row = mod._essay_row(_essay(), 0)
    assert row["accept"] is None, "có `accept` là bật chấm tự động"
    assert row["answer"] is None
    assert row["counts_toward_mastery"] is False, "không được tính vào tỷ lệ đúng"
    assert row["type"] == "writing"


def test_the_model_answer_and_criteria_are_kept_for_self_checking(tmp_path):
    row = mod._essay_row(_essay(), 0)
    assert "The buildings are very modern." in row["explain"]
    assert "Cũng được chấp nhận" in row["explain"]
    assert "Thiếu be" in row["explain"]


def test_an_essay_without_a_model_answer_is_refused(tmp_path):
    db = _db()
    with pytest.raises(SystemExit):
        _run(tmp_path, db, [_essay(dap_an_mau="")], "--commit")


# ── Từ chối trước khi ghi ────────────────────────────────────────────────────

def test_a_dry_run_writes_nothing(tmp_path):
    db = _db()
    assert _run(tmp_path, db, [_mcq(), _essay()]) == 0
    assert db.writes == []


def test_dry_run_wins_over_commit(tmp_path):
    db = _db()
    _run(tmp_path, db, [_mcq()], "--commit", "--dry-run")
    assert db.writes == []


@pytest.mark.parametrize("broken,why", [
    ({"pa": ["a", "b", "c"]},                     "ba phương án"),
    ({"dap_an": 9},                               "đáp án ngoài khoảng"),
    ({"dap_an": True},                            "True là bool, không phải chỉ số"),
    ({"pa": ["a", "a", "b", "c"]},                "phương án trùng"),
    ({"giai_thich": "  "},                        "thiếu giải thích"),
    ({"de": ""},                                  "thiếu đề"),
    ({"bay": ["", "x", "", "y"]},                 "một nhiễu không được giải thích"),
])
def test_a_broken_question_is_refused_BEFORE_any_write(tmp_path, broken, why):
    """Kiểm toàn tệp trước khi ghi dòng đầu: để Postgres bắt nghĩa là nhận một
    thông báo lỗi tiếng Anh thay vì một câu nói rõ dòng nào hỏng."""
    db = _db()
    with pytest.raises(SystemExit):
        _run(tmp_path, db, [_mcq(), _mcq(qid="B01-A1-02", **broken)], "--commit")
    assert db.writes == [], why


def test_a_duplicate_qid_is_refused(tmp_path):
    db = _db()
    with pytest.raises(SystemExit):
        _run(tmp_path, db, [_mcq(), _mcq()], "--commit")
    assert db.writes == []


def test_an_unknown_course_is_refused_by_name(tmp_path):
    db = _db()
    p = tmp_path / "KBT-buoi-01.jsonl"
    p.write_text(json.dumps(_mcq()), encoding="utf-8")
    with patch.object(mod, "supabase_admin", db), \
         patch.object(sys, "argv", ["prog", "--file", str(p), "--course", "C9", "--commit"]):
        with pytest.raises(SystemExit) as exc:
            mod.main()
    assert "C9" in str(exc.value)


# ── Nạp lại / xuất bản ───────────────────────────────────────────────────────

def test_re_importing_updates_the_SAME_bank(tmp_path):
    """Nhận diện bằng (khoá, buổi) — đúng khoá của chỉ mục duy nhất mig 186. Tạo
    bank thứ hai cho cùng một buổi thì không ai biết giao bộ nào."""
    db = _db()
    _run(tmp_path, db, [_mcq()], "--commit")
    _run(tmp_path, db, [_mcq(), _mcq(qid="B01-A1-02")], "--commit")
    assert len(db.tables["quiz_banks"]) == 1
    assert db.tables["quiz_banks"][0]["words_count"] == 2


def test_it_lands_as_a_DRAFT_unless_publishing_is_asked_for(tmp_path):
    """Nạp xong là hiện ngay cho học viên thì một tệp sai sẽ tới tay các em trước
    khi ai kịp xem lại."""
    db = _db()
    _run(tmp_path, db, [_mcq()], "--commit")
    assert db.tables["quiz_banks"][0]["is_published"] is False
    _run(tmp_path, db, [_mcq()], "--commit", "--publish")
    assert db.tables["quiz_banks"][0]["is_published"] is True


def test_questions_go_through_the_ATOMIC_replace_rpc(tmp_path):
    """Xoá-rồi-ghi bằng hai lệnh riêng để lại một khoảnh khắc bank RỖNG, và một
    lần hỏng giữa chừng trộn câu cũ với câu mới."""
    db = _db()
    _run(tmp_path, db, [_mcq(), _essay()], "--commit")
    calls = _rpc_rows(db)
    assert len(calls) == 1
    _, name, params = calls[0]
    assert name == "quiz_replace_questions"
    assert len(params["p_rows"]) == 2
    # Chốt chống lỗi im lặng: RPC (mig 186) phải NHẬN được khoá này.
    assert any(r.get("why_wrong") for r in params["p_rows"])
