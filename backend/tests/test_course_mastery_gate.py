"""Cổng THUỘC BÀI của bài tập theo buổi.

Học viên phải đạt ngưỡng % mới PASS. Chỉ vùng 10 điểm ngay dưới
ngưỡng được kiểm tra lại bằng mẫu 20 câu; thấp hơn phải làm lại toàn bài.

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


def _supplements():
    return [
        {"bank_id": "bank-1", "qid": "read-1", "answer": 0,
         "type": "course_reading", "counts_toward_mastery": False},
        {"bank_id": "bank-1", "qid": "listen-1", "answer": 1,
         "type": "course_listening", "counts_toward_mastery": False},
        {"bank_id": "bank-1", "qid": "pron-1", "answer": None,
         "type": "course_pronunciation", "counts_toward_mastery": False},
    ]


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


def test_begin_full_retry_opens_one_idempotent_section_attempt():
    prior = {"phase": "run", "pct": 40, "completed": True,
             "next_action": "retry_full"}
    item = {"id": "it-1", "passed_at": None, "updated_at": "t0",
            "mastery": {"threshold": 75, "attempts": [prior]}}
    log = []
    db = _db(log, class_assignment_items=[item])
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "_assignment_item_for", return_value=item):
        out = qs.begin_course_full_retry(user_id="u-1", bank_id="bank-1")
    assert out == {"ok": True, "item_id": "it-1", "attempt_no": 2,
                   "already_started": False}
    update = next(row for row in log if row[0:2] == ("class_assignment_items", "update"))
    mastery = update[2]["mastery"]
    assert mastery["attempts"] == [prior]
    assert mastery["active_section_attempt_no"] == 2
    assert mastery["section_attempt_pending"] is True


def test_begin_full_retry_uses_assignment_threshold_not_stale_ledger_threshold():
    # 66% belongs to the near-pass band for the canonical 75% assignment, so
    # the server must refuse a full retry even if an old ledger says 80%.
    prior = {"phase": "run", "pct": 66, "completed": True}
    item = {"id": "it-1", "passed_at": None, "updated_at": "t0",
            "content_config": {"pass_pct": 75},
            "mastery": {"threshold": 80, "attempts": [prior]}}
    with patch.object(qs, "_assignment_item_for", return_value=item):
        with pytest.raises(HTTPException) as error:
            qs.begin_course_full_retry(user_id="u-1", bank_id="bank-1")
    assert error.value.status_code == 409


def test_config_reads_assignment():
    cfg = qs.mastery_config({"content_config": {"pass_pct": 90, "retake_size": 15}})
    assert cfg == {"pass_pct": 90, "retake_size": 15}


def test_config_clamps_garbage():
    # `800` gõ nhầm thay vì `80` không được biến bài thành không-thể-đạt.
    assert qs.mastery_config({"content_config": {"pass_pct": 800}})["pass_pct"] == 100
    assert qs.mastery_config({"content_config": {"pass_pct": 3}})["pass_pct"] == 50
    assert qs.mastery_config({"content_config": {"pass_pct": "x"}})["pass_pct"] == 80
    assert qs.mastery_config({"content_config": {"retake_size": 0}})["retake_size"] == 5


@pytest.mark.parametrize(("pct", "action"), [
    (75.0, "passed"),
    (74.9, "retake"),
    (65.0, "retake"),
    (64.9, "retry_full"),
])
def test_threshold_75_has_an_exact_ten_point_near_pass_band(pct, action):
    assert qs.near_pass_pct(75) == 65
    assert qs.mastery_next_action(pct, 75) == action


def test_multisection_retake_is_refused_when_perfect_quiz_cannot_pass():
    sections = {
        "quiz": {"completed": True, "pct": 100, "weight": 50},
        "writing": {"completed": True, "pct": 30, "weight": 50},
    }
    assert qs._course_max_pct_after_quiz_retake(sections) == 65.0
    assert qs.course_mastery_next_action(65.0, 75, sections) == "retry_full"


def test_multisection_retake_stays_open_when_quiz_can_reach_threshold():
    sections = {
        "quiz": {"completed": True, "pct": 50, "weight": 50},
        "writing": {"completed": True, "pct": 80, "weight": 50},
    }
    assert qs._course_max_pct_after_quiz_retake(sections) == 90.0
    assert qs.course_mastery_next_action(65.0, 75, sections) == "retake"


def test_legacy_impossible_retake_without_stored_decision_is_derived_safely():
    sections = {
        "quiz": {"completed": True, "pct": 100, "weight": 50},
        "writing": {"completed": True, "pct": 30, "weight": 50},
    }
    attempt = {
        "phase": "retake", "pct": 65.0, "completed": True,
        "sections": sections,
    }
    assert qs._recorded_next_action(attempt, 75) == "retry_full"
    out = qs._course_completion_payload(
        attempt=attempt, attempts=[attempt], cfg={"pass_pct": 75, "retake_size": 20},
        required=["quiz", "writing"], results=sections,
        weights={"quiz": 50, "writing": 50},
    )
    assert out["passed"] is False
    assert out["next_action"] == "retry_full"
    assert out["retry_reason"] == "section_ceiling"


def test_section_ceiling_guard_preserves_stored_retake_after_threshold_is_raised():
    attempt = {
        "pct": 65.0, "completed": True, "next_action": "retake",
        "sections": {
            "quiz": {"pct": 70, "weight": 50},
            "writing": {"pct": 60, "weight": 50},
        },
    }
    assert qs.course_mastery_next_action(65.0, 75, attempt["sections"]) == "retake"
    assert qs.course_mastery_next_action(65.0, 85, attempt["sections"]) == "retry_full"
    assert qs._recorded_next_action(attempt, 85) == "retake"


def _summary_assignment(pass_pct=75):
    return {"content_config": {
        "pass_pct": pass_pct,
        "weight_policy": qs.COURSE_WEIGHT_POLICY_HYBRID_QUESTION_COUNT_V1,
        "section_counts": {"quiz": 90, "writing": 10},
        "section_weights": {"quiz": 75, "writing": 25},
    }}


def test_admin_summary_separates_near_pass_from_hand_in_receipt():
    item = {"submitted_at": None, "passed_at": None, "mastery": {"attempts": [{
        "completed": True, "pct": 70, "next_action": "retake",
        "sections": {"quiz": {"pct": 70}, "writing": {"pct": 70}},
    }]}}
    out = qs.course_admin_summary(item, _summary_assignment())
    assert out["state"] == "near_pass"
    assert out["latest_pct"] == 70
    assert out["sections_done"] == 2 and out["sections_total"] == 2
    assert out["flags"] == [], "gần đạt là outcome, không phải cảnh báo admin"


def test_admin_summary_uses_required_sections_for_the_denominator():
    item = {"passed_at": None, "mastery": {"attempts": [{
        "completed": False, "pct": None,
        "sections": {"quiz": {"pct": 82, "duration_sec": 600}},
    }]}}
    out = qs.course_admin_summary(item, _summary_assignment())
    assert out["state"] == "in_progress"
    assert (out["sections_done"], out["sections_total"]) == (1, 2)
    assert out["missing_sections"] == [{"key": "writing", "label": "Viết câu"}]
    assert any(flag["code"] == "course_missing_section" for flag in out["flags"])


def test_admin_summary_counts_completed_legacy_quiz_only_attempt_as_its_section():
    item = {"passed_at": "2026-08-22T01:00:00+00:00", "mastery": {"attempts": [{
        "phase": "run", "pct": 82, "next_action": "passed", "sessions": ["q1"],
    }]}}
    out = qs.course_admin_summary(item, {"content_config": {"pass_pct": 75}},
                                  required_sections=["quiz"])
    assert (out["sections_done"], out["sections_total"]) == (1, 1)
    assert out["missing_sections"] == []
    assert out["section_results"][0]["key"] == "quiz"
    assert out["section_results"][0]["pct"] == 82


def test_admin_summary_flags_repeated_failure_with_evidence():
    item = {"passed_at": None, "mastery": {"attempts": [
        {"completed": True, "pct": 50, "next_action": "retry_full", "sections": {}},
        {"completed": True, "pct": 60, "next_action": "retry_full", "sections": {}},
    ]}}
    out = qs.course_admin_summary(item, _summary_assignment())
    assert out["state"] == "retry_full"
    repeated = next(flag for flag in out["flags"]
                    if flag["code"] == "course_repeated_failure")
    assert "50.0%" in repeated["why"] and "60.0%" in repeated["why"]


def test_admin_summary_keeps_prior_repeated_failure_while_a_new_attempt_is_in_progress():
    item = {"passed_at": None, "mastery": {"attempts": [
        {"completed": True, "pct": 50, "next_action": "retry_full", "sections": {}},
        {"completed": True, "pct": 60, "next_action": "retry_full", "sections": {}},
        {"completed": False, "pct": None,
         "sections": {"quiz": {"pct": 80, "completed": True}}},
    ]}}
    out = qs.course_admin_summary(item, _summary_assignment())
    assert out["state"] == "in_progress"
    assert out["latest_pct"] == 60
    assert {flag["code"] for flag in out["flags"]} == {
        "course_repeated_failure", "course_missing_section",
    }


def test_legacy_required_sections_use_the_live_bank_shape_once_snapshot_is_absent():
    with patch.object(qs, "_course_live_required_sections",
                      lambda bank_id: ["quiz", "writing"] if bank_id == "bank-1" else []):
        assert qs.course_required_sections({"content_id": "bank-1"}) == ["quiz", "writing"]


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


def test_run_ignores_known_supplement_rows_and_attempts_in_mixed_bank():
    ss = _sessions(2)
    questions = _questions(10) + _supplements()
    given = {**_given(10, wrong=1), "read-1": 0, "listen-1": 1}
    out, _ = _verdict(
        sessions=ss, questions=questions,
        attempts=_attempts(ss, given),
    )
    assert out["passed"] is True
    assert out["pct"] == 90.0
    quiz = next(row for row in out["sections"] if row["key"] == "quiz")
    assert quiz["total"] == 10


def test_run_ignores_same_bank_mcq_explicitly_opted_out_of_mastery():
    ss = _sessions(2)
    opted_out = {
        "bank_id": "bank-1", "qid": "practice-only", "answer": 2,
        "type": "mcq", "counts_toward_mastery": False,
    }
    questions = _questions(10) + [opted_out]
    given = {**_given(10, wrong=1), "practice-only": 2}
    out, _ = _verdict(
        sessions=ss, questions=questions,
        attempts=_attempts(ss, given),
    )
    assert out["passed"] is True
    assert out["pct"] == 90.0
    quiz = next(row for row in out["sections"] if row["key"] == "quiz")
    assert quiz["total"] == 10


def test_run_fail_offers_retake_and_keeps_not_passed():
    ss = _sessions(2)
    out, log = _verdict(sessions=ss, attempts=_attempts(ss, _given(10, wrong=3)))
    assert out["passed"] is False and out["pct"] == 70.0
    assert out["retake_size"] == 20 and out["threshold"] == 80
    assert out["near_threshold"] == 70 and out["next_action"] == "retake"
    history = out["history"][0]
    assert {key: history[key] for key in (
        "number", "phase", "pct", "session_count", "next_action",
    )} == {"number": 1, "phase": "run", "pct": 70.0,
          "session_count": 2, "next_action": "retake"}
    assert history["completed"] is True
    patch_ = [e for e in log if e[1] == "update"][0][2]
    assert "passed_at" not in patch_          # chưa đạt thì KHÔNG có mốc đạt
    assert patch_["mastery"]["attempts"][0]["pct"] == 70.0


def test_threshold_75_sends_65_percent_to_the_20_question_retake():
    ss = _sessions(2)
    out, _ = _verdict(
        sessions=ss,
        questions=_questions(20),
        attempts=_attempts(ss, _given(20, wrong=7)),  # 13/20 = 65%
        config={"pass_pct": 75, "retake_size": 20},
    )
    assert out["pct"] == 65.0
    assert out["near_threshold"] == 65
    assert out["next_action"] == "retake"
    assert out["retake_size"] == 20


def test_threshold_75_sends_below_65_percent_to_a_full_retry():
    ss = _sessions(2)
    out, log = _verdict(
        sessions=ss,
        questions=_questions(20),
        attempts=_attempts(ss, _given(20, wrong=8)),  # 12/20 = 60%
        config={"pass_pct": 75, "retake_size": 20},
    )
    assert out["pct"] == 60.0
    assert out["next_action"] == "retry_full"
    saved = [e for e in log if e[1] == "update"][0][2]["mastery"]["attempts"][-1]
    assert saved["next_action"] == "retry_full"


def test_a_retake_below_the_near_band_requires_a_full_retry_next():
    prior = {"threshold": 75, "attempts": [{
        "phase": "run", "pct": 65.0, "at": "2026-08-08T01:00:00Z",
        "sessions": ["s-run"], "next_action": "retake",
    }]}
    ss = _sessions(1, kind="retake")
    out, _ = _verdict(
        sessions=ss,
        questions=_questions(20),
        attempts=_attempts(ss, _given(20, wrong=8)),
        config={"pass_pct": 75, "retake_size": 20},
        item_row={"id": "it-1", "passed_at": None, "mastery": prior, "score": 65.0},
    )
    assert out["phase"] == "retake"
    assert out["next_action"] == "retry_full"


def test_reposting_the_same_failed_retake_is_idempotent():
    ss = _sessions(1, kind="retake")
    key = [ss[0]["id"]]
    prior = {"threshold": 75, "attempts": [
        {"phase": "run", "pct": 65.0, "at": "2026-08-08T01:00:00Z",
         "sessions": ["s-run"], "next_action": "retake"},
        {"phase": "retake", "pct": 60.0, "at": "2026-08-08T02:00:00Z",
         "sessions": key, "next_action": "retry_full"},
    ]}
    out, log = _verdict(
        sessions=ss,
        questions=_questions(20),
        attempts=_attempts(ss, _given(20, wrong=8)),
        config={"pass_pct": 75, "retake_size": 20},
        item_row={"id": "it-1", "passed_at": None, "mastery": prior, "score": 60.0},
    )
    assert out["next_action"] == "retry_full"
    assert [e for e in log if e[1] == "update"] == []


def test_full_retry_rejects_sessions_created_before_the_failed_attempt():
    ss = _sessions(2, created_at="2026-08-08T01:00:00Z")
    prior = {"threshold": 75, "attempts": [{
        "phase": "run", "pct": 60.0, "at": "2026-08-08T02:00:00Z",
        "sessions": ["old-a", "old-b"], "next_action": "retry_full",
    }]}
    with pytest.raises(HTTPException) as e:
        _verdict(
            sessions=ss,
            questions=_questions(10),
            attempts=_attempts(ss, _given(10)),
            config={"pass_pct": 75},
            item_row={"id": "it-1", "passed_at": None, "mastery": prior, "score": 60.0},
        )
    assert e.value.status_code == 422
    assert "phiên mới" in e.value.detail


def test_full_retry_accepts_a_complete_set_of_new_sessions():
    ss = _sessions(2, created_at="2026-08-08T03:00:00Z")
    prior = {"threshold": 75, "attempts": [{
        "phase": "run", "pct": 60.0, "at": "2026-08-08T02:00:00Z",
        "sessions": ["old-a", "old-b"], "next_action": "retry_full",
    }]}
    out, _ = _verdict(
        sessions=ss,
        questions=_questions(10),
        attempts=_attempts(ss, _given(10)),
        config={"pass_pct": 75},
        item_row={"id": "it-1", "passed_at": None, "mastery": prior, "score": 60.0},
    )
    assert out["passed"] is True


def test_near_pass_rerun_still_rejects_mixing_sessions_before_full_retry_boundary():
    """Boundary survives latest action=retake; old+new sessions cannot be merged."""
    ss = [
        *_sessions(1, created_at="2026-08-08T01:00:00Z"),
        *_sessions(1, created_at="2026-08-08T03:00:00Z"),
    ]
    ss[1]["id"] = "s-new"
    prior = {"threshold": 75, "attempts": [
        {"phase": "run", "pct": 60.0, "at": "2026-08-08T02:00:00Z",
         "sessions": ["s-old-a", "s-old-b"], "next_action": "retry_full"},
        {"phase": "run", "pct": 70.0, "at": "2026-08-08T04:00:00Z",
         "sessions": ["new-a", "new-b"], "next_action": "retake"},
    ]}
    with pytest.raises(HTTPException) as e:
        _verdict(
            sessions=ss,
            questions=_questions(10),
            attempts=_attempts(ss, _given(10)),
            config={"pass_pct": 75},
            item_row={"id": "it-1", "passed_at": None,
                      "mastery": prior, "score": 70.0},
        )
    assert e.value.status_code == 422
    assert "phiên mới" in e.value.detail


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
        {"phase": "run", "pct": 70.0, "at": "t", "sessions": ["s-a"]},
    ]}
    out, _ = _verdict(sessions=ss, questions=_questions(3),
                      attempts=_attempts(ss, {f"q{i}": i % 4 for i in range(3)}),
                      item_row={"id": "it-1", "passed_at": None,
                                "mastery": prior, "score": 70.0})
    assert out["passed"] is True and out["pct"] == 100.0


def test_a_duplicate_question_is_TOLERATED_first_answer_wins():
    """Bản trước bác cả lượt, với lý do "một câu hai lượt là dấu nộp ghép".

    Lý do ấy không đứng vững, và cái giá thì có thật: em Lê Ngọc Hà Linh làm đủ
    9 chặng nhưng có 10 phiên chốt (chặng 3 làm hai lần) và không bao giờ thấy
    được kết quả của chính mình (06/08).

    Client KHÔNG mua được điểm bằng cách gộp phiên: thứ tự do `created_at` trên
    máy chủ quyết, nên nộp thêm chỉ có thể kéo về lượt SỚM HƠN. Xem hai chốt
    `test_the_FIRST_answer_wins_even_when_the_redo_is_better` ở cuối tệp.
    """
    ss = _sessions(2)
    att = _attempts(ss, _given(10))
    att.append({"session_id": ss[0]["id"], "qid": "q0", "answer_given": "0"})
    out, _ = _verdict(sessions=ss, attempts=att)
    assert "pct" in out, "lượt xét phải chạy được, không bác"


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
    assert "gần đạt" in e.value.detail


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
    other = {"phase": "retake", "pct": 75.0, "at": "t2", "sessions": ["s-tab2"]}
    base_run = {"phase": "run", "pct": 70.0, "at": "t", "sessions": ["s-a", "s-b"]}
    stale_row = {"id": "it-1", "passed_at": None, "updated_at": "T0",
                 "mastery": {"threshold": 80, "attempts": [base_run]}, "score": 70.0}
    fresh_row = {"id": "it-1", "passed_at": None, "updated_at": "T1",
                 "mastery": {"threshold": 80, "attempts": [base_run, other]},
                 "score": 75.0}

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
    assert ("retake", 75.0) in phases, "kết quả của tab kia phải SỐNG SÓT"
    assert ("retake", 60.0) in phases, "kết quả của tab này cũng phải vào sổ"
    assert phases.count(("run", 70.0)) == 1, "lượt chính không bị nhân đôi"

def test_a_new_retake_after_pass_is_rejected_and_cannot_downgrade_score():
    """Mốc đạt đã khóa thì không còn quyền mở/nộp một retake mới."""
    prior = {"threshold": 80, "attempts": [
        {"phase": "run", "pct": 70.0, "at": "t", "sessions": ["s-a"]},
        {"phase": "retake", "pct": 90.0, "at": "t", "sessions": ["s-win"]},
    ]}
    ss = _sessions(1, kind="retake")
    given = {f"q{i}": 99 for i in range(5)}          # trượt sạch: 0/5
    log = []
    with pytest.raises(HTTPException) as e:
        _verdict(
            log=log, sessions=ss, attempts=_attempts(ss, given),
            config={"retake_size": 5},
            item_row={"id": "it-1", "passed_at": "2026-08-04T00:00:00Z",
                      "mastery": prior, "score": 90.0},
        )
    assert e.value.status_code == 422
    assert [x for x in log if x[1] == "update"] == []


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


def test_multisection_pass_is_not_reported_when_hand_in_cannot_be_persisted():
    """Điểm đã tính nhưng `submitted_at` còn trống thì client phải retry."""
    ss = _sessions(2)
    quiz = {"completed": True, "pct": 90.0, "correct": 9, "total": 10,
            "duration_sec": 300}
    writing = {"completed": True, "pct": 100.0, "correct": 1, "total": 1,
               "duration_sec": 120}
    with patch.object(qs, "_course_completion_evidence", return_value=(
            ["quiz", "writing"], {"quiz": quiz, "writing": writing},
            {"quiz": "s-0", "writing": "w-1"})), \
         patch.object(qs, "mark_item_submitted", return_value=False):
        with pytest.raises(HTTPException) as exc:
            _verdict(
                sessions=ss, questions=_questions(10, writing=1),
                attempts=_attempts(ss, _given(10)),
                item_row={"id": "it-1", "passed_at": None, "submitted_at": None,
                          "mastery": None, "score": None},
            )
    assert exc.value.status_code == 500
    assert "chưa thu được bài" in exc.value.detail


def test_retry_repairs_a_passed_multisection_item_missing_submitted_at():
    """Mạng rớt giữa `passed_at` và `submitted_at` không để trạng thái kẹt."""
    ss = _sessions(2)
    sections = {
        "quiz": {"completed": True, "pct": 90.0, "correct": 9, "total": 10,
                 "duration_sec": 300, "weight": 50},
        "writing": {"completed": True, "pct": 100.0, "correct": 1, "total": 1,
                    "duration_sec": 120, "weight": 50},
    }
    prior = {"phase": "run", "sessions": ["s-0", "s-1"], "sections": sections,
             "completed": True, "pct": 95.0, "at": "2026-08-20T00:00:00Z",
             "duration_sec": 420, "next_action": "passed"}
    marked = []
    with patch.object(qs, "_course_completion_evidence", return_value=(
            ["quiz", "writing"], sections, {"quiz": "s-0", "writing": "w-1"})), \
         patch.object(qs, "mark_item_submitted",
                      side_effect=lambda *a, **k: marked.append(k) or True):
        out, _ = _verdict(
            sessions=ss, questions=_questions(10, writing=1),
            attempts=_attempts(ss, _given(10)),
            item_row={"id": "it-1", "passed_at": "2026-08-20T00:00:00Z",
                      "submitted_at": None, "mastery": {"attempts": [prior]},
                      "score": 95.0},
        )
    assert out["passed"] is True and out["pct"] == 95.0
    assert marked and marked[0]["artifact_kind"] == "quiz_session"


def test_full_retry_uses_fresh_section_scores_and_time_for_the_new_attempt():
    ss = _sessions(2, created_at="2026-08-21T00:00:00Z")
    prior_sections = {
        "quiz": {"completed": True, "pct": 60.0, "duration_sec": 300, "weight": 50},
        "writing": {"completed": True, "pct": 20.0, "duration_sec": 600, "weight": 50},
    }
    prior = {"phase": "run", "sessions": ["old"], "sections": prior_sections,
             "completed": True, "pct": 40.0, "at": "2026-08-20T00:00:00Z",
             "duration_sec": 900, "next_action": "retry_full"}
    new_quiz = {"completed": True, "pct": 100.0, "correct": 10, "total": 10,
                "duration_sec": 240}
    writing = {"completed": True, "pct": 100.0, "correct": 10, "total": 10,
               "duration_sec": 600}
    with patch.object(qs, "_course_completion_evidence", return_value=(
            ["quiz", "writing"], {"quiz": new_quiz, "writing": writing},
            {"quiz": "s-0", "writing": "w-1"})):
        out, log = _verdict(
            sessions=ss, questions=_questions(10, writing=1),
            attempts=_attempts(ss, _given(10)),
            item_row={"id": "it-1", "passed_at": None, "submitted_at": None,
                      "mastery": {"attempts": [prior],
                                  "active_section_attempt_no": 2,
                                  "section_attempt_pending": True,
                                  "section_attempt_started_at": "2026-08-20T12:00:00Z"},
                      "score": 40.0},
        )
    latest = out["history"][-1]
    writing_row = next(row for row in latest["sections"] if row["key"] == "writing")
    assert writing_row["carried"] is False and writing_row["duration_sec"] == 600
    assert latest["duration_sec"] == 840
    assert out["pct"] == 100.0 and out["passed"] is True
    saved = next(entry[2] for entry in log
                 if entry[1] == "update" and "mastery" in entry[2])
    assert saved["mastery"]["attempts"][-1]["duration_sec"] == 840


def test_full_retry_rejects_quiz_sessions_opened_before_the_new_attempt():
    ss = _sessions(2, created_at="2026-08-20T06:00:00Z")
    prior = {"phase": "run", "sessions": ["old"], "completed": True,
             "pct": 40.0, "at": "2026-08-20T00:00:00Z",
             "next_action": "retry_full"}
    with patch.object(qs, "_course_completion_evidence", return_value=(
            ["quiz", "writing"], {
                "quiz": {"completed": True, "pct": 100},
                "writing": {"completed": True, "pct": 100},
            }, {"quiz": "s-0", "writing": "w-1"})):
        with pytest.raises(HTTPException) as error:
            _verdict(
                sessions=ss, questions=_questions(10, writing=1),
                attempts=_attempts(ss, _given(10)),
                item_row={"id": "it-1", "passed_at": None,
                          "submitted_at": None, "score": 40.0,
                          "mastery": {"attempts": [prior],
                                      "active_section_attempt_no": 2,
                                      "section_attempt_pending": True,
                                      "section_attempt_started_at":
                                          "2026-08-20T12:00:00Z"}},
            )
    assert error.value.status_code == 422
    assert "sau khi bắt đầu lượt mới" in error.value.detail


# ── start_session: cổng kind + an toàn trước migration ───────────────────────

def _start(kind, *, area="course"):
    log = []
    db = _db(
        log,
        quiz_sessions=[],
        class_assignments=[{"id": "asg-1", "content_config": {}}],
        class_assignment_items=[{
            "id": "it-1", "passed_at": None,
            "mastery": {"attempts": [{"phase": "run", "pct": 70.0}]},
        }],
    )
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


# ── deadline: chặn ở biên chốt session, không chỉ lúc mở trang ────────────

def _deadline_check(*, accepting=True, assignment=True, ended_by="completed"):
    log = []
    db = _db(
        log,
        class_assignment_items=[{"id": "it-1", "assignment_id": "asg-1"}],
        class_assignments=([{"id": "asg-1", "skill": "course",
                            "due_at": "2026-08-08T19:00:00+07:00"}]
                           if assignment else []),
    )
    with patch.object(qs, "supabase_admin", db), \
         patch.object(qs, "is_accepting_submissions", lambda *_a, **_k: accepting):
        qs._assert_course_session_accepting(
            {"class_assignment_item_id": "it-1"}, ended_by)


def test_course_session_cannot_finalize_after_the_deadline():
    with pytest.raises(HTTPException) as e:
        _deadline_check(accepting=False)
    assert e.value.status_code == 409
    assert "quá hạn" in e.value.detail


def test_course_session_can_finalize_before_the_deadline():
    _deadline_check(accepting=True)


def test_pause_remains_a_soft_save_after_the_deadline():
    _deadline_check(accepting=False, ended_by="paused")


def test_missing_assignment_does_not_fail_open_at_finalize():
    with pytest.raises(HTTPException) as e:
        _deadline_check(assignment=False)
    assert e.value.status_code == 404


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
            qr.CourseVerdictBody(
                bank_id="bank-1", class_item="it-1", session_ids=["s-1"],
            ),
            authorization="Bearer x")
    assert out == {"passed": True}
    assert seen == {"user_id": "u-1", "bank_id": "bank-1",
                    "session_ids": ["s-1"], "assignment_item_id": "it-1"}


# ── Làm lại một chặng KHÔNG được chặn học viên khỏi kết quả ─────────────────
#
# Chuyện thật 06/08: em Lê Ngọc Hà Linh làm đủ 9 chặng nhưng có 10 phiên chốt —
# chặng 3 làm hai lần. Lượt xét bác cả lượt với "Có câu bị nộp trùng", và em ấy
# không bao giờ thấy được kết quả của chính mình.
#
# Nay giữ LƯỢT ĐẦU của mỗi câu, đúng luật `course_answer_report` đã dùng. Client
# KHÔNG chọn được lượt nào thắng: thứ tự do dấu thời gian trên máy chủ quyết.

def _dup_attempts(*, first_wrong: bool):
    """10 câu ở phiên s-0; câu q0 làm LẠI ở phiên s-1 với đáp án khác."""
    given = {f"q{i}": i % 4 for i in range(10)}
    rows = [{"session_id": "s-0", "qid": q, "answer_given": str(v),
             "created_at": f"2026-08-06T10:00:{i:02d}+00:00"}
            for i, (q, v) in enumerate(given.items())]
    if first_wrong:
        rows[0]["answer_given"] = str((0 % 4 + 1) % 4)      # lượt ĐẦU sai
        redo = "0"                                           # lượt sau đúng
    else:
        redo = str((0 % 4 + 1) % 4)                          # lượt sau sai
    # ĐẶT lượt làm lại lên ĐẦU danh sách nhưng gắn dấu thời gian MUỘN HƠN.
    # Thứ tự PostgREST trả về không phải thứ tự thời gian, nên nếu mã duyệt
    # theo thứ tự danh sách thì lượt "đầu tiên" nó thấy lại là lượt làm SAU —
    # và ai thắng thành chuyện may rủi.
    rows.insert(0, {"session_id": "s-1", "qid": "q0", "answer_given": redo,
                    "created_at": "2026-08-06T11:00:00+00:00"})
    return rows


def test_redoing_a_stage_no_longer_blocks_the_verdict():
    v, _ = _verdict(sessions=_sessions(2), attempts=_dup_attempts(first_wrong=False))
    assert v["pct"] == 100.0, "lượt ĐẦU của q0 đúng nên phải tính đúng"


def test_the_FIRST_answer_wins_even_when_the_redo_is_better():
    """Nộp thêm phiên chỉ có thể kéo về lượt SỚM HƠN, không bao giờ về lượt
    điểm cao hơn — nên client không mua được điểm bằng cách gộp phiên."""
    v, _ = _verdict(sessions=_sessions(2), attempts=_dup_attempts(first_wrong=True))
    assert v["pct"] == 90.0, "lượt đầu SAI thì vẫn tính sai, dù làm lại đúng"


def test_a_question_outside_the_bank_still_rejects_the_whole_run():
    """Nới chỗ trùng lặp KHÔNG được nới luôn chỗ này: câu lạ là dấu nộp ghép
    từ một bộ đề khác."""
    import pytest
    att = [{"session_id": "s-0", "qid": f"q{i}", "answer_given": str(i % 4),
            "created_at": f"2026-08-06T10:00:{i:02d}+00:00"} for i in range(10)]
    att.append({"session_id": "s-0", "qid": "LA-MAT", "answer_given": "0",
                "created_at": "2026-08-06T10:00:59+00:00"})
    with pytest.raises(Exception) as e:
        _verdict(sessions=_sessions(1), attempts=att)
    assert "không thuộc bộ đề" in str(getattr(e.value, "detail", e.value))
