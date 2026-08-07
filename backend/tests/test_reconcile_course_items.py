"""Vá sổ cho bài tập THEO BUỔI.

`end_session` và `submit_course_writing` ghi sổ BEST-EFFORT: hỏng thì chỉ log,
còn client nhận HTTP 200 nên không có gì kích hoạt thử lại. Với chặng CUỐI (hoặc
lượt nộp tự luận) thì không còn lượt nào sau để gọi lại, và bài nằm ở "Cần nộp"
VĨNH VIỄN. `reconcile_ledger_from_sessions` không đỡ được: nó đọc bảng
`sessions` của Speaking, không đọc `quiz_sessions` (codex PR 954).

Bộ giả CHIẾU ĐÚNG CỘT như PostgREST — một bộ giả dễ dãi hơn thật thì che mất
đúng loại lỗi mình đang đi tìm (bài học lặp bốn lần trong ngày 06/08).
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from services import quiz_service as qs

ASG = "asg-1"
ITEM = "it-1"
BANK = "bank-1"
DUE = "2026-08-10T12:00:00+00:00"


def _project(rows, cols):
    if not cols or "*" in cols:
        return [dict(r) for r in rows]
    want = [c.strip() for c in cols.replace("\n", " ").split(",") if c.strip()]
    return [{k: r.get(k) for k in want} for r in rows]


class _Q:
    def __init__(self, rows, cols="*", db=None):
        self._rows, self._cols, self._db = list(rows), cols, db

    def eq(self, c, v):
        return _Q([r for r in self._rows if r.get(c) == v], self._cols, self._db)

    def in_(self, c, vs):
        # PostgREST gửi `in.(...)` trong URL, nên danh sách dài thì cả câu lệnh
        # bị từ chối. Bộ giả nhận danh sách vô hạn sẽ để lọt đúng lớp lỗi mà
        # việc chia lô sinh ra để né — và phép thử "không cắt ở mốc 100" khi ấy
        # xanh cả với bản gộp-một-lô, tức xanh vì lý do khác.
        if len(vs) > 100:
            raise RuntimeError(f"in.(...) quá dài: {len(vs)} giá trị")
        return _Q([r for r in self._rows if r.get(c) in set(vs)], self._cols, self._db)

    def is_(self, c, _v):
        return _Q([r for r in self._rows if r.get(c) is None], self._cols, self._db)

    @property
    def not_(self):
        outer = self

        class _N:
            def is_(self, c, _v):
                return _Q([r for r in outer._rows if r.get(c) is not None], outer._cols, outer._db)
        return _N()

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a):
        return self

    def range(self, a, b):
        return _Q(self._rows[a:b + 1], self._cols, self._db)

    def execute(self):
        if self._db is not None:
            self._db.reads += 1
        class R:
            pass
        r = R()
        r.data = _project(self._rows, self._cols)
        r.count = len(self._rows)
        return r


class _DB:
    def __init__(self, tables):
        self.t = tables
        self.marked = []
        self.reads = 0
        self.boom = set()
        # Hỏng ở lượt đọc thứ N của một bảng: mô phỏng lượt đọc CHẾT GIỮA
        # CHỪNG, chứ không phải chết ngay từ đầu. Đây mới là hình dạng nguy
        # hiểm — dữ liệu về một nửa mà trông như đã đủ.
        self.boom_nth = {}
        self.hits = {}

    def table(self, name):
        rows = self.t.get(name, [])
        db = self

        class T:
            def select(self, cols="*", **_k):
                db.hits[name] = db.hits.get(name, 0) + 1
                if name in db.boom or db.hits[name] == db.boom_nth.get(name):
                    raise RuntimeError(f"đọc hỏng: {name}")
                return _Q(rows, cols, db)

            def update(self, patch):
                class _U:
                    def eq(self, *_a):
                        return self

                    def is_(self, *_a):
                        return self

                    def execute(self):
                        db.marked.append(patch)

                        class R:
                            data = [patch]
                        return R()
                return _U()
        return T()


def _db(*, items, sessions=(), attempts=(), questions=(), writing=(), skill="course"):
    return _DB({
        "class_assignments": [{"id": ASG, "content_id": BANK, "skill": skill,
                               "due_at": DUE}],
        "class_assignment_items": list(items),
        "quiz_sessions": list(sessions),
        "quiz_attempts": list(attempts),
        "quiz_questions": [{"bank_id": BANK, **q} for q in questions],
        "course_writing_submissions": list(writing),
    })


def _mcq(n):
    return [{"qid": f"q{i}", "type": "mcq"} for i in range(n)]


def _sess(sid, when="2026-08-09T10:00:00+00:00", *, kind="run", ended_by="completed",
          item=ITEM, total=10, correct=8):
    return {"id": sid, "kind": kind, "ended_by": ended_by, "ended_at": when,
            "class_assignment_item_id": item,
            "total_questions": total, "total_correct": correct}


def _covers(sid, qids):
    return [{"session_id": sid, "qid": q} for q in qids]


def _run(db):
    with patch.object(qs, "supabase_admin", db):
        return qs.reconcile_course_items(db, [ASG])


def test_a_finished_quiz_with_no_ledger_row_is_repaired():
    """Chặng CUỐI ghi sổ hỏng: không còn lượt nào sau để gọi lại."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(10), sessions=[_sess("s1")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)]))
    assert _run(db) == 1
    assert db.marked[0]["artifact_kind"] == "quiz_session"
    assert db.marked[0]["score"] == 80.0


