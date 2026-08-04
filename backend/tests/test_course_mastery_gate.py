"""Cổng THUỘC BÀI của bài tập theo buổi.

Học viên phải đạt ngưỡng % (mặc định 80) mới được kết luận PASS; dưới ngưỡng thì
kiểm tra lại bằng mẫu nhỏ (trộn câu + trộn đáp án, phía runner) tới khi đạt.

Điểm xét KHÔNG nhận từ client: client chỉ nêu tên các phiên, server cộng từ
những dòng nó đang giữ. Kết luận ghi thẳng vào class_assignment_items — giáo
viên đọc một cột, không khảo cổ bảng phiên.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from services import quiz_service as qs


# ── Stub DB (theo phong cách test_course_assignment) ─────────────────────────

class _Resp:
    def __init__(self, data, count=None): self.data = data; self.count = count


class _Table:
    def __init__(self, name, rows, log):
        self._name = name; self._rows = list(rows); self._log = log
        self._patch = None
    def select(self, *_a, **_k): return self
    def insert(self, row): self._log.append((self._name, "insert", row)); return self
    def update(self, patch): self._patch = patch; return self
    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def in_(self, f, vals):
        self._rows = [r for r in self._rows if r.get(f) in vals]
        return self
    def is_(self, *_a): return self
    def not_(self): return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def execute(self):
        if self._patch is not None:
            self._log.append((self._name, "update", self._patch,
                              [r.get("id") for r in self._rows]))
        return _Resp(self._rows, count=len(self._rows))


def _db(log, **tables):
    db = type("DB", (), {})()
    db.table = lambda n: _Table(n, tables.get(n, []), log)
    return db


_ITEM = {"id": "it-1", "assignment_id": "asg-1", "student_id": "st-1"}


def _sessions(n, *, correct=9, total=10, kind="run", **over):
    return [{
        "id": f"s-{i}", "user_id": "u-1", "bank_id": "bank-1",
        "class_assignment_item_id": "it-1", "kind": kind,
        "ended_by": "completed", "total_correct": correct, "total_questions": total,
        **over,
    } for i in range(n)]


def _verdict(log=None, *, sessions, item_row=None, config=None,
             item=_ITEM, ids=None):
    log = [] if log is None else log
    db = _db(
        log,
        class_assignments=[{"id": "asg-1", "content_config": config or {}}],
        quiz_sessions=sessions,
        class_assignment_items=[item_row or {"id": "it-1", "passed_at": None,
                                             "mastery": None, "score": None}],
    )
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_assignment_item_for", lambda b, u: item):
        return qs.course_verdict(
            user_id="u-1", bank_id="bank-1",
            session_ids=ids if ids is not None else [s["id"] for s in sessions],
        ), log


# ── mastery_config: kẹp về dải lành ──────────────────────────────────────────

def test_config_defaults():
    assert qs.mastery_config(None) == {"pass_pct": 80, "retake_size": 20}
    assert qs.mastery_config({"content_config": {}}) == {"pass_pct": 80, "retake_size": 20}


def test_config_reads_assignment():
    cfg = qs.mastery_config({"content_config": {"pass_pct": 90, "retake_size": 15}})
    assert cfg == {"pass_pct": 90, "retake_size": 15}


def test_config_clamps_garbage():
    # `800` gõ nhầm thay vì `80` không được biến bài thành không-thể-đạt.
    assert qs.mastery_config({"content_config": {"pass_pct": 800}})["pass_pct"] == 100
    assert qs.mastery_config({"content_config": {"pass_pct": 3}})["pass_pct"] == 50
    assert qs.mastery_config({"content_config": {"pass_pct": "x"}})["pass_pct"] == 80
    assert qs.mastery_config({"content_config": {"retake_size": 0}})["retake_size"] == 5


# ── Lượt chính: cộng đúng, kết luận đúng, ghi đúng ───────────────────────────

def test_run_pass_writes_verdict():
    out, log = _verdict(sessions=_sessions(10, correct=9, total=10))
    assert out["passed"] is True and out["pct"] == 90.0 and out["phase"] == "run"
    writes = [e for e in log if e[0] == "class_assignment_items" and e[1] == "update"]
    assert len(writes) == 1
    patch_ = writes[0][2]
    assert patch_["passed_at"] and patch_["score"] == 90.0
    assert patch_["mastery"]["threshold"] == 80
    assert patch_["mastery"]["attempts"][0]["phase"] == "run"


def test_run_fail_offers_retake_and_keeps_not_passed():
    out, log = _verdict(sessions=_sessions(10, correct=7, total=10))
    assert out["passed"] is False and out["pct"] == 70.0
    assert out["retake_size"] == 20 and out["threshold"] == 80
    patch_ = [e for e in log if e[1] == "update"][0][2]
    assert "passed_at" not in patch_          # chưa đạt thì KHÔNG có mốc đạt
    assert patch_["mastery"]["attempts"][0]["pct"] == 70.0


def test_threshold_comes_from_assignment_config():
    out, _ = _verdict(sessions=_sessions(10, correct=7, total=10),
                      config={"pass_pct": 60, "retake_size": 10})
    assert out["passed"] is True and out["threshold"] == 60
    assert out["retake_size"] == 10


def test_retake_pass_counts_retakes():
    prior = {"threshold": 80, "attempts": [
        {"phase": "run", "pct": 70.0, "at": "t", "sessions": ["s-a"]},
        {"phase": "retake", "pct": 75.0, "at": "t", "sessions": ["s-b"]},
    ]}
    out, log = _verdict(
        sessions=_sessions(1, correct=17, total=20, kind="retake"),
        item_row={"id": "it-1", "passed_at": None, "mastery": prior, "score": 70.0},
    )
    assert out["passed"] is True and out["phase"] == "retake" and out["pct"] == 85.0
    assert out["retakes"] == 2
    patch_ = [e for e in log if e[1] == "update"][0][2]
    assert len(patch_["mastery"]["attempts"]) == 3   # sổ cũ được GIỮ, không ghi đè


def test_already_passed_stays_passed_even_after_a_bad_replay():
    out, log = _verdict(
        sessions=_sessions(10, correct=5, total=10),
        item_row={"id": "it-1", "passed_at": "2026-08-01T00:00:00Z",
                  "mastery": {"threshold": 80, "attempts": []}, "score": 90.0},
    )
    assert out["passed"] is True                      # đạt rồi là đạt
    patch_ = [e for e in log if e[1] == "update"][0][2]
    assert "passed_at" not in patch_                  # mốc đạt KHÔNG bị dời


def test_reload_does_not_grow_the_ledger():
    """F5 ở màn kết quả gọi xét lại CÙNG lượt — sổ không phình theo số lần bấm."""
    ss = _sessions(10, correct=7, total=10)
    prior = {"threshold": 80, "attempts": [{
        "phase": "run", "pct": 70.0, "at": "t",
        "sessions": sorted(s["id"] for s in ss),
    }]}
    out, log = _verdict(
        sessions=ss,
        item_row={"id": "it-1", "passed_at": None, "mastery": prior, "score": 70.0},
    )
    assert out["passed"] is False
    patch_ = [e for e in log if e[1] == "update"][0][2]
    assert len(patch_["mastery"]["attempts"]) == 1   # vẫn MỘT dòng


# ── Từ chối lượt bẩn ─────────────────────────────────────────────────────────

def test_rejects_unknown_session():
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=_sessions(2), ids=["s-0", "s-1", "s-ghost"])
    assert e.value.status_code == 422


def test_rejects_foreign_session():
    ss = _sessions(2)
    ss[1]["user_id"] = "u-KHAC"
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss)
    assert e.value.status_code == 422


def test_rejects_wrong_item_link():
    ss = _sessions(2)
    ss[1]["class_assignment_item_id"] = "it-KHAC"
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss)
    assert e.value.status_code == 422


def test_rejects_unfinished_session():
    ss = _sessions(2)
    ss[1]["ended_by"] = None
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss)
    assert e.value.status_code == 422


def test_rejects_mixed_run_and_retake():
    ss = _sessions(1) + _sessions(1, kind="retake")
    ss[1]["id"] = "s-r"
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss)
    assert e.value.status_code == 422


def test_rejects_zero_graded():
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=_sessions(1, correct=0, total=0))
    assert e.value.status_code == 422


def test_rejects_when_assignment_gate_closed():
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=_sessions(10), item=None)
    assert e.value.status_code == 404


def test_write_failure_is_not_a_silent_pass():
    """Ghi kết luận hỏng → 500, KHÔNG trả passed=True rồi mất dấu."""
    class _Boom(_Table):
        def execute(self):
            if self._patch is not None:
                raise RuntimeError("db down")
            return super().execute()
    log = []
    db = type("DB", (), {})()
    tables = {
        "class_assignments": [{"id": "asg-1", "content_config": {}}],
        "quiz_sessions": _sessions(10),
        "class_assignment_items": [{"id": "it-1", "passed_at": None,
                                    "mastery": None, "score": None}],
    }
    db.table = lambda n: _Boom(n, tables.get(n, []), log)
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_assignment_item_for", lambda b, u: _ITEM):
        with pytest.raises(HTTPException) as e:
            qs.course_verdict(user_id="u-1", bank_id="bank-1",
                              session_ids=[f"s-{i}" for i in range(10)])
    assert e.value.status_code == 500


# ── start_session: cổng kind + an toàn trước migration ───────────────────────

def _start(kind, *, area="course"):
    log = []
    db = _db(log, quiz_sessions=[])
    # insert stub phải trả data để start_session không 500
    real_table = db.table
    def table(n):
        t = real_table(n)
        if n == "quiz_sessions":
            orig = t.insert
            def ins(row):
                orig(row)
                t._rows = [{"id": "sess-new"}]
                return t
            t.insert = ins
        return t
    db.table = table
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_bank_meta_or_404",
                      lambda b, u=None: {"id": b, "code": "C", "skill_area": area}), \
         patch.object(qs, "get_resume", lambda **_k: []), \
         patch.object(qs, "_assignment_item_for", lambda b, u: _ITEM):
        out = qs.start_session(user_id="u-1", bank_id="bank-1", kind=kind)
    rows = [e[2] for e in log if e[:2] == ("quiz_sessions", "insert")]
    return out, rows[0]


def test_start_session_default_omits_kind_column():
    """Luồng vocab/grammar đang chạy KHÔNG được phụ thuộc migration 189: phiên
    'run' không ghi cột kind."""
    _, row = _start("run")
    assert "kind" not in row


def test_start_session_retake_stamps_kind():
    _, row = _start("retake")
    assert row["kind"] == "retake"


def test_start_session_rejects_retake_outside_course():
    with pytest.raises(HTTPException) as e:
        _start("retake", area="vocab")
    assert e.value.status_code == 422


def test_start_session_rejects_unknown_kind():
    with pytest.raises(HTTPException) as e:
        _start("cheat")
    assert e.value.status_code == 422


# ── Đường dây router ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_router_wires_verdict_through():
    """Chạy qua ĐƯỜNG chứ không chỉ hàm: endpoint tồn tại và chuyển đủ tham số."""
    from routers import quiz as qr
    seen = {}
    async def fake_user(_a): return {"id": "u-1"}
    def fake_verdict(**kw): seen.update(kw); return {"passed": True}
    with patch.object(qr, "get_supabase_user", fake_user), \
         patch.object(qr.quiz_service, "course_verdict", fake_verdict):
        out = await qr.course_verdict(
            qr.CourseVerdictBody(bank_id="bank-1", session_ids=["s-1"]),
            authorization="Bearer x")
    assert out == {"passed": True}
    assert seen == {"user_id": "u-1", "bank_id": "bank-1", "session_ids": ["s-1"]}
