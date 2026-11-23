"""G09-T04c (ADMINIA-0074 FR-026, FR-027): the profile's AI cost (Khoá và
quyền tab) and system log (Nhật ký hệ thống tab).

Runs the real services and routes over the in-memory stand-in of
test_admin_learners. Made-up people only; no AI or network call.
"""

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import admin as admin_router
from routers import admin_learner_profile as mod
from services import admin_learner_cost, admin_learner_log
from services import admin_learner_directory as directory
from services import learner_attention, ops_thresholds, staff_scope, test_data_visibility
from test_admin_learners import (DEFAULTS, S_LAN, S_OFFLINE, U_ADMIN, U_LAN, U_MINH, U_TEACH, C_A, _DB, _ago)


@pytest.fixture
def db(monkeypatch):
    fake = _DB()
    for module in (directory, learner_attention, staff_scope, admin_learner_cost, admin_learner_log, admin_router):
        monkeypatch.setattr(module, "supabase_admin", fake)
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(return_value=dict(DEFAULTS)))
    monkeypatch.setattr(test_data_visibility, "hide_for", lambda **_k: False)
    monkeypatch.setattr(mod, "require_admin", AsyncMock(return_value={"id": U_ADMIN}))
    return fake


def _cost(ref, window=30):
    return asyncio.run(mod.get_learner_ai_cost(ref, window, "Bearer x"))


def _log(ref, kind=None, cursor=None):
    return asyncio.run(mod.get_learner_log(ref, kind, cursor, "Bearer x"))


def _call(i, *, user=U_LAN, feature="speaking_grading", cost=0.10, days=1, **kw):
    return {"id": f"l{i:03d}", "user_id": user, "service": "claude", "model": "claude-sonnet-5-5",
            "feature": feature, "cost_usd_est": cost, "pricing_version": "2026-11" if cost is not None else None,
            "status": "success", "created_at": _ago(days=days), **kw}


# ── AI cost ────────────────────────────────────────────────────────────────

def test_ai_cost_of_a_learner_with_no_calls_is_zero_and_nothing_unpriced(db):
    out = _cost(f"u-{U_MINH}")
    assert out == {"window_days": 30, "total_usd": 0.0, "unpriced_calls": 0, "by_feature": []}


def test_ai_cost_sums_the_learner_s_calls_in_the_window_by_feature(db):
    db.rows["ai_usage_logs"] = [
        _call(1, cost=0.104),
        _call(2, cost=0.203, days=3),
        # An essay an admin handed in: no user on the row, still Lan's spend.
        _call(3, user=None, feature="writing_grading", cost=0.05, resource_id="e1",
              usage_event_id="writing:job-1:claude"),
        # No price: adds nothing, counted as unpriced. A failed call is neither.
        _call(4, cost=None, cost_source="unpriced"),
        _call(5, cost=None, cost_source="unpriced", status="error"),
        _call(6, cost=5.0, days=40),                  # outside 30 days
        _call(7, user=U_MINH, cost=9.0),              # someone else
    ]
    # Historical Writing spend kept only on feedback rows: e2 has no ledger
    # row, so it counts; e1's job is already in the ledger, so only the part
    # the ledger misses counts.
    db.rows["writing_feedback"] = [
        {"id": "f1", "essay_id": "e2", "model_used": "gemini-2.5-pro", "tokens_input": 10, "tokens_output": 10,
         "cost_usd": 0.02, "provenance": None, "created_at": _ago(days=2)},
        {"id": "f2", "essay_id": "e1", "model_used": "gemini-2.5-pro", "tokens_input": 10, "tokens_output": 10,
         "cost_usd": 0.08, "provenance": {"job_id": "job-1"}, "created_at": _ago(days=2)},
    ]
    out = _cost(f"u-{U_LAN}")
    assert out["window_days"] == 30
    assert out["unpriced_calls"] == 1
    assert out["by_feature"] == [
        {"feature": "speaking_grading", "calls": 4, "cost_usd": 0.31, "unpriced_calls": 1},
        {"feature": "writing_grading", "calls": 3, "cost_usd": 0.1, "unpriced_calls": 0},
    ]
    assert out["total_usd"] == 0.41
    assert _cost(f"u-{U_LAN}", 90)["total_usd"] == 5.41
    assert _cost(f"u-{U_LAN}", 7)["total_usd"] == 0.41