def test_it_stamps_when_the_work_FINISHED_not_when_it_was_repaired():
    """Bài xong lúc 18:00 mà vá lúc 20:00 sẽ bị báo trễ — đường vá tự tạo ra
    đúng cái kết luận sai mà nó sinh ra để sửa."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(10), sessions=[_sess("s1", "2026-08-09T18:00:00+00:00")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)]))
    assert _run(db) == 1
    assert db.marked[0]["submitted_at"].startswith("2026-08-09T18:00")


def test_work_finished_after_the_deadline_is_repaired_JUST_LIKE_the_normal_path():
    """Đường vá phải chặt ĐÚNG BẰNG đường ghi, không chặt hơn.

    Speaking chặn sau hạn ngay ở đường ghi (`sessions.py`), nên đường vá của nó
    chặn theo là đúng nhịp. Bài theo buổi thì `end_session` KHÔNG chặn: bài
    muộn vẫn được ghi, và bảng gọi nó là trễ bằng cách so `submitted_at` với
    hạn. Nếu đường vá chặt hơn thì em nào nộp muộn mà gặp lượt ghi sổ hỏng sẽ
    kẹt VĨNH VIỄN — đúng cái lỗi hàm này sinh ra để sửa."""
    late = "2026-08-11T09:00:00+00:00"   # DUE là 10/08
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(10), sessions=[_sess("s1", late)],
             attempts=_covers("s1", [f"q{i}" for i in range(10)]))
    assert _run(db) == 1
    # Và vẫn đóng dấu giờ THẬT, để bảng đọc ra "trễ" chứ không bị làm cho đúng hạn.
    assert db.marked[0]["submitted_at"].startswith("2026-08-11T09:00")


def test_unfinished_work_is_left_alone():
    """Vá sổ KHÔNG được biến một bài làm dở thành một bài đã nộp."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(20), sessions=[_sess("s1")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)]))
    assert _run(db) == 0


def test_a_graded_writing_submission_closes_the_item():
    """Với bộ đề có phần viết thì ĐÂY mới là đường chốt sổ."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(10) + [{"qid": "w1", "type": "writing"}],
             writing=[{"id": "w-1", "class_assignment_item_id": ITEM,
                       "graded_at": "2026-08-09T11:00:00+00:00",
                       "total": 10, "clean": 7}])
    assert _run(db) == 1
    assert db.marked[0]["artifact_kind"] == "course_writing"
    assert db.marked[0]["submitted_at"].startswith("2026-08-09T11:00")
    # ĐIỂM thì KHÔNG. Bản trước chốt `score == 70.0` ở đây, và đó chính là lỗi:
    # bộ đề này có 10 câu trắc nghiệm, nên điểm của mục là kết quả trắc nghiệm
    # (`course_verdict` ghi, `passed_at` xét trên số ấy) — độ sạch bài viết ghi
    # đè lên là xoá mất nó. Xem `test_a_graded_essay_leaves_the_quiz_result_alone`.
    assert "score" not in db.marked[0]


def test_an_item_already_in_the_ledger_is_not_touched():
    db = _db(items=[{"id": ITEM, "assignment_id": ASG,
                     "submitted_at": "2026-08-09T10:00:00+00:00"}],
             questions=_mcq(10), sessions=[_sess("s1")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)]))
    assert _run(db) == 0


def test_non_course_assignments_are_ignored():
    """Speaking đã có đường vá riêng; chạm vào là hai đường ghi cùng một chỗ."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(10), sessions=[_sess("s1")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)]),
             skill="speaking")
    assert _run(db) == 0


