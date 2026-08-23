"""Chỗ đang làm dở của bài tập theo buổi phải đọc được TỪ MÁY CHỦ.

Báo cáo thật: em Minh Ngoc Võ, bank C1-B01 — làm 8/10 câu chặng 3, đóng tab,
mở lại thì mất sạch. Học viên đọc chuyện ấy thành "thoát trình duyệt là bài tự
nộp". Không phải tự nộp: chỗ đang làm chỉ sống trong `localStorage` của đúng
một trình duyệt, nên `restore()` vứt chặng dở và `load()` mở một phiên MỚI —
những câu đã trả lời nằm lại trong một phiên không bao giờ được chốt.
"""

from __future__ import annotations

import inspect

from services import quiz_service as qs


def _src():
    return inspect.getsource(qs.get_course_resume)


def test_it_never_ends_a_session():
    """Bài chỉ được nộp khi học viên bấm nộp. Một đường ĐỌC mà chốt phiên là
    đúng thứ học viên đang than phiền.

    Ghim theo LỆNH GHI, không theo tên cột. Bản trước cấm luôn chuỗi `ended_by`
    xuất hiện — một cách gián tiếp để nói "đừng ghi", nhưng nó cũng cấm ĐỌC cột
    ấy, mà đọc lại đúng là việc phải làm: `ended_at` được đặt cả khi TẠM DỪNG,
    nên phân biệt chốt-thật với tạm-dừng bắt buộc phải nhìn `ended_by`.
    """
    src = _src()
    for bad in (".update(", ".insert(", ".upsert(", ".delete("):
        assert bad not in src, f"đường khôi phục không được ghi gì: {bad}"


def test_completed_means_ended_by_completed_not_merely_ended():
    """`ended_at` được đặt cả khi tạm dừng. Coi mọi dòng có `ended_at` là đã
    chốt nghĩa là gọi một chặng bỏ giữa chừng là chặng đã xong — rồi gửi luôn id
    phiên tạm dừng đi xét đạt, và verdict bác cả lượt (codex 06/08)."""
    src = _src()
    assert 'r.get("ended_by") == "completed"' in src
    assert "completed" in src and "open_rows" in src


def test_sessions_of_another_assignment_item_are_excluded():
    """Chuyển lớp rồi được giao lại CÙNG bank là một mục khác — phiên của mục cũ
    đem đi xét đạt thì verdict bác cả lượt (mig 181)."""
    src = _src()
    assert 'class_assignment_item_id' in src and "item_id" in src


def test_the_kind_column_is_actually_selected():
    """Lọc theo một cột KHÔNG có trong `select` là lọc vào None: phiên kiểm tra
    lại sẽ lọt vào lượt chính. PostgREST không báo gì cả."""
    src = _src()
    i = src.index('.select(', src.index('table("quiz_sessions")'))
    sel = src[i:src.index(')', i)]
    assert "kind" in sel, "lọc theo `kind` thì phải CHỌN `kind`"
    assert "ended_at" in sel and "class_assignment_item_id" in sel


def test_a_read_failure_returns_empty_instead_of_blocking_the_student():
    """Ném ở đây là chặn học viên khỏi bài tập vì một lỗi đọc phụ trợ."""
    src = _src()
    assert "except Exception" in src
    assert "return empty" in src or "return result" in src


def test_non_course_banks_are_untouched():
    src = _src()
    assert "COURSE_AREA" in src, "chỉ bài tập theo buổi mới có khái niệm chặng"


def test_the_session_with_the_most_work_wins():
    """Tải lại trang đẻ ra vài phiên cho CÙNG một chặng, và phiên mới nhất
    thường là phiên ít bài nhất. Dữ liệu thật của em ấy: chặng 3 có một phiên 8
    câu và một phiên 5 câu — lấy mới nhất là bắt em làm lại 3 câu đã làm."""
    src = _src()
    assert "with_work" in src, "phiên rỗng không phải chỗ đang làm dở"
    assert "max(with_work" in src and "len(by_session" in src, \
        "phải chọn phiên NHIỀU BÀI NHẤT, không phải phiên mới nhất"