def test_ai_cost_matches_the_usage_page_for_the_same_window(db):
    """The profile figure and /admin/usage/users agree when every call
    carries the learner's account."""
    db.rows["ai_usage_logs"] = [_call(1, cost=0.104), _call(2, cost=0.2, days=20),
                                _call(3, feature="writing_grading", cost=0.05, resource_id="e1",
                                      usage_event_id="writing:job-1:claude")]
    db.rows["writing_feedback"] = [
        {"id": "f1", "essay_id": "e2", "model_used": "gemini-2.5-pro", "tokens_input": 10, "tokens_output": 10,
         "cost_usd": 0.02, "provenance": None, "created_at": _ago(days=2)}]
    out = _cost(f"u-{U_LAN}")
    since = _ago(days=30)
    usage = admin_router._aggregate_usage_for_users([U_LAN], since, None)[U_LAN]["ai_cost_usd"]
    assert out["total_usd"] == round(usage, 2) == 0.37


def test_ai_cost_of_an_offline_learner_counts_their_essays(db):
    db.rows["writing_essays"].append({"id": "e-duc", "student_id": S_OFFLINE, "status": "delivered"})
    db.rows["ai_usage_logs"] = [_call(1, user=None, feature="writing_grading", cost=0.07, resource_id="e-duc",
                                      usage_event_id="writing:job-9:claude")]
    out = _cost(f"s-{S_OFFLINE}")
    assert out["total_usd"] == 0.07 and out["by_feature"][0]["calls"] == 1


def test_ai_cost_says_unavailable_rather_than_a_smaller_sum(db):
    db.rows["ai_usage_logs"] = [_call(1)]
    db.fail.add("writing_feedback")
    with pytest.raises(HTTPException) as exc:
        _cost(f"u-{U_LAN}")
    assert exc.value.status_code == 503 and exc.value.detail["code"] == "ai_cost_unavailable"


def test_ai_cost_window_is_7_30_or_90(db):
    with pytest.raises(HTTPException) as exc:
        _cost(f"u-{U_LAN}", 14)
    assert exc.value.status_code == 422


# ── System log ─────────────────────────────────────────────────────────────

def _seed_log(db):
    db.rows["access_code_audit"] = [
        {"id": "ac1", "actor_user_id": U_ADMIN, "action": "create", "code_id": "k1", "target_user_id": U_LAN,
         "before": None, "after": {"code": "AVER-LAN1"}, "created_at": _ago(days=10)},
        {"id": "ac2", "actor_user_id": U_LAN, "action": "promote_role_rejected", "code_id": "k1",
         "target_user_id": U_LAN, "before": None,
         "after": {"reason": "email_mismatch", "intended_email": "someone-else@example.test"},
         "created_at": _ago(days=9)},
        # A code moved away from Lan: her log shows it, though she is not the target.
        {"id": "ac3", "actor_user_id": U_ADMIN, "action": "reassign", "code_id": "k1", "target_user_id": U_MINH,
         "before": {"assigned_user": U_LAN}, "after": {"assigned_user": U_MINH}, "created_at": _ago(days=1)},
        {"id": "ac4", "actor_user_id": U_ADMIN, "action": "brand_new_action", "code_id": None,
         "target_user_id": U_LAN, "before": None, "after": None, "created_at": _ago(days=8)},
    ]
    db.rows["staff_security_audit"] = [
        {"id": "ss1", "occurred_at": _ago(days=7), "event": "role_changed", "target_user_id": U_LAN,
         "actor_user_id": U_ADMIN, "before": {"role": "user"}, "after": {"role": "instructor"},
         "reason": "lý do riêng tư"},
        {"id": "ss2", "occurred_at": _ago(days=6), "event": "sessions_revoked", "target_user_id": U_LAN,
         "actor_user_id": U_ADMIN, "before": None, "after": None, "reason": None},
    ]
    db.rows["class_action_log"] = [
        {"id": "ca1", "action": "return_work", "cohort_id": C_A, "assignment_id": "a1",
         "assignment_title": "Buổi 8 · Writing Task 2", "student_id": S_LAN, "actor_user_id": U_TEACH,
         "created_at": _ago(days=5)},
        {"id": "ca2", "action": "return_work", "cohort_id": C_A, "assignment_id": "a2",
         "assignment_title": "Bài của bạn khác", "student_id": S_OFFLINE, "actor_user_id": U_TEACH,
         "created_at": _ago(days=5)},
    ]
    db.rows["learner_goal_events"] = [
        {"id": 1, "student_id": S_LAN, "user_id": U_LAN, "used": "learner",
         "before": {}, "after": {"target_band": 7.5, "target_date": "2027-01-10"}, "actor_id": U_ADMIN,
         "created_at": _ago(days=2)},
    ]


