"""G09-T06 (ADMINIA-0074 FR-090…093, FR-104): Việc cần làm / Việc của tôi.

Runs the real service (services/staff_attention.py over the T03 directory and
learner_attention) and routes (routers/admin_attention.py) over the in-memory
stand-in of the T03 tests. All names and addresses are made up; no AI or
network call.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from models.admin_attention import AdminAttentionOut, InstructorAttentionOut
from routers import admin_attention as mod
from services import admin_learner_directory as directory
from services import learner_attention, ops_thresholds, staff_attention, staff_scope, test_data_visibility
from tests.test_admin_learners import (C_A, C_B, DEFAULTS, NOW, S_LAN, S_MINH, S_OFFLINE, U_ADMIN, U_LAN,
                                       U_MINH, U_TEACH, U_TEACH_B, _as, _ago, _DB)

VN_TODAY = staff_attention.vn_today(NOW)


def _day(n: int) -> str:
    return (VN_TODAY + timedelta(days=n)).isoformat()


@pytest.fixture
def db(monkeypatch):
    fake = _DB()
    fake.rows["cohorts"][0].update(is_active=True, archived_at=None)
    fake.rows["cohorts"][1].update(is_active=True, archived_at=None)
    fake.rows["writing_essays"] = [
        # Class A work: graded 60 h ago (over the 48 h default), AI-failed one.
        {"id": "e-a1", "student_id": S_LAN, "status": "graded", "created_at": _ago(hours=70), "deleted_at": None},
        {"id": "e-a2", "student_id": S_OFFLINE, "status": "failed", "created_at": _ago(hours=5), "deleted_at": None},
        # Class B work, graded 2 h ago.
        {"id": "e-b1", "student_id": S_MINH, "status": "graded", "created_at": _ago(hours=3), "deleted_at": None},
        # Not waiting: delivered, or deleted.
        {"id": "e-done", "student_id": S_LAN, "status": "delivered", "created_at": _ago(days=9), "deleted_at": None},
        {"id": "e-gone", "student_id": S_LAN, "status": "graded", "created_at": _ago(days=9),
         "deleted_at": _ago(days=1)},
    ]
    fake.rows["writing_feedback_current"] = [
        {"essay_id": "e-a1", "created_at": _ago(hours=60)},
        {"essay_id": "e-b1", "created_at": _ago(hours=2)},
    ]
    fake.rows["writing_assignments"] = [
        {"id": "w1", "essay_id": "e-a1", "cohort_id": C_A, "student_id": S_LAN, "assigned_by": U_TEACH},
        {"id": "w2", "essay_id": "e-a2", "cohort_id": C_A, "student_id": S_OFFLINE, "assigned_by": U_TEACH},
        {"id": "w3", "essay_id": "e-b1", "cohort_id": C_B, "student_id": S_MINH, "assigned_by": U_TEACH_B},
    ]
    fake.rows["essay_regrade_requests"] = [
        {"id": "r1", "essay_id": "e-a1", "status": "pending", "created_at": _ago(hours=10)},
        {"id": "r2", "essay_id": "e-b1", "status": "pending", "created_at": _ago(hours=50)},
        {"id": "r3", "essay_id": "e-done", "status": "fulfilled", "created_at": _ago(days=20)},
    ]
    fake.rows["user_feedback"] = [
        {"id": "f1", "status": "new", "created_at": _ago(hours=80)},
        {"id": "f2", "status": "resolved", "created_at": _ago(hours=90)},
    ]
    fake.rows["mock_exams"] = [
        {"id": "x-today", "status": "published", "open_from": (NOW + timedelta(minutes=1)).isoformat()},
        {"id": "x-draft", "status": "draft", "open_from": (NOW + timedelta(minutes=1)).isoformat()},
        {"id": "x-later", "status": "published", "open_from": (NOW + timedelta(days=3)).isoformat()},
    ]
    fake.rows["class_lessons"] = [
        {"id": "l-a-today", "cohort_id": C_A, "lesson_no": 11, "lesson_date": _day(0), "starts_at": "19:30:00"},
        {"id": "l-a-next", "cohort_id": C_A, "lesson_no": 12, "lesson_date": _day(2), "starts_at": "19:30:00"},
        {"id": "l-a-far", "cohort_id": C_A, "lesson_no": 13, "lesson_date": _day(9), "starts_at": None},
        {"id": "l-b", "cohort_id": C_B, "lesson_no": 4, "lesson_date": _day(3), "starts_at": None},
        {"id": "l-b-past", "cohort_id": C_B, "lesson_no": 3, "lesson_date": _day(-1), "starts_at": None},
    ]
    for row in fake.rows["class_assignments"]:
        row.setdefault("lesson_id", None)
        row.setdefault("created_at", _ago(days=20))
    fake.rows["class_assignments"][3].update(lesson_id="l-a-today", created_at=_ago(days=1))
    fake.rows["students"][0]["instructor_id"] = U_TEACH
    fake.rows["students"][1]["instructor_id"] = U_TEACH_B
    for module in (directory, learner_attention, staff_scope, staff_attention):
        monkeypatch.setattr(module, "supabase_admin", fake)
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(return_value=dict(DEFAULTS)))
    monkeypatch.setattr(test_data_visibility, "hide_for", lambda **_k: False)
    monkeypatch.setattr(mod, "require_admin", AsyncMock(return_value={"id": U_ADMIN, "email": "admin@example.test"}))
    return fake


def _admin():
    out = asyncio.run(mod.admin_attention(authorization="Bearer x"))
    AdminAttentionOut.model_validate(out)
    return out


def _teacher(monkeypatch, db, user_id):
    _as(monkeypatch, db, user_id)
    out = asyncio.run(mod.instructor_attention(authorization="Bearer x"))
    InstructorAttentionOut.model_validate(out)
    return out


# ── Queue rows ────────────────────────────────────────────────────────────

def test_admin_queue_rows_count_real_sources(db):
    out = _admin()
    q = out["queues"]
    assert list(q) == list(staff_attention.QUEUE_ORDER)
    w = q["writing_review"]
    # Two graded + one AI-failed; the failed one is inside the Writing count.
    assert (w["count"], w["ai_failed"], w["overdue"], w["error"]) == (3, 1, True, False)
    # Age from when the AI grade was written (60 h ago), not the submission (70 h).
    assert abs((NOW - w["oldest_at"]).total_seconds() - 60 * 3600) < 5
    assert q["regrade_new"]["count"] == 2 and q["regrade_new"]["overdue"] is True    # 50 h ≥ 48 h
    assert q["feedback_open"]["count"] == 1 and q["feedback_open"]["overdue"] is True  # 80 h ≥ 72 h
    assert q["exams_today"]["count"] == 1
    # a2 and a3 are past due and Lan has not handed them in; a1 is all handed in.
    assert q["assignments_overdue"]["count"] == 2 and q["assignments_overdue"]["overdue"] is True
    assert out["sources_failed"] == []


def test_rows_without_a_source_yet_are_unavailable_never_zero(db):
    q = _admin()["queues"]
    for key in staff_attention.UNAVAILABLE:
        assert q[key]["unavailable"] is True and q[key]["count"] is None and q[key]["error"] is False, key


def test_class_with_two_legacy_code_members_is_not_reported_as_zero(db):
    """FR-058: G04 has no read for "chưa có nơi nhận lượt" yet. A live class
    whose two members joined with old codes must not read as "0 classes"."""
    db.rows["access_codes"] = [{"id": "k-old1", "code": "OLD-0001", "used_by": U_LAN, "is_used": True},
                               {"id": "k-old2", "code": "OLD-0002", "used_by": U_MINH, "is_used": True}]
    db.rows["student_cohort_memberships"].append(
        {"id": "m4", "student_id": S_MINH, "cohort_id": C_A, "is_active": True})
    row = _admin()["queues"]["classes_unmetered"]
    assert row == {"count": None, "oldest_at": None, "overdue": False, "error": False, "unavailable": True}


def test_one_failed_source_degrades_only_its_row(db, caplog):
    db.fail.add("essay_regrade_requests")
    with caplog.at_level(logging.WARNING):
        out = _admin()
    q = out["queues"]
    assert q["regrade_new"] == {"count": None, "oldest_at": None, "overdue": False,
                                "error": True, "unavailable": False}
    assert q["writing_review"]["count"] == 3 and q["feedback_open"]["count"] == 1
    assert out["classes_week"] and out["attention_learners"] is not None
    assert out["sources_failed"] == ["regrade_new"]
    # The log names the block, never a learner.
    assert "regrade_new" in caplog.text and "Lan" not in caplog.text and "@" not in caplog.text


def test_a_failed_block_is_null_not_an_empty_list(db):
    db.fail.add("class_lessons")
    out = _admin()
    assert out["classes_week"] is None and "classes_week" in out["sources_failed"]
    assert out["queues"]["writing_review"]["error"] is False


def test_unreadable_thresholds_mark_nothing_overdue_by_age_and_say_so(db, monkeypatch):
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(side_effect=ops_thresholds.ThresholdsUnavailable()))
    out = _admin()
    assert out["queues"]["writing_review"]["count"] == 3 and out["queues"]["writing_review"]["overdue"] is False
    assert out["attention_learners"] is None and out["ops_week"]["inactive_learners"] is None
    assert "thresholds" in out["sources_failed"]


def test_threshold_change_changes_overdue(db, monkeypatch):
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(return_value={**DEFAULTS, "writing_review_hours": 100}))
    assert _admin()["queues"]["writing_review"]["overdue"] is False


def test_exams_today_uses_the_vietnam_day(db):
    tomorrow_vn = staff_attention.datetime.combine(VN_TODAY + timedelta(days=1), staff_attention.datetime.min.time(),
                                                   tzinfo=staff_attention.VN)
    db.rows["mock_exams"] = [{"id": "x-tomorrow", "status": "published", "open_from": tomorrow_vn.isoformat()},
                             {"id": "x-end", "status": "published",
                              "open_from": (tomorrow_vn - timedelta(seconds=1)).isoformat()}]
    assert _admin()["queues"]["exams_today"]["count"] == 1


# ── Blocks ────────────────────────────────────────────────────────────────

def test_classes_week(db):
    week = {c["cohort_id"]: c for c in _admin()["classes_week"]}
    a = week[C_A]
    # A lesson today → the next one within 7 days is shown too; day 9 is not.
    assert a["next_lesson"]["lesson_id"] == "l-a-today" and a["following_lesson"]["lesson_id"] == "l-a-next"
    assert a["has_assignment"] is True and a["last_assignment_id"] == "a4"
    assert a["pending_review"] == 2
    b = week[C_B]
    assert b["next_lesson"]["lesson_id"] == "l-b" and b["following_lesson"] is None
    assert b["has_assignment"] is False and b["pending_review"] == 1


def test_archived_class_is_not_in_the_week(db):
    db.rows["cohorts"][1].update(is_active=False, archived_at=_ago(days=1))
    assert [c["cohort_id"] for c in _admin()["classes_week"]] == [C_A]


def test_attention_learners_most_reasons_first_then_name(db):
    # Lan: late streak (2). Minh: inactive 10 days. Give Lan "inactive" too.
    next(u for u in db.rows["users"] if u["id"] == U_LAN)["last_seen_at"] = _ago(days=12)
    rows = _admin()["attention_learners"]
    assert [r["ref"] for r in rows[:2]] == [f"u-{U_LAN}", f"u-{U_MINH}"]
    assert [x["code"] for x in rows[0]["reasons"]] == ["late_streak", "inactive"]
    assert rows[0]["cohort"] == {"id": C_A, "name": "Tue–Thu 19:30"}
    assert len(rows) <= staff_attention.ATTENTION_LIMIT


def test_ops_week(db):
    ops = _admin()["ops_week"]
    # Due in the last 7 days: a2 (Lan missing, Đức late), a3 (Lan missing, Đức on time) → 1 of 4.
    assert ops["on_time_rate"] == {"value": 0.25, "lowest_cohort_id": C_A}
    assert ops["inactive_learners"] == 1   # Minh
    assert ops["review_wait_median_hours"] is None


# ── Teacher door ──────────────────────────────────────────────────────────

def test_teacher_shape_has_no_admin_rows_or_ops_block(db, monkeypatch):
    out = _teacher(monkeypatch, db, U_TEACH)
    assert set(out) == {"queues", "classes_week", "attention_learners", "sources_failed", "generated_at"}
    for key in ("enrollments_reported", "incident_groups_open", "feedback_open", "exams_today", "classes_unmetered"):
        assert key not in out["queues"]
    assert set(out["queues"]) == set(InstructorAttentionOut.model_fields["queues"].annotation.model_fields)


def test_teacher_sees_only_their_class(db, monkeypatch):
    a = _teacher(monkeypatch, db, U_TEACH)
    assert a["queues"]["writing_review"]["count"] == 2 and a["queues"]["writing_review"]["ai_failed"] == 1
    assert a["queues"]["regrade_new"]["count"] == 1
    assert a["queues"]["assignments_overdue"]["count"] == 2
    assert [c["cohort_id"] for c in a["classes_week"]] == [C_A]
    assert {r["ref"] for r in a["attention_learners"]} <= {f"u-{U_LAN}", f"s-{S_OFFLINE}"}

    b = _teacher(monkeypatch, db, U_TEACH_B)
    assert b["queues"]["writing_review"]["count"] == 1 and b["queues"]["writing_review"]["ai_failed"] == 0
    assert b["queues"]["regrade_new"]["count"] == 1 and b["queues"]["assignments_overdue"]["count"] == 0
    assert [c["cohort_id"] for c in b["classes_week"]] == [C_B]
    assert f"u-{U_LAN}" not in str(b) and "e-a1" not in str(b)


def test_teacher_with_no_class_gets_empty_blocks_not_errors(db, monkeypatch):
    db.rows["cohorts"][1]["instructor_id"] = None
    out = _teacher(monkeypatch, db, U_TEACH_B)
    assert out["classes_week"] == [] and out["attention_learners"] == []
    assert out["queues"]["assignments_overdue"]["count"] == 0
    # FR-104: e-b1 was given by them and its learner still points at them
    # (students.instructor_id), but they have no class now: nothing counts.
    assert out["queues"]["writing_review"]["count"] == 0
    assert out["queues"]["writing_review"]["ai_failed"] == 0
    assert out["queues"]["regrade_new"]["count"] == 0


def test_teacher_of_class_a_does_not_count_class_b_work_they_could_open(db, monkeypatch):
    """The essay is class B work, given by teacher A, of a learner whose
    students.instructor_id is teacher A: openable in the old grading area,
    but not work of A's current classes."""
    db.rows["writing_assignments"][2]["assigned_by"] = U_TEACH
    db.rows["students"][1]["instructor_id"] = U_TEACH
    out = _teacher(monkeypatch, db, U_TEACH)
    assert out["queues"]["writing_review"]["count"] == 2      # e-a1, e-a2 only
    assert out["queues"]["regrade_new"]["count"] == 1         # r1 (e-a1), not r2 (e-b1)
    assert "e-b1" not in str(out)