def test_it_returns_the_last_finished_stage_result():
    """Máy mới (chưa có gì trong localStorage) khôi phục vào màn kết quả với
    `marks` rỗng, mà trang tính điểm TỪ `marks` — nên không có con số này thì
    học viên xong cả bài vẫn thấy "0/10 câu đúng" (codex PR 945 vòng 4)."""
    src = _src()
    assert '"last_stage"' in src
    assert "total_correct" in src and "total_questions" in src


def test_the_totals_are_actually_selected():
    """Đọc một cột không có trong `select` là đọc ra None — và None ở đây thành
    "0 câu đúng", đúng thứ đang phải sửa."""
    src = _src()
    i = src.index(".select(", src.index('table("quiz_sessions")'))
    sel = src[i:src.index(")", i)]
    assert "total_correct" in sel and "total_questions" in sel


# ── Chặng tính TRÊN THỨ TỰ CHUẨN của bộ đề ──────────────────────────────────
#
# Cảnh hỏng thật (06/08, dữ liệu prod): trang tự tính `stage = completed.length`
# (ĐẾM PHIÊN). Một lượt kết phiên hỏng làm chặng ấy không được đếm ⇒ chỉ số tụt
# ⇒ trang cắt nhầm 10 câu ⇒ phép khớp mã câu hỏng ⇒ mở phiên MỚI và bỏ rơi câu
# vừa làm ⇒ lần sau lệch thêm. Đo được: 29 phiên mồ côi mang 90 câu đã trả lời,
# ĐÚNG BẰNG số câu được tính.
#
# `_course_stage_reached` nay THUẦN TUÝ — nhận thứ tự chuẩn và tập câu đã trả
# lời, không chạm cơ sở dữ liệu. Chốt cho nó vì thế nói thẳng về LUẬT.

from services.quiz_service import _course_stage_reached as reached

ORDER = [f"q{i:02d}" for i in range(90)]        # 9 chặng
def _all(*rng):
    return {f"q{i:02d}" for r in rng for i in r}


def test_the_stage_is_the_first_one_NOT_fully_covered():
    assert reached(ORDER, _all(range(0, 20))) == 2


def test_ten_answers_scattered_across_the_bank_are_NOT_one_stage():
    """Chín câu của chặng 0 cộng một câu ở tận chặng 5 vẫn là "10 câu". Chia 10
    thì ra chặng 1 — và học viên nhảy cóc qua câu mình chưa hề làm."""
    assert reached(ORDER, _all(range(0, 9), [50])) == 0


def test_a_bank_whose_last_stage_is_SHORT_can_still_be_finished():
    """Bộ đề 25 câu có BA chặng (10 + 10 + 5). Chia 10 ra "2 chặng", nên trả lời
    trọn vẹn cả 25 câu vẫn không bao giờ được coi là xong bài."""
    order = [f"q{i:02d}" for i in range(25)]
    assert reached(order, set(order)) == 3


def test_a_hole_left_behind_does_not_drag_a_student_back_mid_bank():
    """Trang có thể đã tiến chặng theo bộ nhớ cục bộ trong khi một lượt kết phiên
    hỏng để lại lỗ phía sau. Kéo em ấy về lấp lỗ là bắt làm lại từ giữa bài —
    đây chính là ca của em Lê Ngọc Hà Linh (đang làm câu chặng 3, sổ đếm 2)."""
    assert reached(ORDER, _all(range(0, 15)), in_progress_qid="q30") == 3


def test_but_a_leftover_session_cannot_drag_a_FINISHED_student_back():
    """Em Minh Ngoc Võ xong cả 9 chặng nhưng còn một phiên dở 5 câu của chặng 2."""
    assert reached(ORDER, set(ORDER), in_progress_qid="q24") == 9