def test_the_log_of_a_learner_with_no_events_is_empty_and_names_what_g04_still_owes(db):
    out = _log(f"u-{U_MINH}")
    assert out == {"items": [], "next_cursor": None, "sources_failed": [],
                   "sources_unavailable": ["entitlement", "credit", "order"]}


def test_the_log_merges_every_source_newest_first_in_plain_vietnamese(db):
    _seed_log(db)
    db.rows["students"][0]["persona_notes"] = "ghi chú chăm sóc riêng"
    out = _log(f"u-{U_LAN}")
    lines = [(i["source"], i["text"], i["actor_name"]) for i in out["items"]]
    assert lines == [
        ("access_code", "Mã …N1 được chuyển sang người khác", "Quản trị"),
        ("goal", "Thống nhất mục tiêu theo giá trị học viên khai: band 7.5, ngày thi 10/01/2027", "Quản trị"),
        ("class", "Trả lại bài “Buổi 8 · Writing Task 2” để làm lại", "Cô Hà"),
        ("security", "Đăng xuất khỏi mọi thiết bị", "Quản trị"),
        ("role", "Đổi vai trò: Học viên → Giáo viên", "Quản trị"),
        ("access_code", "Thao tác khác", "Quản trị"),
        ("access_code", "Kích hoạt mã …N1 bị từ chối: email không khớp", "lan@example.test"),
        ("access_code", "Được cấp mã …N1", "Quản trị"),
    ]
    assert out["sources_failed"] == [] and out["next_cursor"] is None
    body = json.dumps(out, ensure_ascii=False)
    # Typed text never travels: no reason, no other e-mail, no care note.
    for secret in ("lý do riêng tư", "someone-else@example.test", "ghi chú chăm sóc riêng", "Bài của bạn khác",
                   "AVER-LAN1"):
        assert secret not in body


def test_one_failed_source_is_named_and_the_others_still_answer(db):
    _seed_log(db)
    db.fail.add("class_action_log")
    out = _log(f"u-{U_LAN}")
    assert out["sources_failed"] == ["class"]
    assert {i["source"] for i in out["items"]} == {"access_code", "goal", "security", "role"}


def test_the_kind_filter_reads_one_source(db):
    _seed_log(db)
    out = _log(f"u-{U_LAN}", kind="role")
    assert [i["text"] for i in out["items"]] == ["Đổi vai trò: Học viên → Giáo viên"]
    assert out["sources_unavailable"] == []
    assert _log(f"u-{U_LAN}", kind="credit") == {"items": [], "next_cursor": None, "sources_failed": [],
                                                  "sources_unavailable": ["credit"]}