def test_teacher_class_work_they_cannot_open_is_not_counted(db, monkeypatch):
    """Class A work given by an admin, of a learner who points at no teacher:
    in A's class but not openable on the grading page, so not counted."""
    db.rows["writing_assignments"][0]["assigned_by"] = U_ADMIN
    db.rows["students"][0]["instructor_id"] = None
    out = _teacher(monkeypatch, db, U_TEACH)
    assert out["queues"]["writing_review"]["count"] == 1      # e-a2 only
    assert out["queues"]["regrade_new"]["count"] == 0


def test_admin_on_the_teacher_door_gets_the_teacher_shape(db, monkeypatch):
    out = _teacher(monkeypatch, db, U_ADMIN)
    assert "ops_week" not in out and "feedback_open" not in out["queues"]
    assert out["queues"]["writing_review"]["count"] == 3


def test_learner_token_is_refused(db, monkeypatch):
    with pytest.raises(HTTPException) as caught:
        _teacher(monkeypatch, db, U_LAN)
    assert caught.value.status_code == 403


def test_reads_only(db, monkeypatch):
    _admin()
    _teacher(monkeypatch, db, U_TEACH)
    assert db.writes == []


def test_counts_are_not_cut_at_the_page_size(db):
    db.rows["user_feedback"] = [{"id": f"f{i:05d}", "status": "new", "created_at": _ago(hours=1)} for i in range(1203)]
    assert _admin()["queues"]["feedback_open"]["count"] == 1203


