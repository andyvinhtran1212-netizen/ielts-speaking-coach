"""Bài tập theo BUỔI HỌC không phải nội dung tự chọn.

Nó nằm trong kho của giáo viên và chỉ tới tay một học viên khi em đó ĐƯỢC GIAO.
Hai cửa phải khoá, và khoá bằng CẤU TẠO chứ không bằng quy ước "nhớ để nháp":

  · liệt kê — `skill_area` do người gọi truyền, nên không loại trừ nghĩa là bất
    kỳ ai gọi `?skill_area=course` cũng đọc được toàn bộ giáo trình;
  · mở bài  — xuất bản KHÔNG mở cửa; phải có bài giao cho chính em ấy.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from services import quiz_service as mod


class _Resp:
    # `count` cần cho mọi truy vấn `select(..., count="exact")`. Thiếu nó thì
    # lượt đếm NÉM, rơi vào nhánh cho-qua, và chốt xanh vì lý do không liên quan
    # tới thứ nó định kiểm.
    def __init__(self, data):
        self.data = data
        self.count = len(data)


class _Table:
    def __init__(self, rows, db=None):
        self._rows = list(rows)
        self._db = db

    def select(self, *_a, **_k): return self

    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self

    @property
    def not_(self):
        # `not_.is_(col, "null")` = cột KHÁC NULL. Thiếu nó thì lượt đếm chặng
        # NÉM, rơi vào nhánh cho-qua, và chốt xanh vì một lý do không liên quan.
        outer = self

        class _Not:
            def is_(self, f, _v):
                outer._rows = [r for r in outer._rows if r.get(f) is not None]
                return outer
        return _Not()

    def range(self, a, b):
        # `_report_pages` đọc theo TRANG. Thiếu `range` thì lượt đọc NÉM, rơi
        # vào nhánh cho-qua, và chốt xanh vì một lý do không liên quan.
        self._rows = self._rows[a:b + 1]
        return self

    def neq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) != str(v)]
        return self

    def in_(self, f, vals):
        self._rows = [r for r in self._rows if r.get(f) in vals]
        return self

    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def update(self, payload): self._patch = payload; return self
    def insert(self, payload):
        row = dict(payload if isinstance(payload, dict) else payload[0])
        row.setdefault("id", "sess-1")
        self._db.inserted.append(row)
        return _Op(_Resp([row]))
    def execute(self): return _Resp(self._rows)


class _Op:
    def __init__(self, r): self._r = r
    def execute(self): return self._r


def _db(**tables):
    db = type("DB", (), {})()
    db.inserted = []
    db.table = lambda n: _Table(tables.get(n, []), db)
    return db


# Bài giao THẬT có đủ ba trường mà cổng đọc. Để thiếu chúng nghĩa là test đang
# kiểm một thứ KHÁC với thứ chạy trên prod.
_LIVE_ASG = {"id": "asg-1", "content_id": "bank-course", "skill": "course",
             "status": "published",
             "publish_at": None, "due_at": None, "cohort_id": "co-1"}
_STUDENT = {"id": "st-1", "user_id": "u1", "cohort_id": "co-1"}

_COURSE_BANK = {"id": "bank-course", "code": "C1-B01", "skill_area": "course",
                "title": "Buổi 1", "is_published": True, "topic_id": None,
                "words_count": 100, "updated_at": "2026-08-04"}
_VOCAB_BANK = {"id": "bank-vocab", "code": "V-01", "skill_area": "vocab",
               "title": "Từ vựng", "is_published": True, "topic_id": "t1",
               "words_count": 20, "updated_at": "2026-08-04"}


# ── Cửa 1: liệt kê ───────────────────────────────────────────────────────────

def test_a_course_bank_never_appears_in_the_student_listing():
    db = _db(quiz_banks=[_COURSE_BANK, _VOCAB_BANK])
    with patch.object(mod, "supabase_admin", db):
        codes = [b["code"] for b in mod.list_published_banks()]
    assert codes == ["V-01"], "giáo trình không được nằm trong danh sách tự chọn"


def test_asking_for_the_course_area_by_name_returns_NOTHING():
    """`skill_area` đến từ người gọi. Chỉ dựa vào 'không trang nào hỏi nó' là dựa
    vào một thói quen, không phải một chốt."""
    db = _db(quiz_banks=[_COURSE_BANK, _VOCAB_BANK])
    with patch.object(mod, "supabase_admin", db):
        assert mod.list_published_banks(skill_area="course") == []


def test_the_other_areas_still_list_normally():
    """Chốt ngược: khoá quá tay sẽ làm hỏng kho từ vựng và ngữ pháp đang chạy."""
    db = _db(quiz_banks=[_COURSE_BANK, _VOCAB_BANK])
    with patch.object(mod, "supabase_admin", db):
        assert [b["code"] for b in mod.list_published_banks(skill_area="vocab")] == ["V-01"]


# ── Cửa 2: mở bài ────────────────────────────────────────────────────────────

def _play(db, user_id="u1"):
    with patch.object(mod, "supabase_admin", db):
        return mod.get_bank_for_play("bank-course", user_id=user_id)


def test_a_published_course_bank_is_still_CLOSED_without_an_assignment():
    """Xuất bản KHÔNG mở cửa cho giáo trình. Nếu có thì một lần bấm 'xuất bản'
    trong trang admin là mở toàn bộ khoá cho mọi học viên."""
    db = _db(quiz_banks=[_COURSE_BANK], quiz_questions=[],
             class_assignments=[], students=[], class_assignment_items=[])
    with pytest.raises(HTTPException) as exc:
        _play(db)
    assert exc.value.status_code == 404


def test_it_answers_404_not_403():
    """403 xác nhận bank ấy tồn tại. Với nội dung giáo trình thì chính sự tồn tại
    cũng không cần nói ra."""
    db = _db(quiz_banks=[_COURSE_BANK], class_assignments=[], students=[])
    with pytest.raises(HTTPException) as exc:
        _play(db)
    assert exc.value.status_code == 404
    assert "403" not in str(exc.value.detail)


def test_an_ASSIGNED_student_can_open_it():
    db = _db(
        quiz_banks=[_COURSE_BANK],
        quiz_questions=[{"id": "q1", "bank_id": "bank-course", "order": 0,
                         "type": "mcq", "item_key": "x"}],
        class_assignments=[_LIVE_ASG],
        students=[_STUDENT],
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1", "student_id": "st-1"}],
    )
    with patch.object(mod, "_word_cards_for", lambda *_a, **_k: []), \
         patch.object(mod, "_attach_article_urls", lambda *_a, **_k: None), \
         patch.object(mod, "_resolve_question_audio", lambda *_a, **_k: None):
        out = _play(db)
    assert out["bank"]["code"] == "C1-B01"
    assert len(out["questions"]) == 1


def test_ANOTHER_students_assignment_does_not_open_it():
    """Bài giao của bạn cùng lớp không phải bài giao của em ấy.

    Em u1 PHẢI là một học viên có thật ở đây — nếu để em ấy không có hồ sơ nào
    thì hàm thoát sớm ở bước tra học viên và bộ lọc `student_id` không bao giờ
    chạy, nên phép thử trông đúng mà chẳng chứng minh gì. (Phá-thử-ngược bắt
    được: bỏ hẳn bộ lọc ấy mà bản test cũ vẫn xanh.)"""
    db = _db(
        quiz_banks=[_COURSE_BANK],
        class_assignments=[{"id": "asg-1", "content_id": "bank-course"}],
        students=[{"id": "st-1", "user_id": "u1"},        # chính em ấy
                  {"id": "st-2", "user_id": "u-khac"}],   # bạn cùng lớp
        # Bài giao thuộc về BẠN CÙNG LỚP, không phải em ấy.
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1", "student_id": "st-2"}],
    )
    with pytest.raises(HTTPException) as exc:
        _play(db, user_id="u1")
    assert exc.value.status_code == 404


def test_an_assignment_for_a_DIFFERENT_bank_does_not_open_it():
    db = _db(
        quiz_banks=[_COURSE_BANK],
        class_assignments=[{"id": "asg-1", "content_id": "bank-khac"}],
        students=[{"id": "st-1", "user_id": "u1"}],
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1", "student_id": "st-1"}],
    )
    with pytest.raises(HTTPException) as exc:
        _play(db)
    assert exc.value.status_code == 404


def test_an_anonymous_caller_is_refused():
    db = _db(quiz_banks=[_COURSE_BANK])
    with patch.object(mod, "supabase_admin", db), pytest.raises(HTTPException):
        mod.get_bank_for_play("bank-course", user_id=None)


def test_a_failed_lookup_CLOSES_the_door():
    """Mở cửa khi chốt hỏng là biến một lỗi tạm thời thành một lần lộ nội dung."""
    db = _db(quiz_banks=[_COURSE_BANK])

    def boom(_name):
        raise RuntimeError("mất kết nối")
    db.table = lambda n: (_Table([_COURSE_BANK]) if n == "quiz_banks" else boom(n))
    with pytest.raises(HTTPException) as exc:
        _play(db)
    assert exc.value.status_code == 404


def test_a_vocab_bank_is_NOT_gated_by_assignments():
    """Chốt ngược: kho từ vựng vẫn là nội dung tự chọn, không được đòi bài giao."""
    db = _db(quiz_banks=[_VOCAB_BANK], quiz_questions=[])
    with patch.object(mod, "supabase_admin", db), \
         patch.object(mod, "_word_cards_for", lambda *_a, **_k: []), \
         patch.object(mod, "_attach_article_urls", lambda *_a, **_k: None), \
         patch.object(mod, "_resolve_question_audio", lambda *_a, **_k: None):
        out = mod.get_bank_for_play("bank-vocab", user_id="u1")
    assert out["bank"]["code"] == "V-01"


# ── Bài giao là cửa DUY NHẤT (không phải cửa THỨ HAI) ────────────────────────

_DRAFT_COURSE = {**_COURSE_BANK, "is_published": False}


def test_an_ASSIGNED_student_can_open_a_DRAFT_course_bank():
    """Bank theo buổi sống trong kho giáo viên ở trạng thái NHÁP và không bao giờ
    được xuất bản. Đòi thêm `is_published` sẽ khoá chết cả bài ĐÃ GIAO — giao
    xong mà học viên vẫn không mở được, và không có gì nói vì sao."""
    db = _db(
        quiz_banks=[_DRAFT_COURSE],
        quiz_questions=[{"id": "q1", "bank_id": "bank-course", "order": 0,
                         "type": "mcq", "item_key": "x"}],
        class_assignments=[_LIVE_ASG],
        students=[_STUDENT],
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1", "student_id": "st-1"}],
    )
    with patch.object(mod, "_word_cards_for", lambda *_a, **_k: []), \
         patch.object(mod, "_attach_article_urls", lambda *_a, **_k: None), \
         patch.object(mod, "_resolve_question_audio", lambda *_a, **_k: None):
        out = _play(db)
    assert out["bank"]["code"] == "C1-B01"


def test_a_DRAFT_course_bank_is_still_closed_WITHOUT_an_assignment():
    db = _db(quiz_banks=[_DRAFT_COURSE], class_assignments=[], students=[])
    with pytest.raises(HTTPException) as exc:
        _play(db)
    assert exc.value.status_code == 404


def test_a_DRAFT_vocab_bank_stays_closed():
    """Chốt ngược: bỏ `is_published` cho giáo trình KHÔNG được nới lỏng kho khác."""
    db = _db(quiz_banks=[{**_VOCAB_BANK, "is_published": False}])
    with patch.object(mod, "supabase_admin", db), pytest.raises(HTTPException) as exc:
        mod.get_bank_for_play("bank-vocab", user_id="u1")
    assert exc.value.status_code == 404


# ── Cổng phải nói CÙNG MỘT CÂU với lệnh mở bài ───────────────────────────────
#
# Thiếu ba chốt dưới đây thì một đường dẫn đã lưu bookmark còn trả về TOÀN BỘ câu
# hỏi kèm đáp án mãi mãi — kể cả sau khi bài giao bị lưu trữ, sau hạn nộp, hay
# sau khi em ấy đã chuyển lớp.

def _assigned(asg_over=None, stu_over=None):
    return _db(
        quiz_banks=[_COURSE_BANK],
        quiz_questions=[{"id": "q1", "bank_id": "bank-course", "order": 0,
                         "type": "mcq", "item_key": "x"}],
        class_assignments=[{**_LIVE_ASG, **(asg_over or {})}],
        students=[{**_STUDENT, **(stu_over or {})}],
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1", "student_id": "st-1"}],
    )


def test_an_ARCHIVED_assignment_closes_the_door():
    with pytest.raises(HTTPException) as exc:
        _play(_assigned({"status": "archived"}))
    assert exc.value.status_code == 404


def test_an_assignment_PAST_ITS_DEADLINE_closes_the_door():
    """Đề kèm đáp án. Để mở sau hạn nghĩa là phát đáp án cho bài vừa chốt sổ."""
    with pytest.raises(HTTPException) as exc:
        _play(_assigned({"due_at": "2020-01-01T00:00:00+00:00"}))
    assert exc.value.status_code == 404


def test_a_TRANSFERRED_student_loses_access():
    """Dòng mục bài tập CỐ Ý sống sót khi học viên chuyển lớp (để giữ lịch sử),
    nên chỉ dựa vào 'có dòng mục' là cho em ấy đọc tiếp bài của lớp cũ."""
    with pytest.raises(HTTPException) as exc:
        _play(_assigned(stu_over={"cohort_id": "co-KHAC"}))
    assert exc.value.status_code == 404


def test_a_SCHEDULED_assignment_is_not_open_yet():
    """`publish_at` là cổng hé màn (mig 177): mục được tạo sẵn lúc giao, nên
    không kiểm thì bài hẹn thứ Hai tuần sau mở được ngay hôm nay."""
    with pytest.raises(HTTPException) as exc:
        _play(_assigned({"publish_at": "2099-01-01T00:00:00+00:00"}))
    assert exc.value.status_code == 404


def test_a_LIVE_assignment_still_opens():
    """Chốt ngược: siết quá tay sẽ khoá cả bài đang mở."""
    with patch.object(mod, "_word_cards_for", lambda *_a, **_k: []), \
         patch.object(mod, "_attach_article_urls", lambda *_a, **_k: None), \
         patch.object(mod, "_resolve_question_audio", lambda *_a, **_k: None):
        assert _play(_assigned())["bank"]["code"] == "C1-B01"


# ── Hai cổng cho cùng một bank phải nói CÙNG MỘT CÂU ─────────────────────────

def _started(db, user_id="u1"):
    with patch.object(mod, "supabase_admin", db), \
         patch.object(mod, "get_resume", lambda **_k: {}):
        return mod.start_session(user_id=user_id, bank_id="bank-course")


def test_creating_a_session_uses_the_SAME_gate_as_reading_the_bank():
    """Trước đó `start_session` chỉ đòi `is_published`, nên bank giáo trình (luôn
    NHÁP) mở được ở lượt đọc đề nhưng 404 ở lượt TẠO PHIÊN: học viên vẫn làm bài
    được, mà không lượt nào được ghi và giáo viên đọc thành chưa làm.

    Ca phân biệt phải là bank NHÁP + CÓ bài giao. Dùng bank đã xuất bản thì bản
    hỏng cũng qua, và dùng bank nháp không bài giao thì cả hai đều 404 — chỉ khác
    lý do. (Phá-thử-ngược bắt được: cả hai ca đầu của tôi đều vô nghĩa.)"""
    db = _db(
        quiz_banks=[_DRAFT_COURSE],          # NHÁP — đúng như bank giáo trình thật
        class_assignments=[_LIVE_ASG],
        students=[_STUDENT],
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1", "student_id": "st-1"}],
    )
    out = _started(db)
    assert out["session_id"], "bài đã giao mà không tạo được phiên = không ghi được gì"


def test_creating_a_session_is_REFUSED_without_an_assignment():
    db = _db(quiz_banks=[_DRAFT_COURSE], class_assignments=[], students=[])
    with pytest.raises(HTTPException) as exc:
        _started(db)
    assert exc.value.status_code == 404


def test_the_session_REMEMBERS_which_assignment_item_made_it():
    """Suy ra "lượt này thuộc bài giao nào" từ thời điểm và người làm là một phép
    đoán — và phép đoán ấy đã sai đủ nhiều lần (mig 181) để không làm lại."""
    db = _db(
        quiz_banks=[_DRAFT_COURSE],
        class_assignments=[_LIVE_ASG], students=[_STUDENT],
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1", "student_id": "st-1"}],
    )
    _started(db)
    assert db.inserted, "không có phiên nào được ghi"
    assert db.inserted[-1].get("class_assignment_item_id") == "it-1"


def test_a_free_practice_session_has_NO_class_link():
    db = _db(quiz_banks=[_VOCAB_BANK])
    with patch.object(mod, "supabase_admin", db), \
         patch.object(mod, "get_resume", lambda **_k: {}):
        mod.start_session(user_id="u1", bank_id="bank-vocab")
    assert db.inserted[-1].get("class_assignment_item_id") is None


# ── Chốt sổ bài giao khi kết phiên ───────────────────────────────────────────

def _stage_db(*, stages_done, n_mcq=20, has_writing=False, **extra):
    """Bộ giả ĐỦ để luật "xong hết chặng" thật sự chạy.

    Không có `quiz_questions` thì `_course_stage_count` trả "không đếm được" và
    lệnh chốt sổ rơi vào nhánh cho-qua — chốt khi ấy xanh vì lý do SAI, và luật
    đang muốn kiểm thì không hề được chạy.
    """
    # Mỗi "chặng" là 10 câu, và luật là PHỦ ĐỦ CÂU — nên phiên phải kèm lượt
    # làm thật, không chỉ một dòng phiên.
    return _db(
        # `end_session` kiểm deadline từ quan hệ item → assignment trước
        # khi chốt. Fixture thiếu hai dòng này không còn mô phỏng một
        # quiz session của bài giao thật.
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1"}],
        class_assignments=[_LIVE_ASG],
        quiz_questions=[{"bank_id": "bank-course", "qid": f"q{i}", "type": "mcq",
                         "answer": 0} for i in range(n_mcq)]
        # Phần tự luận đặt bằng DỮ LIỆU, không bằng cách vá hàm: chắn nay đọc
        # nó từ chính bộ đề, nên vá một hàm không còn được gọi thì phép kiểm
        # đo một thứ không tồn tại.
        + ([{"bank_id": "bank-course", "qid": "w1", "type": "writing"}]
           if has_writing else []),
        quiz_sessions=[{"id": f"s{i}", "kind": "run", "ended_by": "completed",
                        "class_assignment_item_id": "it-1",
                        "ended_at": "2026-08-01T00:00:00Z"}
                       for i in range(stages_done)],
        quiz_attempts=[{"session_id": f"s{k}", "qid": f"q{k * 10 + n}"}
                       for k in range(stages_done) for n in range(10)],
        **extra,
    )


def _end(db, *, item_id="it-1", ended_by="completed", total=10, correct=8):
    marked = []
    sess = {"id": "sess-1", "user_id": "u1", "bank_id": "bank-course",
            "class_assignment_item_id": item_id}
    with patch.object(mod, "supabase_admin", db), \
         patch.object(mod, "_owned_session", lambda *_a, **_k: sess), \
         patch.object(mod, "mark_item_submitted",
                      lambda _db, **kw: marked.append(kw) or True):
        mod.end_session(user_id="u1", session_id="sess-1", data={
            "ended_by": ended_by, "total_questions": total,
            "total_correct": correct, "total_wrong": total - correct})
    return marked


def test_finishing_marks_the_class_item_SUBMITTED():
    """Không có bước này thì mục ở lại "opened" vĩnh viễn và bảng của giáo viên
    báo em ấy chưa nộp — trong khi em ấy vừa làm xong.

    Chỉ đúng với bộ đề KHÔNG có phần tự luận; xem chốt ngay dưới.
    """
    # 20 câu = 2 chặng, và cả hai đã chốt ⇒ XONG BÀI.
    marked = _end(_stage_db(stages_done=2))
    assert len(marked) == 1
    assert marked[0]["item_id"] == "it-1"
    assert marked[0]["artifact_kind"] == "quiz_session"
    assert marked[0]["score"] == 80.0


def test_a_free_practice_session_marks_NOTHING():
    assert _end(_db(quiz_sessions=[]), item_id=None) == []


def test_pausing_does_NOT_mark_it_submitted():
    """Dừng giữa chừng không phải nộp bài."""
    assert _end(_db(quiz_sessions=[]), ended_by="paused") == []


def test_a_failure_while_marking_does_NOT_break_ending_the_session():
    """Điểm đã ghi rồi; hỏng ở bước chốt sổ có thể vá bằng lượt đối chiếu, còn
    làm đổ lệnh kết phiên thì mất luôn con số."""
    def boom(_db, **_kw):
        raise RuntimeError("mất kết nối")
    sess = {"id": "sess-1", "user_id": "u1", "bank_id": "bank-course",
            "class_assignment_item_id": "it-1"}
    db = _db(
        quiz_sessions=[],
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1"}],
        class_assignments=[_LIVE_ASG],
    )
    with patch.object(mod, "supabase_admin", db), \
         patch.object(mod, "_owned_session", lambda *_a, **_k: sess), \
         patch.object(mod, "mark_item_submitted", boom):
        out = mod.end_session(user_id="u1", session_id="sess-1",
                              data={"ended_by": "completed", "total_questions": 10,
                                    "total_correct": 8, "total_wrong": 2})
    assert out


def test_a_bank_WITH_writing_is_not_closed_by_finishing_a_stage():
    """Xong chặng CHƯA PHẢI xong bài. `end_session` đóng dấu "đã nộp" ngay từ
    chặng ĐẦU TIÊN, nên một em làm hết 9 chặng rồi dừng trước phần viết vẫn hiện
    là đã hoàn thành — ca thật: em Phương Anh Nguyễn (9/9 chặng, 0 câu viết, sổ
    ghi `graded` 80 điểm), và giáo viên không có cách nào biết cần nhắc em ấy.

    Đường chốt sổ khi ấy là lượt NỘP TỰ LUẬN, không phải lượt kết chặng.
    """
    assert _end(_stage_db(stages_done=2, has_writing=True)) == []


def test_multisection_bank_is_never_closed_by_mcq_session_end():
    """MCQ đủ câu vẫn chỉ là MỘT phần của bài nhiều phần.

    `submitted_at` là bất biến và lần tải lại dùng nó để bật review-only, nên
    đường kết phiên legacy tuyệt đối không được gọi `mark_item_submitted` ở
    đây. Cổng hợp nhất sẽ chốt đúng một lần sau khi đủ mọi phần.
    """
    with patch.object(mod, "course_bank_is_multisection", return_value=True) as gate:
        marked = _end(_stage_db(stages_done=2))
    assert marked == []
    gate.assert_called_once_with("bank-course")


def test_finishing_ONE_of_TWO_stages_does_not_close_it():
    """Ca em Minh Ngoc Võ: 3/9 chặng mà sổ đã ghi "đã nộp" điểm 60. Vá lần một
    chỉ chắn bộ đề CÓ tự luận nên ca này vẫn lọt."""
    assert _end(_stage_db(stages_done=1)) == []