def test_the_session_that_COMPLETED_the_work_is_the_evidence():
    """Công việc xong ở lượt phủ nốt câu còn thiếu — đó là thời điểm nộp thật."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(20),
             sessions=[_sess("s1", "2026-08-08T10:00:00+00:00"),
                       _sess("s2", "2026-08-09T10:00:00+00:00")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)])
             + _covers("s2", [f"q{i}" for i in range(10, 20)]))
    assert _run(db) == 1
    assert db.marked[0]["artifact_id"] == "s2"


def test_nothing_to_do_costs_nothing():
    assert qs.reconcile_course_items(_db(items=[]), []) == 0


def test_a_read_failure_is_RAISED_so_the_page_can_say_it_is_stale():
    """Nuốt lỗi rồi trả 0 thì trang vẽ "chưa nộp" bằng sổ chưa vá mà không một
    lời cảnh báo — đúng con số sai-mà-trông-chuẩn mà cờ ấy sinh ra để chặn. Cả
    hai mặt đọc đã bọc try/except sẵn (nếp của `reconcile_ledger_from_sessions`).
    """
    class _Boom(_DB):
        def table(self, name):
            raise RuntimeError("mạng đứt")
    # Đúng LOẠI lỗi, không phải "một lỗi nào đó": `ReconcileIncomplete` là lời
    # nói "chưa làm trọn", còn một RuntimeError lọt ra là một đường chưa ai xét.
    with pytest.raises(qs.ReconcileIncomplete):
        _run(_Boom({}))


def test_the_repair_runs_where_the_teacher_LOOKS():
    """Ghim ĐƯỜNG: một hàm vá sổ không ai gọi thì vô dụng."""
    import inspect
    from routers import admin_class_assignments as adm
    src = inspect.getsource(adm)
    assert src.count("reconcile_course_items(supabase_admin") >= 2, \
        "phải chạy ở CẢ danh sách bài giao lẫn bảng tổng kết"


def test_every_assignment_is_reconciled_not_just_the_first_hundred():
    """Cắt bớt ở mốc 100 là một trần ÂM THẦM: trang chạy xanh, con số trông đủ,
    và mọi mục sau mốc ấy không bao giờ được vá."""
    n = 250
    asgs = [{"id": f"a{i}", "content_id": BANK, "skill": "course", "due_at": DUE}
            for i in range(n)]
    items = [{"id": f"i{i}", "assignment_id": f"a{i}", "submitted_at": None}
             for i in range(n)]
    sess = [_sess(f"s{i}", item=f"i{i}") for i in range(n)]
    att = [a for i in range(n) for a in _covers(f"s{i}", [f"q{j}" for j in range(10)])]
    db = _DB({"class_assignments": asgs, "class_assignment_items": items,
              "quiz_sessions": sess, "quiz_attempts": att,
              "quiz_questions": [{"bank_id": BANK, **q} for q in _mcq(10)],
              "course_writing_submissions": []})
    with patch.object(qs, "supabase_admin", db):
        assert qs.reconcile_course_items(db, [f"a{i}" for i in range(n)]) == n


def test_no_read_is_ever_issued_PER_ITEM():
    """Hầu hết mục 'chưa nộp' là chưa nộp THẬT. Hỏi từng mục thì cả lớp trả giá
    mỗi lần mở trang cho một sự cố hiếm.

    Chốt theo LÔ, không theo hằng số: 3 em và 60 em cùng nằm dưới mốc 100 nên
    "3 bằng 60" là một lời khẳng định rẻ tiền — nó xanh kể cả với bản đọc từng
    mục ở mức 250 em (codex cục bộ 06/08). Trần đúng là bốn lượt đọc cho mỗi
    lô 100 mục; bản hỏi-từng-mục vượt trần này ngay ở 60."""
    def _reads(n, *, banks):
        """n mục ĐỀU CÓ BẰNG CHỨNG — phải đi hết đường, kể cả lớp đọc bộ đề.

        Bản trước dựng n mục KHÔNG bằng chứng nên hàm thoát ngay ở bộ lọc, chưa
        chạm tới `quiz_attempts` lẫn lớp đọc bộ đề: nó đo một đường mà nó không
        định đo (codex vòng 2)."""
        asgs = [{"id": f"a{k}", "content_id": f"b{k % banks}",
                 "skill": "course", "due_at": DUE} for k in range(n)]
        db = _DB({
            "class_assignments": asgs,
            "class_assignment_items": [
                {"id": f"i{k}", "assignment_id": f"a{k}", "submitted_at": None}
                for k in range(n)],
            "quiz_sessions": [_sess(f"s{k}", item=f"i{k}") for k in range(n)],
            "quiz_attempts": [a for k in range(n) for a in _covers(f"s{k}", ["q0"])],
            "quiz_questions": [{"bank_id": f"b{j}", "qid": "q0", "type": "mcq"}
                               for j in range(banks)],
            "course_writing_submissions": [],
        })
        with patch.object(qs, "supabase_admin", db):
            assert qs.reconcile_course_items(db, [f"a{k}" for k in range(n)]) == n
        return db.reads

    for n in (3, 60, 250, 700):
        for banks in (1, n):
            # 5 lớp đọc (bài giao · mục · tự luận · phiên · câu đã làm) cộng lớp
            # đọc bộ đề, mỗi lớp chia lô 100.
            cap = 6 * -(-n // 100)
            got = _reads(n, banks=banks)
            assert got <= cap, (
                f"{n} mục / {banks} bộ đề: đọc {got} lượt, trần theo lô là {cap}")


def test_a_failed_session_read_stamps_nothing():
    """Ngược với `_course_work_is_done` (hỏng ⇒ True, vì nó là đường chốt sổ duy
    nhất): đường vá chạy lại mỗi lần mở trang, nên bỏ qua chỉ là hoãn — còn ghi
    bừa từ một lượt đọc hỏng là đóng dấu 'đã nộp' lên bài không ai đọc được."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(10), sessions=[_sess("s1")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)]))
    db.boom = {"quiz_sessions"}
    with pytest.raises(qs.ReconcileIncomplete):
        _run(db)
    assert db.marked == []


