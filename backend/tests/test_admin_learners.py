"""G09-T03 (ADMINIA-0074 FR-09-020…022, FR-09-029, FR-102): learner directory.

Runs the real service (services/admin_learner_directory.py and
services/learner_attention.py) and routes (routers/admin_learners.py) over a
small in-memory stand-in for the service client. All names and addresses are
made up; no AI or network call.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import admin_learners as mod
from services import admin_learner_directory as directory
from services import learner_attention, ops_thresholds, staff_scope, test_data_visibility

NOW = datetime.now(timezone.utc)
U_LAN, U_MINH, U_ONLY, U_TEACH, U_ADMIN, U_E2E = (f"10000000-0000-0000-0000-00000000000{i}" for i in range(1, 7))
U_TEACH_B = "10000000-0000-0000-0000-0000000000b0"
S_LAN, S_MINH, S_OFFLINE, S_E2E, S_OLD = (f"20000000-0000-0000-0000-00000000000{i}" for i in range(1, 6))
C_A, C_B = "30000000-0000-0000-0000-00000000000a", "30000000-0000-0000-0000-00000000000b"
DEFAULTS = {t.key: t.default for t in ops_thresholds.EDITABLE}


def _ago(**kw) -> str:
    return (NOW - timedelta(**kw)).isoformat()


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self._neg = db, name, [], False
        self._order, self._range, self._limit = None, None, None

    def _add(self, fn):
        neg, self._neg = self._neg, False
        self.filters.append((lambda r: not fn(r)) if neg else fn)
        return self

    @property
    def not_(self):
        self._neg = True
        return self

    def select(self, *_a, **_k): return self
    def eq(self, c, v): return self._add(lambda r: str(r.get(c)) == str(v) if not isinstance(v, bool) else r.get(c) is v)
    def in_(self, c, vs): return self._add(lambda r: str(r.get(c)) in {str(v) for v in vs})
    def is_(self, c, v): return self._add(lambda r: r.get(c) is None)
    def ilike(self, c, v): return self._add(lambda r: str(r.get(c) or "").lower() == v.replace("\\", "").lower())

    def order(self, c, desc=False):
        self._order = (c, desc)
        return self

    def range(self, a, b):
        self._range = (a, b)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        if self.name in self.db.fail:
            raise RuntimeError("db down")
        rows = [dict(r) for r in self.db.rows.get(self.name, []) if all(f(r) for f in self.filters)]
        if self._order:
            c, desc = self._order
            rows.sort(key=lambda r: str(r.get(c) or ""), reverse=desc)
        if self._range:
            rows = rows[self._range[0]: self._range[1] + 1]
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Resp(rows)


class _DB:
    def __init__(self):
        self.fail: set[str] = set()
        user = lambda uid, email, role="user", name=None, **kw: {
            "id": uid, "email": email, "display_name": name, "role": role, "is_active": True,
            "last_seen_at": _ago(days=1), "created_at": _ago(days=90), "target_band": None, "exam_date": None, **kw}
        student = lambda sid, code, name, uid=None, **kw: {
            "id": sid, "user_id": uid, "student_code": code, "full_name": name, "target_band": None,
            "target_date": None, "archived_at": None, "created_at": _ago(days=60), **kw}
        self.rows = {
            "users": [
                user(U_LAN, "lan@example.test", target_band=7.0, exam_date="2027-01-10"),
                user(U_MINH, "minh@example.test", last_seen_at=_ago(days=10)),
                user(U_ONLY, "chua-ho-so@example.test", name="Bảo Châu"),
                user(U_TEACH, "gv@example.test", role="instructor", name="Cô Hà"),
                user(U_TEACH_B, "gv-b@example.test", role="instructor", name="Thầy Tâm"),
                user(U_ADMIN, "admin@example.test", role="admin", name="Quản trị"),
                user(U_E2E, "robot@staging-e2e.averlearning.com", name="Robot"),
            ],
            "students": [
                student(S_LAN, "HV001", "Nguyễn Thị Lan", U_LAN, target_band=7.0, target_date="2027-01-10"),
                student(S_MINH, "HV002", "Trần Văn Minh", U_MINH, target_band=6.5),
                student(S_OLD, "HV000", "Trần Văn Minh (cũ)", U_MINH, archived_at=_ago(days=30)),
                student(S_OFFLINE, "HV003", "Đỗ Anh Đức"),
                student(S_E2E, "HV-E2E", "e2e learner", U_E2E),
            ],
            "student_cohort_memberships": [
                {"id": "m1", "student_id": S_LAN, "cohort_id": C_A, "is_active": True},
                {"id": "m2", "student_id": S_MINH, "cohort_id": C_B, "is_active": True},
                {"id": "m3", "student_id": S_OFFLINE, "cohort_id": C_A, "is_active": True},
            ],
            "cohorts": [{"id": C_A, "name": "Tue–Thu 19:30", "instructor_id": U_TEACH},
                        {"id": C_B, "name": "Sat–Sun 09:00", "instructor_id": U_TEACH_B}],
            "class_assignments": [
                {"id": "a1", "cohort_id": C_A, "title": "Buổi 8 · Writing Task 2", "due_at": _ago(days=10), "status": "published"},
                {"id": "a2", "cohort_id": C_A, "title": "Buổi 9 · Reading", "due_at": _ago(days=5), "status": "published"},
                {"id": "a3", "cohort_id": C_A, "title": "Buổi 10 · Listening", "due_at": _ago(days=2), "status": "published"},
                {"id": "a4", "cohort_id": C_A, "title": "Buổi 11 · Speaking", "due_at": (NOW + timedelta(days=3)).isoformat(),
                 "status": "published"},
            ],
            "class_assignment_items": [
                # Lan: on time, then two in a row not handed in -> a streak of 2.
                {"id": "i1", "assignment_id": "a1", "student_id": S_LAN, "state": "graded", "submitted_at": _ago(days=11)},
                {"id": "i2", "assignment_id": "a2", "student_id": S_LAN, "state": "assigned", "submitted_at": None},
                {"id": "i3", "assignment_id": "a3", "student_id": S_LAN, "state": "opened", "submitted_at": None},
                {"id": "i4", "assignment_id": "a4", "student_id": S_LAN, "state": "assigned", "submitted_at": None},
                # Đức: late but handed in, then on time -> no streak.
                {"id": "i5", "assignment_id": "a2", "student_id": S_OFFLINE, "state": "submitted", "submitted_at": _ago(days=4)},
                {"id": "i6", "assignment_id": "a3", "student_id": S_OFFLINE, "state": "submitted", "submitted_at": _ago(days=3)},
            ],
            "writing_essays": [
                {"id": f"e{i}", "student_id": S_LAN, "status": "delivered", "is_flagged": False, "deleted_at": None,
                 "delivered_at": _ago(days=i), "writing_feedback": {"overall_band_score": 6.0 + i / 2}}
                for i in range(1, 6)
            ] + [{"id": "e-draft", "student_id": S_LAN, "status": "graded", "is_flagged": False, "deleted_at": None,
                  "delivered_at": None, "writing_feedback": {"overall_band_score": 9.0}}],
            "sessions": [{"id": "x1", "user_id": U_LAN, "status": "completed", "overall_band": 6.5,
                          "started_at": _ago(days=2)}],
            "access_codes": [{"id": "k1", "code": "AVER-LAN1", "used_by": None}],
            "user_code_assignments": [{"code_id": "k1", "user_id": U_LAN, "is_active": True}],
        }

    def table(self, name):
        return _Query(self, name)


@pytest.fixture
def db(monkeypatch):
    fake = _DB()
    for module in (directory, learner_attention, staff_scope):
        monkeypatch.setattr(module, "supabase_admin", fake)
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(return_value=dict(DEFAULTS)))
    monkeypatch.setattr(test_data_visibility, "hide_for", lambda **_k: False)
    monkeypatch.setattr(mod, "require_admin", AsyncMock(return_value={"id": U_ADMIN, "email": "admin@example.test"}))
    return fake


def _list(**kw):
    params = dict(q=None, cohort_id=None, kind=None, status=None, attention=None, credits_max=None,
                  role="user,student", page=1, page_size=25, authorization="Bearer x")
    params.update(kw)
    return asyncio.run(mod.list_learners(**params))


def _by_ref(out):
    return {row["ref"]: row for row in out["items"]}


def _as(monkeypatch, db, user_id):
    async def require_instructor(_auth):
        role = next((u["role"] for u in db.rows["users"] if u["id"] == user_id), None)
        if role not in ("instructor", "admin"):
            raise HTTPException(403, "staff only")
        return {"id": user_id}

    async def role_row(uid):
        return _Resp([{"role": u["role"]} for u in db.rows["users"] if u["id"] == uid])

    monkeypatch.setattr(staff_scope, "require_instructor", require_instructor)
    monkeypatch.setattr(staff_scope, "_staff_role_row", role_row)


# ── Directory ──────────────────────────────────────────────────────────────

def test_one_row_per_person_across_users_and_students(db):
    rows = _by_ref(_list())
    lan = rows[f"u-{U_LAN}"]   # account + profile: one row, by the account
    assert lan["student_code"] == "HV001" and lan["account_state"] == "active" and lan["profile_state"] == "active"
    assert lan["cohorts"] == [{"id": C_A, "name": "Tue–Thu 19:30"}]
    offline = rows[f"s-{S_OFFLINE}"]   # profile without an account
    assert offline["account_state"] == "none" and offline["email"] is None
    only = rows[f"u-{U_ONLY}"]   # account without a profile
    assert only["profile_state"] == "none" and only["name"] == "Bảo Châu" and only["cohorts"] == []
    # Minh has an archived and an active profile: one row, the active one.
    assert rows[f"u-{U_MINH}"]["student_code"] == "HV002"
    assert f"s-{S_LAN}" not in rows and f"s-{S_MINH}" not in rows and f"s-{S_OLD}" not in rows
    # G04 has no read API: null, not a guess.
    assert lan["kind"] is None and lan["courses"] is None and lan["credits_left"] is None


def test_staff_are_hidden_unless_asked_for(db):
    refs = set(_by_ref(_list()))
    assert f"u-{U_TEACH}" not in refs and f"u-{U_ADMIN}" not in refs
    staff = set(_by_ref(_list(role="instructor")))
    assert staff == {f"u-{U_TEACH}", f"u-{U_TEACH_B}"}
    with pytest.raises(HTTPException) as caught:
        _list(role="owner")
    assert caught.value.status_code == 422


def test_staging_test_data_is_hidden_like_the_students_list(db, monkeypatch):
    assert f"u-{U_E2E}" in _by_ref(_list())
    monkeypatch.setattr(test_data_visibility, "hide_for", lambda **_k: True)
    assert f"u-{U_E2E}" not in _by_ref(_list())


def test_sorted_by_given_name_then_paged_by_25(db):
    names = [row["name"] for row in _list()["items"]]
    # By the last word, accents folded: Châu, Đức, Lan, learner, Minh.
    assert names == ["Bảo Châu", "Đỗ Anh Đức", "Nguyễn Thị Lan", "e2e learner", "Trần Văn Minh"]
    for i in range(30):
        db.rows["students"].append({"id": f"40000000-0000-0000-0000-{i:012d}", "user_id": None,
                                    "student_code": f"P{i:02d}", "full_name": f"Học viên {i:02d}",
                                    "archived_at": None, "created_at": _ago(days=1)})
    first, second = _list(), _list(page=2)
    assert first["total"] == second["total"] == 35
    assert len(first["items"]) == 25 and len(second["items"]) == 10
    assert not set(_by_ref(first)) & set(_by_ref(second))


def test_search_ignores_accents_and_finds_codes_and_emails(db):
    assert set(_by_ref(_list(q="duc"))) == {f"s-{S_OFFLINE}"}
    assert set(_by_ref(_list(q="minh@example"))) == {f"u-{U_MINH}"}
    assert set(_by_ref(_list(q="HV003"))) == {f"s-{S_OFFLINE}"}
    assert set(_by_ref(_list(q="aver-lan1"))) == {f"u-{U_LAN}"}   # activation code


def test_filters_by_class_and_archive(db):
    assert set(_by_ref(_list(cohort_id=C_A))) == {f"u-{U_LAN}", f"s-{S_OFFLINE}"}
    db.rows["students"][3]["archived_at"] = _ago(days=1)   # Đức leaves
    assert f"s-{S_OFFLINE}" not in _by_ref(_list())
    assert set(_by_ref(_list(status="archived"))) == {f"s-{S_OFFLINE}"}


@pytest.mark.parametrize("kw", [{"kind": "online"}, {"status": "expiring"}, {"attention": "low_credits"},
                                {"credits_max": 3}])
def test_filters_that_need_g04_are_refused_not_guessed(db, kw):
    with pytest.raises(HTTPException) as caught:
        _list(**kw)
    assert caught.value.status_code == 422 and caught.value.detail["code"] == "filter_unavailable"


def test_attention_column_and_filter_use_the_thresholds(db, monkeypatch):
    rows = _by_ref(_list())
    assert rows[f"u-{U_LAN}"]["attention"] == [{"code": "late_streak", "text": "trễ 2 bài liên tiếp"}]
    assert rows[f"u-{U_MINH}"]["attention"] == [{"code": "inactive", "text": "không hoạt động 10 ngày"}]
    assert rows[f"s-{S_OFFLINE}"]["attention"] == []   # late once, then on time; no account → no "inactive"
    assert set(_by_ref(_list(attention="any"))) == {f"u-{U_LAN}", f"u-{U_MINH}"}
    # The admin raises both thresholds: nobody needs attention any more.
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(return_value={**DEFAULTS, "late_streak_count": 3,
                                                                         "inactive_days": 14}))
    assert _list(attention="any")["total"] == 0
    assert _by_ref(_list())[f"u-{U_LAN}"]["attention"] == []


def test_a_failed_class_lookup_still_lists_and_says_so(db):
    db.fail.add("cohorts")
    out = _list()
    assert out["sources_failed"] == ["cohorts"]
    assert all(row["cohorts"] is None for row in out["items"])


def test_unreadable_attention_is_never_shown_as_fine(db, monkeypatch):
    db.fail.add("class_assignment_items")
    out = _list()
    assert "assignments" in out["sources_failed"]
    with pytest.raises(HTTPException) as caught:
        _list(attention="any")
    assert caught.value.status_code == 503
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(side_effect=ops_thresholds.ThresholdsUnavailable("x")))
    db.fail.clear()
    assert "thresholds" in _list()["sources_failed"]


def test_an_unreadable_directory_is_503(db):
    db.fail.add("users")
    with pytest.raises(HTTPException) as caught:
        _list()
    assert caught.value.status_code == 503 and caught.value.detail["code"] == "learners_unavailable"


# ── Detail and summary ─────────────────────────────────────────────────────

def test_profile_ref_of_a_person_with_an_account_points_to_the_account(db):
    out = asyncio.run(mod.get_learner(f"s-{S_LAN}", "Bearer x"))
    assert out["ref"] == f"s-{S_LAN}" and out["canonical_ref"] == f"u-{U_LAN}"
    offline = asyncio.run(mod.get_learner(f"s-{S_OFFLINE}", "Bearer x"))
    assert offline["canonical_ref"] == f"s-{S_OFFLINE}"
    for ref in ("x-123", f"u-{S_OFFLINE}", "u-not-a-uuid"):
        with pytest.raises(HTTPException) as caught:
            asyncio.run(mod.get_learner(ref, "Bearer x"))
        assert caught.value.status_code == 404


def test_summary_has_the_seven_fields_of_the_shared_block(db):
    detail = asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))
    s = detail["summary"]
    assert set(s) == {"name", "cohorts", "courses", "status", "goal", "overdue", "recent_bands",
                      "last_active_at", "latest_note"}
    assert s["name"] == "Nguyễn Thị Lan" and s["cohorts"][0]["name"] == "Tue–Thu 19:30"
    assert s["status"] == {"level": "attention", "reasons": [{"code": "late_streak", "text": "trễ 2 bài liên tiếp"}]}
    assert s["goal"] == {"target_band": 7.0, "exam_date": "2027-01-10", "source": "both_equal"}
    assert s["overdue"] == {"count": 2, "latest_title": "Buổi 10 · Listening"}   # Buổi 11 is not due yet
    # Only returned (delivered) Writing counts, newest first, at most four.
    assert s["recent_bands"] == {"writing": [6.5, 7.0, 7.5, 8.0], "speaking": [6.5]}
    assert s["latest_note"] is None and s["courses"] is None
    assert detail["sources_failed"] == []


def test_goal_sources(db):
    minh = asyncio.run(mod.get_learner(f"u-{U_MINH}", "Bearer x"))["summary"]
    assert minh["goal"] == {"target_band": 6.5, "exam_date": None, "source": "admin"}
    db.rows["users"][1]["target_band"] = 7.5
    minh = asyncio.run(mod.get_learner(f"u-{U_MINH}", "Bearer x"))["summary"]
    assert minh["goal"]["source"] == "conflict"
    only = asyncio.run(mod.get_learner(f"u-{U_ONLY}", "Bearer x"))["summary"]
    assert only["goal"] == {"target_band": None, "exam_date": None, "source": "none"}
    assert only["recent_bands"] == {"writing": [], "speaking": []}   # nothing yet, not a band


def test_one_failed_source_keeps_the_rest_of_the_summary(db):
    db.fail.add("writing_essays")
    out = asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))
    assert out["sources_failed"] == ["writing"]
    assert out["summary"]["recent_bands"] == {"writing": None, "speaking": [6.5]}
    db.fail = {"class_assignment_items"}
    out = asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))
    assert out["summary"]["overdue"] is None and out["summary"]["status"]["level"] is None
    assert "assignments" in out["sources_failed"]


# ── Teacher scope and roles ────────────────────────────────────────────────

def test_teacher_sees_only_learners_of_their_classes(db, monkeypatch):
    _as(monkeypatch, db, U_TEACH)
    out = asyncio.run(mod.get_instructor_learner(f"u-{U_LAN}", "Bearer x"))
    assert out["summary"]["name"] == "Nguyễn Thị Lan"
    assert asyncio.run(mod.get_learner_summary(f"s-{S_OFFLINE}", "Bearer x"))["name"] == "Đỗ Anh Đức"
    for call in (mod.get_instructor_learner, mod.get_learner_summary):
        for ref in (f"u-{U_MINH}", f"u-{U_ONLY}"):   # another class; no class at all
            with pytest.raises(HTTPException) as caught:
                asyncio.run(call(ref, "Bearer x"))
            assert caught.value.status_code == 404


def test_a_learner_in_two_teachers_classes_shows_each_teacher_only_their_class(db, monkeypatch):
    """FR-102: Lan is in Cô Hà's class (C_A) and Thầy Tâm's class (C_B). Each
    teacher sees only their own class and its work; the admin sees both."""
    db.rows["student_cohort_memberships"].append(
        {"id": "m4", "student_id": S_LAN, "cohort_id": C_B, "is_active": True})
    db.rows["class_assignments"].append(
        {"id": "b1", "cohort_id": C_B, "title": "Lớp B · Mock test", "due_at": _ago(days=1), "status": "published"})
    db.rows["class_assignment_items"].append(
        {"id": "ib1", "assignment_id": "b1", "student_id": S_LAN, "state": "assigned", "submitted_at": None})

    def summary_as(user_id):
        _as(monkeypatch, db, user_id)
        return asyncio.run(mod.get_learner_summary(f"u-{U_LAN}", "Bearer x"))

    a = summary_as(U_TEACH)
    assert [c["id"] for c in a["cohorts"]] == [C_A]
    assert a["overdue"] == {"count": 2, "latest_title": "Buổi 10 · Listening"}
    b = summary_as(U_TEACH_B)
    assert [c["id"] for c in b["cohorts"]] == [C_B]
    assert b["overdue"] == {"count": 1, "latest_title": "Lớp B · Mock test"}
    assert "Tue–Thu 19:30" not in repr(b) and "Buổi" not in repr(b)
    detail_b = asyncio.run(mod.get_instructor_learner(f"u-{U_LAN}", "Bearer x"))["summary"]
    assert [c["id"] for c in detail_b["cohorts"]] == [C_B] and detail_b["overdue"]["count"] == 1
    admin = summary_as(U_ADMIN)
    assert sorted(c["id"] for c in admin["cohorts"]) == sorted([C_A, C_B])
    assert admin["overdue"] == {"count": 3, "latest_title": "Lớp B · Mock test"}


def test_admin_reads_any_summary(db, monkeypatch):
    _as(monkeypatch, db, U_ADMIN)
    assert asyncio.run(mod.get_learner_summary(f"u-{U_MINH}", "Bearer x"))["name"] == "Trần Văn Minh"


def test_a_learner_token_is_refused(db, monkeypatch):
    _as(monkeypatch, db, U_LAN)
    for call in (mod.get_instructor_learner, mod.get_learner_summary):
        with pytest.raises(HTTPException) as caught:
            asyncio.run(call(f"u-{U_LAN}", "Bearer x"))
        assert caught.value.status_code == 403
    monkeypatch.setattr(mod, "require_admin", AsyncMock(side_effect=HTTPException(403, "admin only")))
    with pytest.raises(HTTPException) as caught:
        _list()
    assert caught.value.status_code == 403


def test_teacher_scope_that_cannot_be_read_fails_closed(db, monkeypatch):
    _as(monkeypatch, db, U_TEACH)
    db.fail.add("student_cohort_memberships")
    with pytest.raises(HTTPException) as caught:
        asyncio.run(mod.get_learner_summary(f"u-{U_LAN}", "Bearer x"))
    assert caught.value.status_code == 503
