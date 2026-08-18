"""Nạp một buổi bài tập giáo trình vào kho quiz — chạy qua ĐÚNG lệnh người ta gõ.

Thứ dễ hỏng nhất ở đây KHÔNG phải phép ánh xạ, mà là hai chỗ im lặng:

  · `why_wrong` bị RPC nuốt mất (jsonb_to_recordset khai cứng cột) — nhập xong
    đếm đủ 100 câu mà cột mới rỗng trơn, không lỗi nào để lần ra;
  · câu tự luận bị chấm bằng so chuỗi — đánh trượt mọi cách diễn đạt đúng khác.
"""

from __future__ import annotations

import json
import sys
import zipfile
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


def _reading(**over):
    r = {
        "kind": "reading", "id": "TM20-B01-DOC", "vai_tro": "bài về nhà",
        "chu_de": "MỘT NGÀY Ở THƯ VIỆN", "cau_truc_trong_tam": "mạo từ",
        "so_tu": 4, "bai_doc": "Mai reads a book.",
        "tu_vung": [{"tu": "book", "loai": "n", "nghia": "sách"}],
        "cau_hoi": {
            "phan1_noi_dung": ["Mai reads. → T / F / NG"],
            "phan2_cau_truc": ["Chọn mạo từ đúng. → …"],
        },
        "dap_an": {
            "phan1_noi_dung": [
                {"cau": 1, "dap_an": "T", "giai_thich": "Đúng nguyên văn."}],
            "phan2_cau_truc": [
                {"cau": 2, "dap_an": "a", "giai_thich": "Danh từ số ít."}],
        },
        "ban_dich": "Mai đọc một cuốn sách.",
    }
    r.update(over)
    return r


def _listening(**over):
    r = {
        "kind": "listening", "id": "TM20-B01-NGHE", "vai_tro": "bài luyện nghe",
        "chu_de": "THÀNH PHỐ", "cau_truc_trong_tam": "so sánh", "lang": "en-GB",
        "audio_zip": "audio.zip",
        "phan_A_am": [{"so": 1, "audio": "A1.mp3", "lua_chon": ["city", "pity"],
                        "dap_an": "A", "nghe_duoc": "city"}],
        "phan_B_chu": [{"so": 1, "audio": "B1.mp3", "lua_chon": ["noise", "nose"],
                         "dap_an": "A", "nghe_duoc": "noise"}],
        "phan_C_cau": [{"so": 1, "audio": "C1.mp3", "lua_chon": ["City", "Country"],
                         "dap_an": "A", "nghe_duoc": "Which is bigger?"}],
        "phan_D_noi_dung": {
            "audio": "D.mp3", "doan_noi": "The city is bigger.",
            "ban_dich": "Thành phố lớn hơn.",
            "cau_hoi": [{"so": 1, "prompt": "The city is bigger.", "dap_an": "T"}],
        },
    }
    r.update(over)
    return r


def _audio_zip(path, names=("A1.mp3", "B1.mp3", "C1.mp3", "D.mp3")):
    with zipfile.ZipFile(path, "w") as archive:
        for name in names:
            archive.writestr(name, b"ID3" + name.encode())


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


def test_a_short_reading_is_bank_metadata_not_a_scored_question(tmp_path):
    db = _db()
    _run(tmp_path, db, [_mcq(), _essay(), _reading()], "--commit")
    bank = db.tables["quiz_banks"][0]
    reading = bank["meta"]["short_reading"]
    assert bank["words_count"] == 2
    assert reading["word_count"] == 4
    assert len(reading["question_groups"]) == 2
    assert len(reading["answers"]) == 2
    assert "T / F / NG" not in reading["question_groups"][0]["questions"][0]["prompt"]
    assert len(_rpc_rows(db)[0][2]["p_rows"]) == 2


@pytest.mark.parametrize("broken", [
    {"bai_doc": ""},
    {"so_tu": 99},
    {"ban_dich": ""},
    {"tu_vung": []},
    {"dap_an": {"phan1_noi_dung": [], "phan2_cau_truc": []}},
])
def test_a_broken_short_reading_is_refused_before_any_write(tmp_path, broken):
    db = _db()
    with pytest.raises(SystemExit):
        _run(tmp_path, db, [_mcq(), _reading(**broken)], "--commit")
    assert db.writes == []