def test_a_failed_attempt_read_stamps_nothing():
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(10), sessions=[_sess("s1")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)]))
    db.boom = {"quiz_attempts"}
    with pytest.raises(qs.ReconcileIncomplete):
        _run(db)
    assert db.marked == []


def test_a_writing_bank_is_not_closed_by_finishing_the_multiple_choice():
    """Bộ đề 100 câu = 90 trắc nghiệm + 10 tự luận. Làm hết 90 câu vẫn CHƯA
    xong bài — lượt nộp tự luận mới là đường chốt sổ."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(10) + [{"qid": "w1", "type": "writing"}],
             sessions=[_sess("s1")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)]))
    assert _run(db) == 0


def _many(n):
    """n mục, mỗi mục một phiên đã chốt phủ đủ câu — đủ để cần chia lô.

    Bộ đề để 2 câu là CÓ CHỦ Ý: lô đầu (100 mục) phải nằm gọn trong một trang
    1000 dòng, để "hỏng ở lượt đọc thứ 2" rơi đúng vào LÔ THỨ HAI. Nếu lô đầu
    tự nó tràn trang thì lượt hỏng rơi vào giữa lô một, cả lô ấy mất trắng, và
    phép thử không còn dựng được cảnh dữ-liệu-về-một-nửa mà nó sinh ra để dựng.
    """
    return dict(
        items=[{"id": f"i{k}", "assignment_id": ASG, "submitted_at": None}
               for k in range(n)],
        questions=_mcq(2),
        sessions=[_sess(f"s{k}", item=f"i{k}") for k in range(n)],
        attempts=[a for k in range(n) for a in _covers(f"s{k}", ["q0", "q1"])])


def test_a_read_that_dies_MIDWAY_loses_only_its_own_batch():
    """Đơn vị công việc là MỘT LÔ 100 mục.

    Trong lô thì được ăn cả ngã về không: lượt đọc chết giữa chừng để lại dữ
    liệu về một nửa mà TRÔNG như đã đủ, và một mục mất đúng phiên MUỘN NHẤT sẽ
    bị đóng dấu bằng giờ của lượt trước — sai giờ nộp, có khi sai cả kết luận
    đúng/trễ hạn.

    Nhưng lô này hỏng không được kéo theo lô khác: lô chia theo mã mục, nên
    công việc của lô đã đọc trọn là an toàn. Bỏ luôn phần ấy là phạt 100 em vì
    một lượt đọc hỏng của 50 em khác (codex vòng 4)."""
    db = _db(**_many(150))
    db.boom_nth = {"quiz_sessions": 2}
    with pytest.raises(qs.ReconcileIncomplete):
        _run(db)
    assert len(db.marked) == 100, "lô đọc trọn phải được vá"


def test_a_batch_that_fails_FIRST_does_not_cancel_the_batches_after_it():
    """Chiều bảo vệ thật của việc chia khối theo lô.

    Lô sau vá được thì phải vá — hỏng ở lô ĐẦU mà bỏ luôn phần còn lại là phạt
    50 em vì một lượt đọc hỏng của 100 em khác. (Ngược lại, lô đầu hỏng ở giữa
    chừng thì lô ấy mất trắng là ĐÚNG: dữ liệu về một nửa sẽ đóng dấu sai giờ.)
    """
    db = _db(**_many(150))
    db.boom_nth = {"quiz_sessions": 1}      # lô ĐẦU hỏng
    with pytest.raises(qs.ReconcileIncomplete):
        _run(db)
    assert len(db.marked) == 50, "lô sau vẫn phải được vá"


def test_a_half_read_of_the_answers_loses_only_its_own_batch():
    db = _db(**_many(150))
    db.boom_nth = {"quiz_attempts": 2}
    with pytest.raises(qs.ReconcileIncomplete):
        _run(db)
    assert len(db.marked) == 100


def test_an_unreadable_bank_is_RAISED_not_swallowed():
    """Không đọc được bộ đề thì không biết bài có bao nhiêu câu, cũng không biết
    có phần tự luận không — mọi kết luận 'đã xong' đều là đoán.

    Bỏ qua trong im lặng cũng không được: trang vẫn vẽ "chưa nộp" như thể đó là
    sự thật. Bản trước của chốt này viết `assert _run(db) == 0`, tức là ĐI
    KHẲNG ĐỊNH đúng cái hành vi nuốt lỗi đang cần bỏ (codex vòng 2)."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(10), sessions=[_sess("s1")],
             attempts=_covers("s1", [f"q{i}" for i in range(10)]))
    db.boom = {"quiz_questions"}
    with pytest.raises(qs.ReconcileIncomplete):
        _run(db)
    assert db.marked == []