def test_an_unknown_question_in_progress_is_ignored():
    """Bộ đề vừa được nạp lại: câu đang dở không còn tồn tại."""
    assert reached(ORDER, _all(range(0, 20)), in_progress_qid="DA-XOA") == 2


def test_answers_to_questions_that_no_longer_exist_do_not_inflate_the_stage():
    assert reached(ORDER, _all(range(0, 10)) | {f"DA-XOA-{i}" for i in range(50)}) == 1




# ── Mối nối THẬT: chọn phiên → xếp câu → tính chặng ─────────────────────────
#
# Các chốt trên nói về LUẬT (hàm thuần tuý) và về CHỮ trong mã. Cả hai đều để
# lọt hai lỗi thật: coi phiên tạm dừng là đã chốt, và trả câu sai thứ tự. Chốt
# dưới đây gọi thẳng `get_course_resume` với một cơ sở dữ liệu giả.

from unittest.mock import patch

BANK = "bank-1"
USER = "u1"
ITEM = "item-1"


class _Q:
    def __init__(self, rows, cols="*"):
        self._rows, self._cols = list(rows), cols

    def eq(self, c, v):
        return _Q([r for r in self._rows if r.get(c) == v], self._cols)

    def in_(self, c, vs):
        return _Q([r for r in self._rows if r.get(c) in set(vs)], self._cols)

    def order(self, c, **_k):
        return _Q(sorted(self._rows, key=lambda r: r.get(c) or 0), self._cols)

    def limit(self, *_a):
        return self

    def range(self, a, b):
        return _Q(self._rows[a:b + 1], self._cols)

    def execute(self):
        class R:
            pass
        r = R()
        want = ([c.strip() for c in self._cols.replace("\n", " ").split(",")]
                if self._cols != "*" else None)
        r.data = ([{k: x.get(k) for k in want} for x in self._rows] if want
                  else [dict(x) for x in self._rows])
        r.count = len(self._rows)
        return r


class _DB:
    def __init__(self, t):
        self.t = t

    def table(self, name):
        rows = self.t.get(name, [])

        class T:
            def select(self, cols="*", **_k):
                return _Q(rows, cols)
        return T()


def _resume(*, sessions, attempts, questions=None, mastery=None):
    qn = questions or [{"bank_id": BANK, "qid": f"q{i:02d}", "type": "mcq", "order": i}
                       for i in range(90)]
    db = _DB({
        "quiz_sessions": sessions,
        "quiz_attempts": attempts,
        "quiz_questions": qn,
        "class_assignment_items": ([{"id": ITEM, "passed_at": None,
                                     "mastery": mastery}] if mastery else []),
    })
    with patch.object(qs, "supabase_admin", db), \
            patch.object(qs, "_bank_meta_or_404",
                         lambda *_a, **_k: {"skill_area": qs.COURSE_AREA}), \
            patch.object(qs, "_assignment_item_for", lambda *_a, **_k: {"id": ITEM}):
        return qs.get_course_resume(user_id=USER, bank_id=BANK)


def _sess(sid, *, ended_by=None, created="2026-08-06T01:00:00+00:00", tq=None, tc=None):
    return {"id": sid, "user_id": USER, "bank_id": BANK, "kind": "run",
            "class_assignment_item_id": ITEM, "created_at": created,
            "ended_at": None if ended_by is None else created,
            "ended_by": ended_by, "total_questions": tq, "total_correct": tc}


def test_a_PAUSED_session_is_not_a_finished_stage():
    """`ended_at` được đặt cả khi tạm dừng. Coi nó là đã chốt nghĩa là gọi một
    chặng bỏ giữa chừng là chặng đã xong — rồi gửi luôn id phiên tạm dừng đi xét
    đạt, và verdict bác cả lượt (codex 06/08)."""
    sv = _resume(
        sessions=[_sess("s1", ended_by="completed", tq=10, tc=8),
                  _sess("s2", ended_by="paused", created="2026-08-06T02:00:00+00:00",
                        tq=4, tc=1)],
        attempts=[{"session_id": "s1", "qid": f"q{i:02d}"} for i in range(10)]
        + [{"session_id": "s2", "qid": f"q{i:02d}"} for i in range(10, 14)])
    assert sv["completed"] == ["s1"], "phiên tạm dừng không phải chặng đã xong"
    assert sv["stage"] == 1
    assert sv["last_stage"] == {"right": 8, "graded": 10}, \
        "điểm màn kết quả phải lấy từ chặng CHỐT THẬT"


