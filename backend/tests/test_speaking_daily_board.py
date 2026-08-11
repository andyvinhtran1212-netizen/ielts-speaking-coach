"""Bảng bài Speaking HẰNG NGÀY của một lớp: học viên × ngày.

Lớp có bài gần như mỗi ngày, nên câu hỏi thật của giáo viên không phải "bài hôm
nay ai nộp" mà là "ba tuần qua em nào đứt quãng" — trả lời câu ấy bằng cách mở
hai chục bảng tổng kết của từng bài là không trả lời được.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from routers import admin_class_assignments as adm


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, rows): self._rows = list(rows)
    def select(self, *_a, **_k): return self
    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def in_(self, f, vals):
        self._rows = [r for r in self._rows if r.get(f) in vals]
        return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def range(self, s, e): self._rows = self._rows[s:e + 1]; return self
    def execute(self): return _Resp(self._rows)


def _db(**tables):
    db = type("DB", (), {})()
    db.table = lambda n: _Table(tables.get(n, []))
    return db


def _asg(aid, day, *, kind="daily", status="published", hour="12:00"):
    """`day` là ngày VN; 12:00Z = 19:00 giờ VN cùng ngày."""
    return {"id": aid, "title": "Bài " + aid, "kind": kind, "status": status,
            "cohort_id": "co1", "skill": "speaking",
            "due_at": f"{day}T{hour}:00+00:00", "created_at": f"{day}T00:00:00+00:00"}


def _item(aid, sid, *, submitted=None, score=None, artifact=None):
    return {"id": f"it-{aid}-{sid}", "assignment_id": aid, "student_id": sid,
            "submitted_at": submitted, "score": score,
            "artifact_kind": "session" if artifact else None,
            "artifact_id": artifact}


_STUDENTS = [
    {"id": "s1", "full_name": "An", "student_code": "A1", "user_id": "u1"},
    {"id": "s2", "full_name": "Bình", "student_code": "B1", "user_id": "u2"},
]


async def _board(*, assignments, items, students=None, days=21, reconcile=None):
    db = _db(cohorts=[{"id": "co1"}],
             class_assignments=assignments,
             class_assignment_items=items,
             students=students if students is not None else _STUDENTS)
    with patch.object(adm, "require_admin", AsyncMock(return_value=None)), \
         patch.object(adm, "supabase_admin", db), \
         patch.object(adm, "reconcile_ledger_from_sessions", reconcile or (lambda *a: None)), \
         patch.object(adm, "_require_cohort", lambda _c: None):
        return await adm.speaking_daily_board("co1", days, None)


def _row(out, name):
    return next(r for r in out["students"] if r["name"] == name)


def _days(out: dict) -> list[str]:
    """Ngày của các cột, KHÔNG lặp.

    Trục của bảng đổi từ NGÀY sang BÀI GIAO (một ngày giao hai bài thì bản cũ
    chỉ hiện được một). Các chốt dưới đây vẫn nói về ngày, nên đọc ngày ra từ
    danh sách bài — giữ nguyên điều chúng đang chứng minh.
    """
    seen: list[str] = []
    for t in out.get("tasks") or []:
        if t["day"] not in seen:
            seen.append(t["day"])
    return seen


# ── Lưới cơ bản ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_one_column_per_day_newest_last():
    out = await _board(
        assignments=[_asg("a1", "2026-08-01"), _asg("a2", "2026-08-03")],
        items=[_item("a1", "s1"), _item("a2", "s1")])
    assert _days(out) == ["2026-08-01", "2026-08-03"]


@pytest.mark.asyncio
async def test_states_say_what_happened():
    out = await _board(
        assignments=[_asg("a1", "2000-01-01"), _asg("a2", "2999-01-01")],
        items=[
            _item("a1", "s1", submitted="2000-01-01T11:00:00+00:00"),   # trước hạn
            _item("a1", "s2"),                                          # quá hạn, trống
            _item("a2", "s1"),                                          # chưa tới hạn
        ])
    an = _row(out, "An")["cells"]
    binh = _row(out, "Bình")["cells"]
    assert [c["state"] for c in an] == ["done", "pending"]
    assert binh[0]["state"] == "missing"
    assert binh[1]["state"] == "none", "không được giao thì không phải bỏ bài"


@pytest.mark.asyncio
async def test_late_is_its_own_state_not_done():
    out = await _board(
        assignments=[_asg("a1", "2000-01-01")],
        items=[_item("a1", "s1", submitted="2000-01-02T00:00:00+00:00")])
    assert _row(out, "An")["cells"][0]["state"] == "late"


@pytest.mark.asyncio
async def test_only_daily_assignments():
    # Bài sau buổi học có nhịp khác; xếp chung sẽ tạo cột trống đọc như bỏ bài.
    out = await _board(
        assignments=[_asg("a1", "2026-08-01"), _asg("a2", "2026-08-02", kind="lesson")],
        items=[_item("a1", "s1"), _item("a2", "s1")])
    assert _days(out) == ["2026-08-01"]


@pytest.mark.asyncio
async def test_archived_assignment_is_not_counted_as_missed():
    # Lưu trữ là quyết định của giáo viên, không phải lỗi của học viên.
    out = await _board(
        assignments=[_asg("a1", "2000-01-01", status="archived")],
        items=[_item("a1", "s1")])
    assert _days(out) == []


# ── Ngày là ngày VIỆT NAM ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_day_is_the_vietnam_calendar_day():
    """Hạn 07:00 sáng giờ VN = 00:00Z CÙNG ngày; nhưng 23:00 giờ VN = 16:00Z.
    Lấy ngày UTC cho ca sau vẫn đúng — ca sai là hạn sáng sớm: 06:00 VN ngày 02
    là 23:00Z ngày 01, và cả cột sẽ lệch một ngày."""
    out = await _board(
        assignments=[{"id": "a1", "title": "x", "kind": "daily", "status": "published",
                      "cohort_id": "co1", "skill": "speaking",
                      "due_at": "2026-08-01T23:00:00+00:00",   # = 06:00 VN ngày 02
                      "created_at": "2026-08-01T00:00:00+00:00"}],
        items=[_item("a1", "s1")])
    assert _days(out) == ["2026-08-02"], "ngày phải theo giờ Việt Nam"


# ── Gộp và xếp ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_two_assignments_same_day_merge_best_first():
    # Giao lại / giao bù: ô nói về NGÀY, nên nộp được một bài là ngày ấy có làm.
    # Ô TỐT đứng TRƯỚC: "cuối thắng" sẽ cho ra `missing`, "tốt nhất thắng" cho
    # `done`. Để ô tốt ở cuối thì hai luật cho cùng kết quả và phép kiểm này
    # không chứng minh được gì.
    out = await _board(
        assignments=[_asg("a1", "2000-01-01"), _asg("a2", "2000-01-01", hour="13:00")],
        items=[_item("a1", "s1", submitted="2000-01-01T11:00:00+00:00"),
               _item("a2", "s1")])
    assert len(_days(out)) == 1
    assert _row(out, "An")["cells"][0]["state"] == "done"


@pytest.mark.asyncio
async def test_most_gaps_first_it_is_a_todo_list():
    out = await _board(
        assignments=[_asg("a1", "2000-01-01"), _asg("a2", "2000-01-02")],
        items=[_item("a1", "s1", submitted="2000-01-01T11:00:00+00:00"),
               _item("a2", "s1", submitted="2000-01-02T11:00:00+00:00"),
               _item("a1", "s2"), _item("a2", "s2")])
    assert out["students"][0]["name"] == "Bình"
    assert out["students"][0]["missing"] == 2


@pytest.mark.asyncio
async def test_window_keeps_the_most_recent_days():
    out = await _board(
        assignments=[_asg(f"a{i}", f"2026-08-{i:02d}") for i in range(1, 11)],
        items=[_item(f"a{i}", "s1") for i in range(1, 11)],
        days=3)
    assert _days(out) == ["2026-08-08", "2026-08-09", "2026-08-10"]


@pytest.mark.asyncio
async def test_cell_carries_the_session_so_a_click_can_open_it():
    out = await _board(
        assignments=[_asg("a1", "2000-01-01")],
        items=[_item("a1", "s1", submitted="2000-01-01T11:00:00+00:00",
                     score=6.5, artifact="sess-9")])
    cell = _row(out, "An")["cells"][0]
    assert cell["session_id"] == "sess-9" and cell["score"] == 6.5
    assert _row(out, "An")["avg_band"] == 6.5


@pytest.mark.asyncio
async def test_unactivated_learner_is_marked_not_silently_lazy():
    out = await _board(
        assignments=[_asg("a1", "2000-01-01")],
        items=[_item("a1", "s3")],
        students=[{"id": "s3", "full_name": "Chi", "student_code": "C1", "user_id": None}])
    assert _row(out, "Chi")["activated"] is False


@pytest.mark.asyncio
async def test_no_daily_assignments_is_an_ordinary_empty_answer():
    out = await _board(assignments=[], items=[])
    assert out == {"tasks": [], "students": [], "assignment_count": 0, "stale": False}


# ── Vá sổ trước khi đếm (codex #931) ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_ledger_is_reconciled_before_counting():
    """Móc chốt sổ lúc hoàn thành phiên là best-effort. Đọc thẳng sổ nghĩa là
    một phiên ĐÃ XONG vẫn hiện ✕ cho tới khi ai đó mở bảng tổng kết của đúng
    bài ấy — mà bảng này mới là chỗ giáo viên nhìn TRƯỚC."""
    seen = {}
    def _rec(db, aids):
        seen["aids"] = list(aids)
    out = await _board(assignments=[_asg("a1", "2000-01-01")],
                       items=[_item("a1", "s1")], reconcile=_rec)
    assert seen.get("aids") == ["a1"], "phải vá sổ cho đúng những bài đang vẽ"
    assert out["stale"] is False


@pytest.mark.asyncio
async def test_a_failed_reconcile_says_so_instead_of_lying_quietly():
    def _boom(db, aids):
        raise RuntimeError("db down")
    out = await _board(assignments=[_asg("a1", "2000-01-01")],
                       items=[_item("a1", "s1")], reconcile=_boom)
    assert out["stale"] is True, "im lặng là để giáo viên nhắc nhầm một em đã nộp"
    assert _days(out) == ["2000-01-01"], "vẫn phải vẽ được bảng"


# ── Trục là BÀI GIAO, không phải NGÀY ────────────────────────────────────────

@pytest.mark.asyncio
async def test_two_tasks_on_the_same_day_are_two_columns():
    """Trục cũ khoá theo NGÀY rồi gộp: một ngày giao hai bài chỉ hiện được một,
    và một em nộp bài A mà bỏ bài B đọc thành "ngày ấy có làm"."""
    out = await _board(
        assignments=[_asg("a1", "2000-01-01", hour="11:00"),
                     _asg("a2", "2000-01-01", hour="12:00")],
        items=[_item("a1", "s1", submitted="2000-01-01T10:00:00+00:00", score=6.5),
               _item("a2", "s1")])
    assert len(out["tasks"]) == 2, "hai bài cùng ngày phải là HAI cột"
    assert [t["day"] for t in out["tasks"]] == ["2000-01-01", "2000-01-01"]
    cells = out["students"][0]["cells"]
    assert [c["state"] for c in cells] == ["done", "missing"], \
        "bỏ bài thứ hai KHÔNG được bị bài thứ nhất che mất"
    assert out["students"][0]["missing"] == 1


@pytest.mark.asyncio
async def test_the_longest_gap_is_reported_not_just_the_total():
    """Bỏ 3 bài rải rác là quên; bỏ 3 bài liên tiếp là em ấy đã rời đi."""
    from routers.admin_class_assignments import _longest_missing_run
    S = lambda *a: [{"state": x} for x in a]      # noqa: E731
    assert _longest_missing_run(S("missing", "done", "missing", "done", "missing")) == 1
    assert _longest_missing_run(S("done", "missing", "missing", "missing")) == 3
    # Không được giao thì không phải một lần quay lại — nó không CẮT quãng.
    assert _longest_missing_run(S("missing", "none", "missing")) == 2
    assert _longest_missing_run([]) == 0


@pytest.mark.asyncio
async def test_every_task_column_carries_its_title():
    """Đầu cột chỉ có ngày thì hai bài cùng ngày không phân biệt được."""
    out = await _board(assignments=[_asg("a1", "2000-01-01")],
                       items=[_item("a1", "s1")])
    assert out["tasks"][0]["title"] == "Bài a1"
    assert out["tasks"][0]["day"] == "2000-01-01"