def test_redoing_a_stage_later_does_not_move_the_hand_in_time():
    """Học viên ôn lại một chặng sau khi đã xong là chuyện thường.

    Cảnh thật: q0 làm ngày 8, q1 làm ngày 9 (tại đây bài ĐÃ đủ, và đường ghi
    thường lẽ ra chốt sổ ở đây nhưng lượt ghi hỏng), rồi ngày 11 em ấy làm lại
    q0. Lấy phiên MUỘN NHẤT thì mục bị đóng dấu bằng giờ và điểm của lượt ôn
    lại — sai giờ nộp, sai điểm, và một bài xong đúng hạn hoá thành nộp trễ.
    Đường vá phải dựng lại CHÍNH kết quả đường ghi đã bỏ lỡ."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(2),
             sessions=[_sess("s1", "2026-08-08T10:00:00+00:00", total=1, correct=1),
                       _sess("s2", "2026-08-09T10:00:00+00:00", total=1, correct=1),
                       _sess("s3", "2026-08-11T10:00:00+00:00", total=1, correct=0)],
             attempts=_covers("s1", ["q0"]) + _covers("s2", ["q1"])
                      + _covers("s3", ["q0"]))
    assert _run(db) == 1
    assert db.marked[0]["artifact_id"] == "s2", "phải là phiên LÀM XONG bài"
    assert db.marked[0]["submitted_at"].startswith("2026-08-09T10:00")
    assert db.marked[0]["score"] == 100.0, "điểm của lượt hoàn thành, không phải lượt ôn lại"


def test_one_broken_reconciler_does_not_stop_the_others():
    """Ba bộ đối chiếu đọc ba nguồn bằng chứng RỜI NHAU.

    Gộp chung một `try` thì bộ Speaking hỏng là bài theo buổi KHÔNG ĐƯỢC THỬ
    VÁ, dù mọi bảng nó cần vẫn khoẻ: trang bật cờ cảnh báo rồi đứng yên trong
    khi việc hoàn toàn làm được. Ghim bằng lượt CHẠY THẬT — bản trước chỉ soi
    chữ trong mã nguồn nên nó xanh kể cả khi lời gọi không bao giờ tới lượt
    (codex vòng 4)."""
    from routers import admin_class_assignments as adm

    seen = []

    def _boom(*_a, **_k):
        raise RuntimeError("bảng sessions của Speaking đang lỗi")

    with patch.object(adm, "reconcile_ledger_from_sessions", _boom), \
            patch.object(adm, "reconcile_test_attempts", lambda *a: None), \
            patch.object(adm, "reconcile_course_items",
                         lambda *a: seen.append(a[1])):
        stale = _drive_list_reconcile(adm, ["a1", "a2"])

    assert seen == [["a1", "a2"]], "bài theo buổi vẫn phải được thử vá"
    assert stale, "và trang vẫn phải nói là chưa đối chiếu xong"


def _drive_list_reconcile(adm, ids):
    """Chạy đúng khối đối chiếu của `list_assignments` với danh sách bài giao.

    Trích khối ra thay vì dựng cả endpoint: cái cần ghim ở đây là LUỒNG ĐIỀU
    KHIỂN giữa ba bộ, không phải hình dạng câu trả lời.
    """
    import inspect, textwrap
    src = inspect.getsource(adm.list_assignments)
    i = src.index("    reconcile_failed = False")
    j = src.index("    try:\n        progress =", i)
    block = textwrap.dedent(src[i:j])
    env = {"rows": [{"id": x} for x in ids], "supabase_admin": adm.supabase_admin,
           "logger": adm.logger,
           "reconcile_ledger_from_sessions": adm.reconcile_ledger_from_sessions,
           "reconcile_test_attempts": adm.reconcile_test_attempts,
           "reconcile_course_items": adm.reconcile_course_items}
    exec(compile(block, "<khối đối chiếu>", "exec"), env)
    return env["reconcile_failed"]


def test_the_student_page_gives_each_reconciler_its_own_failure_domain():
    """Cùng luật ấy ở mặt đọc của học viên, và lượt đọc lại mục phải nằm SAU cả
    hai bộ — vá xong mà vẫn đọc sổ cũ thì em ấy vẫn thấy bài đang nợ."""
    import inspect
    from routers import class_student as cs
    src = inspect.getsource(cs._visible_assignments)
    i = src.index("reconcile_course_items(supabase_admin")
    assert src.count("try:", src.index("stale = False")) >= 2, \
        "mỗi bộ đối chiếu một khối riêng"
    assert src.index("_reread_items", i) > i, "đọc lại mục phải nằm sau lượt vá"
    assert "stale = True" in src[i:i + 500]
def test_the_student_page_repairs_the_ledger_too():
    """Vá ở hai mặt đọc của GIÁO VIÊN thôi là chưa đủ: em ấy làm xong, gặp lượt
    ghi sổ hỏng, rồi thấy bài mình đang nợ cho tới khi giáo viên tình cờ mở
    bảng — và một học viên tin danh sách ấy sẽ làm lại bài đã nộp."""
    import inspect
    from routers import class_student as cs
    src = inspect.getsource(cs)
    i = src.index("reconcile_course_items(supabase_admin")
    assert "except Exception" in src[i:i + 600], "phải nằm trong khối bắt lỗi"
    assert "stale = True" in src[i:i + 600], "và bật cờ cảnh báo khi hỏng"
    # Và phải vá TRƯỚC khi đọc lại mục, nếu không lượt đọc vẫn ra sổ cũ.
    assert src.index("_reread_items", i) > i


def test_the_count_it_reports_is_the_number_of_rows_it_actually_wrote():
    """Con số này đi vào log vận hành. Đếm hai lần thì một lượt vá 3 mục báo 6,
    và người đọc log tưởng có sự cố lớn gấp đôi thực tế."""
    db = _db(items=[{"id": f"i{k}", "assignment_id": ASG, "submitted_at": None}
                    for k in range(3)],
             questions=_mcq(2),
             sessions=[_sess(f"s{k}", item=f"i{k}") for k in range(3)],
             attempts=[a for k in range(3) for a in _covers(f"s{k}", ["q0", "q1"])])
    assert _run(db) == len(db.marked) == 3


def test_a_graded_essay_is_repaired_even_when_the_quiz_tables_are_down():
    """Dòng tự luận đã chấm tự nó đủ: nó không cần biết bộ đề có bao nhiêu câu
    hay em ấy đã làm những phiên nào. Bắt nó đi chung đường đọc với nhóm trắc
    nghiệm nghĩa là một lượt đọc `quiz_questions` hỏng cũng chặn luôn những bài
    viết đã chấm — chặn vì một dữ liệu không ai dùng tới (codex vòng 3)."""
    for dead in ("quiz_questions", "quiz_sessions", "quiz_attempts"):
        db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None},
                        {"id": "i-mcq", "assignment_id": ASG, "submitted_at": None}],
                 questions=_mcq(10),
                 sessions=[_sess("s1", item="i-mcq")],
                 attempts=_covers("s1", [f"q{i}" for i in range(10)]),
                 writing=[{"id": "w-1", "class_assignment_item_id": ITEM,
                           "graded_at": "2026-08-09T11:00:00+00:00",
                           "total": 10, "clean": 7}])
        db.boom = {dead}
        # Vẫn NÉM, vì nhóm trắc nghiệm quả thật chưa vá được — nhưng bài viết
        # đã vào sổ trước khi ném.
        with pytest.raises(qs.ReconcileIncomplete):
            _run(db)
        assert [m["artifact_kind"] for m in db.marked] == ["course_writing"], dead


def test_a_single_failed_write_does_not_block_the_rest_of_the_class():
    """Một mục ghi hỏng không được cản những mục còn lại — nhưng lượt đối chiếu
    vẫn phải tự nhận là chưa trọn."""
    db = _db(items=[{"id": f"i{k}", "assignment_id": ASG, "submitted_at": None}
                    for k in range(3)],
             questions=_mcq(2),
             sessions=[_sess(f"s{k}", item=f"i{k}") for k in range(3)],
             attempts=[a for k in range(3) for a in _covers(f"s{k}", ["q0", "q1"])])
    calls = {"n": 0}

    def _flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("ghi hỏng")
        return True

    with patch.object(qs, "mark_item_submitted", _flaky), \
            patch.object(qs, "supabase_admin", db), \
            pytest.raises(qs.ReconcileIncomplete):
        qs.reconcile_course_items(db, [ASG])
    assert calls["n"] == 3, "phải thử đủ cả ba mục"


def test_an_unreadable_essay_table_is_reported_not_swallowed():
    """Đọc hỏng bảng tự luận nghĩa là có thể có bài đã nộp mà lượt này không
    thấy — làm nốt phần trắc nghiệm thì được, im lặng thì không."""
    db = _db(items=[{"id": "i-mcq", "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(2), sessions=[_sess("s1", item="i-mcq")],
             attempts=_covers("s1", ["q0", "q1"]))
    db.boom = {"course_writing_submissions"}
    with pytest.raises(qs.ReconcileIncomplete):
        _run(db)
    # …nhưng phần đọc được vẫn phải vá xong.
    assert [m["artifact_kind"] for m in db.marked] == ["quiz_session"]


def test_an_item_with_essay_evidence_is_never_stamped_twice():
    """Bài viết đã chấm là bằng chứng MẠNH HƠN, và mục ấy phải ra khỏi nhóm
    trắc nghiệm. Để nó chạy tiếp đường kia thì cùng một mục bị xét hai lần —
    tốn lượt đọc, và trong sổ là hai lệnh ghi cho một lần nộp."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(2),                 # bộ đề không còn câu tự luận
             sessions=[_sess("s1", total=2, correct=2)],
             attempts=_covers("s1", ["q0", "q1"]),
             writing=[{"id": "w-1", "class_assignment_item_id": ITEM,
                       "graded_at": "2026-08-09T11:00:00+00:00",
                       "total": 10, "clean": 7}])
    assert _run(db) == 1
    assert [m["artifact_kind"] for m in db.marked] == ["course_writing"]


