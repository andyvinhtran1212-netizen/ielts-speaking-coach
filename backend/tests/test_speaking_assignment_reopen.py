"""Mở lại bài Speaking đã giao — phiên CŨ, không dựng phiên mới.

Lỗi người dùng báo: làm xong rồi tải lại trang thì bài biến mất. Gốc là mỗi lần
bấm "Làm bài" lại POST /sessions tạo một phiên MỚI, nên bài vừa nói nằm lại
phiên cũ và màn hình mở ra trắng trơn.

Và hết hạn KHÔNG được xoá quyền đọc bài mình đã làm — cấm nộp là chuyện khác,
nó nằm ở `_record_class_hand_in` và ở phiếu làm bài.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from routers import class_student as mod
from routers import sessions as sess_mod


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, name, rows, log):
        self._name, self._rows, self._log = name, list(rows), log
    def select(self, *_a, **_k): return self
    def update(self, patch): self._log.append((self._name, "update", patch)); return self
    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def order(self, field, **k):
        # Mã thật DỰA VÀO cơ sở dữ liệu sắp xếp. Bộ giả không sắp thì phép kiểm
        # "mới nhất thắng" đo thứ tự tôi gõ vào, không đo hành vi.
        self._rows.sort(key=lambda r: str(r.get(field) or ""),
                        reverse=bool(k.get("desc")))
        return self
    def limit(self, *_a): return self
    def in_(self, *_a): return self
    def is_(self, *_a): return self
    @property
    def not_(self): return self
    def execute(self): return _Resp(self._rows)


def _db(log, **tables):
    db = type("DB", (), {})()
    db.table = lambda n: _Table(n, tables.get(n, []), log)
    return db


_STUDENT = {"id": "s1", "cohort_id": "co1", "full_name": "A", "student_code": "S1"}
_ITEM = {"id": "it1", "student_id": "s1", "assignment_id": "a1", "state": "opened"}


def _assignment(**over):
    a = {"id": "a1", "cohort_id": "co1", "skill": "speaking", "status": "published",
         "due_at": "2999-01-01T12:00:00+00:00", "publish_at": None,
         "content_config": {"mode": "practice", "part": 1, "topic": "Work"}}
    a.update(over)
    return a


async def _start(*, sessions, assignment=None, item=None, student=None):
    log = []
    db = _db(log,
             class_assignment_items=[item or _ITEM],
             class_assignments=[assignment or _assignment()],
             sessions=sessions)
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student or _STUDENT), \
         patch.object(mod, "supabase_admin", db):
        return await mod.start_assignment("it1", None), log


def _sess(sid="sess-cu"):
    return [{"id": sid, "user_id": "u1", "class_assignment_item_id": "it1",
             "started_at": "2026-08-01T00:00:00+00:00",
             "status": "in_progress",
             "resume_expires_at": "2999-01-01T00:00:00+00:00"}]


# ── Mở lại đúng phiên cũ ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reopens_the_existing_session_instead_of_making_a_new_one():
    out, _ = await _start(sessions=_sess())
    assert out["session_id"] == "sess-cu"
    # Không trả session_params: trang mà thấy nó sẽ POST /sessions và đẻ phiên mới.
    assert "session_params" not in out


@pytest.mark.asyncio
async def test_completed_session_opens_canonical_result_not_historical_player():
    sessions = _sess()
    sessions[0].update({
        "status": "completed",
        "completed_at": "2026-08-01T00:20:00+00:00",
        "renderer_affinity": "legacy",
    })
    out, _ = await _start(sessions=sessions)
    assert out["result_session_id"] == "sess-cu"
    assert "session_id" not in out
    assert "renderer_affinity" not in out


@pytest.mark.asyncio
async def test_first_time_still_creates_a_session_the_old_way():
    out, _ = await _start(sessions=[])
    assert "session_id" not in out
    assert out["session_params"]["class_assignment_item_id"] == "it1"


@pytest.mark.asyncio
async def test_another_learners_session_is_not_borrowed():
    rows = _sess()
    rows[0]["user_id"] = "u-KHAC"
    out, _ = await _start(sessions=rows)
    assert "session_id" not in out, "phiên của người khác không được nhận là của mình"


# ── Hết hạn: chặn nộp, KHÔNG chặn đọc ────────────────────────────────────────

@pytest.mark.asyncio
async def test_past_deadline_can_still_open_an_existing_session_to_review():
    out, _ = await _start(sessions=_sess(),
                          assignment=_assignment(due_at="2000-01-01T00:00:00+00:00"))
    assert out["session_id"] == "sess-cu"
    # Nói THẲNG là không còn nhận bài, để phiếu khoá đúng chứ không đoán.
    assert out["accepting"] is False


@pytest.mark.asyncio
async def test_past_deadline_without_any_session_is_still_refused():
    # Không có gì để xem, và mở ra chỉ để nộp thì đúng là phải chặn.
    with pytest.raises(HTTPException) as e:
        await _start(sessions=[],
                     assignment=_assignment(due_at="2000-01-01T00:00:00+00:00"))
    assert e.value.status_code == 409


@pytest.mark.asyncio
async def test_submitted_course_reopens_as_read_only_after_deadline():
    item = {**_ITEM, "submitted_at": "2026-08-19T18:23:55+00:00"}
    assignment = _assignment(
        skill="course", content_id="bank-grammar-05", content_config={},
        due_at="2000-01-01T00:00:00+00:00",
    )
    out, log = await _start(sessions=[], assignment=assignment, item=item)
    assert out == {
        "item_id": "it1", "assignment_id": "a1", "skill": "course",
        "bank_id": "bank-grammar-05", "review_only": True,
    }
    assert not [entry for entry in log if entry[1] == "update"], \
        "xem kết quả không được đổi lại state/opened_at của bài đã nộp"


@pytest.mark.asyncio
async def test_unsubmitted_course_remains_closed_after_deadline():
    assignment = _assignment(
        skill="course", content_id="bank-grammar-05", content_config={},
        due_at="2000-01-01T00:00:00+00:00",
    )
    with pytest.raises(HTTPException) as exc:
        await _start(sessions=[], assignment=assignment)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_still_accepting_says_so():
    out, _ = await _start(sessions=_sess())
    assert out["accepting"] is True


# ── GET /sessions/{id}: phiếu phải biết còn nhận bài không ───────────────────

def _task_state(*, assignment, item):
    db = _db([], class_assignment_items=[item], class_assignments=[assignment])
    with patch.object(sess_mod, "supabase_admin", db):
        return sess_mod._class_task_state({"id": "sess1",
                                           "class_assignment_item_id": item["id"]})


def _item(**over):
    it = {"id": "it1", "assignment_id": "a1", "submitted_at": None}
    it.update(over)
    return it


def test_class_task_state_reports_open_task():
    st = _task_state(assignment=_assignment(), item=_item())
    assert st["accepting"] is True and st["submitted_at"] is None


def test_class_task_state_reports_closed_task():
    st = _task_state(assignment=_assignment(due_at="2000-01-01T00:00:00+00:00"),
                     item=_item())
    assert st["accepting"] is False


def test_class_task_state_reports_hand_in():
    st = _task_state(assignment=_assignment(),
                     item=_item(submitted_at="2026-08-01T10:00:00+00:00"))
    assert st["submitted_at"] == "2026-08-01T10:00:00+00:00"


def test_plain_practice_session_has_no_class_task():
    assert sess_mod._class_task_state({"id": "s", "class_assignment_item_id": None}) is None


def test_a_broken_lookup_does_not_lock_the_sheet():
    """Đọc hỏng → None → phiếu chạy như trước. Khoá oan một bài còn hạn tệ hơn
    để lệnh nộp từ chối một bài đã muộn."""
    class _Boom:
        def table(self, _n): raise RuntimeError("db down")
    with patch.object(sess_mod, "supabase_admin", _Boom()):
        assert sess_mod._class_task_state({"id": "s",
                                           "class_assignment_item_id": "it1"}) is None


# ── Chuyển lớp: cohort là cổng ĐẦU TIÊN (codex #931) ────────────────────────

@pytest.mark.asyncio
async def test_transferred_learner_cannot_reopen_the_old_class_work():
    """Mục bài tập CỐ Ý sống sót khi học viên chuyển lớp. Nếu cổng cohort đứng
    sau đường mở-lại thì em ấy vẫn mở (và nộp tiếp) bài của lớp cũ — đúng thứ
    `/my-assignments` cố tình giấu đi."""
    with pytest.raises(HTTPException) as e:
        await _start(sessions=_sess(),
                     student={**_STUDENT, "cohort_id": "co-LOP-MOI"})
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_transferred_learner_is_blocked_even_before_the_deadline_matters():
    # Cả khi bài còn hạn: sai lớp là chặn hết, kể cả xem lại.
    with pytest.raises(HTTPException) as e:
        await _start(sessions=[],
                     student={**_STUDENT, "cohort_id": "co-LOP-MOI"})
    assert e.value.status_code == 404


# ── Chọn phiên nào khi có nhiều (codex #931 vòng 4) ─────────────────────────

async def _pick(sessions, responses=()):
    log = []
    db = _db(log,
             class_assignment_items=[_ITEM],
             class_assignments=[_assignment()],
             sessions=sessions,
             responses=list(responses))
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=_STUDENT), \
         patch.object(mod, "supabase_admin", db):
        out = await mod.start_assignment("it1", None)
    return out.get("session_id") or out.get("result_session_id")


def _s(sid, started, **over):
    return {"id": sid, "user_id": "u1", "class_assignment_item_id": "it1",
            "started_at": started, "completed_at": None, "status": "in_progress",
            "resume_expires_at": "2999-01-01T00:00:00+00:00",
            **over}


@pytest.mark.asyncio
async def test_completed_session_beats_a_newer_blank_one():
    """Hành vi CŨ đã để lại những phiên TRỐNG mới hơn phiên thật trên prod.
    Chọn theo `started_at` thôi thì mở lại vẫn ra phiếu trắng — đúng cái lỗi
    hàm này sinh ra để chữa."""
    got = await _pick([
        _s("sess-TRONG", "2026-08-02T00:00:00+00:00"),          # mới hơn, rỗng
        _s("sess-XONG",  "2026-08-01T00:00:00+00:00",
           completed_at="2026-08-01T01:00:00+00:00", status="completed"),
    ])
    assert got == "sess-XONG"


@pytest.mark.asyncio
async def test_a_session_holding_work_beats_a_newer_blank_one():
    got = await _pick(
        [_s("sess-TRONG", "2026-08-02T00:00:00+00:00"),
         _s("sess-CO-BAI", "2026-08-01T00:00:00+00:00")],
        responses=[{"session_id": "sess-CO-BAI"}])
    assert got == "sess-CO-BAI"


@pytest.mark.asyncio
async def test_all_blank_falls_back_to_the_newest():
    got = await _pick([
        _s("sess-CU",  "2026-08-01T00:00:00+00:00"),
        _s("sess-MOI", "2026-08-02T00:00:00+00:00"),
    ])
    assert got == "sess-MOI", "chưa có gì thì mở cái nào cũng như nhau — lấy mới nhất"