def test_review_wait_counts_teacher_deliveries_once(db):
    """Teacher deliveries set instructor_reviews.delivered_at, not
    writing_essays.admin_reviewed_at; an essay done on both paths counts once."""
    db.rows["writing_essays"] += [
        {"id": "e-admin", "student_id": S_LAN, "status": "delivered", "created_at": _ago(days=3),
         "admin_reviewed_at": _ago(hours=10), "deleted_at": None},
        {"id": "e-teach", "student_id": S_LAN, "status": "delivered", "created_at": _ago(days=3),
         "admin_reviewed_at": None, "deleted_at": None},
        {"id": "e-both", "student_id": S_LAN, "status": "delivered", "created_at": _ago(days=3),
         "admin_reviewed_at": _ago(hours=1), "deleted_at": None},
    ]
    db.rows["writing_feedback"] = [
        {"id": "wf1", "essay_id": "e-admin", "created_at": _ago(hours=12)},   # 2 h
        {"id": "wf2", "essay_id": "e-teach", "created_at": _ago(hours=30)},   # 20 h
        {"id": "wf3", "essay_id": "e-both", "created_at": _ago(hours=40)},    # 30 h (teacher, earlier)
    ]
    db.rows["instructor_reviews"] = [
        {"id": "ir1", "essay_id": "e-teach", "status": "delivered", "delivered_at": _ago(hours=10)},
        {"id": "ir2", "essay_id": "e-both", "status": "delivered", "delivered_at": _ago(hours=10)},
        {"id": "ir3", "essay_id": "e-gone", "status": "delivered", "delivered_at": _ago(hours=2)},
    ]
    assert _admin()["ops_week"]["review_wait_median_hours"] == 20.0
    db.rows["instructor_reviews"] = db.rows["instructor_reviews"][:1]
    db.rows["writing_essays"] = [e for e in db.rows["writing_essays"] if e["id"] != "e-both"]
    # Only a teacher delivery and an admin review: both count (2 h, 20 h).
    assert _admin()["ops_week"]["review_wait_median_hours"] == 11.0


def test_class_moved_to_another_teacher_takes_its_work_along(db, monkeypatch):
    """Teacher A gave e-a1 to class A; class A now belongs to teacher B. A has
    no class, so nothing counts for A; B cannot open e-a1 (not given by B,
    learner points at A), so it does not count for B either."""
    db.rows["cohorts"][0]["instructor_id"] = U_TEACH_B
    a = _teacher(monkeypatch, db, U_TEACH)
    assert a["queues"]["writing_review"]["count"] == 0 and a["queues"]["regrade_new"]["count"] == 0
    b = _teacher(monkeypatch, db, U_TEACH_B)
    assert "e-a1" not in str(b)
    assert b["queues"]["writing_review"]["count"] == 1    # e-b1 only
    assert b["queues"]["regrade_new"]["count"] == 1       # r2 (e-b1)