def test_it_reads_and_writes_through_the_SAME_client_it_was_handed():
    """Nhận `db` để GHI mà ĐỌC bằng client toàn cục thì hai nửa của cùng một
    việc chạy trên hai kết nối.

    Hậu quả cụ thể: một chốt ở tầng router patch client CỦA ROUTER rồi yên tâm,
    trong khi lượt đọc vẫn gọi thẳng ra Supabase thật — chốt vẫn xanh, chỉ là
    xanh sau một vòng mạng (codex vòng 5). Đây là lớp lỗi đã ghi trong sổ tay
    dự án: bộ test backend không kín vì mỗi module giữ một `supabase_admin`
    riêng.

    Nên chốt này CỐ Ý không patch `qs.supabase_admin` — nó phải chạy trọn chỉ
    bằng client được truyền vào."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(2), sessions=[_sess("s1", total=2, correct=2)],
             attempts=_covers("s1", ["q0", "q1"]))
    assert qs.reconcile_course_items(db, [ASG]) == 1
    assert db.reads > 0 and len(db.marked) == 1


# ── Điểm trắc nghiệm KHÔNG được bị độ sạch bài viết đè lên ──────────────────
#
# Cảnh thật, đo trên prod 07/08. Cột `score` có BỐN người ghi mang HAI nghĩa:
#   · `course_verdict` ghi tỉ lệ đúng trắc nghiệm; `passed_at` xét trên số ấy
#   · bốn đường tự luận ghi độ sạch bài viết
# `mark_item_submitted` luỹ đẳng theo `submitted_at`, KHÔNG theo `score`, nên
# lượt sau xoá lượt trước: 11/11 mục đã nộp mang dấu `course_writing`, 6/11 dòng
# TỰ MÂU THUẪN. Em Dương Dương hiện "10% · đã đạt" (thật 95%), em Hà Linh "0%"
# (thật 65%).
#
# Luật khoá vào HÌNH DẠNG BỘ ĐỀ, không vào trạng thái dòng — xem
# `course_hand_in_score`.


def test_a_graded_essay_leaves_the_quiz_result_alone():
    """Đúng dòng của em Hà Linh: bộ đề có trắc nghiệm, bài viết 0/10 sạch."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(10) + [{"qid": "w1", "type": "writing"}],
             writing=[{"id": "w-1", "class_assignment_item_id": ITEM,
                       "graded_at": "2026-08-07T01:22:00+00:00", "total": 10, "clean": 0}])
    assert _run(db) == 1
    assert db.marked[0]["artifact_kind"] == "course_writing", "vẫn chốt sổ như cũ"
    assert "score" not in db.marked[0], "đã chạm vào cột điểm của bộ chấm trắc nghiệm"