def test_the_answers_come_back_in_the_BANK_ORDER():
    """Một lô lượt làm ghi cùng lúc mang CÙNG dấu thời gian, và Postgres không
    hứa gì về thứ tự giữa các dòng bằng nhau. Trang lại đòi khớp ĐÚNG tiền tố,
    nên chỉ cần hai câu đảo chỗ là nó coi như lệch đề, mở phiên mới, và bỏ rơi
    cả phiên có bài. Dữ liệu thật của em Minh Ngoc Võ đúng hình dạng ấy."""
    sv = _resume(
        sessions=[_sess("s1")],
        # cùng `created_at`, thứ tự trả về lộn xộn
        attempts=[{"session_id": "s1", "qid": q, "created_at": "2026-08-06T01:00:00+00:00"}
                  for q in ["q04", "q02", "q00", "q03", "q01"]])
    assert [a["qid"] for a in sv["answered"]] == ["q00", "q01", "q02", "q03", "q04"]


def test_answering_the_same_question_twice_does_not_double_count():
    """Đẩy lại hàng đợi sau khi mất mạng có thể ghi trùng. Trả hai lần cùng một
    câu thì trang đếm `at` vượt số câu của chặng và nhảy cóc."""
    sv = _resume(
        sessions=[_sess("s1")],
        attempts=[{"session_id": "s1", "qid": q} for q in ["q00", "q01", "q00", "q02"]])
    assert [a["qid"] for a in sv["answered"]] == ["q00", "q01", "q02"]


def test_the_stage_comes_from_the_work_in_progress():
    """Ca của em Lê Ngọc Hà Linh: hai phiên chốt, nhưng đang làm câu chặng 3."""
    sv = _resume(
        sessions=[_sess("s1", ended_by="completed"), _sess("s2", ended_by="completed"),
                  _sess("s3", created="2026-08-06T03:00:00+00:00")],
        attempts=[{"session_id": "s1", "qid": f"q{i:02d}"} for i in range(10)]
        + [{"session_id": "s2", "qid": f"q{i:02d}"} for i in range(10, 20)]
        + [{"session_id": "s3", "qid": f"q{i:02d}"} for i in range(30, 38)])
    assert sv["stage"] == 3
    assert sv["session_id"] == "s3" and len(sv["answered"]) == 8


def test_resume_chooses_grammar_work_not_a_longer_legacy_supplement_session():
    """Client cũ từng ghi row bổ trợ vào quiz session. Mười row ấy không được
    thắng một phiên Grammar thật có năm câu rồi làm frontend bỏ cả hai."""
    questions = [
        {"bank_id": BANK, "qid": f"q{i:02d}", "type": "mcq", "order": i}
        for i in range(90)
    ] + [
        {"bank_id": BANK, "qid": f"read-{i}", "type": "course_reading",
         "counts_toward_mastery": False, "order": 90 + i}
        for i in range(10)
    ]
    sv = _resume(
        sessions=[
            _sess("legacy-supplements", created="2026-08-06T01:00:00+00:00"),
            _sess("grammar", created="2026-08-06T02:00:00+00:00"),
        ],
        attempts=[
            {"session_id": "legacy-supplements", "qid": f"read-{i}"}
            for i in range(10)
        ] + [
            {"session_id": "grammar", "qid": f"q{i:02d}"}
            for i in range(5)
        ],
        questions=questions,
    )
    assert sv["session_id"] == "grammar"
    assert [a["qid"] for a in sv["answered"]] == [f"q{i:02d}" for i in range(5)]