def test_pages_cover_every_line_once_even_with_equal_instants_and_new_rows(db):
    same = _ago(days=3)
    db.rows["access_code_audit"] = [
        {"id": f"ac{i:03d}", "actor_user_id": U_ADMIN, "action": "edit", "code_id": "k1", "target_user_id": U_LAN,
         "before": None, "after": None, "created_at": same if i % 3 == 0 else _ago(days=3, minutes=i)}
        for i in range(120)]
    first = _log(f"u-{U_LAN}")
    assert len(first["items"]) == 50 and first["next_cursor"]
    # A new line between two pages goes to the top; it never shifts a later page.
    db.rows["access_code_audit"].append({"id": "zz-new", "actor_user_id": U_ADMIN, "action": "edit", "code_id": "k1",
                                         "target_user_id": U_LAN, "before": None, "after": None,
                                         "created_at": _ago(minutes=1)})
    second = _log(f"u-{U_LAN}", cursor=first["next_cursor"])
    third = _log(f"u-{U_LAN}", cursor=second["next_cursor"])
    assert len(second["items"]) == 50 and len(third["items"]) == 20 and third["next_cursor"] is None
    seen = [i["id"] for page in (first, second, third) for i in page["items"]]
    assert sorted(seen) == sorted(f"ac{i:03d}" for i in range(120))
    stamps = [i["at"] for page in (first, second, third) for i in page["items"]]
    assert stamps == sorted(stamps, reverse=True)


def test_a_bad_cursor_is_refused(db):
    with pytest.raises(HTTPException) as exc:
        _log(f"u-{U_LAN}", cursor="not-a-cursor")
    assert exc.value.status_code == 422 and exc.value.detail["code"] == "bad_cursor"


def test_a_black_eye_assignment_stays_hidden_as_on_the_class_log(db):
    _seed_log(db)
    for a in db.rows["class_assignments"]:
        if a["id"] == "a1":
            a.update(skill="listening", content_config={"programme_id": admin_learner_log_blackeye_programme()})
    out = _log(f"u-{U_LAN}", kind="class")
    assert out["items"] == [] and out["sources_failed"] == []


def admin_learner_log_blackeye_programme():
    from services import listening_blackeye
    return listening_blackeye.PROGRAMME


def test_a_code_level_edit_reaches_the_learner_only_while_they_held_the_code(db):
    db.rows["access_codes"].append({"id": "k2", "code": "AVER-OLD2", "used_by": U_LAN, "used_at": _ago(days=50)})
    db.rows["user_code_assignments"] = [
        {"id": "uca1", "code_id": "k1", "user_id": U_LAN, "is_active": False,
         "assigned_at": _ago(days=20), "revoked_at": _ago(days=5)}]
    edit = lambda i, code, days, after: {"id": i, "actor_user_id": U_ADMIN, "action": "edit", "code_id": code,
                                        "target_user_id": None, "before": {}, "after": after,
                                        "created_at": _ago(days=days)}
    db.rows["access_code_audit"] = [
        edit("e1", "k1", 30, {"notes": "x"}),                          # before Lan held k1
        edit("e2", "k1", 10, {"permissions": ["writing"], "expires_at": "2027-01-01"}),
        edit("e3", "k1", 2, {"is_active": False}),                     # after k1 left Lan
        edit("e4", "k2", 40, {"session_limit": 10}),                   # legacy code, after redemption
    ]
    out = _log(f"u-{U_LAN}", kind="access_code")
    assert [(i["id"], i["text"]) for i in out["items"]] == [
        ("e2", "Sửa mã …N1: quyền, hạn dùng"),
        ("e4", "Sửa mã …D2: số lượt"),
    ]
    assert _log(f"u-{U_MINH}", kind="access_code")["items"] == []