def test_a_writing_only_bank_still_takes_the_essay_score():
    """Không có trắc nghiệm thì độ sạch bài viết ĐÚNG là kết quả duy nhất — bản
    vá không được vì chữa một hướng mà bịt luôn hướng kia."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=[{"qid": "w1", "type": "writing"}],
             writing=[{"id": "w-1", "class_assignment_item_id": ITEM,
                       "graded_at": "2026-08-07T01:22:00+00:00", "total": 10, "clean": 9}])
    assert _run(db) == 1
    assert db.marked[0]["score"] == 90.0


def test_an_essay_scored_HIGHER_is_also_refused():
    """Không phải "giữ số lớn hơn" mà là "cột ấy không thuộc về bài viết"."""
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(10) + [{"qid": "w1", "type": "writing"}],
             writing=[{"id": "w-1", "class_assignment_item_id": ITEM,
                       "graded_at": "2026-08-07T01:22:00+00:00", "total": 10, "clean": 10}])
    assert _run(db) == 1
    assert "score" not in db.marked[0]


def test_the_rule_is_pure_so_every_branch_is_reachable_without_a_database():
    """Khoá vào hình dạng bộ đề thay vì trạng thái dòng còn xoá luôn một CUỘC
    ĐUA: lượt nộp đọc dòng TRƯỚC khi gọi model chấm rồi ghi SAU, nên một lượt
    xét kết quả chạy xen vào giữa (hai tab) sẽ bị ghi đè y như cũ."""
    f = qs.course_hand_in_score
    assert f(has_mcq=True,  clean=0,  total=10) is None
    assert f(has_mcq=True,  clean=10, total=10) is None
    assert f(has_mcq=False, clean=9,  total=10) == 90.0
    assert f(has_mcq=False, clean=0,  total=10) == 0.0
    # Không có câu nào thì không có điểm — chia cho 0 là một lỗi 500 im lặng.
    assert f(has_mcq=False, clean=0,  total=0) is None
    assert f(has_mcq=False, clean=None, total=None) is None


# ── Đường ghi THẬT lúc nộp tự luận, không phải đường vá ─────────────────────

def test_the_LIVE_submit_path_uses_the_same_rule():
    """`submit_course_writing` là đường chạy thật trên sản phẩm; ba đường kia
    chỉ vá sổ hoặc đồng bộ. Vá đường vá mà bỏ đường thật là không chữa gì."""
    import inspect
    src = inspect.getsource(qs.submit_course_writing)
    assert "course_hand_in_score(" in src
    assert 'row["clean"] / row["total"]' not in src, "vẫn tự tính điểm"


def test_the_REGRADE_path_uses_it_too():
    """Người ghi thứ TƯ. Chốt điểm-danh cũ hụt nó vì nó chia cho `len(graded)`
    chứ không cho `total` — tôi đã suýt ship với nó còn nguyên."""
    import inspect
    src = inspect.getsource(qs.regrade_failed_course_writing)
    assert "course_hand_in_score(" in src
    assert "clean / len(graded)" not in src


def test_end_session_never_stamps_a_bank_that_has_writing():
    """Bất biến mà chú thích cũ ở `submit_course_writing` nói NGƯỢC lại — và
    chính lời nói ngược ấy khiến không ai đi kiểm đường ghi kia."""
    import inspect
    src = inspect.getsource(qs._course_work_is_done)
    i = src.index("if writing:")
    assert "return False" in src[i:i + 60]


def test_an_unreadable_bank_shape_withholds_the_score_but_still_closes_the_item():
    """Không biết bộ đề có trắc nghiệm hay không thì KHÔNG ĐOÁN.

    Đoán "không có" là ghi độ sạch bài viết đè lên kết quả trắc nghiệm — đúng
    lỗi gốc, chỉ khác là nó chỉ nổ khi `quiz_questions` đang hỏng. Chiều an toàn
    là không ghi: để trống một con số mà `course_verdict` sẽ điền, còn ghi nhầm
    thì xoá mất bằng chứng.

    Nhưng vẫn phải CHỐT SỔ: dòng tự luận đã chấm tự nó đủ, và bắt nó chờ
    `quiz_questions` là dựng lại ràng buộc mà cả hàm này sinh ra để tránh.
    """
    db = _db(items=[{"id": ITEM, "assignment_id": ASG, "submitted_at": None}],
             questions=_mcq(10) + [{"qid": "w1", "type": "writing"}],
             writing=[{"id": "w-1", "class_assignment_item_id": ITEM,
                       "graded_at": "2026-08-09T11:00:00+00:00",
                       "total": 10, "clean": 7}])
    db.boom = {"quiz_questions"}
    with pytest.raises(qs.ReconcileIncomplete):
        _run(db)                       # nói thật là chưa vá xong
    assert db.marked, "bài viết đã chấm phải vào sổ dù bảng bộ đề đang hỏng"
    assert db.marked[0]["artifact_kind"] == "course_writing"
    assert "score" not in db.marked[0], "đã ĐOÁN điểm khi không đọc được bộ đề"