def test_a_full_retry_does_not_resume_sessions_from_the_failed_run():
    """Dưới vùng gần đạt là failed attempt: lần mở sau phải ở chặng 1."""
    mastery = {"threshold": 75, "attempts": [{
        "phase": "run", "pct": 60.0, "at": "2026-08-06T03:00:00+00:00",
        "sessions": ["s1", "s2"], "next_action": "retry_full",
    }]}
    sv = _resume(
        sessions=[
            _sess("s1", ended_by="completed", created="2026-08-06T01:00:00+00:00"),
            _sess("s2", ended_by="completed", created="2026-08-06T02:00:00+00:00"),
        ],
        attempts=[{"session_id": "s1", "qid": f"q{i:02d}"} for i in range(10)]
        + [{"session_id": "s2", "qid": f"q{i:02d}"} for i in range(10, 20)],
        mastery=mastery,
    )
    assert sv["stage"] == 0
    assert sv["completed"] == []
    assert sv["session_id"] is None


def test_near_pass_rerun_keeps_the_prior_full_retry_boundary_on_reload():
    """P1 PR #1014: latest action=retake must not resurrect the failed run."""
    mastery = {"threshold": 75, "attempts": [
        {"phase": "run", "pct": 60.0, "at": "2026-08-06T03:00:00+00:00",
         "sessions": ["old-1", "old-2"], "next_action": "retry_full"},
        {"phase": "run", "pct": 70.0, "at": "2026-08-06T06:00:00+00:00",
         "sessions": ["new-1", "new-2"], "next_action": "retake"},
    ]}
    sessions = [
        _sess("old-1", ended_by="completed", created="2026-08-06T01:00:00+00:00"),
        _sess("old-2", ended_by="completed", created="2026-08-06T02:00:00+00:00"),
        _sess("new-1", ended_by="completed", created="2026-08-06T04:00:00+00:00"),
        _sess("new-2", ended_by="completed", created="2026-08-06T05:00:00+00:00"),
    ]
    sv = _resume(
        sessions=sessions,
        attempts=[{"session_id": s, "qid": f"q{i:02d}"}
                  for s, start in (("old-1", 0), ("old-2", 10),
                                   ("new-1", 0), ("new-2", 10))
                  for i in range(start, start + 10)],
        mastery=mastery,
    )
    assert sv["completed"] == ["new-1", "new-2"]
    assert sv["stage"] == 2


def test_an_unreadable_attempt_table_does_NOT_send_a_finished_student_to_stage_0():
    """Tập rỗng đọc ra là "em ấy chưa làm câu nào" — một khẳng định mà lượt đọc
    hỏng không chứng minh được.

    Tin nó là đẩy một em đã xong 8 chặng về chặng 0 rồi mở phiên mới: tái tạo
    ĐÚNG cảnh bỏ rơi bài mà cả thay đổi này sinh ra để chấm dứt (codex PR 963).
    """
    class _Boom(_DB):
        def table(self, name):
            if name == "quiz_attempts":
                raise RuntimeError("đọc hỏng")
            return super().table(name)

    db = _Boom({"quiz_sessions": [_sess(f"s{k}", ended_by="completed") for k in range(8)],
                "quiz_attempts": [],
                "quiz_questions": [{"bank_id": BANK, "qid": f"q{i:02d}",
                                    "type": "mcq", "order": i} for i in range(90)]})
    with patch.object(qs, "supabase_admin", db), \
            patch.object(qs, "_bank_meta_or_404",
                         lambda *_a, **_k: {"skill_area": qs.COURSE_AREA}), \
            patch.object(qs, "_assignment_item_for", lambda *_a, **_k: {"id": ITEM}):
        sv = qs.get_course_resume(user_id=USER, bank_id=BANK)
    assert sv["stage"] == 8, "lùi về đếm phiên, KHÔNG về 0"