def test_a_class_deadline_change_reaches_the_learners_who_have_that_work(db):
    _seed_log(db)
    db.rows["class_action_log"] += [
        # a2 was handed to Lan and Đức; a5 to nobody in this test.
        {"id": "ca3", "action": "due_change", "cohort_id": C_A, "assignment_id": "a2",
         "assignment_title": "Buổi 9 · Reading", "student_id": None, "actor_user_id": U_TEACH,
         "details": {"previous_due_at": "2026-11-20T16:59:00+00:00", "due_at": "2026-11-24T16:59:00+00:00"},
         "created_at": _ago(hours=1)},
        {"id": "ca4", "action": "due_change", "cohort_id": C_A, "assignment_id": "a5",
         "assignment_title": "Bài không giao cho Lan", "student_id": None, "actor_user_id": U_TEACH,
         "details": {}, "created_at": _ago(hours=2)},
    ]
    lan = _log(f"u-{U_LAN}", kind="class")["items"]
    assert [i["text"] for i in lan] == ["Đổi hạn bài “Buổi 9 · Reading”: 20/11/2026 → 24/11/2026",
                                        "Trả lại bài “Buổi 8 · Writing Task 2” để làm lại"]
    # Minh is in another class and has no item of a2: he does not see it.
    assert _log(f"u-{U_MINH}", kind="class")["items"] == []
    duc = [i["text"] for i in _log(f"s-{S_OFFLINE}", kind="class")["items"]]
    assert duc[0].startswith("Đổi hạn bài “Buổi 9 · Reading”") and "Bài không giao cho Lan" not in str(duc)


def test_an_offline_learner_has_class_lines_and_no_account_lines(db):
    _seed_log(db)
    out = _log(f"s-{S_OFFLINE}")
    # Đức has items of a2 and a3; none of the seeded rows is a deadline change.
    assert [(i["source"], i["text"]) for i in out["items"]] == [
        ("class", "Trả lại bài “Bài của bạn khác” để làm lại")]


def test_access_codes_are_named_only_masked_never_whole(db):
    # A 12-symbol code (the current format) and a refill that moved the learner
    # onto a new, unused code. Neither code may appear whole anywhere in the
    # answer: not from access_codes, not from the audit row's before/after.
    old, new = "QWER-TYUP-AB12", "ZXCV-BNMK-CD34"
    db.rows["access_codes"] += [{"id": "k3", "code": old, "used_by": U_LAN}, {"id": "k4", "code": new, "used_by": None}]
    row = lambda i, action, code, days, **kw: {"id": i, "actor_user_id": U_ADMIN, "action": action, "code_id": code,
                                              "target_user_id": U_LAN, "before": kw.get("before"),
                                              "after": kw.get("after"), "created_at": _ago(days=days)}
    db.rows["access_code_audit"] = [
        row("r1", "create", "k3", 9, after={"code": old, "permissions": ["writing"]}),
        row("r2", "refill", "k3", 3, after={"new_code_id": "k4", "new_code": new}),
        row("r3", "create", "k4", 3, after={"via": "refill", "code": new}),
        row("r4", "hard_delete", "k-gone", 1, before={"code": "GONE-GONE-GO99"}),
    ]
    db.rows["access_code_audit"].append(
        {"id": "r5", "actor_user_id": U_ADMIN, "action": "reassign", "code_id": "k3", "target_user_id": U_MINH,
         "before": {"assigned_user": U_LAN}, "after": {"assigned_user": U_MINH}, "created_at": _ago(hours=1)})
    out = _log(f"u-{U_LAN}", kind="access_code")
    assert [(i["id"], i["text"]) for i in out["items"]] == [
        ("r5", "Mã …AB12 được chuyển sang người khác"),
        ("r4", "Xoá hẳn một mã"),
        ("r3", "Được cấp mã …CD34 (cấp lại từ mã cũ)"),
        ("r2", "Cấp lại mã …AB12, thay bằng mã mới"),
        ("r1", "Được cấp mã …AB12"),
    ]
    body = json.dumps(out, ensure_ascii=False)
    for whole in (old, new, "GONE-GONE-GO99", "QWERTYUPAB12", "ZXCVBNMKCD34", "TYUP", "BNMK"):
        assert whole not in body


def test_the_mask_keeps_a_short_tail_and_hides_short_codes():
    from services import admin_learner_log_text as text
    assert text.masked("QWER-TYUP-AB12") == "…AB12"
    assert text.masked("ABCD2345") == "…45"   # legacy 8-symbol code
    assert text.masked("AB12") is None and text.masked(None) is None and text.masked("") is None
