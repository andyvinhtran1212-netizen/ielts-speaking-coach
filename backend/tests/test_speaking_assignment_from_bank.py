"""Giao bài Speaking lấy từ KHO ĐỀ, hạn nộp tuyệt đối.

Bốn thay đổi hành vi, mỗi cái đóng một lỗ mà bản cũ để mở:

  * **Đề chốt lúc GIAO, không sinh lúc học viên mở.** Trước đây câu hỏi được
    sinh khi học viên vào làm, nên hai em cùng một bài giao có thể trả lời hai
    bộ câu khác nhau và giáo viên không biết mình đã giao cái gì — câu hỏi "em
    ấy có làm đúng bài được giao không?" không có câu trả lời.

  * **Part 1/Part 3 giao bằng AUDIO, giấu chữ.** Câu chưa có bản đọc thì không
    giao được: học viên sẽ mở ra một bài không có gì để nghe và không có cách
    nào biết đề hỏi gì.

  * **Không giao trùng đề trong cùng lớp.** Giao lại nghĩa là bắt học viên trả
    lời lại đúng câu đã làm.

  * **Hạn nộp là tuyệt đối.** Quá hạn thì không nhận nữa — đó là thứ khiến bảng
    tổng kết đứng yên ngay khi hết hạn, thay vì còn đổi hàng giờ sau đó.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from routers import admin_class_assignments as mod
from services.class_assignment_service import (
    CLASS_TZ,
    DEFAULT_DUE_TIME,
    compose_due_at,
    is_accepting_submissions,
    is_assignment_open,
    parse_due_time,
)


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, rows):
        self._rows = list(rows)

    def select(self, *_a, **_k): return self
    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def in_(self, f, vals):
        # TÍCH LUỸ, không ghi đè: chuỗi .in_(a).in_(b) mà giữ mỗi cái cuối thì
        # một bộ lọc biến mất và test về truy vấn hai điều kiện thành vô nghĩa.
        self._rows = [r for r in self._rows if r.get(f) in vals]
        return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self

    def range(self, start, end):
        # _paged() đọc từng trang; cắt THẬT chứ không bỏ qua, nếu không một lỗi
        # phân trang sẽ không bao giờ lộ ra trong test.
        self._rows = self._rows[start:end + 1]
        return self

    def execute(self): return _Resp(self._rows)


def _q(qid, part, *, audio=True, order=0):
    return {"id": qid, "topic_id": "top-1", "is_active": True,
            "part": part, "order_num": order,
            "question_text": f"Câu {qid}",
            "audio_url": f"https://cdn/{qid}.mp3" if audio else None,
            "cue_card_bullets": None, "cue_card_reflection": None}


def _db(*, topic=None, questions=(), dupes=()):
    tables = {
        "topics": [topic] if topic else [],
        "topic_questions": list(questions),
        "class_assignments": list(dupes),
    }
    db = type("DB", (), {})()
    db.table = lambda n: _Table(tables.get(n, []))
    return db


_TOPIC = {"id": "top-1", "title": "Hometown", "part": 1, "is_active": True}


def _body(**over):
    kw = {"title": "Bài hôm nay", "topic": "Hometown", "content_id": "top-1",
          "part": 1, "mode": "practice"}
    kw.update(over)
    return mod.AssignmentCreate(**kw)


def _resolve(db, **over):
    with patch.object(mod, "supabase_admin", db):
        return mod._resolve_speaking_topic("co-1", _body(**over))


# ── chốt sẵn câu hỏi lúc giao ───────────────────────────────────────────


def test_part_1_pins_exactly_two_questions():
    """Đúng nhịp phòng thi: Part 1 là màn khởi động ngắn, không phải sáu câu."""
    db = _db(topic=_TOPIC, questions=[_q(f"q{i}", 1, order=i) for i in range(6)])
    _cid, cfg = _resolve(db)
    assert cfg["question_ids"] == ["q0", "q1"]


def test_part_3_pins_exactly_one_question():
    """Part 3 là MỘT câu bàn sâu."""
    t3 = dict(_TOPIC, part=3)
    db = _db(topic=t3, questions=[_q(f"q{i}", 3, order=i) for i in range(4)])
    _cid, cfg = _resolve(db, part=3)
    assert cfg["question_ids"] == ["q0"]


def test_part_2_pins_one_cue_card():
    db = _db(topic=dict(_TOPIC, part=2), questions=[_q("c1", 2)])
    _cid, cfg = _resolve(db, part=2)
    assert cfg["question_ids"] == ["c1"]


def test_the_ids_are_stored_so_editing_the_bank_cannot_change_homework():
    """Chốt id chứ không tra lại lúc mở: sửa kho đề sau đó không được làm đổi
    bài đã phát cho học viên."""
    db = _db(topic=_TOPIC, questions=[_q("q0", 1), _q("q1", 1, order=1)])
    _cid, cfg = _resolve(db)
    assert set(cfg["question_ids"]) == {"q0", "q1"}
    assert cfg["topic"] == "Hometown"        # nhãn hiển thị
    assert cfg["part"] == 1


def test_a_topic_without_enough_questions_is_refused():
    db = _db(topic=_TOPIC, questions=[_q("q0", 1)])       # cần 2, chỉ có 1
    with pytest.raises(Exception) as exc:
        _resolve(db)
    assert getattr(exc.value, "status_code", None) == 400
    assert "cần 2" in str(getattr(exc.value, "detail", ""))


def test_an_unknown_topic_is_a_404():
    with pytest.raises(Exception) as exc:
        _resolve(_db(topic=None))
    assert getattr(exc.value, "status_code", None) == 404


def test_a_disabled_topic_is_refused():
    db = _db(topic=dict(_TOPIC, is_active=False), questions=[_q("q0", 1), _q("q1", 1)])
    with pytest.raises(Exception) as exc:
        _resolve(db)
    assert getattr(exc.value, "status_code", None) == 400


# ── Part 1/3 KHÔNG giao được nếu chưa có bản đọc đề ─────────────────────


@pytest.mark.parametrize("part,want", [(1, 2), (3, 1)])
def test_a_question_without_audio_cannot_be_given(part, want):
    """Học viên sẽ mở ra một bài không có gì để nghe, và vì chữ bị giấu nên
    không có cách nào biết đề hỏi gì."""
    qs = [_q(f"q{i}", part, order=i, audio=(i != 0)) for i in range(3)]
    db = _db(topic=dict(_TOPIC, part=part), questions=qs)
    with pytest.raises(Exception) as exc:
        _resolve(db, part=part)
    assert getattr(exc.value, "status_code", None) == 400
    assert "audio" in str(getattr(exc.value, "detail", "")).lower()


def test_part_2_does_not_need_audio():
    """Part 2 hiện cue card — đọc bằng mắt là đúng cách của phần thi này."""
    db = _db(topic=dict(_TOPIC, part=2), questions=[_q("c1", 2, audio=False)])
    _cid, cfg = _resolve(db, part=2)
    assert cfg["question_ids"] == ["c1"]


# ── không giao trùng đề trong cùng lớp ──────────────────────────────────


def test_the_same_topic_cannot_be_given_to_one_class_twice():
    db = _db(topic=_TOPIC, questions=[_q("q0", 1), _q("q1", 1, order=1)],
             dupes=[{"id": "asg-old", "cohort_id": "co-1", "skill": "speaking",
                     "content_id": "top-1", "title": "Bài tuần trước"}])
    with pytest.raises(Exception) as exc:
        _resolve(db)
    assert getattr(exc.value, "status_code", None) == 409
    detail = str(getattr(exc.value, "detail", ""))
    assert "Hometown" in detail and "Bài tuần trước" in detail, (
        "admin phải biết ĐỀ NÀO và BÀI GIAO NÀO đã dùng nó, không chỉ 'trùng'"
    )


def test_the_same_topic_in_a_DIFFERENT_class_is_fine():
    db = _db(topic=_TOPIC, questions=[_q("q0", 1), _q("q1", 1, order=1)],
             dupes=[{"id": "asg-old", "cohort_id": "co-KHAC", "skill": "speaking",
                     "content_id": "top-1", "title": "x"}])
    _cid, cfg = _resolve(db)
    assert cfg["question_ids"] == ["q0", "q1"]


# ── giờ hạn admin đặt được ──────────────────────────────────────────────


def test_the_deadline_hour_defaults_to_seven_in_the_evening():
    assert parse_due_time(None) == DEFAULT_DUE_TIME == time(19, 0)


def test_an_admin_can_move_the_deadline_hour():
    """Lớp học buổi tối cần hạn khác lớp học buổi sáng; cho tới nay giờ này bị
    đóng cứng trong backend nên không lớp nào đổi được."""
    assert parse_due_time("21:30") == time(21, 30)
    assert compose_due_at("2026-08-10", parse_due_time("21:30")) == \
        datetime(2026, 8, 10, 21, 30, tzinfo=CLASS_TZ).isoformat()


def test_a_malformed_hour_is_refused_not_silently_defaulted():
    """Rơi về 19:00 sẽ đặt một hạn mà admin không hề chọn, và họ chỉ phát hiện
    khi học viên bị chặn nộp."""
    for bad in ("25:00", "abc", "7pm", "19"):
        with pytest.raises(ValueError):
            parse_due_time(bad)


# ── hạn nộp TUYỆT ĐỐI ───────────────────────────────────────────────────


def _asg(**over):
    a = {"id": "a1", "status": "published", "publish_at": None,
         "due_at": "2026-08-10T19:00:00+07:00"}
    a.update(over)
    return a


_BEFORE = datetime(2026, 8, 10, 11, 0, tzinfo=timezone.utc)   # 18:00 giờ VN
_AFTER = datetime(2026, 8, 10, 13, 0, tzinfo=timezone.utc)    # 20:00 giờ VN


def test_before_the_deadline_submissions_are_accepted():
    assert is_accepting_submissions(_asg(), now=_BEFORE) is True


def test_after_the_deadline_submissions_are_refused():
    assert is_accepting_submissions(_asg(), now=_AFTER) is False


def test_the_task_is_still_VISIBLE_after_the_deadline():
    """Chốt tách khỏi is_assignment_open có chủ ý: bài quá hạn phải CÒN trên
    danh sách, ghi là bỏ lỡ. Gộp hai thứ sẽ làm bài hôm qua biến mất, đọc ra
    thành 'em chưa từng có bài đó' thay vì 'em đã bỏ lỡ'."""
    assert is_assignment_open(_asg(), now=_AFTER) is True


def test_a_give_with_no_deadline_never_lapses():
    assert is_accepting_submissions(_asg(due_at=None), now=_AFTER) is True


def test_an_unreadable_deadline_closes_rather_than_opens():
    """Rơi về 'không có hạn' sẽ lặng lẽ mở lại đúng cái cửa sổ chốt này sinh ra
    để đóng."""
    assert is_accepting_submissions(_asg(due_at="hôm nào đó"), now=_BEFORE) is False


def test_an_archived_give_is_refused_whatever_the_clock_says():
    assert is_accepting_submissions(_asg(status="archived"), now=_BEFORE) is False


def test_the_boundary_second_still_counts():
    """Đúng 19:00:00 vẫn nhận — hạn là 'đến 19:00', không phải 'trước 19:00'."""
    at = datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc)    # 19:00 giờ VN chằn
    assert is_accepting_submissions(_asg(), now=at) is True
    assert is_accepting_submissions(
        _asg(), now=at + timedelta(seconds=1)) is False


# ── dây nối: chốt phải được GỌI ở đúng chỗ, không chỉ tồn tại ───────────


@pytest.mark.asyncio
async def test_start_refuses_a_lapsed_task_with_409_not_404():
    """409, không phải 404: bài tập có thật và là của em ấy — nó chỉ hết hạn.
    Nói "không tìm thấy" trong khi em đang nhìn thẳng vào nó trên danh sách thì
    đọc ra như một lỗi phần mềm."""
    from routers import class_student as cs

    lapsed = _asg(due_at="2020-01-01T19:00:00+07:00")

    class _T:
        def __init__(self, rows): self._rows = list(rows)
        def select(self, *_a, **_k): return self
        def eq(self, f, v):
            self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
            return self
        def limit(self, *_a): return self
        def update(self, _p): return self
        def execute(self): return _Resp(self._rows)

    tables = {
        "class_assignment_items": [{"id": "item-1", "student_id": "s1",
                                    "assignment_id": "a1", "state": "assigned"}],
        "class_assignments": [dict(lapsed, cohort_id="c1", skill="speaking",
                                   content_config={})],
    }
    db = type("DB", (), {})()
    db.table = lambda n: _T(tables.get(n, []))

    with patch.object(cs, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(cs, "_student_for_user",
                      return_value={"id": "s1", "cohort_id": "c1"}), \
         patch.object(cs, "supabase_admin", db):
        with pytest.raises(Exception) as exc:
            await cs.start_assignment("item-1", None)

    assert getattr(exc.value, "status_code", None) == 409
    assert "quá hạn" in str(getattr(exc.value, "detail", "")).lower()


def test_a_speaking_hand_in_after_the_deadline_is_not_credited():
    """Phiên vẫn hoàn tất và vẫn được chấm — em ấy giữ bài luyện và nhận xét.
    Thứ bị từ chối là GHI NÓ vào sổ như bài nộp của lớp.

    Chốt lúc bắt đầu không tự nó đủ: không ai biết trước một câu trả lời mất bao
    lâu, nên phiên mở lúc 18:58 có thể kết thúc lúc 19:02."""
    from routers import sessions as sm

    lapsed = _asg(due_at="2020-01-01T19:00:00+07:00")

    class _T:
        def __init__(self, rows): self._rows = list(rows)
        def select(self, *_a, **_k): return self
        def eq(self, *_a): return self
        def limit(self, *_a): return self
        def execute(self): return _Resp(self._rows)

    db = type("DB", (), {})()
    db.table = lambda _n: _T([lapsed])
    wrote = []

    with patch.object(sm, "supabase_admin", db), \
         patch.object(sm, "mark_item_submitted",
                      lambda *a, **k: wrote.append(k) or True):
        out = sm._record_class_submission(
            {"id": "sess-1", "class_assignment_item_id": "item-1",
             "completed_at": "2026-08-03T11:00:00+00:00"})

    assert out is False
    assert wrote == [], "không được ghi vào sổ cái sau hạn"


def test_a_lookup_failure_does_not_refuse_a_real_hand_in():
    """Fail OPEN ở đây: từ chối MỌI bài nộp vì một truy vấn trục trặc là làm mất
    công thật, còn một bài lỡ nhận thì hiện ra là nộp trễ chứ không biến mất."""
    from routers import sessions as sm

    class _Boom:
        def table(self, _n): raise RuntimeError("boom")

    wrote = []
    with patch.object(sm, "supabase_admin", _Boom()), \
         patch.object(sm, "mark_item_submitted",
                      lambda *a, **k: wrote.append(k) or True):
        out = sm._record_class_submission(
            {"id": "sess-1", "class_assignment_item_id": "item-1"})

    assert out is True and len(wrote) == 1


# ── kho đề cho ô chọn của admin ─────────────────────────────────────────


class _TopicsDB:
    def __init__(self, topics, questions, given):
        self._t, self._q, self._g = topics, questions, given

    def table(self, name):
        rows = {"topics": self._t, "topic_questions": self._q,
                "class_assignments": self._g}.get(name, [])
        return _Table(rows)


def _topics_db(*, n_questions=6, n_audio=6, given=()):
    topics = [{"id": f"t{i}", "title": f"Chủ đề {i}", "part": 1, "is_active": True}
              for i in range(3)]
    qs = []
    for t in topics:
        for k in range(n_questions):
            qs.append({"topic_id": t["id"], "part": 1, "is_active": True,
                       "audio_url": "https://cdn/x.mp3" if k < n_audio else None})
    gv = [{"cohort_id": "co-1", "skill": "speaking", "content_id": g} for g in given]
    return _TopicsDB(topics, qs, gv)


async def _topics(db, part=1):
    with patch.object(mod, "require_admin", AsyncMock(return_value={"id": "a"})), \
         patch.object(mod, "_require_cohort", lambda _c: None), \
         patch.object(mod, "supabase_admin", db):
        return await mod.list_speaking_topics("co-1", part=part, authorization=None)


@pytest.mark.asyncio
async def test_a_topic_with_enough_voiced_questions_is_offered():
    out = await _topics(_topics_db())
    assert all(i["ready"] for i in out["items"])
    assert out["questions_per_give"] == 2


@pytest.mark.asyncio
async def test_a_topic_already_given_to_this_class_is_flagged():
    out = await _topics(_topics_db(given=("t1",)))
    flags = {i["id"]: i["already_given"] for i in out["items"]}
    assert flags == {"t0": False, "t1": True, "t2": False}


@pytest.mark.asyncio
async def test_missing_audio_is_reported_SEPARATELY_from_already_given():
    """Hai lý do khác hẳn nhau và admin làm được hai việc khác nhau: đã giao rồi
    là việc XONG; chưa có bản đọc đề là việc CHƯA làm — chạy mẻ render là dùng
    được. Gộp vào một chữ 'không khả dụng' sẽ giấu mất một việc đang chờ."""
    out = await _topics(_topics_db(n_audio=1))          # cần 2, chỉ 1 câu có audio
    for i in out["items"]:
        assert i["ready"] is False
        assert i["missing_audio"] is True
        assert i["already_given"] is False


@pytest.mark.asyncio
async def test_a_topic_with_too_few_questions_is_not_ready_but_not_blamed_on_audio():
    out = await _topics(_topics_db(n_questions=1, n_audio=1))
    for i in out["items"]:
        assert i["ready"] is False
        assert i["missing_audio"] is False, "thiếu CÂU, không phải thiếu audio"


@pytest.mark.asyncio
async def test_part_2_does_not_require_audio_to_be_ready():
    """Part 2 là cue card — đọc bằng mắt."""
    db = _topics_db(n_questions=1, n_audio=0)
    for t in db._t:
        t["part"] = 2
    for q in db._q:
        q["part"] = 2
    out = await _topics(db, part=2)
    assert all(i["ready"] for i in out["items"])


# ── bảng tổng kết: trạng thái là SUY RA, không lưu ──────────────────────


class _TallyDB:
    def __init__(self, items, students, assignment):
        self._i, self._s, self._a = items, students, assignment

    def table(self, name):
        return _Table({"class_assignment_items": self._i, "students": self._s,
                       "class_assignments": [self._a]}.get(name, []))


def _tally_db(items, *, due="2026-08-03T19:00:00+07:00", students=None):
    a = {"id": "asg-1", "cohort_id": "co-1", "title": "Bài hôm nay",
         "skill": "speaking", "due_at": due, "status": "published"}
    st = students or [
        {"id": f"s{i}", "cohort_id": "co-1", "full_name": f"HV {i}",
         "student_code": f"S{i}", "user_id": f"u{i}"} for i in range(len(items))
    ]
    return _TallyDB(items, st, a)


def _item(sid, submitted_at=None, score=None):
    return {"id": f"i-{sid}", "assignment_id": "asg-1", "student_id": sid,
            "submitted_at": submitted_at, "score": score, "state": "assigned"}


async def _tally(db):
    with patch.object(mod, "require_admin", AsyncMock(return_value={"id": "a"})), \
         patch.object(mod, "_require_cohort", lambda _c: None), \
         patch.object(mod, "reconcile_ledger_from_sessions", lambda *a: 0), \
         patch.object(mod, "reconcile_test_attempts", lambda *a: 0), \
         patch.object(mod, "supabase_admin", db):
        return await mod.assignment_tally("co-1", "asg-1", None)


@pytest.mark.asyncio
async def test_after_the_deadline_the_tally_is_sealed():
    """Không có bảng lưu sẵn: sau hạn hệ thống không nhận bài nữa, nên trạng thái
    suy ra từ submitted_at vs due_at ĐÃ đứng yên. 'Chốt' là một sự thật về thời
    gian, không phải một bản ghi phải chụp lại."""
    db = _tally_db([_item("s0")], due="2020-01-01T19:00:00+07:00")
    out = await _tally(db)
    assert out["sealed"] is True
    assert out["students"][0]["status"] == "missing"


@pytest.mark.asyncio
async def test_before_the_deadline_nobody_is_missing_yet():
    """Chưa tới hạn thì 'chưa nộp' không phải một lỗi."""
    db = _tally_db([_item("s0")], due="2099-01-01T19:00:00+07:00")
    out = await _tally(db)
    assert out["sealed"] is False
    assert out["students"][0]["status"] == "pending"


@pytest.mark.asyncio
async def test_a_hand_in_after_the_deadline_reads_as_late():
    db = _tally_db([_item("s0", "2026-08-03T13:00:00+00:00", 6.0)])   # 20:00 VN
    out = await _tally(db)
    assert out["students"][0]["status"] == "late"
    assert out["counts"]["late"] == 1
    assert out["counts"]["submitted"] == 1, "nộp trễ VẪN là đã nộp"


@pytest.mark.asyncio
async def test_a_student_with_no_account_is_not_counted_as_missing():
    """Em ấy CHƯA TỪNG thấy bài. Gộp vào 'không nộp' là nhắc nhầm người."""
    db = _tally_db([_item("s0")], due="2020-01-01T19:00:00+07:00",
                   students=[{"id": "s0", "cohort_id": "co-1", "full_name": "A",
                              "student_code": "S0", "user_id": None}])
    out = await _tally(db)
    assert out["students"][0]["status"] == "no-account"
    assert out["counts"]["missing"] == 0
    assert out["counts"]["no_account"] == 1


@pytest.mark.asyncio
async def test_the_unsubmitted_come_first():
    """Đây là danh sách việc cần làm của giáo viên, không phải bảng điểm."""
    db = _tally_db([
        _item("s0", "2026-08-03T11:00:00+00:00", 6.5),
        _item("s1"),
        _item("s2", "2026-08-03T11:00:00+00:00", 7.0),
    ], due="2020-01-01T19:00:00+07:00")
    out = await _tally(db)
    assert out["students"][0]["status"] == "missing"


@pytest.mark.asyncio
async def test_a_give_from_another_class_is_a_404():
    db = _tally_db([_item("s0")])
    db._a["cohort_id"] = "co-KHAC"
    with pytest.raises(Exception) as exc:
        await _tally(db)
    assert getattr(exc.value, "status_code", None) == 404


# ── hai màn hình admin phải nói CÙNG một con số ─────────────────────────


def test_the_list_counts_unactivated_students_the_same_way_the_tally_does():
    """Nếp lỗi đã ghi: "nguồn số liệu của tôi có trùng với màn khác không?".
    Bảng tổng kết tách riêng học viên chưa kích hoạt tài khoản. Nếu danh sách
    bài giao gộp nhóm đó vào "chưa nộp, đã quá hạn" thì cùng một bài giao hiện
    hai con số khác nhau ở hai chỗ, và giáo viên đi nhắc nhầm người."""
    from services.class_assignment_service import progress_for_assignments

    items = [
        {"id": "i0", "assignment_id": "a1", "student_id": "s0",
         "submitted_at": "2026-08-03T11:00:00+00:00"},
        {"id": "i1", "assignment_id": "a1", "student_id": "s1", "submitted_at": None},
        {"id": "i2", "assignment_id": "a1", "student_id": "s2", "submitted_at": None},
    ]
    students = [
        {"id": "s0", "user_id": "u0"},
        {"id": "s1", "user_id": "u1"},
        {"id": "s2", "user_id": None},          # chưa kích hoạt
    ]
    db = _TallyDB(items, students, {})
    p = progress_for_assignments(
        db, [{"id": "a1", "due_at": "2020-01-01T19:00:00+07:00"}])["a1"]

    assert p["submitted"] == 1
    assert p["missing"] == 1, "chỉ em CÓ tài khoản mà không nộp mới là bỏ bài"
    assert p["no_account"] == 1
    assert p["assigned"] == p["submitted"] + p["missing"] + p["no_account"], (
        "tổng phải khớp sĩ số — đánh rơi một nhóm khỏi mọi ô đếm còn tệ hơn"
    )


def test_a_failed_student_lookup_falls_back_to_the_old_behaviour():
    """Thà đếm rộng hơn còn hơn im lặng đánh rơi khỏi mọi ô và làm tổng lệch."""
    from services.class_assignment_service import progress_for_assignments

    class _Boom(_TallyDB):
        def table(self, name):
            if name == "students":
                raise RuntimeError("boom")
            return super().table(name)

    items = [{"id": "i0", "assignment_id": "a1", "student_id": "s0",
              "submitted_at": None}]
    db = _Boom(items, [{"id": "s0", "user_id": None}], {})
    p = progress_for_assignments(
        db, [{"id": "a1", "due_at": "2020-01-01T19:00:00+07:00"}])["a1"]
    assert p["missing"] == 1 and p["no_account"] == 0
    assert p["assigned"] == 1


# ── hạn nộp phải TUYỆT ĐỐI kể cả ở đường vá sổ ──────────────────────────
#
# Chốt lúc ghi nhận từ chối một phiên hoàn thành sau hạn. Nếu đường vá sổ ghi
# giúp thì lời từ chối kia vô nghĩa: em ấy bắt đầu trước hạn, nộp sau hạn, và
# lần đọc tiếp theo của giáo viên sẽ khôi phục. Bảng tổng kết đứng yên được là
# nhờ CẢ HAI chỗ cùng từ chối.


def _repair_db(*, submitted_at, due="2026-08-03T19:00:00+07:00", table="reading_test_attempts"):
    from tests.test_class_assignment_service import _DB
    return _DB({
        "class_assignment_items": [
            {"id": "item-1", "assignment_id": "asg-1", "student_id": "stu-1",
             "submitted_at": None, "state": "assigned"},
        ],
        "students": [{"id": "stu-1", "user_id": "user-1"}],
        table: [{"id": "att-1", "class_assignment_item_id": "item-1",
                 "submitted_at": submitted_at, "band_estimate": 6.0,
                 "status": "submitted"}],
    }), {"id": "asg-1", "skill": "reading", "content_id": "t1",
         "status": "published", "cohort_id": "co-1", "due_at": due}


def test_the_repair_pass_refuses_an_attempt_submitted_after_the_deadline():
    from services.class_assignment_service import reconcile_test_attempts
    db, asg = _repair_db(submitted_at="2026-08-03T13:00:00+00:00")   # 20:00 VN
    assert reconcile_test_attempts(db, [asg]) == 0
    assert db.tables["class_assignment_items"][0].get("submitted_at") is None


def test_the_repair_pass_still_records_one_made_before_the_deadline():
    from services.class_assignment_service import reconcile_test_attempts
    db, asg = _repair_db(submitted_at="2026-08-03T11:00:00+00:00")   # 18:00 VN
    assert reconcile_test_attempts(db, [asg]) == 1


def test_a_give_with_no_deadline_is_repaired_whenever():
    from services.class_assignment_service import reconcile_test_attempts
    db, asg = _repair_db(submitted_at="2030-01-01T00:00:00+00:00", due=None)
    assert reconcile_test_attempts(db, [asg]) == 1


def test_the_session_repair_pass_also_refuses_a_late_completion():
    """`_record_class_submission` đã từ chối ghi một phiên hoàn thành sau hạn.
    Nếu đường vá sổ này ghi giúp thì lời từ chối kia vô nghĩa — và bảng tổng kết
    lại đổi sau khi đã chốt."""
    from services.class_assignment_service import reconcile_ledger_from_sessions
    from tests.test_class_assignment_service import _DB

    def _db(completed_at):
        return _DB({
            "class_assignment_items": [
                {"id": "item-1", "assignment_id": "asg-1", "student_id": "stu-1",
                 "submitted_at": None, "state": "assigned"},
            ],
            "class_assignments": [
                {"id": "asg-1", "due_at": "2026-08-03T19:00:00+07:00"},
            ],
            "sessions": [
                {"id": "sess-1", "class_assignment_item_id": "item-1",
                 "status": "completed", "completed_at": completed_at,
                 "overall_band": 6.0},
            ],
        })

    late = _db("2026-08-03T13:00:00+00:00")                # 20:00 giờ VN
    assert reconcile_ledger_from_sessions(late, ["asg-1"]) == 0
    assert late.tables["class_assignment_items"][0].get("submitted_at") is None

    on_time = _db("2026-08-03T11:00:00+00:00")             # 18:00 giờ VN
    assert reconcile_ledger_from_sessions(on_time, ["asg-1"]) == 1


# ── bản chụp đề KHÔNG được xuống trình duyệt học viên ───────────────────
#
# Bản vá vòng 1 (chụp nội dung đề vào content_config) đã VÔ TÌNH mở lại đúng cái
# lỗ mà bản vá cùng vòng vừa bịt: `_decorate` trả nguyên cả content_config, nên
# học viên đọc được đề ngay trong phản hồi đầu tiên của trang lớp.


def test_the_prompt_snapshot_never_reaches_the_student():
    from routers.class_student import _display_config

    cfg = {
        "topic": "Hometown", "mode": "practice", "part": 1,
        "question_ids": ["q1", "q2"],
        "questions": [{"id": "q1", "question_text": "Where do you live?",
                       "cue_card_bullets": ["a"], "audio_url": "https://cdn/a.mp3"}],
    }
    out = _display_config(cfg)
    assert out == {"topic": "Hometown", "mode": "practice", "part": 1}
    assert "questions" not in out, "bản chụp chứa nguyên văn câu hỏi"
    assert "question_ids" not in out, "id đủ để tra ra câu hỏi"


def test_it_is_an_ALLOW_list_so_new_fields_do_not_leak_by_default():
    """Danh sách loại-trừ thì mỗi trường thêm vào bản chụp sau này sẽ lọt cho tới
    khi có người nhớ ra phải chặn nó. Danh sách cho-phép thì mặc định là an toàn."""
    from routers.class_student import _display_config

    out = _display_config({"topic": "x", "bí_mật_mới": "lộ mất"})
    assert out == {"topic": "x"}


def test_a_reading_give_keeps_its_display_label():
    from routers.class_student import _display_config
    assert _display_config({"test_title": "Cam 19 Test 3"}) == {"test_title": "Cam 19 Test 3"}


def test_an_empty_or_missing_config_is_an_empty_dict():
    from routers.class_student import _display_config
    assert _display_config(None) == {} and _display_config({}) == {}


# ── hết hạn giữa chừng phải là 409, không phải 500 ──────────────────────


def test_all_three_creation_routes_catch_the_deadline_error():
    """Hạn có thể trôi qua GIỮA lúc trang lớp gọi /start và lúc trang đề tạo lượt
    làm bài. Không bắt thì học viên nhận 500 — đọc ra là lỗi hệ thống chứ không
    phải "em hết giờ rồi"."""
    import inspect
    import re
    from routers import listening, reading_student, sessions

    for mod in (listening, reading_student, sessions):
        src = re.sub(r"#[^\n]*", "", inspect.getsource(mod))
        m = re.search(r"except DeadlinePassedError[\s\S]{0,200}?HTTPException\(\s*409", src)
        assert m, f"{mod.__name__} chưa map DeadlinePassedError → 409"


# ── danh sách "sẵn sàng" phải khớp lệnh giao ────────────────────────────


@pytest.mark.asyncio
async def test_readiness_uses_the_SAME_prefix_the_give_will_select():
    """Lệnh giao lấy `want` câu ĐẦU theo order_num. Nếu danh sách chỉ đếm tổng số
    câu có audio thì một chủ đề mà câu 1 chưa render xong nhưng câu 3-4 đã có sẽ
    hiện "sẵn sàng" — admin chọn rồi bị 400."""
    topics = [{"id": "t0", "title": "T", "part": 1, "is_active": True}]
    qs = [
        {"topic_id": "t0", "part": 1, "is_active": True, "order_num": 0, "audio_url": None},
        {"topic_id": "t0", "part": 1, "is_active": True, "order_num": 1, "audio_url": None},
        {"topic_id": "t0", "part": 1, "is_active": True, "order_num": 2, "audio_url": "https://cdn/a.mp3"},
        {"topic_id": "t0", "part": 1, "is_active": True, "order_num": 3, "audio_url": "https://cdn/b.mp3"},
    ]
    out = await _topics(_TopicsDB(topics, qs, []))
    item = out["items"][0]
    assert item["ready"] is False, "hai câu ĐẦU chưa có audio"
    assert item["missing_audio"] is True


@pytest.mark.asyncio
async def test_a_voiced_prefix_is_ready_even_if_later_questions_are_not():
    """Ngược lại: câu 3-4 chưa render không cản gì, vì lệnh giao không lấy chúng."""
    topics = [{"id": "t0", "title": "T", "part": 1, "is_active": True}]
    qs = [
        {"topic_id": "t0", "part": 1, "is_active": True, "order_num": 0, "audio_url": "https://cdn/a.mp3"},
        {"topic_id": "t0", "part": 1, "is_active": True, "order_num": 1, "audio_url": "https://cdn/b.mp3"},
        {"topic_id": "t0", "part": 1, "is_active": True, "order_num": 2, "audio_url": None},
    ]
    out = await _topics(_TopicsDB(topics, qs, []))
    assert out["items"][0]["ready"] is True


def test_the_wire_is_connected_not_just_the_helper():
    """Ghim hàm lọc mà không ghim CHỖ GỌI thì bỏ dây nối đi test vẫn xanh —
    đúng cái đã xảy ra: `_display_config` có test, nhưng `_decorate` vẫn có thể
    trả thẳng content_config."""
    from datetime import datetime, timezone

    from routers.class_student import _decorate

    item = {"id": "i1", "state": "assigned", "submitted_at": None, "score": None}
    assignment = {
        "id": "a1", "title": "Bài", "skill": "speaking", "instructions": None,
        "due_at": "2026-08-03T19:00:00+07:00",
        "content_config": {
            "topic": "Hometown", "mode": "practice", "part": 1,
            "question_ids": ["q1"],
            "questions": [{"id": "q1", "question_text": "Where do you live?"}],
        },
    }
    out = _decorate(item, assignment, datetime(2026, 8, 3, 10, tzinfo=timezone.utc))
    cfg = out["assignment"]["content_config"]
    assert "questions" not in cfg and "question_ids" not in cfg
    assert "Where do you live?" not in str(out), (
        "nguyên văn câu hỏi không được xuất hiện ở BẤT KỲ đâu trong payload"
    )


# ── bài tập lớp: không ai được thay đề đã giao ──────────────────────────


@pytest.mark.asyncio
async def test_a_class_session_cannot_have_custom_questions_saved_into_it():
    """Endpoint tự-nhập-câu cho phép chủ phiên chèn câu bất kỳ. Với phiên đã gắn
    bài tập lớp, học viên có thể thay đề được giao bằng một câu dễ CÓ CHỮ rồi vẫn
    được ghi nhận đã làm bài — mà chứng minh "em ấy làm ĐÚNG bài được giao" là
    toàn bộ giá trị của sổ cái này."""
    from unittest.mock import AsyncMock
    from routers import questions as qmod

    class _T:
        def __init__(self, rows): self._rows = list(rows)
        def select(self, *_a, **_k): return self
        def eq(self, f, v):
            self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
            return self
        def limit(self, *_a): return self
        def execute(self): return _Resp(self._rows)

    db = type("DB", (), {})()
    db.table = lambda _n: _T([{"id": "sess-1", "part": 1, "user_id": "u1",
                               "class_assignment_item_id": "item-1"}])

    with patch.object(qmod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(qmod, "supabase_admin", db):
        with pytest.raises(Exception) as exc:
            await qmod.save_custom_questions(
                "sess-1", qmod._CustomQBody(questions=["Câu dễ?"]), None)
    assert getattr(exc.value, "status_code", None) == 403


def test_the_fast_path_verifies_the_rows_are_the_pinned_set():
    """"Phiên đã có câu" KHÔNG đồng nghĩa "câu ấy do chúng ta đặt vào". Không
    kiểm thì mọi đường ghi khác vào bảng questions đều thành cửa sau."""
    from routers import questions as qmod

    class _T:
        def __init__(self, rows): self._rows = list(rows)
        def select(self, *_a, **_k): return self
        def eq(self, f, v):
            self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
            return self
        def limit(self, *_a): return self
        def execute(self): return _Resp(self._rows)

    snap = [{"id": "q1", "question_text": "Đề được giao?"}]
    tables = {
        "class_assignment_items": [{"id": "item-1", "assignment_id": "asg-1"}],
        "class_assignments": [{"id": "asg-1", "skill": "speaking",
                               "content_config": {"question_ids": ["q1"],
                                                  "questions": snap}}],
    }
    db = type("DB", (), {})()
    db.table = lambda n: _T(tables.get(n, []))
    session = {"id": "sess-1", "class_assignment_item_id": "item-1"}

    with patch.object(qmod, "supabase_admin", db):
        # đúng bộ → im lặng đi qua
        qmod._assert_pinned_set_intact(session, [{"question_text": "Đề được giao?"}])
        # bị thay → chặn
        with pytest.raises(Exception) as exc:
            qmod._assert_pinned_set_intact(session, [{"question_text": "Câu dễ tự nhập?"}])
    assert getattr(exc.value, "status_code", None) == 409


def test_a_free_practice_session_is_not_touched_by_the_check():
    from routers import questions as qmod
    qmod._assert_pinned_set_intact({"id": "s"}, [{"question_text": "bất kỳ"}])


# ── thử lại phải so với GIỜ PHIÊN, không phải giờ chạy lệnh sửa ─────────


def test_a_retry_after_the_deadline_still_records_an_ON_TIME_session():
    """Lệnh ghi sổ lần đầu hỏng thì lần hoàn thành sau gọi lại. So với "bây giờ"
    nghĩa là phiên xong lúc 18:00 mà thử lại lúc 20:00 sẽ bị từ chối — chốt hạn
    quay sang chặn đúng thứ nó sinh ra để bảo vệ."""
    from routers import sessions as sm

    class _T:
        def __init__(self, rows): self._rows = list(rows)
        def select(self, *_a, **_k): return self
        def eq(self, *_a): return self
        def limit(self, *_a): return self
        def execute(self): return _Resp(self._rows)

    db = type("DB", (), {})()
    db.table = lambda _n: _T([{"id": "asg-1", "status": "published",
                               "publish_at": None,
                               "due_at": "2026-08-03T19:00:00+07:00"}])
    wrote = []
    with patch.object(sm, "supabase_admin", db), \
         patch.object(sm, "mark_item_submitted",
                      lambda *a, **k: wrote.append(k) or True):
        out = sm._record_class_submission({
            "id": "sess-1", "class_assignment_item_id": "item-1",
            "completed_at": "2026-08-03T11:00:00+00:00",       # 18:00 VN, đúng hạn
        })
    assert out is True and len(wrote) == 1


def test_a_session_actually_completed_late_is_still_refused():
    """Mốc so là giờ của chính phiên đó, nên nới cho đường thử lại KHÔNG mở cửa
    cho bài nộp thật sự trễ."""
    from routers import sessions as sm

    class _T:
        def __init__(self, rows): self._rows = list(rows)
        def select(self, *_a, **_k): return self
        def eq(self, *_a): return self
        def limit(self, *_a): return self
        def execute(self): return _Resp(self._rows)

    db = type("DB", (), {})()
    db.table = lambda _n: _T([{"id": "asg-1", "status": "published",
                               "publish_at": None,
                               "due_at": "2026-08-03T19:00:00+07:00"}])
    wrote = []
    with patch.object(sm, "supabase_admin", db), \
         patch.object(sm, "mark_item_submitted",
                      lambda *a, **k: wrote.append(k) or True):
        out = sm._record_class_submission({
            "id": "sess-1", "class_assignment_item_id": "item-1",
            "completed_at": "2026-08-03T13:00:00+00:00",       # 20:00 VN, trễ
        })
    assert out is False and wrote == []


# ── bảng tổng kết giữ được học viên đã chuyển lớp ──────────────────────


@pytest.mark.asyncio
async def test_the_tally_keeps_a_transferred_student():
    """Mục bài tập CỐ Ý sống sót khi học viên chuyển lớp. Tra học viên theo sĩ số
    lớp HIỆN TẠI thì em đã chuyển đi hiện ra tên trống và "chưa kích hoạt", kể cả
    khi em có tài khoản và đã nộp — bảng khi đó nói khác sổ cái."""
    items = [_item("s-đã-chuyển", "2026-08-03T11:00:00+00:00", 6.5)]
    # students KHÔNG lọc theo cohort: em ấy nay thuộc lớp khác
    students = [{"id": "s-đã-chuyển", "cohort_id": "co-MỚI", "full_name": "Em A",
                 "student_code": "S9", "user_id": "u9"}]
    out = await _tally(_tally_db(items, students=students))
    row = out["students"][0]
    assert row["name"] == "Em A"
    assert row["status"] == "submitted"
    assert out["counts"]["no_account"] == 0


@pytest.mark.asyncio
async def test_the_fast_path_WIRE_rejects_a_tampered_set():
    """Ghim hàm kiểm mà không ghim chỗ gọi thì bỏ dây nối đi test vẫn xanh — đã
    dính đúng nếp này ba lần trong nhánh. Chạy thật `generate_questions`."""
    from unittest.mock import AsyncMock
    from routers import questions as qmod

    class _T:
        def __init__(self, rows): self._rows = list(rows)
        def select(self, *_a, **_k): return self
        def eq(self, f, v):
            self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
            return self
        def order(self, *_a, **_k): return self
        def limit(self, *_a): return self
        def execute(self): return _Resp(self._rows)

    snap = [{"id": "q1", "question_text": "Đề được giao?"}]
    tables = {
        "sessions": [{"id": "sess-1", "part": 1, "topic": "x", "mode": "practice",
                      "status": "in_progress", "user_id": "u1",
                      "class_assignment_item_id": "item-1"}],
        # Hàng đã nằm sẵn trong phiên, nhưng KHÔNG phải đề được giao.
        "questions": [{"id": "row-1", "session_id": "sess-1", "part": 1,
                       "order_num": 1, "question_text": "Câu dễ tự nhập?",
                       "listen_only": False}],
        "class_assignment_items": [{"id": "item-1", "assignment_id": "asg-1"}],
        "class_assignments": [{"id": "asg-1", "skill": "speaking",
                               "content_config": {"question_ids": ["q1"],
                                                  "questions": snap}}],
    }
    db = type("DB", (), {})()
    db.table = lambda n: _T(tables.get(n, []))

    with patch.object(qmod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(qmod, "supabase_admin", db):
        with pytest.raises(Exception) as exc:
            await qmod.generate_questions("sess-1", None)
    assert getattr(exc.value, "status_code", None) == 409
