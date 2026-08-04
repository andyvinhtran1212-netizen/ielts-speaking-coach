"""Cổng THUỘC BÀI của bài tập theo buổi.

Học viên phải đạt ngưỡng % (mặc định 80) mới được kết luận PASS; dưới ngưỡng thì
kiểm tra lại bằng mẫu nhỏ (trộn câu + trộn đáp án, phía runner) tới khi đạt.

Ba tính chất then chốt (codex #928 vòng 1 đòi cả ba):
  · server TỰ CHẤM LẠI từ answer_given + đáp án gốc — không tin bất kỳ tổng nào
    client khai (kể cả is_correct trong attempts);
  · lượt chính phải PHỦ ĐỦ mọi câu trắc nghiệm của bộ — nêu tên thiếu phiên
    (bỏ chặng kém) là bác, không phải điểm ảo;
  · kết luận ghi thẳng vào class_assignment_items — giáo viên đọc một cột.
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
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def range(self, s, e): self._rows = self._rows[s:e + 1]; return self
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


def _sessions(n, *, kind="run", **over):
    return [{
        "id": f"s-{i}", "user_id": "u-1", "bank_id": "bank-1",
        "class_assignment_item_id": "it-1", "kind": kind,
        "ended_by": "completed", **over,
    } for i in range(n)]


def _questions(n, writing=0):
    """Bộ đề: n câu trắc nghiệm (đáp án i % 4) + `writing` câu tự luận."""
    out = [{"bank_id": "bank-1", "qid": f"q{i}", "answer": i % 4, "type": "mcq"}
           for i in range(n)]
    out += [{"bank_id": "bank-1", "qid": f"w{i}", "answer": None, "type": "writing"}
            for i in range(writing)]
    return out


def _attempts(sessions, given):
    """Chia các lượt làm đều vào các phiên. `given`: {qid: answer_given}."""
    sids = [s["id"] for s in sessions]
    return [{"session_id": sids[i % len(sids)], "qid": qid, "answer_given": str(v)}
            for i, (qid, v) in enumerate(given.items())]


def _given(n_q, wrong=0):
    """Đáp án đã lưu: `wrong` câu đầu sai (lệch 1), còn lại đúng."""
    return {f"q{i}": ((i % 4) + 1) % 4 if i < wrong else i % 4 for i in range(n_q)}


def _verdict(log=None, *, sessions, questions=None, attempts=None,
             item_row=None, config=None, item=_ITEM, ids=None):
    log = [] if log is None else log
    db = _db(
        log,
        class_assignments=[{"id": "asg-1", "content_config": config or {}}],
        quiz_sessions=sessions,
        quiz_questions=questions if questions is not None else _questions(10),
        quiz_attempts=attempts if attempts is not None else [],
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


# ── Lượt chính: server tự chấm, kết luận đúng, ghi đúng ──────────────────────

def test_run_pass_writes_verdict():
    ss = _sessions(2)
    out, log = _verdict(sessions=ss, attempts=_attempts(ss, _given(10, wrong=1)))
    assert out["passed"] is True and out["pct"] == 90.0 and out["phase"] == "run"
    writes = [e for e in log if e[0] == "class_assignment_items" and e[1] == "update"]
    assert len(writes) == 1
    patch_ = writes[0][2]
    assert patch_["passed_at"] and patch_["score"] == 90.0
    assert patch_["mastery"]["threshold"] == 80
    assert patch_["mastery"]["attempts"][0]["phase"] == "run"


def test_run_fail_offers_retake_and_keeps_not_passed():
    ss = _sessions(2)
    out, log = _verdict(sessions=ss, attempts=_attempts(ss, _given(10, wrong=3)))
    assert out["passed"] is False and out["pct"] == 70.0
    assert out["retake_size"] == 20 and out["threshold"] == 80
    patch_ = [e for e in log if e[1] == "update"][0][2]
    assert "passed_at" not in patch_          # chưa đạt thì KHÔNG có mốc đạt
    assert patch_["mastery"]["attempts"][0]["pct"] == 70.0


def test_server_regrades_and_ignores_client_claims():
    """Client khai gì kệ client: điểm tính từ answer_given so với đáp án gốc.

    Attempts ở đây mang is_correct=True cho MỌI câu (lời khai láo) nhưng
    answer_given sai 5/10 — server phải ra 50%, không phải 100%."""
    ss = _sessions(2)
    att = _attempts(ss, _given(10, wrong=5))
    for a in att:
        a["is_correct"] = True            # lời khai — phải bị BỎ QUA
    out, _ = _verdict(sessions=ss, attempts=att)
    assert out["pct"] == 50.0 and out["passed"] is False


def test_threshold_comes_from_assignment_config():
    ss = _sessions(2)
    out, _ = _verdict(sessions=ss, attempts=_attempts(ss, _given(10, wrong=3)),
                      config={"pass_pct": 60, "retake_size": 10})
    assert out["passed"] is True and out["threshold"] == 60
    assert out["retake_size"] == 10


def test_retake_pass_counts_retakes():
    prior = {"threshold": 80, "attempts": [
        {"phase": "run", "pct": 70.0, "at": "t", "sessions": ["s-a"]},
        {"phase": "retake", "pct": 75.0, "at": "t", "sessions": ["s-b"]},
    ]}
    ss = _sessions(1, kind="retake")
    # mẫu 5 câu (config), 4 đúng 1 sai → 80%
    given = {f"q{i}": (i % 4) if i else 1 for i in range(5)}
    out, log = _verdict(
        sessions=ss, attempts=_attempts(ss, given),
        config={"retake_size": 5},
        item_row={"id": "it-1", "passed_at": None, "mastery": prior, "score": 70.0},
    )
    assert out["passed"] is True and out["phase"] == "retake" and out["pct"] == 80.0
    assert out["retakes"] == 2
    patch_ = [e for e in log if e[1] == "update"][0][2]
    assert len(patch_["mastery"]["attempts"]) == 3   # sổ cũ được GIỮ, không ghi đè


def test_already_passed_stays_passed_even_after_a_bad_replay():
    ss = _sessions(2)
    out, log = _verdict(
        sessions=ss, attempts=_attempts(ss, _given(10, wrong=5)),
        item_row={"id": "it-1", "passed_at": "2026-08-01T00:00:00Z",
                  "mastery": {"threshold": 80, "attempts": []}, "score": 90.0},
    )
    assert out["passed"] is True                      # đạt rồi là đạt
    patch_ = [e for e in log if e[1] == "update"][0][2]
    assert "passed_at" not in patch_                  # mốc đạt KHÔNG bị dời


def test_reload_does_not_grow_the_ledger():
    """F5 ở màn kết quả gọi xét lại CÙNG lượt — sổ không phình theo số lần bấm."""
    ss = _sessions(2)
    prior = {"threshold": 80, "attempts": [{
        "phase": "run", "pct": 70.0, "at": "t",
        "sessions": sorted(s["id"] for s in ss),
    }]}
    out, log = _verdict(
        sessions=ss, attempts=_attempts(ss, _given(10, wrong=3)),
        item_row={"id": "it-1", "passed_at": None, "mastery": prior, "score": 70.0},
    )
    assert out["passed"] is False and out["pct"] == 70.0   # vẫn TRẢ LỜI đầy đủ
    # KHÔNG một lần ghi nào: sổ không phình, và score không bị chạm (codex R4:
    # ghi đè score ở lượt trùng là lấy điểm cũ đè lên điểm mới nhất).
    assert [e for e in log if e[1] == "update"] == []


# ── Phủ đủ đề: chặn cả gian lận lẫn dương tính giả ───────────────────────────

def test_run_missing_questions_is_rejected_not_scored():
    """Nêu tên thiếu phiên (bỏ chặng làm kém / chặng rớt mạng) → 422, KHÔNG
    lấy mẫu số co lại làm điểm ảo. Đây là phát hiện P1 của codex."""
    ss = _sessions(2)
    given = _given(10, wrong=0)
    for i in range(4):
        given.pop(f"q{i}")                # 4 câu không có lượt làm
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss, attempts=_attempts(ss, given))
    assert e.value.status_code == 422
    assert "thiếu 4 câu" in e.value.detail


def test_retake_below_sample_size_is_rejected():
    """Kiểm tra lại 1 câu dễ rồi đòi đạt — không: phải đủ cỡ mẫu cấu hình."""
    ss = _sessions(1, kind="retake")
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss, attempts=_attempts(ss, {"q0": 0}),
                 config={"retake_size": 5})
    assert e.value.status_code == 422
    assert "đủ 5 câu" in e.value.detail


def test_retake_sample_clamped_to_pool():
    """Kho 3 câu, cấu hình 20 → mẫu 3 câu là đủ (không thể đòi hơn kho)."""
    ss = _sessions(1, kind="retake")
    prior = {"threshold": 80, "attempts": [
        {"phase": "run", "pct": 60.0, "at": "t", "sessions": ["s-a"]},
    ]}
    out, _ = _verdict(sessions=ss, questions=_questions(3),
                      attempts=_attempts(ss, {f"q{i}": i % 4 for i in range(3)}),
                      item_row={"id": "it-1", "passed_at": None,
                                "mastery": prior, "score": 60.0})
    assert out["passed"] is True and out["pct"] == 100.0


def test_duplicate_question_is_rejected():
    ss = _sessions(2)
    att = _attempts(ss, _given(10))
    att.append({"session_id": ss[0]["id"], "qid": "q0", "answer_given": "0"})
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss, attempts=att)
    assert e.value.status_code == 422


def test_foreign_question_is_rejected():
    """Câu không thuộc bộ (kể cả câu tự luận nhồi kèm) — bác cả lượt."""
    ss = _sessions(2)
    att = _attempts(ss, _given(10)) + [
        {"session_id": ss[0]["id"], "qid": "w0", "answer_given": "1"}]
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss, questions=_questions(10, writing=1), attempts=att)
    assert e.value.status_code == 422


def test_all_writing_bank_is_rejected():
    ss = _sessions(1)
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss, questions=_questions(0, writing=3), attempts=[])
    assert e.value.status_code == 422


def test_retake_requires_a_failed_run_first():
    """Tự tạo phiên retake khi CHƯA có lượt chính dưới ngưỡng → 422 (codex R2).
    Không có chốt này thì cỡ-mẫu câu là đủ mua kết luận đạt, khỏi làm đủ bài."""
    ss = _sessions(1, kind="retake")
    given = {f"q{i}": i % 4 for i in range(5)}
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss, attempts=_attempts(ss, given),
                 config={"retake_size": 5})
    assert e.value.status_code == 422
    assert "lượt làm chính" in e.value.detail


def test_retake_after_passing_run_threshold_change_still_needs_failed_run():
    """Sổ chỉ có lượt chính ĐÃ ĐẠT → retake vẫn bị bác (không có gì để gỡ)."""
    prior = {"threshold": 80, "attempts": [
        {"phase": "run", "pct": 90.0, "at": "t", "sessions": ["s-a"]},
    ]}
    ss = _sessions(1, kind="retake")
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss, attempts=_attempts(ss, {f"q{i}": i % 4 for i in range(5)}),
                 config={"retake_size": 5},
                 item_row={"id": "it-1", "passed_at": "t", "mastery": prior, "score": 90.0})
    # đã đạt thì passed=True vẫn trả về ở nhánh already — nhưng nếu chưa passed_at
    # mà chỉ có run-đạt trong sổ thì retake không có cửa.
    assert e.value.status_code == 422


def test_reload_after_failed_retake_does_not_duplicate_the_run():
    """Trượt retake (40%) xong F5: trang nộp lại bộ phiên lượt CHÍNH (70%).
    Lượt trùng → không ghi gì: sổ giữ nguyên VÀ score 40% của lần thử mới nhất
    không bị 70% cũ đè lên (codex R4)."""
    ss = _sessions(2)
    run_key = sorted(s["id"] for s in ss)
    prior = {"threshold": 80, "attempts": [
        {"phase": "run", "pct": 70.0, "at": "t", "sessions": run_key},
        {"phase": "retake", "pct": 40.0, "at": "t", "sessions": ["s-r"]},
    ]}
    out, log = _verdict(
        sessions=ss, attempts=_attempts(ss, _given(10, wrong=3)),
        item_row={"id": "it-1", "passed_at": None, "mastery": prior, "score": 40.0},
    )
    assert out["passed"] is False
    assert [e for e in log if e[1] == "update"] == [], \
        "ghi ở đây là lấy 70% cũ đè lên 40% mới — bảng giáo viên nói ngược dòng thời gian"


def test_retake_must_be_exactly_one_session():
    """Ghép nhiều phiên retake dở dang cho đủ cỡ mẫu → 422 (codex R3)."""
    ss = _sessions(2, kind="retake")
    prior = {"threshold": 80, "attempts": [
        {"phase": "run", "pct": 60.0, "at": "t", "sessions": ["s-a"]},
    ]}
    given = {f"q{i}": i % 4 for i in range(5)}
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss, attempts=_attempts(ss, given),
                 config={"retake_size": 5},
                 item_row={"id": "it-1", "passed_at": None,
                           "mastery": prior, "score": 60.0})
    assert e.value.status_code == 422
    assert "đúng một phiên" in e.value.detail


def test_cas_conflict_rereads_and_merges_before_writing():
    """Hai tab, mỗi tab một retake KHÁC nhau, cùng chốt: kẻ thua vòng ghi phải
    ĐỌC LẠI sổ mới rồi gộp — kết quả tab kia sống sót, không bị đè (codex R3)."""
    other = {"phase": "retake", "pct": 55.0, "at": "t2", "sessions": ["s-tab2"]}
    base_run = {"phase": "run", "pct": 70.0, "at": "t", "sessions": ["s-a", "s-b"]}
    stale_row = {"id": "it-1", "passed_at": None, "updated_at": "T0",
                 "mastery": {"threshold": 80, "attempts": [base_run]}, "score": 70.0}
    fresh_row = {"id": "it-1", "passed_at": None, "updated_at": "T1",
                 "mastery": {"threshold": 80, "attempts": [base_run, other]},
                 "score": 55.0}

    class _CasTable(_Table):
        updates = 0
        def execute(self):
            if self._patch is not None:
                _CasTable.updates += 1
                if _CasTable.updates == 1:      # tab kia vừa ghi trước — thua CAS
                    self._log.append((self._name, "update-lost", self._patch))
                    return _Resp([])
                self._log.append((self._name, "update", self._patch,
                                  [r.get("id") for r in self._rows] or ["it-1"]))
                return _Resp([{"id": "it-1"}])
            return super().execute()

    _CasTable.updates = 0
    log = []
    ss = _sessions(1, kind="retake")            # retake của TAB NÀY: phiên s-0
    given = {f"q{i}": (i % 4) if i > 1 else 99 for i in range(5)}   # 3/5 đúng = 60%
    reads = {"n": 0}
    def table(n):
        rows = {
            "class_assignments": [{"id": "asg-1",
                                   "content_config": {"retake_size": 5}}],
            "quiz_sessions": ss,
            "quiz_questions": _questions(10),
            "quiz_attempts": _attempts(ss, given),
        }.get(n)
        if n == "class_assignment_items":
            reads["n"] += 1
            rows = [stale_row if reads["n"] == 1 else fresh_row]
        return _CasTable(n, rows or [], log)
    db = type("DB", (), {})()
    db.table = table
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_assignment_item_for", lambda b, u: _ITEM):
        out = qs.course_verdict(user_id="u-1", bank_id="bank-1",
                                session_ids=[x["id"] for x in ss])
    assert out["passed"] is False and out["pct"] == 60.0
    final = [e for e in log if e[1] == "update"][-1][2]
    phases = [(a["phase"], a["pct"]) for a in final["mastery"]["attempts"]]
    assert ("retake", 55.0) in phases, "kết quả của tab kia phải SỐNG SÓT"
    assert ("retake", 60.0) in phases, "kết quả của tab này cũng phải vào sổ"
    assert phases.count(("run", 70.0)) == 1, "lượt chính không bị nhân đôi"

# ── Từ chối lượt bẩn ─────────────────────────────────────────────────────────

def test_rejects_unknown_session():
    ss = _sessions(2)
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss, ids=["s-0", "s-1", "s-ghost"])
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


def test_rejects_when_assignment_gate_closed():
    ss = _sessions(2)
    with pytest.raises(HTTPException) as e:
        _verdict(sessions=ss, item=None)
    assert e.value.status_code == 404


def test_write_failure_is_not_a_silent_pass():
    """Ghi kết luận hỏng → 500, KHÔNG trả passed=True rồi mất dấu."""
    class _Boom(_Table):
        def execute(self):
            if self._patch is not None:
                raise RuntimeError("db down")
            return super().execute()
    log = []
    ss = _sessions(2)
    tables = {
        "class_assignments": [{"id": "asg-1", "content_config": {}}],
        "quiz_sessions": ss,
        "quiz_questions": _questions(10),
        "quiz_attempts": _attempts(ss, _given(10)),
        "class_assignment_items": [{"id": "it-1", "passed_at": None,
                                    "mastery": None, "score": None}],
    }
    db = type("DB", (), {})()
    db.table = lambda n: _Boom(n, tables.get(n, []), log)
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_assignment_item_for", lambda b, u: _ITEM):
        with pytest.raises(HTTPException) as e:
            qs.course_verdict(user_id="u-1", bank_id="bank-1",
                              session_ids=[s["id"] for s in ss])
    assert e.value.status_code == 500


# ── start_session: cổng kind + an toàn trước migration ───────────────────────

def _start(kind, *, area="course"):
    log = []
    db = _db(log, quiz_sessions=[])
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