def test_listening_is_bank_metadata_and_audio_paths_are_hash_scoped(tmp_path):
    _audio_zip(tmp_path / "audio.zip")
    rows, _reading_meta, listening = mod._normalise([_mcq(), _listening()])
    prepared, uploads = mod._prepare_listening_audio(
        listening, tmp_path / "KBT-buoi-01.jsonl")
    assert len(rows) == 1
    assert len(uploads) == 4
    assert len(prepared["sections"]) == 4
    assert len(prepared["solution"]["answers"]) == 4
    assert prepared["audio_bundle"]["file_count"] == 4
    assert all(path.startswith("course/") for path, _data in uploads)
    assert "audio_file" not in prepared["sections"][0]["questions"][0]


@pytest.mark.parametrize("names", [
    ("A1.mp3", "B1.mp3", "C1.mp3"),
    ("A1.mp3", "B1.mp3", "C1.mp3", "D.mp3", "extra.mp3"),
    ("../A1.mp3", "B1.mp3", "C1.mp3", "D.mp3"),
])
def test_listening_zip_must_exactly_match_jsonl_before_any_write(tmp_path, names):
    _audio_zip(tmp_path / "audio.zip", names)
    _rows, _reading_meta, listening = mod._normalise([_mcq(), _listening()])
    with pytest.raises(SystemExit):
        mod._prepare_listening_audio(listening, tmp_path / "KBT-buoi-01.jsonl")


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


# ── Vòng review 1 ────────────────────────────────────────────────────────────

def test_a_bank_is_never_published_before_its_questions_land(tmp_path):
    """Bank và câu hỏi là hai request riêng. Xuất bản ở bước tạo rồi hỏng giữa
    chừng sẽ để lại một bài tập RỖNG mà học viên mở được."""
    db = _db()
    _run(tmp_path, db, [_mcq()], "--commit", "--publish")
    ins = [w for w in db.writes if w[0] == "insert" and w[1] == "quiz_banks"]
    assert ins and ins[0][2]["is_published"] is False, "phải tạo ở trạng thái CHƯA xuất bản"
    assert db.tables["quiz_banks"][0]["is_published"] is True, "và xuất bản ở cuối"

    order = [w[1] if w[0] != "rpc" else "rpc" for w in db.writes]
    pub = max(i for i, w in enumerate(db.writes)
              if w[0] == "update" and w[1] == "quiz_banks"
              and w[2].get("is_published") is True)
    assert pub > order.index("rpc"), "xuất bản trước khi ghi câu là vô nghĩa"


def test_a_failure_writing_questions_leaves_the_bank_UNPUBLISHED(tmp_path):
    db = _db()
    real = db.rpc

    def boom(name, params):
        raise RuntimeError("mất kết nối")
    db.rpc = boom
    rc = _run(tmp_path, db, [_mcq()], "--commit", "--publish")
    db.rpc = real
    assert rc == 1, "hỏng giữa chừng phải trả mã lỗi, không im lặng thành công"
    assert db.tables["quiz_banks"][0]["is_published"] is False


@pytest.mark.parametrize("dang", ["A9", "F1", "a1", "", "MCQ"])
def test_an_unknown_question_type_code_is_refused(tmp_path, dang):
    """Mã lạ lọt vào kho sẽ hiện ra một thẻ dạng TRỐNG trên trang học viên —
    không có gì đỏ để lần ra."""
    db = _db()
    with pytest.raises(SystemExit) as exc:
        _run(tmp_path, db, [_mcq(dang=dang)], "--commit")
    assert "dạng" in str(exc.value)
    assert db.writes == []


def test_every_code_in_the_spec_is_accepted(tmp_path):
    """Chốt ngược: một whitelist quá hẹp sẽ chặn chính nội dung thật."""
    for d in ("A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3", "C4",
              "D1", "D2", "D3", "D4"):
        db = _db()
        assert _run(tmp_path, db, [_mcq(dang=d)], "--commit") == 0
    for d in ("E1", "E2", "E3"):
        db = _db()
        assert _run(tmp_path, db, [_essay(dang=d)], "--commit") == 0
